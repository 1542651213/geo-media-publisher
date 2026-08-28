import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import type { BrowserSession, BrowserSessionManager } from "@publisher/adapters-core";
import type { AccountContext } from "@publisher/domain";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { browserAccountConnectionResult, browserAccountDisconnectResult } from "../apps/desktop/src/main/account-connection";
import { XiaohongshuBrowserAdapter } from "../packages/adapters/xiaohongshu/src/browser";
import type { CredentialStore } from "@publisher/security";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Xiaohongshu account routing and identity persistence", () => {
  it("registers one article BrowserAutomation route and rejects video", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
    expect(registry.getForContent("xiaohongshu", "article").manifest).toMatchObject({ platformKey: "xiaohongshu", transport: "browser", integrationMode: "BrowserAutomation", supportsVideo: false });
    expect(() => registry.getForContent("xiaohongshu", "video")).toThrow(/no adapter registered/i);
  });

  it("writes a nickname without inventing externalAccountId", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const account = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "本地小红书账号" });
    const synced = opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", accountName: "仅昵称", browserSessionId: "session-xhs-a", externalAccountId: null, lastVerifiedAt: "2026-08-27T00:00:00.000Z" });

    expect(synced).toMatchObject({ id: account.id, platformKey: "xiaohongshu", accountName: "仅昵称", externalAccountId: null, browserSessionId: "session-xhs-a", loginStatus: "logged_in", connectionMode: "BrowserAutomation" });
    expect(opened.repository.listAccounts().filter((candidate) => candidate.platformKey === "xiaohongshu")).toHaveLength(1);
  });

  it("does not merge a second account when identity evidence belongs to another account", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-isolation-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const first = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 A" });
    const second = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 B" });

    const syncedFirst = opened.repository.syncBrowserPlatformAccount({ accountId: first.id, platformKey: "xiaohongshu", accountName: "创作者昵称", externalAccountId: "same-stable-profile", browserSessionId: "session:xiaohongshu:" + first.id });
    expect(syncedFirst.id).toBe(first.id);
    expect(() => opened.repository.syncBrowserPlatformAccount({ accountId: second.id, platformKey: "xiaohongshu", accountName: "创作者昵称", externalAccountId: "same-stable-profile", browserSessionId: "session:xiaohongshu:" + second.id })).toThrow(/外部账号.*其他内部账号|external.*account/i);
    expect(opened.repository.listAccounts().filter((candidate) => candidate.platformKey === "xiaohongshu")).toHaveLength(2);
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === first.id)?.browserSessionId).toContain(first.id);
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === second.id)).toMatchObject({ loginStatus: "unknown", browserSessionId: null });
  });

  it("keeps two Xiaohongshu accounts and sessions independent for different identities", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-multi-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const first = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 A" });
    const second = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 B" });
    opened.repository.syncBrowserPlatformAccount({ accountId: first.id, platformKey: "xiaohongshu", accountName: "创作者甲", externalAccountId: "stable-profile-a", browserSessionId: "session:xiaohongshu:" + first.id });
    opened.repository.syncBrowserPlatformAccount({ accountId: second.id, platformKey: "xiaohongshu", accountName: "创作者乙", externalAccountId: "stable-profile-b", browserSessionId: "session:xiaohongshu:" + second.id });

    expect(opened.repository.listAccounts().filter((candidate) => candidate.platformKey === "xiaohongshu")).toHaveLength(2);
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === first.id)).toMatchObject({ externalAccountId: "stable-profile-a", browserSessionId: "session:xiaohongshu:" + first.id });
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === second.id)).toMatchObject({ externalAccountId: "stable-profile-b", browserSessionId: "session:xiaohongshu:" + second.id });
  });

  it("returns the internal account ID while keeping platform nickname as identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-result-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const account = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "本地容器 A", accountAlias: "本地容器 A" });
    const saved = opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", accountName: "平台昵称", externalAccountId: null, browserSessionId: "session:xiaohongshu:" + account.id });
    const result = browserAccountConnectionResult(saved);

    expect(result).toMatchObject({ accountId: account.id, accountName: "平台昵称", accountStatus: "Connected", authorizationStatus: "Authorized" });
    expect(result.accountId).not.toBe("平台昵称");
  });

  it("classifies a logged-out account with no credential or active Session as an explicit idempotent result", () => {
    expect(browserAccountDisconnectResult({ loginStatus: "logged_out", credentialPresent: false, activeSession: false })).toMatchObject({
      disconnected: true,
      accountStatus: "NotConnected",
      outcome: "ALREADY_DISCONNECTED"
    });
  });

  it("classifies a logged-out account with stale credential as disconnected so cleanup is observable", () => {
    expect(browserAccountDisconnectResult({ loginStatus: "logged_out", credentialPresent: true, activeSession: false })).toMatchObject({
      disconnected: true,
      accountStatus: "NotConnected",
      outcome: "DISCONNECTED"
    });
  });

  it("clears only account B credential and active Session while preserving account A", async () => {
    const credentials = new MemoryCredentialStore();
    const active = new Map<string, BrowserSession>();
    const sessionA = { sessionIdHash: "session-a" } as BrowserSession;
    const sessionB = { sessionIdHash: "session-b" } as BrowserSession;
    active.set("xiaohongshu:account-a", sessionA);
    active.set("xiaohongshu:account-b", sessionB);
    credentials.set("session:xiaohongshu:account-a", "encrypted-a");
    credentials.set("session:xiaohongshu:account-b", "encrypted-b");
    const manager = {
      debugId: "manager-test",
      getActiveSession: (identity: { platformKey: string; accountId: string }) => active.get(`${identity.platformKey}:${identity.accountId}`) ?? null,
      clearActiveSession: (identity: { platformKey: string; accountId: string }, session?: BrowserSession) => {
        const key = `${identity.platformKey}:${identity.accountId}`;
        if (!session || active.get(key) === session) active.delete(key);
      },
      close: async (session: BrowserSession) => {
        for (const [key, current] of active) if (current === session) active.delete(key);
      },
      clear: (identity: { platformKey: string; accountId: string }) => credentials.delete(`session:${identity.platformKey}:${identity.accountId}`)
    } as unknown as BrowserSessionManager;
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: manager });
    const context = (accountId: string): AccountContext => ({ accountId, accountName: accountId, platformKey: "xiaohongshu", settings: {}, secrets: {} });

    await adapter.logout(context("account-b"));

    expect(credentials.has("session:xiaohongshu:account-a")).toBe(true);
    expect(credentials.has("session:xiaohongshu:account-b")).toBe(false);
    expect(active.get("xiaohongshu:account-a")).toBe(sessionA);
    expect(active.has("xiaohongshu:account-b")).toBe(false);
  });

  it("fails closed for an unknown account without selecting the sibling account", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-missing-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const first = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 A" });
    const second = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 B" });

    expect(() => opened.repository.markPlatformAccountDisconnected("missing-account", "xiaohongshu")).toThrow(/账号不存在/iu);
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === first.id)?.loginStatus).toBe("unknown");
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === second.id)?.loginStatus).toBe("unknown");
  });

  it("archives the disconnected account row while leaving the sibling account unchanged", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-disconnect-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const first = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 A" });
    const second = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 B" });
    opened.repository.syncBrowserPlatformAccount({ accountId: first.id, platformKey: "xiaohongshu", accountName: "创作者甲", externalAccountId: "stable-profile-a", browserSessionId: "session:xiaohongshu:" + first.id });
    opened.repository.syncBrowserPlatformAccount({ accountId: second.id, platformKey: "xiaohongshu", accountName: "创作者乙", externalAccountId: "stable-profile-b", browserSessionId: "session:xiaohongshu:" + second.id });
    const beforeFirst = opened.repository.listAccounts().find((candidate) => candidate.id === first.id);

    const disconnected = opened.repository.markPlatformAccountDisconnected(second.id, "xiaohongshu");
    const afterFirst = opened.repository.listAccounts().find((candidate) => candidate.id === first.id);

    expect(disconnected).toMatchObject({ id: second.id, loginStatus: "logged_out", browserSessionId: null, authorizationStatus: "NotAuthorized" });
    expect(opened.repository.listAccounts().filter((candidate) => candidate.platformKey === "xiaohongshu")).toHaveLength(1);
    expect(opened.repository.listAccounts({ includeArchived: true }).filter((candidate) => candidate.platformKey === "xiaohongshu")).toHaveLength(2);
    expect(opened.repository.getAccountById(second.id, "xiaohongshu")).toMatchObject({ archivedAt: expect.any(String) });
    expect(afterFirst).toEqual(beforeFirst);
  });
});
