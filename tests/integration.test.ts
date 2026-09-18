import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { AdapterRegistry } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { MockAIProvider, contentHash } from "@publisher/ai";
import { createConsoleLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("SQLite publishing flow", () => {
  it("persists migration, article, job and PublishRecord", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-test-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "测试品牌", companyName: "测试公司", mainBusiness: "测试服务", aiForbiddenClaims: ["禁止虚构"] });
    const account = repository.createAccount({ platformKey: "test", name: "测试账号" });
    const provider = new MockAIProvider();
    const generated = await provider.generateArticle({ brand, city: "南京", keyword: "南京测试服务", articleType: "科普", minWords: 300, maxWords: 800, includeFaq: true, includeSummary: true, includeTags: true, includeSeoKeywords: true });
    const article = repository.createArticle({ brandId: brand.id, topic: generated.title, keyword: "南京测试服务", city: "南京", title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords, articleType: "科普", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: contentHash(generated) });
    expect(article).not.toBeNull();
    const plan = repository.createPlan({ name: "验收计划", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: ["09:00"], reusePolicy: "once", minIntervalSeconds: 0, maxRetries: 3, consecutiveFailureThreshold: 3, startDate: "2026-01-01", endDate: null });
    const jobs = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1000).toISOString());
    expect(jobs).toHaveLength(1);
    const registry = new AdapterRegistry(); registry.register(new TestPlatformAdapter());
    const publisher = new PublisherService(repository, registry, createConsoleLogger());
    const scheduler = new PersistentScheduler(repository, publisher, createConsoleLogger(), 1000);
    const result = await scheduler.runDueJobs();
    expect(result[0]?.job.status).toBe("AwaitingConfirmation");
    expect(repository.confirmJob(jobs[0].id, false).status).toBe("Scheduled");
    const confirmed = await publisher.executeJob(jobs[0].id);
    expect(confirmed.job.status).toBe("Success");
    const records = repository.getPublishRecords(article?.id);
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.dryRun)).toMatchObject({ publishMode: "MANUAL", automationType: "Manual", browserSessionIdHash: null, verificationStatus: "WaitingUser" });
    expect(records[0]?.operator).toBeTruthy();
    expect(repository.dashboardStats().publishedToday).toBe(1);
    db.close();
  });

  it("moves network errors to Retry and recovers Running jobs on restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-recovery-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "重试品牌", companyName: "重试公司" });
    const account = repository.createAccount({ platformKey: "test", name: "重试账号" });
    const article = repository.createArticle({ brandId: brand.id, topic: "topic", keyword: "keyword", city: "南京", title: "标题", body: "这是一段足够长的正文，用于测试网络异常和队列恢复机制是否按照有限重试策略运行。", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `hash-${randomUUID()}` });
    const plan = repository.createPlan({ name: "重试计划", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: ["09:00"], reusePolicy: "once", minIntervalSeconds: 0, maxRetries: 2, consecutiveFailureThreshold: 3, startDate: "2026-01-01", endDate: null });
    const [job] = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1000).toISOString());
    const registry = new AdapterRegistry(); registry.register(new TestPlatformAdapter("network_error"));
    const publisher = new PublisherService(repository, registry, createConsoleLogger());
    const first = await publisher.executeJob(job.id);
    expect(first.job.status).toBe("Retry");
    repository.claimJob(job.id);
    expect(repository.recoverRunningJobs()).toBe(1);
    expect(repository.getJob(job.id)?.status).toBe("Retry");
    expect(article).not.toBeNull();
    db.close();
  });

  it("moves expired login to NeedsUserAction and pauses the account", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-login-expired-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "登录品牌", companyName: "登录公司" });
    const account = repository.createAccount({ platformKey: "test", name: "失效账号" });
    const article = repository.createArticle({ brandId: brand.id, topic: "topic", keyword: "keyword", city: "南京", title: "标题", body: "这是一段足够长的正文，用于验证登录失效时任务转人工处理并暂停账号。", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `login-${randomUUID()}` });
    const plan = repository.createPlan({ name: "登录计划", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: ["09:00"], reusePolicy: "once", minIntervalSeconds: 0, maxRetries: 2, consecutiveFailureThreshold: 3, startDate: "2026-01-01", endDate: null });
    const [job] = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1000).toISOString());
    const registry = new AdapterRegistry(); registry.register(new TestPlatformAdapter("login_expired"));
    const publisher = new PublisherService(repository, registry, createConsoleLogger());
    const result = await publisher.executeJob(job.id);
    expect(result.job.status).toBe("NeedsUserAction");
    expect(repository.listAccounts().find((item) => item.id === account.id)).toMatchObject({ enabled: false, loginStatus: "expired" });
    expect(article).not.toBeNull();
    db.close();
  });

  it("skips an enabled account whose platform adapter is not registered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-unknown-platform-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const account = repository.createAccount({ platformKey: "test", name: "Legacy fixture account" });
    repository.updateAccount(account.id, { loginStatus: "logged_in" });
    const publisher = new PublisherService(repository, new AdapterRegistry(), createConsoleLogger());
    const scheduler = new PersistentScheduler(repository, publisher, createConsoleLogger(), 60_000);

    await expect(scheduler.runDueJobs()).resolves.toEqual([]);
    const accounts = repository.listAccounts();
    db.close();
    expect(accounts.some((item) => item.id === account.id && item.platformKey === "test")).toBe(true);
  });
});
