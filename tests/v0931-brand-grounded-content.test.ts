import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AIProvider, type GeneratedContentStudioContent, type GeneratedContentStudioTopicPlan } from "@publisher/ai";
import { openDatabase, type ContentStudioTaskPayload } from "@publisher/db";
import { buildContentStudioPlatformPrompt, evaluateContentQuality, selectRelevantBrandFacts, type Brand, type ContentStudioPlatformInput } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { runContentStudioTask } from "../apps/desktop/src/main/content-studio";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function brand(): Brand {
  return { id: "brand-1", name: "康一环保", companyName: "江苏康一环保科技有限公司", description: "提供室内环境治理服务，服务范围、方案和交付边界以双方确认资料为准。", mainBusiness: "甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制", serviceRegions: ["江苏", "苏州", "木渎"], advantages: ["信息边界清晰"], contact: { 电话: "0512-123456" }, establishedAt: "", address: "苏州", serviceProcess: "需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通", afterSales: "是否复检或整改以合同和现场情况为准", faq: "服务前先提供现场需求", certificates: "", patents: "", equipment: "现场评估设备以实际配置为准", cases: "木渎住宅白蚁防治案例资料", aiForbiddenClaims: ["国家级", "第一", "最好", "100%", "永久"], createdAt: "", updatedAt: "" };
}

function openTestRepository() {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v0931-brand-grounded-"));
  dirs.push(dir);
  return openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
}

function payload(overrides: Partial<ContentStudioTaskPayload> = {}): ContentStudioTaskPayload {
  return { brandId: "brand-1", industry: "环保服务", cities: ["木渎"], keywords: ["木渎白蚁防治"], targetPlatforms: ["zhihu"], topicPlan: null, mediaAssetIds: [], videoAssetIds: [], city: "木渎", keyword: "木渎白蚁防治", business: "白蚁防治", contentGoal: "BrandPromotion", promotionStrength: "Balanced", ...overrides };
}

function contentInput(overrides: Partial<ContentStudioPlatformInput> = {}): ContentStudioPlatformInput {
  const currentBrand = brand();
  return { brand: currentBrand, industry: "环保服务", cities: ["木渎"], keywords: ["木渎白蚁防治"], targetPlatforms: ["zhihu"], topicPlan: null, mediaAssets: [], videoAssets: [], city: "木渎", keyword: "木渎白蚁防治", business: "白蚁防治", contentGoal: "BrandPromotion", promotionStrength: "Balanced", knowledgeSnapshot: selectRelevantBrandFacts(currentBrand, { business: "白蚁防治", city: "木渎", keyword: "木渎白蚁防治", topic: "" }), promptVersion: "v0.9.3.1-brand-grounded-v1", platformKey: "zhihu", ...overrides };
}

function generatedContent(input: ContentStudioPlatformInput): GeneratedContentStudioContent {
  return { platformKey: input.platformKey, contentType: "article", title: "木渎白蚁防治：江苏康一环保科技有限公司如何介绍服务边界", body: "木渎白蚁防治需要先明确现场情况。江苏康一环保科技有限公司提供相关环境治理服务，服务流程包括需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通；具体以双方确认资料为准。本文只讨论白蚁防治，不混入甲醛治理或病媒生物防制。", summary: "木渎白蚁防治与江苏康一环保科技有限公司服务边界说明", tags: ["木渎", "白蚁防治"], seoKeywords: ["木渎白蚁防治"], tone: "理性", structure: ["问题切入", "结论", "边界"], keywordLayout: { primary: "木渎白蚁防治", secondary: ["白蚁防治"], placements: ["标题", "首段"] }, usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } };
}

function fakeProvider(): AIProvider {
  const provider: AIProvider = {
    providerKey: "deepseek",
    model: "deepseek-v4-flash",
    generateTitles: async () => ["标题"],
    generateArticle: async () => ({ title: "标题", body: "正文", summary: "摘要", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }),
    rewriteArticle: async () => ({ title: "标题", body: "正文", summary: "摘要", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }),
    rewriteForPlatform: async () => ({ title: "标题", body: "正文", summary: "摘要", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }),
    generateTopicPlan: async (): Promise<GeneratedContentStudioTopicPlan> => ({ summary: "围绕木渎白蚁防治提供品牌信息", topics: [{ title: "木渎白蚁防治服务边界", angle: "品牌资料说明", audience: "本地用户", keyPoints: ["现场评估", "服务流程"], recommendedPlatforms: ["zhihu"] }] }),
    generateStudioContent: async (input): Promise<GeneratedContentStudioContent> => generatedContent(input),
    testConnection: async () => ({ ok: true, message: "fake" })
  };
  return provider;
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

describe("V0.9.3.1 brand-grounded content", () => {
  it("builds BrandPromotion prompts from selected facts and excludes unrelated business facts", () => {
    const snapshot = selectRelevantBrandFacts(brand(), { business: "白蚁防治", city: "木渎", keyword: "木渎白蚁防治", topic: "木渎白蚁防治" });
    const prompt = buildContentStudioPlatformPrompt(contentInput({ knowledgeSnapshot: snapshot }));
    expect(prompt).toContain("江苏康一环保科技有限公司");
    expect(prompt).toContain("[business] 业务：白蚁防治");
    expect(prompt).toContain("内容目的：BrandPromotion");
    expect(prompt).toContain("推广程度：Balanced");
    expect(prompt).toContain("只围绕目标城市、业务和主关键词");
    expect(prompt).not.toContain("业务：甲醛治理");
    expect(snapshot.facts.some((fact) => fact.type === "service_process")).toBe(true);
  });

  it("marks a missing brand separately while accepting a factual brand introduction", () => {
    const base = { brand: brand(), city: "木渎", keyword: "木渎白蚁防治", knownCities: ["江苏", "苏州", "木渎"] };
    const missing = evaluateContentQuality({ ...base, contentGoal: "BrandPromotion", content: { title: "木渎白蚁防治服务判断", body: "木渎白蚁防治先做现场情况评估，再确认方案和服务边界。", summary: "木渎白蚁防治" } });
    expect(missing.issues.some((issue) => issue.code === "brand_missing" && issue.message.includes("BRAND_MISSING"))).toBe(true);
    const present = evaluateContentQuality({ ...base, contentGoal: "BrandPromotion", content: { title: "木渎白蚁防治｜江苏康一环保科技有限公司服务边界", body: "江苏康一环保科技有限公司提供白蚁防治相关环境治理服务，流程和交付边界以双方确认资料为准。", summary: "木渎白蚁防治" } });
    expect(present.issues.some((issue) => issue.code === "brand_missing")).toBe(false);
    expect(present.issues.some((issue) => issue.code === "absolute_marketing" || issue.code === "unsupported_credentials")).toBe(false);
  });

  it("persists a knowledge snapshot and isolates benchmark articles from production listing and dashboard metrics", async () => {
    const { db, repository } = openTestRepository();
    try {
      const savedBrand = repository.createBrand(brand());
      const taskId = repository.createContentStudioTask({ brandId: savedBrand.id, type: "multi_platform_content", provider: "deepseek", model: "deepseek-v4-flash", totalCount: 1, payload: payload({ brandId: savedBrand.id }) });
      await runContentStudioTask(repository, logger, { createAiProvider: () => fakeProvider() }, taskId);
      const task = repository.getContentStudioTask(taskId);
      expect(task?.output.knowledgeSnapshot?.factCount).toBeGreaterThan(0);
      const article = repository.getArticle(task?.sourceArticleId ?? "");
      expect(article).toMatchObject({ source: "content_studio", contentStudioTaskId: taskId, contentGoal: "BrandPromotion", promptVersion: "v0.9.3.3-brand-intent-v1" });
      expect(article?.knowledgeSnapshot?.facts.some((fact) => fact.content.includes("白蚁防治"))).toBe(true);
      repository.createQualityBenchmarkRun({ benchmarkRunId: "benchmark-run", benchmarkId: "V091_BRAND_QUALITY_001", datasetVersion: "V0.9.2-1.0.0", runType: "DEEPSEEK_REAL", provider: "deepseek", model: "deepseek-v4-flash", promptVersion: "v0.9.2-deepseek-quality-benchmark-v1", status: "COMPLETED" });
      const benchmarkItem = repository.seedQualityBenchmarkItems([{ benchmarkRunId: "benchmark-run", benchmarkId: "V091_BRAND_QUALITY_001", datasetVersion: "V0.9.2-1.0.0", promptVersion: "v0.9.2-deepseek-quality-benchmark-v1", topicIndex: 0, topic: "木渎白蚁防治", city: "木渎", keyword: "木渎白蚁防治", business: "白蚁防治", platformKey: "zhihu", provider: "deepseek", model: "deepseek-v4-flash" }])[0];
      repository.updateQualityBenchmarkItem(benchmarkItem?.id ?? "", { status: "Success", contentTypeId: repository.listArticleVariants(article?.id ?? "")[0]?.id });
      expect(repository.listArticles()).toHaveLength(0);
      expect(repository.listArticles({ source: "production" })).toHaveLength(0);
      expect(repository.listArticles({ source: "benchmark" })).toHaveLength(1);
      expect(repository.dashboardStats()).toMatchObject({ availableArticles: 0, benchmarkArticles: 1, productionArticles: 0 });
    } finally { db.close(); }
  });
});
