import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, runMigrations } from "@publisher/db";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
const settings = { version: 1 as const, visibility: "public" as const, timing: "immediate" as const };

function fixture(source: "production" | "excel_import" | "test" = "production") {
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
  const marker = `B01-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const article = repo.createArticle({ brandId: brand.id, title: `${marker} unique`, body: `${marker} unique body`, summary: "", tags: [],
    seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
    generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "b01-unique-content", qualityStatus: "passed",
    qualityWarnings: [], source });
  if (!article) throw new Error("Fixture Article missing");
  const bytes = Buffer.from("isolated B01 image bytes");
  const imagePath = join(root, "b01.png"); writeFileSync(imagePath, bytes);
  const image = repo.createImageAsset({ brandId: brand.id, name: "B01 image", filePath: imagePath,
    originalFileName: "b01.png", mimeType: "image/png", size: bytes.length });
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  const target = { platformKey: "douyin" as const, accountId: account.id, articleId: article.id, imageAssetId: image.id,
    imageSha256, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  return { root, db: opened.db, repo, account, otherAccount, article, image, imagePath, imageSha256, target };
}

afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("R1.15-B01 Main-owned one-shot authorization", () => {
  it("forwards an existing 0027 grant without changing frozen data, then does not reapply the migration", () => {
    const { repo, db, target } = fixture();
    const before = repo.createB01Authorization(target);
    const columns = (db.prepare("PRAGMA table_info(b01_product_e2e_authorization)").all() as Array<{ name: string }>).map(x => x.name).filter(x => x !== "retired_preboundary_at").join(",");
    db.exec("ALTER TABLE b01_product_e2e_authorization RENAME TO fixture_previous");
    db.exec(readFileSync(join(process.cwd(), "packages/db/migrations/0027_r115_b01_product_e2e_authorization.sql"), "utf8"));
    db.exec(`INSERT INTO b01_product_e2e_authorization (${columns}) SELECT ${columns} FROM fixture_previous; DROP TABLE fixture_previous; DELETE FROM migrations WHERE id='0028_b01_preboundary_retirement.sql';`);
    runMigrations(db, join(process.cwd(), "packages/db/migrations"));
    expect(repo.getB01Authorization()).toEqual(before);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    runMigrations(db, join(process.cwd(), "packages/db/migrations"));
    expect(repo.getB01Authorization()).toEqual(before);
  });
  it("retires only a proven unsubmitted failed attempt, preserving its immutable bindings and permanently blocking it", () => {
    const { repo, db, target, article, image } = fixture();
    const original = repo.createB01Authorization(target);
    const input = { articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual" as const, finalPublishMode: "CONFIRM_BEFORE_PUBLISH" as const, douyinImageTextSettings: settings };
    const job = repo.createB01Job(input);
    expect(() => repo.retireB01Preboundary(job.id)).toThrow("B01_SAFE_PREBOUNDARY_RETIREMENT_REQUIRED");
    repo.updateJobFailure(job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "pre-boundary fixture", null);
    const retired = repo.retireB01Preboundary(job.id);
    expect(retired).toMatchObject({ id: original.id, accountId: original.accountId, articleId: original.articleId,
      imageSha256: original.imageSha256, articleSnapshotSha256: original.articleSnapshotSha256, status: "Revoked", jobId: job.id });
    expect(repo.getJob(job.id)?.status).toBe("Cancelled");
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
    expect(repo.getPublishRecordByJob(job.id)).toBeNull();
    for (const action of [() => repo.confirmJob(job.id), () => repo.claimJob(job.id),
      () => repo.prepareSubmissionIntent(job.id), () => repo.updateJobFailure(job.id, "Retry", "UNKNOWN", "retry", null)])
      expect(action).toThrow("B01_RETIRED_JOB_PERMANENTLY_BLOCKED");
    expect(() => repo.createB01Authorization(target)).toThrow("B01_HISTORICAL_ARTICLE_OR_CONTENT_FORBIDDEN");
    const next = repo.createArticle({ brandId: article.brandId, title: "通风记录 B01-B12345", body: "正常通风记录 B01-B12345",
      summary: "", tags: [], seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普",
      aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "new-unique-content", source: "excel_import" });
    if (!next) throw new Error("New Article missing");
    const created = repo.createB01Authorization({ ...target, articleId: next.id });
    expect(created.id).not.toBe(retired.id);
    expect(repo.getB01Authorization(job.id)).toEqual(retired);
    expect(db.prepare("SELECT COUNT(*) AS n FROM b01_product_e2e_authorization").get()).toEqual({ n: 2 });
    expect(() => repo.assertB01Job(job.id, "final")).toThrow();
    expect(() => repo.createB01Authorization({ ...target, articleId: next.id })).toThrow();
  });

  it("cannot retire an attempt with even an unclaimed Intent or reopen a generic revoked grant", () => {
    const { repo, target, article, image } = fixture();
    repo.createB01Authorization(target);
    const job = repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH", douyinImageTextSettings: settings });
    repo.prepareSubmissionIntent(job.id);
    repo.updateJobFailure(job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "fixture", null);
    expect(repo.getSubmissionIntentByJob(job.id)?.finalSubmitCount).toBe(0);
    expect(() => repo.retireB01Preboundary(job.id)).toThrow();
    repo.revokeB01Authorization();
    expect(repo.canCreateB01Authorization()).toBe(false);
  });

  it("rejects long titles before authorization or Job creation", () => {
    const { repo, target, article, account } = fixture();
    repo.updateArticle(article.id, { title: "超长标题".repeat(5) + " B01-A7F39C", body: "B01-A7F39C" });
    expect(() => repo.createB01Authorization(target)).toThrow("20");
    expect(() => repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id })).toThrow("20");
    expect(repo.listJobs()).toHaveLength(0);
  });
  it("accepts a fresh ordinary-library Excel Article and rejects test sources", () => {
    const normal = fixture("excel_import");
    expect(normal.article.source).toBe("excel_import");
    expect(normal.repo.createB01Authorization(normal.target).status).toBe("Created");
    const hidden = fixture("test");
    expect(() => hidden.repo.createB01Authorization(hidden.target)).toThrow("B01_AUTH_TARGET_INVALID");
  });

  it("rejects stale content, marker mismatch, a reused marker, and a wrong company", () => {
    const stale = fixture("excel_import");
    stale.db.prepare("UPDATE articles SET created_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z", stale.article.id);
    expect(() => stale.repo.createB01Authorization(stale.target)).toThrow("B01_AUTH_TARGET_INVALID");
    const changed = fixture("excel_import");
    changed.repo.updateArticle(changed.article.id, { body: "marker missing from body" });
    expect(() => changed.repo.createB01Authorization(changed.target)).toThrow("B01_AUTH_TARGET_INVALID");
    const company = fixture("excel_import");
    company.db.prepare("UPDATE articles SET company=? WHERE id=?").run("Another company", company.article.id);
    expect(() => company.repo.createB01Authorization(company.target)).toThrow("B01_AUTH_TARGET_INVALID");
    const repeated = fixture("excel_import");
    const sameMarker = repeated.article.title.match(/B01-[A-F0-9]{6,8}/u)?.[0];
    if (!sameMarker) throw new Error("Fixture marker missing");
    const another = repeated.repo.createArticle({ brandId: repeated.article.brandId, title: `${sameMarker} another`, body: "different body", summary: "", tags: [],
      seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "excel_import", aiModel: "1.0",
      generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `other-${sameMarker}`, source: "excel_import" });
    expect(another).not.toBeNull();
    expect(() => repeated.repo.createB01Authorization(repeated.target)).toThrow("B01_MARKER_ALREADY_USED");
  });
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

  it("rejects final approval if an Intent was created during Prepared instead of after approval", () => {
    const { repo, target, article, image } = fixture();
    repo.createB01Authorization(target);
    const job = repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: target.accountId,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
      douyinImageTextSettings: settings });
    repo.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId,
      platformKey: "douyin", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false,
      response: { fixture: "prepared" }, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation",
      verificationStatus: "WaitingUser" });
    repo.markB01Prepared(job.id);
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
    repo.prepareSubmissionIntent(job.id);
    expect(() => repo.approveB01Final(job.id, "B01-OWNER-FIXTURE-001")).toThrow("B01_FINAL_APPROVAL_NOT_ELIGIBLE");
    expect(repo.getB01Authorization()?.status).toBe("Prepared");
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
