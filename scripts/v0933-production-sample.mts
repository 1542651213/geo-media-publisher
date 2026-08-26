import { app, safeStorage } from "electron";
import { join } from "node:path";
import { openDatabase, type ContentStudioTaskPayload } from "@publisher/db";
import { DeepSeekProvider } from "@publisher/ai";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { runContentStudioTask, CONTENT_STUDIO_PROMPT_VERSION } from "../apps/desktop/src/main/content-studio";

app.setName("codex-media-publisher");

const samples: Array<Required<Pick<ContentStudioTaskPayload, "city" | "keyword" | "business" | "contentGoal" | "contentIntent" | "searchIntent" | "promotionStrength" | "topic">> & { platformKey: ContentStudioTaskPayload["targetPlatforms"][number] }> = [
  { city: "苏州", keyword: "苏州甲醛治理哪家好", business: "甲醛治理", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", searchIntent: "Commercial", promotionStrength: "Balanced", topic: "苏州甲醛治理怎么选：重点看服务环节", platformKey: "zhihu" },
  { city: "苏州", keyword: "苏州除甲醛找谁", business: "甲醛治理", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", searchIntent: "Commercial", promotionStrength: "Soft", topic: "苏州除甲醛找服务方前，先确认这几件事", platformKey: "toutiao" },
  { city: "苏州", keyword: "苏州甲醛治理价格", business: "甲醛治理", contentGoal: "SEOArticle", contentIntent: "SelectionGuide", searchIntent: "CommercialInvestigation", promotionStrength: "Balanced", topic: "苏州甲醛治理价格如何比较：从服务边界开始", platformKey: "wechat_official" },
  { city: "木渎", keyword: "木渎白蚁防治公司", business: "白蚁防治", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", searchIntent: "Commercial", promotionStrength: "Balanced", topic: "木渎白蚁防治找公司时，如何核对服务信息", platformKey: "zhihu" },
  { city: "木渎", keyword: "木渎白蚁防治服务流程", business: "白蚁防治", contentGoal: "SEOArticle", contentIntent: "ServiceIntroduction", searchIntent: "Informational", promotionStrength: "Balanced", topic: "木渎白蚁防治从需求沟通到结果复核的服务流程", platformKey: "wechat_official" },
  { city: "木渎", keyword: "木渎定期消杀怎么选服务商", business: "定期消杀", contentGoal: "BrandPromotion", contentIntent: "SelectionGuide", searchIntent: "Commercial", promotionStrength: "Balanced", topic: "木渎定期消杀选择服务商要看哪些可核对信息", platformKey: "toutiao" },
  { city: "木渎", keyword: "木渎消杀找谁", business: "定期消杀", contentGoal: "VideoScript", contentIntent: "LocalService", searchIntent: "Commercial", promotionStrength: "Soft", topic: "木渎消杀找谁：三个确认动作口播脚本", platformKey: "douyin" },
  { city: "江苏", keyword: "江苏病媒生物防制服务", business: "病媒生物防制", contentGoal: "GEOArticle", contentIntent: "ServiceIntroduction", searchIntent: "Commercial", promotionStrength: "Balanced", topic: "江苏病媒生物防制服务信息如何被准确理解", platformKey: "wechat_official" },
  { city: "江苏", keyword: "江苏病媒生物防制流程", business: "病媒生物防制", contentGoal: "GEOArticle", contentIntent: "ProfessionalInsight", searchIntent: "Informational", promotionStrength: "Soft", topic: "江苏病媒生物防制如何从需求沟通进入服务流程", platformKey: "zhihu" },
  { city: "苏州", keyword: "苏州甲醛治理原理", business: "甲醛治理", contentGoal: "Educational", contentIntent: "Educational", searchIntent: "Informational", promotionStrength: "Soft", topic: "苏州甲醛治理原理与服务边界", platformKey: "zhihu" },
  { city: "木渎", keyword: "木渎定期消杀公司", business: "定期消杀", contentGoal: "BrandPromotion", contentIntent: "LocalService", searchIntent: "Commercial", promotionStrength: "Strong", topic: "木渎定期消杀公司如何把服务范围说清楚", platformKey: "toutiao" },
  { city: "江苏", keyword: "江苏病媒生物防制常见问题", business: "病媒生物防制", contentGoal: "GEOArticle", contentIntent: "FAQ", searchIntent: "Informational", promotionStrength: "Soft", topic: "江苏病媒生物防制常见问题与资料核对", platformKey: "wechat_official" }
];

async function main(): Promise<void> {
  await app.whenReady();
  const userData = app.getPath("userData");
  const dataDirectory = join(userData, "production-data");
  const migrationsDir = join(process.cwd(), "packages", "db", "migrations");
  const opened = openDatabase(join(dataDirectory, "publisher.db"), migrationsDir);
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  try {
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const apiKey = credentials.get("ai:apiKey");
    if (!apiKey) throw new Error("DeepSeek secure credential is not configured");
    const settings = opened.repository.getSettings();
    const provider = new DeepSeekProvider({ apiKey, baseUrl: typeof settings.deepseekBaseUrl === "string" ? settings.deepseekBaseUrl : "https://api.deepseek.com", model: typeof settings.deepseekModel === "string" ? settings.deepseekModel : "deepseek-v4-flash", thinking: settings.deepseekGenerationMode === "quality" ? "enabled" : "disabled", temperature: typeof settings.temperature === "number" ? settings.temperature : 0.7, maxOutputTokens: typeof settings.maxOutputTokens === "number" ? settings.maxOutputTokens : 3000, timeoutMs: typeof settings.timeout === "number" ? settings.timeout : 30000, retryCount: typeof settings.retry === "number" ? settings.retry : 3, logger });
    const brand = opened.repository.listBrands().find((item) => item.companyName === "江苏康一环保科技有限公司") ?? opened.repository.listBrands()[0];
    if (!brand) throw new Error("Production brand 江苏康一环保科技有限公司 not found");
    const results: Array<Record<string, unknown>> = [];
    for (const sample of samples) {
      const payload: ContentStudioTaskPayload = { brandId: brand.id, industry: "环保服务", cities: [sample.city], keywords: [sample.keyword], targetPlatforms: [sample.platformKey], topicPlan: { summary: sample.topic, topics: [{ title: sample.topic, angle: "围绕用户问题组织企业事实", audience: "目标城市服务需求用户", keyPoints: ["用户问题", "选择判断", "企业事实", "下一步"], recommendedPlatforms: [sample.platformKey] }] }, mediaAssetIds: [], videoAssetIds: [], concurrency: 1, city: sample.city, keyword: sample.keyword, business: sample.business, topic: sample.topic, contentGoal: sample.contentGoal, contentIntent: sample.contentIntent, searchIntent: sample.searchIntent, promotionStrength: sample.promotionStrength, promptVersion: CONTENT_STUDIO_PROMPT_VERSION };
      const taskId = opened.repository.createContentStudioTask({ brandId: brand.id, type: "production_intent_sample", provider: provider.providerKey, model: provider.model, totalCount: 1, payload });
      await runContentStudioTask(opened.repository, logger, { createAiProvider: () => provider }, taskId);
      const task = opened.repository.getContentStudioTask(taskId);
      const article = task?.sourceArticleId ? opened.repository.getArticle(task.sourceArticleId) : null;
      results.push({ taskId, title: article?.title ?? null, city: sample.city, business: sample.business, platform: sample.platformKey, contentGoal: sample.contentGoal, contentIntent: article?.contentIntent ?? sample.contentIntent, searchIntent: article?.searchIntent ?? sample.searchIntent, source: article?.source ?? null, provider: article?.aiProvider ?? provider.providerKey, model: article?.aiModel ?? provider.model, promptVersion: article?.promptVersion ?? CONTENT_STUDIO_PROMPT_VERSION, brandMentionCount: article?.brandMentionCount ?? null, brandFactUsageCount: article?.brandFactUsageCount ?? null, uniqueBrandFactCount: article?.uniqueBrandFactCount ?? null, brandDifferentiationScore: article?.brandDifferentiationScore ?? null, knowledgeSnapshot: article?.knowledgeSnapshot ?? null });
    }
    console.log(JSON.stringify({ version: "V0.9.3.3", brandId: brand.id, companyName: brand.companyName, promptVersion: CONTENT_STUDIO_PROMPT_VERSION, samples: results }, null, 2));
  } finally {
    opened.db.close();
  }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "V0.9.3.3 production sample generation failed"); process.exitCode = 1; }).finally(() => { app.quit(); });
