import { mkdtempSync, rmSync } from "node:fs";
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
