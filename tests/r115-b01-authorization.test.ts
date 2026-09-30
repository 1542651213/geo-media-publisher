import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
const settings = { version: 1 as const, visibility: "public" as const, timing: "immediate" as const };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gmp-b01-")); roots.push(root);
  const opened = openDatabase(join(root, "test.db"), join(process.cwd(), "packages/db/migrations"));
  databases.push(opened.db);
  const repo = opened.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  repo.setSetting("contentReviewMode", "Off");
  const brand = repo.createBrand({ name: "B01 isolated", companyName: "B01 isolated" });
  const account = repo.createAccount({ platformKey: "douyin", name: "B01 test account" });
  const otherAccount = repo.createAccount({ platformKey: "douyin", name: "Other account" });
  repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "b01-creator", browserSessionIdHash: "fixture-session" });
  const article = repo.createArticle({ brandId: brand.id, title: "B01 unique", body: "B01 unique body", summary: "", tags: [],
    seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
    generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "b01-unique-content", qualityStatus: "passed",
    qualityWarnings: [], source: "production" });
  if (!article) throw new Error("Fixture Article missing");
  const bytes = Buffer.from("isolated B01 image bytes");
  const imagePath = join(root, "b01.png"); writeFileSync(imagePath, bytes);
  const image = repo.createImageAsset({ brandId: brand.id, name: "B01 image", filePath: imagePath,
    originalFileName: "b01.png", mimeType: "image/png", size: bytes.length });
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  const target = { platformKey: "douyin" as const, accountId: account.id, articleId: article.id, imageAssetId: image.id,
    imageSha256, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  return { root, repo, account, otherAccount, article, image, imagePath, imageSha256, target };
}

afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("R1.15-B01 Main-owned one-shot authorization", () => {
  it("persists one exact grant and never grants final submission at creation", () => {
    const { repo, target, otherAccount, article, image } = fixture();
    expect(repo.createB01Authorization(target)).toMatchObject({ status: "Created", platformKey: "douyin", accountId: target.accountId,
      articleId: article.id, imageAssetId: image.id, imageSha256: target.imageSha256, jobId: null, finalAuthorizedAt: null });
    expect(repo.getB01Authorization()).toMatchObject({ status: "Created" });
    expect(repo.b01Eligibility({ accountId: otherAccount.id, articleId: article.id, imageAssetId: image.id }).eligible).toBe(false);
    expect(repo.b01Eligibility({ accountId: target.accountId, articleId: article.id, imageAssetId: image.id })).toMatchObject({ eligible: true, status: "Created" });
    expect(() => repo.createB01Authorization(target)).toThrow();
    expect(() => repo.createB01Authorization({ ...target, platformKey: "weibo" as "douyin" })).toThrow();
  });

  it("rejects wrong image bytes, expired and revoked grants", () => {
    const { repo, target, imagePath, article, image } = fixture();
    repo.createB01Authorization(target);
    writeFileSync(imagePath, "mutated image bytes");
    expect(repo.b01Eligibility({ accountId: target.accountId, articleId: article.id, imageAssetId: image.id }).eligible).toBe(false);
    expect(() => repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH", douyinImageTextSettings: settings })).toThrow();
    repo.revokeB01Authorization();
    expect(repo.getB01Authorization()?.status).toBe("Revoked");
    expect(repo.b01Eligibility({ accountId: target.accountId, articleId: article.id, imageAssetId: image.id }).eligible).toBe(false);
  });

  it("binds one fresh Job and separates prepared state from Owner final approval", () => {
    const { repo, target, article, image } = fixture();
    repo.createB01Authorization(target);
    const job = repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH", douyinImageTextSettings: settings });
    expect(repo.getB01Authorization()).toMatchObject({ status: "Bound", jobId: job.id });
    expect(() => repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH", douyinImageTextSettings: settings })).toThrow();
    expect(() => repo.approveB01Final(job.id, "B01-OWNER-FIXTURE-001")).toThrow();
    expect(() => repo.assertB01Job(job.id, "final")).toThrow();
  });

  it("restores the same bound Job after restart and atomically consumes authorization with the existing final claim", () => {
    const { repo, root, target, article, image } = fixture();
    repo.createB01Authorization(target);
    const job = repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH", douyinImageTextSettings: settings });
    databases.pop()?.close();
    const reopened = openDatabase(join(root, "test.db"), join(process.cwd(), "packages/db/migrations"));
    databases.push(reopened.db);
    const recovered = reopened.repository;
    expect(recovered.getB01Authorization()).toMatchObject({ status: "Bound", jobId: job.id, finalAuthorizedAt: null });
    recovered.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId,
      platformKey: "douyin", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false,
      response: { fixture: "prepared" }, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation",
      verificationStatus: "WaitingUser" });
    recovered.markB01Prepared(job.id);
    expect(recovered.getB01Authorization()).toMatchObject({ status: "Prepared", finalAuthorizedAt: null });
    const approved = recovered.approveB01Final(job.id, "B01-OWNER-FIXTURE-001");
    expect(approved).toMatchObject({ status: "FinalApproved" });
    const intent = recovered.prepareSubmissionIntent(job.id);
    expect(recovered.getSubmissionIntentByJob(job.id)?.finalSubmitCount).toBe(0);
    const claimed = recovered.claimFinalSubmitAttempt(intent.id, { requireB01: true });
    expect(claimed.jobId).toBe(job.id);
    expect(recovered.getSubmissionIntentByJob(job.id)?.finalSubmitCount).toBe(1);
    expect(recovered.getB01Authorization()).toMatchObject({ status: "Consumed", jobId: job.id });
    expect(() => recovered.claimFinalSubmitAttempt(intent.id, { requireB01: true })).toThrow();
    expect(() => recovered.createB01Authorization(target)).toThrow();
  });

  it("fails closed when a grant expires without creating any Job or final claim", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00.000Z"));
    const { repo, target, article, image } = fixture();
    repo.createB01Authorization({ ...target, expiresAt: "2026-09-30T00:00:01.000Z" });
    vi.setSystemTime(new Date("2026-09-30T00:00:02.000Z"));
    expect(repo.b01Eligibility({ accountId: target.accountId, articleId: article.id, imageAssetId: image.id })).toMatchObject({ eligible: false, status: "Expired" });
    expect(() => repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH", douyinImageTextSettings: settings })).toThrow();
    expect(repo.listJobs()).toHaveLength(0);
  });

  it("does not authorize a replacement Article carrying the same text as an uncertain Douyin Job", () => {
    const { repo, target, account, article, image } = fixture();
    const oldArticle = repo.createArticle({ brandId: article.brandId, title: article.title, body: article.body,
      summary: "old", tags: [], seoKeywords: [], topic: "old", keyword: "old", city: "", articleType: "科普",
      aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once",
      contentHash: "different-historical-hash", source: "production" });
    if (!oldArticle) throw new Error("Fixture historical Article missing");
    const historical = repo.createArticlePublishJob({ articleId: oldArticle.id, platformKey: "douyin",
      platformAccountId: account.platformAccountId ?? account.id, selectedImageAssetId: image.id,
      imageSelectionMode: "manual", douyinImageTextSettings: settings });
    repo.updateJobFailure(historical.id, "NeedsReconciliation", "SUBMISSION_UNCERTAIN", "fixture uncertain", null);
    expect(() => repo.createB01Authorization(target)).toThrow("B01_HISTORICAL_ARTICLE_OR_CONTENT_FORBIDDEN");
    expect(repo.getB01Authorization()).toBeNull();
  });
});
