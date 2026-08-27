import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { PublisherService } from "@publisher/publisher";
import type { Logger } from "@publisher/logger";
import type { PlatformSelfTestLevel, PlatformSelfTestRun } from "@publisher/domain";
import { PlatformSelfTestService, assertHealthCheckLevels, isBlockingImageUploadFailure, selfTestContentKind, summarizeSelfTestResult, transparentSelfTestContent } from "../apps/desktop/src/main/platform-self-test";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];
const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function fixture(mode: ConstructorParameters<typeof TestPlatformAdapter>[0] = "success") {
  process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED = "1";
  const dir = mkdtempSync(join(tmpdir(), "publisher-v113-")); tempDirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), migrationDir); databases.push(opened.db);
  opened.repository.seedDevelopment(platformCsv);
  const adapter = new TestPlatformAdapter(mode);
  const registry = new AdapterRegistry(); registry.register(adapter);
  const publisher = new PublisherService(opened.repository, registry, logger, { resolveSecrets: () => ({}) });
  const service = new PlatformSelfTestService({ repository: opened.repository, registry, publisher, resolveAccountSecrets: () => ({}), logger });
  const brand = opened.repository.createBrand({ name: "自测企业", companyName: "自测企业" });
  const account = opened.repository.createAccount({ platformKey: "test", name: "测试账号" });
  opened.repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in" });
  return { ...opened, adapter, registry, publisher, service, brand, account };
}

const originalBatchConfirmation = process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED;
afterEach(() => {
  if (originalBatchConfirmation === undefined) delete process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED;
  else process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED = originalBatchConfirmation;
  for (const db of databases.splice(0)) if (db.open !== false) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("V1.1.3 platform self-test state and evidence", () => {
  it("uses article routing for Toutiao and video routing for explicit video self-tests", () => {
    expect(selfTestContentKind("toutiao")).toBe("article");
    expect(selfTestContentKind("douyin")).toBe("video");
  });

  it("persists the L1-L5 state machine without treating unsupported steps as real passes", () => {
    const { repository, account } = fixture();
    const run = repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L5_PUBLISH" });
    const levels: PlatformSelfTestLevel[] = ["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT", "L5_PUBLISH"];
    levels.forEach((level, index) => repository.recordPlatformSelfTestStep({ testRunId: run.testRunId, testLevel: level, stepKey: `level-${index}`, startedAt: new Date().toISOString(), result: index < 3 ? "PASSED" : "NOT_SUPPORTED" }));
    const stored = repository.getPlatformSelfTestRun(run.testRunId) as PlatformSelfTestRun;
    expect(stored.steps.map((item) => item.testLevel)).toEqual(levels);
    expect(summarizeSelfTestResult(stored)).not.toBe("PASSED");
  });

  it("requires explicit L5 confirmation before creating any persistent Job", async () => {
    const { repository, service, account } = fixture();
    const requested = service.requestPublish(account.id);
    expect(requested.overallResult).toBe("WAITING_FOR_USER");
    expect(repository.listJobs()).toHaveLength(0);
    expect(repository.listArticles({ source: "test" })).toHaveLength(0);

    const completed = await service.confirmPublish(requested.testRunId);
    expect(completed.publishConfirmedAt).not.toBeNull();
    expect(repository.listJobs()).toHaveLength(1);
    expect(repository.listArticles({ source: "test" })).toHaveLength(1);
    expect(repository.listArticles({ source: "production" })).toHaveLength(0);
  });

  it("requires the batch confirmation flag before even creating an L5 publish Job", () => {
    const { repository, service, account } = fixture();
    delete process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED;
    const requested = service.requestPublish(account.id);
    expect(requested.overallResult).toBe("WAITING_FOR_USER");
    expect(requested.steps.find((step) => step.stepKey === "PUBLISH_CONFIRMATION")?.errorCode).toBe("REAL_PUBLISH_TEST_BATCH_CONFIRMATION_REQUIRED");
    expect(repository.listJobs()).toHaveLength(0);
  });

  it("keeps the default L1-L3 self-test free of persistent content and real publish Jobs", async () => {
    const { repository, service, account } = fixture();
    const run = await service.runSafe(account.id);
    expect(run.requestedLevel).toBe("L3_CONTENT_FILL");
    expect(repository.listJobs()).toHaveLength(0);
    expect(repository.listArticles({ source: "test" })).toHaveLength(0);
    expect(repository.getPublishRecords()).toHaveLength(0);
  });

  it("routes an explicit internal account ID even when an external platform ID is present", async () => {
    const { repository, service, account } = fixture();
    repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "test", accountName: "平台昵称", externalAccountId: "external-test-id", browserSessionId: "session:test:" + account.id });

    const run = await service.runSafe(account.id);

    expect(run.platformKey).toBe("test");
    expect(run.platformAccountId).toBe(account.id);
    expect(repository.listJobs()).toHaveLength(0);
    expect(repository.getPublishRecords()).toHaveLength(0);
  });

  it("uses a unique short Baijiahao self-test title and body", () => {
    const content = transparentSelfTestContent("baijiahao", "百家号", new Date("2026-08-25T07:08:09.000Z"));
    expect(content.title).toBe("GMP 百家号真实发布测试 2026-08-25 15:08:09");
    expect(content.body).toContain("GMP 百家号真实发布测试");
    expect(content.body.length).toBeLessThan(120);
  });

  it("does not block a publish when a platform declares the image optional", () => {
    expect(isBlockingImageUploadFailure("FAILED", false)).toBe(false);
    expect(isBlockingImageUploadFailure("FAILED", true)).toBe(true);
    expect(isBlockingImageUploadFailure("NOT_SUPPORTED", true)).toBe(false);
  });

  it("enforces that batch health checks can only execute L1", () => {
    expect(() => assertHealthCheckLevels(["L1_LOGIN"])).not.toThrow();
    expect(() => assertHealthCheckLevels(["L1_LOGIN", "L2_EDITOR"])).toThrow("只能执行 L1_LOGIN");
    expect(() => assertHealthCheckLevels(["L5_PUBLISH"])).toThrow("只能执行 L1_LOGIN");
  });

  it("does not create 13 Lieju posts or Jobs when one account is selected for publish confirmation", () => {
    const { repository } = fixture();
    const accounts = Array.from({ length: 13 }, (_, index) => repository.createAccount({ platformKey: "lieju", name: `列举网-${String(index + 1).padStart(2, "0")}` }));
    const selected = repository.createPlatformSelfTestRun({ platformAccountId: accounts[4]!.id, requestedLevel: "L5_PUBLISH" });
    repository.recordPlatformSelfTestStep({ testRunId: selected.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_CONFIRMATION", startedAt: new Date().toISOString(), result: "WAITING_FOR_USER" });
    expect(repository.listPlatformSelfTestRuns().filter((run) => run.platformKey === "lieju")).toHaveLength(1);
    expect(repository.listJobs().filter((job) => job.platformKey === "lieju")).toHaveLength(0);
  });

  it("isolates Browser and OAuth/API account results by platformAccountId", () => {
    const { repository } = fixture();
    const browserA = repository.createAccount({ platformKey: "zhihu", name: "知乎-A" });
    const browserB = repository.createAccount({ platformKey: "zhihu", name: "知乎-B" });
    const oauthA = repository.createAccount({ platformKey: "douyin", name: "抖音-A" });
    const oauthB = repository.createAccount({ platformKey: "douyin", name: "抖音-B" });
    for (const account of [browserA, browserB, oauthA, oauthB]) {
      const run = repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L1_LOGIN" });
      repository.recordPlatformSelfTestStep({ testRunId: run.testRunId, testLevel: "L1_LOGIN", stepKey: "ACCOUNT_CONNECTION", startedAt: new Date().toISOString(), result: account.id === browserA.id || account.id === oauthA.id ? "PASSED" : "FAILED" });
    }
    expect(repository.listPlatformSelfTestRuns(browserA.id)[0]?.steps[0]?.result).toBe("PASSED");
    expect(repository.listPlatformSelfTestRuns(browserB.id)[0]?.steps[0]?.result).toBe("FAILED");
    expect(repository.listPlatformSelfTestRuns(oauthA.id)[0]?.steps[0]?.result).toBe("PASSED");
    expect(repository.listPlatformSelfTestRuns(oauthB.id)[0]?.steps[0]?.result).toBe("FAILED");
  });

  it("stores External URL only after a real successful PublishRecord", async () => {
    const { repository, service, account } = fixture("success");
    const requested = service.requestPublish(account.id);
    expect((await service.confirmPublish(requested.testRunId)).externalUrl).toMatch(/^test:\/\/published\//u);

    const second = repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L5_PUBLISH" });
    repository.confirmPlatformSelfTestPublish(second.testRunId);
    const content = transparentSelfTestContent("test", "TestPlatform");
    const job = repository.createPlatformSelfTestPublishJob({ testRunId: second.testRunId, title: content.title, body: content.body, dryRun: true });
    repository.confirmJob(job.id, true);
    const publisher = new PublisherService(repository, new AdapterRegistry(), logger);
    expect(publisher).toBeTruthy();
    expect(repository.getPlatformSelfTestRun(second.testRunId)?.externalUrl).toBeNull();
  });

  it("does not convert a failed or WAITING_FOR_USER test into PublishPassed", async () => {
    const failed = fixture("permanent_failure");
    const failedRequest = failed.service.requestPublish(failed.account.id);
    const failedRun = await failed.service.confirmPublish(failedRequest.testRunId);
    expect(failedRun.overallResult).toBe("FAILED");
    expect(failedRun.externalUrl).toBeNull();
    expect(failed.repository.listPlatforms().find((platform) => platform.platformKey === "test")?.verificationStatus).not.toBe("PublishPassed");

    const waiting = fixture("user_action");
    const waitingRequest = waiting.service.requestPublish(waiting.account.id);
    const waitingRun = await waiting.service.confirmPublish(waitingRequest.testRunId);
    expect(waitingRun.overallResult).toBe("WAITING_FOR_USER");
    expect(waiting.repository.listJobs()).toHaveLength(0);
  });

  it("requires a second delete confirmation and never exposes secrets in evidence", () => {
    const { repository, account } = fixture();
    const run = repository.createPlatformSelfTestRun({ platformAccountId: account.id, requestedLevel: "L5_PUBLISH" });
    expect(() => repository.confirmPlatformSelfTestDelete(run.testRunId)).toThrow("没有可确认删除");
    repository.recordPlatformSelfTestStep({ testRunId: run.testRunId, testLevel: "L1_LOGIN", stepKey: "SESSION_OR_OAUTH", startedAt: new Date().toISOString(), result: "FAILED", message: "Authorization=Bearer secret-value Cookie=session-value" });
    const stored = repository.getPlatformSelfTestRun(run.testRunId) as PlatformSelfTestRun;
    expect(stored.steps[0]?.message).not.toContain("secret-value");
    expect(stored.steps[0]?.message).not.toContain("session-value");
  });
});
