import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { openDatabase, type AppRepository } from "@publisher/db";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, ValidationResult } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const openDatabases: Array<{ close(): void }> = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    try { db.close(); } catch { /* Already closed by the successful test path. */ }
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class BrowserSpyAdapter implements PlatformAdapter {
  readonly platformKey = "zhihu";
  readonly manifest: AdapterManifest = {
    platformKey: this.platformKey,
    displayName: "知乎测试替身",
    category: "测试",
    version: "1.1.4",
    adapterStatus: "ready",
    authStrategy: "ManualSession",
    callbackStrategy: "ManualCodeCallback",
    status: "WaitingForUser",
    researchStatus: "partial",
    transport: "browser",
    integrationMode: "BrowserAutomation",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://www.zhihu.com/",
    credentialSchema: [],
    officialSources: ["https://www.zhihu.com/"]
  };

  readonly checkLogin = vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "logged_in");
  readonly checkSession = vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "logged_in");
  readonly connectAccount = vi.fn(async (_ctx: AccountContext): Promise<LoginSession> => ({ sessionId: randomUUID(), requiresUserAction: true }));
  readonly preparePublish = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput) => ({ prepared: true, requiresUserAction: true, message: "prepared", response: {} }));
  readonly releaseOperationSession = vi.fn(async (_ctx: AccountContext): Promise<void> => undefined);
  readonly publishArticle = vi.fn(async (ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> => ({
    success: true,
    dryRun: ctx.settings.dryRun === true,
    prepared: true,
    response: { adapter: this.platformKey, imageUploaded: Boolean(_article.images?.length) }
  }));

  getCapabilities() { return { ...defaultCapabilities, imagePost: true }; }
  getCredentialSchema() { return []; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: randomUUID(), requiresUserAction: true }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
}

class OfficialVideoSpyAdapter implements PlatformAdapter {
  readonly platformKey = "zhihu";
  readonly manifest: AdapterManifest = {
    platformKey: this.platformKey,
    displayName: "Official API video spy",
    category: "video",
    version: "1.1.4",
    adapterStatus: "ready",
    authStrategy: "OAuth2",
    callbackStrategy: "ManualCodeCallback",
    status: "CodeComplete",
    researchStatus: "partial",
    transport: "official_api",
    integrationMode: "OAuth",
    supportsArticle: false,
    supportsVideo: true,
    officialWebsite: "https://www.zhihu.com/",
    credentialSchema: [],
    officialSources: ["https://www.zhihu.com/"]
  };

  readonly checkLogin = vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "expired");

  getCapabilities() { return { ...defaultCapabilities, article: false, video: true }; }
  getCredentialSchema() { return []; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: randomUUID(), requiresUserAction: true }; }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { return { success: false, response: {} }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
}

function database(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), migrationDir);
  openDatabases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  return opened;
}

function createArticle(repository: AppRepository, brandId: string, suffix: string) {
  const article = repository.createArticle({
    brandId,
    topic: `topic-${suffix}`,
    keyword: `keyword-${suffix}`,
    city: "南京",
    title: `V1.1.4 浏览器生命周期测试 ${suffix}`,
    body: "这是一段用于验证启动保护、后台模式和图片链路的测试正文。".repeat(20),
    summary: "测试摘要",
    tags: ["测试"],
    seoKeywords: ["生命周期"],
    articleType: "科普",
    aiProvider: "fixture",
    aiModel: "fixture",
    generatedAt: new Date().toISOString(),
    reusePolicy: "once",
    contentHash: `v114-browser-${suffix}-${randomUUID()}`
  });
  if (!article) throw new Error("测试文章创建失败");
  return article;
}

function createPlanJob(repository: AppRepository, platformKey: string) {
  const brand = repository.createBrand({ name: `测试品牌-${randomUUID()}`, companyName: "测试公司" });
  const account = repository.createAccount({ platformKey, name: `测试账号-${randomUUID()}` });
  createArticle(repository, brand.id, randomUUID());
  const plan = repository.createPlan({
    name: `测试计划-${randomUUID()}`,
    brandId: brand.id,
    enabled: true,
    strategy: "same_article",
    articlesPerDay: 1,
    accountIds: [account.id],
    publishTimes: ["09:00"],
    reusePolicy: "once",
    minIntervalSeconds: 0,
    maxRetries: 3,
    consecutiveFailureThreshold: 3,
    startDate: "2026-01-01",
    endDate: null
  });
  const [job] = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1_000).toISOString());
  return { account, job };
}

describe("V1.1.4 browser lifecycle and background publishing", () => {
  it("does not run or login-check a due BrowserAutomation job without a fresh user action", async () => {
    const { db, repository } = database("v114-startup-guard-");
    const adapter = new BrowserSpyAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.register(new TestPlatformAdapter());
    const { job } = createPlanJob(repository, adapter.platformKey);
    const scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, createConsoleLogger()), createConsoleLogger());

    await expect(scheduler.runDueJobs()).resolves.toEqual([]);

    expect(adapter.checkLogin).not.toHaveBeenCalled();
    expect(adapter.publishArticle).not.toHaveBeenCalled();
    expect(repository.getJob(job.id)).toMatchObject({ status: "NeedsUserAction", lastErrorCode: "USER_ACTION_REQUIRED" });
    expect(repository.listNotifications().some((notification) => notification.title === "有任务需要继续" && notification.relatedId === job.id)).toBe(true);
    db.close();
  });

  it("recovers an interrupted browser job as a reminder and never resumes it during app start", async () => {
    const { db, repository } = database("v114-recovery-guard-");
    const adapter = new BrowserSpyAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.register(new TestPlatformAdapter());
    const { job } = createPlanJob(repository, adapter.platformKey);
    repository.claimJob(job.id);
    const scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, createConsoleLogger()), createConsoleLogger(), 60_000);

    scheduler.start();
    scheduler.stop();
    await Promise.resolve();

    expect(adapter.checkLogin).not.toHaveBeenCalled();
    expect(adapter.publishArticle).not.toHaveBeenCalled();
    expect(repository.getJob(job.id)).toMatchObject({ status: "NeedsUserAction", lastErrorCode: "USER_ACTION_REQUIRED" });
    db.close();
  });

  it("keeps non-browser platform jobs on the persistent background scheduler", async () => {
    const { db, repository } = database("v114-api-background-");
    const registry = new AdapterRegistry();
    registry.register(new TestPlatformAdapter());
    const { job } = createPlanJob(repository, "test");
    const scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, createConsoleLogger()), createConsoleLogger());

    const result = await scheduler.runDueJobs();

    expect(result).toHaveLength(1);
    expect(repository.getJob(job.id)?.status).toBe("AwaitingConfirmation");
    db.close();
  });

  it("falls back to VISIBLE until both the user preference and platform background self-test are PASSED", async () => {
    const { db, repository } = database("v114-visible-fallback-");
    const adapter = new BrowserSpyAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.register(new TestPlatformAdapter());
    const { job } = createPlanJob(repository, adapter.platformKey);
    repository.setSetting("browserPublishMode", "background");
    const action: UserInitiatedAction = { userActionId: "55555555-5555-4555-8555-555555555555", triggerSource: "START_PUBLISH" };
    const publisher = new PublisherService(repository, registry, createConsoleLogger());

    await expect(publisher.executeJob(job.id, action, "BACKGROUND")).resolves.toMatchObject({ job: { status: "AwaitingConfirmation" } });

    expect(adapter.publishArticle).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ browserExecutionMode: "VISIBLE" }) }),
      expect.anything()
    );
    db.close();
  });

  it("keeps account login verification VISIBLE even after background self-test passes", async () => {
    const { db, repository } = database("v114-login-visible-");
    const adapter = new BrowserSpyAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.register(new TestPlatformAdapter());
    const account = repository.createAccount({ platformKey: adapter.platformKey, name: "登录窗口测试账号" });
    repository.setSetting("browserPublishMode", "background");
    repository.updatePlatformBackgroundAutomation(adapter.platformKey, "PASSED", "isolated fixture passed");
    const action: UserInitiatedAction = { userActionId: "66666666-6666-4666-8666-666666666666", triggerSource: "RUN_SELF_TEST" };
    const publisher = new PublisherService(repository, registry, createConsoleLogger());

    await publisher.checkAccountLogin(account.id, action, "BACKGROUND");

    expect(adapter.checkLogin).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ browserExecutionMode: "VISIBLE" }) }));
    db.close();
  });

  it("does not use the default video API adapter to expire a BrowserAutomation article account", async () => {
    const { db, repository } = database("v114-content-aware-login-sweep-");
    const browserAdapter = new BrowserSpyAdapter();
    const videoApiAdapter = new OfficialVideoSpyAdapter();
    const registry = new AdapterRegistry();
    registry.register(browserAdapter);
    registry.register(videoApiAdapter);
    const createdAccount = repository.createAccount({ platformKey: browserAdapter.platformKey, name: "content-aware account" });
    const account = repository.syncBrowserPlatformAccount({ accountId: createdAccount.id, platformKey: browserAdapter.platformKey, browserSessionId: "encrypted-session-ref" });
    const scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, createConsoleLogger()), createConsoleLogger());

    await expect(scheduler.runDueJobs()).resolves.toEqual([]);

    expect(videoApiAdapter.checkLogin).not.toHaveBeenCalled();
    expect(repository.listAccounts().find((item) => item.id === account.id)).toMatchObject({ enabled: true, loginStatus: "logged_in", connectionMode: "BrowserAutomation" });
    db.close();
  });

  it("passes selectedImageAssetId and explicit BACKGROUND evidence into the adapter", async () => {
    const { db, repository } = database("v114-image-pipeline-");
    const adapter = new BrowserSpyAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.register(new TestPlatformAdapter());
    const brand = repository.createBrand({ name: "图片链路品牌", companyName: "图片链路公司" });
    const createdAccount = repository.createAccount({ platformKey: adapter.platformKey, name: "知乎图片账号" });
    const account = repository.syncBrowserPlatformAccount({ accountId: createdAccount.id, platformKey: adapter.platformKey, browserSessionId: "encrypted-session-ref" });
    repository.setSetting("browserPublishMode", "background");
    repository.updatePlatformBackgroundAutomation(adapter.platformKey, "PASSED", "isolated fixture passed");
    const article = createArticle(repository, brand.id, "image");
    const image = repository.createImageAsset({
      brandId: brand.id,
      name: "主图",
      filePath: "C:/safe-fixture/main.jpg",
      originalFileName: "main.jpg",
      mimeType: "image/jpeg",
      size: 128,
      enabled: true
    });
    const createdJob = repository.createArticlePublishJob({
      articleId: article.id,
      platformKey: adapter.platformKey,
      platformAccountId: account.platformAccountId ?? account.id,
      selectedImageAssetId: image.id,
      imageSelectionMode: "manual"
    });
    repository.confirmJob(createdJob.id, true);
    const action: UserInitiatedAction = { userActionId: "44444444-4444-4444-8444-444444444444", triggerSource: "START_PUBLISH" };
    const publisher = new PublisherService(repository, registry, createConsoleLogger());

    await expect(publisher.executeJob(createdJob.id, action, "BACKGROUND")).resolves.toMatchObject({ job: { status: "AwaitingConfirmation" } });

    expect(adapter.checkLogin).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ userActionId: action.userActionId, triggerSource: action.triggerSource, browserExecutionMode: "BACKGROUND" }) }));
    expect(adapter.publishArticle).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ browserExecutionMode: "BACKGROUND" }) }),
      expect.objectContaining({ images: [image.filePath] })
    );
    expect(adapter.releaseOperationSession).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ browserExecutionMode: "BACKGROUND" }) }));
    expect(repository.getPublishRecordByJob(createdJob.id)?.response).toMatchObject({ imageUploaded: true, imageInsertion: "uploaded_verified", selectedImageAssetId: image.id });
    db.close();
  });
});
