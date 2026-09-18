import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { BrowserSessionManager, browserSessionCredentialKey } from "@publisher/adapters-core";
import type { BrowserSession } from "@publisher/adapters-core";
import type { AccountContext } from "@publisher/domain";
import { XiaohongshuBrowserAdapter } from "../packages/adapters/xiaohongshu/src/browser";
import type { CredentialStore } from "@publisher/security";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function openFixture() {
  const directory = mkdtempSync(join(tmpdir(), "publisher-account-archive-"));
  tempDirs.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedPlatformCatalog(platformCsv);
  return opened;
}

function browserFixture(credentials: MemoryCredentialStore, active: Map<string, BrowserSession>) {
  const manager = {
    debugId: "archive-test-manager",
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
  return new XiaohongshuBrowserAdapter({ sessionManager: manager });
}

function accountContext(accountId: string): AccountContext {
  return { accountId, accountName: accountId, platformKey: "xiaohongshu", settings: {}, secrets: {} };
}

describe("account disconnect archive lifecycle", () => {
  it("removes A from active accounts while preserving its row, history, and B isolation", async () => {
    const { repository } = openFixture();
    const accountA = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书 A" });
    const accountB = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书 B" });
    repository.syncBrowserPlatformAccount({ accountId: accountA.id, platformKey: "xiaohongshu", accountName: "创作者甲", externalAccountId: "xhs-a", browserSessionId: "session-a" });
    repository.syncBrowserPlatformAccount({ accountId: accountB.id, platformKey: "xiaohongshu", accountName: "创作者乙", externalAccountId: "xhs-b", browserSessionId: "session-b" });
    repository.setSetting("contentReviewMode", "Off");
    const brand = repository.createBrand({ name: "归档测试品牌", companyName: "归档测试公司" });
    const article = repository.createArticle({ brandId: brand.id, topic: "账号归档", keyword: "归档", city: "苏州", title: "账号归档测试", body: "仅用于本地测试", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "account-archive-history" });
    if (!article) throw new Error("fixture article was not created");
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "xiaohongshu", platformAccountId: accountA.id });
    const intent = repository.prepareSubmissionIntent(job.id);
    const record = repository.insertPublishRecord({ jobId: job.id, accountId: accountA.id, platformAccountId: accountA.id, platformKey: "xiaohongshu", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { fixture: true }, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });

    const credentials = new MemoryCredentialStore();
    const active = new Map<string, BrowserSession>();
    const sessionA = { sessionIdHash: "session-a" } as BrowserSession;
    const sessionB = { sessionIdHash: "session-b" } as BrowserSession;
    active.set(`xiaohongshu:${accountA.id}`, sessionA);
    active.set(`xiaohongshu:${accountB.id}`, sessionB);
    credentials.set(`session:xiaohongshu:${accountA.id}`, "encrypted-a");
    credentials.set(`session:xiaohongshu:${accountB.id}`, "encrypted-b");
    await browserFixture(credentials, active).logout(accountContext(accountA.id));

    const archived = repository.markPlatformAccountDisconnected(accountA.id, "xiaohongshu");

    expect(repository.listAccounts().map((account) => account.id)).toEqual([accountB.id]);
    expect(archived).toMatchObject({ id: accountA.id, loginStatus: "logged_out", browserSessionId: null, authorizationStatus: "NotAuthorized" });
    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(repository.listAccounts({ includeArchived: true }).map((account) => account.id)).toEqual(expect.arrayContaining([accountA.id, accountB.id]));
    expect(repository.getAccountById(accountA.id, "xiaohongshu")).toMatchObject({ id: accountA.id, archivedAt: expect.any(String) });
    expect(repository.getJob(job.id)).toMatchObject({ id: job.id, accountId: accountA.id });
    expect(repository.getSubmissionIntentByJob(job.id)).toMatchObject({ id: intent.id, jobId: job.id });
    expect(repository.getPublishRecordByJob(job.id)).toMatchObject({ id: record.id, accountId: accountA.id });
    expect(credentials.has(`session:xiaohongshu:${accountA.id}`)).toBe(false);
    expect(credentials.has(`session:xiaohongshu:${accountB.id}`)).toBe(true);
    expect(active.has(`xiaohongshu:${accountA.id}`)).toBe(false);
    expect(active.get(`xiaohongshu:${accountB.id}`)).toBe(sessionB);
    expect(repository.listAccounts().find((account) => account.id === accountB.id)).toMatchObject({ loginStatus: "logged_in", externalAccountId: "xhs-b", browserSessionId: "session-b" });
  });

  it("makes a second disconnect of an archived account idempotent and exact", () => {
    const { repository } = openFixture();
    const accountA = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书 A" });
    const accountB = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书 B" });
    repository.markPlatformAccountDisconnected(accountA.id, "xiaohongshu");
    const beforeB = repository.getAccountById(accountB.id, "xiaohongshu");

    expect(() => repository.markPlatformAccountDisconnected(accountA.id, "xiaohongshu")).not.toThrow();
    expect(repository.listAccounts().map((account) => account.id)).toEqual([accountB.id]);
    expect(repository.getAccountById(accountA.id, "xiaohongshu")).toMatchObject({ id: accountA.id, loginStatus: "logged_out", archivedAt: expect.any(String) });
    expect(repository.getAccountById(accountB.id, "xiaohongshu")).toEqual(beforeB);
  });

  it("restores only the unique archived account for an exact stable external identity", () => {
    const { repository } = openFixture();
    const archived = repository.createAccount({ platformKey: "xiaohongshu", name: "历史小红书账号" });
    repository.syncBrowserPlatformAccount({ accountId: archived.id, platformKey: "xiaohongshu", externalAccountId: "stable-xhs", browserSessionId: "old-session" });
    repository.markPlatformAccountDisconnected(archived.id, "xiaohongshu");

    const restored = repository.restoreArchivedAccountByExternalId("xiaohongshu", "stable-xhs");

    expect(restored).toMatchObject({ id: archived.id, externalAccountId: "stable-xhs", archivedAt: null, loginStatus: "logged_out" });
    expect(repository.listAccounts().map((account) => account.id)).toEqual([archived.id]);
  });

  it("fails closed instead of guessing when stable external identity is unavailable", () => {
    const { repository } = openFixture();
    const first = repository.createAccount({ platformKey: "xiaohongshu", name: "历史小红书账号 1" });
    const second = repository.createAccount({ platformKey: "xiaohongshu", name: "历史小红书账号 2" });
    repository.syncBrowserPlatformAccount({ accountId: first.id, platformKey: "xiaohongshu", externalAccountId: "ambiguous-xhs", browserSessionId: "old-session-1" });
    repository.syncBrowserPlatformAccount({ accountId: second.id, platformKey: "xiaohongshu", externalAccountId: "ambiguous-xhs-2", browserSessionId: "old-session-2" });
    repository.markPlatformAccountDisconnected(first.id, "xiaohongshu");
    repository.markPlatformAccountDisconnected(second.id, "xiaohongshu");
    expect(() => repository.restoreArchivedAccountByExternalId("xiaohongshu", "not-found")).toThrow(/归档账号不存在|archived.*not found/i);
    expect(repository.listAccounts({ includeArchived: true }).filter((account) => account.archivedAt)).toHaveLength(2);
  });

  it("rebinds only the exact account-scoped stored Session during a safe restore", () => {
    const credentials = new MemoryCredentialStore();
    const manager = new BrowserSessionManager(credentials);
    const session = { sessionIdHash: "session-a", browser: { isConnected: () => true } } as BrowserSession;
    const source = { platformKey: "xiaohongshu", accountId: "account-a" };
    const target = { platformKey: "xiaohongshu", accountId: "account-restored" };
    manager.setActiveSession(source, session);
    credentials.set(browserSessionCredentialKey(source), "encrypted-a");

    manager.rebind(source, target);

    expect(manager.getActiveSession(source)).toBeNull();
    expect(manager.getActiveSession(target)).toBe(session);
    expect(credentials.has(browserSessionCredentialKey(source))).toBe(false);
    expect(credentials.has(browserSessionCredentialKey(target))).toBe(true);
  });

  it("keeps the two production Xiaohongshu IDs isolated in a controlled fixture", () => {
    const { db, repository } = openFixture();
    const createdA = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 1" });
    const createdB = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 2" });
    const accountA = "11111111-1111-4111-8111-111111111111";
    const accountB = "88c590d9-4c4f-46c9-b1c5-61e2eac43b2d";
    db.prepare("UPDATE accounts SET id=? WHERE id=?").run(accountA, createdA.id);
    db.prepare("UPDATE accounts SET id=? WHERE id=?").run(accountB, createdB.id);
    repository.syncBrowserPlatformAccount({ accountId: accountA, platformKey: "xiaohongshu", externalAccountId: "fixture-owner-a", browserSessionId: "fixture-session-a" });
    repository.syncBrowserPlatformAccount({ accountId: accountB, platformKey: "xiaohongshu", externalAccountId: "fixture-owner-b", browserSessionId: "fixture-session-b" });

    repository.markPlatformAccountDisconnected(accountB, "xiaohongshu");

    expect(repository.listAccounts().map((account) => account.id)).toEqual([accountA]);
    expect(repository.getAccountById(accountA, "xiaohongshu")).toMatchObject({ loginStatus: "logged_in", externalAccountId: "fixture-owner-a", archivedAt: null });
    expect(repository.getAccountById(accountB, "xiaohongshu")).toMatchObject({ loginStatus: "logged_out", externalAccountId: "fixture-owner-b", archivedAt: expect.any(String) });
  });
});
