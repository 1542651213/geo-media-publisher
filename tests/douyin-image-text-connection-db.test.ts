import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), "douyin-image-connection-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"), join(process.cwd(), "packages/db/migrations"));
  databases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  return opened.repository;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Douyin image/text Creator binding", () => {
  it("keeps the existing video OAuth account fields and increments login generation", () => {
    const repo = setup();
    const account = repo.createAccount({ platformKey: "douyin", name: "Owner" });
    repo.updateAccount(account.id, { loginStatus: "expired" });
    expect(repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "hash-1" })).toEqual({ loginGeneration: 1 });
    expect(repo.getDouyinImageTextConnection(account.id)).toMatchObject({ creatorId: "72388977613", active: true, loginGeneration: 1 });
    expect(repo.getAccountById(account.id, "douyin")).toMatchObject({ loginStatus: "expired", externalAccountId: null });
    expect(repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "hash-2" })).toEqual({ loginGeneration: 2 });
    repo.disconnectDouyinImageTextConnection(account.id);
    expect(repo.getDouyinImageTextConnection(account.id)).toMatchObject({ active: false, loginGeneration: 3 });
  });

  it("rejects a second active binding to the same stable Creator identity", () => {
    const repo = setup();
    const first = repo.createAccount({ platformKey: "douyin", name: "First" });
    const second = repo.createAccount({ platformKey: "douyin", name: "Second" });
    repo.saveDouyinImageTextConnection({ accountId: first.id, creatorId: "72388977613", browserSessionIdHash: "hash-1" });
    expect(() => repo.saveDouyinImageTextConnection({ accountId: second.id, creatorId: "72388977613", browserSessionIdHash: "hash-2" })).toThrow("already bound");
  });

  it("requires a dedicated Creator binding and manually selected image for an article Job", () => {
    const repo = setup();
    repo.setSetting("contentReviewMode", "Off");
    const brand = repo.createBrand({ name: "Test", companyName: "Test" });
    const account = repo.createAccount({ platformKey: "douyin", name: "Owner" });
    const article = repo.createArticle({ brandId: brand.id, title: "Test", body: "Test body", summary: "", tags: [],
      seoKeywords: [], topic: "test", keyword: "test", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
      generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "f".repeat(64), qualityStatus: "passed",
      qualityWarnings: [], source: "production" });
    if (!article) throw new Error("fixture Article unavailable");
    const image = repo.createImageAsset({ brandId: brand.id, name: "Owner test image", filePath: "C:/owner/test.png",
      originalFileName: "test.png", mimeType: "image/png", size: 10 });
    const settings = { version: 1 as const, visibility: "public" as const, timing: "immediate" as const };
    const create = () => repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      imageSelectionMode: "manual", selectedImageAssetId: image.id, douyinImageTextSettings: settings });
    expect(create).toThrow("Creator");
    repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "hash-1" });
    expect(() => repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      douyinImageTextSettings: settings })).toThrow("手动选择");
    const job = create();
    expect(job.status).toBe("AwaitingConfirmation");
    expect(repo.getDouyinImageTextJobSettings(job.id)).toEqual(settings);
    expect(() => repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      imageSelectionMode: "manual", selectedImageAssetId: image.id })).toThrow("Owner");
  });

  it("closes a uniquely matched management publication without inventing public verification", () => {
    const repo = setup();
    repo.setSetting("contentReviewMode", "Off");
    const brand = repo.createBrand({ name: "Test", companyName: "Test" });
    const account = repo.createAccount({ platformKey: "douyin", name: "Owner" });
    repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "hash-1" });
    const article = repo.createArticle({ brandId: brand.id, title: "空气测试", body: "测试正文", summary: "", tags: [],
      seoKeywords: [], topic: "test", keyword: "test", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
      generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "f".repeat(64), qualityStatus: "passed",
      qualityWarnings: [], source: "production" });
    if (!article) throw new Error("fixture Article unavailable");
    const image = repo.createImageAsset({ brandId: brand.id, name: "Test", filePath: "C:/owner/test.png",
      originalFileName: "test.png", mimeType: "image/png", size: 10 });
    const job = repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      imageSelectionMode: "manual", selectedImageAssetId: image.id,
      douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } });
    repo.insertPublishRecord({ jobId: job.id, accountId: account.id, platformKey: "douyin", articleId: article.id,
      publishedUrl: null, publishedExternalId: null, success: false, status: "Prepared", response: { stage: "editor_prepared" } });
    repo.confirmJob(job.id, false);
    const intent = repo.prepareSubmissionIntent(job.id);
    repo.claimFinalSubmitAttempt(intent.id);
    repo.markSubmissionIntentUncertain(intent.id, "SUBMISSION_UNCERTAIN");
    const before = { jobs: repo.listJobs().length, records: repo.getPublishRecords().length };
    const closed = repo.reconcileJobAsPublished(job.id, { externalId: "7361234567890123456", publishedUrl: null,
      publicVerified: false, response: { managementState: "PUBLISHED", publicVerification: "LIMITED" } });
    expect(closed.job.status).toBe("Success");
    expect(closed.record).toMatchObject({ status: "Published", publishedUrl: null, success: true,
      remoteStatus: "PUBLISHED_MANAGEMENT", verificationStatus: "WaitingUser" });
    expect(repo.getSubmissionIntentByJob(job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "PUBLISHED_MANAGEMENT",
      externalId: "7361234567890123456" });
    expect({ jobs: repo.listJobs().length, records: repo.getPublishRecords().length }).toEqual(before);
  });
});
