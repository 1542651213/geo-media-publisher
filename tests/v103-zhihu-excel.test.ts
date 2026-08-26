import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const openDatabases: Array<{ close: () => void; open?: boolean }> = [];
afterEach(() => { for (const db of openDatabases.splice(0)) if (db.open !== false) db.close(); for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("V1.0.3 Zhihu account and Excel article import", () => {
  it("keeps one canonical browser account row and synchronizes disconnect state", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v103-account-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir); openDatabases.push(db);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const created = repository.createAccount({ platformKey: "zhihu", name: "知乎主账号" });
    const connected = repository.syncBrowserPlatformAccount({ accountId: created.id, platformKey: "zhihu", accountName: "知乎主账号", browserSessionId: "session-hash", externalAccountId: "zhihu-user-1", lastVerifiedAt: "2026-08-21T00:00:00.000Z" });
    expect(connected.platformAccountId ?? connected.id).toBe(created.id);
    expect(connected).toMatchObject({ loginStatus: "logged_in", connectionMode: "BrowserAutomation", authorizationStatus: "Authorized", browserSessionId: "session-hash", externalAccountId: "zhihu-user-1" });
    expect(repository.listAccounts().filter((account) => account.platformKey === "zhihu")).toHaveLength(1);
    const disconnected = repository.markPlatformAccountDisconnected(created.id, "zhihu");
    expect(disconnected).toMatchObject({ loginStatus: "logged_out", authorizationStatus: "NotAuthorized", browserSessionId: null, externalAccountId: "zhihu-user-1" });
    expect(repository.getAccountAuthorization(created.id, "zhihu")?.status).toBe("NotAuthorized");
  });

  it("previews, validates, deduplicates and imports Excel rows without creating jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v103-excel-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir); openDatabases.push(db);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "测试品牌", companyName: "测试公司" });
    const preview = repository.previewExcelArticleImport({ fileName: "Geo Media Publisher 文章导入模板.xlsx", rows: [
      { rowNumber: 2, templateVersion: "1.0", title: "Excel 标题", body: "Excel 正文内容", summary: "摘要", company: brand.companyName, business: "环保服务", city: "南京", keywords: "关键词1；关键词2", tags: "标签1;标签2", targetPlatforms: "zhihu", contentType: "科普", promotionStrength: "Soft", sourceNote: "导入备注" },
      { rowNumber: 3, templateVersion: "1.0", title: "", body: "正文", summary: "", company: brand.companyName, business: "", city: "", keywords: "", tags: "", targetPlatforms: "", contentType: "", promotionStrength: "", sourceNote: "" },
      { rowNumber: 4, templateVersion: "1.0", title: "未知企业文章", body: "正文", summary: "", company: "不存在公司", business: "", city: "", keywords: "", tags: "", targetPlatforms: "zhihu", contentType: "", promotionStrength: "", sourceNote: "" },
      { rowNumber: 5, templateVersion: "1.0", title: "非法平台文章", body: "正文", summary: "", company: brand.companyName, business: "", city: "", keywords: "", tags: "", targetPlatforms: "not-a-platform", contentType: "", promotionStrength: "", sourceNote: "" }
    ], warnings: ["未知字段列：密码"] });
    expect(preview).toMatchObject({ totalRows: 4, validRows: 1, errorRows: 3, duplicateRows: 0, warnings: ["未知字段列：密码"] });
    expect(preview.rows[1]?.errorCodes).toContain("TITLE_REQUIRED");
    expect(preview.rows[2]?.status).toBe("UNKNOWN_BRAND");
    expect(preview.rows[3]?.errorCodes).toContain("INVALID_PLATFORM");
    const result = repository.confirmExcelArticleImport({ preview });
    expect(result).toMatchObject({ imported: 1, skippedDuplicates: 0, failed: 3 });
    const imported = repository.listArticles({ source: "excel_import" });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ source: "excel_import", company: brand.companyName, targetPlatforms: ["zhihu"], promotionStrength: "Soft", sourceFilename: "Geo Media Publisher 文章导入模板.xlsx", qualityStatus: "unchecked" });
    expect(repository.listJobs()).toHaveLength(0);
    const firstRow = preview.rows[0];
    if (!firstRow) throw new Error("preview row missing");
    const duplicatePreview = repository.previewExcelArticleImport({ fileName: preview.fileName, rows: [firstRow] });
    expect(duplicatePreview.rows[0]?.status).toBe("DUPLICATE");
    expect(repository.confirmExcelArticleImport({ preview: duplicatePreview }).skippedDuplicates).toBe(1);
    expect(repository.confirmExcelArticleImport({ preview: duplicatePreview, duplicateRowNumbers: [2] }).imported).toBe(1);
    expect(repository.listArticles({ source: "excel_import" })).toHaveLength(2);
  });

  it("binds an approved Zhihu article job to the canonical platform account", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v103-job-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir); openDatabases.push(db);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "品牌", companyName: "公司" });
    const account = repository.createAccount({ platformKey: "zhihu", name: "知乎账号" });
    repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "zhihu", browserSessionId: "hash" });
    const article = repository.createArticle({ brandId: brand.id, topic: "主题", keyword: "关键词", city: "南京", title: "标题", body: "正文", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "excel_import", aiModel: "1.0", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "v103-job-hash" });
    if (!article) throw new Error("article not created");
    repository.setSetting("contentReviewMode", "Strict");
    expect(() => repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id })).toThrow("Approved");
    repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: brand.id, platformKey: null, contentHash: article.contentHash, trigger: "manual_recheck", provider: "test", model: "test", result: { status: "AI_Checked", score: 100, checks: [], issues: [] }, snapshot: {} });
    repository.decideContentQuality("article", article.id, "Approved");
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id, publishMode: "ASSISTED" });
    expect(job).toMatchObject({ accountId: account.id, platformAccountId: account.id, platformKey: "zhihu", articleId: article.id, status: "AwaitingConfirmation", manualConfirmationRequired: true, dryRun: false });
    const record = repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: job.platformAccountId, platformKey: "zhihu", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { events: ["EDITOR_OPEN_PASSED", "TITLE_FILLED", "BODY_FILLED"] }, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", editorOpenedAt: new Date().toISOString(), titleFilled: true, bodyFilled: true, verificationStatus: "WaitingUser" });
    expect(repository.getPublishRecordByJob(job.id)).toMatchObject({ id: record.id, status: "Prepared", success: false, platformAccountId: account.id, publishedUrl: null, publishedExternalId: null, titleFilled: true, bodyFilled: true });
  });
});
