import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it } from "vitest";
import { EXCEL_ADVANCED_ARTICLE_HEADERS, EXCEL_SIMPLE_ARTICLE_HEADERS, defaultAccountSelection } from "@publisher/domain";
import { openDatabase } from "@publisher/db";
import { writeAdvancedExcelTemplate, writeSimpleExcelTemplate } from "../apps/desktop/src/main/excel-templates";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const openDatabases: Array<{ close: () => void; open?: boolean }> = [];
afterEach(() => { for (const db of openDatabases.splice(0)) if (db.open !== false) db.close(); for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function articleInput(brandId: string, title: string, hash: string, business = "甲醛治理", city = "苏州") {
  return { brandId, topic: title, keyword: "甲醛", city, title, body: `${title}正文`, summary: "", tags: [], seoKeywords: ["甲醛"], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: hash, business, source: "production" as const };
}

function approve(repository: ReturnType<typeof openDatabase>["repository"], articleId: string, brandId: string, contentHash: string): void {
  repository.saveContentQualityReview({ contentType: "article", contentId: articleId, brandId, platformKey: null, contentHash, trigger: "manual_recheck", provider: "test", model: "test", result: { status: "AI_Checked", score: 100, checks: [], issues: [] }, snapshot: {} });
  repository.decideContentQuality("article", articleId, "Approved");
}

describe("V1.0.4 simple import and image library", () => {
  it("generates a simple one-sheet template and retains the advanced template", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v104-template-")); tempDirs.push(dir);
    const simplePath = join(dir, "simple.xlsx"); const advancedPath = join(dir, "advanced.xlsx");
    writeSimpleExcelTemplate(simplePath); writeAdvancedExcelTemplate(advancedPath);
    const simple = XLSX.readFile(simplePath); const advanced = XLSX.readFile(advancedPath);
    expect(simple.SheetNames).toEqual(["文章导入"]);
    expect(XLSX.utils.sheet_to_json(simple.Sheets["文章导入"], { header: 1 })[0]).toEqual([...EXCEL_SIMPLE_ARTICLE_HEADERS]);
    expect(advanced.SheetNames).toEqual(["文章导入", "填写说明"]);
    expect(XLSX.utils.sheet_to_json(advanced.Sheets["文章导入"], { header: 1 })[0]).toEqual([...EXCEL_ADVANCED_ARTICLE_HEADERS]);
  });

  it("imports simple title/content rows into Production without creating jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v104-simple-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir); openDatabases.push(db);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.listBrands()[0] ?? repository.createBrand({ name: "单企业品牌", companyName: "单企业公司" });
    const preview = repository.previewExcelArticleImport({ fileName: "Geo Media Publisher 简易文章导入模板.xlsx", rows: [
      { rowNumber: 2, templateVersion: "1.0", title: "简易标题一", body: "简易正文一", summary: "", company: "", business: "", city: "", keywords: "", tags: "", targetPlatforms: "", contentType: "", promotionStrength: "", sourceNote: "" },
      { rowNumber: 3, templateVersion: "1.0", title: "简易标题二", body: "简易正文二", summary: "", company: "", business: "", city: "", keywords: "", tags: "", targetPlatforms: "", contentType: "", promotionStrength: "", sourceNote: "" }
    ] });
    expect(preview.validRows).toBe(2);
    expect(preview.rows.every((row) => row.matchedBrandId === brand.id)).toBe(true);
    const result = repository.confirmExcelArticleImport({ preview });
    expect(result.imported).toBe(2);
    expect(repository.listArticles({ source: "excel_import" })).toHaveLength(2);
    expect(repository.listJobs()).toHaveLength(0);
  });

  it("auto-selects one account, requires a choice for multiple accounts, and persists image matching", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v104-images-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir); openDatabases.push(db);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "图片品牌", companyName: "图片公司" });
    const account = repository.createAccount({ platformKey: "zhihu", name: "知乎账号" });
    repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "zhihu", browserSessionId: "session" });
    expect(defaultAccountSelection([account])).toMatchObject({ selectedAccountId: account.id, requiresChoice: false });
    expect(defaultAccountSelection([account, { ...account, id: "second", platformAccountId: "second" }])).toMatchObject({ selectedAccountId: null, requiresChoice: true });
    const first = repository.createArticle(articleInput(brand.id, "图片文章一", "a".repeat(64)));
    const second = repository.createArticle(articleInput(brand.id, "图片文章二", "b".repeat(64)));
    if (!first || !second) throw new Error("articles not created");
    approve(repository, first.id, brand.id, first.contentHash); approve(repository, second.id, brand.id, second.contentHash);
    writeFileSync(join(dir, "best.jpg"), Buffer.from("fixturejpg"));
    const best = repository.createImageAsset({ brandId: brand.id, name: "业务城市平台图", filePath: join(dir, "best.jpg"), originalFileName: "best.jpg", mimeType: "image/jpeg", size: 10, business: ["甲醛治理"], city: ["苏州"], platform: ["zhihu"], universal: false });
    const businessPlatform = repository.createImageAsset({ brandId: brand.id, name: "业务平台图", filePath: "C:/media/business-platform.jpg", originalFileName: "business-platform.jpg", mimeType: "image/jpeg", size: 10, business: ["甲醛治理"], platform: ["zhihu"], universal: false });
    repository.createImageAsset({ brandId: brand.id, name: "通用图", filePath: "C:/media/common.jpg", originalFileName: "common.jpg", mimeType: "image/jpeg", size: 10, tags: ["通用"], universal: true });
    expect(repository.selectImageAssetForArticle(first.id, "zhihu")?.id).toBe(best.id);
    const job = repository.createArticlePublishJob({ articleId: first.id, platformKey: "zhihu", platformAccountId: account.id, selectedImageAssetId: best.id, imageSelectionMode: "manual" });
    expect(job).toMatchObject({ selectedImageAssetId: best.id, imageSelectionMode: "manual" });
    expect(repository.selectImageAssetForArticle(second.id, "zhihu")?.id).toBe(businessPlatform.id);
    const record = repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.id, platformKey: "zhihu", articleId: first.id, publishedUrl: null, publishedExternalId: null, success: false, response: {}, status: "Prepared", selectedImageAssetId: best.id, imageSelectionMode: "manual" });
    expect(repository.getPublishRecordByJob(job.id)).toMatchObject({ id: record.id, selectedImageAssetId: best.id, imageSelectionMode: "manual" });
  });
});
