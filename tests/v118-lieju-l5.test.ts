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
const databases: Array<{ close(): void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class LiejuL5Fixture implements PlatformAdapter {
  readonly platformKey = "lieju";
  readonly manifest: AdapterManifest = { platformKey: this.platformKey, displayName: "列举网 L5 fixture", category: "分类信息", version: "1.1.8", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser", researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://www.lieju.com/", credentialSchema: [], officialSources: ["https://www.lieju.com/"] };
  readonly checkLogin = vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "logged_in");
  readonly finalSubmit = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput, _attempt: { jobId: string; submissionIntentId: string; attempt: number }): Promise<PublishResult> => {
    if (this.finalSubmit.mock.calls.length === 1) throw Object.assign(new Error("CAPTCHA: complete normal platform verification"), { code: "USER_ACTION_REQUIRED" });
    return { success: true, status: "published", externalId: "11800001", publishedUrl: "https://nj.lieju.com/jiadian/11800001.html", response: { finalSubmitCount: 1 } };
  });
  readonly collectPublishResult = vi.fn(async (): Promise<PublishResult> => ({ success: true, status: "published", externalId: "11800001", publishedUrl: "https://nj.lieju.com/jiadian/11800001.html", response: { collected: true } }));
  readonly verifyPublished = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> => ({ status: "published", externalId: result.externalId, publishedUrl: result.publishedUrl, response: { titleMatch: true, urlReachable: true } }));

  getCapabilities() { return { ...defaultCapabilities, article: true, imagePost: true }; }
  getCredentialSchema() { return []; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: randomUUID(), requiresUserAction: true }; }
  async publishArticle(): Promise<PublishResult> { return { success: false, response: {} }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "publisher-v118-lieju-"));
  tempDirs.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = opened.repository.createBrand({ name: `V1.1.8-${randomUUID()}`, companyName: "列举网测试企业" });
  const created = opened.repository.createAccount({ platformKey: "lieju", name: "列举网-01" });
  const account = opened.repository.syncBrowserPlatformAccount({ accountId: created.id, platformKey: "lieju", browserSessionId: "fixture-session" });
  const article = opened.repository.createArticle({ brandId: brand.id, topic: "列举网 L5", keyword: "测试", city: "南京", title: "列举网 L5 标题", body: "列举网 L5 正文", summary: "", tags: [], seoKeywords: [], articleType: "自测", aiProvider: "system", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: randomUUID(), qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("article fixture failed");
  const job = opened.repository.createArticlePublishJob({ articleId: article.id, platformKey: "lieju", platformAccountId: account.platformAccountId ?? account.id });
  opened.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "lieju", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { stage: "form_prepared", imageRequired: false }, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });
  opened.repository.confirmJob(job.id, false);
  return { ...opened, job };
}

const action: UserInitiatedAction = { userActionId: "11811811-8118-4811-8118-118118118118", triggerSource: "RUN_SELF_TEST" };

describe("V1.1.8 Lieju L5 submit gate", () => {
  it("returns to the same Job after pre-submit CAPTCHA without consuming the one-click gate", async () => {
    const { repository, job } = setup();
    const adapter = new LiejuL5Fixture();
    const registry = new AdapterRegistry();
    registry.register(adapter);
    const publisher = new PublisherService(repository, registry, createConsoleLogger());

    const waiting = await publisher.executeJob(job.id, action, "VISIBLE");
    expect(waiting.job.status).toBe("NeedsUserAction");
    expect(waiting.message).toContain("CAPTCHA");
    expect(repository.getSubmissionIntentByJob(job.id)).toMatchObject({ state: "Prepared", finalSubmitCount: 0 });

    const completed = await publisher.executeJob(job.id, { ...action, triggerSource: "CONTINUE_PENDING_ACTION" }, "VISIBLE");
    expect(completed.job.status).toBe("Success");
    expect(adapter.finalSubmit).toHaveBeenCalledTimes(2);
    expect(adapter.collectPublishResult).toHaveBeenCalledTimes(1);
    expect(adapter.verifyPublished).toHaveBeenCalledTimes(1);
    expect(repository.getSubmissionIntentByJob(job.id)).toMatchObject({ state: "Submitted", finalSubmitCount: 1 });
    expect(repository.getPublishRecordByJob(job.id)).toMatchObject({ status: "Published", success: true, publishedExternalId: "11800001", publishedUrl: "https://nj.lieju.com/jiadian/11800001.html", verificationStatus: "Verified" });
  });
});
