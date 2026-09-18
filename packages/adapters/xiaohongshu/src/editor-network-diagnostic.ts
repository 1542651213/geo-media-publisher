import type { CDPSession, ConsoleMessage, Page } from "playwright-core";
import { isExactXhsPublishEditorRoute, redactXhsDiagnosticText, sanitizeXhsEditorDiagnosticUrl, truncateXhsDiagnosticText, type XhsDiagnosticUrlParts } from "./editor-load-diagnostic";

const MAX_FAILED_FETCHES = 100;
const MAX_ENDPOINT_GROUPS = 50;
const MAX_TEXT_LENGTH = 500;
const MAX_EXTENSION_PATH_LENGTH = 256;
const MAX_WAIT_MS = 30_000;
const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_RELOAD_COMMIT_TIMEOUT_MS = 15_000;
const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;

export type XhsEditorNetworkRootCauseClass =
  | "A_CORS_OR_PREFLIGHT_FAILURE"
  | "B_CLIENT_OR_CHROMIUM_BLOCK"
  | "C_TLS_OR_CERTIFICATE_FAILURE"
  | "D_PROXY_OR_NETWORK_CONFIGURATION_FAILURE"
  | "E_DNS_OR_CONNECTION_FAILURE"
  | "F_REQUEST_ABORTED_BY_PAGE_RUNTIME"
  | "G_SERVICE_WORKER_RUNTIME_FAILURE"
  | "H_PLATFORM_BOOTSTRAP_API_HTTP_FAILURE"
  | "I_PLATFORM_JS_FETCH_FAILURE_WITHOUT_NETWORK_DETAIL"
  | "J_TRANSIENT_FAILURE_RECOVERED_AFTER_SINGLE_RELOAD"
  | "K_UNKNOWN_NET_ERR_FAILED_AFTER_DEEP_DIAGNOSTIC";

export type XhsEditorRequestUrlScheme = "https" | "http" | "blob" | "data" | "file" | "chrome" | "chrome-extension" | "about" | "ws" | "wss" | "other";
export type XhsEditorRequestUrlClass = "HTTP_NETWORK_REQUEST" | "BLOB_RESOURCE" | "DATA_RESOURCE" | "FILE_RESOURCE" | "BROWSER_INTERNAL_RESOURCE" | "EXTENSION_RESOURCE" | "MALFORMED_OR_UNPARSEABLE" | "OTHER_NON_HTTP";
export type XhsEditorRequestHostCategory = "xiaohongshu_creator" | "xiaohongshu_other" | "third_party" | "localhost" | "none" | "unknown";
export type XhsEditorRequestPathShape = "root" | "api_like" | "publish_route" | "home_route" | "blank" | "opaque" | "non_root" | "malformed";

export interface XhsSafeUrlClassification {
  urlScheme: XhsEditorRequestUrlScheme;
  urlClass: XhsEditorRequestUrlClass;
  hostPresent: boolean;
  hostCategory: XhsEditorRequestHostCategory;
  pathShape: XhsEditorRequestPathShape;
  safeOrigin: string | null;
  safePathname: string | null;
}

export interface XhsSafeInitiatorFrame {
  scriptUrlScheme: XhsEditorRequestUrlScheme;
  safeOriginCategory: XhsEditorRequestHostCategory;
  pathname: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
}

export interface XhsSafeInitiator {
  type: "parser" | "script" | "preload" | "SignedExchange" | "preflight" | "other";
  frames: readonly XhsSafeInitiatorFrame[];
}

export interface XhsEditorNetworkDiagnosticMetadata {
  operationId: string;
  accountId: string;
  contextDebugId: string;
  pageDebugId: string;
}

export interface XhsSafeCorsErrorStatus {
  corsError: string | null;
  failedParameter: string | null;
}

export interface XhsSafeFailedNetworkRequest {
  requestId: string;
  method: string;
  resourceType: "xhr" | "fetch";
  origin: string | null;
  pathname: string | null;
  responseObserved: boolean;
  httpStatus: number | null;
  errorText: string | null;
  blockedReason: string | null;
  corsErrorStatus: XhsSafeCorsErrorStatus | null;
  canceled: boolean;
  fromServiceWorker: boolean | null;
  urlScheme: XhsEditorRequestUrlScheme;
  urlClass: XhsEditorRequestUrlClass;
  extensionId: string | null;
  extensionPathname: string | null;
  hostPresent: boolean;
  hostCategory: XhsEditorRequestHostCategory;
  pathShape: XhsEditorRequestPathShape;
  initiatorType: XhsSafeInitiator["type"];
  initiatorSafe: XhsSafeInitiator;
}

export interface XhsSafeFailedNetworkEndpointGroup {
  method: string;
  resourceType: "xhr" | "fetch";
  origin: string | null;
  pathname: string | null;
  occurrenceCount: number;
  requestIds: readonly string[];
  responseObservedCount: number;
  httpStatuses: readonly number[];
}

export interface XhsSafeNetworkConsoleError {
  level: "error" | "warning";
  text: string;
}

export type XhsServiceWorkerInvolvement = "OBSERVED" | "NOT_OBSERVED" | "UNAVAILABLE";

export interface XhsEditorNetworkCauseEvidence {
  failedFetches: readonly Partial<XhsSafeFailedNetworkRequest>[];
  bootstrapHttpStatuses?: readonly number[];
  pageErrorCount: number;
  consoleErrorCount: number;
  serviceWorkerInvolvement: XhsServiceWorkerInvolvement;
  reloadRecovered: boolean;
  readyStateComplete: boolean;
}

export type XhsEditorBootstrapFailureClass =
  | "A_HTTP_NETWORK_FETCH_FAILURE"
  | "B_BLOB_FETCH_FAILURE"
  | "C_DATA_OR_FILE_FETCH_FAILURE"
  | "D_BROWSER_INTERNAL_REQUEST_FAILURE"
  | "E_EXTENSION_INTERFERENCE"
  | "F_MALFORMED_REQUEST_URL"
  | "G_SANITIZER_OR_DIAGNOSTIC_PARSER_BUG"
  | "H_XHS_SCRIPT_INITIATED_OPAQUE_FETCH_FAILURE"
  | "I_OTHER_PROVEN_CLASS"
  | "J_STILL_UNKNOWN_AFTER_URL_CLASSIFICATION";

export interface XhsEditorNetworkDiagnosticResult {
  status: "COMPLETED" | "BLOCKED";
  operationId: string;
  accountId: string;
  canonicalContextId: string;
  canonicalPageId: string;
  diagnosticListenersAttached: boolean;
  networkDomainEnabled: boolean;
  reloadCount: number;
  currentPageUrl: XhsDiagnosticUrlParts;
  domLocationHref: XhsDiagnosticUrlParts;
  documentReadyStateFinal: "loading" | "interactive" | "complete" | "EVALUATE_FAILED";
  existingUserDraftDetected: boolean;
  requestWillBeSentCount: number;
  responseReceivedCount: number;
  loadingFailedCount: number;
  failedFetchesSafe: readonly XhsSafeFailedNetworkRequest[];
  failedFetchEndpointGroups: readonly XhsSafeFailedNetworkEndpointGroup[];
  bootstrapHttpFailure: boolean;
  bootstrapHttpStatuses: readonly number[];
  serviceWorkerInvolvement: XhsServiceWorkerInvolvement;
  serviceWorkerOrigins: readonly string[];
  serviceWorkerCount: number | null;
  commonInitiator: boolean;
  commonInitiatorSafe: XhsSafeInitiator | null;
  commonInitiatorSafePathname: string | null;
  bootstrapApiFailure: "PROVEN" | "NOT_PROVEN";
  bootstrapFailureClass: XhsEditorBootstrapFailureClass | null;
  consoleErrorCount: number;
  consoleErrorsSafe: readonly XhsSafeNetworkConsoleError[];
  pageErrorCount: number;
  pageErrorsSafe: readonly string[];
  reloadErrorSafe: string | null;
  rootCauseClass: XhsEditorNetworkRootCauseClass | null;
  rootCauseEvidence: readonly string[];
  diagnosticFailure: string | null;
}

export interface XhsEditorNetworkDiagnosticOptions {
  /** Test-only bounded wait override. Production callers never forward user input. */
  maxWaitMs?: number;
  /** Test-only reload timeout override. */
  reloadCommitTimeoutMs?: number;
  /** Test-only CDP injection; production resolves it from the current Page Context. */
  cdpSession?: CDPSession;
  now?: () => string;
}

interface CdpSessionLike {
  on(event: string, listener: (payload: unknown) => void): CdpSessionLike;
  off(event: string, listener: (payload: unknown) => void): CdpSessionLike;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<void>;
}

interface MutableFailedNetworkRequest {
  requestId: string;
  method: string;
  resourceType: "xhr" | "fetch";
  origin: string | null;
  pathname: string | null;
  responseObserved: boolean;
  httpStatus: number | null;
  errorText: string | null;
  blockedReason: string | null;
  corsErrorStatus: XhsSafeCorsErrorStatus | null;
  canceled: boolean;
  fromServiceWorker: boolean | null;
  failed: boolean;
  urlClassification: XhsSafeUrlClassification;
  extensionId: string | null;
  extensionPathname: string | null;
  initiatorSafe: XhsSafeInitiator;
}

interface FixedPageNetworkSnapshot {
  href: string;
  readyState: string;
}

interface ServiceWorkerSnapshot {
  status: XhsServiceWorkerInvolvement;
  origins: readonly string[];
  count: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeValue(value: string | null): string | null {
  return value ? truncateXhsDiagnosticText(redactXhsDiagnosticText(value), MAX_TEXT_LENGTH) : null;
}

function safeRequestId(value: string | null): string {
  return truncateXhsDiagnosticText(value ?? "unknown-request", 160);
}

function networkType(value: string | null): "xhr" | "fetch" | null {
  if (value === "XHR") return "xhr";
  if (value === "Fetch") return "fetch";
  return null;
}

function method(value: string | null): string {
  if (!value) return "UNKNOWN";
  const normalized = value.toUpperCase().replace(/[^A-Z]/gu, "");
  return truncateXhsDiagnosticText(normalized || "UNKNOWN", 16);
}

function safeStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999 ? value : null;
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function allowedUrlScheme(protocol: string): XhsEditorRequestUrlScheme {
  const scheme = protocol.toLowerCase();
  return scheme === "https" || scheme === "http" || scheme === "blob" || scheme === "data" || scheme === "file" || scheme === "chrome" || scheme === "chrome-extension" || scheme === "about" || scheme === "ws" || scheme === "wss" ? scheme : "other";
}

function hostCategory(hostname: string | null): XhsEditorRequestHostCategory {
  const host = hostname?.toLowerCase() ?? "";
  if (!host) return "none";
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "localhost";
  if (host === "creator.xiaohongshu.com") return "xiaohongshu_creator";
  if (host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com")) return "xiaohongshu_other";
  return "third_party";
}

export interface XhsSafeExtensionResourceIdentity {
  extensionId: string | null;
  pathname: string | null;
}

export function extractSafeExtensionResourceIdentity(rawUrl: string | null): XhsSafeExtensionResourceIdentity {
  if (!rawUrl) return { extensionId: null, pathname: null };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { extensionId: null, pathname: null };
  }
  if (parsed.protocol.toLowerCase() !== "chrome-extension:") return { extensionId: null, pathname: null };
  const extensionId = parsed.hostname.toLowerCase();
  if (!CHROME_EXTENSION_ID_PATTERN.test(extensionId)) return { extensionId: null, pathname: null };
  const pathname = truncateXhsDiagnosticText(redactXhsDiagnosticText(parsed.pathname || "/"), MAX_EXTENSION_PATH_LENGTH);
  return { extensionId, pathname };
}

function pathShape(pathname: string, urlClass: XhsEditorRequestUrlClass): XhsEditorRequestPathShape {
  if (urlClass === "BLOB_RESOURCE" || urlClass === "DATA_RESOURCE" || urlClass === "OTHER_NON_HTTP") return "opaque";
  if (urlClass === "MALFORMED_OR_UNPARSEABLE") return "malformed";
  if (urlClass === "BROWSER_INTERNAL_RESOURCE" && pathname === "blank") return "blank";
  if (!pathname || pathname === "/") return "root";
  if (/^\/api(?:\/|$)/iu.test(pathname)) return "api_like";
  if (pathname === "/publish/publish") return "publish_route";
  if (pathname === "/new/home") return "home_route";
  return "non_root";
}

function nestedBlobUrl(rawUrl: string): URL | null {
  if (!rawUrl.toLowerCase().startsWith("blob:")) return null;
  try {
    return new URL(rawUrl.slice(5));
  } catch {
    return null;
  }
}

export function classifyXhsEditorRequestUrl(rawUrl: string | null): XhsSafeUrlClassification {
  if (!rawUrl) return { urlScheme: "other", urlClass: "MALFORMED_OR_UNPARSEABLE", hostPresent: false, hostCategory: "unknown", pathShape: "malformed", safeOrigin: null, safePathname: null };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { urlScheme: "other", urlClass: "MALFORMED_OR_UNPARSEABLE", hostPresent: false, hostCategory: "unknown", pathShape: "malformed", safeOrigin: null, safePathname: null };
  }
  const urlScheme = allowedUrlScheme(parsed.protocol.slice(0, -1));
  const urlClass: XhsEditorRequestUrlClass = urlScheme === "http" || urlScheme === "https"
    ? "HTTP_NETWORK_REQUEST"
    : urlScheme === "blob" ? "BLOB_RESOURCE"
      : urlScheme === "data" ? "DATA_RESOURCE"
        : urlScheme === "file" ? "FILE_RESOURCE"
          : urlScheme === "chrome" || urlScheme === "about" ? "BROWSER_INTERNAL_RESOURCE"
            : urlScheme === "chrome-extension" ? "EXTENSION_RESOURCE"
              : "OTHER_NON_HTTP";
  const nested = nestedBlobUrl(rawUrl);
  const host = nested ? nested.hostname : parsed.hostname;
  const category = hostCategory(host || null);
  const hostPresent = Boolean(host);
  const safeOrigin = urlClass === "HTTP_NETWORK_REQUEST" && category === "xiaohongshu_creator" ? parsed.origin : null;
  const safePathname = urlClass === "HTTP_NETWORK_REQUEST" && category === "xiaohongshu_creator" ? parsed.pathname || "/" : null;
  return { urlScheme, urlClass, hostPresent, hostCategory: category, pathShape: pathShape(parsed.pathname, urlClass), safeOrigin, safePathname };
}

function initiatorType(value: string | null): XhsSafeInitiator["type"] {
  if (value === "parser" || value === "script" || value === "preload" || value === "SignedExchange" || value === "preflight") return value;
  return "other";
}

function safeLineNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000 ? value : null;
}

function readSafeInitiator(value: unknown): XhsSafeInitiator {
  const root = record(value);
  const stack = record(root?.stack);
  const callFrames = Array.isArray(stack?.callFrames) ? stack.callFrames : [];
  const frames: XhsSafeInitiatorFrame[] = [];
  for (const candidate of callFrames.slice(0, 3)) {
    const frame = record(candidate);
    const classification = classifyXhsEditorRequestUrl(stringValue(frame?.url));
    frames.push({
      scriptUrlScheme: classification.urlScheme,
      safeOriginCategory: classification.hostCategory,
      pathname: classification.hostCategory === "xiaohongshu_creator" && classification.urlClass === "HTTP_NETWORK_REQUEST" ? classification.safePathname : null,
      lineNumber: safeLineNumber(frame?.lineNumber),
      columnNumber: safeLineNumber(frame?.columnNumber)
    });
  }
  return { type: initiatorType(stringValue(root?.type)), frames };
}

function safeCorsErrorStatus(value: unknown): XhsSafeCorsErrorStatus | null {
  const root = record(value);
  if (!root) return null;
  return { corsError: safeValue(stringValue(root.corsError)), failedParameter: safeValue(stringValue(root.failedParameter)) };
}

function fixedPageNetworkSnapshot(): FixedPageNetworkSnapshot {
  return { href: location.href, readyState: document.readyState };
}

function fixedDraftSnapshot(): { nonEmptyControlCount: number } {
  const controls = Array.from(document.querySelectorAll("textarea, input:not([type=\"file\"]), [contenteditable=\"true\"]")).slice(0, 50);
  const nonEmptyControlCount = controls.filter((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value.trim().length > 0;
    return (element.textContent ?? "").trim().length > 0;
  }).length;
  return { nonEmptyControlCount };
}

function normalizeReadyState(value: string | null): XhsEditorNetworkDiagnosticResult["documentReadyStateFinal"] {
  return value === "loading" || value === "interactive" || value === "complete" ? value : "EVALUATE_FAILED";
}

function emptyResult(metadata: XhsEditorNetworkDiagnosticMetadata, url: string, diagnosticFailure: string): XhsEditorNetworkDiagnosticResult {
  const sanitized = sanitizeXhsEditorDiagnosticUrl(url);
  return {
    status: "BLOCKED",
    operationId: metadata.operationId,
    accountId: metadata.accountId,
    canonicalContextId: metadata.contextDebugId,
    canonicalPageId: metadata.pageDebugId,
    diagnosticListenersAttached: false,
    networkDomainEnabled: false,
    reloadCount: 0,
    currentPageUrl: sanitized,
    domLocationHref: sanitized,
    documentReadyStateFinal: "EVALUATE_FAILED",
    existingUserDraftDetected: diagnosticFailure === "EXISTING_USER_DRAFT_BLOCKED",
    requestWillBeSentCount: 0,
    responseReceivedCount: 0,
    loadingFailedCount: 0,
    failedFetchesSafe: [],
    failedFetchEndpointGroups: [],
    bootstrapHttpFailure: false,
    bootstrapHttpStatuses: [],
    serviceWorkerInvolvement: "UNAVAILABLE",
    serviceWorkerOrigins: [],
    serviceWorkerCount: null,
    commonInitiator: false,
    commonInitiatorSafe: null,
    commonInitiatorSafePathname: null,
    bootstrapApiFailure: "NOT_PROVEN",
    bootstrapFailureClass: null,
    consoleErrorCount: 0,
    consoleErrorsSafe: [],
    pageErrorCount: 0,
    pageErrorsSafe: [],
    reloadErrorSafe: null,
    rootCauseClass: null,
    rootCauseEvidence: [],
    diagnosticFailure
  };
}

function newNetworkRecord(requestId: string, resourceType: "xhr" | "fetch", url: string | null, requestMethod: string | null): MutableFailedNetworkRequest {
  const urlClassification = classifyXhsEditorRequestUrl(url);
  const extensionResourceIdentity = extractSafeExtensionResourceIdentity(url);
  return {
    requestId: safeRequestId(requestId),
    method: method(requestMethod),
    resourceType,
    origin: urlClassification.safeOrigin,
    pathname: urlClassification.safePathname,
    responseObserved: false,
    httpStatus: null,
    errorText: null,
    blockedReason: null,
    corsErrorStatus: null,
    canceled: false,
    fromServiceWorker: null,
    failed: false,
    urlClassification,
    extensionId: extensionResourceIdentity.extensionId,
    extensionPathname: extensionResourceIdentity.pathname,
    initiatorSafe: { type: "other", frames: [] }
  };
}

function failedRequests(records: ReadonlyMap<string, MutableFailedNetworkRequest>): XhsSafeFailedNetworkRequest[] {
  return [...records.values()].filter((item) => item.failed).slice(0, MAX_FAILED_FETCHES).map(({ failed: _failed, urlClassification, initiatorSafe, ...item }) => ({
    ...item,
    origin: urlClassification.safeOrigin,
    pathname: urlClassification.safePathname,
    ...urlClassification,
    initiatorType: initiatorSafe.type,
    initiatorSafe
  }));
}

function groupFailedRequests(items: readonly XhsSafeFailedNetworkRequest[]): XhsSafeFailedNetworkEndpointGroup[] {
  const groups = new Map<string, XhsSafeFailedNetworkEndpointGroup>();
  for (const item of items) {
    const key = [item.method, item.resourceType, item.origin ?? "", item.pathname ?? ""].join("\u0000");
    const previous = groups.get(key);
    if (previous) {
      previous.occurrenceCount += 1;
      if (item.responseObserved) previous.responseObservedCount += 1;
      if (item.httpStatus !== null && !previous.httpStatuses.includes(item.httpStatus)) previous.httpStatuses = [...previous.httpStatuses, item.httpStatus];
      if (previous.requestIds.length < MAX_FAILED_FETCHES) previous.requestIds = [...previous.requestIds, item.requestId];
      continue;
    }
    if (groups.size >= MAX_ENDPOINT_GROUPS) continue;
    groups.set(key, {
      method: item.method,
      resourceType: item.resourceType,
      origin: item.origin,
      pathname: item.pathname,
      occurrenceCount: 1,
      requestIds: [item.requestId],
      responseObservedCount: item.responseObserved ? 1 : 0,
      httpStatuses: item.httpStatus === null ? [] : [item.httpStatus]
    });
  }
  return [...groups.values()];
}

function includesAny(value: string | null, needles: readonly string[]): boolean {
  const normalized = value?.toUpperCase() ?? "";
  return needles.some((needle) => normalized.includes(needle));
}

export function classifyXhsEditorBootstrapFailureClass(items: readonly Pick<XhsSafeUrlClassification, "urlClass" | "hostCategory">[], commonInitiator: boolean): XhsEditorBootstrapFailureClass {
  if (items.length === 0) return "J_STILL_UNKNOWN_AFTER_URL_CLASSIFICATION";
  if (items.some((item) => item.urlClass === "MALFORMED_OR_UNPARSEABLE")) return "F_MALFORMED_REQUEST_URL";
  if (items.some((item) => item.urlClass === "EXTENSION_RESOURCE")) return "E_EXTENSION_INTERFERENCE";
  if (items.every((item) => item.urlClass === "BLOB_RESOURCE")) return "B_BLOB_FETCH_FAILURE";
  if (items.every((item) => item.urlClass === "DATA_RESOURCE" || item.urlClass === "FILE_RESOURCE")) return "C_DATA_OR_FILE_FETCH_FAILURE";
  if (items.some((item) => item.urlClass === "BROWSER_INTERNAL_RESOURCE")) return "D_BROWSER_INTERNAL_REQUEST_FAILURE";
  if (items.every((item) => item.urlClass === "HTTP_NETWORK_REQUEST")) return "A_HTTP_NETWORK_FETCH_FAILURE";
  if (commonInitiator && items.some((item) => item.urlClass === "OTHER_NON_HTTP" || item.hostCategory === "none")) return "H_XHS_SCRIPT_INITIATED_OPAQUE_FETCH_FAILURE";
  if (items.every((item) => item.urlClass === "OTHER_NON_HTTP")) return "I_OTHER_PROVEN_CLASS";
  return "J_STILL_UNKNOWN_AFTER_URL_CLASSIFICATION";
}

export function classifyXhsEditorNetworkRootCause(evidence: XhsEditorNetworkCauseEvidence): XhsEditorNetworkRootCauseClass {
  const failed = evidence.failedFetches;
  if (failed.some((item) => item.corsErrorStatus != null || includesAny(item.blockedReason ?? null, ["CORS", "PREFLIGHT"]))) return "A_CORS_OR_PREFLIGHT_FAILURE";
  if (failed.some((item) => item.errorText && includesAny(item.errorText, ["CERT", "SSL", "TLS"]))) return "C_TLS_OR_CERTIFICATE_FAILURE";
  if (failed.some((item) => item.blockedReason != null)) return "B_CLIENT_OR_CHROMIUM_BLOCK";
  if (failed.some((item) => item.errorText && includesAny(item.errorText, ["PROXY"]))) return "D_PROXY_OR_NETWORK_CONFIGURATION_FAILURE";
  if (failed.some((item) => item.errorText && includesAny(item.errorText, ["NAME_NOT_RESOLVED", "DNS", "CONNECTION"]))) return "E_DNS_OR_CONNECTION_FAILURE";
  if (failed.some((item) => item.canceled === true || (item.errorText && includesAny(item.errorText, ["ABORT", "TIMED_OUT", "TIMEOUT"])))) return "F_REQUEST_ABORTED_BY_PAGE_RUNTIME";
  if (evidence.serviceWorkerInvolvement === "OBSERVED" || failed.some((item) => item.fromServiceWorker === true)) return "G_SERVICE_WORKER_RUNTIME_FAILURE";
  if ((evidence.bootstrapHttpStatuses ?? []).some((status) => status >= 400) || failed.some((item) => item.responseObserved === true && (item.httpStatus ?? 0) >= 400)) return "H_PLATFORM_BOOTSTRAP_API_HTTP_FAILURE";
  if (evidence.reloadRecovered && evidence.readyStateComplete && failed.length === 0 && evidence.pageErrorCount === 0 && evidence.consoleErrorCount === 0) return "J_TRANSIENT_FAILURE_RECOVERED_AFTER_SINGLE_RELOAD";
  if (failed.some((item) => includesAny(item.errorText ?? null, ["ERR_FAILED"]))) return "K_UNKNOWN_NET_ERR_FAILED_AFTER_DEEP_DIAGNOSTIC";
  return "I_PLATFORM_JS_FETCH_FAILURE_WITHOUT_NETWORK_DETAIL";
}

function collectRootCauseEvidence(result: Pick<XhsEditorNetworkDiagnosticResult, "failedFetchesSafe" | "bootstrapHttpStatuses" | "pageErrorCount" | "consoleErrorCount" | "serviceWorkerInvolvement" | "reloadErrorSafe" | "documentReadyStateFinal">, rootCause: XhsEditorNetworkRootCauseClass): string[] {
  const evidence: string[] = [];
  if (result.failedFetchesSafe.length > 0) evidence.push(`cdp-loading-failed:${result.failedFetchesSafe.length}`);
  if (result.bootstrapHttpStatuses.length > 0) evidence.push(`cdp-http-failures:${result.bootstrapHttpStatuses.length}`);
  if (result.pageErrorCount > 0) evidence.push(`page-errors:${result.pageErrorCount}`);
  if (result.consoleErrorCount > 0) evidence.push(`console-errors:${result.consoleErrorCount}`);
  if (result.serviceWorkerInvolvement === "OBSERVED") evidence.push("service-worker-involvement");
  if (result.documentReadyStateFinal === "complete") evidence.push("ready-state-complete");
  if (result.reloadErrorSafe === null) evidence.push("single-fixed-route-reload-completed");
  evidence.push(`classified:${rootCause}`);
  return evidence;
}

async function cdpSessionForPage(page: Page): Promise<CdpSessionLike | null> {
  try {
    if (page.context && typeof (page.context() as unknown as { newCDPSession?: unknown }).newCDPSession === "function") {
      const context = page.context() as unknown as { newCDPSession: (targetPage: Page) => Promise<CDPSession> };
      return await context.newCDPSession(page) as unknown as CdpSessionLike;
    }
  } catch {
    return null;
  }
  return null;
}

async function serviceWorkerSnapshot(page: Page): Promise<ServiceWorkerSnapshot> {
  try {
    const context = page.context() as unknown as { serviceWorkers?: () => readonly { url: () => string }[] };
    if (typeof context.serviceWorkers !== "function") return { status: "UNAVAILABLE", origins: [], count: null };
    const workers = context.serviceWorkers();
    const origins = [...new Set(workers.map((worker) => sanitizeXhsEditorDiagnosticUrl(worker.url()).origin).filter((origin): origin is string => origin !== null))].sort();
    return { status: "NOT_OBSERVED", origins, count: workers.length };
  } catch {
    return { status: "UNAVAILABLE", origins: [], count: null };
  }
}

async function waitForBoundedNetworkWindow(maxWaitMs: number): Promise<void> {
  if (maxWaitMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs));
}

export async function runXhsEditorNetworkFailureDiagnostic(page: Page, metadata: XhsEditorNetworkDiagnosticMetadata, options: XhsEditorNetworkDiagnosticOptions = {}): Promise<XhsEditorNetworkDiagnosticResult> {
  const initialUrl = page.url();
  if (!isExactXhsPublishEditorRoute(initialUrl)) return emptyResult(metadata, initialUrl, "INVALID_ROUTE");

  let existingUserDraftDetected = false;
  try {
    const snapshot = await page.evaluate(fixedDraftSnapshot);
    existingUserDraftDetected = snapshot.nonEmptyControlCount > 0;
  } catch {
    existingUserDraftDetected = false;
  }
  if (existingUserDraftDetected) return emptyResult(metadata, initialUrl, "EXISTING_USER_DRAFT_BLOCKED");

  const cdpSession = (options.cdpSession as unknown as CdpSessionLike | undefined) ?? await cdpSessionForPage(page);
  if (!cdpSession) return emptyResult(metadata, initialUrl, "CDP_DIAGNOSTIC_UNAVAILABLE");

  const records = new Map<string, MutableFailedNetworkRequest>();
  const pageListeners: Array<() => void> = [];
  const cdpListeners: Array<() => void> = [];
  const bootstrapHttpStatuses: number[] = [];
  const consoleErrorsSafe: XhsSafeNetworkConsoleError[] = [];
  const pageErrorsSafe: string[] = [];
  let requestWillBeSentCount = 0;
  let responseReceivedCount = 0;
  let loadingFailedCount = 0;
  let pageErrorCount = 0;
  let consoleErrorCount = 0;
  let networkDomainEnabled = false;
  let reloadErrorSafe: string | null = null;
  let diagnosticListenersAttached = false;

  const onCdp = (event: string, listener: (payload: unknown) => void): void => {
    cdpSession.on(event, listener);
    cdpListeners.push(() => cdpSession.off(event, listener));
  };
  const requestWillBeSent = (payload: unknown): void => {
    const root = record(payload);
    const request = record(root?.request);
    const requestId = stringValue(root?.requestId);
    const resourceType = networkType(stringValue(root?.type));
    if (!requestId || !resourceType) return;
    requestWillBeSentCount += 1;
    const safeId = safeRequestId(requestId);
    const current = records.get(safeId) ?? newNetworkRecord(requestId, resourceType, stringValue(request?.url), stringValue(request?.method));
    if (request) {
      current.method = method(stringValue(request.method));
      current.urlClassification = classifyXhsEditorRequestUrl(stringValue(request.url));
      current.origin = current.urlClassification.safeOrigin;
      current.pathname = current.urlClassification.safePathname;
      const extensionResourceIdentity = extractSafeExtensionResourceIdentity(stringValue(request.url));
      current.extensionId = extensionResourceIdentity.extensionId;
      current.extensionPathname = extensionResourceIdentity.pathname;
    }
    current.initiatorSafe = readSafeInitiator(root?.initiator);
    records.set(safeId, current);
  };
  const responseReceived = (payload: unknown): void => {
    const root = record(payload);
    const requestId = stringValue(root?.requestId);
    const resourceType = networkType(stringValue(root?.type));
    if (!requestId || !resourceType) return;
    responseReceivedCount += 1;
    const safeId = safeRequestId(requestId);
    const current = records.get(safeId);
    const response = record(root?.response);
    const status = safeStatus(response?.status);
    const fromServiceWorker = safeBoolean(response?.fromServiceWorker);
    if (current) {
      current.responseObserved = true;
      current.httpStatus = status;
      current.fromServiceWorker = fromServiceWorker;
    }
    if (status !== null && status >= 400 && !bootstrapHttpStatuses.includes(status)) bootstrapHttpStatuses.push(status);
  };
  const loadingFailed = (payload: unknown): void => {
    const root = record(payload);
    const requestId = stringValue(root?.requestId);
    const resourceType = networkType(stringValue(root?.type));
    if (!requestId || !resourceType) return;
    loadingFailedCount += 1;
    const safeId = safeRequestId(requestId);
    const current = records.get(safeId) ?? newNetworkRecord(requestId, resourceType, null, null);
    current.failed = true;
    current.errorText = safeValue(stringValue(root?.errorText));
    current.blockedReason = safeValue(stringValue(root?.blockedReason));
    current.corsErrorStatus = safeCorsErrorStatus(root?.corsErrorStatus);
    current.canceled = safeBoolean(root?.canceled) ?? false;
    records.set(safeId, current);
  };
  onCdp("Network.requestWillBeSent", requestWillBeSent);
  onCdp("Network.responseReceived", responseReceived);
  onCdp("Network.loadingFailed", loadingFailed);

  const pageErrorListener = (error: Error): void => {
    pageErrorCount += 1;
    if (pageErrorsSafe.length < MAX_FAILED_FETCHES) pageErrorsSafe.push(safeValue(`${error.name}: ${error.message}`) ?? "UNKNOWN_PAGE_ERROR");
  };
  const consoleListener = (message: ConsoleMessage): void => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    if (type === "error") consoleErrorCount += 1;
    if (consoleErrorsSafe.length < MAX_FAILED_FETCHES) consoleErrorsSafe.push({ level: type === "error" ? "error" : "warning", text: safeValue(message.text()) ?? "" });
  };
  page.on("pageerror", pageErrorListener);
  page.on("console", consoleListener);
  pageListeners.push(() => page.off("pageerror", pageErrorListener), () => page.off("console", consoleListener));
  diagnosticListenersAttached = true;

  try {
    await cdpSession.send("Network.enable");
    networkDomainEnabled = true;
    try {
      await page.reload({ waitUntil: "commit", timeout: Math.max(1, Math.min(DEFAULT_RELOAD_COMMIT_TIMEOUT_MS, options.reloadCommitTimeoutMs ?? DEFAULT_RELOAD_COMMIT_TIMEOUT_MS)) });
    } catch (error: unknown) {
      reloadErrorSafe = safeValue(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
    await waitForBoundedNetworkWindow(Math.max(0, Math.min(MAX_WAIT_MS, options.maxWaitMs ?? DEFAULT_WAIT_MS)));

    const locationSnapshot = await page.evaluate(fixedPageNetworkSnapshot).catch(() => null);
    const currentPageUrl = sanitizeXhsEditorDiagnosticUrl(page.url());
    const domLocationHref = locationSnapshot ? sanitizeXhsEditorDiagnosticUrl(locationSnapshot.href) : currentPageUrl;
    const serviceWorkers = await serviceWorkerSnapshot(page);
    const failedFetchesSafe = failedRequests(records);
    const serviceWorkerObserved = failedFetchesSafe.some((item) => item.fromServiceWorker === true);
    const serviceWorkerInvolvement: XhsServiceWorkerInvolvement = serviceWorkerObserved ? "OBSERVED" : serviceWorkers.status;
    const documentReadyStateFinal = normalizeReadyState(locationSnapshot?.readyState ?? null);
    const firstInitiator = failedFetchesSafe[0]?.initiatorSafe ?? null;
    const identifiableInitiator = firstInitiator !== null && (firstInitiator.type !== "other" || firstInitiator.frames.length > 0);
    const commonInitiator = identifiableInitiator && failedFetchesSafe.every((item) => JSON.stringify(item.initiatorSafe) === JSON.stringify(firstInitiator));
    const commonInitiatorSafe = commonInitiator ? firstInitiator : null;
    const commonInitiatorSafePathname = commonInitiatorSafe?.frames.find((frame) => frame.pathname !== null)?.pathname ?? null;
    const bootstrapFailureClass = classifyXhsEditorBootstrapFailureClass(failedFetchesSafe, commonInitiator);
    const bootstrapApiFailure: "PROVEN" | "NOT_PROVEN" = bootstrapHttpStatuses.some((status) => status >= 400) || failedFetchesSafe.some((item) => item.urlClass === "HTTP_NETWORK_REQUEST") ? "PROVEN" : "NOT_PROVEN";
    const reloadRecovered = reloadErrorSafe === null && documentReadyStateFinal === "complete" && failedFetchesSafe.length === 0 && pageErrorCount === 0 && consoleErrorCount === 0;
    const rootCauseClass = classifyXhsEditorNetworkRootCause({ failedFetches: failedFetchesSafe, bootstrapHttpStatuses, pageErrorCount, consoleErrorCount, serviceWorkerInvolvement, reloadRecovered, readyStateComplete: documentReadyStateFinal === "complete" });
    const resultWithoutEvidence: Pick<XhsEditorNetworkDiagnosticResult, "failedFetchesSafe" | "bootstrapHttpStatuses" | "pageErrorCount" | "consoleErrorCount" | "serviceWorkerInvolvement" | "reloadErrorSafe" | "documentReadyStateFinal"> = { failedFetchesSafe, bootstrapHttpStatuses, pageErrorCount, consoleErrorCount, serviceWorkerInvolvement, reloadErrorSafe, documentReadyStateFinal };
    return {
      status: "COMPLETED",
      operationId: metadata.operationId,
      accountId: metadata.accountId,
      canonicalContextId: metadata.contextDebugId,
      canonicalPageId: metadata.pageDebugId,
      diagnosticListenersAttached,
      networkDomainEnabled,
      reloadCount: 1,
      currentPageUrl,
      domLocationHref,
      documentReadyStateFinal,
      existingUserDraftDetected,
      requestWillBeSentCount,
      responseReceivedCount,
      loadingFailedCount,
      failedFetchesSafe,
      failedFetchEndpointGroups: groupFailedRequests(failedFetchesSafe),
      bootstrapHttpFailure: bootstrapHttpStatuses.some((status) => status >= 400),
      bootstrapHttpStatuses,
      serviceWorkerInvolvement,
      serviceWorkerOrigins: serviceWorkers.origins,
      serviceWorkerCount: serviceWorkers.count,
      commonInitiator,
      commonInitiatorSafe,
      commonInitiatorSafePathname,
      bootstrapApiFailure,
      bootstrapFailureClass,
      consoleErrorCount,
      consoleErrorsSafe,
      pageErrorCount,
      pageErrorsSafe,
      reloadErrorSafe,
      rootCauseClass,
      rootCauseEvidence: collectRootCauseEvidence(resultWithoutEvidence, rootCauseClass),
      diagnosticFailure: null
    };
  } catch (error: unknown) {
    return { ...emptyResult(metadata, page.url(), "CDP_NETWORK_DIAGNOSTIC_FAILED"), diagnosticListenersAttached, networkDomainEnabled, diagnosticFailure: safeValue(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) };
  } finally {
    for (const remove of pageListeners.reverse()) remove();
    for (const remove of cdpListeners.reverse()) remove();
    if (networkDomainEnabled) await cdpSession.send("Network.disable").catch(() => undefined);
    await cdpSession.detach().catch(() => undefined);
  }
}
