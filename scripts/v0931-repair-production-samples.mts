import { app, safeStorage } from "electron";
import { join } from "node:path";
import { openDatabase } from "@publisher/db";
import { DeepSeekProvider } from "@publisher/ai";
import { selectRelevantBrandFacts } from "@publisher/domain";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { runQualityGateForVariant } from "../apps/desktop/src/main/quality-gate";
import { CONTENT_STUDIO_PROMPT_VERSION } from "../apps/desktop/src/main/content-studio";
import type { ContentStudioInput, ContentStudioPlatformInput, ContentStudioPlatformKey, KnowledgeSnapshot } from "@publisher/domain";

app.setName("codex-media-publisher");

function requiredBrandMention(platformKey: ContentStudioPlatformKey, contentGoal: string | undefined): boolean {
  return contentGoal === "BrandPromotion" || platformKey === "douyin" || platformKey === "bilibili";
}

async function main(): Promise<void> {
  await app.whenReady();
  const userData = app.getPath("userData");
  const dataDirectory = join(userData, "production-data");
  const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const apiKey = credentials.get("ai:apiKey");
  if (!apiKey) throw new Error("DeepSeek secure credential is not configured");
  const settings = opened.repository.getSettings();
  const provider = new DeepSeekProvider({ apiKey, baseUrl: typeof settings.deepseekBaseUrl === "string" ? settings.deepseekBaseUrl : "https://api.deepseek.com", model: typeof settings.deepseekModel === "string" ? settings.deepseekModel : "deepseek-v4-flash", thinking: settings.deepseekGenerationMode === "quality" ? "enabled" : "disabled", temperature: typeof settings.temperature === "number" ? settings.temperature : 0.7, maxOutputTokens: typeof settings.maxOutputTokens === "number" ? settings.maxOutputTokens : 3000, timeoutMs: typeof settings.timeout === "number" ? settings.timeout : 30000, retryCount: typeof settings.retry === "number" ? settings.retry : 3, logger });
  const brand = opened.repository.listBrands().find((item) => item.companyName === "江苏康一环保科技有限公司") ?? opened.repository.listBrands()[0];
  if (!brand) throw new Error("Production brand 江苏康一环保科技有限公司 not found");
  const tasks = opened.repository.listContentStudioTasks().filter((task) => task.type === "production_sample").sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const results: Array<Record<string, unknown>> = [];
  for (const task of tasks) {
    const platformKey = task.payload.targetPlatforms[0] as ContentStudioPlatformKey | undefined;
    if (!platformKey || !task.sourceArticleId) continue;
    const version = opened.repository.listContentStudioVersions(task.rootTaskId, platformKey)[0];
    if (!version || !version.articleVariantId) continue;
    const city = task.payload.city ?? task.payload.cities[0] ?? "";
    const keyword = task.payload.keyword ?? task.payload.keywords[0] ?? "";
    const knowledgeSnapshot: KnowledgeSnapshot = task.output.knowledgeSnapshot ?? selectRelevantBrandFacts(brand, { business: task.payload.business ?? keyword, city, keyword, topic: task.payload.topic ?? "" });
    const input: ContentStudioInput = { brand, industry: task.payload.industry, cities: task.payload.cities, keywords: task.payload.keywords, targetPlatforms: task.payload.targetPlatforms as ContentStudioPlatformKey[], topicPlan: task.output.topicPlan ?? null, mediaAssets: [], videoAssets: [], business: task.payload.business ?? keyword, city, keyword, topic: task.payload.topic, contentGoal: task.payload.contentGoal ?? "BrandPromotion", promotionStrength: task.payload.promotionStrength ?? "Balanced", knowledgeSnapshot, promptVersion: CONTENT_STUDIO_PROMPT_VERSION };
    let selected: { title: string; body: string; summary: string; tags: string[]; seoKeywords: string[] } | null = null;
    let qualityStatus = "Rejected";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retryInstructions = attempt === 0 ? input.topic : `${input.topic ?? ""}。质量复检硬性要求：标题和摘要必须包含主关键词；标签不得超过平台规则；删除确保、承诺、永久、第一、最好、唯一、资质、证书、认证等未被企业知识库支持的表述；除法定公司名称外不要引入其他城市或省份；只围绕目标业务，不展开其他业务；保留目标企业名称。`;
      const generated = await provider.generateStudioContent({ ...input, topic: retryInstructions, platformKey } as ContentStudioPlatformInput);
      selected = generated;
      opened.repository.updateContentStudioVersion(version.id, { title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords });
      opened.repository.updateArticle(task.sourceArticleId, { title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords });
      const quality = runQualityGateForVariant(opened.repository, version.articleVariantId, "generation", { title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords, contentGoal: input.contentGoal });
      qualityStatus = quality.status;
      const hasBrand = generated.title.includes(brand.companyName) || generated.body.includes(brand.companyName) || generated.title.includes(brand.name) || generated.body.includes(brand.name);
      const hasBlockingIssue = quality.issues.some((issue) => issue.severity === "error");
      if ((!requiredBrandMention(platformKey, input.contentGoal) || hasBrand) && !hasBlockingIssue) break;
    }
    const currentTask = opened.repository.getContentStudioTask(task.id);
    if (currentTask) opened.repository.updateContentStudioTask(task.id, { completed: currentTask.completed, success: currentTask.success, failed: currentTask.failed, status: currentTask.status, errorMessage: currentTask.errorMessage, usage: currentTask.usage, durationMs: currentTask.durationMs, output: { promptVersion: CONTENT_STUDIO_PROMPT_VERSION, knowledgeSnapshot } });
    const article = opened.repository.getArticle(task.sourceArticleId);
    const text = `${article?.title ?? ""}\n${article?.body ?? ""}`;
    results.push({ taskId: task.id, platform: platformKey, title: article?.title ?? null, provider: provider.providerKey, model: provider.model, promptVersion: CONTENT_STUDIO_PROMPT_VERSION, brandMentionCount: article ? [brand.name, brand.companyName].filter((name) => text.includes(name)).length : 0, brandFactUsageCount: knowledgeSnapshot.factCount, qualityStatus, bodyLength: selected?.body.length ?? 0 });
  }
  console.log(JSON.stringify({ brandId: brand.id, companyName: brand.companyName, promptVersion: CONTENT_STUDIO_PROMPT_VERSION, repairedCount: results.length, samples: results }, null, 2));
  opened.db.close();
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "V0.9.3.1 sample repair failed"); process.exitCode = 1; }).finally(() => { app.quit(); });
