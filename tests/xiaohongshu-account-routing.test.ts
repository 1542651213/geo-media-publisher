import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { browserAccountConnectionResult } from "../apps/desktop/src/main/account-connection";
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
});
