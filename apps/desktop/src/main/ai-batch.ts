import type { AppRepository } from "@publisher/db";
import { checkGeneratedArticleQuality, type AIUsage } from "@publisher/domain";
import { contentHash, type AIProvider } from "@publisher/ai";
import type { ImageProvider } from "@publisher/image";
import { MockImageProvider, persistGeneratedImage } from "@publisher/image";
import type { Logger } from "@publisher/logger";
import type { BatchGenerationInput } from "../shared/api";
import { runQualityGateForArticle } from "./quality-gate";

export interface AIBatchRuntime {
  createAiProvider(): AIProvider;
  createImageProvider(): ImageProvider;
}

export async function resumePersistentBatches(repository: AppRepository, logger: Logger, coverDir: string, runtime: AIBatchRuntime): Promise<void> {
  repository.recoverAiBatchItems();
  for (const task of repository.listResumableAiTasks()) {
    const input = task.payload.input as BatchGenerationInput | undefined;
    const brandId = typeof task.payload.brandId === "string" ? task.payload.brandId : input?.brandId;
    if (!input || !brandId || !task.batchId) {
      repository.updateAiTask(task.id, { completed: task.completed, success: task.success, failed: task.failed, status: "failed", errorMessage: "AI batch metadata is incomplete" });
      continue;
    }
    void runPersistentBatchTask(repository, logger, coverDir, runtime, task.id, brandId, input);
  }
}

export async function runPersistentBatchTask(repository: AppRepository, logger: Logger, coverDir: string, runtime: AIBatchRuntime, taskId: string, brandId: string, input: BatchGenerationInput): Promise<void> {
  const brand = repository.getBrand(brandId);
  const task = repository.getAiTask(taskId);
  if (!brand || !task?.batchId) {
    if (task) repository.updateAiTask(taskId, { completed: task.completed, success: task.success, failed: task.failed, status: "failed", errorMessage: "AI batch cannot be resumed" });
    return;
  }
  const provider = runtime.createAiProvider();
  const imageProvider = runtime.createImageProvider();
  const concurrency = Math.min(20, Math.max(1, input.concurrency ?? 2));
  const priorBodies = repository.listArticles({ brandId }).map((article) => article.body);
  const startedAt = Date.now();
  const totalUsage: AIUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const addUsage = (usage: AIUsage | undefined): void => {
    if (!usage) return;
    totalUsage.promptTokens += usage.promptTokens;
    totalUsage.completionTokens += usage.completionTokens;
    totalUsage.totalTokens += usage.totalTokens;
    if (usage.estimatedCost !== undefined) totalUsage.estimatedCost = (totalUsage.estimatedCost ?? 0) + usage.estimatedCost;
    totalUsage.currency = usage.currency;
  };
  const worker = async (): Promise<void> => {
    while (true) {
      const current = repository.getAiTask(taskId);
      if (current?.cancelRequested) { repository.cancelAiBatchItems(task.batchId as string); return; }
      const item = repository.claimNextAiBatchItem(task.batchId as string);
      if (!item) return;
      try {
        const generated = await provider.generateArticle({ brand, city: item.city, keyword: item.keyword, variant: item.targetIndex + 1, articleType: item.articleType, minWords: input.minWords, maxWords: input.maxWords, includeFaq: true, includeSummary: input.includeSummary, includeTags: input.includeTags, includeSeoKeywords: input.includeSeoKeywords });
        addUsage(generated.usage);
        const quality = checkGeneratedArticleQuality({ title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, keyword: item.keyword, brand: brand.name, city: item.city }, { minWords: input.minWords, maxWords: input.maxWords, forbiddenClaims: brand.aiForbiddenClaims, similarityTexts: priorBodies });
        if (quality.errors.length > 0) throw new Error(`Quality Gate: ${quality.errors.join("; ")}`);
        if (quality.warnings.length > 0) logger.warn("AI", "QUALITY_WARNING", quality.warnings.join("; "), { taskId, itemId: item.id });
        priorBodies.push(generated.body);
        const article = repository.createArticle({ brandId: brand.id, topic: item.keyword, keyword: item.keyword, city: item.city, title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords, articleType: item.articleType, aiProvider: provider.providerKey, aiModel: provider.model, generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: contentHash(generated), qualityStatus: quality.status, qualityWarnings: quality.warnings });
        if (!article) throw new Error("Article was not persisted");
        runQualityGateForArticle(repository, article.id, "generation");
        if (input.autoCover) await persistCover(repository, imageProvider, coverDir, brand.id, article.id, article.title, brand.name, article.city, item.articleType, generated.suggestedCoverPrompt, logger);
        repository.completeAiBatchItem(item.id, article.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI generation failed";
        repository.failAiBatchItem(item.id, message, true);
        logger.error("AI", "BATCH_ITEM_FAILED", message, { taskId, itemId: item.id, targetIndex: item.targetIndex });
      } finally {
        repository.refreshAiTaskFromBatch(taskId, totalUsage, Date.now() - startedAt);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const final = repository.refreshAiTaskFromBatch(taskId, totalUsage, Date.now() - startedAt);
  logger.info("AI", "BATCH_COMPLETED", "Persistent AI batch finished or paused", { taskId, status: final.status, completed: final.completed, failed: final.failed, concurrency });
}

async function persistCover(repository: AppRepository, provider: ImageProvider, coverDir: string, brandId: string, articleId: string, title: string, brandName: string, city: string, articleType: string, coverPrompt: string, logger: Logger): Promise<void> {
  let image: Awaited<ReturnType<ImageProvider["generateCover"]>>;
  try { image = await provider.generateCover({ articleId, title, brandName, city, articleType, coverPrompt }); }
  catch (error) { logger.warn("IMAGE", "IMAGE_PROVIDER_FALLBACK", "Image provider failed; template cover used", { articleId, error: error instanceof Error ? error.message : "unknown" }); image = await new MockImageProvider().generateCover({ articleId, title, brandName, city, articleType, coverPrompt }); }
  const filePath = await persistGeneratedImage(image, coverDir);
  repository.attachCover(articleId, repository.createMediaAsset({ brandId, type: "cover", title: `${title} cover`, filePath, provider: image.provider, model: image.model }));
}
