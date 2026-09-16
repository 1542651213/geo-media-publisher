import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, type PlatformAdapter } from "@publisher/adapters-core";
import { backupDatabase, openDatabase, restoreDatabaseSafely, validateDatabaseBackup } from "@publisher/db";
import { DeepSeekErrorMapper, DeepSeekProvider } from "@publisher/ai";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, PublishStatusResult, ValidationResult } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { sanitizeValue } from "@publisher/logger";
import { PublisherService, type PublisherOptions } from "@publisher/publisher";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

class CountingAdapter implements PlatformAdapter {
  readonly platformKey = "test";
  readonly manifest: AdapterManifest = { platformKey: "test", displayName: "TestPlatform", category: "测试", version: "0.4.0", adapterStatus: "ready", authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", status: "Stable", researchStatus: "verified", transport: "manual", supportsArticle: true, supportsVideo: false, officialWebsite: "test://platform", credentialSchema: [], officialSources: ["test://platform"] };
  calls = 0;
  constructor(private readonly mode: "success" | "timeout" | "hang" | "publishing" = "success") {}
  getCapabilities() { return { article: true, imagePost: false, video: false, coverImage: false, tags: true, categories: false, scheduledPublish: true, draft: false, markdown: false, richText: false, maxTitleLength: 100, maxImageCount: 0 }; }
  getCredentialSchema() { return []; }
  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "test", requiresUserAction: true }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
  async publishArticle(_ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> { this.calls += 1; if (this.mode === "timeout") throw Object.assign(new Error("timeout"), { code: "TIMEOUT" }); if (this.mode === "hang") return new Promise<PublishResult>(() => undefined); if (this.mode === "publishing") return { success: true, status: "publishing", externalId: `external-${article.articleId}`, response: {} }; return { success: true, externalId: `external-${article.articleId}`, publishedUrl: `test://${article.articleId}`, response: {} }; }
  async getPublishStatus(_ctx: AccountContext, externalId: string): Promise<PublishStatusResult> { return { status: "published", externalId, publishedUrl: `test://${externalId}`, response: {} }; }
}

function setup(mode: "success" | "timeout" | "hang" | "publishing" = "success", options: PublisherOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v031-")); dirs.push(dir);
  const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
  repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repository.createBrand({ name: "可靠性测试", companyName: "测试公司" });
  const article = repository.createArticle({ brandId: brand.id, topic: "topic", keyword: "keyword", city: "南京", title: "标题", body: "足够长的正文用于发布可靠性测试。".repeat(10), summary: "摘要", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: randomUUID() });
  const account = repository.createAccount({ platformKey: "test", name: "测试账号", allowAutoPublish: true });
  const plan = repository.createPlan({ name: "测试计划", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: [], reusePolicy: "once", minIntervalSeconds: 0, maxRetries: 3, consecutiveFailureThreshold: 3, startDate: "2026-01-01", endDate: null });
  const [job] = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1000).toISOString());
  const adapter = new CountingAdapter(mode); const registry = new AdapterRegistry(); registry.register(adapter);
  return { db, repository, publisher: new PublisherService(repository, registry, createConsoleLogger(), options), job, adapter, article };
}

describe("V0.3.1 external side-effect safety", () => {
  it("does not submit again after acceptance before PublishRecord persistence", async () => {
    const setupData = setup();
    const insert = vi.spyOn(setupData.repository, "insertPublishRecord").mockImplementationOnce(() => { throw new Error("simulated crash after acceptance"); });
    const first = await setupData.publisher.executeJob(setupData.job.id);
    expect(first.job.status).toBe("Submitted");
    expect(setupData.adapter.calls).toBe(1);
    insert.mockRestore();
    const repaired = await setupData.publisher.executeJob(setupData.job.id);
    expect(repaired.message).toContain("without resubmitting");
    expect(setupData.adapter.calls).toBe(1);
    setupData.db.close();
  });

  it("moves an uncertain timeout to NeedsReconciliation and only retries after explicit confirmation", async () => {
    const setupData = setup("timeout");
    const first = await setupData.publisher.executeJob(setupData.job.id);
    expect(first.job.status).toBe("NeedsReconciliation");
    expect(setupData.adapter.calls).toBe(1);
    const reconciled = setupData.repository.markJobReconciledNotSubmitted(setupData.job.id);
    expect(reconciled.status).toBe("Retry");
    const second = await setupData.publisher.executeJob(setupData.job.id);
    expect(second.job.status).toBe("NeedsReconciliation");
    expect(setupData.adapter.calls).toBe(2);
    setupData.db.close();
  });

  it("bounds a platform call that never resolves and preserves reconciliation safety", async () => {
    const setupData = setup("hang", { operationTimeoutMs: 10 });
    const result = await setupData.publisher.executeJob(setupData.job.id);
    expect(result.job.status).toBe("NeedsReconciliation");
    expect(result.job.lastErrorCode).toBe("TIMEOUT");
    expect(setupData.adapter.calls).toBe(1);
    setupData.db.close();
  });

  it("stops automatic status polling at the configured deadline", async () => {
    const setupData = setup("publishing", { publishPollingTimeoutMs: 0 });
    const submitted = await setupData.publisher.executeJob(setupData.job.id);
    expect(submitted.job.status).toBe("Publishing");
    const expired = await setupData.publisher.pollPublishingJob(setupData.job.id);
    expect(expired.job.status).toBe("NeedsReconciliation");
    expect(expired.job.lastErrorCode).toBe("TIMEOUT");
    setupData.db.close();
  });
});

describe("DeepSeek provider", () => {
  it("uses the first-class defaults and explicit Thinking mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "标题", body: "正文", summary: "", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }) } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { status: 200 }));
    const provider = new DeepSeekProvider({ apiKey: "sk-test-key" });
    expect(provider.providerKey).toBe("deepseek"); expect(provider.model).toBe("deepseek-v4-flash");
    await provider.generateArticle({ brand: { id: "b", name: "品牌", companyName: "公司", description: "", mainBusiness: "", serviceRegions: [], advantages: [], contact: {}, establishedAt: "", address: "", serviceProcess: "", afterSales: "", faq: "", certificates: "", patents: "", equipment: "", cases: "", aiForbiddenClaims: [], createdAt: "", updatedAt: "" }, city: "南京", keyword: "服务", articleType: "科普", minWords: 1, maxWords: 100, includeFaq: true, includeSummary: true, includeTags: true, includeSeoKeywords: true });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('"thinking":{"type":"disabled"}');
    fetchMock.mockRestore();
    expect(DeepSeekErrorMapper.map({ code: "AI_RATE_LIMITED" })).toMatchObject({ code: "rate_limit", retryable: true });
    expect(DeepSeekErrorMapper.map({ code: "AI_AUTH" })).toMatchObject({ code: "credential", retryable: false });
  });
});

describe("AI batch item recovery", () => {
  it("claims durable items and never treats a cursor as completion", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-ai-batch-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "Batch 品牌", companyName: "测试公司" });
    const taskId = repository.createAiTask({ brandId: brand.id, type: "batch_article", provider: "mock", model: "mock", totalCount: 3, payload: { brandId: brand.id, input: { brandId: brand.id } } });
    const batchId = repository.createAiBatch({ taskId, brandId: brand.id, concurrency: 2, targets: [0, 1, 2].map((targetIndex) => ({ city: "南京", keyword: `关键词-${targetIndex}`, articleType: "科普", targetIndex })) });
    const claimed = repository.claimNextAiBatchItem(batchId);
    expect(claimed?.status).toBe("Running");
    expect(repository.recoverAiBatchItems()).toBe(1);
    expect(repository.claimNextAiBatchItem(batchId)?.status).toBe("Running");
    repository.cancelAiBatchItems(batchId);
    const items = repository.listAiBatchItems(batchId);
    expect(items).toHaveLength(3);
    expect(items.every((item) => ["Running", "Cancelled", "Retry", "Completed", "Failed"].includes(item.status))).toBe(true);
    db.close();
  });
});

describe("restore and log safety", () => {
  it("keeps a pre-restore backup and validates the restored database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-restore-")); dirs.push(dir);
    const databasePath = join(dir, "publisher.db"); const backupPath = join(dir, "backup.db");
    const { db } = openDatabase(databasePath, migrationDir);
    await backupDatabase(db, backupPath);
    const result = restoreDatabaseSafely(db, databasePath, backupPath);
    expect(result.restored).toBe(true);
    expect(validateDatabaseBackup(databasePath).valid).toBe(true);
    expect(validateDatabaseBackup(result.preRestoreBackupPath).valid).toBe(true);
  });

  it("sanitizes sensitive keys recursively before logging", () => {
    expect(sanitizeValue({ Authorization: "Bearer top-secret", nested: { apiKey: "secret", safe: "ok" } })).toEqual({ Authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]", safe: "ok" } });
    expect(sanitizeValue({ clientSecret: "client-secret", pageAccessToken: "page-token", cookie: "session-cookie" })).toEqual({ clientSecret: "[REDACTED]", pageAccessToken: "[REDACTED]", cookie: "[REDACTED]" });
    expect(sanitizeValue("https://example.test/callback?access_token=top-secret&safe=ok")).toBe("https://example.test/callback?access_token=[REDACTED]&safe=ok");
    expect(sanitizeValue("https://example.test/callback?page_access_token=top-secret")).toBe("https://example.test/callback?page_access_token=[REDACTED]");
  });
});
