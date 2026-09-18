import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, ValidationResult } from "@publisher/domain";
import { defaultCapabilities, type BrowserPublishAttemptContext, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";
import { AdapterRegistry } from "@publisher/adapters-core";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];

type FailureMode = "FINAL_SUBMIT_CONTROL_NOT_FOUND" | "REQUIRED_FIELD_MISSING" | "USER_ACTION_REQUIRED" | "POST_SUBMIT_USER_ACTION_REQUIRED";

class BrowserSubmitStateFixtureAdapter implements PlatformAdapter {
  readonly platformKey = "sohu_media";
  readonly manifest: AdapterManifest = {
    platformKey: this.platformKey,
    displayName: "搜狐号测试",
    category: "图文",
    version: "1.1.9",
    adapterStatus: "ready",
    authStrategy: "ManualSession",
    callbackStrategy: "ManualCodeCallback",
    status: "Stable",
    researchStatus: "verified",
    transport: "browser",
    integrationMode: "BrowserAutomation",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://mp.sohu.com/",
    credentialSchema: [],
    officialSources: ["https://mp.sohu.com/"]
  };
  private readonly mode: FailureMode;

  constructor(mode: FailureMode) { this.mode = mode; }

  getCapabilities() { return { ...defaultCapabilities, article: true }; }
  getCredentialSchema() { return []; }
  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "fixture-session", requiresUserAction: false, message: "fixture" }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { throw new Error("finalSubmit fixture must be used"); }

  async prepareFinalSubmit(_ctx: AccountContext, _article: PublishArticleInput): Promise<{ response: Record<string, unknown> }> {
    if (this.mode !== "POST_SUBMIT_USER_ACTION_REQUIRED") throw Object.assign(new Error(this.mode), { code: this.mode });
    return { response: { fixture: "ready" } };
  }

  async finalSubmit(_ctx: AccountContext, _article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    if (this.mode === "POST_SUBMIT_USER_ACTION_REQUIRED") attempt.markSubmissionSideEffect?.();
    throw Object.assign(new Error(this.mode), { code: this.mode === "POST_SUBMIT_USER_ACTION_REQUIRED" ? "USER_ACTION_REQUIRED" : this.mode });
  }
}

function createFixture(mode: FailureMode) {
  const directory = mkdtempSync(join(tmpdir(), "publisher-v119-submit-state-"));
  tempDirs.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  opened.repository.setSetting("contentReviewMode", "Off");
  const brand = opened.repository.createBrand({ name: "搜狐状态机测试企业", companyName: "搜狐状态机测试企业" });
  const account = opened.repository.createAccount({ platformKey: "sohu_media", name: "搜狐状态机测试账号" });
  opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "sohu_media", browserSessionId: "fixture-session" });
  const article = opened.repository.createArticle({
    brandId: brand.id,
    topic: "搜狐状态机回归",
    keyword: "搜狐状态机",
    city: "苏州",
    title: "搜狐状态机回归测试",
    body: "这是一段只用于验证搜狐 Browser 发布状态机的生产测试正文，确保没有最终提交副作用时可以安全恢复。",
    summary: "",
    tags: [],
    seoKeywords: [],
    articleType: "测试",
    aiProvider: "fixture",
    aiModel: "fixture",
    generatedAt: new Date().toISOString(),
    reusePolicy: "once",
    contentHash: `v119-submit-state-${mode}`,
    source: "production"
  });
  if (!article) throw new Error("状态机测试文章创建失败");
  opened.repository.saveContentQualityReview({
    contentType: "article",
    contentId: article.id,
    brandId: brand.id,
    platformKey: "sohu_media",
    contentHash: article.contentHash,
    trigger: "manual_recheck",
    provider: "fixture",
    model: "fixture",
    result: { status: "AI_Checked", score: 100, checks: [], issues: [] },
    snapshot: { title: article.title, body: article.body }
  });
  opened.repository.decideContentQuality("article", article.id, "Approved", "fixture", "fixture", "状态机回归测试批准");
  const job = opened.repository.createArticlePublishJob({ articleId: article.id, platformKey: "sohu_media", platformAccountId: account.id, finalPublishMode: "CONFIRM_BEFORE_PUBLISH" });
  opened.repository.insertPublishRecord({
    jobId: job.id,
    accountId: account.id,
    platformAccountId: account.id,
    platformKey: "sohu_media",
    articleId: article.id,
    publishedUrl: null,
    publishedExternalId: null,
    success: false,
    response: { fixture: true },
    status: "Prepared",
    publishMode: "ASSISTED",
    automationType: "BrowserAutomation",
    operator: "fixture",
    verificationStatus: "WaitingUser"
  });
  opened.repository.confirmJob(job.id, false);
  const registry = new AdapterRegistry();
  registry.register(new BrowserSubmitStateFixtureAdapter(mode));
  const publisher = new PublisherService(opened.repository, registry, createConsoleLogger());
  return { ...opened, publisher, jobId: job.id };
}

afterEach(() => {
  for (const database of databases.splice(0)) if (database.open !== false) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("V1.1.9 Browser final-submit state invariant", () => {
  it.each(["FINAL_SUBMIT_CONTROL_NOT_FOUND", "REQUIRED_FIELD_MISSING", "USER_ACTION_REQUIRED"] as const)("keeps %s resumable when no final-submit side effect was triggered", async (mode) => {
    const fixture = createFixture(mode);
    const result = await fixture.publisher.executeJob(fixture.jobId);
    expect(result.job.status).toBe("NeedsUserAction");
    expect(fixture.repository.getSubmissionIntentByJob(fixture.jobId)).toMatchObject({ state: "Prepared", finalSubmitCount: 0, errorCode: mode });
  });

  it("enters reconciliation when the adapter marks a final-submit side effect before an uncertain error", async () => {
    const fixture = createFixture("POST_SUBMIT_USER_ACTION_REQUIRED");
    const result = await fixture.publisher.executeJob(fixture.jobId);
    expect(result.job.status).toBe("NeedsReconciliation");
    expect(fixture.repository.getSubmissionIntentByJob(fixture.jobId)).toMatchObject({ state: "Unknown", finalSubmitCount: 1, errorCode: "USER_ACTION_REQUIRED" });
  });
});
