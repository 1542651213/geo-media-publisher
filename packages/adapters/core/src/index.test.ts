import { describe, expect, it } from "vitest";
import type { AdapterManifest, PlatformCapabilities } from "@publisher/domain";
import { AdapterRegistry, defaultCapabilities, type PlatformAdapter } from "./index";

function stub(overrides: { platformKey?: string; manifest?: Partial<AdapterManifest>; capabilities?: Partial<PlatformCapabilities> } = {}): PlatformAdapter {
  const platformKey = overrides.platformKey ?? "stub";
  const capabilities = { ...defaultCapabilities, ...overrides.capabilities };
  const manifest: AdapterManifest = {
    platformKey,
    displayName: "Stub",
    category: "测试",
    version: "0.4.0",
    adapterStatus: "ready",
    authStrategy: "AppCredential",
    callbackStrategy: "ManualCodeCallback",
    status: "CodeComplete",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: capabilities.article,
    supportsVideo: capabilities.video,
    officialWebsite: "https://example.com",
    credentialSchema: [],
    officialSources: ["https://example.com/developer"],
    ...overrides.manifest
  };
  return {
    platformKey,
    manifest,
    getCapabilities: () => capabilities,
    getCredentialSchema: () => manifest.credentialSchema,
    checkLogin: async () => "logged_out",
    beginLogin: async () => ({ sessionId: "stub", requiresUserAction: true }),
    publishArticle: async () => ({ success: true, response: {} })
  };
}

function browserConnectionStub(kind: "article" | "video"): PlatformAdapter {
  const capabilities = kind === "article"
    ? { article: true, video: false }
    : { article: false, video: true };
  const base = stub({
    platformKey: "dual",
    capabilities,
    manifest: {
      supportsArticle: capabilities.article,
      supportsVideo: capabilities.video,
      transport: "browser",
      integrationMode: "BrowserAutomation"
    }
  });
  return {
    ...base,
    connectAccount: async () => ({ sessionId: "browser", requiresUserAction: true }),
    isConnectionPending: () => false,
    completeConnection: async () => "logged_in",
    checkSession: async () => "logged_in",
    openBackend: async () => ({ opened: true, backendUrl: "https://example.com", sessionIdHash: "session-hash" }),
    preparePublish: async () => ({ prepared: true, requiresUserAction: true, message: "prepared", response: {} })
  } as PlatformAdapter;
}

describe("AdapterRegistry manifest gate", () => {
  it("registers a contract-consistent adapter", () => {
    const registry = new AdapterRegistry();
    registry.register(stub());
    expect(registry.get("stub").manifest.status).toBe("CodeComplete");
  });

  it("returns null when an account references an unregistered platform", () => {
    const registry = new AdapterRegistry();
    expect(registry.tryGet("legacy-test-platform")).toBeNull();
  });

  it("rejects a manifest key mismatch", () => {
    const registry = new AdapterRegistry();
    expect(() => registry.register(stub({ manifest: { platformKey: "other" } }))).toThrow(/does not match manifest/u);
  });

  it("rejects capability claims that differ from runtime detection", () => {
    const registry = new AdapterRegistry();
    expect(() => registry.register(stub({ manifest: { supportsVideo: true } }))).toThrow(/video capability/u);
  });

  it("rejects duplicate credential keys", () => {
    const registry = new AdapterRegistry();
    expect(() => registry.register(stub({ manifest: { credentialSchema: [
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientId", label: "Duplicate", type: "secret", required: true }
    ] } }))).toThrow(/duplicate keys/u);
  });

  it("resolves same-platform adapters by content kind and fails closed", () => {
    const registry = new AdapterRegistry();
    const videoAdapter = stub({ platformKey: "dual", capabilities: { article: false, video: true }, manifest: { supportsArticle: false, supportsVideo: true } });
    const articleAdapter = stub({ platformKey: "dual", capabilities: { article: true, video: false }, manifest: { supportsArticle: true, supportsVideo: false } });
    registry.register(videoAdapter);
    registry.register(articleAdapter);

    expect(registry.getForContent("dual", "video")).toBe(videoAdapter);
    expect(registry.getForContent("dual", "article")).toBe(articleAdapter);
    expect(() => registry.getForContent("dual", "image")).toThrow(/unsupported content kind/i);

    const articleOnly = new AdapterRegistry();
    articleOnly.register(articleAdapter);
    expect(() => articleOnly.getForContent("dual", "video")).toThrow(/no adapter registered.*video/i);

    const videoOnly = new AdapterRegistry();
    videoOnly.register(videoAdapter);
    expect(() => videoOnly.getForContent("dual", "article")).toThrow(/no adapter registered.*article/i);
  });

  it("resolves account connection to the unique BrowserAutomation adapter without changing content routing", () => {
    const registry = new AdapterRegistry();
    const videoAdapter = stub({ platformKey: "dual", capabilities: { article: false, video: true }, manifest: { supportsArticle: false, supportsVideo: true } });
    const articleAdapter = browserConnectionStub("article");
    registry.register(videoAdapter);
    registry.register(articleAdapter);

    expect(registry.getForConnection("dual")).toBe(articleAdapter);
    expect(registry.tryGetForConnection("missing")).toBeNull();
    expect(registry.getAccountConnectionMode("dual")).toBe("BrowserAutomation");
    expect(registry.getForContent("dual", "video")).toBe(videoAdapter);
    expect(registry.getForContent("dual", "article")).toBe(articleAdapter);
  });

  it("fails closed when multiple adapters claim account connection for one platform", () => {
    const registry = new AdapterRegistry();
    registry.register(browserConnectionStub("article"));
    registry.register(browserConnectionStub("video"));

    expect(() => registry.getForConnection("dual")).toThrow(/multiple account connection adapters/i);
  });
});
