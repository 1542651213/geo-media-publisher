import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { openDatabase } from "@publisher/db";
import { createConsoleLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("R1.15 scheduled publish product gate", () => {
  it("does not run a persistent account login sweep before startup rehydration is ready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-r115f-startup-health-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages/db/migrations"));
    try {
      repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
      const account = repository.createAccount({ platformKey: "test", name: "启动隔离账号" });
      repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in" });
      const adapter = new TestPlatformAdapter("login_expired");
      const checkLogin = vi.spyOn(adapter, "checkLogin");
      const registry = new AdapterRegistry(); registry.register(adapter);
      const logger = createConsoleLogger();
      const scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, logger), logger, 1000, {
        allowScheduledJob: () => false,
        allowAccountLoginSweep: () => false
      });

      await scheduler.runDueJobs();

      expect(checkLogin).not.toHaveBeenCalled();
      expect(repository.getAccountById(account.id, "test")).toMatchObject({ enabled: true, loginStatus: "logged_in", pausedReason: null });
    } finally { db.close(); }
  });
  it("does not disable a Creator-bound article account because its unrelated legacy OAuth expired", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-r115e-health-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages/db/migrations"));
    try {
      repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
      const account = repository.createAccount({ platformKey: "douyin", name: "隔离 Creator 账号" });
      repository.updateAccount(account.id, { enabled: true, loginStatus: "expired" });
      repository.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "123456789", browserSessionIdHash: "fixture-hash" });
      const legacy = new TestPlatformAdapter("login_expired");
      Object.defineProperty(legacy, "platformKey", { value: "douyin" });
      Object.defineProperty(legacy, "manifest", { value: { ...legacy.manifest, platformKey: "douyin" } });
      const registry = new AdapterRegistry(); registry.register(legacy);
      const logger = createConsoleLogger();
      const scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, logger), logger, 1000, { allowScheduledJob: () => false });
      await scheduler.runDueJobs();
      expect(repository.getAccountById(account.id, "douyin")).toMatchObject({ enabled: true, loginStatus: "expired", pausedReason: null });
      expect(repository.getDouyinImageTextConnection(account.id)?.active).toBe(true);
    } finally { db.close(); }
  });
  it("leaves an existing scheduled formal Job untouched when ordinary batch publishing is closed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-r115-scheduler-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    try {
      repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
      repository.setSetting("defaultPublishMode", "auto");
      const brand = repository.createBrand({ name: "隔离品牌", companyName: "隔离公司" });
      const account = repository.createAccount({ platformKey: "test", name: "隔离账号", allowAutoPublish: true });
      repository.createArticle({ brandId: brand.id, topic: "旧计划", keyword: "审计", city: "南京", title: "旧计划文章", body: "隔离测试正文".repeat(30), summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: "r115-scheduler-fixture" });
      const plan = repository.createPlan({ name: "旧计划", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: [], reusePolicy: "always", minIntervalSeconds: 0, maxRetries: 3, consecutiveFailureThreshold: 3, startDate: "2026-01-01", endDate: null });
      const [job] = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1000).toISOString());
      const registry = new AdapterRegistry(); registry.register(new TestPlatformAdapter());
      const logger = createConsoleLogger();
      const scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, logger), logger, 1000, { allowScheduledJob: () => false });
      expect(await scheduler.runDueJobs()).toEqual([]);
      expect(repository.getJob(job!.id)?.status).toBe("Scheduled");
      expect(repository.getPublishRecordByJob(job!.id)).toBeNull();
    } finally { db.close(); }
  });
});
