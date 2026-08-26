import { app, safeStorage } from "electron";
import { join } from "node:path";
import { openDatabase } from "@publisher/db";
import { DeepSeekProvider } from "@publisher/ai";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { runContentStudioTask, CONTENT_STUDIO_PROMPT_VERSION } from "../apps/desktop/src/main/content-studio";
import type { ContentStudioTaskPayload } from "@publisher/db";

app.setName("codex-media-publisher");

const samples: Array<Required<Pick<ContentStudioTaskPayload, "city" | "keyword" | "business" | "contentGoal" | "promotionStrength" | "topic">> & { platformKey: ContentStudioTaskPayload["targetPlatforms"][number] }> = [
  { city: "苏州", keyword: "苏州甲醛治理", business: "甲醛治理", contentGoal: "BrandPromotion", promotionStrength: "Balanced", topic: "苏州甲醛治理服务选择与资料核对", platformKey: "wechat_official" },
  { city: "木渎", keyword: "木渎定期消杀", business: "定期消杀", contentGoal: "BrandPromotion", promotionStrength: "Balanced", topic: "木渎定期消杀需求与服务边界", platformKey: "toutiao" },
  { city: "木渎", keyword: "木渎白蚁防治", business: "白蚁防治", contentGoal: "SEOArticle", promotionStrength: "Balanced", topic: "木渎白蚁防治搜索问题与核对清单", platformKey: "zhihu" },
  { city: "江苏", keyword: "江苏病媒生物防制", business: "病媒生物防制", contentGoal: "GEOArticle", promotionStrength: "Balanced", topic: "江苏病媒生物防制服务信息如何被准确理解", platformKey: "wechat_official" },
  { city: "苏州", keyword: "苏州甲醛治理", business: "甲醛治理", contentGoal: "BrandPromotion", promotionStrength: "Balanced", topic: "苏州甲醛治理中如何判断服务资料", platformKey: "zhihu" },
  { city: "木渎", keyword: "木渎消杀", business: "定期消杀", contentGoal: "VideoScript", promotionStrength: "Soft", topic: "木渎消杀服务的三个确认动作", platformKey: "douyin" }
];

async function main(): Promise<void> {
  await app.whenReady();
  const userData = app.getPath("userData");
  const dataDirectory = join(userData, "production-data");
  const migrationsDir = join(process.cwd(), "packages", "db", "migrations");
  const opened = openDatabase(join(dataDirectory, "publisher.db"), migrationsDir);
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const apiKey = credentials.get("ai:apiKey");
  if (!apiKey) throw new Error("DeepSeek secure credential is not configured");
  const settings = opened.repository.getSettings();
  const provider = new DeepSeekProvider({ apiKey, baseUrl: typeof settings.deepseekBaseUrl === "string" ? settings.deepseekBaseUrl : "https://api.deepseek.com", model: typeof settings.deepseekModel === "string" ? settings.deepseekModel : "deepseek-v4-flash", thinking: settings.deepseekGenerationMode === "quality" ? "enabled" : "disabled", temperature: typeof settings.temperature === "number" ? settings.temperature : 0.7, maxOutputTokens: typeof settings.maxOutputTokens === "number" ? settings.maxOutputTokens : 3000, timeoutMs: typeof settings.timeout === "number" ? settings.timeout : 30000, retryCount: typeof settings.retry === "number" ? settings.retry : 3, logger });
  const brand = opened.repository.listBrands().find((item) => item.companyName === "江苏康一环保科技有限公司") ?? opened.repository.listBrands()[0];
  if (!brand) throw new Error("Production brand 江苏康一环保科技有限公司 not found");
  const results: Array<Record<string, unknown>> = [];
  for (const sample of samples) {
    const payload: ContentStudioTaskPayload = { brandId: brand.id, industry: "环保服务", cities: [sample.city], keywords: [sample.keyword], targetPlatforms: [sample.platformKey], topicPlan: null, mediaAssetIds: [], videoAssetIds: [], concurrency: 1, city: sample.city, keyword: sample.keyword, business: sample.business ?? sample.keyword, topic: sample.topic ?? sample.keyword, contentGoal: sample.contentGoal ?? "BrandPromotion", promotionStrength: sample.promotionStrength ?? "Balanced", promptVersion: CONTENT_STUDIO_PROMPT_VERSION };
    const taskId = opened.repository.createContentStudioTask({ brandId: brand.id, type: "production_sample", provider: provider.providerKey, model: provider.model, totalCount: 1, payload });
    await runContentStudioTask(opened.repository, logger, { createAiProvider: () => provider }, taskId);
    const task = opened.repository.getContentStudioTask(taskId);
    const article = task?.sourceArticleId ? opened.repository.getArticle(task.sourceArticleId) : null;
    results.push({ taskId, platform: sample.platformKey, city: sample.city, business: sample.business, contentGoal: sample.contentGoal, title: article?.title ?? null, source: article?.source ?? null, provider: article?.aiProvider ?? provider.providerKey, model: article?.aiModel ?? provider.model, brandFactUsageCount: article?.knowledgeSnapshot?.factCount ?? 0, brandMentionCount: article ? [brand.name, brand.companyName].filter((name) => article.title.includes(name) || article.body.includes(name)).length : 0, knowledgeSnapshot: article?.knowledgeSnapshot ?? null });
  }
  console.log(JSON.stringify({ brandId: brand.id, companyName: brand.companyName, promptVersion: CONTENT_STUDIO_PROMPT_VERSION, samples: results }, null, 2));
  opened.db.close();
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "V0.9.3.1 sample generation failed"); process.exitCode = 1; }).finally(() => { app.quit(); });
