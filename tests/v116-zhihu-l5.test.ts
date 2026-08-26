import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, PublishStatusResult, ValidationResult } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const openDatabases: Array<{ close(): void }> = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class L5FixtureAdapter implements PlatformAdapter {
  readonly platformKey = "zhihu";
  readonly manifest: AdapterManifest = { platformKey: this.platformKey, displayName: "知乎 L5 fixture", category: "测试", version: "1.1.6", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser", researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://www.zhihu.com/", credentialSchema: [], officialSources: ["https://www.zhihu.com/"] };
  readonly checkLogin = vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "logged_in");
  readonly publishArticle = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> => ({ success: false, response: {} }));
  readonly finalSubmit = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput, _attempt: { jobId: string; submissionIntentId: string; attempt: number }): Promise<PublishResult> => ({ success: true, status: "published", externalId: "123456789", publishedUrl: "https://zhuanlan.zhihu.com/p/123456789", response: { finalSubmitCount: 1 } }));
  readonly collectPublishResult = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput, _attempt: { jobId: string; submissionIntentId: string; attempt: number }): Promise<PublishResult> => ({ success: true, status: "published", externalId: "123456789", publishedUrl: "https://zhuanlan.zhihu.com/p/123456789", response: { collected: true } }));
  readonly verifyPublished = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> => ({ status: "published", externalId: result.externalId, publishedUrl: result.publishedUrl, response: { titleMatch: true, urlReachable: true } }));
  readonly reconcile = vi.fn(async (_ctx: AccountContext, _input: { jobId: string; articleId: string; title: string; accountName: string; windowStart: string; windowEnd: string }) => ({ status: "STILL_UNCERTAIN" as const, titleMatch: false, accountMatch: true, timeWindowMatch: false, response: {}, message: "fixture remains uncertain" }));

  getCapabilities() { return { ...defaultCapabilities, imagePost: true }; }
  getCredentialSchema() { return []; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: randomUUID(), requiresUserAction: true }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v116-l5-"));
  tempDirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), migrationDir);
  openDatabases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = opened.repository.createBrand({ name: `L5 品牌-${randomUUID()}`, companyName: "L5 公司" });
  const createdAccount = opened.repository.createAccount({ platformKey: "zhihu", name: "知乎 L5 账号" });
  const account = opened.repository.syncBrowserPlatformAccount({ accountId: createdAccount.id, platformKey: "zhihu", browserSessionId: "fixture-session" });
  const article = opened.repository.createArticle({ brandId: brand.id, topic: "知乎 L5", keyword: "测试", city: "南京", title: "知乎 L5 标题", body: "知乎 L5 正文", summary: "", tags: [], seoKeywords: [], articleType: "自测", aiProvider: "system", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: randomUUID(), qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("article fixture failed");
  const job = opened.repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.platformAccountId ?? account.id });
  opened.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "zhihu", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { stage: "editor_prepared" }, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });
  opened.repository.confirmJob(job.id, false);
  return { ...opened, job, article, account };
}

const action: UserInitiatedAction = { userActionId: "77777777-7777-4777-8777-777777777777", triggerSource: "RUN_SELF_TEST" };

describe("V1.1.6 Zhihu L5 contract", () => {
  it("persists one final-submit attempt and updates the prepared PublishRecord only after verified ID and URL", async () => {
    const { db, repository, job } = setup();
    const adapter = new L5FixtureAdapter();
    const registry = new AdapterRegistry(); registry.register(adapter);
    const publisher = new PublisherService(repository, registry, createConsoleLogger());

    const result = await publisher.executeJob(job.id, action, "VISIBLE");

    expect(result.job.status).toBe("Success");
    expect(adapter.checkLogin).not.toHaveBeenCalled();
    expect(adapter.finalSubmit).toHaveBeenCalledTimes(1);
    expect(adapter.collectPublishResult).toHaveBeenCalledTimes(1);
    expect(adapter.verifyPublished).toHaveBeenCalledTimes(1);
    expect(repository.getPublishRecordByJob(job.id)).toMatchObject({ status: "Published", success: true, publishedExternalId: "123456789", publishedUrl: "https://zhuanlan.zhihu.com/p/123456789", verificationStatus: "Verified" });
    expect(repository.getSubmissionIntentByJob(job.id)).toMatchObject({ state: "Submitted", finalSubmitCount: 1 });
    db.close();
  });

  it("keeps an uncertain Job paused and never retries through browser reconciliation", async () => {
    const { db, repository, job } = setup();
    const intent = repository.prepareSubmissionIntent(job.id);
    repository.markSubmissionIntentUncertain(intent.id, "SUBMISSION_UNCERTAIN");
    const adapter = new L5FixtureAdapter();
    const registry = new AdapterRegistry(); registry.register(adapter);
    const publisher = new PublisherService(repository, registry, createConsoleLogger());

    const result = await publisher.reconcileBrowserJob(job.id, action);

    expect(result.message).toContain("STILL_UNCERTAIN");
    expect(result.job.status).toBe("NeedsReconciliation");
    expect(adapter.reconcile).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("rejects a second persisted final-submit claim", () => {
    const { db, repository, job } = setup();
    const intent = repository.prepareSubmissionIntent(job.id);
    expect(repository.claimFinalSubmitAttempt(intent.id)).toMatchObject({ id: intent.id, jobId: job.id, attempt: 0 });
    expect(() => repository.claimFinalSubmitAttempt(intent.id)).toThrowError(/already been used|not ready/iu);
    db.close();
  });
});
