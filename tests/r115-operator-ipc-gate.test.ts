import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import type { IpcDependencies } from "../apps/desktop/src/main/ipc";

const handlers = vi.hoisted(() => new Map<string, (_event: unknown, payload: unknown) => Promise<unknown>>());
vi.mock("electron", () => ({
  ipcMain: {
    removeHandler: (channel: string) => handlers.delete(channel),
    handle: (channel: string, handler: (_event: unknown, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); }
  },
  app: { getPath: () => "" },
  dialog: {},
  shell: {}
}));

import { registerIpc } from "../apps/desktop/src/main/ipc";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const dirs: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open !== false) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("R1.15 Main IPC operator gate", () => {
  it("accepts only the exact B01 one-shot preparation and never exposes grant or final approval IPC", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-b01-ipc-")); dirs.push(dir);
    const opened = openDatabase(join(dir, "publisher.db"), migrationDir); databases.push(opened.db);
    const { repository } = opened;
    repository.seedDevelopment(platformCsv);
    repository.setSetting("contentReviewMode", "Off");
    const brand = repository.createBrand({ name: "B01", companyName: "B01" });
    const account = repository.createAccount({ platformKey: "douyin", name: "Owner test" });
    const other = repository.createAccount({ platformKey: "douyin", name: "Wrong" });
    repository.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "b01-creator", browserSessionIdHash: "fixture" });
    const marker = `GMP-R115-B01-${Date.now()}`;
    const article = repository.createArticle({ brandId: brand.id, topic: "B01", keyword: "B01", city: "", title: `${marker} unique`,
      body: `${marker} unique body`, summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
      generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "b01-ipc-unique", source: "production" });
    if (!article) throw new Error("Fixture Article missing");
    const bytes = Buffer.from("b01-ipc-image"); const imagePath = join(dir, "image.png"); writeFileSync(imagePath, bytes);
    const image = repository.createImageAsset({ brandId: brand.id, name: "B01", filePath: imagePath, originalFileName: "image.png", mimeType: "image/png", size: bytes.length });
    repository.createB01Authorization({ platformKey: "douyin", accountId: account.id, articleId: article.id, imageAssetId: image.id,
      imageSha256: createHash("sha256").update(bytes).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const publisher = { prepareArticle: async () => { throw new Error("STOP_BEFORE_BROWSER"); },
      executeJob: async () => { throw new Error("STOP_BEFORE_FINAL"); } };
    const registry = { getForContent: () => ({ manifest: { transport: "browser" } }) };
    registerIpc({ repository, publisher, scheduler: {}, registry, b01AcceptanceEnabled: true, resolveAccountSecrets: () => ({}), dataDirectory: dir, coverDir: dir,
      logger: { info: () => {}, warn: () => {}, error: () => {} }, credentials: {}, aiCredentials: {}, appLogPath: "", databasePath: join(dir, "publisher.db") } as unknown as IpcDependencies);
    const invoke = (channel: string, payload: unknown): Promise<unknown> => {
      const handler = handlers.get(channel); if (!handler) throw new Error(`Missing IPC handler ${channel}`); return handler({}, payload);
    };
    const request = { articleId: article.id, platformKey: "douyin", platformAccountId: account.platformAccountId ?? account.id,
      finalPublishMode: "CONFIRM_BEFORE_PUBLISH", imageSelectionMode: "manual", selectedImageAssetId: image.id,
      douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } };
    expect(handlers.has("b01:grant")).toBe(false);
    expect(handlers.has("b01:approve-final")).toBe(false);
    await expect(invoke("b01:eligibility", { accountId: account.id, articleId: article.id, imageAssetId: image.id })).resolves.toMatchObject({ eligible: true });
    await expect(invoke("articles:prepare-publish", { ...request, platformAccountId: other.platformAccountId ?? other.id })).rejects.toThrow();
    await expect(invoke("articles:prepare-publish", { ...request, selectedImageAssetId: "wrong" })).rejects.toThrow();
    await expect(invoke("articles:prepare-publish", { ...request, finalPublishMode: "AUTO_PUBLISH" })).rejects.toThrow();
    expect(repository.listJobs()).toHaveLength(0);
    await expect(invoke("articles:prepare-publish", request)).rejects.toThrow("STOP_BEFORE_BROWSER");
    const job = repository.listJobs()[0];
    expect(job).toMatchObject({ accountId: account.id, articleId: article.id, selectedImageAssetId: image.id, maxAttempts: 1 });
    expect(repository.getB01Authorization()).toMatchObject({ status: "Bound", jobId: job?.id });
    await expect(invoke("b01:job-status", { jobId: job?.id })).resolves.toMatchObject({ eligible: false, status: "Bound" });
    await expect(invoke("articles:prepare-publish", request)).rejects.toThrow();
    await expect(invoke("jobs:confirm", { id: job?.id, dryRun: false })).rejects.toThrow();
    await expect(invoke("jobs:run", { id: job?.id })).rejects.toThrow();
    await expect(invoke("jobs:retry", { id: job?.id })).rejects.toThrow();
    await expect(invoke("platform-self-test:confirm-publish", { testRunId: "forged" })).rejects.toThrow("B01_DIAGNOSTIC_SUBMIT_DISABLED");
    expect(repository.getSubmissionIntentByJob(job!.id)).toBeNull();
    repository.insertPublishRecord({ jobId: job!.id, accountId: job!.accountId, platformAccountId: job!.platformAccountId,
      platformKey: "douyin", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false,
      response: { fixture: "prepared" }, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation",
      verificationStatus: "WaitingUser" });
    repository.markB01Prepared(job!.id);
    await expect(invoke("b01:job-status", { jobId: job!.id })).resolves.toMatchObject({ eligible: false, status: "Prepared" });
    repository.approveB01Final(job!.id, "B01-OWNER-FIXTURE-IPC");
    await expect(invoke("b01:job-status", { jobId: job!.id })).resolves.toMatchObject({ eligible: true, status: "FinalApproved" });
    await expect(invoke("jobs:confirm", { id: job!.id, dryRun: false })).resolves.toMatchObject({ id: job!.id, status: "Scheduled" });
    await expect(invoke("jobs:run", { id: job!.id })).rejects.toThrow("STOP_BEFORE_FINAL");
    expect(repository.getSubmissionIntentByJob(job!.id)).toBeNull();
  });
  it("rejects forged publish requests before Job creation while hidden Job and PublishRecord remain readable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-r115-ipc-")); dirs.push(dir);
    const opened = openDatabase(join(dir, "publisher.db"), migrationDir); databases.push(opened.db);
    const { repository } = opened;
    repository.seedDevelopment(platformCsv);
    repository.setSetting("contentReviewMode", "Off");
    const brand = repository.createBrand({ name: "隔离测试品牌", companyName: "隔离测试公司" });
    const account = repository.createAccount({ platformKey: "zhihu", name: "历史账号" });
    repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "zhihu", browserSessionId: "fixture-session", externalAccountId: "fixture-owner" });
    const article = repository.createArticle({ brandId: brand.id, topic: "旧任务", keyword: "审计", city: "苏州", title: "旧平台任务", body: "仅用于隔离测试", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "r115-hidden-history" });
    if (!article) throw new Error("Fixture article missing");
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id });
    const record = repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.id, platformKey: "zhihu", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { fixture: true }, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });
    const countBefore = repository.listJobs().length;
    registerIpc({ repository, publisher: {}, scheduler: {}, registry: {}, resolveAccountSecrets: () => ({}), dataDirectory: dir, coverDir: dir, logger: { info: () => {}, warn: () => {}, error: () => {} }, credentials: {}, aiCredentials: {}, appLogPath: "", databasePath: join(dir, "publisher.db") } as unknown as IpcDependencies);
    const invoke = (channel: string, payload: unknown): Promise<unknown> => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing IPC handler ${channel}`);
      return handler({}, payload);
    };
    await expect(invoke("articles:prepare-publish", { articleId: article.id, platformKey: "zhihu", platformAccountId: account.id })).rejects.toThrow("普通运营发布已阻止");
    await expect(invoke("articles:prepare-publish", { articleId: article.id, platformKey: "douyin", platformAccountId: account.id })).rejects.toThrow("普通运营发布已阻止");
    await expect(invoke("jobs:run", { id: job.id })).rejects.toThrow("普通运营发布已阻止");
    const plan = repository.createPlan({ name: "旧批量计划", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: [], reusePolicy: "once", minIntervalSeconds: 0, maxRetries: 1, consecutiveFailureThreshold: 1, startDate: "2026-01-01", endDate: null });
    await expect(invoke("plans:generate-jobs", { id: plan.id, scheduledAt: new Date().toISOString() })).rejects.toThrow("普通运营批量发布已阻止");
    await expect(invoke("jobs:list", {})).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: job.id, platformKey: "zhihu" })]));
    await expect(invoke("articles:history", { articleId: article.id })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: record.id, platformKey: "zhihu" })]));
    expect(repository.listJobs()).toHaveLength(countBefore);
    expect(repository.getAccountById(account.id, "zhihu")?.archivedAt).toBeNull();
    expect(repository.getPublishRecordByJob(job.id)?.id).toBe(record.id);
  });
});
