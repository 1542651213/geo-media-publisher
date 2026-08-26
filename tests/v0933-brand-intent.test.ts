import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AIProvider, GeneratedContentStudioContent, GeneratedContentStudioTopicPlan } from "@publisher/ai";
import { openDatabase, type ContentStudioTaskPayload } from "@publisher/db";
import { buildContentStudioPlatformPrompt, evaluateBrandDifferentiation, evaluateContentQuality, hasGenericTitleTemplate, inferContentIntent, inferSearchIntent, selectRelevantBrandFacts, type Brand, type ContentStudioPlatformInput } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { runContentStudioTask } from "../apps/desktop/src/main/content-studio";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function brand(): Brand {
  return { id: "brand-933", name: "康一环保", companyName: "江苏康一环保科技有限公司", description: "提供室内环境治理服务，服务范围和交付边界以双方确认资料为准。", mainBusiness: "甲醛治理、定期消杀、白蚁防治、病媒生物防制", serviceRegions: ["江苏", "苏州", "木渎"], advantages: ["按现场情况沟通服务边界"], contact: { 电话: "0512-123456" }, establishedAt: "", address: "苏州", serviceProcess: "需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通", afterSales: "复检或整改以合同和现场情况为准", faq: "服务前先提供现场需求", certificates: "", patents: "", equipment: "现场评估设备以实际配置为准", cases: "", aiForbiddenClaims: ["第一", "最好", "唯一", "国家级", "100%", "永久"], createdAt: "", updatedAt: "" };
}

function openTestRepository() {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v0933-brand-intent-"));
  dirs.push(dir);
  return openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
}

function payload(overrides: Partial<ContentStudioTaskPayload> = {}): ContentStudioTaskPayload {
  return { brandId: "brand-933", industry: "环保服务", cities: ["苏州"], keywords: ["苏州甲醛治理哪家好"], targetPlatforms: ["zhihu"], topicPlan: null, mediaAssetIds: [], videoAssetIds: [], concurrency: 1, city: "苏州", keyword: "苏州甲醛治理哪家好", business: "甲醛治理", topic: "苏州甲醛治理哪家好：重点看哪些服务环节", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", searchIntent: "Commercial", promotionStrength: "Balanced", ...overrides };
}

function generatedContent(input: ContentStudioPlatformInput): GeneratedContentStudioContent {
  const factText = (input.knowledgeSnapshot?.facts ?? []).slice(0, 4).map((fact) => fact.content).join("；");
  return { platformKey: input.platformKey, contentType: input.platformKey === "douyin" ? "video_script" : "article", title: `${input.keyword}怎么选？先看服务环节`, body: `${input.city}用户遇到${input.business}需求时，先确认服务范围和现场情况。${input.brand.companyName}围绕${input.business}提供需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通；以下企业资料用于说明服务边界：${factText}。选择时应按真实资料核对，不把企业事实扩展成行业普遍承诺。`, summary: `${input.keyword}的选择判断与${input.brand.companyName}服务事实`, tags: [input.city, input.business ?? ""].filter((value): value is string => Boolean(value)), seoKeywords: [input.keyword ?? ""], tone: "理性", structure: ["用户问题", "选择判断", "企业事实", "下一步"], keywordLayout: { primary: input.keyword ?? "", secondary: [input.business ?? ""], placements: ["标题", "首段"] }, usage: { promptTokens: 12, completionTokens: 36, totalTokens: 48 } };
}

function fakeProvider(): AIProvider {
  return {
    providerKey: "deepseek",
    model: "deepseek-v4-flash",
    generateTitles: async () => ["标题"],
    generateArticle: async () => ({ title: "标题", body: "正文", summary: "摘要", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }),
    rewriteArticle: async () => ({ title: "标题", body: "正文", summary: "摘要", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }),
    rewriteForPlatform: async () => ({ title: "标题", body: "正文", summary: "摘要", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }),
    generateTopicPlan: async (): Promise<GeneratedContentStudioTopicPlan> => ({ summary: "围绕用户决策问题规划品牌内容", topics: [{ title: "服务选择判断", angle: "企业事实进入论证", audience: "本地用户", keyPoints: ["需求", "流程", "边界"], recommendedPlatforms: ["zhihu"] }] }),
    generateStudioContent: async (input): Promise<GeneratedContentStudioContent> => generatedContent(input),
    testConnection: async () => ({ ok: true, message: "fake" })
  };
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

describe("V0.9.3.3 brand content intent calibration", () => {
  it("classifies search intent and keeps BrandAnswer distinct from Educational", () => {
    expect(inferSearchIntent({ keyword: "苏州甲醛治理哪家好" })).toBe("Commercial");
    expect(inferSearchIntent({ keyword: "苏州甲醛治理价格" })).toBe("CommercialInvestigation");
    expect(inferSearchIntent({ keyword: "甲醛治理原理" })).toBe("Informational");
    expect(inferContentIntent({ contentGoal: "BrandPromotion", keyword: "苏州甲醛治理哪家好", city: "苏州", business: "甲醛治理" })).toBe("BrandAnswer");
    expect(inferContentIntent({ contentGoal: "Educational", keyword: "甲醛治理原理" })).toBe("Educational");
  });

  it("injects intent instructions and uses brand facts in the argument", () => {
    const currentBrand = brand();
    const snapshot = selectRelevantBrandFacts(currentBrand, { business: "甲醛治理", city: "苏州", keyword: "苏州甲醛治理哪家好", topic: "选择" });
    const prompt = buildContentStudioPlatformPrompt({ brand: currentBrand, industry: "环保服务", cities: ["苏州"], keywords: ["苏州甲醛治理哪家好"], targetPlatforms: ["zhihu"], topicPlan: null, mediaAssets: [], videoAssets: [], business: "甲醛治理", city: "苏州", keyword: "苏州甲醛治理哪家好", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", searchIntent: "Commercial", promotionStrength: "Balanced", knowledgeSnapshot: snapshot, platformKey: "zhihu" });
    expect(prompt).toContain("文章类型 / Content Intent：BrandAnswer");
    expect(prompt).toContain("搜索意图 / Search Intent：Commercial");
    expect(prompt).toContain("参与论证");
    expect(prompt).toContain("[business]");
    expect(prompt).not.toContain("业务：白蚁防治");
  });

  it("flags generic brand content without treating the brand name itself as a violation", () => {
    const currentBrand = brand();
    const snapshot = selectRelevantBrandFacts(currentBrand, { business: "甲醛治理", city: "苏州", keyword: "苏州甲醛治理", topic: "" });
    const generic = evaluateBrandDifferentiation({ brand: currentBrand, content: { title: "苏州甲醛治理服务", body: "江苏康一环保科技有限公司可以为用户提供服务。" }, knowledgeSnapshot: snapshot, contentGoal: "BrandPromotion", contentIntent: "BrandAnswer" });
    expect(generic.score).toBeLessThan(35);
    expect(generic.genericBrandContent).toBe(true);
    const quality = evaluateContentQuality({ brand: currentBrand, city: "苏州", keyword: "苏州甲醛治理", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", knowledgeSnapshot: snapshot, content: { title: "苏州甲醛治理服务", body: "江苏康一环保科技有限公司可以为用户提供服务。", summary: "苏州甲醛治理" } });
    expect(quality.issues.some((item) => item.code === "brand_differentiation" && item.message.includes("GENERIC_BRAND_CONTENT"))).toBe(true);
    expect(quality.issues.some((item) => item.code === "absolute_marketing" || item.code === "unsupported_credentials")).toBe(false);
  });

  it("accepts evidence-backed differentiation, keeps educational branding optional, and blocks fake ranking claims", () => {
    const currentBrand = brand();
    const snapshot = selectRelevantBrandFacts(currentBrand, { business: "甲醛治理", city: "苏州", keyword: "苏州甲醛治理", topic: "" });
    const grounded = evaluateBrandDifferentiation({ brand: currentBrand, content: { title: "苏州甲醛治理怎么选？先看服务环节", body: `江苏康一环保科技有限公司提供甲醛治理，流程包括${currentBrand.serviceProcess}。` }, knowledgeSnapshot: snapshot, contentGoal: "BrandPromotion", contentIntent: "BrandAnswer" });
    expect(grounded.brandFactUsageCount).toBeGreaterThan(0);
    expect(grounded.score).toBeGreaterThanOrEqual(35);
    expect(grounded.genericBrandContent).toBe(false);
    const educational = evaluateContentQuality({ brand: currentBrand, city: "苏州", keyword: "苏州甲醛治理原理", contentGoal: "Educational", contentIntent: "Educational", content: { title: "苏州甲醛治理原理", body: "本文解释室内环境治理的基本原理和判断边界。", summary: "苏州甲醛治理原理" } });
    expect(educational.issues.some((item) => item.code === "brand_missing")).toBe(false);
    const unsafe = evaluateContentQuality({ brand: currentBrand, city: "苏州", keyword: "苏州甲醛治理", contentGoal: "BrandPromotion", content: { title: "苏州甲醛治理第一品牌", body: "江苏康一环保科技有限公司是行业第一，保证永久有效。", summary: "苏州甲醛治理" } });
    expect(unsafe.issues.some((item) => item.code === "absolute_marketing" || item.code === "false_promises")).toBe(true);
  });

  it("detects generic title templates and persists twelve traceable production samples", async () => {
    expect(hasGenericTitleTemplate("苏州甲醛治理全攻略")).toBe(true);
    expect(hasGenericTitleTemplate("苏州甲醛治理怎么选？先看服务环节")).toBe(false);
    const { db, repository } = openTestRepository();
    try {
      const savedBrand = repository.createBrand(brand());
      const cases = Array.from({ length: 12 }, (_, index) => ({ city: index % 3 === 0 ? "江苏" : index % 2 === 0 ? "木渎" : "苏州", business: ["甲醛治理", "定期消杀", "白蚁防治", "病媒生物防制"][index % 4] }));
      for (const [index, item] of cases.entries()) {
        const taskId = repository.createContentStudioTask({ brandId: savedBrand.id, type: "production_intent_sample", provider: "deepseek", model: "deepseek-v4-flash", totalCount: 1, payload: payload({ brandId: savedBrand.id, city: item.city, cities: [item.city], business: item.business, keyword: `${item.city}${item.business}${index}`, keywords: [`${item.city}${item.business}${index}`], topic: `${item.city}${item.business}服务选择`, contentIntent: index % 2 === 0 ? "LocalService" : "BrandAnswer" }) });
        await runContentStudioTask(repository, logger, { createAiProvider: () => fakeProvider() }, taskId);
      }
      const articles = repository.listArticles({ source: "production" }).filter((article) => article.contentStudioTaskId && article.aiProvider === "deepseek");
      expect(articles).toHaveLength(12);
      expect(articles.every((article) => article.source === "content_studio" && article.knowledgeSnapshot && article.brandFactUsageCount !== undefined && article.brandDifferentiationScore !== null)).toBe(true);
      expect(articles.every((article) => article.contentIntent === "LocalService" || article.contentIntent === "BrandAnswer")).toBe(true);
      expect(articles.every((article) => (article.brandFactUsageCount ?? 0) > 0 && (article.brandDifferentiationScore ?? 0) >= 35)).toBe(true);
    } finally { db.close(); }
  });

  it("archives legacy production articles for brand rewrite without deleting history", () => {
    const { db, repository } = openTestRepository();
    try {
      const savedBrand = repository.createBrand(brand());
      const article = repository.createArticle({ brandId: savedBrand.id, topic: "旧文章", keyword: "南京室内环境", city: "南京", title: "南京室内环境科普", body: "通用介绍", summary: "摘要", tags: [], seoKeywords: [], articleType: "legacy", aiProvider: "deepseek", aiModel: "deepseek-v4-flash", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "legacy-hash" });
      expect(article).not.toBeNull();
      const archived = repository.archiveArticle(article?.id ?? "");
      expect(archived.status).toBe("archived");
      expect(archived.needsRewrite).toBe(true);
      expect(repository.getArticle(archived.id)).not.toBeNull();
      expect(repository.listArticles({ source: "production", status: "available" })).toHaveLength(0);
      expect(repository.listArticles({ source: "production", status: "archived" })).toHaveLength(1);
    } finally { db.close(); }
  });
});
