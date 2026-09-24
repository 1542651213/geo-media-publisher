import type { BrowserContext, Page, Request, Response, Route } from "playwright-core";
import { captureSafeProtocolObservation, protocolKeyShape, safeProtocolName, type RawToutiaoShadowObservation, type SafeToutiaoProtocolObservation } from "./protocol-shadow";
import { inspectProtocolScript, inspectRuntimeSdkSurface, type SafeProtocolScriptEvidence, type SafeRuntimeSdkSurface } from "./protocol-script-discovery";
import { probeAcrCrawlerSignInPage } from "./protocol-signer-contract";
import { probeAcrCrawlerInputContractInPage } from "./protocol-signer-input-probe";
import { describeReadonlyBrowserRequest, replayCapturedReadonlyGet, type BrowserGeneratedReadonlyRequest, type SafeBrowserGeneratedRequestShape, type SafeReadonlyReplayResult } from "./protocol-request-bridge";
import { inspectAcrCrawlerRuntime, type SafeAcrCrawlerRuntimeEvidence } from "./protocol-acrawler-runtime";

export const TOUTIAO_GUARDED_EDITOR_URL = "https://mp.toutiao.com/profile_v4/graphic/publish";

export function isSafeCreatorHomePath(path: string): boolean {
  return path === "/" || path === "/profile_v4/" || path === "/profile_v4/index" || path === "/profile_v4/index/";
}

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
  // This exact route serves the editor front-end document. No query or mutating method is permitted.
  if (normalizedMethod === "GET" && url.origin === "https://mp.toutiao.com"
    && path === "/profile_v4/graphic/publish" && !url.search && !url.hash) return "READ_ONLY";
  const mutation = /^(?:create|save|update|delete|upload|publish|schedule|draft)$/u;
  if (path.split("/").some((part) => mutation.test(part))
    || ["action", "operation", "op", "cmd"].some((key) => mutation.test((url.searchParams.get(key) ?? "").toLowerCase()))) return "DENY_CONTENT_MUTATION";
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") return "READ_ONLY";
  if (normalizedMethod === "POST" && url.hostname.toLowerCase() === "mssdk.bytedance.com"
    && ["/web/r/token", "/web/common"].includes(path)) return "AUTH_TOKEN_BOOTSTRAP";
  if (normalizedMethod === "POST" && url.hostname.toLowerCase() === "mon.zijieapi.com" && /^\/(?:log|monitor)\//u.test(path)) return "NON_CONTENT_TELEMETRY";
  return "DENY_UNKNOWN_MUTATION";
}

/** A diagnostic-only exception. The ordinary Shadow classifier always denies this endpoint. */
function isExactControlledArticleNewGet(method: string, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return method.toUpperCase() === "GET" && url.origin === "https://mp.toutiao.com"
      && decodeURIComponent(url.pathname) === "/mp/agw/article/new" && !url.hash
      && ![...url.searchParams.keys()].some((key) => /^(?:create|save|update|delete|upload|publish|schedule|draft|action|operation|op|cmd)$/iu.test(key));
  } catch { return false; }
}

export interface SafeControlledArticleNewCapture {
  readonly method: "GET";
  readonly host: "mp.toutiao.com";
  readonly endpointPath: "/mp/agw/article/new";
  readonly status: number;
  readonly queryParameterNames: readonly string[];
  readonly requestHeaderNames: readonly string[];
  readonly responseHeaderNames: readonly string[];
  readonly requestBodyKeyNames: readonly string[];
  readonly requestBodySha256: null;
  readonly responseKeyShape: readonly string[];
  readonly remoteObjectPossible: boolean;
}

function safeControlledArticleNewCapture(request: Request, status: number, requestHeaders: Record<string, string>,
  responseHeaders: Record<string, string>, body: unknown): SafeControlledArticleNewCapture {
  if (!isExactControlledArticleNewGet(request.method(), request.url())) throw new Error("UNSAFE_ARTICLE_NEW_CAPTURE");
  const url = new URL(request.url());
  const names = (headers: Record<string, string>) => [...new Set(Object.keys(headers).map((key) => safeProtocolName(key.toLowerCase())))].sort();
  const responseKeyShape = protocolKeyShape(body);
  return { method: "GET", host: "mp.toutiao.com", endpointPath: "/mp/agw/article/new", status,
    queryParameterNames: [...new Set([...url.searchParams.keys()].map(safeProtocolName))].sort(),
    requestHeaderNames: names(requestHeaders), responseHeaderNames: names(responseHeaders),
    requestBodyKeyNames: [], requestBodySha256: null, responseKeyShape,
    remoteObjectPossible: responseKeyShape.some((key) => /(?:^|\.)(?:pgc_id|article_id|draft_id|media_id|item_id|group_id)$/iu.test(key)) };
}

export interface ToutiaoLiveShadowResult {
  readonly status: "CAPTURED" | "SESSION_DISCONNECTED";
  readonly observations: readonly SafeToutiaoProtocolObservation[];
  readonly cookieMetadata: SafeToutiaoProtocolObservation["cookies"];
  readonly signerGlobals: readonly string[];
  readonly runtimeGlobals: readonly Readonly<{ name: string; kind: string; arity: number | null }> [];
  readonly runtimeSdkSurfaces: readonly SafeRuntimeSdkSurface[];
  readonly sdkRuntime: Readonly<{ home: SafeAcrCrawlerRuntimeEvidence; editor: SafeAcrCrawlerRuntimeEvidence }> | null;
  readonly scripts: readonly SafeProtocolScriptEvidence[];
  readonly loadedScriptCount: number;
  readonly discoveryMode: "HOME" | "EDITOR" | "SIGNER_CONTRACT" | "SIGNER_INPUT" | "BRIDGE" | "CONTROLLED_ARTICLE_NEW";
  readonly articleNewAllowedCount: number;
  readonly articleNewCapture: SafeControlledArticleNewCapture | null;
  readonly requestBridge: Readonly<{ capture: SafeBrowserGeneratedRequestShape | null; replay: SafeReadonlyReplayResult | null }> | null;
  readonly signerContract: Awaited<ReturnType<typeof probeAcrCrawlerSignInPage>> | null;
  readonly signerInputContract: Awaited<ReturnType<typeof probeAcrCrawlerInputContractInPage>> | null;
  readonly signerProbeNetworkRequestDelta: number | null;
  readonly signerProbeCookieMetadataChanged: boolean | null;
  readonly signerProbeRequestShapes: readonly Readonly<{ method: string; host: string; path: string; category: ShadowRequestDecision }> [];
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

function safeRequestShape<T extends ShadowRequestDecision>(method: string, rawUrl: string, category: T): Readonly<{ method: string; host: string; path: string; category: T }> {
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
export async function runReadOnlyToutiaoProtocolShadow(context: BrowserContext, page: Page, options: Readonly<{
  mode?: "HOME" | "EDITOR" | "SIGNER_CONTRACT" | "SIGNER_INPUT" | "BRIDGE" | "CONTROLLED_ARTICLE_NEW";
  replayTransport?: (url: string, init: RequestInit) => Promise<globalThis.Response>;
}> = {}): Promise<ToutiaoLiveShadowResult> {
  const initialLocation = safePageLocation(page);
  if (page.isClosed() || page.context() !== context || initialLocation.host !== "mp.toutiao.com"
    || !isSafeCreatorHomePath(initialLocation.path ?? "")) throw new Error("TOUTIAO_SHADOW_SESSION_UNAVAILABLE");
  // Playwright routing cannot guard traffic owned by a pre-existing Service Worker.
  if (context.serviceWorkers().length > 0) throw new Error("TOUTIAO_SHADOW_SERVICE_WORKER_UNGUARDED");
  const guarded = new WeakSet<Request>();
  const allowedArticleNew = new WeakSet<Request>();
  const controlledArticleNew = options.mode === "CONTROLLED_ARTICLE_NEW";
  let articleNewArmed = false;
  let articleNewAllowedCount = 0;
  let articleNewCapture: SafeControlledArticleNewCapture | null = null;
  let notifyArticleNewResponse: (() => void) | null = null;
  const articleNewResponse = new Promise<void>((resolve) => { notifyArticleNewResponse = resolve; });
  const observations: SafeToutiaoProtocolObservation[] = [];
  const scripts: SafeProtocolScriptEvidence[] = [];
  const pending = new Set<Promise<void>>();
  let guardedRequestCount = 0;
  let nonContentTelemetryCount = 0;
  let authTokenBootstrapCount = 0;
  let remoteAuthState: "VALID" | "INVALID" | "UNKNOWN" = "UNKNOWN";
  const currentRemoteAuthState = (): "VALID" | "INVALID" | "UNKNOWN" => remoteAuthState;
  const bridgeCandidate: { value: Readonly<{ request: BrowserGeneratedReadonlyRequest; browser: Readonly<{ status: number; authState: "VALID" | "INVALID" | "UNKNOWN" }> }> | null } = { value: null };
  let blockedArticleNewCount = 0;
  let blockedContentMutationCount = 0;
  let blockedUnknownMutationCount = 0;
  const blockedRequestShapes: Array<ToutiaoLiveShadowResult["blockedRequestShapes"][number]> = [];
  const signerProbeRequestShapes: Array<ToutiaoLiveShadowResult["signerProbeRequestShapes"][number]> = [];
  let signerProbeRunning = false;
  const guard = async (route: Route): Promise<void> => {
    const request = route.request();
    const decision = classifyShadowRequest(request.method(), request.url());
    if (controlledArticleNew && articleNewArmed && articleNewAllowedCount === 0
      && decision === "DENY_ARTICLE_NEW" && isExactControlledArticleNewGet(request.method(), request.url())) {
      // Consume the one-shot permit before dispatch. A failed or timed-out request is never retried.
      articleNewArmed = false;
      articleNewAllowedCount = 1;
      guarded.add(request);
      allowedArticleNew.add(request);
      guardedRequestCount += 1;
      await route.continue();
      return;
    }
    if (signerProbeRunning && signerProbeRequestShapes.length < 40)
      signerProbeRequestShapes.push(safeRequestShape(request.method(), request.url(), decision));
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
    if (blockedRequestShapes.length < 60) blockedRequestShapes.push(safeRequestShape(request.method(), request.url(), decision));
    await route.abort("blockedbyclient");
  };
  // Install the write guard first. Only responses to routed requests may be recorded.
  await context.route("**/*", guard);
  const onResponse = (response: Response): void => {
    const request = response.request();
    if (!guarded.has(request)) return;
    const isArticleNew = allowedArticleNew.has(request);
    if (isArticleNew) notifyArticleNewResponse?.();
    if (scripts.length < 100) {
      const scriptWork = (async (): Promise<void> => {
        let url: URL;
        try { url = new URL(request.url()); } catch { return; }
        if (request.method() !== "GET" || !/\.m?js$/iu.test(url.pathname)) return;
        const headers = await response.allHeaders();
        const length = Number(headers["content-length"] ?? 0);
        if (!Number.isFinite(length) || length > 12_000_000) return;
        const bytes = await Promise.race([response.body(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000))]);
        if (!bytes) return;
        const evidence = inspectProtocolScript(request.url(), bytes);
        if (evidence && scripts.length < 100) scripts.push(evidence);
      })().catch(() => undefined);
      pending.add(scriptWork);
      void scriptWork.then(() => pending.delete(scriptWork));
    }
    if (observations.length + pending.size >= 80) return;
    const work = (async (): Promise<void> => {
      if (isArticleNew) {
        const requestHeaders = await request.allHeaders();
        const responseHeaders = await response.allHeaders();
        const responseBody = await readBoundedResponseJson(response, responseHeaders);
        articleNewCapture = safeControlledArticleNewCapture(request, response.status(), requestHeaders, responseHeaders, responseBody);
        return;
      }
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
        if (options.mode === "BRIDGE" && request.method() === "GET" && bridgeCandidate.value === null) {
          const capturedRequest = { method: "GET", url: request.url(), headers: requestHeaders };
          if (describeReadonlyBrowserRequest(capturedRequest)) bridgeCandidate.value = {
            request: capturedRequest, browser: { status: response.status(), authState: observedAuth }
          };
        }
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
  let editorPage: Page | null = null;
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
    const mode = options.mode ?? "HOME";
    const sdkRuntimeHome = mode === "EDITOR" ? await inspectAcrCrawlerRuntime(page) : null;
    let inspectedPage = page;
    if (controlledArticleNew) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForTimeout(1_000);
      await Promise.allSettled([...pending]);
      if (currentRemoteAuthState() !== "VALID") throw new Error("TOUTIAO_SHADOW_AUTH_UNVERIFIED");
    }
    if (mode === "EDITOR" || mode === "SIGNER_CONTRACT" || mode === "SIGNER_INPUT" || controlledArticleNew) {
      editorPage = await context.newPage();
      inspectedPage = editorPage;
      if (controlledArticleNew) articleNewArmed = true;
      try { await editorPage.goto(TOUTIAO_GUARDED_EDITOR_URL, { waitUntil: "domcontentloaded", timeout: 20_000 }); }
      catch { /* Guarded article/new may prevent editor initialization; scripts remain observable. */ }
    } else await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    if (controlledArticleNew) await Promise.race([articleNewResponse, inspectedPage.waitForTimeout(5_000)]);
    else await inspectedPage.waitForTimeout(5_000);
    articleNewArmed = false;
    if (mode === "EDITOR" || mode === "SIGNER_CONTRACT" || mode === "SIGNER_INPUT" || controlledArticleNew) {
      const editorLocation = safePageLocation(inspectedPage);
      if (editorLocation.host !== "mp.toutiao.com" || editorLocation.path !== "/profile_v4/graphic/publish")
        throw new Error("TOUTIAO_SHADOW_EDITOR_ROUTE_UNAVAILABLE");
    }
    await Promise.allSettled([...pending]);
    const runtimeGlobals = await inspectedPage.evaluate(() => Object.getOwnPropertyNames(window)
      .filter((name) => /acrawler|secsdk|mssdk|webpack|rspack|vite|sign/iu.test(name) && /^[a-zA-Z_$][\w$]{0,79}$/u.test(name))
      .slice(0, 40).map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(window, name);
        const value = descriptor && "value" in descriptor ? descriptor.value as unknown : undefined;
        return { name, kind: typeof value, arity: typeof value === "function" ? value.length : null };
      }));
    const runtimeSdkSurfaces = (await Promise.all(["byted_acrawler", "secsdk"].map((name) =>
      inspectedPage.evaluate(inspectRuntimeSdkSurface, name as SafeRuntimeSdkSurface["name"]))))
      .filter((surface): surface is SafeRuntimeSdkSurface => Boolean(surface) && !Array.isArray(surface));
    const sdkRuntime = sdkRuntimeHome ? { home: sdkRuntimeHome, editor: await inspectAcrCrawlerRuntime(inspectedPage) } : null;
    const observedScriptCount = await inspectedPage.evaluate(() => document.scripts.length);
    const loadedScriptCount = typeof observedScriptCount === "number" ? observedScriptCount : scripts.length;
    let requestBridge: ToutiaoLiveShadowResult["requestBridge"] = null;
    if (mode === "BRIDGE") {
      const candidate = bridgeCandidate.value;
      requestBridge = candidate ? {
        capture: describeReadonlyBrowserRequest(candidate.request),
        replay: await replayCapturedReadonlyGet(candidate.request, candidate.browser, options.replayTransport)
      } : { capture: null, replay: null };
    }
    let signerContract: ToutiaoLiveShadowResult["signerContract"] = null;
    let signerInputContract: ToutiaoLiveShadowResult["signerInputContract"] = null;
    let signerProbeNetworkRequestDelta: number | null = null;
    let signerProbeCookieMetadataChanged: boolean | null = null;
    if (mode === "SIGNER_CONTRACT" || mode === "SIGNER_INPUT") {
      if (context.serviceWorkers().length > 0 || inspectedPage.isClosed()) throw new Error("TOUTIAO_SHADOW_SIGNER_GUARD_UNAVAILABLE");
      const cookieShape = (cookies: Awaited<ReturnType<BrowserContext["cookies"]>>) => JSON.stringify(cookies.map((cookie) =>
        [cookie.name, cookie.domain, cookie.path, cookie.secure, cookie.httpOnly, cookie.sameSite, cookie.expires > 0]).sort());
      const beforeCookies = cookieShape(await context.cookies());
      const beforeRequests = guardedRequestCount + blockedArticleNewCount + blockedContentMutationCount + blockedUnknownMutationCount;
      signerProbeRunning = true;
      if (mode === "SIGNER_INPUT") signerInputContract = await inspectedPage.evaluate(probeAcrCrawlerInputContractInPage);
      else signerContract = await inspectedPage.evaluate(probeAcrCrawlerSignInPage);
      // Keep the route active briefly for any request queued by the synchronous SDK call.
      await inspectedPage.waitForTimeout(1_000);
      signerProbeRunning = false;
      signerProbeNetworkRequestDelta = guardedRequestCount + blockedArticleNewCount + blockedContentMutationCount + blockedUnknownMutationCount - beforeRequests;
      signerProbeCookieMetadataChanged = beforeCookies !== cookieShape(await context.cookies());
    }
    const location = safePageLocation(page);
    return { status: page.isClosed() || location.host !== "mp.toutiao.com" || !isSafeCreatorHomePath(location.path ?? "") ? "SESSION_DISCONNECTED" : "CAPTURED",
      observations, cookieMetadata, signerGlobals, runtimeGlobals, runtimeSdkSurfaces, sdkRuntime, scripts, loadedScriptCount, discoveryMode: mode,
      requestBridge, signerContract, signerInputContract, signerProbeNetworkRequestDelta, signerProbeCookieMetadataChanged, signerProbeRequestShapes,
      articleNewAllowedCount, articleNewCapture,
      pageHost: location.host, pagePath: location.path,
      guardedRequestCount, nonContentTelemetryCount, authTokenBootstrapCount, remoteAuthState,
      blockedArticleNewCount, blockedContentMutationCount, blockedUnknownMutationCount, blockedRequestShapes };
  } finally {
    if (editorPage && !editorPage.isClosed()) await editorPage.close().catch(() => undefined);
    context.off("response", onResponse);
    await context.unroute("**/*", guard);
  }
}
