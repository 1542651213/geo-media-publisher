import { describe, expect, it, vi } from "vitest";
import type { AccountContext, AdapterManifest, LoginSession } from "@publisher/domain";
import type { PlatformAdapter, UserInitiatedAction } from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";
import { OAuthSessionManager } from "../apps/desktop/src/main/oauth-session-manager";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }));

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

const manifest: AdapterManifest = {
  platformKey: "example",
  displayName: "Example",
  category: "测试",
  version: "1.0.0",
  adapterStatus: "ready",
  authStrategy: "OAuth2PKCE",
  callbackStrategy: "HttpsCallback",
  status: "Developing",
  researchStatus: "verified",
  transport: "official_api",
  supportsArticle: true,
  supportsVideo: false,
  officialWebsite: "https://example.test",
  credentialSchema: [],
  officialSources: ["https://example.test/docs"]
};

function context(): AccountContext { return { accountId: "account-1", accountName: "本地账号", platformKey: "example", settings: {}, secrets: {} }; }
const connectAction: UserInitiatedAction = { userActionId: "test-connect-action", triggerSource: "CONNECT_ACCOUNT" };

function setup(): { manager: OAuthSessionManager; adapter: PlatformAdapter; repository: Record<string, ReturnType<typeof vi.fn>>; credentials: MemoryCredentialStore } {
  const repository = {
    updateAccount: vi.fn(),
    upsertAccountAuthorization: vi.fn(),
    getAccountAuthorization: vi.fn().mockReturnValue(null)
  };
  const credentials = new MemoryCredentialStore();
  const adapter: PlatformAdapter = {
    platformKey: "example",
    manifest,
    getCapabilities: () => ({ article: true, imagePost: false, video: false, coverImage: false, tags: false, categories: false, scheduledPublish: false, draft: true, markdown: false, richText: false, maxTitleLength: 100, maxImageCount: 0 }),
    getCredentialSchema: () => [],
    checkLogin: async () => "logged_out",
    beginLogin: vi.fn(async (): Promise<LoginSession> => ({ sessionId: "oauth-session", requiresUserAction: true, authorizationUrl: "https://accounts.example.test/oauth?state=state-1", callbackUrl: "https://app.example.test/oauth/callback", message: "完成授权" })),
    completeLogin: vi.fn().mockResolvedValue(undefined),
    getAccountProfile: vi.fn().mockResolvedValue({ accountId: "provider-1", accountName: "官方账号", scopes: ["publish"], expiresAt: "2026-08-22T00:00:00.000Z", authorizationStatus: "Authorized" }),
    publishArticle: async () => ({ success: true, response: {} })
  };
  const manager = new OAuthSessionManager({ repository: repository as never, registry: { get: () => adapter } as never, credentials, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, accountContext: () => context() });
  return { manager, adapter, repository, credentials };
}

describe("V0.9.3.2 OAuthSessionManager", () => {
  it("opens the Adapter-generated official OAuth URL and never exposes a token", async () => {
    const { manager } = setup();
    const session = await manager.begin("account-1", "example", connectAction);
    expect(session).toMatchObject({ opened: true, authStrategy: "OAuth2PKCE", callbackStrategy: "HttpsCallback" });
    expect(session.authorizationUrl).toContain("accounts.example.test");
    expect(session).not.toHaveProperty("accessToken");
  });

  it("rejects a mismatched callback state before Adapter token exchange", async () => {
    const { manager, adapter } = setup();
    await manager.begin("account-1", "example", connectAction);
    await expect(manager.complete("account-1", "example", "https://app.example.test/oauth/callback?code=code-1&state=wrong")).rejects.toThrow("state");
    expect(adapter.completeLogin).not.toHaveBeenCalled();
  });

  it("handles callback errors and records only a safe account profile after success", async () => {
    const { manager, adapter, repository } = setup();
    await manager.begin("account-1", "example", connectAction);
    await expect(manager.complete("account-1", "example", "https://app.example.test/oauth/callback?error=access_denied")).rejects.toThrow("OAuth 授权失败");
    const result = await manager.complete("account-1", "example", "https://app.example.test/oauth/callback?code=code-1&state=state-1");
    expect(result).toMatchObject({ accountStatus: "Connected", accountId: "provider-1", accountName: "官方账号", scopes: ["publish"] });
    expect(adapter.completeLogin).toHaveBeenCalledWith(expect.anything(), "code-1", "state-1");
    expect(repository.upsertAccountAuthorization).toHaveBeenCalledWith(expect.objectContaining({ status: "Authorized", providerAccountId: "provider-1", providerAccountName: "官方账号" }));
  });

  it("performs a local disconnect without claiming provider revocation", () => {
    const { manager, credentials, repository } = setup();
    credentials.set("oauth:example:account-1:token", JSON.stringify({ accessToken: "secret" }));
    manager.disconnect("account-1", "example");
    expect(credentials.has("oauth:example:account-1:token")).toBe(false);
    expect(repository.upsertAccountAuthorization).toHaveBeenCalledWith(expect.objectContaining({ status: "NotAuthorized" }));
  });

  it("blocks an OAuth browser launch without an explicit user action", async () => {
    const { manager, adapter } = setup();
    await expect(manager.begin("account-1", "example")).rejects.toThrow("应用启动不会自动打开平台");
    expect(adapter.beginLogin).not.toHaveBeenCalled();
  });
});
