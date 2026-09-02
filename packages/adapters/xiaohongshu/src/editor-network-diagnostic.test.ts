import { describe, expect, it, vi } from "vitest";
import type { CDPSession, Page } from "playwright-core";
import {
  classifyXhsEditorBootstrapFailureClass,
  classifyXhsEditorNetworkRootCause,
  classifyXhsEditorRequestUrl,
  extractSafeExtensionResourceIdentity,
  runXhsEditorNetworkFailureDiagnostic,
  type XhsEditorNetworkDiagnosticMetadata,
  type XhsEditorNetworkCauseEvidence
} from "./editor-network-diagnostic";

const editorUrl = "https://creator.xiaohongshu.com/publish/publish";
const metadata: XhsEditorNetworkDiagnosticMetadata = {
  operationId: "network-diagnostic-operation",
  accountId: "network-diagnostic-account",
  contextDebugId: "network-diagnostic-context",
  pageDebugId: "network-diagnostic-page"
};

type Listener = (payload: unknown) => void;

function fakeCdp(): {
  session: CDPSession;
  emit: (event: string, payload: unknown) => void;
  send: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  activeListenerCount: () => number;
} {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, payload: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const send = vi.fn(async () => ({}));
  const detach = vi.fn(async () => undefined);
  const session = {
    on: (event: string, listener: Listener) => {
      const bucket = listeners.get(event) ?? new Set<Listener>();
      bucket.add(listener);
      listeners.set(event, bucket);
      return session;
    },
    off: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
      return session;
    },
    send,
    detach
  } as unknown as CDPSession;
  return { session, emit, send, detach, activeListenerCount: () => [...listeners.values()].reduce((count, bucket) => count + bucket.size, 0) };
}

function fakePage(cdp: ReturnType<typeof fakeCdp>, emitNetwork: () => void): { page: Page; reload: ReturnType<typeof vi.fn> } {
  const listeners = new Map<string, Set<Listener>>();
  const on = (event: string, listener: Listener): void => {
    const bucket = listeners.get(event) ?? new Set<Listener>();
    bucket.add(listener);
    listeners.set(event, bucket);
  };
  const off = (event: string, listener: Listener): void => { listeners.get(event)?.delete(listener); };
  const reload = vi.fn(async () => { emitNetwork(); });
  const page = {
    url: () => `${editorUrl}?token=secret#fragment`,
    context: () => ({ newCDPSession: vi.fn(async () => cdp.session), serviceWorkers: vi.fn(() => []) }),
    on,
    off,
    evaluate: vi.fn(async (fn: () => unknown) => {
      const source = String(fn);
      if (source.includes("nonEmptyControlCount")) return { readyState: "complete", origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", nonEmptyControlCount: 0 };
      return { href: editorUrl, readyState: "complete" };
    }),
    reload
  };
  return { page: page as unknown as Page, reload };
}

describe("Xiaohongshu editor CDP network diagnostic", () => {
  it("captures method, request id, response presence, and loading failure detail without unsafe URL data", async () => {
    const cdp = fakeCdp();
    const fake = fakePage(cdp, () => {
      cdp.emit("Network.requestWillBeSent", { requestId: "req-1", type: "Fetch", request: { url: "https://creator.xiaohongshu.com/api/bootstrap?token=secret", method: "POST", headers: { Authorization: "secret" }, postData: "secret-body" } });
      cdp.emit("Network.loadingFailed", { requestId: "req-1", type: "Fetch", errorText: "net::ERR_FAILED", canceled: false });
    });
    const result = await runXhsEditorNetworkFailureDiagnostic(fake.page, metadata, { cdpSession: cdp.session, maxWaitMs: 0 });

    expect(fake.reload).toHaveBeenCalledTimes(1);
    expect(result.failedFetchesSafe).toEqual([expect.objectContaining({ requestId: "req-1", method: "POST", resourceType: "fetch", origin: "https://creator.xiaohongshu.com", pathname: "/api/bootstrap", responseObserved: false, httpStatus: null, errorText: "net::ERR_FAILED", canceled: false })]);
    expect(result.rootCauseClass).toBe("K_UNKNOWN_NET_ERR_FAILED_AFTER_DEEP_DIAGNOSTIC");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("secret-body");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("?");
  });

  it("correlates duplicate endpoints and records response status, service worker, and blocked metadata", async () => {
    const cdp = fakeCdp();
    const fake = fakePage(cdp, () => {
      for (const requestId of ["req-1", "req-2"]) {
        cdp.emit("Network.requestWillBeSent", { requestId, type: "XHR", request: { url: "https://creator.xiaohongshu.com/api/bootstrap", method: "GET" } });
        cdp.emit("Network.responseReceived", { requestId, type: "XHR", response: { status: 403, fromServiceWorker: true } });
        cdp.emit("Network.loadingFailed", { requestId, type: "XHR", errorText: "net::ERR_FAILED", blockedReason: "inspector", canceled: true });
      }
    });
    const result = await runXhsEditorNetworkFailureDiagnostic(fake.page, metadata, { cdpSession: cdp.session, maxWaitMs: 0 });

    expect(result.failedFetchesSafe[0]).toMatchObject({ responseObserved: true, httpStatus: 403, blockedReason: "inspector", canceled: true, fromServiceWorker: true });
    expect(result.failedFetchEndpointGroups).toEqual([expect.objectContaining({ method: "GET", resourceType: "xhr", pathname: "/api/bootstrap", occurrenceCount: 2 })]);
    expect(result.bootstrapHttpFailure).toBe(true);
    expect(result.serviceWorkerInvolvement).toBe("OBSERVED");
    expect(result.rootCauseClass).toBe("B_CLIENT_OR_CHROMIUM_BLOCK");
    expect(cdp.activeListenerCount()).toBe(0);
    expect(cdp.detach).toHaveBeenCalledTimes(1);
  });

  it("classifies the bounded A-K failure categories fail-closed", () => {
    const base: XhsEditorNetworkCauseEvidence = { failedFetches: [], pageErrorCount: 0, consoleErrorCount: 0, serviceWorkerInvolvement: "NOT_OBSERVED", reloadRecovered: false, readyStateComplete: false };
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ blockedReason: "cors", corsErrorStatus: { corsError: "MissingAllowOriginHeader", failedParameter: "origin" } }] })).toBe("A_CORS_OR_PREFLIGHT_FAILURE");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ blockedReason: "inspector" }] })).toBe("B_CLIENT_OR_CHROMIUM_BLOCK");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ errorText: "net::ERR_CERT_AUTHORITY_INVALID" }] })).toBe("C_TLS_OR_CERTIFICATE_FAILURE");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ errorText: "net::ERR_PROXY_CONNECTION_FAILED" }] })).toBe("D_PROXY_OR_NETWORK_CONFIGURATION_FAILURE");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ errorText: "net::ERR_NAME_NOT_RESOLVED" }] })).toBe("E_DNS_OR_CONNECTION_FAILURE");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ canceled: true }] })).toBe("F_REQUEST_ABORTED_BY_PAGE_RUNTIME");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ fromServiceWorker: true }] })).toBe("G_SERVICE_WORKER_RUNTIME_FAILURE");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ responseObserved: true, httpStatus: 500 }] })).toBe("H_PLATFORM_BOOTSTRAP_API_HTTP_FAILURE");
    expect(classifyXhsEditorNetworkRootCause({ ...base, pageErrorCount: 1 })).toBe("I_PLATFORM_JS_FETCH_FAILURE_WITHOUT_NETWORK_DETAIL");
    expect(classifyXhsEditorNetworkRootCause({ ...base, reloadRecovered: true, readyStateComplete: true })).toBe("J_TRANSIENT_FAILURE_RECOVERED_AFTER_SINGLE_RELOAD");
    expect(classifyXhsEditorNetworkRootCause({ ...base, failedFetches: [{ errorText: "net::ERR_FAILED" }] })).toBe("K_UNKNOWN_NET_ERR_FAILED_AFTER_DEEP_DIAGNOSTIC");
  });

  it("rejects non-fixed routes without CDP attachment or reload", async () => {
    const cdp = fakeCdp();
    const fake = fakePage(cdp, () => undefined);
    Object.defineProperty(fake.page, "url", { value: () => "https://creator.xiaohongshu.com/new/home" });
    const result = await runXhsEditorNetworkFailureDiagnostic(fake.page, metadata, { cdpSession: cdp.session, maxWaitMs: 0 });
    expect(result.status).toBe("BLOCKED");
    expect(result.reloadCount).toBe(0);
    expect(fake.reload).not.toHaveBeenCalled();
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it("classifies safe URL scheme, class, host, and path shape without retaining a raw URL", () => {
    expect(classifyXhsEditorRequestUrl("https://creator.xiaohongshu.com/api/example?token=secret")).toEqual({ urlScheme: "https", urlClass: "HTTP_NETWORK_REQUEST", hostPresent: true, hostCategory: "xiaohongshu_creator", pathShape: "api_like", safeOrigin: "https://creator.xiaohongshu.com", safePathname: "/api/example" });
    expect(classifyXhsEditorRequestUrl("blob:https://creator.xiaohongshu.com/opaque-id")).toMatchObject({ urlScheme: "blob", urlClass: "BLOB_RESOURCE", hostPresent: true, hostCategory: "xiaohongshu_creator", pathShape: "opaque" });
    expect(classifyXhsEditorRequestUrl("data:text/plain,secret")).toMatchObject({ urlScheme: "data", urlClass: "DATA_RESOURCE", hostPresent: false, hostCategory: "none", pathShape: "opaque" });
    expect(classifyXhsEditorRequestUrl("file:///tmp/example")).toMatchObject({ urlScheme: "file", urlClass: "FILE_RESOURCE", hostPresent: false, hostCategory: "none" });
    expect(classifyXhsEditorRequestUrl("about:blank")).toMatchObject({ urlScheme: "about", urlClass: "BROWSER_INTERNAL_RESOURCE", hostPresent: false, hostCategory: "none", pathShape: "blank" });
    expect(classifyXhsEditorRequestUrl("not a URL")).toEqual({ urlScheme: "other", urlClass: "MALFORMED_OR_UNPARSEABLE", hostPresent: false, hostCategory: "unknown", pathShape: "malformed", safeOrigin: null, safePathname: null });
    expect(JSON.stringify(classifyXhsEditorRequestUrl("https://creator.xiaohongshu.com/api/example?token=secret"))).not.toContain("secret");
  });

  it("extracts only a valid extension id and bounded pathname from a chrome-extension URL", () => {
    expect(extractSafeExtensionResourceIdentity("chrome-extension://abcdefghijklmnopabcdefghijklmnop/assets/worker.js?token=secret")).toEqual({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      pathname: "/assets/worker.js"
    });
    expect(JSON.stringify(extractSafeExtensionResourceIdentity("chrome-extension://abcdefghijklmnopabcdefghijklmnop/assets/worker.js?token=secret"))).not.toContain("secret");
    expect(extractSafeExtensionResourceIdentity("chrome-extension://not-an-extension-id/assets/worker.js")).toEqual({ extensionId: null, pathname: null });
    expect(extractSafeExtensionResourceIdentity("https://example.test/assets/worker.js")).toEqual({ extensionId: null, pathname: null });
  });

  it("retains the safe extension identity on failed requests without exposing the extension host or query", async () => {
    const cdp = fakeCdp();
    const fake = fakePage(cdp, () => {
      cdp.emit("Network.requestWillBeSent", {
        requestId: "req-extension",
        type: "Fetch",
        request: { url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/assets/worker.js?secret=body", method: "GET", postData: "do-not-retain" }
      });
      cdp.emit("Network.loadingFailed", { requestId: "req-extension", type: "Fetch", errorText: "net::ERR_FAILED", canceled: false });
    });
    const result = await runXhsEditorNetworkFailureDiagnostic(fake.page, metadata, { cdpSession: cdp.session, maxWaitMs: 0 });
    expect(result.failedFetchesSafe[0]).toMatchObject({ extensionId: "abcdefghijklmnopabcdefghijklmnop", extensionPathname: "/assets/worker.js" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("do-not-retain");
    expect(serialized).not.toContain("chrome-extension://");
  });

  it("captures bounded initiator type and at most three safe stack frames", async () => {
    const cdp = fakeCdp();
    const fake = fakePage(cdp, () => {
      cdp.emit("Network.requestWillBeSent", {
        requestId: "req-init", type: "Fetch",
        request: { url: "https://creator.xiaohongshu.com/api/bootstrap?token=secret", method: "GET" },
        initiator: {
          type: "script",
          stack: { callFrames: [
            { url: "https://creator.xiaohongshu.com/assets/app.js?token=secret", lineNumber: 10, columnNumber: 2 },
            { url: "https://third.example/vendor.js?secret=1", lineNumber: 20, columnNumber: 3 },
            { url: "about:blank", lineNumber: 30, columnNumber: 4 },
            { url: "https://creator.xiaohongshu.com/assets/extra.js", lineNumber: 40, columnNumber: 5 }
          ] }
        }
      });
      cdp.emit("Network.loadingFailed", { requestId: "req-init", type: "Fetch", errorText: "net::ERR_FAILED", canceled: false });
    });
    const result = await runXhsEditorNetworkFailureDiagnostic(fake.page, metadata, { cdpSession: cdp.session, maxWaitMs: 0 });
    const failure = result.failedFetchesSafe[0];
    expect(failure).toMatchObject({ urlScheme: "https", urlClass: "HTTP_NETWORK_REQUEST", hostPresent: true, hostCategory: "xiaohongshu_creator", pathShape: "api_like", initiatorType: "script" });
    expect(failure.initiatorSafe).toEqual({ type: "script", frames: [
      { scriptUrlScheme: "https", safeOriginCategory: "xiaohongshu_creator", pathname: "/assets/app.js", lineNumber: 10, columnNumber: 2 },
      { scriptUrlScheme: "https", safeOriginCategory: "third_party", pathname: null, lineNumber: 20, columnNumber: 3 },
      { scriptUrlScheme: "about", safeOriginCategory: "none", pathname: null, lineNumber: 30, columnNumber: 4 }
    ] });
    expect(result.commonInitiator).toBe(true);
    expect(result.commonInitiatorSafePathname).toBe("/assets/app.js");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("third.example");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("extra.js");
  });

  it("classifies the bounded bootstrap URL classes and does not call non-HTTP resources API failures", () => {
    expect(classifyXhsEditorBootstrapFailureClass([{ urlClass: "HTTP_NETWORK_REQUEST", hostCategory: "xiaohongshu_creator" }], false)).toBe("A_HTTP_NETWORK_FETCH_FAILURE");
    expect(classifyXhsEditorBootstrapFailureClass([{ urlClass: "BLOB_RESOURCE", hostCategory: "xiaohongshu_creator" }], false)).toBe("B_BLOB_FETCH_FAILURE");
    expect(classifyXhsEditorBootstrapFailureClass([{ urlClass: "DATA_RESOURCE", hostCategory: "none" }], false)).toBe("C_DATA_OR_FILE_FETCH_FAILURE");
    expect(classifyXhsEditorBootstrapFailureClass([{ urlClass: "BROWSER_INTERNAL_RESOURCE", hostCategory: "none" }], false)).toBe("D_BROWSER_INTERNAL_REQUEST_FAILURE");
    expect(classifyXhsEditorBootstrapFailureClass([{ urlClass: "EXTENSION_RESOURCE", hostCategory: "third_party" }], false)).toBe("E_EXTENSION_INTERFERENCE");
    expect(classifyXhsEditorBootstrapFailureClass([{ urlClass: "MALFORMED_OR_UNPARSEABLE", hostCategory: "unknown" }], false)).toBe("F_MALFORMED_REQUEST_URL");
    expect(classifyXhsEditorBootstrapFailureClass([{ urlClass: "OTHER_NON_HTTP", hostCategory: "third_party" }], true)).toBe("H_XHS_SCRIPT_INITIATED_OPAQUE_FETCH_FAILURE");
    expect(classifyXhsEditorBootstrapFailureClass([], false)).toBe("J_STILL_UNKNOWN_AFTER_URL_CLASSIFICATION");
  });
});
