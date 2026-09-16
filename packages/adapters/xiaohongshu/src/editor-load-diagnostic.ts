import type { ConsoleMessage, Frame, Page, Request, Response } from "playwright-core";

export const XHS_PUBLISH_EDITOR_ORIGIN = "https://creator.xiaohongshu.com";
export const XHS_PUBLISH_EDITOR_PATHNAME = "/publish/publish";
const MAX_CONSOLE_MESSAGES = 100;
const MAX_CONSOLE_TEXT_LENGTH = 500;
const MAX_PAGE_ERRORS = 50;
const MAX_FAILED_RESOURCES = 50;
const MAX_FRAME_SUMMARIES = 20;
const MAX_STACK_FRAMES = 8;
const MAX_RELOAD_COUNT = 1;
const MAX_WAIT_MS = 30_000;
const DEFAULT_RELOAD_COMMIT_TIMEOUT_MS = 15_000;
const DEFAULT_READY_STATE_OFFSETS_MS = [0, 1_000, 2_000, 5_000, 10_000, 20_000, 30_000] as const;

export type XhsEditorLoadRootCauseClass =
  | "MAIN_DOCUMENT_LOAD_FAILURE"
  | "SCRIPT_CHUNK_LOAD_FAILURE"
  | "XHR_OR_API_BOOTSTRAP_FAILURE"
  | "CSS_OR_RENDER_RESOURCE_FAILURE"
  | "JS_RUNTIME_EXCEPTION"
  | "FRAME_LOAD_FAILURE"
  | "PLATFORM_AUTHORIZATION_OR_PERMISSION_RESPONSE"
  | "TRANSIENT_LOAD_HANG_RECOVERED_BY_SINGLE_RELOAD"
  | "PAGE_STILL_LOADING_NO_OBSERVABLE_RESOURCE_ERROR"
  | "OTHER_PROVEN_CAUSE"
  | "INVALID_ROUTE"
  | "EXISTING_USER_DRAFT_BLOCKED";

export interface XhsDiagnosticUrlParts {
  origin: string | null;
  pathname: string | null;
}

export interface XhsSafePageError {
  name: string;
  message: string;
  stackFrames: readonly string[];
}

export interface XhsSafeConsoleError {
  level: "error" | "warning";
  text: string;
}

export type XhsResourceType = "document" | "script" | "stylesheet" | "xhr" | "fetch" | "font" | "other";

export interface XhsSafeFailedResource {
  resourceType: XhsResourceType;
  origin: string | null;
  pathname: string | null;
  httpStatus: number | null;
  requestFailedReason: string | null;
}

export interface XhsSafeFrameSummary {
  kind: "main" | "child";
  origin: string | null;
  pathname: string | null;
}

export interface XhsReadyStateSample {
  elapsedMs: number;
  readyState: "loading" | "interactive" | "complete" | "EVALUATE_FAILED";
}

export interface XhsEditorLoadCauseEvidence {
  mainDocumentRequestFailed: boolean;
  mainDocumentStatus: number | null;
  scriptFailureCount: number;
  xhrFetchFailureCount: number;
  stylesheetFailureCount?: number;
  pageErrorCount: number;
  consoleErrorCount?: number;
  frameLoadFailureObserved: boolean;
  stillLoadingWithoutObservableError: boolean;
  recoveredAfterReload: boolean;
  authOrPermissionHttpFailure?: boolean;
}

export interface XhsEditorLoadDiagnosticMetadata {
  operationId: string;
  accountId: string;
  contextDebugId: string;
  pageDebugId: string;
}

export interface XhsEditorLoadDiagnosticResult {
  status: "COMPLETED" | "BLOCKED";
  operationId: string;
  accountId: string;
  canonicalContextId: string;
  canonicalPageId: string;
  diagnosticListenersAttached: boolean;
  reloadCount: number;
  currentPageUrl: XhsDiagnosticUrlParts;
  domLocationHref: XhsDiagnosticUrlParts;
  existingUserDraftDetected: boolean;
  reloadStartedAt: string | null;
  mainDocumentRequestStartedAt: string | null;
  mainDocumentResponseReceivedAt: string | null;
  mainDocumentStatus: number | null;
  mainDocumentContentTypeSafe: string | null;
  mainDocumentRequestFailed: boolean;
  mainDocumentFailureReason: string | null;
  domContentLoadedAt: string | null;
  loadEventAt: string | null;
  loadEventObserved: boolean;
  readyStateSamples: readonly XhsReadyStateSample[];
  documentReadyStateFinal: XhsReadyStateSample["readyState"];
  frameCount: number;
  frameSummarySafe: readonly XhsSafeFrameSummary[];
  editorCandidateFrame: XhsSafeFrameSummary | null;
  frameLoadFailureObserved: boolean;
  pageErrorCount: number;
  pageErrorsSafe: readonly XhsSafePageError[];
  consoleErrorCount: number;
  consoleErrorsSafe: readonly XhsSafeConsoleError[];
  consoleWarningCount: number;
  requestFailedCount: number;
  failedResourcesSafe: readonly XhsSafeFailedResource[];
  scriptResourceTotal: number;
  scriptResourceSuccess: number;
  scriptResourceFailed: number;
  scriptFailuresSafe: readonly XhsSafeFailedResource[];
  stylesheetFailureCount: number;
  xhrFetchFailureCount: number;
  authOrPermissionHttpFailure: boolean;
  editorShellPresentAfterReload: boolean;
  editorRecoveredAfterSingleReload: boolean;
  rootCauseClass: XhsEditorLoadRootCauseClass;
  rootCauseEvidence: readonly string[];
  reloadErrorSafe: string | null;
}

export interface XhsEditorLoadDiagnosticOptions {
  /** Test-only timing override. The public adapter API never forwards user input here. */
  maxWaitMs?: number;
  /** Test-only sampling override. Production uses the fixed bounded schedule. */
  readyStateOffsetsMs?: readonly number[];
  /** Test-only reload timeout override. */
  reloadCommitTimeoutMs?: number;
  now?: () => string;
}

interface LifecycleState {
  diagnosticListenersAttached: boolean;
  reloadStartedAt: string | null;
  mainDocumentRequestStartedAt: string | null;
  mainDocumentResponseReceivedAt: string | null;
  mainDocumentStatus: number | null;
  mainDocumentContentTypeSafe: string | null;
  mainDocumentRequestFailed: boolean;
  mainDocumentFailureReason: string | null;
  domContentLoadedAt: string | null;
  loadEventAt: string | null;
  loadEventObserved: boolean;
  pageErrorCount: number;
  pageErrorsSafe: XhsSafePageError[];
  consoleErrorCount: number;
  consoleErrorsSafe: XhsSafeConsoleError[];
  consoleWarningCount: number;
  requestFailedCount: number;
  failedResourcesSafe: XhsSafeFailedResource[];
  scriptResourceTotal: number;
  scriptResourceSuccess: number;
  scriptResourceFailed: number;
  scriptFailuresSafe: XhsSafeFailedResource[];
  stylesheetFailureCount: number;
  xhrFetchFailureCount: number;
  authOrPermissionHttpFailure: boolean;
  frameLoadFailureObserved: boolean;
}

interface ScriptRequestState {
  request: Request;
  completed: boolean;
}

interface FixedLoadDomSnapshot {
  readyState: string;
  origin: string;
  pathname: string;
  bodyExists: boolean;
  bodyChildElementCount: number;
  loginRoute: boolean;
  securityRoute: boolean;
  nonEmptyControlCount: number;
}

function emptyLifecycleState(): LifecycleState {
  return {
    diagnosticListenersAttached: false,
    reloadStartedAt: null,
    mainDocumentRequestStartedAt: null,
    mainDocumentResponseReceivedAt: null,
    mainDocumentStatus: null,
    mainDocumentContentTypeSafe: null,
    mainDocumentRequestFailed: false,
    mainDocumentFailureReason: null,
    domContentLoadedAt: null,
    loadEventAt: null,
    loadEventObserved: false,
    pageErrorCount: 0,
    pageErrorsSafe: [],
    consoleErrorCount: 0,
    consoleErrorsSafe: [],
    consoleWarningCount: 0,
    requestFailedCount: 0,
    failedResourcesSafe: [],
    scriptResourceTotal: 0,
    scriptResourceSuccess: 0,
    scriptResourceFailed: 0,
    scriptFailuresSafe: [],
    stylesheetFailureCount: 0,
    xhrFetchFailureCount: 0,
    authOrPermissionHttpFailure: false,
    frameLoadFailureObserved: false
  };
}

function nowIso(options: XhsEditorLoadDiagnosticOptions): string {
  return options.now?.() ?? new Date().toISOString();
}

export function truncateXhsDiagnosticText(value: string, maxLength: number): string {
  const normalizedMaxLength = Math.max(0, Math.floor(maxLength));
  if (value.length <= normalizedMaxLength) return value;
  if (normalizedMaxLength === 0) return "";
  return `${value.slice(0, Math.max(0, normalizedMaxLength - 1))}…`;
}

export function redactXhsDiagnosticText(value: string): string {
  return value
    .replace(/((?:token|cookie|authorization|credential|password|secret|api[-_]?key)\s*[:=]\s*)([^\s,;]+)/giu, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[EMAIL_REDACTED]")
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/gu, "[PHONE_REDACTED]")
    .replace(/\b[A-F0-9]{24,}\b/giu, "[RANDOM_SECRET_REDACTED]");
}

export function sanitizeXhsEditorDiagnosticUrl(rawUrl: string): XhsDiagnosticUrlParts {
  try {
    const url = new URL(rawUrl);
    return { origin: url.origin, pathname: url.pathname || "/" };
  } catch {
    return { origin: null, pathname: null };
  }
}

export function isExactXhsPublishEditorRoute(rawUrl: string): boolean {
  const sanitized = sanitizeXhsEditorDiagnosticUrl(rawUrl);
  return sanitized.origin === XHS_PUBLISH_EDITOR_ORIGIN && sanitized.pathname === XHS_PUBLISH_EDITOR_PATHNAME;
}

export function classifyXhsEditorLoadRootCause(evidence: XhsEditorLoadCauseEvidence): XhsEditorLoadRootCauseClass {
  if (evidence.authOrPermissionHttpFailure === true) return "PLATFORM_AUTHORIZATION_OR_PERMISSION_RESPONSE";
  if (evidence.mainDocumentRequestFailed || (evidence.mainDocumentStatus !== null && evidence.mainDocumentStatus >= 400)) return "MAIN_DOCUMENT_LOAD_FAILURE";
  if (evidence.scriptFailureCount > 0) return "SCRIPT_CHUNK_LOAD_FAILURE";
  if (evidence.xhrFetchFailureCount > 0) return "XHR_OR_API_BOOTSTRAP_FAILURE";
  if ((evidence.stylesheetFailureCount ?? 0) > 0) return "CSS_OR_RENDER_RESOURCE_FAILURE";
  if (evidence.pageErrorCount > 0 || (evidence.consoleErrorCount ?? 0) > 0) return "JS_RUNTIME_EXCEPTION";
  if (evidence.frameLoadFailureObserved) return "FRAME_LOAD_FAILURE";
  if (evidence.recoveredAfterReload) return "TRANSIENT_LOAD_HANG_RECOVERED_BY_SINGLE_RELOAD";
  if (evidence.stillLoadingWithoutObservableError) return "PAGE_STILL_LOADING_NO_OBSERVABLE_RESOURCE_ERROR";
  return "OTHER_PROVEN_CAUSE";
}

function resourceType(request: Request): XhsResourceType {
  const type = request.resourceType();
  return type === "document" || type === "script" || type === "stylesheet" || type === "xhr" || type === "fetch" || type === "font" ? type : "other";
}

function safeFailureReason(value: string | null | undefined): string | null {
  if (!value) return null;
  return truncateXhsDiagnosticText(redactXhsDiagnosticText(value), MAX_CONSOLE_TEXT_LENGTH);
}

function safeStackFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack.split(/\r?\n/u).slice(0, MAX_STACK_FRAMES).map((line) => {
    const urls = line.replace(/https?:\/\/[^\s)]+/giu, (value) => {
      const sanitized = sanitizeXhsEditorDiagnosticUrl(value);
      return sanitized.origin && sanitized.pathname ? `${sanitized.origin}${sanitized.pathname}` : "[URL_REDACTED]";
    });
    return truncateXhsDiagnosticText(redactXhsDiagnosticText(urls), MAX_CONSOLE_TEXT_LENGTH);
  });
}

function safeFailedResource(request: Request, status: number | null, reason: string | null): XhsSafeFailedResource {
  const url = sanitizeXhsEditorDiagnosticUrl(request.url());
  return { resourceType: resourceType(request), origin: url.origin, pathname: url.pathname, httpStatus: status, requestFailedReason: safeFailureReason(reason) };
}

function addFailedResource(state: LifecycleState, entry: XhsSafeFailedResource): void {
  if (state.failedResourcesSafe.length < MAX_FAILED_RESOURCES) state.failedResourcesSafe.push(entry);
  if (entry.resourceType === "script" && state.scriptFailuresSafe.length < MAX_FAILED_RESOURCES) state.scriptFailuresSafe.push(entry);
}

function markHttpAuthFailure(state: LifecycleState, status: number | null): void {
  if (status === 401 || status === 403) state.authOrPermissionHttpFailure = true;
}

function isMainDocumentRequest(page: Page, request: Request): boolean {
  return resourceType(request) === "document" && request.isNavigationRequest() && request.frame() === page.mainFrame();
}

function isChildDocumentRequest(page: Page, request: Request): boolean {
  return resourceType(request) === "document" && request.isNavigationRequest() && request.frame() !== page.mainFrame();
}

const READ_READY_STATE = (): DocumentReadyState => document.readyState;
const READ_LOAD_DOM_SNAPSHOT = (): FixedLoadDomSnapshot => {
  const controls = Array.from(document.querySelectorAll("textarea, input:not([type=\"file\"]), [contenteditable=\"true\"]")).slice(0, 50);
  const nonEmptyControlCount = controls.filter((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value.trim().length > 0;
    return (element.textContent ?? "").trim().length > 0;
  }).length;
  return {
    readyState: document.readyState,
    origin: location.origin,
    pathname: location.pathname,
    bodyExists: document.body !== null,
    bodyChildElementCount: document.body?.childElementCount ?? 0,
    loginRoute: /\/login(?:[/?#]|$)/iu.test(location.pathname),
    securityRoute: /security|verify|captcha|安全验证|验证码/iu.test(location.pathname),
    nonEmptyControlCount
  };
};

function normalizeReadyState(value: string): XhsReadyStateSample["readyState"] {
  return value === "loading" || value === "interactive" || value === "complete" ? value : "EVALUATE_FAILED";
}

async function waitUntil(targetAt: number): Promise<void> {
  const delay = targetAt - Date.now();
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

function summarizeFrame(frame: Frame, mainFrame: Frame): XhsSafeFrameSummary {
  const url = sanitizeXhsEditorDiagnosticUrl(frame.url());
  return { kind: frame === mainFrame ? "main" : "child", origin: url.origin, pathname: url.pathname };
}

function emptyResult(metadata: XhsEditorLoadDiagnosticMetadata, currentUrl: string, status: XhsEditorLoadDiagnosticResult["status"], cause: XhsEditorLoadRootCauseClass, existingUserDraftDetected = false): XhsEditorLoadDiagnosticResult {
  const url = sanitizeXhsEditorDiagnosticUrl(currentUrl);
  return {
    status,
    operationId: metadata.operationId,
    accountId: metadata.accountId,
    canonicalContextId: metadata.contextDebugId,
    canonicalPageId: metadata.pageDebugId,
    diagnosticListenersAttached: false,
    reloadCount: 0,
    currentPageUrl: url,
    domLocationHref: url,
    existingUserDraftDetected,
    reloadStartedAt: null,
    mainDocumentRequestStartedAt: null,
    mainDocumentResponseReceivedAt: null,
    mainDocumentStatus: null,
    mainDocumentContentTypeSafe: null,
    mainDocumentRequestFailed: false,
    mainDocumentFailureReason: null,
    domContentLoadedAt: null,
    loadEventAt: null,
    loadEventObserved: false,
    readyStateSamples: [],
    documentReadyStateFinal: "EVALUATE_FAILED",
    frameCount: 0,
    frameSummarySafe: [],
    editorCandidateFrame: null,
    frameLoadFailureObserved: false,
    pageErrorCount: 0,
    pageErrorsSafe: [],
    consoleErrorCount: 0,
    consoleErrorsSafe: [],
    consoleWarningCount: 0,
    requestFailedCount: 0,
    failedResourcesSafe: [],
    scriptResourceTotal: 0,
    scriptResourceSuccess: 0,
    scriptResourceFailed: 0,
    scriptFailuresSafe: [],
    stylesheetFailureCount: 0,
    xhrFetchFailureCount: 0,
    authOrPermissionHttpFailure: false,
    editorShellPresentAfterReload: false,
    editorRecoveredAfterSingleReload: false,
    rootCauseClass: cause,
    rootCauseEvidence: [cause],
    reloadErrorSafe: null
  };
}

export async function runXhsEditorLoadDiagnostic(page: Page, metadata: XhsEditorLoadDiagnosticMetadata, options: XhsEditorLoadDiagnosticOptions = {}): Promise<XhsEditorLoadDiagnosticResult> {
  const initialUrl = page.url();
  if (!isExactXhsPublishEditorRoute(initialUrl)) return emptyResult(metadata, initialUrl, "BLOCKED", "INVALID_ROUTE");

  let existingUserDraftDetected = false;
  try {
    const draftSnapshot = await page.evaluate(READ_LOAD_DOM_SNAPSHOT);
    existingUserDraftDetected = draftSnapshot.nonEmptyControlCount > 0;
  } catch {
    existingUserDraftDetected = false;
  }
  if (existingUserDraftDetected) return emptyResult(metadata, initialUrl, "BLOCKED", "EXISTING_USER_DRAFT_BLOCKED", true);

  const state = emptyLifecycleState();
  const readyStateSamples: XhsReadyStateSample[] = [];
  const listeners: Array<() => void> = [];
  const pendingEventWork: Promise<void>[] = [];
  const scriptRequests = new Map<Request, ScriptRequestState>();
  const now = () => nowIso(options);
  const pageErrorListener = (error: Error): void => {
    state.pageErrorCount += 1;
    if (state.pageErrorsSafe.length < MAX_PAGE_ERRORS) state.pageErrorsSafe.push({ name: truncateXhsDiagnosticText(redactXhsDiagnosticText(error.name), 120), message: truncateXhsDiagnosticText(redactXhsDiagnosticText(error.message), MAX_CONSOLE_TEXT_LENGTH), stackFrames: safeStackFrames(error.stack) });
  };
  page.on("pageerror", pageErrorListener);
  listeners.push(() => page.off("pageerror", pageErrorListener));
  const consoleListener = (message: ConsoleMessage): void => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    const level: XhsSafeConsoleError["level"] = type === "error" ? "error" : "warning";
    if (level === "error") state.consoleErrorCount += 1;
    else state.consoleWarningCount += 1;
    if (state.consoleErrorsSafe.length < MAX_CONSOLE_MESSAGES) state.consoleErrorsSafe.push({ level, text: truncateXhsDiagnosticText(redactXhsDiagnosticText(message.text()), MAX_CONSOLE_TEXT_LENGTH) });
  };
  page.on("console", consoleListener);
  listeners.push(() => page.off("console", consoleListener));
  const requestListener = (request: Request): void => {
    const type = resourceType(request);
    if (type === "script") {
      state.scriptResourceTotal += 1;
      scriptRequests.set(request, { request, completed: false });
    }
    if (isMainDocumentRequest(page, request) && state.mainDocumentRequestStartedAt === null) state.mainDocumentRequestStartedAt = now();
  };
  page.on("request", requestListener);
  listeners.push(() => page.off("request", requestListener));
  const requestFailedListener = (request: Request): void => {
    state.requestFailedCount += 1;
    const type = resourceType(request);
    const reason = request.failure()?.errorText ?? null;
    if (isMainDocumentRequest(page, request)) {
      state.mainDocumentRequestFailed = true;
      state.mainDocumentFailureReason = safeFailureReason(reason);
    }
    if (isChildDocumentRequest(page, request)) state.frameLoadFailureObserved = true;
    if (type === "script") {
      const tracked = scriptRequests.get(request);
      if (tracked && !tracked.completed) {
        tracked.completed = true;
        state.scriptResourceFailed += 1;
      }
    }
    if (type === "stylesheet") state.stylesheetFailureCount += 1;
    if (type === "xhr" || type === "fetch") state.xhrFetchFailureCount += 1;
    const entry = safeFailedResource(request, null, reason);
    addFailedResource(state, entry);
  };
  page.on("requestfailed", requestFailedListener);
  listeners.push(() => page.off("requestfailed", requestFailedListener));
  const responseListener = (response: Response): void => {
    const request = response.request();
    const type = resourceType(request);
    const status = response.status();
    markHttpAuthFailure(state, status);
    if (isMainDocumentRequest(page, request)) {
      if (state.mainDocumentResponseReceivedAt === null) state.mainDocumentResponseReceivedAt = now();
      state.mainDocumentStatus = status;
      const contentTypeWork = Promise.resolve(response.headerValue("content-type")).then((contentType) => {
        state.mainDocumentContentTypeSafe = safeFailureReason(contentType);
      });
      pendingEventWork.push(contentTypeWork);
    }
    if (isChildDocumentRequest(page, request) && status >= 400) state.frameLoadFailureObserved = true;
    if (type === "script") {
      const tracked = scriptRequests.get(request);
      if (tracked && !tracked.completed) {
        tracked.completed = true;
        if (status >= 400) state.scriptResourceFailed += 1;
        else state.scriptResourceSuccess += 1;
      }
    }
    if (status >= 400) {
      if (type === "stylesheet") state.stylesheetFailureCount += 1;
      if (type === "xhr" || type === "fetch") state.xhrFetchFailureCount += 1;
      addFailedResource(state, safeFailedResource(request, status, null));
    }
  };
  page.on("response", responseListener);
  listeners.push(() => page.off("response", responseListener));
  const domContentLoadedListener = (): void => { if (state.domContentLoadedAt === null) state.domContentLoadedAt = now(); };
  page.on("domcontentloaded", domContentLoadedListener);
  listeners.push(() => page.off("domcontentloaded", domContentLoadedListener));
  const loadListener = (): void => { if (state.loadEventAt === null) state.loadEventAt = now(); state.loadEventObserved = true; };
  page.on("load", loadListener);
  listeners.push(() => page.off("load", loadListener));
  const frameNavigatedListener = (frame: Frame): void => {
    if (isExactXhsPublishEditorRoute(frame.url()) && frame !== page.mainFrame()) state.frameLoadFailureObserved = false;
  };
  page.on("framenavigated", frameNavigatedListener);
  listeners.push(() => page.off("framenavigated", frameNavigatedListener));
  state.diagnosticListenersAttached = true;

  const maxWaitMs = Math.max(0, Math.min(MAX_WAIT_MS, options.maxWaitMs ?? MAX_WAIT_MS));
  const offsets = (options.readyStateOffsetsMs ?? DEFAULT_READY_STATE_OFFSETS_MS).map((offset) => Math.max(0, Math.min(maxWaitMs, Math.floor(offset)))).filter((offset, index, values) => values.indexOf(offset) === index).sort((a, b) => a - b);
  const startedAtMs = Date.now();
  let reloadErrorSafe: string | null = null;
  state.reloadStartedAt = now();
  const reloadPromise = page.reload({ waitUntil: "commit", timeout: Math.max(1, Math.min(DEFAULT_RELOAD_COMMIT_TIMEOUT_MS, maxWaitMs || DEFAULT_RELOAD_COMMIT_TIMEOUT_MS)) }).catch((error: unknown) => {
    reloadErrorSafe = truncateXhsDiagnosticText(redactXhsDiagnosticText(error instanceof Error ? `${error.name}: ${error.message}` : String(error)), MAX_CONSOLE_TEXT_LENGTH);
  });
  const reloadCount = MAX_RELOAD_COUNT;

  try {
    for (const offset of offsets) {
      await waitUntil(startedAtMs + offset);
      let readyState: XhsReadyStateSample["readyState"] = "EVALUATE_FAILED";
      try {
        readyState = normalizeReadyState(await page.evaluate(READ_READY_STATE));
      } catch {
        readyState = "EVALUATE_FAILED";
      }
      readyStateSamples.push({ elapsedMs: Math.max(0, Date.now() - startedAtMs), readyState });
    }
    await reloadPromise;
    await Promise.all(pendingEventWork);
    const finalSnapshot = await page.evaluate(READ_LOAD_DOM_SNAPSHOT).catch(() => null);
    const currentPageUrl = sanitizeXhsEditorDiagnosticUrl(page.url());
    const domLocationHref = finalSnapshot ? sanitizeXhsEditorDiagnosticUrl(`${finalSnapshot.origin}${finalSnapshot.pathname}`) : currentPageUrl;
    const frameSummarySafe = page.frames().slice(0, MAX_FRAME_SUMMARIES).map((frame) => summarizeFrame(frame, page.mainFrame()));
    const editorCandidateFrame = frameSummarySafe.find((frame) => frame.origin === XHS_PUBLISH_EDITOR_ORIGIN && frame.pathname === XHS_PUBLISH_EDITOR_PATHNAME) ?? null;
    const finalReadyState = readyStateSamples.at(-1)?.readyState ?? "EVALUATE_FAILED";
    const editorShellPresentAfterReload = Boolean(finalSnapshot && finalSnapshot.origin === XHS_PUBLISH_EDITOR_ORIGIN && finalSnapshot.pathname === XHS_PUBLISH_EDITOR_PATHNAME && finalSnapshot.readyState === "complete" && finalSnapshot.bodyExists && finalSnapshot.bodyChildElementCount > 0 && !finalSnapshot.loginRoute && !finalSnapshot.securityRoute);
    const editorRecoveredAfterSingleReload = editorShellPresentAfterReload && finalReadyState === "complete";
    const stillLoadingWithoutObservableError = (finalReadyState === "loading" || finalReadyState === "interactive") && !state.mainDocumentRequestFailed && !state.authOrPermissionHttpFailure && state.scriptResourceFailed === 0 && state.xhrFetchFailureCount === 0 && state.stylesheetFailureCount === 0 && state.pageErrorCount === 0 && state.consoleErrorCount === 0 && !state.frameLoadFailureObserved;
    const rootCauseEvidence: string[] = [];
    if (state.mainDocumentRequestFailed) rootCauseEvidence.push("main-document-request-failed");
    if (state.mainDocumentStatus !== null && state.mainDocumentStatus >= 400) rootCauseEvidence.push(`main-document-http-${state.mainDocumentStatus}`);
    if (state.scriptResourceFailed > 0) rootCauseEvidence.push(`script-failures:${state.scriptResourceFailed}`);
    if (state.xhrFetchFailureCount > 0) rootCauseEvidence.push(`xhr-fetch-failures:${state.xhrFetchFailureCount}`);
    if (state.stylesheetFailureCount > 0) rootCauseEvidence.push(`stylesheet-failures:${state.stylesheetFailureCount}`);
    if (state.pageErrorCount > 0) rootCauseEvidence.push(`page-errors:${state.pageErrorCount}`);
    if (state.consoleErrorCount > 0) rootCauseEvidence.push(`console-errors:${state.consoleErrorCount}`);
    if (state.frameLoadFailureObserved) rootCauseEvidence.push("frame-load-failure");
    if (editorRecoveredAfterSingleReload) rootCauseEvidence.push("ready-complete-editor-shell-after-one-reload");
    if (stillLoadingWithoutObservableError) rootCauseEvidence.push("ready-state-still-loading-without-observable-resource-error");
    const rootCauseClass = classifyXhsEditorLoadRootCause({
      mainDocumentRequestFailed: state.mainDocumentRequestFailed,
      mainDocumentStatus: state.mainDocumentStatus,
      scriptFailureCount: state.scriptResourceFailed,
      xhrFetchFailureCount: state.xhrFetchFailureCount,
      stylesheetFailureCount: state.stylesheetFailureCount,
      pageErrorCount: state.pageErrorCount,
      consoleErrorCount: state.consoleErrorCount,
      frameLoadFailureObserved: state.frameLoadFailureObserved,
      stillLoadingWithoutObservableError,
      recoveredAfterReload: editorRecoveredAfterSingleReload,
      authOrPermissionHttpFailure: state.authOrPermissionHttpFailure
    });
    return {
      status: "COMPLETED",
      operationId: metadata.operationId,
      accountId: metadata.accountId,
      canonicalContextId: metadata.contextDebugId,
      canonicalPageId: metadata.pageDebugId,
      diagnosticListenersAttached: state.diagnosticListenersAttached,
      reloadCount,
      currentPageUrl,
      domLocationHref,
      existingUserDraftDetected,
      reloadStartedAt: state.reloadStartedAt,
      mainDocumentRequestStartedAt: state.mainDocumentRequestStartedAt,
      mainDocumentResponseReceivedAt: state.mainDocumentResponseReceivedAt,
      mainDocumentStatus: state.mainDocumentStatus,
      mainDocumentContentTypeSafe: state.mainDocumentContentTypeSafe,
      mainDocumentRequestFailed: state.mainDocumentRequestFailed,
      mainDocumentFailureReason: state.mainDocumentFailureReason,
      domContentLoadedAt: state.domContentLoadedAt,
      loadEventAt: state.loadEventAt,
      loadEventObserved: state.loadEventObserved,
      readyStateSamples,
      documentReadyStateFinal: finalReadyState,
      frameCount: page.frames().length,
      frameSummarySafe,
      editorCandidateFrame,
      frameLoadFailureObserved: state.frameLoadFailureObserved,
      pageErrorCount: state.pageErrorCount,
      pageErrorsSafe: state.pageErrorsSafe,
      consoleErrorCount: state.consoleErrorCount,
      consoleErrorsSafe: state.consoleErrorsSafe,
      consoleWarningCount: state.consoleWarningCount,
      requestFailedCount: state.requestFailedCount,
      failedResourcesSafe: state.failedResourcesSafe,
      scriptResourceTotal: state.scriptResourceTotal,
      scriptResourceSuccess: state.scriptResourceSuccess,
      scriptResourceFailed: state.scriptResourceFailed,
      scriptFailuresSafe: state.scriptFailuresSafe,
      stylesheetFailureCount: state.stylesheetFailureCount,
      xhrFetchFailureCount: state.xhrFetchFailureCount,
      authOrPermissionHttpFailure: state.authOrPermissionHttpFailure,
      editorShellPresentAfterReload,
      editorRecoveredAfterSingleReload,
      rootCauseClass,
      rootCauseEvidence,
      reloadErrorSafe
    };
  } finally {
    for (const remove of listeners.reverse()) remove();
  }
}
