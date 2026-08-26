import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, ValidationResult } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const openDatabases: Array<{ close(): void }> = [];

class SohuReconciliationFixtureAdapter implements PlatformAdapter {
  readonly platformKey = "sohu_media";
  readonly manifest: AdapterManifest = { platformKey: this.platformKey, displayName: "搜狐号 reconciliation fixture", category: "测试", version: "1.1.9", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser", researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://mp.sohu.com/", credentialSchema: [], officialSources: ["https://mp.sohu.com/"] };
  readonly reconcile = vi.fn(async (_ctx: AccountContext, _input: { jobId: string; articleId: string; title: string; accountName: string; windowStart: string; windowEnd: string; waitWindowSatisfied?: boolean; submissionIntentState?: string | null; finalSubmitCount?: number }) => ({
    status: "CONFIRMED_NOT_PUBLISHED" as const,
    titleMatch: false,
    accountMatch: true,
    timeWindowMatch: false,
    response: { negativeEvidence: { pageLoaded: true, statusCategoriesComplete: true, totalContentCount: 0, noMatchingTitle: true, noMatchingExternalId: true, noMatchingUrl: true, waitWindowSatisfied: true, noSecondSubmit: true } },
    message: "搜狐负向证据合同通过"
  }));

  getCapabilities() { return { ...defaultCapabilities, article: true }; }
  getCredentialSchema() { return []; }
  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: randomUUID(), requiresUserAction: true }; }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { return { success: false, response: {} }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v119-sohu-reconciliation-"));
  tempDirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), migrationDir);
  openDatabases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = opened.repository.createBrand({ name: `搜狐 reconciliation-${randomUUID()}`, companyName: "搜狐测试公司" });
  const createdAccount = opened.repository.createAccount({ platformKey: "sohu_media", name: "搜狐号账号" });
  const account = opened.repository.syncBrowserPlatformAccount({ accountId: createdAccount.id, platformKey: "sohu_media", browserSessionId: "sohu-fixture-session" });
  const article = opened.repository.createArticle({ brandId: brand.id, topic: "搜狐 reconciliation", keyword: "测试", city: "南京", title: "Geo Media Publisher 发布链路测试", body: "搜狐 reconciliation 正文", summary: "", tags: [], seoKeywords: [], articleType: "自测", aiProvider: "system", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: randomUUID(), qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("article fixture failed");
  const job = opened.repository.createArticlePublishJob({ articleId: article.id, platformKey: "sohu_media", platformAccountId: account.platformAccountId ?? account.id });
  opened.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "sohu_media", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { stage: "editor_prepared" }, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });
  opened.repository.confirmJob(job.id, false);
  const intent = opened.repository.prepareSubmissionIntent(job.id);
  opened.repository.claimFinalSubmitAttempt(intent.id);
  opened.repository.markSubmissionIntentUncertain(intent.id, "UNKNOWN");
  return { ...opened, job, account };
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("V1.1.9 Sohu reconciliation negative contract", () => {
  it("closes the old uncertain Job as ReconciledNotPublished without retrying", async () => {
    const { db, repository, job } = setup();
    const adapter = new SohuReconciliationFixtureAdapter();
    const registry = new AdapterRegistry(); registry.register(adapter);
    const publisher = new PublisherService(repository, registry, createConsoleLogger(), { reconciliationWaitMs: 0 });

    const result = await publisher.reconcileBrowserJob(job.id, { userActionId: "sohu-reconcile-test", triggerSource: "CONTINUE_PENDING_ACTION" });

    expect(result.job.status).toBe("ReconciledNotPublished");
    expect(result.message).toContain("CONFIRMED_NOT_PUBLISHED");
    expect(adapter.reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ waitWindowSatisfied: true, submissionIntentState: "Unknown", finalSubmitCount: 1 }));
    expect(repository.getPublishRecordByJob(job.id)).toMatchObject({ status: "Failed", success: false, verificationStatus: "Failed", publishedExternalId: null, publishedUrl: null });
    expect(repository.getSubmissionIntentByJob(job.id)).toMatchObject({ state: "NotSubmitted", finalSubmitCount: 1, errorCode: "CONFIRMED_NOT_PUBLISHED" });
    db.close();
  });
});
