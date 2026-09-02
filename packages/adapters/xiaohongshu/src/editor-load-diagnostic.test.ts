import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  classifyXhsEditorLoadRootCause,
  isExactXhsPublishEditorRoute,
  redactXhsDiagnosticText,
  runXhsEditorLoadDiagnostic,
  sanitizeXhsEditorDiagnosticUrl,
  truncateXhsDiagnosticText,
  type XhsEditorLoadDiagnosticMetadata,
  type XhsEditorLoadCauseEvidence
} from "./editor-load-diagnostic";

const editorUrl = "https://creator.xiaohongshu.com/publish/publish";
const metadata: XhsEditorLoadDiagnosticMetadata = {
  operationId: "load-diagnostic-operation",
  accountId: "load-diagnostic-account",
  contextDebugId: "load-diagnostic-context",
  pageDebugId: "load-diagnostic-page"
};

type Listener = (...args: unknown[]) => void;

function fakePage(options: { readyStates?: string[]; scriptFailure?: boolean; authFailure?: boolean; pageError?: boolean; consoleError?: boolean } = {}): { page: Page; reloadCount: () => number; activeListenerCount: () => number } {
  const listeners = new Map<string, Set<Listener>>();
  const mainFrame = { url: () => editorUrl };
  const readyStates = options.readyStates ?? ["loading", "loading", "loading"];
  let evaluateCount = 0;
  let reloads = 0;
  const notify = (event: string, ...args: unknown[]) => { for (const listener of listeners.get(event) ?? []) listener(...args); };
  const request = (type: string, url: string, navigation = false, failedReason: string | null = null) => ({
    resourceType: () => type,
    url: () => url,
    isNavigationRequest: () => navigation,
    frame: () => mainFrame,
    failure: () => failedReason ? { errorText: failedReason } : null
  });
  const page = {
    url: () => editorUrl,
    mainFrame: () => mainFrame,
    frames: () => [mainFrame],
    on: (event: string, listener: Listener) => { const set = listeners.get(event) ?? new Set<Listener>(); set.add(listener); listeners.set(event, set); },
    off: (event: string, listener: Listener) => { listeners.get(event)?.delete(listener); },
    evaluate: vi.fn(async (fn: () => unknown) => {
      const source = String(fn);
      if (source.includes("nonEmptyControlCount")) return { readyState: readyStates[0] ?? "loading", origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", bodyExists: true, bodyChildElementCount: 0, loginRoute: false, securityRoute: false, nonEmptyControlCount: 0 };
      const readyState = readyStates[Math.min(Math.max(0, evaluateCount++ - 1), readyStates.length - 1)] ?? "loading";
      return readyState;
    }),
    reload: vi.fn(async () => {
      reloads += 1;
      const mainRequest = request("document", `${editorUrl}?secret=query`, true);
      notify("request", mainRequest);
      notify("response", { request: () => mainRequest, status: () => options.authFailure ? 403 : 200, headerValue: (name: string) => name === "content-type" ? "text/html" : "secret-header-value" });
      if (options.pageError) notify("pageerror", new Error("bootstrap failed token=secret"));
      if (options.consoleError) notify("console", { type: () => "error", text: () => "render failed cookie=session-secret" });
      if (options.scriptFailure) {
        const scriptRequest = request("script", `${editorUrl}/assets/chunk.js?token=secret`);
        notify("request", scriptRequest);
        notify("requestfailed", scriptRequest);
      }
      notify("domcontentloaded");
      notify("load");
    })
  };
  return { page: page as unknown as Page, reloadCount: () => reloads, activeListenerCount: () => Array.from(listeners.values()).reduce((sum, set) => sum + set.size, 0) };
}

describe("Xiaohongshu editor load diagnostic safety helpers", () => {
  it("strips query strings and fragments while retaining origin and pathname", () => {
    expect(sanitizeXhsEditorDiagnosticUrl("https://creator.xiaohongshu.com/publish/publish?token=secret#fragment")).toEqual({
      origin: "https://creator.xiaohongshu.com",
      pathname: "/publish/publish"
    });
  });

  it("accepts only the fixed publish route", () => {
    expect(isExactXhsPublishEditorRoute("https://creator.xiaohongshu.com/publish/publish")).toBe(true);
    expect(isExactXhsPublishEditorRoute("https://creator.xiaohongshu.com/publish/publish?redirect=secret")).toBe(true);
    expect(isExactXhsPublishEditorRoute("https://creator.xiaohongshu.com/new/home")).toBe(false);
    expect(isExactXhsPublishEditorRoute("https://evil.example/publish/publish")).toBe(false);
  });

  it("redacts token, cookie, authorization, credential, email, phone, and long random text", () => {
    const input = "token=abc123 cookie=session authorization: Bearer abc credential=secret test@example.com 13812345678 4f3a4c1e9d4b7a2c8e6f1a0b9c3d5e7f";
    const result = redactXhsDiagnosticText(input);
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("session");
    expect(result).not.toContain("Bearer abc");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("test@example.com");
    expect(result).not.toContain("13812345678");
    expect(result).not.toContain("4f3a4c1e9d4b7a2c8e6f1a0b9c3d5e7f");
  });

  it("truncates diagnostic text to the configured bound", () => {
    expect(truncateXhsDiagnosticText("abcdefgh", 5)).toBe("abcd…");
  });

  it("prioritizes proven main-document failure over secondary failures", () => {
    const evidence: XhsEditorLoadCauseEvidence = {
      mainDocumentRequestFailed: true,
      mainDocumentStatus: 503,
      scriptFailureCount: 3,
      xhrFetchFailureCount: 4,
      pageErrorCount: 2,
      frameLoadFailureObserved: true,
      stillLoadingWithoutObservableError: false,
      recoveredAfterReload: false
    };
    expect(classifyXhsEditorLoadRootCause(evidence)).toBe("MAIN_DOCUMENT_LOAD_FAILURE");
  });

  it("classifies a stable page with script failures as a chunk failure", () => {
    expect(classifyXhsEditorLoadRootCause({
      mainDocumentRequestFailed: false,
      mainDocumentStatus: 200,
      scriptFailureCount: 1,
      xhrFetchFailureCount: 0,
      pageErrorCount: 0,
      frameLoadFailureObserved: false,
      stillLoadingWithoutObservableError: true,
      recoveredAfterReload: false
    })).toBe("SCRIPT_CHUNK_LOAD_FAILURE");
  });

  it("classifies a page recovered by the single reload", () => {
    expect(classifyXhsEditorLoadRootCause({
      mainDocumentRequestFailed: false,
      mainDocumentStatus: 200,
      scriptFailureCount: 0,
      xhrFetchFailureCount: 0,
      pageErrorCount: 0,
      frameLoadFailureObserved: false,
      stillLoadingWithoutObservableError: false,
      recoveredAfterReload: true
    })).toBe("TRANSIENT_LOAD_HANG_RECOVERED_BY_SINGLE_RELOAD");
  });

  it("prioritizes an observed authorization response and keeps error text safe", async () => {
    const fake = fakePage({ authFailure: true, pageError: true, consoleError: true });
    const result = await runXhsEditorLoadDiagnostic(fake.page, metadata, { maxWaitMs: 1, readyStateOffsetsMs: [0] });
    expect(result.authOrPermissionHttpFailure).toBe(true);
    expect(result.rootCauseClass).toBe("PLATFORM_AUTHORIZATION_OR_PERMISSION_RESPONSE");
    expect(result.pageErrorCount).toBe(1);
    expect(result.consoleErrorCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("captures bounded lifecycle and script failure evidence, then removes every listener", async () => {
    const fake = fakePage({ scriptFailure: true });
    const result = await runXhsEditorLoadDiagnostic(fake.page, metadata, { maxWaitMs: 3, readyStateOffsetsMs: [0, 1, 2] });
    expect(fake.reloadCount()).toBe(1);
    expect(fake.activeListenerCount()).toBe(0);
    expect(result.diagnosticListenersAttached).toBe(true);
    expect(result.reloadCount).toBe(1);
    expect(result.mainDocumentRequestStartedAt).not.toBeNull();
    expect(result.mainDocumentStatus).toBe(200);
    expect(result.domContentLoadedAt).not.toBeNull();
    expect(result.loadEventObserved).toBe(true);
    expect(result.readyStateSamples).toHaveLength(3);
    expect(result.scriptResourceTotal).toBe(1);
    expect(result.scriptResourceFailed).toBe(1);
    expect(result.rootCauseClass).toBe("SCRIPT_CHUNK_LOAD_FAILURE");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("?");
  });

  it("does not reload a non-fixed route", async () => {
    const fake = fakePage();
    Object.defineProperty(fake.page, "url", { value: () => "https://creator.xiaohongshu.com/new/home" });
    const result = await runXhsEditorLoadDiagnostic(fake.page, metadata, { maxWaitMs: 1, readyStateOffsetsMs: [0] });
    expect(fake.reloadCount()).toBe(0);
    expect(result.rootCauseClass).toBe("INVALID_ROUTE");
  });
});
