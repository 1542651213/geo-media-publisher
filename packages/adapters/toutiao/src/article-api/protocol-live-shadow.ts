import type { BrowserContext, Page, Request, Response, Route } from "playwright-core";
import { captureSafeProtocolObservation, type RawToutiaoShadowObservation, type SafeToutiaoProtocolObservation } from "./protocol-shadow";

export type ShadowRequestDecision = "READ_ONLY" | "NON_CONTENT_TELEMETRY" | "AUTH_TOKEN_BOOTSTRAP" | "DENY_ARTICLE_NEW" | "DENY_CONTENT_MUTATION" | "DENY_UNKNOWN_MUTATION" | "DENY_UNSAFE_URL";

/** A denied request is aborted at the BrowserContext route before the browser can dispatch it. */
export function classifyShadowRequest(method: string, rawUrl: string): ShadowRequestDecision {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return "DENY_UNSAFE_URL"; }
  if (url.protocol !== "https:" || url.username || url.password) return "DENY_UNSAFE_URL";
  let path: string;
  try { path = decodeURIComponent(url.pathname).toLowerCase(); } catch { return "DENY_UNSAFE_URL"; }
  const normalizedMethod = method.toUpperCase();
  if (/(?:^|\/)(?:article\/new)(?:\/|$)/u.test(path)) return "DENY_ARTICLE_NEW";
  const mutation = /^(?:create|save|update|delete|upload|publish|schedule|draft)$/u;
  if (path.split("/").some((part) => mutation.test(part))
    || ["action", "operation", "op", "cmd"].some((key) => mutation.test((url.searchParams.get(key) ?? "").toLowerCase()))) return "DENY_CONTENT_MUTATION";
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") return "READ_ONLY";
  if (normalizedMethod === "POST" && url.hostname.toLowerCase() === "mssdk.bytedance.com"
    && ["/web/r/token", "/web/common"].includes(path)) return "AUTH_TOKEN_BOOTSTRAP";
  if (normalizedMethod === "POST" && url.hostname.toLowerCase() === "mon.zijieapi.com" && /^\/(?:log|monitor)\//u.test(path)) return "NON_CONTENT_TELEMETRY";
  return "DENY_UNKNOWN_MUTATION";
}

export interface ToutiaoLiveShadowResult {
  readonly status: "CAPTURED" | "SESSION_DISCONNECTED";
  readonly observations: readonly SafeToutiaoProtocolObservation[];
  readonly cookieMetadata: SafeToutiaoProtocolObservation["cookies"];
  readonly signerGlobals: readonly string[];
  readonly pageHost: string | null;
  readonly pagePath: string | null;
  readonly guardedRequestCount: number;
  readonly nonContentTelemetryCount: number;
  readonly authTokenBootstrapCount: number;
  readonly remoteAuthState: "VALID" | "INVALID" | "UNKNOWN";
  readonly blockedArticleNewCount: number;
  readonly blockedContentMutationCount: number;
  readonly blockedUnknownMutationCount: number;
  readonly blockedRequestShapes: readonly Readonly<{ method: string; host: string; path: string; category: Exclude<ShadowRequestDecision, "READ_ONLY" | "NON_CONTENT_TELEMETRY" | "AUTH_TOKEN_BOOTSTRAP"> }> [];
}

function blockedRequestShape(method: string, rawUrl: string, category: Exclude<ShadowRequestDecision, "READ_ONLY" | "NON_CONTENT_TELEMETRY" | "AUTH_TOKEN_BOOTSTRAP">): ToutiaoLiveShadowResult["blockedRequestShapes"][number] {
  try {
    const url = new URL(rawUrl);
    const path = "/" + decodeURIComponent(url.pathname).split("/").slice(1, 5)
      .map((part) => /^[a-zA-Z_][\w.-]{0,40}$/u.test(part) ? part : "redactedSegment").join("/");
    const host = /^(?:[a-z0-9-]+\.)*(?:toutiao\.com|zijieapi\.com|bytedance\.com)$/u.test(url.hostname.toLowerCase()) ? url.hostname.toLowerCase() : "external";
    return { method: /^[A-Z]{1,8}$/u.test(method) ? method : "UNKNOWN", host, path, category };
  } catch { return { method: "UNKNOWN", host: "external", path: "/redactedSegment", category }; }
}

export function classifyCreatorSessionBody(body: unknown): "VALID" | "INVALID" | "UNKNOWN" {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "UNKNOWN";
  const value = body as Record<string, unknown>;
  if (value.code !== 0 || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) return "UNKNOWN";
  const isLogin = (value.data as Record<string, unknown>).is_login;
  return isLogin === true ? "VALID" : isLogin === false ? "INVALID" : "UNKNOWN";
}

function headerNamesOnly(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(headers).map((key) => [key, "present"]));
}

/** Only JSON-like finite responses are inspected, and no body is returned to the caller. */
export async function readBoundedResponseJson(response: Response, headers: Readonly<Record<string, string>>, timeoutMs = 1_500): Promise<unknown> {
  const type = headers["content-type"]?.toLowerCase() ?? "";
  const length = Number(headers["content-length"] ?? 0);
  if ((!type.includes("json") && !type.startsWith("text/plain")) || !Number.isFinite(length) || length > 512_000) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.json().catch(() => ({})),
      new Promise<unknown>((resolve) => { timer = setTimeout(() => resolve({}), timeoutMs); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function findToken(body: unknown, names: readonly string[], depth = 0): string | null {
  if (depth > 4 || !body || typeof body !== "object") return null;
  for (const [key, value] of Object.entries(body)) {
    if (names.some((name) => key.toLowerCase() === name.toLowerCase()) && typeof value === "string") return value;
    if (value && typeof value === "object") {
      const nested = findToken(value, names, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function safePageLocation(page: Page): { host: string | null; path: string | null } {
  try { const url = new URL(page.url()); return { host: url.hostname.toLowerCase(), path: url.pathname }; } catch { return { host: null, path: null }; }
}

/** The caller must first verify account ownership and an ACTIVE app-owned canonical Page. */
export async function runReadOnlyToutiaoProtocolShadow(context: BrowserContext, page: Page): Promise<ToutiaoLiveShadowResult> {
  if (page.isClosed() || page.context() !== context || safePageLocation(page).host !== "mp.toutiao.com") throw new Error("TOUTIAO_SHADOW_SESSION_UNAVAILABLE");
  // Playwright routing cannot guard traffic owned by a pre-existing Service Worker.
  if (context.serviceWorkers().length > 0) throw new Error("TOUTIAO_SHADOW_SERVICE_WORKER_UNGUARDED");
  const guarded = new WeakSet<Request>();
  const observations: SafeToutiaoProtocolObservation[] = [];
  const pending = new Set<Promise<void>>();
  let guardedRequestCount = 0;
  let nonContentTelemetryCount = 0;
  let authTokenBootstrapCount = 0;
  let remoteAuthState: "VALID" | "INVALID" | "UNKNOWN" = "UNKNOWN";
  let blockedArticleNewCount = 0;
  let blockedContentMutationCount = 0;
  let blockedUnknownMutationCount = 0;
  const blockedRequestShapes: Array<ToutiaoLiveShadowResult["blockedRequestShapes"][number]> = [];
  const guard = async (route: Route): Promise<void> => {
    const request = route.request();
    const decision = classifyShadowRequest(request.method(), request.url());
    if (decision === "READ_ONLY" || decision === "NON_CONTENT_TELEMETRY" || decision === "AUTH_TOKEN_BOOTSTRAP") {
      guarded.add(request);
      guardedRequestCount += 1;
      if (decision === "NON_CONTENT_TELEMETRY") nonContentTelemetryCount += 1;
      if (decision === "AUTH_TOKEN_BOOTSTRAP") authTokenBootstrapCount += 1;
      await route.continue();
      return;
    }
    if (decision === "DENY_ARTICLE_NEW") blockedArticleNewCount += 1;
    else if (decision === "DENY_CONTENT_MUTATION") blockedContentMutationCount += 1;
    else blockedUnknownMutationCount += 1;
    if (blockedRequestShapes.length < 60) blockedRequestShapes.push(blockedRequestShape(request.method(), request.url(), decision));
    await route.abort("blockedbyclient");
  };
  // Install the write guard first. Only responses to routed requests may be recorded.
  await context.route("**/*", guard);
  const onResponse = (response: Response): void => {
    const request = response.request();
    if (!guarded.has(request) || observations.length + pending.size >= 60) return;
    const work = (async (): Promise<void> => {
      const decision = classifyShadowRequest(request.method(), request.url());
      if (decision !== "READ_ONLY" && decision !== "AUTH_TOKEN_BOOTSTRAP") return;
      if (decision === "READ_ONLY" && !["GET", "OPTIONS"].includes(request.method())) return;
      let url: URL;
      try { url = new URL(request.url()); } catch { return; }
      if (!["mp.toutiao.com", "mssdk.bytedance.com"].includes(url.hostname.toLowerCase())) return;
      const requestHeaders = await request.allHeaders();
      const responseHeaders = await response.allHeaders();
      const responseBody = await readBoundedResponseJson(response, responseHeaders);
      if (url.pathname === "/mp/agw/media/user_login_status_api") {
        const observedAuth = classifyCreatorSessionBody(responseBody);
        if (observedAuth !== "UNKNOWN") remoteAuthState = observedAuth;
      }
      const antiToken = findToken(responseBody, ["tt-anti-token", "antiToken"])
        ?? (url.pathname.includes("tt-anti-token") ? findToken(responseBody, ["token"]) : null);
      const input: RawToutiaoShadowObservation = {
        source: "AUTHORIZED_SHADOW_CAPTURE", capturedAt: new Date().toISOString(), url: request.url(),
        method: request.method(), status: response.status(),
        requestHeaders, responseHeaders: headerNamesOnly(responseHeaders), responseBody,
        ...(decision === "AUTH_TOKEN_BOOTSTRAP" ? { requestBody: request.postDataBuffer() } : {}),
        cookies: [], tokenCandidates: {
          csrf: responseHeaders["x-secsdk-csrf-token"] ?? requestHeaders["x-secsdk-csrf-token"] ?? null,
          antiToken: antiToken ?? responseHeaders["tt-anti-token"] ?? null,
          msToken: url.searchParams.get("msToken") ?? findToken(responseBody, ["msToken"])
            ?? (decision === "AUTH_TOKEN_BOOTSTRAP" ? findToken(responseBody, ["token"]) : null),
          aBogus: url.searchParams.get("a_bogus")
        }
      };
      try { observations.push(captureSafeProtocolObservation(input)); } catch { /* Unsafe endpoints are never included. */ }
    })();
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
  };
  context.on("response", onResponse);
  try {
    // Browser-native probe only inspects own-property descriptors; it never invokes a signer.
    const signerGlobals = await page.evaluate(() => ["byted_acrawler", "_byted_acrawler", "__acrawler"].filter((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      return descriptor !== undefined && typeof descriptor.value === "object" && descriptor.value !== null;
    }));
    const rawCookies = await context.cookies();
    const cookieMetadata = captureSafeProtocolObservation({
      source: "AUTHORIZED_SHADOW_CAPTURE", capturedAt: new Date().toISOString(), url: "https://mp.toutiao.com/profile_v4/index",
      method: "GET", status: 200, requestHeaders: {}, responseHeaders: {}, responseBody: {},
      cookies: rawCookies.map((cookie) => ({ name: cookie.name, domain: cookie.domain, path: cookie.path,
        secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite })), tokenCandidates: {}
    }).cookies;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(5_000);
    await Promise.allSettled([...pending]);
    const location = safePageLocation(page);
    return { status: page.isClosed() || location.host !== "mp.toutiao.com" ? "SESSION_DISCONNECTED" : "CAPTURED",
      observations, cookieMetadata, signerGlobals, pageHost: location.host, pagePath: location.path,
      guardedRequestCount, nonContentTelemetryCount, authTokenBootstrapCount, remoteAuthState,
      blockedArticleNewCount, blockedContentMutationCount, blockedUnknownMutationCount, blockedRequestShapes };
  } finally {
    context.off("response", onResponse);
    await context.unroute("**/*", guard);
  }
}
