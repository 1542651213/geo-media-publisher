import { randomUUID } from "node:crypto";
import type { AIProvider, StructuredOutputDiagnostic } from "@publisher/ai";
import type { AppRepository, QualityBenchmarkContentView, QualityBenchmarkMetrics, QualityBenchmarkRunView } from "@publisher/db";
import type { AIUsage, ContentQualityStatus, ContentStudioPlatformKey, ContentStudioTopicPlan } from "@publisher/domain";
import { textSimilarity } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { runContentStudioTask } from "./content-studio";
import { runQualityGateForVariant } from "./quality-gate";

export interface QualityBenchmarkTopic {
  index: number;
  title: string;
  city: string;
  keyword: string;
  business: string;
}

export interface QualityBenchmarkInput {
  brandId: string;
  benchmarkId: string;
  datasetVersion: string;
  promptVersion: string;
  runType: "MOCK_BASELINE" | "DEEPSEEK_REAL";
  providerHint: string;
  modelHint: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topics: readonly QualityBenchmarkTopic[];
  platforms: readonly ContentStudioPlatformKey[];
  benchmarkRunId?: string;
  concurrency?: number;
  retryFailed?: boolean;
}

export interface QualityBenchmarkResult {
  run: QualityBenchmarkRunView;
  metrics: QualityBenchmarkMetrics;
  contents: QualityBenchmarkContentView[];
}

function addUsage(total: AIUsage, usage: AIUsage): void {
  total.promptTokens += Number.isFinite(usage.promptTokens) ? usage.promptTokens : 0;
  total.completionTokens += Number.isFinite(usage.completionTokens) ? usage.completionTokens : 0;
  total.totalTokens += Number.isFinite(usage.totalTokens) ? usage.totalTokens : 0;
  if (Number.isFinite(usage.cacheHitTokens)) total.cacheHitTokens = (total.cacheHitTokens ?? 0) + (usage.cacheHitTokens as number);
  if (Number.isFinite(usage.estimatedCost)) total.estimatedCost = (total.estimatedCost ?? 0) + (usage.estimatedCost as number);
  total.currency = usage.currency ?? total.currency;
}

function safeFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "AI provider could not be created";
  return message.replace(/sk-[A-Za-z0-9._-]+/gu, "[REDACTED]").slice(0, 300);
}

function maxSimilarity(value: string, candidates: string[]): number | null {
  if (candidates.length === 0) return null;
  return Math.max(...candidates.map((candidate) => textSimilarity(value, candidate)));
}

function diagnosticFailureCategory(diagnostics: StructuredOutputDiagnostic[]): string {
  const diagnostic = [...diagnostics].reverse().find((item) => !["REPAIR_RETRY_FAILED", "REPAIR_RETRY_SUCCEEDED", "MARKDOWN_CODE_FENCE", "NORMALIZATION_APPLIED"].includes(item.category));
  return diagnostic?.category ?? "PROVIDER_STRUCTURED_OUTPUT_INCOMPATIBILITY";
}

function diagnosticResponseLength(diagnostics: StructuredOutputDiagnostic[]): number {
  return diagnostics.reduce((max, diagnostic) => Math.max(max, diagnostic.responseLength ?? 0), 0);
}

function diagnosticFinishReason(diagnostics: StructuredOutputDiagnostic[]): string | null {
  return [...diagnostics].reverse().find((diagnostic) => diagnostic.finishReason)?.finishReason ?? null;
}

function diagnosticUsage(diagnostics: StructuredOutputDiagnostic[]): AIUsage {
  return diagnostics.reduce<AIUsage>((total, diagnostic) => { if (diagnostic.tokenUsage) addUsage(total, diagnostic.tokenUsage); return total; }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

export async function runQualityBenchmark(repository: AppRepository, logger: Logger, runtime: { createAiProvider(): AIProvider }, input: QualityBenchmarkInput): Promise<QualityBenchmarkResult> {
  if (input.topics.length !== 20 || input.platforms.length !== 6) throw new Error("Quality benchmark requires the frozen 20 x 6 dataset");
  const runId = input.benchmarkRunId ?? `${input.runType.toLowerCase()}-${randomUUID()}`;
  const existingRun = repository.getQualityBenchmarkRun(runId);
  if (!existingRun) {
    repository.createQualityBenchmarkRun({ benchmarkRunId: runId, benchmarkId: input.benchmarkId, datasetVersion: input.datasetVersion, runType: input.runType, provider: input.providerHint, model: input.modelHint, temperature: input.temperature, maxTokens: input.maxTokens, promptVersion: input.promptVersion });
    repository.seedQualityBenchmarkItems(input.topics.flatMap((topic) => input.platforms.map((platformKey) => ({ benchmarkRunId: runId, benchmarkId: input.benchmarkId, datasetVersion: input.datasetVersion, promptVersion: input.promptVersion, topicIndex: topic.index, topic: topic.title, city: topic.city, keyword: topic.keyword, business: topic.business, platformKey, provider: input.providerHint, model: input.modelHint }))));
  } else if (existingRun.status === "BLOCKED" || existingRun.status === "COMPLETED" && !(input.retryFailed && repository.listQualityBenchmarkItems(runId).some((item) => item.status === "Failed" || item.status === "RetryableFailure"))) {
    return { run: existingRun, metrics: repository.getQualityBenchmarkMetrics(runId), contents: repository.listQualityBenchmarkContents(runId, true) };
  }

  let provider: AIProvider;
  try {
    provider = runtime.createAiProvider();
  } catch (error) {
    const blocked = repository.updateQualityBenchmarkRun(runId, { status: "BLOCKED", completedAt: new Date().toISOString(), blockReason: safeFailureReason(error) });
    logger.warn("AI", "QUALITY_BENCHMARK_BLOCKED", "Quality benchmark blocked before provider call", { benchmarkRunId: runId, runType: input.runType, provider: input.providerHint });
    return { run: blocked, metrics: repository.getQualityBenchmarkMetrics(runId), contents: [] };
  }
  if (input.runType === "DEEPSEEK_REAL" && provider.providerKey !== "deepseek") {
    const blocked = repository.updateQualityBenchmarkRun(runId, { status: "BLOCKED", completedAt: new Date().toISOString(), blockReason: "当前安全配置未解析为 DeepSeek Provider；未发起模型请求" });
    logger.warn("AI", "QUALITY_BENCHMARK_BLOCKED", "Quality benchmark requires the configured DeepSeek Provider", { benchmarkRunId: runId, runType: input.runType, provider: provider.providerKey });
    return { run: blocked, metrics: repository.getQualityBenchmarkMetrics(runId), contents: [] };
  }

  if (input.runType === "DEEPSEEK_REAL") {
    const connection = await provider.testConnection();
    if (!connection.ok) {
      const blocked = repository.updateQualityBenchmarkRun(runId, { status: "BLOCKED", completedAt: new Date().toISOString(), blockReason: connection.message.replace(/sk-[A-Za-z0-9._-]+/gu, "[REDACTED]").slice(0, 300) });
      logger.warn("AI", "QUALITY_BENCHMARK_BLOCKED", "DeepSeek benchmark blocked by connection preflight", { benchmarkRunId: runId, runType: input.runType, provider: provider.providerKey });
      return { run: blocked, metrics: repository.getQualityBenchmarkMetrics(runId), contents: [] };
    }
  }

  repository.recoverQualityBenchmarkItems(runId);
  if (repository.getQualityBenchmarkRun(runId)?.controlStatus === "CANCELLED") {
    const cancelled = repository.getQualityBenchmarkRun(runId) as NonNullable<ReturnType<AppRepository["getQualityBenchmarkRun"]>>;
    return { run: cancelled, metrics: repository.getQualityBenchmarkMetrics(runId), contents: repository.listQualityBenchmarkContents(runId, true) };
  }
  repository.setQualityBenchmarkControl(runId, "RUNNING");
  repository.updateQualityBenchmarkRun(runId, { status: "RUNNING", completedAt: null });
  const startedAt = Date.now();
  const items = repository.listQualityBenchmarkItems(runId).filter((item) => item.status === "Pending" || item.status === "RetryableFailure" || input.retryFailed && item.status === "Failed");
  const textsByPlatform = new Map<string, string[]>();
  const textsByTopic = new Map<number, string[]>();
  for (const existingContent of repository.listQualityBenchmarkContents(runId, true)) {
    const variant = repository.getArticleVariant(existingContent.contentTypeId);
    if (!variant) continue;
    const textValue = `${variant.title}\n${variant.body}`;
    textsByPlatform.set(existingContent.platformKey, [...(textsByPlatform.get(existingContent.platformKey) ?? []), textValue]);
    textsByTopic.set(existingContent.topicIndex, [...(textsByTopic.get(existingContent.topicIndex) ?? []), textValue]);
  }
  const processItem = async (itemId: string): Promise<void> => {
    const claimed = repository.claimQualityBenchmarkItem(itemId, input.retryFailed === true);
    if (!claimed) return;
    const item = repository.getQualityBenchmarkItem(itemId) as NonNullable<ReturnType<AppRepository["getQualityBenchmarkItem"]>>;
    const topicPlan: ContentStudioTopicPlan = { summary: item.topic, topics: [{ title: item.topic, angle: `基于${item.business}资料解释用户判断问题`, audience: `${item.city}用户`, keyPoints: ["明确需求", "核对流程", "确认边界"], recommendedPlatforms: [item.platformKey as ContentStudioPlatformKey] }] };
    const taskStartedAt = Date.now();
    let taskRunResult: Awaited<ReturnType<typeof runContentStudioTask>> = { structuredDiagnostics: [] };
    try {
      let taskId = item.contentStudioTaskId;
      const existingTask = taskId ? repository.getContentStudioTask(taskId) : null;
      const existingVersion = existingTask ? repository.listContentStudioVersions(existingTask.rootTaskId, item.platformKey as ContentStudioPlatformKey).find((candidate) => candidate.taskId === taskId && candidate.platformKey === item.platformKey) : undefined;
      if (!taskId || !existingTask || existingTask.status !== "running" && !existingVersion) {
        taskId = repository.createContentStudioTask({ brandId: input.brandId, type: "quality_benchmark", provider: provider.providerKey, model: provider.model, totalCount: 1, payload: { brandId: input.brandId, industry: "环保服务", cities: [item.city], keywords: [item.keyword], targetPlatforms: [item.platformKey as ContentStudioPlatformKey], topicPlan, mediaAssetIds: [], videoAssetIds: [], concurrency: 1 } });
        repository.persistContentStudioPlan(taskId, topicPlan);
        repository.updateQualityBenchmarkItem(itemId, { status: "Running", contentStudioTaskId: taskId, provider: provider.providerKey, model: provider.model });
      }
      taskRunResult = await runContentStudioTask(repository, logger, { createAiProvider: () => provider }, taskId);
      const task = repository.getContentStudioTask(taskId);
      const version = task ? repository.listContentStudioVersions(task.rootTaskId, item.platformKey as ContentStudioPlatformKey).find((candidate) => candidate.taskId === taskId && candidate.platformKey === item.platformKey) : undefined;
      if (!version?.articleVariantId) throw new Error(task?.errorMessage ?? "DeepSeek 未生成有效内容");
      const contentId = version.articleVariantId;
      const review = repository.listContentQualityReviews("article_variant", contentId)[0];
      const textValue = `${version.title}\n${version.body}`;
      const samePlatform = textsByPlatform.get(version.platformKey) ?? [];
      const sameTopic = textsByTopic.get(item.topicIndex) ?? [];
      repository.recordQualityBenchmarkContent({ benchmarkRunId: runId, benchmarkId: input.benchmarkId, datasetVersion: input.datasetVersion, topicIndex: item.topicIndex, topic: item.topic, city: item.city, keyword: item.keyword, platformKey: version.platformKey, contentType: version.contentType, contentTypeId: contentId, provider: provider.providerKey, model: provider.model, contentHash: repository.getArticleVariant(contentId)?.contentHash ?? "", qualityStatus: repository.getContentQualityState("article_variant", contentId)?.status ?? "Draft", riskCount: review?.issues.length ?? 0, requestDurationMs: task?.durationMs ?? Date.now() - taskStartedAt, tokenUsage: version.usage, intraPlatformSimilarity: maxSimilarity(textValue, samePlatform), crossPlatformSimilarity: maxSimilarity(textValue, sameTopic) });
      samePlatform.push(textValue);
      textsByPlatform.set(version.platformKey, samePlatform);
      sameTopic.push(textValue);
      textsByTopic.set(item.topicIndex, sameTopic);
      const diagnostics = taskRunResult.structuredDiagnostics;
      repository.updateQualityBenchmarkItem(itemId, { status: "Success", contentStudioTaskId: taskId, contentTypeId: contentId, provider: provider.providerKey, model: provider.model, failureCategory: diagnostics.some((diagnostic) => diagnostic.category === "NORMALIZATION_APPLIED") ? "NORMALIZATION_APPLIED" : null, diagnostics: diagnostics as unknown as Array<Record<string, unknown>>, requestDurationMs: task?.durationMs ?? Date.now() - taskStartedAt, tokenUsage: version.usage });
      repository.recordQualityBenchmarkItemAttempt({ benchmarkItemId: itemId, attemptNumber: item.attemptCount, status: "Success", failureCategory: diagnostics.some((diagnostic) => diagnostic.category === "NORMALIZATION_APPLIED") ? "NORMALIZATION_APPLIED" : null, diagnostics: diagnostics as unknown as Array<Record<string, unknown>>, finishReason: diagnosticFinishReason(diagnostics), responseLength: diagnosticResponseLength(diagnostics), requestDurationMs: task?.durationMs ?? Date.now() - taskStartedAt, tokenUsage: version.usage });
    } catch (error) {
      const message = safeFailureReason(error);
      const retryable = error instanceof Error && ("retryable" in error && (error as { retryable?: unknown }).retryable === true || /超时|网络|频繁|暂时异常|HTTP 5\d{2}/u.test(message));
      const diagnostics = taskRunResult.structuredDiagnostics;
      const status = retryable ? "RetryableFailure" : "Failed";
      const failureCategory = diagnosticFailureCategory(diagnostics);
      const tokenUsage = diagnostics.length > 0 ? diagnosticUsage(diagnostics) : undefined;
      const errorCode = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code ?? "BENCHMARK_ITEM_FAILED") : "BENCHMARK_ITEM_FAILED";
      repository.updateQualityBenchmarkItem(itemId, { status, errorCode, errorMessage: message, failureCategory, diagnostics: diagnostics as unknown as Array<Record<string, unknown>>, requestDurationMs: Date.now() - taskStartedAt, ...(tokenUsage ? { tokenUsage } : {}) });
      repository.recordQualityBenchmarkItemAttempt({ benchmarkItemId: itemId, attemptNumber: item.attemptCount, status, failureCategory, errorCode, errorMessage: message, diagnostics: diagnostics as unknown as Array<Record<string, unknown>>, finishReason: diagnosticFinishReason(diagnostics), responseLength: diagnosticResponseLength(diagnostics), requestDurationMs: Date.now() - taskStartedAt, tokenUsage });
      logger.error("AI", "QUALITY_BENCHMARK_ITEM_FAILED", message, { benchmarkRunId: runId, itemId, topicIndex: item.topicIndex, platformKey: item.platformKey, retryable });
    }
  };
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const currentRun = repository.getQualityBenchmarkRun(runId);
      if (!currentRun || currentRun.controlStatus !== "RUNNING") return;
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (!item) return;
      await processItem(item.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, Math.max(1, input.concurrency ?? 3)) }, () => worker()));

  const contents = repository.listQualityBenchmarkContents(runId, true);
  const similarityValues = contents.flatMap((content) => [content.intraPlatformSimilarity, content.crossPlatformSimilarity].filter((value): value is number => value !== null));
  const averageSimilarity = similarityValues.length === 0 ? 0 : similarityValues.reduce((total, value) => total + value, 0) / similarityValues.length;
  const finalItems = repository.listQualityBenchmarkItems(runId);
  const successCount = finalItems.filter((item) => item.status === "Success").length;
  const failureCount = finalItems.filter((item) => item.status === "Failed" || item.status === "RetryableFailure").length;
  const totalUsage = finalItems.reduce<AIUsage>((total, item) => { addUsage(total, item.tokenUsage); return total; }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const allTerminal = finalItems.length === input.topics.length * input.platforms.length && finalItems.every((item) => item.status === "Success" || item.status === "Failed" || item.status === "RetryableFailure");
  const currentRun = repository.getQualityBenchmarkRun(runId);
  const runStatus = currentRun?.controlStatus === "CANCELLED" ? "FAILED" : allTerminal && failureCount === 0 ? "COMPLETED" : allTerminal ? "FAILED" : "RUNNING";
  const finalRun = repository.updateQualityBenchmarkRun(runId, { status: runStatus, completedAt: allTerminal ? new Date().toISOString() : null, totalDurationMs: Date.now() - startedAt, successCount, failureCount, totalTokenUsage: totalUsage, estimatedCost: totalUsage.estimatedCost ?? null, similaritySummary: { averageSimilarity } });
  const metrics = repository.getQualityBenchmarkMetrics(runId);
  logger.info("AI", "QUALITY_BENCHMARK_COMPLETED", "Quality benchmark completed", { benchmarkRunId: runId, runType: input.runType, successCount, failureCount });
  if (input.runType === "DEEPSEEK_REAL" && successCount === input.topics.length * input.platforms.length && failureCount === 0) logger.info("AI", "DEEPSEEK_BENCHMARK_GENERATION_COMPLETED", "DeepSeek benchmark generation completed", { benchmarkRunId: runId, successCount, failureCount });
  return { run: finalRun, metrics, contents };
}

export interface QualityBenchmarkReviewSampleResult {
  sampledCount: number;
  modifiedCount: number;
  approvedCount: number;
  rejectedCount: number;
  finalStatuses: Record<ContentQualityStatus, number>;
}

export function runQualityBenchmarkReviewSample(repository: AppRepository, runId: string, sampleSize = 20): QualityBenchmarkReviewSampleResult {
  const candidates = repository.listQualityBenchmarkContents(runId, true).slice(0, sampleSize);
  let modifiedCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const candidate of candidates) {
    const variant = repository.getArticleVariant(candidate.contentTypeId);
    if (!variant) continue;
    if (candidate.qualityStatus === "Needs_Review") {
      repository.updateArticleVariant(variant.id, { title: `${variant.title}｜资料核对版`, body: `${variant.body}\n\n人工审核补充：本版本仅使用品牌资料中已记录的业务范围与服务边界，具体方案以双方确认内容为准。` });
      modifiedCount += 1;
      runQualityGateForVariant(repository, variant.id, "manual_recheck");
      const state = repository.getContentQualityState("article_variant", variant.id);
      if (state?.status === "AI_Checked" || state?.status === "Needs_Review") {
        repository.decideContentQuality("article_variant", variant.id, "Approved", "human-review", "manual", "V0.9.2 benchmark sample manual approval");
        approvedCount += 1;
      } else {
        repository.decideContentQuality("article_variant", variant.id, "Rejected", "human-review", "manual", "V0.9.2 benchmark sample remained unsafe after recheck");
        rejectedCount += 1;
      }
      const finalState = repository.getContentQualityState("article_variant", variant.id);
      const finalReview = repository.listContentQualityReviews("article_variant", variant.id)[0];
      const latestVariant = repository.getArticleVariant(variant.id);
      if (finalState && latestVariant) repository.recordQualityBenchmarkContent({ benchmarkRunId: runId, benchmarkId: candidate.benchmarkId, datasetVersion: candidate.datasetVersion, topicIndex: candidate.topicIndex, topic: candidate.topic, city: candidate.city, keyword: candidate.keyword, platformKey: candidate.platformKey, contentType: candidate.contentType, contentTypeId: candidate.contentTypeId, provider: candidate.provider, model: candidate.model, contentHash: latestVariant.contentHash, qualityStatus: finalState.status, riskCount: finalReview?.issues.length ?? 0, revisionNumber: candidate.revisionNumber + 1, tokenUsage: finalReview ? { promptTokens: 0, completionTokens: 0, totalTokens: 0 } : undefined });
    } else if (candidate.qualityStatus === "AI_Checked") {
      repository.decideContentQuality("article_variant", variant.id, "Rejected", "human-review", "manual", "V0.9.2 benchmark sample rejection path");
      rejectedCount += 1;
      const finalState = repository.getContentQualityState("article_variant", variant.id);
      const finalReview = repository.listContentQualityReviews("article_variant", variant.id)[0];
      if (finalState) repository.updateQualityBenchmarkContentCurrent(candidate.id, { qualityStatus: finalState.status, riskCount: finalReview?.issues.length ?? 0 });
    }
  }
  const finalStatuses: Record<ContentQualityStatus, number> = { Draft: 0, AI_Checked: 0, Needs_Review: 0, Approved: 0, Rejected: 0 };
  for (const item of repository.listQualityBenchmarkContents(runId, true)) finalStatuses[item.qualityStatus] += 1;
  return { sampledCount: candidates.length, modifiedCount, approvedCount, rejectedCount, finalStatuses };
}
