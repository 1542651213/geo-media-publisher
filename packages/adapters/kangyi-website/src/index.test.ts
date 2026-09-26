import { describe, expect, it, vi } from "vitest";
import { ClientError, type Capabilities, type ClientConfig, type Success } from "@publisher/cms-v2-client";
import { PlatformAdapterError } from "@publisher/adapters-core";
import { KangyiWebsiteAdapter, type KangyiCapabilitiesClient } from "./index";

const capabilities = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  siteId: "kangyi",
  environment: "staging",
  protocolVersion: "2",
  contentKinds: ["article", "case"],
  limits: { jsonBytes: 1_048_576, mediaBytes: 8_388_608, imagePixels: 40_000_000, imageDimension: 10_000 },
  writesEnabled: true,
  ...overrides
});
const context = (secrets: Record<string, string> = {}): Parameters<KangyiWebsiteAdapter["checkLogin"]>[0] => ({ accountId: "account-1", accountName: "康一 staging", platformKey: "kangyi_website", settings: {}, secrets });
const client = (data: Capabilities): KangyiCapabilitiesClient => ({ capabilities: vi.fn(async (): Promise<Success<Capabilities>> => ({ ok: true, data, requestId: "request-1" })) });
const configuredSecrets = { origin: "https://staging.kangyihb.com", siteId: "kangyi", environment: "staging", keyId: "staging-editor", secret: "fixture-secret" };

describe("Kangyi Website Official API adapter", () => {
  it.each(["huiquan", "shupai"] as const)("isolates %s account credentials and capabilities", async (siteId) => {
    const observed: ClientConfig[] = [];
    const adapter = new KangyiWebsiteAdapter({ siteId, clientFactory: (config) => { observed.push(config); return client(capabilities({ siteId })); } });
    const scoped = { ...configuredSecrets, siteId, origin: `https://${siteId}.example.test` };
    const scopedContext = { ...context(scoped), platformKey: `${siteId}_website` };
    await expect(adapter.checkLogin(scopedContext)).resolves.toBe("logged_in");
    expect(observed[0]).toMatchObject({ siteId, origin: scoped.origin });
    await expect(adapter.readRemoteCapabilities({ ...scopedContext, secrets: { ...scoped, siteId: "kangyi" } })).rejects.toMatchObject({ providerCode: "WRONG_SITE" });
    await expect(adapter.readRemoteCapabilities({ ...scopedContext, platformKey: "kangyi_website" })).rejects.toMatchObject({ providerCode: "WRONG_SITE" });
  });
  it("declares the website manifest and credential schema without a secret-file path", () => {
    const adapter = new KangyiWebsiteAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "kangyi_website", integrationMode: "API", transport: "official_api", status: "WaitingForUser", supportsArticle: true, supportsVideo: false });
    expect(adapter.getCredentialSchema().map((field) => [field.key, field.type])).toEqual([["origin", "text"], ["siteId", "text"], ["environment", "text"], ["keyId", "text"], ["secret", "secret"]]);
    expect(adapter.getCapabilities()).toMatchObject({ article: true, video: false, draft: true });
  });

  it("checks signed capabilities using the account credential context and returns a non-secret profile", async () => {
    const observed: ClientConfig[] = [];
    const adapter = new KangyiWebsiteAdapter({ clientFactory: (config) => { observed.push(config); return client(capabilities()); } });
    await expect(adapter.checkLogin(context(configuredSecrets))).resolves.toBe("logged_in");
    const profile = await adapter.getAccountProfile!(context(configuredSecrets));
    expect(profile).toMatchObject({ accountId: "kangyi", accountName: "Kangyi website (staging; staging-editor)", scopes: ["read", "write"], authorizationStatus: "Authorized" });
    expect(JSON.stringify(profile)).not.toContain("fixture-secret");
    expect(observed[0]).toMatchObject({ origin: "https://staging.kangyihb.com", siteId: "kangyi", environment: "staging", keyId: "staging-editor", secret: "fixture-secret" });
  });

  it("rejects a capabilities response for the wrong site or environment", async () => {
    const wrongSite = new KangyiWebsiteAdapter({ clientFactory: () => client(capabilities({ siteId: "other-site" })) });
    await expect(wrongSite.readRemoteCapabilities(context(configuredSecrets))).rejects.toMatchObject({ code: "PERMISSION_DENIED", providerCode: "WRONG_SITE" });
    const wrongEnvironment = new KangyiWebsiteAdapter({ clientFactory: () => client(capabilities({ environment: "production" })) });
    await expect(wrongEnvironment.readRemoteCapabilities(context(configuredSecrets))).rejects.toMatchObject({ code: "PERMISSION_DENIED", providerCode: "WRONG_ENVIRONMENT" });
  });

  it("maps an invalid HMAC response to an expired login without leaking the client error", async () => {
    const adapter = new KangyiWebsiteAdapter({ clientFactory: () => ({ capabilities: vi.fn(async () => { throw new ClientError("BAD_SIGNATURE", "signature rejected", 401, "request-2"); }) }) });
    await expect(adapter.checkLogin(context(configuredSecrets))).resolves.toBe("expired");
  });

  it("keeps authenticated read-only accounts connected when the server disables writes", async () => {
    const adapter = new KangyiWebsiteAdapter({ clientFactory: () => client(capabilities({ writesEnabled: false })) });
    await expect(adapter.checkLogin(context(configuredSecrets))).resolves.toBe("logged_in");
    await expect(adapter.getAccountProfile!(context(configuredSecrets))).resolves.toMatchObject({ scopes: ["read"], authorizationStatus: "Partial" });
  });

  it("fails closed in Phase 1 before constructing a client or calling a CMS write", async () => {
    const factory = vi.fn(() => client(capabilities()));
    const adapter = new KangyiWebsiteAdapter({ clientFactory: factory });
    await expect(adapter.publishArticle(context(configuredSecrets), { articleId: "article-1", title: "标题", body: "正文", summary: "摘要", tags: [], boundImages: [{ assetId: "image-1", name: "cover.png", mimeType: "image/png", sha256: "hash", buffer: new Uint8Array([1, 2, 3]) }] })).rejects.toMatchObject({ code: "API_REVIEW_REQUIRED", providerCode: "PHASE1_PUBLISH_DISABLED" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("surfaces protocol mismatch as a user-action condition on login", async () => {
    const adapter = new KangyiWebsiteAdapter({ clientFactory: () => client(capabilities({ protocolVersion: "1" })) });
    await expect(adapter.checkLogin(context(configuredSecrets))).resolves.toBe("needs_user_action");
    try { await adapter.readRemoteCapabilities(context(configuredSecrets)); } catch (error) { expect(error).toBeInstanceOf(PlatformAdapterError); }
  });
});
