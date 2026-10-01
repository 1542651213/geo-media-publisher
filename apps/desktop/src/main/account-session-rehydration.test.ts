import { describe, expect, it, vi } from "vitest";
import { PlatformAdapterError, type BrowserSession, type BrowserSessionManager, type PlatformAdapter } from "@publisher/adapters-core";
import { AccountSessionRehydrationCoordinator, type AccountSessionTarget } from "./account-session-rehydration";

const browserSession = { executionMode: "BACKGROUND", headless: true } as BrowserSession;

function target(overrides: Partial<AccountSessionTarget> = {}): AccountSessionTarget {
  return {
    accountId: "account-a",
    accountName: "运营账号 A",
    platformKey: "weibo",
    companyId: "company-a",
    connectionMode: "BrowserAutomation",
    enabled: true,
    expectedRemoteIdentity: "remote-a",
    loginGeneration: 3,
    ...overrides
  };
}

function adapter(input: { login?: "logged_in" | "logged_out" | "expired" | "needs_user_action" | "unknown"; remoteIdentity?: string; error?: unknown; transport?: "browser" | "official_api"; writable?: boolean }): PlatformAdapter {
  return {
    platformKey: "fixture",
    manifest: { transport: input.transport ?? "browser" },
    checkLogin: vi.fn(async () => {
      if (input.error) throw input.error;
      return input.login ?? "logged_in";
    }),
    getAccountProfile: vi.fn(async () => ({ accountId: input.remoteIdentity ?? "remote-a", accountName: "远端账号",
      scopes: input.writable === false ? ["read"] : ["read", "write"], authorizationStatus: input.writable === false ? "Partial" : "Authorized" }))
  } as unknown as PlatformAdapter;
}

function fixture(adapters: Record<string, PlatformAdapter>, companies: Record<string, string | null | Error>, restore: BrowserSessionManager["restore"] = vi.fn(async () => browserSession),
  resolveAuthoritativeTarget?: (accountId: string, platformKey: string) => AccountSessionTarget | null | Promise<AccountSessionTarget | null>,
  resolveAdapter?: (target: AccountSessionTarget) => PlatformAdapter | null) {
  const browserSessions = { restore } as unknown as BrowserSessionManager;
  const coordinator = new AccountSessionRehydrationCoordinator({
    registry: { tryGetForConnection: (platformKey: string) => adapters[platformKey] ?? null },
    browserSessions,
    resolveCompanyId: (accountId) => {
      const company = companies[accountId];
      if (company instanceof Error) throw company;
      return company ?? null;
    },
    resolveAuthoritativeTarget,
    resolveAdapter,
    resolveSecrets: () => ({ pat: "write-only-fixture" }),
    concurrency: 1,
    now: () => new Date("2026-10-01T08:00:00.000Z")
  });
  return { coordinator, restore };
}

describe("AccountSessionRehydrationCoordinator", () => {
  it("restores a valid browser session and confirms the exact remote identity", async () => {
    const remote = adapter({ remoteIdentity: "remote-a" });
    const { coordinator, restore } = fixture({ weibo: remote }, { "account-a": "company-a" });

    const snapshot = await coordinator.refresh(target(), "STARTUP");

    expect(snapshot).toEqual({ accountId: "account-a", platformKey: "weibo", companyId: "company-a", state: "AUTHENTICATED", source: "STARTUP", checkedAt: "2026-10-01T08:00:00.000Z", reasonCode: null, identityMatched: true, loginGeneration: 3 });
    expect(restore).toHaveBeenCalledWith({ platformKey: "weibo", accountId: "account-a" });
    expect(remote.checkLogin).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-a", platformKey: "weibo", settings: expect.objectContaining({ triggerSource: "APP_STARTUP", browserExecutionMode: "BACKGROUND", expectedCreatorId: "remote-a", expectedLoginGeneration: 3 }) }));
  });

  it.each([
    ["expired", "NEEDS_LOGIN", "LOGIN_EXPIRED"],
    ["logged_out", "NEEDS_LOGIN", "LOGIN_REQUIRED"]
  ] as const)("maps a browser %s result without trusting persisted login metadata", async (login, state, reasonCode) => {
    const { coordinator } = fixture({ weibo: adapter({ login }) }, { "account-a": "company-a" });
    await expect(coordinator.refresh(target(), "STARTUP")).resolves.toMatchObject({ state, reasonCode, identityMatched: false });
  });

  it("keeps an offline account distinct from an expired login", async () => {
    const { coordinator } = fixture({ weibo: adapter({ error: new PlatformAdapterError("NETWORK_ERROR", "offline fixture") }) }, { "account-a": "company-a" });
    await expect(coordinator.refresh(target(), "STARTUP")).resolves.toMatchObject({ state: "NETWORK_UNAVAILABLE", reasonCode: "NETWORK_ERROR", identityMatched: false });
  });

  it("keeps a typed timeout distinct from an expired login even when its message is generic", async () => {
    const { coordinator } = fixture({ weibo: adapter({ error: new PlatformAdapterError("TIMEOUT", "temporary failure") }) }, { "account-a": "company-a" });
    await expect(coordinator.refresh(target(), "STARTUP")).resolves.toMatchObject({ state: "NETWORK_UNAVAILABLE", reasonCode: "TIMEOUT", identityMatched: false });
  });

  it("rejects a live session whose remote identity differs from the binding", async () => {
    const { coordinator } = fixture({ weibo: adapter({ remoteIdentity: "remote-b" }) }, { "account-a": "company-a" });
    await expect(coordinator.refresh(target(), "STARTUP")).resolves.toMatchObject({ state: "IDENTITY_MISMATCH", reasonCode: "REMOTE_IDENTITY_MISMATCH", identityMatched: false });
  });

  it("does not promote a stale live result after the authoritative login generation changes", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let current = target();
    const remote = adapter({ remoteIdentity: "remote-a" });
    vi.mocked(remote.checkLogin).mockImplementation(async () => { await pending; return "logged_in"; });
    const { coordinator } = fixture({ weibo: remote }, { "account-a": "company-a" }, undefined,
      async (accountId, platformKey) => accountId === current.accountId && platformKey === current.platformKey ? current : null);

    const refreshing = coordinator.refresh(target(), "STARTUP");
    await Promise.resolve();
    current = target({ loginGeneration: 4 });
    release();

    await expect(refreshing).resolves.toMatchObject({ state: "UNVERIFIED", reasonCode: "LOGIN_GENERATION_CHANGED", identityMatched: false });
  });

  it("snapshots the requested binding so caller mutation cannot disguise a generation change", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const mutable = target();
    const remote = adapter({ remoteIdentity: "remote-a" });
    vi.mocked(remote.checkLogin).mockImplementation(async () => { await pending; return "logged_in"; });
    const { coordinator } = fixture({ weibo: remote }, { "account-a": "company-a" }, undefined, async () => mutable);

    const refreshing = coordinator.refresh(mutable, "STARTUP");
    await Promise.resolve();
    mutable.loginGeneration = 4;
    release();

    await expect(refreshing).resolves.toMatchObject({ state: "UNVERIFIED", reasonCode: "LOGIN_GENERATION_CHANGED", loginGeneration: 3 });
  });

  it("does not promote a stale live result after the company binding changes", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const companies: Record<string, string | null | Error> = { "account-a": "company-a" };
    const remote = adapter({ remoteIdentity: "remote-a" });
    vi.mocked(remote.getAccountProfile!).mockImplementation(async () => { await pending; return { accountId: "remote-a", authorizationStatus: "Authorized", scopes: ["read", "write"] }; });
    const { coordinator } = fixture({ weibo: remote }, companies);

    const refreshing = coordinator.refresh(target(), "STARTUP");
    await vi.waitFor(() => expect(remote.getAccountProfile).toHaveBeenCalled());
    companies["account-a"] = "company-b";
    release();

    await expect(refreshing).resolves.toMatchObject({ state: "IDENTITY_MISMATCH", reasonCode: "COMPANY_BINDING_CHANGED", identityMatched: false });
  });

  it("uses an adapter's read-only owned-identity probe when the generic profile API is unavailable", async () => {
    const remote = adapter({ remoteIdentity: "unused" }) as PlatformAdapter & { inspectOwnedCreatorIdentity: ReturnType<typeof vi.fn> };
    delete (remote as Partial<PlatformAdapter>).getAccountProfile;
    remote.inspectOwnedCreatorIdentity = vi.fn(async () => "remote-a");
    const { coordinator } = fixture({ toutiao: remote }, { "account-a": "company-a" });

    await expect(coordinator.refresh(target({ platformKey: "toutiao" }), "STARTUP")).resolves.toMatchObject({ state: "AUTHENTICATED", identityMatched: true });
    expect(remote.inspectOwnedCreatorIdentity).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-a", platformKey: "toutiao" }));
  });

  it("returns a safe UNVERIFIED snapshot when the local company binding cannot be resolved", async () => {
    const { coordinator, restore } = fixture({ weibo: adapter({ remoteIdentity: "remote-a" }) }, { "account-a": new Error("private database path") });
    await expect(coordinator.refresh(target(), "STARTUP")).resolves.toMatchObject({ state: "UNVERIFIED", reasonCode: "COMPANY_BINDING_UNAVAILABLE" });
    expect(restore).not.toHaveBeenCalled();
  });

  it("requires restorable browser material instead of DB login flags", async () => {
    const remote = adapter({ remoteIdentity: "remote-a" });
    const { coordinator } = fixture({ weibo: remote }, { "account-a": "company-a" }, vi.fn(async () => null));
    await expect(coordinator.refresh(target(), "STARTUP")).resolves.toMatchObject({ state: "NEEDS_LOGIN", reasonCode: "BROWSER_SESSION_MISSING" });
    expect(remote.checkLogin).not.toHaveBeenCalled();
  });

  it("rehydrates valid API credentials as CONNECTED and invalid credentials separately", async () => {
    const website = adapter({ remoteIdentity: "kangyi:production", transport: "official_api" });
    const cnblogs = adapter({ login: "expired", transport: "official_api" });
    const { coordinator, restore } = fixture({ website, cnblogs }, { website: "company-a", cnblogs: "company-a" });

    const snapshots = await coordinator.rehydrate([
      target({ accountId: "website", platformKey: "website", connectionMode: "OfficialAPI", expectedRemoteIdentity: "kangyi:production" }),
      target({ accountId: "cnblogs", platformKey: "cnblogs", connectionMode: "OfficialAPI", expectedRemoteIdentity: "kangyi-blog" })
    ]);

    expect(snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: "website", state: "CONNECTED", identityMatched: true }),
      expect.objectContaining({ accountId: "cnblogs", state: "CREDENTIAL_INVALID", reasonCode: "CREDENTIAL_INVALID" })
    ]));
    expect(restore).not.toHaveBeenCalled();
    expect(coordinator.isInitialRehydrationComplete()).toBe(true);
  });

  it("resolves the exact Douyin route instead of applying the registry's preferred API adapter to a browser target", async () => {
    const preferredApi = adapter({ login: "expired", transport: "official_api" });
    const browserArticle = adapter({ remoteIdentity: "creator-browser", transport: "browser" });
    const restore = vi.fn(async () => browserSession);
    const { coordinator } = fixture({ douyin: preferredApi }, { browser: "company-a", api: "company-a" }, restore, undefined,
      (current) => current.connectionMode === "BrowserAutomation" ? browserArticle : preferredApi);

    await expect(coordinator.refresh(target({ accountId: "browser", platformKey: "douyin", connectionMode: "BrowserAutomation", expectedRemoteIdentity: "creator-browser" }), "STARTUP"))
      .resolves.toMatchObject({ state: "AUTHENTICATED", identityMatched: true });
    await expect(coordinator.refresh(target({ accountId: "api", platformKey: "douyin", connectionMode: "OAuth", expectedRemoteIdentity: "creator-api" }), "STARTUP"))
      .resolves.toMatchObject({ state: "CREDENTIAL_INVALID", reasonCode: "CREDENTIAL_INVALID" });

    expect(browserArticle.checkLogin).toHaveBeenCalledTimes(1);
    expect(preferredApi.checkLogin).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith({ platformKey: "douyin", accountId: "browser" });
  });

  it("does not report a read-only Website capability profile as normally CONNECTED", async () => {
    const website = adapter({ remoteIdentity: "kangyi:production", transport: "official_api", writable: false });
    const { coordinator } = fixture({ website }, { website: "company-a" });

    await expect(coordinator.refresh(target({ accountId: "website", platformKey: "website", connectionMode: "OfficialAPI", expectedRemoteIdentity: "kangyi:production" }), "STARTUP"))
      .resolves.toMatchObject({ state: "UNVERIFIED", reasonCode: "WRITE_CAPABILITY_UNAVAILABLE", identityMatched: true });
  });

  it("isolates multiple accounts and refuses a cross-company binding before browser restore", async () => {
    const remoteA = adapter({ remoteIdentity: "remote-a" });
    const remoteB = adapter({ remoteIdentity: "remote-b" });
    const restore = vi.fn(async ({ accountId }: { accountId: string }) => ({ ...browserSession, sessionIdHash: accountId }) as BrowserSession);
    const { coordinator } = fixture({ weibo: remoteA, toutiao: remoteB }, { "account-a": "company-a", "account-b": "company-b", "account-cross": "company-b" }, restore);

    const snapshots = await coordinator.rehydrate([
      target(),
      target({ accountId: "account-b", accountName: "运营账号 B", platformKey: "toutiao", companyId: "company-b", expectedRemoteIdentity: "remote-b" }),
      target({ accountId: "account-cross", companyId: "company-a", expectedRemoteIdentity: "remote-cross" })
    ]);

    expect(snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: "account-a", companyId: "company-a", state: "AUTHENTICATED" }),
      expect.objectContaining({ accountId: "account-b", companyId: "company-b", state: "AUTHENTICATED" }),
      expect.objectContaining({ accountId: "account-cross", companyId: "company-a", state: "IDENTITY_MISMATCH", reasonCode: "COMPANY_BINDING_MISMATCH" })
    ]));
    expect(restore).toHaveBeenCalledTimes(2);
    expect(coordinator.listSnapshots()).not.toEqual(expect.arrayContaining([expect.objectContaining({ accountId: "account-cross", state: "AUTHENTICATED" })]));
  });

  it("keeps a duplicate target conflicted when a third entry repeats the first company", async () => {
    const restore = vi.fn(async () => browserSession);
    const { coordinator } = fixture({ weibo: adapter({ remoteIdentity: "remote-a" }) }, { "account-a": "company-a" }, restore);

    const snapshots = await coordinator.rehydrate([
      target({ companyId: "company-a" }),
      target({ companyId: "company-b" }),
      target({ companyId: "company-a" })
    ]);

    expect(restore).not.toHaveBeenCalled();
    expect(snapshots).toEqual(expect.arrayContaining([expect.objectContaining({ state: "IDENTITY_MISMATCH", reasonCode: "COMPANY_BINDING_CONFLICT" })]));
  });

  it("deduplicates simultaneous refresh callbacks for the exact account/platform binding", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const remote = adapter({ remoteIdentity: "remote-a" });
    vi.mocked(remote.checkLogin).mockImplementation(async () => { await pending; return "logged_in"; });
    const { coordinator } = fixture({ weibo: remote }, { "account-a": "company-a" });
    const refresh = coordinator.createRefreshCallback(async (accountId, platformKey) => accountId === "account-a" && platformKey === "weibo" ? target() : null);

    const first = refresh("account-a", "weibo");
    const second = refresh("account-a", "weibo");
    await Promise.resolve();
    expect(coordinator.getSnapshot("account-a", "weibo")).toMatchObject({ state: "CHECKING" });
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ state: "AUTHENTICATED" }), expect.objectContaining({ state: "AUTHENTICATED" })]);
    expect(remote.checkLogin).toHaveBeenCalledTimes(1);
    await expect(refresh("account-a", "toutiao")).resolves.toBeNull();
  });
});
