import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import { BrowserSessionManager, browserSessionCredentialKey, type UserInitiatedAction } from "@publisher/adapters-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { AccountContext } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import { XiaohongshuBrowserAdapter } from "../packages/adapters/xiaohongshu/src/browser";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const temporaryDirectories: string[] = [];
const databases: Array<{ close: () => void }> = [];

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

const userAction: UserInitiatedAction = {
  userActionId: "11111111-1111-4111-8111-111111111111",
  triggerSource: "CONNECT_ACCOUNT"
};

const context = (accountId: string): AccountContext => ({
  accountId,
  accountName: accountId,
  platformKey: "xiaohongshu",
  settings: { userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "CONNECT_ACCOUNT" }
});

function openFixture(): { db: ReturnType<typeof openDatabase>["db"], repository: ReturnType<typeof openDatabase>["repository"] } {
  const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-long-lived-"));
  temporaryDirectories.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedPlatformCatalog(platformCsv);
  return opened;
}

function browserFixture(credentials: MemoryCredentialStore): { manager: BrowserSessionManager; contexts: Array<BrowserContext & { close: ReturnType<typeof vi.fn> }> } {
  const contexts: Array<BrowserContext & { close: ReturnType<typeof vi.fn> }> = [];
  const launchBrowser = vi.fn(async () => {
    const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) } as unknown as Page;
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => page),
      pages: vi.fn(() => [page]),
      close: vi.fn(async () => undefined),
      storageState: vi.fn(async () => ({ cookies: [], origins: [] }))
    } as unknown as BrowserContext & { close: ReturnType<typeof vi.fn> };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true),
      on: vi.fn()
    } as unknown as Browser;
    contexts.push(context);
    return browser;
  });
  const manager = new BrowserSessionManager(credentials, { launchBrowser });
  return { manager, contexts };
}

describe("Xiaohongshu long-lived browser session safety", () => {
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("removes XHS account A without closing account B or touching publish rows", async () => {
    const { db, repository } = openFixture();
    const accountA = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书 A" });
    const accountB = repository.createAccount({ platformKey: "xiaohongshu", name: "小红书 B" });
    repository.syncBrowserPlatformAccount({ accountId: accountA.id, platformKey: "xiaohongshu", accountName: "小红书 A", externalAccountId: "xhs-a", browserSessionId: "session-a" });
    repository.syncBrowserPlatformAccount({ accountId: accountB.id, platformKey: "xiaohongshu", accountName: "小红书 B", externalAccountId: "xhs-b", browserSessionId: "session-b" });
    const brand = repository.createBrand({ name: "Session Safety Brand", companyName: "Session Safety Company" });
    const article = repository.createArticle({ brandId: brand.id, topic: "Session isolation", keyword: "Session isolation", city: "苏州", title: "Session isolation", body: "仅用于隔离测试", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "xhs-session-isolation" });
    if (!article) throw new Error("fixture article was not created");
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "xiaohongshu", platformAccountId: accountA.id });
    repository.prepareSubmissionIntent(job.id);
    repository.insertPublishRecord({ jobId: job.id, accountId: accountA.id, platformAccountId: accountA.id, platformKey: "xiaohongshu", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { fixture: true }, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });
    const before = {
      jobs: repository.listJobs().length,
      intents: Number((db.prepare("SELECT COUNT(*) AS count FROM submission_intents").get() as { count: number }).count),
      records: repository.getPublishRecords().length
    };

    const credentials = new MemoryCredentialStore();
    const { manager, contexts } = browserFixture(credentials);
    const adapterA = new XiaohongshuBrowserAdapter({ sessionManager: manager });
    const sessionA = await manager.open({ platformKey: "xiaohongshu", accountId: accountA.id }, userAction);
    const sessionB = await manager.open({ platformKey: "xiaohongshu", accountId: accountB.id }, userAction);
    credentials.set(browserSessionCredentialKey({ platformKey: "xiaohongshu", accountId: accountA.id }), "stored-a");
    credentials.set(browserSessionCredentialKey({ platformKey: "xiaohongshu", accountId: accountB.id }), "stored-b");
    const preparePublishSpy = vi.spyOn(adapterA, "preparePublish");

    await adapterA.logout(context(accountA.id));

    expect(sessionA.context.close).toHaveBeenCalledTimes(1);
    expect(sessionB.context.close).not.toHaveBeenCalled();
    expect(manager.getActiveSession({ platformKey: "xiaohongshu", accountId: accountB.id })).toBe(sessionB);
    expect(credentials.has(browserSessionCredentialKey({ platformKey: "xiaohongshu", accountId: accountA.id }))).toBe(false);
    expect(credentials.has(browserSessionCredentialKey({ platformKey: "xiaohongshu", accountId: accountB.id }))).toBe(true);
    expect(preparePublishSpy).not.toHaveBeenCalled();
    expect(repository.markPlatformAccountDisconnected(accountA.id, "xiaohongshu").id).toBe(accountA.id);
    expect(repository.listAccounts().map((account) => account.id)).toEqual([accountB.id]);
    expect(contexts[1]?.close).not.toHaveBeenCalled();
    expect({
      jobs: repository.listJobs().length,
      intents: Number((db.prepare("SELECT COUNT(*) AS count FROM submission_intents").get() as { count: number }).count),
      records: repository.getPublishRecords().length
    }).toEqual(before);
  });
});
