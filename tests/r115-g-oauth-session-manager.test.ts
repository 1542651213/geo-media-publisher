import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, AccountContext, AdapterManifest, LoginSession } from "@publisher/domain";
import type { AppRepository } from "@publisher/db";
import { PlatformAdapterError, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";
import { OAuthSessionManager } from "../apps/desktop/src/main/oauth-session-manager";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }));

const authScope = new AsyncLocalStorage<() => boolean>();
const key = "oauth:example:fixture-account:token";
class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  constructor(private readonly guarded = false) {}
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.assertCurrent(); this.values.set(key, value); }
  delete(key: string): void { this.assertCurrent(); this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
  private assertCurrent(): void {
    const isCurrent = authScope.getStore();
    if (this.guarded && isCurrent && !isCurrent()) throw Object.assign(new Error("fixture stale credential write"), { code: "OAUTH_REQUEST_SUPERSEDED" });
  }
}

const manifest: AdapterManifest = { platformKey: "example", displayName: "Fixture", category: "合成测试", version: "1.0.0", adapterStatus: "ready",
  authStrategy: "OAuth2PKCE", callbackStrategy: "HttpsCallback", status: "Developing", researchStatus: "verified", transport: "official_api",
  supportsArticle: true, supportsVideo: false, officialWebsite: "https://example.test", credentialSchema: [], officialSources: ["https://example.test/docs"] };
const action: UserInitiatedAction = { userActionId: "fixture-user-action", triggerSource: "CONNECT_ACCOUNT" };
const context = (): AccountContext => ({ accountId: "fixture-account", accountName: "合成账号", platformKey: "example", settings: {}, secrets: {} });
const managers: OAuthSessionManager[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function setup(guarded = false) {
  let localAccount: Account = { id: "fixture-account", platformAccountId: "fixture-account", platformKey: "example", accountAlias: "合成账号",
    accountName: "合成远端账号", name: "合成账号", groupId: null, enabled: true, loginStatus: "logged_in", pausedReason: null,
    lastLoginCheck: null, lastPublishAt: null, todayPublishCount: 0, allowAutoPublish: false, publishMode: "manual", minimumIntervalSeconds: 60,
    failedCount: 0, connectionMode: "OAuth", authorizationStatus: "Authorized", browserSessionId: null, externalAccountId: "fixture-remote", archivedAt: null };
  type Authorization = Parameters<AppRepository["upsertAccountAuthorization"]>[0];
  let authorization: Authorization = { accountId: localAccount.id, platformKey: localAccount.platformKey, authorizationType: "OAuth2PKCE", status: "Authorized",
    scopes: ["publish"], expiresAt: "2030-01-01T00:00:00.000Z", providerAccountId: "fixture-remote", providerAccountName: "合成远端账号" };
  let binding = { companyId: "fixture-company-a", bindingVersion: 1, loginGeneration: 1 }, sequence = 0;
  const repository = {
    getAccountById: vi.fn((accountId: string, platformKey?: string) => accountId === localAccount.id && (!platformKey || platformKey === localAccount.platformKey) ? { ...localAccount } : null),
    updateAccount: vi.fn((accountId: string, patch: Parameters<AppRepository["updateAccount"]>[1]) => {
      if (accountId !== localAccount.id) throw new Error("fixture account missing");
      localAccount = { ...localAccount, ...patch }; return localAccount;
    }),
    upsertAccountAuthorization: vi.fn((input: Authorization) => { authorization = { ...input }; })
  };
  const credentials = new MemoryCredentialStore(guarded);
  credentials.set(key, JSON.stringify({ accessToken: "fixture-saved", refreshToken: "fixture-refresh" }));
  const adapter: PlatformAdapter = {
    platformKey: "example", manifest,
    getCapabilities: () => ({ article: true, imagePost: false, video: false, coverImage: false, tags: false, categories: false, scheduledPublish: false,
      draft: true, markdown: false, richText: false, maxTitleLength: 100, maxImageCount: 0 }),
    getCredentialSchema: () => [], checkLogin: async () => "logged_in",
    beginLogin: vi.fn(async (): Promise<LoginSession> => ({ sessionId: `fixture-login-${++sequence}`, requiresUserAction: true,
      authorizationUrl: `https://accounts.example.test/authorize?state=fixture-state-${sequence}`, callbackUrl: "https://app.example.test/callback" })),
    completeLogin: vi.fn(async () => undefined), refreshLogin: vi.fn(async () => undefined),
    getAccountProfile: vi.fn(async () => ({ accountId: "fixture-remote", accountName: "合成远端账号", scopes: ["publish"],
      expiresAt: "2030-02-01T00:00:00.000Z", authorizationStatus: "Authorized" as const })),
    publishArticle: async () => ({ success: true, response: {} })
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const manager = new OAuthSessionManager({ repository, registry: { get: () => adapter }, credentials, logger, accountContext: () => context(),
    sessionFingerprint: () => JSON.stringify(binding), runInAuthScope: <T>(isCurrent: () => boolean, operation: () => Promise<T>) => authScope.run(isCurrent, operation) });
  managers.push(manager);
  return { manager, adapter, repository, credentials, logger,
    snapshot: () => JSON.stringify({ localAccount, authorization, token: credentials.get(key) }),
    change: (changed: "disabled" | "archived" | "company" | "version" | "generation" | "connection" | "identity") => {
      if (changed === "disabled") localAccount = { ...localAccount, enabled: false };
      else if (changed === "archived") localAccount = { ...localAccount, archivedAt: "2026-10-02T08:00:00.000Z" };
      else if (changed === "company") binding = { ...binding, companyId: "fixture-company-b", bindingVersion: 2 };
      else if (changed === "version") binding = { ...binding, bindingVersion: 3 };
      else if (changed === "generation") binding = { ...binding, loginGeneration: 2 };
      else if (changed === "connection") localAccount = { ...localAccount, connectionMode: "Manual" };
      else localAccount = { ...localAccount, externalAccountId: "fixture-new-remote" };
    }, clearWrites: () => { repository.updateAccount.mockClear(); repository.upsertAccountAuthorization.mockClear(); } };
}

afterEach(() => { for (const manager of managers.splice(0)) manager.invalidate("fixture-account", "example"); vi.useRealTimers(); });

describe("R1.15-G OAuth request generations and failure classification", () => {
  it("persists a current successful refresh without exposing tokens", async () => {
    const { manager, repository } = setup();
    await expect(manager.refresh("fixture-account", "example")).resolves.toEqual({ accountStatus: "Connected", authorizationStatus: "Authorized", expiresAt: "2030-02-01T00:00:00.000Z" });
    expect(repository.updateAccount).toHaveBeenCalledWith("fixture-account", expect.objectContaining({ loginStatus: "logged_in" }));
    expect(repository.upsertAccountAuthorization).toHaveBeenCalledWith(expect.objectContaining({ status: "Authorized", providerAccountId: "fixture-remote" }));
  });

  it("lets a new refresh supersede an older refresh before the older response can promote authorization", async () => {
    const fixture = setup(), first = deferred<void>(), second = deferred<void>();
    vi.mocked(fixture.adapter.refreshLogin!).mockImplementationOnce(async () => { await first.promise; }).mockImplementationOnce(async () => { await second.promise; });
    const older = fixture.manager.refresh("fixture-account", "example");
    const rejected = expect(older).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    const newer = fixture.manager.refresh("fixture-account", "example");
    second.resolve(undefined);
    await expect(newer).resolves.toMatchObject({ accountStatus: "Connected" });
    const before = fixture.snapshot();
    first.resolve(undefined);
    await rejected;
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.repository.upsertAccountAuthorization).toHaveBeenCalledTimes(1);
  });

  it("does not reuse an old token in a refresh while a new user authorization session is pending", async () => {
    const { manager, adapter, repository } = setup();
    await manager.begin("fixture-account", "example", action);
    repository.updateAccount.mockClear(); repository.upsertAccountAuthorization.mockClear();
    await expect(manager.refresh("fixture-account", "example")).rejects.toThrow("授权正在进行");
    expect(adapter.refreshLogin).not.toHaveBeenCalled();
    expect(repository.upsertAccountAuthorization).not.toHaveBeenCalled();
    expect(manager.isPending("fixture-account", "example")).toBe(true);
  });

  it.each([
    new PlatformAdapterError("NETWORK_ERROR", "fixture offline"), new PlatformAdapterError("TIMEOUT", "fixture timeout"),
    new PlatformAdapterError("RATE_LIMITED", "fixture rate limit"), new Error("fixture unknown transport failure"),
    new PlatformAdapterError("PERMISSION_DENIED", "fixture scope error", "insufficient_scope"),
    new PlatformAdapterError("PERMISSION_DENIED", "fixture client configuration rejected", "invalid_client"),
    new PlatformAdapterError("LOGIN_EXPIRED", "fixture missing refresh token"), new PlatformAdapterError("AUTH_REQUIRED", "fixture configuration missing")
  ])("keeps saved account, authorization and credentials unchanged for an unproven refresh failure %#", async error => {
    const { manager, adapter, repository, snapshot } = setup();
    vi.mocked(adapter.refreshLogin!).mockRejectedValue(error);
    const before = snapshot();
    await expect(manager.refresh("fixture-account", "example")).rejects.toBe(error);
    expect(snapshot()).toBe(before);
    expect(repository.updateAccount).not.toHaveBeenCalled();
    expect(repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it("expires account authorization only for an explicit current user-token rejection", async () => {
    const { manager, adapter, repository, credentials } = setup();
    vi.mocked(adapter.refreshLogin!).mockRejectedValue(new PlatformAdapterError("LOGIN_EXPIRED", "fixture rejected grant", "invalid_grant"));
    const savedToken = credentials.get(key);
    await expect(manager.refresh("fixture-account", "example")).rejects.toMatchObject({ providerCode: "invalid_grant" });
    expect(repository.updateAccount).toHaveBeenCalledWith("fixture-account", expect.objectContaining({ loginStatus: "expired" }));
    expect(repository.upsertAccountAuthorization).toHaveBeenCalledWith(expect.objectContaining({ status: "Revoked" }));
    expect(credentials.get(key)).toBe(savedToken);
  });

  it("keeps account authorization unchanged after a profile network failure without pretending to undo an already stored refreshed token", async () => {
    const fixture = setup(true);
    vi.mocked(fixture.adapter.refreshLogin!).mockImplementation(async () => { fixture.credentials.set(key, "fixture-current-rotated-token"); });
    vi.mocked(fixture.adapter.getAccountProfile!).mockRejectedValue(new PlatformAdapterError("NETWORK_ERROR", "fixture profile offline"));
    await expect(fixture.manager.refresh("fixture-account", "example")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fixture.credentials.get(key)).toBe("fixture-current-rotated-token");
    expect(fixture.repository.updateAccount).not.toHaveBeenCalled();
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it.each(["disabled", "archived", "company", "version", "generation", "connection", "identity"] as const)("does not promote a late refresh after %s changed", async changed => {
    const fixture = setup(), response = deferred<void>();
    vi.mocked(fixture.adapter.refreshLogin!).mockImplementation(async () => { await response.promise; });
    const refresh = fixture.manager.refresh("fixture-account", "example");
    const rejected = expect(refresh).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    fixture.change(changed);
    const before = fixture.snapshot();
    response.resolve(undefined);
    await rejected;
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.repository.updateAccount).not.toHaveBeenCalled();
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
    expect(fixture.adapter.getAccountProfile).not.toHaveBeenCalled();
  });

  it("does not restore disconnected authorization from a late refresh or close a newer login session", async () => {
    const fixture = setup(), response = deferred<void>();
    vi.mocked(fixture.adapter.refreshLogin!).mockImplementation(async () => { await response.promise; });
    const refresh = fixture.manager.refresh("fixture-account", "example");
    const rejected = expect(refresh).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    fixture.manager.disconnect("fixture-account", "example");
    await fixture.manager.begin("fixture-account", "example", action);
    fixture.clearWrites();
    const before = fixture.snapshot();
    response.resolve(undefined);
    await rejected;
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.manager.isPending("fixture-account", "example")).toBe(true);
    expect(fixture.repository.updateAccount).not.toHaveBeenCalled();
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it("does not revoke a newer login when an old refresh returns a credential rejection", async () => {
    const fixture = setup(), response = deferred<void>();
    vi.mocked(fixture.adapter.refreshLogin!).mockImplementation(async () => { await response.promise; throw new PlatformAdapterError("LOGIN_EXPIRED", "fixture old grant rejected", "invalid_grant"); });
    const refresh = fixture.manager.refresh("fixture-account", "example");
    const rejected = expect(refresh).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    await fixture.manager.begin("fixture-account", "example", action);
    fixture.clearWrites();
    const before = fixture.snapshot();
    response.resolve(undefined);
    await rejected;
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.manager.isPending("fixture-account", "example")).toBe(true);
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it.each(["disabled", "archived", "company", "version", "generation", "connection", "identity"] as const)("does not promote a late OAuth completion after %s changed", async changed => {
    const fixture = setup(), response = deferred<void>();
    await fixture.manager.begin("fixture-account", "example", action);
    fixture.clearWrites();
    vi.mocked(fixture.adapter.completeLogin!).mockImplementation(async () => { await response.promise; });
    const complete = fixture.manager.complete("fixture-account", "example", "https://app.example.test/callback?code=fixture-code&state=fixture-state-1");
    const rejected = expect(complete).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    fixture.change(changed);
    const before = fixture.snapshot();
    response.resolve(undefined);
    await rejected;
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.repository.updateAccount).not.toHaveBeenCalled();
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
    expect(fixture.adapter.getAccountProfile).not.toHaveBeenCalled();
  });

  it("preserves the new pending session when an old completion fails after a new login begins", async () => {
    const fixture = setup(), response = deferred<void>();
    await fixture.manager.begin("fixture-account", "example", action);
    vi.mocked(fixture.adapter.completeLogin!).mockImplementation(async () => { await response.promise; throw new PlatformAdapterError("NETWORK_ERROR", "fixture old request offline"); });
    const complete = fixture.manager.complete("fixture-account", "example", "https://app.example.test/callback?code=fixture-code&state=fixture-state-1");
    const rejected = expect(complete).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    await fixture.manager.begin("fixture-account", "example", action);
    fixture.clearWrites();
    const before = fixture.snapshot();
    response.resolve(undefined);
    await rejected;
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.manager.isPending("fixture-account", "example")).toBe(true);
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it("checks generation again after profile I/O, before any successful account write", async () => {
    const fixture = setup(), response = deferred<void>();
    vi.mocked(fixture.adapter.getAccountProfile!).mockImplementation(async () => { await response.promise; return { accountId: "fixture-remote", authorizationStatus: "Authorized" }; });
    const refresh = fixture.manager.refresh("fixture-account", "example");
    const rejected = expect(refresh).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    await vi.waitFor(() => expect(fixture.adapter.getAccountProfile).toHaveBeenCalled());
    fixture.manager.invalidate("fixture-account", "example");
    const before = fixture.snapshot();
    response.resolve(undefined);
    await rejected;
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a callback without the current Main pending session before exchanging a token", async () => {
    const { manager, adapter, repository } = setup();
    await expect(manager.complete("fixture-account", "example", "https://app.example.test/callback?code=fixture-code&state=fixture-old-state")).rejects.toThrow("授权会话");
    expect(adapter.completeLogin).not.toHaveBeenCalled();
    expect(repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it("does not perform remote OAuth work on a manually disabled account", async () => {
    const fixture = setup();
    fixture.change("disabled");
    await expect(fixture.manager.refresh("fixture-account", "example")).rejects.toThrow("停用");
    await expect(fixture.manager.begin("fixture-account", "example", action)).rejects.toThrow("停用");
    expect(fixture.adapter.refreshLogin).not.toHaveBeenCalled();
    expect(fixture.adapter.beginLogin).not.toHaveBeenCalled();
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });

  it("does not write an old pending timeout into an account whose authoritative state changed", async () => {
    vi.useFakeTimers();
    const fixture = setup();
    await fixture.manager.begin("fixture-account", "example", action);
    fixture.clearWrites();
    fixture.change("company");
    const before = fixture.snapshot();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fixture.snapshot()).toBe(before);
    expect(fixture.repository.updateAccount).not.toHaveBeenCalled();
    expect(fixture.manager.isPending("fixture-account", "example")).toBe(false);
  });

  it("passes Main auth scope over Adapter I/O so a stale encrypted-token write is rejected while ordinary disconnect can still delete", async () => {
    const fixture = setup(true), response = deferred<void>();
    vi.mocked(fixture.adapter.refreshLogin!).mockImplementation(async () => { await response.promise; fixture.credentials.set(key, "fixture-late-token"); });
    const refresh = fixture.manager.refresh("fixture-account", "example");
    const rejected = expect(refresh).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    fixture.change("company");
    const tokenBefore = fixture.credentials.get(key);
    response.resolve(undefined);
    await rejected;
    expect(fixture.credentials.get(key)).toBe(tokenBefore);
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
    fixture.manager.disconnect("fixture-account", "example");
    expect(fixture.credentials.has(key)).toBe(false);
  });

  it("does not claim Main guards undo an Adapter token write when the optional credential wrapper is absent", async () => {
    const fixture = setup(false), response = deferred<void>();
    vi.mocked(fixture.adapter.refreshLogin!).mockImplementation(async () => { await response.promise; fixture.credentials.set(key, "fixture-adapter-write-already-happened"); });
    const refresh = fixture.manager.refresh("fixture-account", "example");
    const rejected = expect(refresh).rejects.toMatchObject({ code: "OAUTH_REQUEST_SUPERSEDED" });
    fixture.change("company");
    response.resolve(undefined);
    await rejected;
    expect(fixture.credentials.get(key)).toBe("fixture-adapter-write-already-happened");
    expect(fixture.repository.upsertAccountAuthorization).not.toHaveBeenCalled();
  });
});
