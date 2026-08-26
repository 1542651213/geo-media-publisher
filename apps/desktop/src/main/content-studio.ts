import type { AppRepository, ContentStudioTaskPayload } from "@publisher/db";
import { AIProviderError, type AIProvider, type GeneratedContentStudioContent, type GeneratedContentStudioTopicPlan, type StructuredOutputDiagnostic } from "@publisher/ai";
import { evaluateBrandDifferentiation, inferContentIntent, inferSearchIntent, selectRelevantBrandFacts, type BrandDifferentiationMetrics, type ContentGoal, type ContentIntent, type ContentStudioPlatformKey, type ContentStudioTopicPlan, type AIUsage, type KnowledgeSnapshot, type PromotionStrength, type SearchIntent } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { runQualityGateForVariant } from "./quality-gate";

export interface ContentStudioRuntime {
  createAiProvider(): AIProvider;
}

export interface ContentStudioTaskRunResult {
  structuredDiagnostics: StructuredOutputDiagnostic[];
}

export const CONTENT_STUDIO_PROMPT_VERSION = "v0.9.3.3-brand-intent-v1";

function providerFailureDiagnostic(error: unknown, provider: AIProvider): Record<string, unknown> {
  const context: Record<string, unknown> = { provider: provider.providerKey, model: provider.model };
  if (!(error instanceof AIProviderError)) return context;
  return {
    ...context,
    errorCode: error.code,
    retryable: error.retryable,
    ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.bodySummary ? { responseBodySummary: error.bodySummary } : {})
  };
}

function addUsage(total: AIUsage, usage: AIUsage | undefined): void {
  if (!usage) return;
  total.promptTokens += usage.promptTokens;
  total.completionTokens += usage.completionTokens;
  total.totalTokens += usage.totalTokens;
  if (usage.cacheHitTokens !== undefined) total.cacheHitTokens = (total.cacheHitTokens ?? 0) + usage.cacheHitTokens;
  if (usage.estimatedCost !== undefined) total.estimatedCost = (total.estimatedCost ?? 0) + usage.estimatedCost;
  total.currency = usage.currency ?? total.currency;
}

function studioInput(brand: NonNullable<ReturnType<AppRepository["getBrand"]>>, payload: ContentStudioTaskPayload, topicPlan: ContentStudioTopicPlan, repository: AppRepository, knowledgeSnapshot: KnowledgeSnapshot) {
  const mediaAssets = repository.listContentStudioMediaAssets(brand.id).filter((asset) => payload.mediaAssetIds.includes(asset.id)).map((asset) => ({ id: asset.id, title: asset.title, type: asset.type, description: asset.description, tags: asset.tags }));
  const videoAssets = payload.videoAssetIds.flatMap((id) => {
    const asset = repository.getManagedVideoAsset(id);
    if (!asset) return [];
    return [{ id: asset.id, title: asset.title, type: "video", description: asset.description, tags: asset.tags, fileName: asset.fileName, ...(asset.durationMs === undefined ? {} : { durationMs: asset.durationMs }), ...(asset.width === undefined ? {} : { width: asset.width }), ...(asset.height === undefined ? {} : { height: asset.height }) }];
  });
  const city = payload.city ?? payload.cities[0] ?? "";
  const keyword = payload.keyword ?? payload.keywords[0] ?? "";
  const business = payload.business ?? keyword;
  const contentGoal: ContentGoal = payload.contentGoal ?? "BrandPromotion";
  const promotionStrength: PromotionStrength = payload.promotionStrength ?? "Balanced";
  const contentIntent: ContentIntent = payload.contentIntent ? inferContentIntent({ contentGoal, contentIntent: payload.contentIntent, hasCaseFacts: knowledgeSnapshot.selectedFactTypes.includes("case"), business, city, keyword, topic: payload.topic ?? topicPlan.topics[0]?.title ?? keyword }) : inferContentIntent({ contentGoal, hasCaseFacts: knowledgeSnapshot.selectedFactTypes.includes("case"), business, city, keyword, topic: payload.topic ?? topicPlan.topics[0]?.title ?? keyword });
  const searchIntent: SearchIntent = payload.searchIntent ?? inferSearchIntent({ contentGoal, contentIntent, keyword, topic: payload.topic ?? topicPlan.topics[0]?.title ?? keyword });
  return { brand, industry: payload.industry, cities: payload.cities, keywords: payload.keywords, targetPlatforms: payload.targetPlatforms, topicPlan, mediaAssets, videoAssets, city, keyword, business, topic: payload.topic ?? topicPlan.topics[0]?.title ?? keyword, contentGoal, contentIntent, searchIntent, promotionStrength, knowledgeSnapshot, promptVersion: CONTENT_STUDIO_PROMPT_VERSION };
}

export async function runContentStudioTask(repository: AppRepository, logger: Logger, runtime: ContentStudioRuntime, taskId: string): Promise<ContentStudioTaskRunResult> {
  const task = repository.getContentStudioTask(taskId);
  if (!task) return { structuredDiagnostics: [] };
  const structuredDiagnostics: StructuredOutputDiagnostic[] = [];
  const brand = repository.getBrand(task.brandId);
  if (!brand) {
    repository.updateContentStudioTask(taskId, { completed: task.completed, success: task.success, failed: task.failed, status: "failed", errorMessage: "品牌资料不存在" });
    return { structuredDiagnostics };
  }
  const provider = runtime.createAiProvider();
  const startedAt = Date.now();
  const totalUsage: AIUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const city = task.payload.city ?? task.payload.cities[0] ?? "";
  const keyword = task.payload.keyword ?? task.payload.keywords[0] ?? "";
  const knowledgeSnapshot = task.output.knowledgeSnapshot ?? selectRelevantBrandFacts(brand, { business: task.payload.business ?? keyword, city, keyword, topic: task.payload.topic ?? "" });
  const contentGoal = task.payload.contentGoal ?? "BrandPromotion";
  const contentIntent = inferContentIntent({ contentGoal, contentIntent: task.payload.contentIntent, hasCaseFacts: knowledgeSnapshot.selectedFactTypes.includes("case"), business: task.payload.business ?? keyword, city, keyword, topic: task.payload.topic ?? "" });
  const searchIntent = task.payload.searchIntent ?? inferSearchIntent({ contentGoal, contentIntent, keyword, topic: task.payload.topic ?? "" });
  if (!task.output.knowledgeSnapshot) repository.updateContentStudioTask(taskId, { completed: task.completed, success: task.success, failed: task.failed, status: "running", output: { knowledgeSnapshot, contentIntent, searchIntent, promptVersion: CONTENT_STUDIO_PROMPT_VERSION } });
  logger.info("AI", "CONTENT_STUDIO_PROMPT_DIAGNOSTICS", "Content Studio 安全 Prompt 诊断", { taskId, brandId: brand.id, knowledgeEntryCount: knowledgeSnapshot.facts.length, factCount: knowledgeSnapshot.factCount, selectedFactTypes: knowledgeSnapshot.selectedFactTypes, city, keywords: task.payload.keywords, platform: task.payload.targetPlatforms, contentGoal, contentIntent, searchIntent, promotionStrength: task.payload.promotionStrength ?? "Balanced", promptVersion: CONTENT_STUDIO_PROMPT_VERSION });
  let topicPlan: ContentStudioTopicPlan;
  try {
    if (task.output.topicPlan) topicPlan = task.output.topicPlan;
    else {
      const generatedPlan: GeneratedContentStudioTopicPlan = await provider.generateTopicPlan({ ...studioInput(brand, task.payload, { summary: "", topics: [] }, repository, knowledgeSnapshot), topicPlan: null });
      topicPlan = { summary: generatedPlan.summary, topics: generatedPlan.topics };
      addUsage(totalUsage, generatedPlan.usage);
      repository.persistContentStudioPlan(taskId, topicPlan, totalUsage);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "主题规划失败";
    const diagnostic = providerFailureDiagnostic(error, provider);
    repository.updateContentStudioTask(taskId, { completed: task.completed, success: task.success, failed: task.failed, status: "failed", errorMessage: message, usage: totalUsage, durationMs: Date.now() - startedAt, output: { providerDiagnostics: diagnostic } });
    logger.error("AI", "CONTENT_STUDIO_PLAN_FAILED", message, { taskId, ...diagnostic });
    return { structuredDiagnostics };
  }

  const baseInput = studioInput(brand, task.payload, topicPlan, repository, knowledgeSnapshot);
  const platforms = [...new Set(task.payload.targetPlatforms)] as ContentStudioPlatformKey[];
  let cursor = 0;
  let completed = task.completed;
  let success = task.success;
  let failed = task.failed;
  let lastError: string | undefined = task.errorMessage ?? undefined;
  const brandDifferentiationByPlatform: Record<string, BrandDifferentiationMetrics> = {};
  const existingVersions = repository.listContentStudioVersions(task.rootTaskId);
  const pendingPlatforms = platforms.filter((platform) => !existingVersions.some((version) => version.taskId === task.id && version.platformKey === platform));
  completed += platforms.length - pendingPlatforms.length;
  success += platforms.length - pendingPlatforms.length;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= pendingPlatforms.length) return;
      const platformKey = pendingPlatforms[index];
      try {
        const generated: GeneratedContentStudioContent = await provider.generateStudioContent({ ...baseInput, platformKey });
        structuredDiagnostics.push(...(generated.structuredDiagnostics ?? []).map((diagnostic) => ({ ...diagnostic, platformKey: diagnostic.platformKey ?? platformKey })));
        addUsage(totalUsage, generated.usage);
        const version = repository.persistContentStudioOutput({ taskId, brandId: brand.id, output: { platformKey: generated.platformKey, contentType: generated.contentType, title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords, tone: generated.tone, structure: generated.structure, keywordLayout: generated.keywordLayout }, mediaAssetIds: task.payload.mediaAssetIds, videoAssetIds: task.payload.videoAssetIds, provider: provider.providerKey, model: provider.model, usage: generated.usage });
        const differentiation = evaluateBrandDifferentiation({ brand, content: generated, knowledgeSnapshot, contentGoal: baseInput.contentGoal, contentIntent: baseInput.contentIntent });
        brandDifferentiationByPlatform[platformKey] = differentiation;
        if (version.articleVariantId) runQualityGateForVariant(repository, version.articleVariantId, "generation", { title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords, contentGoal: baseInput.contentGoal, contentIntent: baseInput.contentIntent, searchIntent: baseInput.searchIntent, knowledgeSnapshot });
        success += 1;
        logger.info("AI", "CONTENT_STUDIO_PLATFORM_COMPLETED", "Content Studio 平台版本生成完成", { taskId, platformKey, provider: provider.providerKey, model: provider.model });
      } catch (error) {
        if (error && typeof error === "object" && "structuredDiagnostics" in error && Array.isArray((error as { structuredDiagnostics?: unknown }).structuredDiagnostics)) structuredDiagnostics.push(...((error as { structuredDiagnostics: StructuredOutputDiagnostic[] }).structuredDiagnostics));
        failed += 1;
        lastError = error instanceof Error ? error.message : "平台内容生成失败";
        const diagnostic = providerFailureDiagnostic(error, provider);
        repository.updateContentStudioTask(taskId, { completed, success, failed, status: "running", errorMessage: lastError, usage: totalUsage, durationMs: Date.now() - startedAt, output: { providerDiagnostics: { ...diagnostic, platformKey } } });
        logger.error("AI", "CONTENT_STUDIO_PLATFORM_FAILED", lastError, { taskId, platformKey, ...diagnostic });
      } finally {
        completed += 1;
        repository.updateContentStudioTask(taskId, { completed, success, failed, status: "running", errorMessage: lastError, usage: totalUsage, durationMs: Date.now() - startedAt });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, Math.max(1, task.payload.concurrency ?? 3)) }, () => worker()));
  const status = failed === platforms.length ? "failed" : failed > 0 ? "partial" : "completed";
  repository.updateContentStudioTask(taskId, { completed: platforms.length, success, failed, status, errorMessage: lastError ?? null, usage: totalUsage, durationMs: Date.now() - startedAt, output: { topicPlan, contentIntent, searchIntent, knowledgeSnapshot, promptVersion: CONTENT_STUDIO_PROMPT_VERSION, brandDifferentiationByPlatform, structuredDiagnostics: structuredDiagnostics as unknown as Array<Record<string, unknown>> } });
  logger.info("AI", "CONTENT_STUDIO_COMPLETED", "Content Studio 任务完成", { taskId, status, success, failed, total: platforms.length });
  return { structuredDiagnostics };
}

export async function resumeContentStudioTasks(repository: AppRepository, logger: Logger, runtime: ContentStudioRuntime): Promise<void> {
  for (const task of repository.listResumableContentStudioTasks()) void runContentStudioTask(repository, logger, runtime, task.id);
}
