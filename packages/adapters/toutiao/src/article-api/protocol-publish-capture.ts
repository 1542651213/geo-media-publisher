import { createHash } from "node:crypto";
import type { BrowserContext, Page, Request, Response, Route } from "playwright-core";
import { classifyCreatorSessionBody, classifyShadowRequest, isSafeCreatorHomePath, readBoundedResponseJson, TOUTIAO_GUARDED_EDITOR_URL } from "./protocol-live-shadow";
import { protocolKeyShape, safeProtocolName } from "./protocol-shadow";

export interface SafeBlockedPublishRequest {
  readonly method: string;
  readonly host: "mp.toutiao.com";
  readonly path: "/mp/agw/article/publish";
  readonly queryKeys: readonly string[];
  readonly headerKeys: readonly string[];
  readonly bodyKeys: readonly string[];
  readonly contentType: string | null;
  readonly bodyByteLength: number;
  readonly bodySha256: string | null;
}

export interface ControlledPublishGuardEvidence {
  readonly articleNewSentCount: number;
  readonly articleNewBlockedCount: number;
  readonly publishAttemptCount: number;
  readonly blockedPublishCount: number;
  readonly guardAbortFailed: boolean;
  readonly publishSentCount: 0;
  readonly draftSentCount: 0;
  readonly uploadSentCount: 0;
  readonly blockedContentMutationCount: number;
  readonly blockedUnknownMutationCount: number;
  readonly publishRequest: SafeBlockedPublishRequest | null;
}

function exactPath(method: string, rawUrl: string, path: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return url.origin === "https://mp.toutiao.com" && !url.hash && decodeURIComponent(url.pathname) === path
      && /^[A-Z]{1,8}$/u.test(method.toUpperCase()) ? url : null;
  } catch { return null; }
}

function exactArticleNew(request: Request): boolean {
  const url = exactPath(request.method(), request.url(), "/mp/agw/article/new");
  return request.method().toUpperCase() === "GET" && url !== null
    && ![...url.searchParams.keys()].some((key) => /^(?:create|save|update|delete|upload|publish|schedule|draft|action|operation|op|cmd)$/iu.test(key));
}

function bodyKeys(bytes: Buffer | null, contentType: string | null): string[] {
  if (!bytes || bytes.byteLength > 512_000 || !contentType) return [];
  try {
    const body = bytes.toString("utf8");
    if (contentType === "application/x-www-form-urlencoded")
      return [...new Set([...new URLSearchParams(body).keys()].map(safeProtocolName))].sort();
    if (contentType === "application/json") {
      const value: unknown = JSON.parse(body);
      return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).map(safeProtocolName).sort() : [];
    }
  } catch { /* Body contents never leave this function. */ }
  return [];
}

/** Returns only metadata while the route is paused; the caller always aborts the request. */
function safeBlockedPublishRequest(request: Request): SafeBlockedPublishRequest | null {
  const url = exactPath(request.method(), request.url(), "/mp/agw/article/publish");
  if (!url) return null;
  const headers = request.headers();
  const rawContentType = headers["content-type"] ?? headers["Content-Type"] ?? null;
  const mediaType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  const contentType = mediaType && ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"].includes(mediaType)
    ? mediaType : mediaType ? "other" : null;
  const bytes = request.postDataBuffer();
  return {
    method: request.method().toUpperCase(), host: "mp.toutiao.com", path: "/mp/agw/article/publish",
    queryKeys: [...new Set([...url.searchParams.keys()].map(safeProtocolName))].sort(),
    headerKeys: [...new Set(Object.keys(headers).map((key) => safeProtocolName(key.toLowerCase())))].sort(),
    bodyKeys: bodyKeys(bytes, contentType), contentType,
    bodyByteLength: bytes?.byteLength ?? 0,
    bodySha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null
  };
}

/** The only permitted content endpoint is one exact article/new GET. Publish is captured and aborted. */
export function createControlledPublishCaptureGuard(onPublishAttempt?: () => void): {
  handle(route: Route): Promise<void>;
  evidence(): ControlledPublishGuardEvidence;
} {
  let articleNewSentCount = 0;
  let articleNewBlockedCount = 0;
  let publishAttemptCount = 0;
  let blockedPublishCount = 0;
  let guardAbortFailed = false;
  let blockedContentMutationCount = 0;
  let blockedUnknownMutationCount = 0;
  let publishRequest: SafeBlockedPublishRequest | null = null;
  return {
    async handle(route) {
      const request = route.request();
      if (exactArticleNew(request) && articleNewSentCount === 0) {
        articleNewSentCount = 1; // Consume before dispatch, including timeout or lost response.
        await route.continue();
        return;
      }
      const decision = classifyShadowRequest(request.method(), request.url());
      if (decision === "READ_ONLY" || decision === "NON_CONTENT_TELEMETRY" || decision === "AUTH_TOKEN_BOOTSTRAP") {
        await route.continue();
        return;
      }
      if (decision === "DENY_ARTICLE_NEW") articleNewBlockedCount += 1;
      else if (decision === "DENY_CONTENT_MUTATION") blockedContentMutationCount += 1;
      else blockedUnknownMutationCount += 1;
      const isPublish = exactPath(request.method(), request.url(), "/mp/agw/article/publish") !== null;
      if (isPublish) {
        publishAttemptCount += 1;
        if (publishRequest === null) {
          try { publishRequest = safeBlockedPublishRequest(request); }
          catch { /* Even a malformed body must be aborted. */ }
        }
        onPublishAttempt?.();
      }
      try {
        await route.abort("blockedbyclient");
        if (isPublish) blockedPublishCount += 1;
      } catch {
        guardAbortFailed = true;
        throw new Error("TOUTIAO_CAPTURE_GUARD_ABORT_FAILED");
      }
    },
    evidence: () => ({ articleNewSentCount, articleNewBlockedCount, publishAttemptCount, blockedPublishCount, guardAbortFailed,
      publishSentCount: 0, draftSentCount: 0, uploadSentCount: 0,
      blockedContentMutationCount, blockedUnknownMutationCount, publishRequest })
  };
}

export interface ControlledPublishMarks {
  contentFilled(): void;
  buttonTriggered(): void;
}

export interface ControlledPublishCaptureResult {
  readonly status: "REQUEST_CAPTURED" | "PUBLISH_REQUEST_NOT_TRIGGERED" | "AUTH_UNVERIFIED" | "EDITOR_NOT_READY"
    | "REMOTE_ARTICLE_OBJECT_DETECTED" | "ACTION_FAILED" | "SESSION_DISCONNECTED" | "GUARD_UNCERTAIN";
  readonly remoteAuthState: "VALID" | "INVALID" | "UNKNOWN";
  readonly contentFilled: boolean;
  readonly buttonTriggered: boolean;
  readonly articleNewResponseStatus: number | null;
  readonly articleNewResponseKeyShape: readonly string[];
  readonly guard: ControlledPublishGuardEvidence;
  readonly pageHost: string | null;
}

/** Diagnostic only. Installs the account-context guard before any page action. */
export async function runControlledToutiaoPublishCapture(
  context: BrowserContext, canonicalPage: Page,
  action: (editorPage: Page, marks: ControlledPublishMarks) => Promise<void>
): Promise<ControlledPublishCaptureResult> {
  const location = (page: Page): URL | null => { try { return new URL(page.url()); } catch { return null; } };
  const home = location(canonicalPage);
  if (canonicalPage.isClosed() || canonicalPage.context() !== context || home?.hostname !== "mp.toutiao.com"
    || !isSafeCreatorHomePath(home.pathname)) throw new Error("TOUTIAO_CAPTURE_SESSION_UNAVAILABLE");
  if (context.serviceWorkers().length > 0) throw new Error("TOUTIAO_CAPTURE_SERVICE_WORKER_UNGUARDED");

  const guard = createControlledPublishCaptureGuard();
  const pending = new Set<Promise<void>>();
  const auth: { state: "VALID" | "INVALID" | "UNKNOWN" } = { state: "UNKNOWN" };
  let articleNewResponseStatus: number | null = null;
  let articleNewAccepted = false;
  let articleNewResponseKeyShape: string[] = [];
  let contentFilled = false;
  let buttonTriggered = false;
  let editorPage: Page | null = null;
  const onResponse = (response: Response): void => {
    const work = (async () => {
      const request = response.request();
      const requestUrl = new URL(request.url());
      if (requestUrl.origin !== "https://mp.toutiao.com" || request.method() !== "GET") return;
      const path = requestUrl.pathname;
      if (path !== "/mp/agw/media/user_login_status_api" && path !== "/mp/agw/article/new") return;
      const body = await readBoundedResponseJson(response, await response.allHeaders());
      if (path === "/mp/agw/media/user_login_status_api")
        auth.state = response.status() === 200 ? classifyCreatorSessionBody(body) : "UNKNOWN";
      else {
        articleNewResponseStatus = response.status();
        articleNewResponseKeyShape = protocolKeyShape(body);
        articleNewAccepted = response.status() === 200 && body !== null && typeof body === "object"
          && !Array.isArray(body) && (body as Record<string, unknown>).code === 0;
      }
    })().catch(() => undefined);
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  const settleResponses = async (): Promise<void> => { await Promise.allSettled([...pending]); };
  const waitForEvidence = async (page: Page, ready: () => boolean, attempts: number): Promise<void> => {
    for (let index = 0; index < attempts && !ready(); index += 1) {
      await page.waitForTimeout(500);
      await settleResponses();
    }
  };
  const result = (status: ControlledPublishCaptureResult["status"]): ControlledPublishCaptureResult => ({
    status, remoteAuthState: auth.state, contentFilled, buttonTriggered, articleNewResponseStatus, articleNewResponseKeyShape,
    guard: guard.evidence(), pageHost: editorPage ? location(editorPage)?.hostname ?? null : home.hostname
  });
  await context.route("**/*", guard.handle);
  context.on("response", onResponse);
  try {
    await canonicalPage.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForEvidence(canonicalPage, () => auth.state !== "UNKNOWN", 10);
    if (auth.state !== "VALID") return result("AUTH_UNVERIFIED");
    if (context.serviceWorkers().length > 0) return result("GUARD_UNCERTAIN");

    editorPage = await context.newPage();
    if (editorPage.context() !== context) return result("SESSION_DISCONNECTED");
    await editorPage.goto(TOUTIAO_GUARDED_EDITOR_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForEvidence(editorPage, () => articleNewResponseStatus !== null, 20);
    if (!articleNewAccepted || guard.evidence().articleNewSentCount !== 1
      || location(editorPage)?.pathname !== "/profile_v4/graphic/publish") return result("EDITOR_NOT_READY");
    if (articleNewResponseKeyShape.some((key) => /(?:^|\.)(?:pgc_id|article_id|draft_id|item_id|group_id)$/iu.test(key)))
      return result("REMOTE_ARTICLE_OBJECT_DETECTED");
    if (context.serviceWorkers().length > 0) return result("GUARD_UNCERTAIN");

    try {
      await action(editorPage, {
        contentFilled: () => { contentFilled = true; },
        buttonTriggered: () => { if (buttonTriggered) throw new Error("TOUTIAO_CAPTURE_SECOND_CLICK_DENIED"); buttonTriggered = true; }
      });
    } catch {
      const evidence = guard.evidence();
      if (!evidence.guardAbortFailed && evidence.publishAttemptCount === 1 && evidence.blockedPublishCount === 1 && evidence.publishRequest)
        return result("REQUEST_CAPTURED");
      return result(evidence.guardAbortFailed ? "GUARD_UNCERTAIN" : "ACTION_FAILED");
    }
    await editorPage.waitForTimeout(3_000);
    const evidence = guard.evidence();
    if (evidence.guardAbortFailed) return result("GUARD_UNCERTAIN");
    if (evidence.publishAttemptCount === 1 && evidence.blockedPublishCount === 1 && evidence.publishRequest)
      return result("REQUEST_CAPTURED");
    return result("PUBLISH_REQUEST_NOT_TRIGGERED");
  } finally {
    if (editorPage && !editorPage.isClosed()) await editorPage.close().catch(() => undefined);
    context.off("response", onResponse);
    await context.unroute("**/*", guard.handle);
  }
}
