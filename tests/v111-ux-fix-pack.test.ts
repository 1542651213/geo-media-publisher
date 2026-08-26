import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAccountSelection, type ContentQualityIssue, type ContentSource } from "@publisher/domain";
import { openDatabase } from "@publisher/db";
import { articleListStatusLabel, canPublishWithReviewMode, orderPlatformCatalog, platformAvailability } from "../apps/desktop/src/renderer/v11-ui-model";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open !== false) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `publisher-v111-${name}-`));
  tempDirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedDevelopment(platformCsv);
  const brand = opened.repository.createBrand({ name: `${name}品牌`, companyName: `${name}公司` });
  const account = opened.repository.createAccount({ platformKey: "zhihu", name: "知乎现有账号" });
  opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "zhihu", browserSessionId: "zhihu-session-hash", externalAccountId: "zhihu-owner", lastVerifiedAt: "2026-08-22T00:00:00.000Z" });
  return { ...opened, brand, account };
}

function createArticle(repository: ReturnType<typeof openDatabase>["repository"], brandId: string, suffix: string, input: { business?: string; city?: string; keyword?: string; tags?: string[]; source?: ContentSource } = {}) {
  const article = repository.createArticle({ brandId, topic: `主题${suffix}`, keyword: input.keyword ?? "甲醛治理", city: input.city ?? "苏州", title: `V1.1.1文章${suffix}`, body: `V1.1.1文章正文${suffix}`, summary: "", tags: input.tags ?? [], seoKeywords: input.keyword ? [input.keyword] : ["甲醛治理"], articleType: "科普", aiProvider: input.source === "excel_import" ? "excel_import" : input.source === "mock" ? "mock" : input.source === "test" ? "test" : "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `v111-${suffix}-${"a".repeat(40)}`, business: input.business ?? "甲醛治理", source: input.source ?? "production" });
  if (!article) throw new Error("article not created");
  return article;
}

function saveQuality(repository: ReturnType<typeof openDatabase>["repository"], article: ReturnType<typeof createArticle>, status: "AI_Checked" | "Needs_Review" | "Rejected", issues: ContentQualityIssue[] = []): void {
  repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: article.brandId, platformKey: null, contentHash: article.contentHash, trigger: "manual_recheck", provider: "test", model: "test", result: { status, score: issues.length ? 40 : 100, checks: [], issues }, snapshot: { title: article.title } });
}

describe("V1.1.1 UX Fix Pack", () => {
  it("defaults to WarningOnly and lets Off publish a Draft Production article", () => {
    const { repository, brand, account } = fixture("off");
    expect(repository.getContentReviewMode()).toBe("WarningOnly");
    repository.setSetting("contentReviewMode", "Off");
    const article = createArticle(repository, brand.id, "off-draft");
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id });
    expect(job.status).toBe("AwaitingConfirmation");
    expect(canPublishWithReviewMode("Draft", "Off")).toBe(true);
  });

  it("lets WarningOnly publish Needs_Review while retaining visible risk reminders", () => {
    const { repository, brand, account } = fixture("warning");
    const article = createArticle(repository, brand.id, "warning-review");
    const issue: ContentQualityIssue = { code: "seo_quality", severity: "warning", message: "SEO关键词不足", suggestion: "补充关键词" };
    saveQuality(repository, article, "Needs_Review", [issue]);
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id });
    expect(job.status).toBe("AwaitingConfirmation");
    expect(repository.listContentQualityReviews("article", article.id)[0]?.issues).toContainEqual(issue);
    expect(articleListStatusLabel(article, "Needs_Review", "WarningOnly")).toBe("有提醒");
    expect(canPublishWithReviewMode("Needs_Review", "WarningOnly")).toBe(true);
  });

  it("keeps Strict fail-closed until the current article hash is Approved", () => {
    const { repository, brand, account } = fixture("strict");
    repository.setSetting("contentReviewMode", "Strict");
    const article = createArticle(repository, brand.id, "strict");
    saveQuality(repository, article, "Needs_Review");
    expect(() => repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id })).toThrow("Approved");
    repository.decideContentQuality("article", article.id, "Approved");
    expect(repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id }).status).toBe("AwaitingConfirmation");
    expect(articleListStatusLabel(article, "Needs_Review", "Strict")).toBe("需要处理");
  });

  it.each(["benchmark", "mock", "test"] as const)("keeps %s content out of the formal publish path even when Approved", (source) => {
    const { repository, brand, account } = fixture(`source-${source}`);
    const article = createArticle(repository, brand.id, source, { source });
    saveQuality(repository, article, "AI_Checked");
    repository.decideContentQuality("article", article.id, "Approved");
    expect(() => repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id })).toThrow("专用自测入口");
  });

  it("lets an Excel title/content article enter the publish flow without mandatory human approval", () => {
    const { repository, brand, account } = fixture("excel");
    const preview = repository.previewExcelArticleImport({ fileName: "Geo Media Publisher 简易文章导入模板.xlsx", rows: [{ rowNumber: 2, templateVersion: "1.0", title: "Excel直达发布", body: "Excel正文", summary: "", company: brand.companyName, business: "甲醛治理", city: "苏州", keywords: "甲醛治理", tags: "治理现场", targetPlatforms: "zhihu", contentType: "", promotionStrength: "", sourceNote: "" }] });
    expect(repository.confirmExcelArticleImport({ preview }).imported).toBe(1);
    const article = repository.listArticles({ source: "excel_import" })[0];
    if (!article) throw new Error("excel article missing");
    expect(repository.createArticlePublishJob({ articleId: article.id, platformKey: "zhihu", platformAccountId: account.id }).status).toBe("AwaitingConfirmation");
  });

  it("persists multi-select business/region/usage tags and reusable custom tags", () => {
    const { repository, brand } = fixture("tags");
    const image = repository.createImageAsset({ brandId: brand.id, name: "标签图", filePath: "C:/media/tags.jpg", originalFileName: "tags.jpg", mimeType: "image/jpeg", size: 10, business: ["甲醛治理", "定期消杀"], city: ["江苏", "苏州"], usage: ["治理现场", "办公环境"], tags: ["酒店", "学校"] });
    expect(image).toMatchObject({ business: ["甲醛治理", "定期消杀"], city: ["江苏", "苏州"], usage: ["治理现场", "办公环境"], tags: ["酒店", "学校"] });
    expect(repository.updateImageAsset(image.id, { usage: ["团队", "门店"], tags: ["新房", "工厂"] })).toMatchObject({ usage: ["团队", "门店"], tags: ["新房", "工厂"] });
  });

  it("matches business+region, then business, region, usage and universal while avoiding recent images", () => {
    const { repository, brand } = fixture("matching");
    const exact = repository.createImageAsset({ brandId: brand.id, name: "业务地区", filePath: "C:/media/exact.jpg", originalFileName: "exact.jpg", mimeType: "image/jpeg", size: 10, business: ["甲醛治理"], city: ["苏州"], usage: ["治理现场"] });
    const business = repository.createImageAsset({ brandId: brand.id, name: "业务", filePath: "C:/media/business.jpg", originalFileName: "business.jpg", mimeType: "image/jpeg", size: 10, business: ["甲醛治理"] });
    const region = repository.createImageAsset({ brandId: brand.id, name: "地区", filePath: "C:/media/region.jpg", originalFileName: "region.jpg", mimeType: "image/jpeg", size: 10, city: ["苏州"] });
    const usage = repository.createImageAsset({ brandId: brand.id, name: "用途", filePath: "C:/media/usage.jpg", originalFileName: "usage.jpg", mimeType: "image/jpeg", size: 10, usage: ["团队"] });
    const universal = repository.createImageAsset({ brandId: brand.id, name: "通用", filePath: "C:/media/universal.jpg", originalFileName: "universal.jpg", mimeType: "image/jpeg", size: 10, usage: ["通用"], universal: true });
    const first = createArticle(repository, brand.id, "match-first");
    expect(repository.selectImageAssetForArticle(first.id, "zhihu")?.id).toBe(exact.id);
    repository.markImageAssetUsed(exact.id);
    const second = createArticle(repository, brand.id, "match-second");
    expect(repository.selectImageAssetForArticle(second.id, "zhihu")?.id).toBe(business.id);
    const regionArticle = createArticle(repository, brand.id, "match-region", { business: "白蚁防治", city: "苏州", keyword: "无关" });
    expect(repository.selectImageAssetForArticle(regionArticle.id, "zhihu", 3, [exact.id])?.id).toBe(region.id);
    const usageArticle = createArticle(repository, brand.id, "match-usage", { business: "白蚁防治", city: "无锡", keyword: "团队", tags: ["团队"] });
    expect(repository.selectImageAssetForArticle(usageArticle.id, "zhihu")?.id).toBe(usage.id);
    const fallbackArticle = createArticle(repository, brand.id, "match-fallback", { business: "其他业务", city: "无锡", keyword: "无关" });
    expect(repository.selectImageAssetForArticle(fallbackArticle.id, "zhihu")?.id).toBe(universal.id);
    expect(repository.getImageAsset(exact.id)?.lastUsedAt).not.toBeNull();
    expect(repository.getImageAsset(exact.id)?.useCount).toBe(1);
  });

  it("returns all 41 platforms; favorites do not hide Manual or Blocked platforms", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v111-platforms-")); tempDirs.push(dir);
    const opened = openDatabase(join(dir, "publisher.db"), migrationDir); databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const platforms = opened.repository.listPlatforms();
    expect(platforms).toHaveLength(41);
    const ordered = orderPlatformCatalog(platforms, ["zhihu", "baijiahao"]);
    expect(ordered).toHaveLength(41);
    expect(new Set(ordered.slice(0, 2).map((platform) => platform.platformKey))).toEqual(new Set(["zhihu", "baijiahao"]));
    expect(platforms.some((platform) => platformAvailability(platform) === "manual")).toBe(true);
    expect(platforms.some((platform) => platformAvailability(platform) === "blocked")).toBe(true);
  });

  it("keeps single-account auto-selection and the existing Zhihu session unchanged", () => {
    const { repository, account } = fixture("zhihu-session");
    const before = repository.listAccounts().find((item) => item.id === account.id);
    repository.setSetting("contentReviewMode", "WarningOnly");
    repository.setSetting("favoritePlatformKeys", "zhihu,baijiahao");
    const after = repository.listAccounts().find((item) => item.id === account.id);
    expect(defaultAccountSelection(after ? [after] : [])).toEqual({ selectedAccountId: account.id, requiresChoice: false });
    expect(after).toMatchObject({ loginStatus: "logged_in", browserSessionId: "zhihu-session-hash", externalAccountId: "zhihu-owner" });
    expect(after).toEqual(before);
  });
});
