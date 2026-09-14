import { app, dialog, ipcMain, shell } from "electron";
import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { backupDatabase, validateDatabaseBackup, type AIBatchTarget, type AppRepository, type ContentStudioTaskPayload, type HumanReviewSubmitInput } from "@publisher/db";
import type { AccountDisconnectResult, BatchGenerationInput, ContentStudioGenerationInput } from "../shared/api";
import { AIProviderError, DeepSeekErrorMapper, DeepSeekProvider, FallbackAIProvider, MockAIProvider, OpenAICompatibleProvider, contentHash, type AIConnectionDiagnostic, type AIConnectionResult, type AIProvider } from "@publisher/ai";
import { MockImageProvider, OpenAICompatibleImageProvider, persistGeneratedImage, type ImageProvider } from "@publisher/image";
import { exportLogBundle } from "@publisher/logger";
import { CredentialDecryptError, type CredentialStatus, type CredentialStore } from "@publisher/security";
import { BRAND_KNOWLEDGE_CATEGORIES, CONTENT_GOALS, CONTENT_INTENTS, CONTENT_STUDIO_PLATFORM_KEYS, EXCEL_ADVANCED_ARTICLE_HEADERS, EXCEL_SIMPLE_ARTICLE_HEADERS, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, PROMOTION_STRENGTHS, SEARCH_INTENTS, checkGeneratedArticleQuality, selectRelevantBrandFacts, type AccountContext, type AccountProfile, type AccountStatus, type AIUsage, type CredentialField, type ContentStudioPlatformKey, type CreatorIdentityVerificationResult, type ExcelImportPreview, type ImageAsset } from "@publisher/domain";
import { BrowserRuntimeError, assertExternalLaunchAllowed, browserSessionCredentialKey, browserSessionIdHash, isAutomationAdapter, type AdapterRegistry, type AutomationAdapter, type ExternalLaunchTriggerSource, type UserInitiatedAction } from "@publisher/adapters-core";
import type { Logger } from "@publisher/logger";
import type { PublisherService, PersistentScheduler } from "@publisher/publisher";
import type { XhsEditorLoadDiagnosticResult, XhsEditorNetworkDiagnosticResult } from "@publisher/adapters-xiaohongshu/browser";
import { resumePersistentBatches, runPersistentBatchTask } from "./ai-batch";
import { CONTENT_STUDIO_PROMPT_VERSION, resumeContentStudioTasks, runContentStudioTask } from "./content-studio";
import { runQualityGate, runQualityGateForArticle, runQualityGateForVariant } from "./quality-gate";
import { runQualityBenchmark } from "./quality-benchmark";
import { OAuthSessionManager } from "./oauth-session-manager";
import { writeAdvancedExcelTemplate, writeSimpleExcelTemplate } from "./excel-templates";
import { buildExcelImportErrorReportCsv, readExcelArticleFile } from "./excel-import";
import { PlatformSelfTestService } from "./platform-self-test";
import type { ProcessDiagnostics } from "./process-diagnostics";
import { addAccountConnectionModes, browserAccountConnectionResult, browserAccountDisconnectResult } from "./account-connection";
import { recordRuntimeHeartbeat } from "./runtime-observability";

const idSchema = z.string().min(1);
function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const value = (error as { code?: unknown }).code;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return error instanceof Error ? error.name : "UNKNOWN";
}

const brandInputSchema = z.object({ name: z.string().min(1), companyName: z.string().min(1), description: z.string().optional(), industry: z.string().optional(), officialWebsite: z.string().optional(), notes: z.string().optional(), mainBusiness: z.string().optional(), serviceRegions: z.array(z.string()).optional(), advantages: z.array(z.string()).optional(), contact: z.record(z.string(), z.string()).optional(), establishedAt: z.string().optional(), address: z.string().optional(), serviceProcess: z.string().optional(), afterSales: z.string().optional(), faq: z.string().optional(), certificates: z.string().optional(), patents: z.string().optional(), equipment: z.string().optional(), cases: z.string().optional(), aiForbiddenClaims: z.array(z.string()).optional() });
const knowledgeCategorySchema = z.enum(BRAND_KNOWLEDGE_CATEGORIES.map((item) => item.key));
const brandKnowledgeSchema = z.object({ brandId: idSchema, category: knowledgeCategorySchema, title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(20_000), enabled: z.boolean().optional() });
const batchSchema = z.object({ brandId: idSchema, cities: z.array(z.string()).min(1), templateIds: z.array(z.string()), articleType: z.string().min(1), perKeyword: z.number().int().min(1).max(10), minWords: z.number().int().min(80).max(5000), maxWords: z.number().int().min(80).max(10000), autoCover: z.boolean(), includeSummary: z.boolean(), includeTags: z.boolean(), includeSeoKeywords: z.boolean(), concurrency: z.number().int().min(1).max(20).optional() });
const contentStudioInputSchema = z.object({ brandId: idSchema, industry: z.string().trim().min(1).max(200), cities: z.array(z.string().trim().min(1)).min(1).max(100), keywords: z.array(z.string().trim().min(1)).min(1).max(100), targetPlatforms: z.array(z.enum(CONTENT_STUDIO_PLATFORM_KEYS)).min(1).max(CONTENT_STUDIO_PLATFORM_KEYS.length), topicPlan: z.object({ summary: z.string(), topics: z.array(z.object({ title: z.string(), angle: z.string(), audience: z.string(), keyPoints: z.array(z.string()), recommendedPlatforms: z.array(z.enum(CONTENT_STUDIO_PLATFORM_KEYS)) })) }).nullable().optional(), mediaAssetIds: z.array(idSchema).max(100).default([]), videoAssetIds: z.array(idSchema).max(100).default([]), concurrency: z.number().int().min(1).max(10).optional(), business: z.string().trim().max(200).optional(), city: z.string().trim().max(100).optional(), keyword: z.string().trim().max(200).optional(), topic: z.string().trim().max(300).optional(), contentGoal: z.enum(CONTENT_GOALS).default("BrandPromotion"), contentIntent: z.enum(CONTENT_INTENTS).optional(), searchIntent: z.enum(SEARCH_INTENTS).optional(), promotionStrength: z.enum(PROMOTION_STRENGTHS).default("Balanced") });
const videoAssetMetadataSchema = z.object({ description: z.string().max(5000), tags: z.array(z.string().min(1).max(40)).max(20), coverSourcePath: z.string().max(8192).nullable().optional(), durationMs: z.number().int().min(0).max(86_400_000).optional(), width: z.number().int().min(1).max(16384).optional(), height: z.number().int().min(1).max(16384).optional(), platformFields: z.record(z.string(), z.record(z.string(), z.string().max(500))).default({}) });
const videoExtensions = new Set([".mp4", ".mov", ".m4v"]);
const mimeByExtension: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v" };
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const imageMimeByExtension: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp" };
const HUMAN_REVIEW_DATASET_ID = "V093_HUMAN_REVIEW_001";
const HUMAN_REVIEW_BENCHMARK_RUN_ID = "deepseek_real-4a83e49e-cb58-4498-96e3-159d702e1512";
const humanReviewContentSchema = z.object({ contentType: z.enum(["article", "article_variant"]), contentId: idSchema, platformKey: z.string().nullable(), title: z.string(), body: z.string(), summary: z.string(), contentHash: z.string().length(64) });
const humanReviewSubmitSchema = z.object({
  datasetItemId: idSchema,
  finalStatus: z.enum(["AI_Checked", "Needs_Review", "Approved", "Rejected"]),
  reviewDurationMs: z.number().int().min(0).max(86_400_000),
  editCount: z.number().int().min(0).max(100),
  originalContentHash: z.string().length(64),
  finalContentHash: z.string().length(64),
  originalContent: humanReviewContentSchema,
  finalContent: humanReviewContentSchema,
  issueDecisions: z.array(z.object({ ruleId: z.string().min(1).max(100), issueIndex: z.number().int().min(0).max(1000), machineDecision: z.enum(["Detected", "NotDetected"]), humanDecision: z.enum(["TruePositive", "FalsePositive", "Uncertain", "MissedIssue"]), reason: z.string().max(1000).nullable().optional(), issue: z.record(z.string(), z.unknown()).nullable().optional() })).max(1000),
  reason: z.string().max(1000).nullable().optional()
});

export interface IpcDependencies {
  repository: AppRepository;
  publisher: PublisherService;
  scheduler: PersistentScheduler;
  registry: AdapterRegistry;
  resolveAccountSecrets: (accountId: string, platformKey: string) => Record<string, string>;
  dataDirectory: string;
  coverDir: string;
  logger: Logger;
  credentials: CredentialStore;
  aiCredentials: CredentialStore;
  appLogPath: string;
  errorLogPath?: string;
  databasePath: string;
  restoreDatabase?: (backupPath: string) => void;
  processDiagnostics?: ProcessDiagnostics;
}

let processDiagnostics: ProcessDiagnostics | null = null;

function register(channel: string, handler: (event: Electron.IpcMainInvokeEvent, payload: unknown) => unknown): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(event, payload);
    } catch (error) {
      processDiagnostics?.recordIpcError(channel, error);
      throw error;
    }
  });
}

export function registerIpc(deps: IpcDependencies): PlatformSelfTestService {
  processDiagnostics = deps.processDiagnostics ?? null;
  const { repository, publisher, scheduler, registry, resolveAccountSecrets, dataDirectory, coverDir, logger, credentials, aiCredentials } = deps;
  const listPlatformViews = (): ReturnType<AppRepository["listPlatforms"]> => addAccountConnectionModes(repository.listPlatforms(), registry);
  const createUserAction = (triggerSource: Exclude<ExternalLaunchTriggerSource, "APP_STARTUP">): UserInitiatedAction => {
    const action = { userActionId: randomUUID(), triggerSource } satisfies UserInitiatedAction;
    assertExternalLaunchAllowed(action);
    logger.info("EXTERNAL_LAUNCH", "USER_INITIATED_ACTION", "已记录用户发起的平台操作", action);
    return action;
  };
  const accountContext = (accountId: string, platformKey: string, action?: UserInitiatedAction, includeArchived = false): AccountContext => {
    const account = includeArchived ? repository.getAccountById(accountId, platformKey) : repository.listAccounts().find((item) => item.id === accountId && item.platformKey === platformKey);
    if (!account || account.platformKey !== platformKey) throw new Error("账号与平台不匹配");
    return {
      accountId,
      accountName: account.name,
      platformKey,
      settings: {
        triggerSource: action?.triggerSource ?? "APP_STARTUP",
        ...(action?.userActionId ? { userActionId: action.userActionId } : {})
      },
      secrets: resolveAccountSecrets(accountId, platformKey)
    };
  };
  const syncBrowserAccount = async (adapter: AutomationAdapter, accountId: string, platformKey: string, action: UserInitiatedAction, profileOverride?: AccountProfile) => {
    const profile = profileOverride ?? (adapter.getAccountProfile ? await adapter.getAccountProfile(accountContext(accountId, platformKey, action)) : undefined);
    const localAccount = repository.listAccounts().find((item) => item.id === accountId);
    return repository.syncBrowserPlatformAccount({
      accountId,
      platformKey,
      accountName: profile?.accountName ?? localAccount?.name,
      browserSessionId: browserSessionIdHash({ platformKey, accountId }),
      ...(adapter.getAccountProfile ? { externalAccountId: profile?.accountId ?? null } : {}),
      lastVerifiedAt: new Date().toISOString()
    });
  };
  const oauthSessions = new OAuthSessionManager({ repository, registry, credentials, logger, accountContext });
  const platformSelfTests = new PlatformSelfTestService({ repository, registry, publisher, resolveAccountSecrets, evidenceDirectory: join(dataDirectory, "evidence"), logger });
  const validateVideoAsset = async (assetId: string, platformKey: string): Promise<{ asset: NonNullable<ReturnType<AppRepository["getManagedVideoAsset"]>>; validation: { valid: boolean; errors: string[]; warnings: string[] } }> => {
    const asset = repository.getManagedVideoAsset(assetId);
    if (!asset) throw new Error("视频素材不存在");
    const platform = repository.listPlatforms().find((item) => item.platformKey === platformKey);
    if (!platform || !platform.capabilities.video) throw new Error("所选平台未声明视频发布能力");
    const adapter = registry.get(platformKey);
    if (!adapter.validateVideo) return { asset, validation: { valid: true, errors: [], warnings: ["平台 Adapter 未提供额外视频校验"] } };
    const validation = await adapter.validateVideo({ title: asset.title, description: asset.description, tags: asset.tags, videoPath: asset.localPath, ...(asset.coverPath ? { coverPath: asset.coverPath } : {}) });
    return { asset, validation };
  };
  register("dashboard:get", () => { recordRuntimeHeartbeat(logger, "dashboard:get"); return repository.dashboardStats(); });
  register("video-assets:list", (_event, payload) => repository.listVideoAssets(z.object({ brandId: z.string().optional() }).optional().parse(payload)?.brandId));
  register("video-assets:pick-video", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "视频文件", extensions: ["mp4", "mov", "m4v"] }] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  register("video-assets:pick-cover", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "封面图片", extensions: ["jpg", "jpeg", "png", "webp"] }] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  register("video-assets:create", (_event, payload) => {
    const input = z.object({ brandId: idSchema, sourcePath: z.string().min(1).max(8192), title: z.string().trim().min(1).max(200), ...videoAssetMetadataSchema.shape }).parse(payload);
    if (!repository.getBrand(input.brandId)) throw new Error("品牌不存在");
    const extension = extname(input.sourcePath).toLowerCase();
    if (!videoExtensions.has(extension)) throw new Error("视频格式仅支持 mp4、mov、m4v");
    const sourceStat = statSync(input.sourcePath);
    if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error("视频文件不存在或为空");
    const assetId = randomUUID();
    const videoDirectory = join(dataDirectory, "media", "videos");
    const coverDirectory = join(dataDirectory, "media", "video-covers");
    mkdirSync(videoDirectory, { recursive: true });
    mkdirSync(coverDirectory, { recursive: true });
    const managedVideoPath = join(videoDirectory, `${assetId}${extension}`);
    copyFileSync(input.sourcePath, managedVideoPath);
    let coverPath: string | null = null;
    let coverAssetId: string | null = null;
    if (input.coverSourcePath) {
      const coverExtension = extname(input.coverSourcePath).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(coverExtension)) throw new Error("封面格式仅支持 jpg、jpeg、png、webp");
      const coverStat = statSync(input.coverSourcePath);
      if (!coverStat.isFile() || coverStat.size <= 0) throw new Error("封面文件不存在或为空");
      coverPath = join(coverDirectory, `${assetId}${coverExtension}`);
      copyFileSync(input.coverSourcePath, coverPath);
      coverAssetId = repository.createMediaAsset({ brandId: input.brandId, type: "video_cover", title: `${input.title} 封面`, filePath: coverPath });
    }
    repository.createVideoAsset({ id: assetId, localPath: managedVideoPath, fileName: basename(input.sourcePath), mimeType: mimeByExtension[extension] ?? "video/*", size: sourceStat.size, durationMs: input.durationMs, width: input.width, height: input.height });
    repository.createMediaAsset({ id: assetId, brandId: input.brandId, type: "video", title: input.title, filePath: managedVideoPath, metadata: { description: input.description.trim(), tags: input.tags.map((tag) => tag.trim()).filter(Boolean), coverPath, coverAssetId, platformFields: input.platformFields, status: "Draft" } });
    return repository.getManagedVideoAsset(assetId);
  });
  register("video-assets:update", (_event, payload) => {
    const raw = z.object({ id: idSchema, input: z.object({ title: z.string().trim().min(1).max(200).optional(), ...videoAssetMetadataSchema.partial().shape }) }).parse(payload);
    const current = repository.getManagedVideoAsset(raw.id);
    if (!current) throw new Error("视频素材不存在");
    let coverPath: string | null | undefined;
    let coverAssetId: string | null | undefined;
    if (raw.input.coverSourcePath !== undefined) {
      if (raw.input.coverSourcePath === null) { coverPath = null; coverAssetId = null; }
      else {
        const extension = extname(raw.input.coverSourcePath).toLowerCase();
        if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) throw new Error("封面格式仅支持 jpg、jpeg、png、webp");
        const coverStat = statSync(raw.input.coverSourcePath);
        if (!coverStat.isFile() || coverStat.size <= 0) throw new Error("封面文件不存在或为空");
        const coverDirectory = join(dataDirectory, "media", "video-covers");
        mkdirSync(coverDirectory, { recursive: true });
        coverPath = join(coverDirectory, `${raw.id}-${Date.now()}${extension}`);
        copyFileSync(raw.input.coverSourcePath, coverPath);
        coverAssetId = current.brandId ? repository.createMediaAsset({ brandId: current.brandId, type: "video_cover", title: `${raw.input.title ?? current.title} 封面`, filePath: coverPath }) : null;
      }
    }
    return repository.updateVideoAsset(raw.id, { ...raw.input, ...(coverPath === undefined ? {} : { coverPath, coverAssetId }) });
  });
  register("video-assets:preflight", async (_event, payload) => {
    const input = z.object({ id: idSchema, platformKey: idSchema }).parse(payload);
    const result = await validateVideoAsset(input.id, input.platformKey);
    return result.validation;
  });
  register("brands:list", () => repository.listBrands());
  register("brands:create", (_event, payload) => repository.createBrand(brandInputSchema.parse(payload)));
  register("brands:update", (_event, payload) => { const input = z.object({ id: idSchema, data: brandInputSchema.partial() }).parse(payload); const brand = repository.updateBrand(input.id, input.data); repository.insertLog({ level: "info", module: "enterprise-profile", code: "ENTERPRISE_PROFILE_UPDATED", message: "企业资料已保存", context: { brandId: input.id } }); return brand; });
  register("brands:assets", (_event, payload) => repository.listAssets(z.object({ brandId: idSchema }).parse(payload).brandId));
  register("brands:asset-create", (_event, payload) => repository.createAsset(z.object({ brandId: idSchema, type: z.enum(["logo", "environment", "team", "project", "product", "equipment", "certificate", "case", "other"]), title: z.string().min(1), filePath: z.string().min(1), description: z.string() }).parse(payload)));
  register("brand-knowledge:list", (_event, payload) => repository.listBrandKnowledgeEntries(z.object({ brandId: idSchema }).parse(payload).brandId));
  register("brand-knowledge:create", (_event, payload) => { const input = brandKnowledgeSchema.parse(payload); const entry = repository.createBrandKnowledgeEntry(input); repository.insertLog({ level: "info", module: "enterprise-knowledge", code: "KNOWLEDGE_CREATED", message: "企业知识资料已新增", context: { brandId: input.brandId, category: input.category } }); return entry; });
  register("brand-knowledge:update", (_event, payload) => { const input = z.object({ id: idSchema, data: brandKnowledgeSchema.omit({ brandId: true }).partial() }).parse(payload); const entry = repository.updateBrandKnowledgeEntry(input.id, input.data); repository.insertLog({ level: "info", module: "enterprise-knowledge", code: "KNOWLEDGE_UPDATED", message: "企业知识资料已更新", context: { brandId: entry.brandId, category: entry.category, enabled: entry.enabled } }); return entry; });
  register("brand-knowledge:delete", (_event, payload) => { const id = z.object({ id: idSchema }).parse(payload).id; repository.deleteBrandKnowledgeEntry(id); repository.insertLog({ level: "info", module: "enterprise-knowledge", code: "KNOWLEDGE_DELETED", message: "企业知识资料已删除", context: {} }); });

  register("keywords:templates", (_event, payload) => repository.listKeywordTemplates(z.object({ brandId: idSchema }).parse(payload).brandId));
  register("keywords:items", (_event, payload) => repository.listKeywordItems(z.object({ brandId: idSchema }).parse(payload).brandId));
  register("keywords:create-template", (_event, payload) => repository.createKeywordTemplate(z.object({ brandId: idSchema, template: z.string().min(1), category: z.string() }).parse(payload)));
  register("keywords:update-template", (_event, payload) => { const input = z.object({ id: idSchema, data: z.object({ template: z.string().min(1).optional(), category: z.string().optional(), enabled: z.boolean().optional() }) }).parse(payload); return repository.updateKeywordTemplate(input.id, input.data); });
  register("keywords:delete-template", (_event, payload) => repository.deleteKeywordTemplate(z.object({ id: idSchema }).parse(payload).id));
  register("keywords:expand", (_event, payload) => { const input = z.object({ brandId: idSchema, cities: z.array(z.string()).min(1), templateIds: z.array(z.string()).optional() }).parse(payload); const result = repository.expandAndSaveKeywords(input); return { count: result.items.length, duplicates: result.duplicates }; });
  register("keywords:import", (_event, payload) => { const input = z.object({ brandId: idSchema, source: z.string().min(1) }).parse(payload); return repository.importKeywords(input.brandId, input.source); });
  register("keywords:regions", (_event, payload) => repository.listCityRegions(z.object({ brandId: idSchema }).parse(payload).brandId));
  register("keywords:regions-import", (_event, payload) => { const input = z.object({ brandId: idSchema, rows: z.array(z.object({ province: z.string(), city: z.string(), district: z.string().optional() })).min(1) }).parse(payload); return repository.importCityRegions(input.brandId, input.rows); });

  register("content-studio:media-assets", (_event, payload) => repository.listContentStudioMediaAssets(z.object({ brandId: idSchema }).parse(payload).brandId));
  register("content-studio:expand-keywords", (_event, payload) => {
    const input = z.object({ brandId: idSchema, cities: z.array(z.string().trim().min(1)).min(1).max(100), keywords: z.array(z.string().trim().min(1)).min(1).max(100), industry: z.string().trim().max(200).optional() }).parse(payload);
    if (!repository.getBrand(input.brandId)) throw new Error("品牌资料不存在");
    return repository.expandContentStudioKeywords(input);
  });
  register("content-studio:plan-topics", async (_event, payload) => {
    const input = contentStudioInputSchema.parse(payload) as ContentStudioGenerationInput;
    const brand = repository.getBrand(input.brandId);
    if (!brand) throw new Error("品牌资料不存在");
    const provider = createAiProvider(repository, aiCredentials, logger);
    const taskId = repository.createContentStudioTask({ brandId: brand.id, type: "topic_plan", provider: provider.providerKey, model: provider.model, totalCount: 1, payload: { ...input, promptVersion: CONTENT_STUDIO_PROMPT_VERSION } as ContentStudioTaskPayload });
    const knowledgeSnapshot = selectRelevantBrandFacts(brand, { business: input.business ?? input.keyword ?? input.keywords[0], city: input.city ?? input.cities[0], keyword: input.keyword ?? input.keywords[0], topic: input.topic ?? "" });
    repository.updateContentStudioTask(taskId, { completed: 0, success: 0, failed: 0, status: "running", output: { knowledgeSnapshot, promptVersion: CONTENT_STUDIO_PROMPT_VERSION } });
    try {
      const plan = await provider.generateTopicPlan({ brand, industry: input.industry, cities: input.cities, keywords: input.keywords, targetPlatforms: input.targetPlatforms, topicPlan: null, mediaAssets: [], videoAssets: [], business: input.business ?? input.keyword ?? input.keywords[0], city: input.city ?? input.cities[0], keyword: input.keyword ?? input.keywords[0], topic: input.topic, contentGoal: input.contentGoal, contentIntent: input.contentIntent, searchIntent: input.searchIntent, promotionStrength: input.promotionStrength, knowledgeSnapshot, promptVersion: CONTENT_STUDIO_PROMPT_VERSION });
      repository.persistContentStudioPlan(taskId, { summary: plan.summary, topics: plan.topics }, plan.usage);
      repository.updateContentStudioTask(taskId, { completed: 1, success: 1, failed: 0, status: "completed", usage: plan.usage, durationMs: plan.durationMs, output: { topicPlan: { summary: plan.summary, topics: plan.topics } } });
      return { summary: plan.summary, topics: plan.topics };
    } catch (error) {
      const message = error instanceof Error ? error.message : "主题规划失败";
      repository.updateContentStudioTask(taskId, { completed: 1, success: 0, failed: 1, status: "failed", errorMessage: message });
      throw error;
    }
  });
  register("content-studio:start", (_event, payload) => {
    const input = contentStudioInputSchema.parse(payload) as ContentStudioGenerationInput;
    const brand = repository.getBrand(input.brandId);
    if (!brand) throw new Error("品牌资料不存在");
    const provider = createAiProvider(repository, aiCredentials, logger);
    const selectedAssets = new Set(repository.listContentStudioMediaAssets(brand.id).map((asset) => asset.id));
    if (input.mediaAssetIds.some((id) => !selectedAssets.has(id))) throw new Error("存在不属于当前品牌的 Media Asset");
    for (const id of input.videoAssetIds) {
      const asset = repository.getManagedVideoAsset(id);
      if (!asset || (asset.brandId && asset.brandId !== brand.id)) throw new Error("存在不属于当前品牌的视频素材");
    }
    const taskId = repository.createContentStudioTask({ brandId: brand.id, type: "multi_platform_content", provider: provider.providerKey, model: provider.model, totalCount: input.targetPlatforms.length, payload: { ...input, promptVersion: CONTENT_STUDIO_PROMPT_VERSION } as ContentStudioTaskPayload });
    void runContentStudioTask(repository, logger, { createAiProvider: () => createAiProvider(repository, aiCredentials, logger) }, taskId);
    return taskId;
  });
  register("content-studio:task", (_event, payload) => repository.getContentStudioTask(z.object({ id: idSchema }).parse(payload).id));
  register("content-studio:tasks", (_event, payload) => repository.listContentStudioTasks(z.object({ brandId: idSchema.optional() }).optional().parse(payload)?.brandId));
  register("content-studio:versions", (_event, payload) => { const input = z.object({ rootTaskId: idSchema, platformKey: z.enum(CONTENT_STUDIO_PLATFORM_KEYS).optional() }).parse(payload); return repository.listContentStudioVersions(input.rootTaskId, input.platformKey as ContentStudioPlatformKey | undefined); });
  register("content-studio:version-update", (_event, payload) => {
    const input = z.object({ id: idSchema, data: z.object({ title: z.string().min(1).optional(), body: z.string().min(1).optional(), summary: z.string().optional(), tags: z.array(z.string()).optional(), seoKeywords: z.array(z.string()).optional() }) }).parse(payload);
    const version = repository.updateContentStudioVersion(input.id, input.data);
    if (version.articleVariantId) runQualityGateForVariant(repository, version.articleVariantId, "manual_edit", { title: version.title, body: version.body, summary: version.summary, tags: version.tags, seoKeywords: version.seoKeywords });
    return repository.getContentStudioVersion(input.id);
  });
  register("content-studio:regenerate", (_event, payload) => {
    const input = z.object({ rootTaskId: idSchema, platformKey: z.enum(CONTENT_STUDIO_PLATFORM_KEYS) }).parse(payload);
    const rootTask = repository.getContentStudioTask(input.rootTaskId);
    if (!rootTask) throw new Error("Content Studio task 不存在");
    if (!rootTask.payload.targetPlatforms.includes(input.platformKey)) throw new Error("该平台不在原任务目标范围内");
    if (rootTask.status === "running") throw new Error("原任务仍在运行，请等待完成后再重新生成");
    const provider = createAiProvider(repository, aiCredentials, logger);
    const payloadForRegeneration: ContentStudioTaskPayload = { ...rootTask.payload, targetPlatforms: [input.platformKey] };
    const taskId = repository.createContentStudioTask({ brandId: rootTask.brandId, type: "regenerate_platform", provider: provider.providerKey, model: provider.model, totalCount: 1, parentTaskId: rootTask.id, payload: payloadForRegeneration });
    void runContentStudioTask(repository, logger, { createAiProvider: () => createAiProvider(repository, aiCredentials, logger) }, taskId);
    return taskId;
  });

  register("articles:list", (_event, payload) => repository.listArticles(z.object({ brandId: z.string().optional(), search: z.string().optional(), status: z.string().optional(), city: z.string().optional(), source: z.enum(["production", "content_studio", "excel_import", "benchmark", "mock", "test"]).optional() }).optional().parse(payload)));
  register("articles:page", (_event, payload) => repository.listArticlesPage(z.object({ brandId: z.string().optional(), search: z.string().optional(), status: z.string().optional(), city: z.string().optional(), source: z.enum(["production", "content_studio", "excel_import", "benchmark", "mock", "test"]).optional(), page: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(200).optional() }).optional().parse(payload)));
  register("articles:get", (_event, payload) => repository.getArticle(z.object({ id: idSchema }).parse(payload).id));
  register("articles:update", (_event, payload) => { const input = z.object({ id: idSchema, data: z.record(z.string(), z.unknown()) }).parse(payload); const article = repository.updateArticle(input.id, input.data as Parameters<AppRepository["updateArticle"]>[1]); runQualityGateForArticle(repository, article.id, "manual_edit"); return article; });
  register("articles:mark-needs-rewrite", (_event, payload) => repository.markArticleNeedsRewrite(z.object({ id: idSchema }).parse(payload).id));
  register("articles:archive", (_event, payload) => repository.archiveArticle(z.object({ id: idSchema }).parse(payload).id));
  register("articles:delete", (_event, payload) => repository.deleteArticle(z.object({ id: idSchema }).parse(payload).id));
  register("articles:generate-cover", async (_event, payload) => {
    const id = z.object({ id: idSchema }).parse(payload).id;
    const article = repository.getArticle(id);
    if (!article) throw new Error("文章不存在");
    const brand = repository.getBrand(article.brandId);
    if (!brand) throw new Error("品牌不存在");
    let image: Awaited<ReturnType<ImageProvider["generateCover"]>>;
    try {
      image = await createImageProvider(repository, aiCredentials).generateCover({ articleId: article.id, title: article.title, brandName: brand.name, city: article.city, articleType: article.articleType });
    } catch (error) {
      logger.warn("IMAGE", "IMAGE_PROVIDER_FALLBACK", "真实图片 Provider 失败，已回退模板封面", { articleId: article.id, error: error instanceof Error ? error.message : "unknown" });
      image = await new MockImageProvider().generateCover({ articleId: article.id, title: article.title, brandName: brand.name, city: article.city, articleType: article.articleType });
    }
    const filePath = await persistGeneratedImage(image, coverDir);
    const assetId = repository.createMediaAsset({ brandId: brand.id, type: "cover", title: `${article.title} 封面`, filePath, provider: image.provider, model: image.model });
    return repository.attachCover(article.id, assetId);
  });

  register("ai:start-batch", (_event, payload) => {
    const input = batchSchema.parse(payload) as BatchGenerationInput;
    return startBatch(repository, logger, input, coverDir, aiCredentials);
  });
  register("ai:task", (_event, payload) => repository.getAiTask(z.object({ id: idSchema }).parse(payload).id));
  register("ai:cancel", (_event, payload) => { repository.cancelAiTask(z.object({ id: idSchema }).parse(payload).id); });
  register("articles:variants", (_event, payload) => repository.listArticleVariants(z.object({ articleId: idSchema }).parse(payload).articleId));
  register("articles:generate-variant", async (_event, payload) => {
    const input = z.object({ articleId: idSchema, platformKey: idSchema }).parse(payload);
    const article = repository.getArticle(input.articleId);
    if (!article) throw new Error("文章不存在");
    const brand = repository.getBrand(article.brandId);
    if (!brand) throw new Error("品牌不存在");
    const provider = createAiProvider(repository, aiCredentials);
    const generated = await provider.rewriteForPlatform({ brand, city: article.city, keyword: article.keyword, articleType: article.articleType, minWords: 300, maxWords: 2000, includeFaq: true, includeSummary: true, includeTags: true, includeSeoKeywords: true, article, platformKey: input.platformKey });
    const variant = repository.createArticleVariant({ articleId: article.id, platformKey: input.platformKey, title: generated.title, body: generated.body, summary: generated.summary, coverAssetId: article.coverAssetId, contentHash: contentHash(generated) });
    runQualityGateForVariant(repository, variant.id, "generation", { title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords });
    return variant;
  });
  register("articles:update-variant", (_event, payload) => { const input = z.object({ id: idSchema, data: z.object({ title: z.string().min(1).optional(), body: z.string().min(1).optional(), summary: z.string().optional() }) }).parse(payload); const variant = repository.updateArticleVariant(input.id, input.data); runQualityGateForVariant(repository, variant.id, "manual_edit"); return variant; });
  register("articles:history", (_event, payload) => repository.getPublishRecords(z.object({ articleId: idSchema }).parse(payload).articleId));
  const exportExcelTemplate = async (kind: "simple" | "advanced") => {
    const fileName = kind === "simple" ? "Geo Media Publisher 简易文章导入模板.xlsx" : "Geo Media Publisher 高级文章导入模板.xlsx";
    const fields = kind === "simple" ? [...EXCEL_SIMPLE_ARTICLE_HEADERS] : [...EXCEL_ADVANCED_ARTICLE_HEADERS];
    const defaultPath = join(app.getPath("downloads"), fileName);
    const result = await dialog.showSaveDialog({ defaultPath, filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }] });
    if (result.canceled || !result.filePath) return null;
    const destination = result.filePath.toLowerCase().endsWith(".xlsx") ? result.filePath : `${result.filePath}.xlsx`;
    if (kind === "simple") writeSimpleExcelTemplate(destination); else writeAdvancedExcelTemplate(destination);
    logger.info("ARTICLE_IMPORT", "EXCEL_TEMPLATE_EXPORTED", "Excel 文章导入模板已生成", { fileName: basename(destination), kind });
    return { path: destination, fileName: basename(destination), fields };
  };
  register("articles:excel-template", () => exportExcelTemplate("advanced"));
  register("articles:excel-simple-template", () => exportExcelTemplate("simple"));
  register("articles:excel-advanced-template", () => exportExcelTemplate("advanced"));
  register("articles:excel-pick", async (_event, payload) => {
    const input = z.object({ defaultBrandId: idSchema.nullable().optional() }).optional().parse(payload);
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Excel 工作簿", extensions: ["xlsx", "xls"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    let parsed = readExcelArticleFile(result.filePaths[0]);
    if (parsed.requiresSheetSelection) {
      const candidateNames = parsed.sheetCandidates.map((candidate) => candidate.sheetName);
      const selection = await dialog.showMessageBox({
        type: "question",
        title: "选择要导入的工作表",
        message: "检测到多个包含“标题 / 内容”表头的工作表",
        detail: "请选择本次需要导入的工作表。",
        buttons: [...candidateNames, "取消"],
        cancelId: candidateNames.length,
        defaultId: 0,
        noLink: true
      });
      if (selection.response >= candidateNames.length) return null;
      parsed = readExcelArticleFile(result.filePaths[0], { sheetName: candidateNames[selection.response] });
    }
    const preview = repository.previewExcelArticleImport({
      ...parsed,
      defaultBrandId: input?.defaultBrandId ?? null
    });
    logger.info("ARTICLE_IMPORT", "EXCEL_PREVIEW_READY", "Excel 文章导入预览已生成", {
      fileName: parsed.fileName,
      selectedSheetName: preview.selectedSheetName,
      totalRows: preview.totalRows,
      validRows: preview.validRows,
      duplicateRows: preview.duplicateRows,
      errorRows: preview.errorRows,
      warningRows: preview.warningRows
    });
    return preview;
  });
  register("articles:excel-confirm", (_event, payload) => {
    const input = z.object({ preview: z.unknown(), duplicateRowNumbers: z.array(z.number().int().positive()).optional() }).parse(payload);
    const preview = input.preview as ExcelImportPreview;
    const result = repository.confirmExcelArticleImport({ preview, duplicateRowNumbers: input.duplicateRowNumbers ?? [] });
    logger.info("ARTICLE_IMPORT", "EXCEL_IMPORT_CONFIRMED", "Excel 文章导入已确认；未创建发布任务", { fileName: preview.fileName, importBatchId: result.importBatchId, imported: result.imported, failed: result.failed, skippedDuplicates: result.skippedDuplicates });
    return result;
  });
  register("articles:excel-errors", async (_event, payload) => {
    const input = z.object({ preview: z.unknown() }).parse(payload);
    const preview = input.preview as ExcelImportPreview;
    const result = await dialog.showSaveDialog({ defaultPath: join(app.getPath("downloads"), "Geo Media Publisher Excel导入错误报告.csv"), filters: [{ name: "CSV 文件", extensions: ["csv"] }] });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, buildExcelImportErrorReportCsv(preview), "utf8");
    logger.info("ARTICLE_IMPORT", "EXCEL_ERROR_REPORT_EXPORTED", "Excel 导入错误报告已导出", { fileName: basename(result.filePath), reportRows: preview.errorRows + preview.duplicateRows + preview.warningRows + preview.diagnostics.length });
    return result.filePath;
  });
  register("articles:prepare-publish", async (_event, payload) => {
    const input = z.object({ articleId: idSchema, platformKey: idSchema, platformAccountId: idSchema, publishMode: z.enum(["ASSISTED", "MANUAL"]).optional(), finalPublishMode: z.enum(["PREPARE_ONLY", "CONFIRM_BEFORE_PUBLISH", "AUTO_PUBLISH"]).optional(), selectedImageAssetId: idSchema.nullable().optional(), imageSelectionMode: z.enum(["random", "manual", "none"]).optional() }).parse(payload);
    const configuredMode = repository.getSettings().finalPublishMode;
    const finalPublishMode = input.finalPublishMode ?? (configuredMode === "prepare_only" ? "PREPARE_ONLY" : configuredMode === "auto_publish" ? "AUTO_PUBLISH" : "CONFIRM_BEFORE_PUBLISH");
    const job = repository.createArticlePublishJob({ ...input, finalPublishMode });
    logger.info("QUALITY_GATE", "CONTENT_REVIEW_MODE_APPLIED", "文章按当前内容审核模式进入发布流程", { articleId: input.articleId, platformKey: input.platformKey, contentReviewMode: repository.getContentReviewMode() });
    const platform = repository.listPlatforms().find((item) => item.platformKey === input.platformKey);
    const isApiPlatform = platform?.integrationMode === "API";
    if (finalPublishMode === "PREPARE_ONLY" && isApiPlatform) return { job, record: null, message: "内容已准备并写入任务；只准备内容模式不会调用平台发布 API。" };
    const action = createUserAction("START_PUBLISH");
    if (finalPublishMode === "AUTO_PUBLISH" && isApiPlatform) {
      const result = await publisher.executeJob(job.id, action);
      return { ...result, record: repository.getPublishRecordByJob(result.job.id) };
    }
    if (input.platformKey === "cnblogs") {
      repository.confirmJob(job.id, true);
      const result = await publisher.executeJob(job.id, action);
      return { ...result, record: repository.getPublishRecordByJob(result.job.id) };
    }
    const prepared = await publisher.prepareArticle(job.id, action);
    return finalPublishMode === "AUTO_PUBLISH"
      ? { ...prepared, message: `${prepared.message}；该浏览器平台尚无已验证的最终提交能力，已降级为发布前确认。` }
      : prepared;
  });

  const imageAssetView = (asset: ImageAsset): ImageAsset => ({ ...asset, previewUrl: pathToFileURL(asset.filePath).href });
  register("articles:attach-recommended-image", (_event, payload) => {
    const input = z.object({ articleId: idSchema, platformKey: idSchema }).parse(payload);
    const image = repository.selectImageAssetForArticle(input.articleId, input.platformKey);
    if (!image) return null;
    repository.attachCover(input.articleId, image.id);
    logger.info("IMAGE_LIBRARY", "ARTICLE_IMAGE_MATCHED", "文章已匹配图片库图片", { articleId: input.articleId, imageAssetId: image.id, platformKey: input.platformKey });
    return imageAssetView(image);
  });
  const imageInputSchema = z.object({ brandId: idSchema, sourcePaths: z.array(z.string().min(1).max(8192)).min(1).max(100), name: z.string().trim().max(200).optional(), tags: z.array(z.string().trim().min(1).max(80)).max(30), business: z.array(z.string().trim().min(1).max(80)).max(20), city: z.array(z.string().trim().min(1).max(80)).max(20), usage: z.array(z.string().trim().min(1).max(80)).max(30), platform: z.array(z.string().trim().min(1).max(80)).max(20), universal: z.boolean() });
  register("image-assets:list", (_event, payload) => { const input = z.object({ brandId: idSchema.optional(), enabledOnly: z.boolean().optional() }).optional().parse(payload); return repository.listImageAssets(input?.brandId, input?.enabledOnly ?? false).map(imageAssetView); });
  register("image-assets:pick-files", async () => { const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] }); return result.canceled ? [] : result.filePaths; });
  register("image-assets:import", (_event, payload) => {
    const input = imageInputSchema.parse(payload);
    if (!repository.getBrand(input.brandId)) throw new Error("品牌不存在");
    const imageDirectory = join(dataDirectory, "media", "images");
    mkdirSync(imageDirectory, { recursive: true });
    const imported: ImageAsset[] = [];
    input.sourcePaths.forEach((sourcePath, index) => {
      const extension = extname(sourcePath).toLowerCase();
      if (!imageExtensions.has(extension)) throw new Error(`图片格式不支持：${basename(sourcePath)}`);
      const sourceStat = statSync(sourcePath);
      if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > 20 * 1024 * 1024) throw new Error(`图片不存在、为空或超过 20MB：${basename(sourcePath)}`);
      const id = randomUUID();
      const managedPath = join(imageDirectory, `${id}${extension}`);
      copyFileSync(sourcePath, managedPath);
      const name = input.name?.trim() ? (input.sourcePaths.length === 1 ? input.name.trim() : `${input.name.trim()} ${index + 1}`) : basename(sourcePath, extension);
      imported.push(repository.createImageAsset({ id, brandId: input.brandId, name, filePath: managedPath, originalFileName: basename(sourcePath), mimeType: imageMimeByExtension[extension] ?? "application/octet-stream", size: sourceStat.size, tags: input.tags, business: input.business, city: input.city, usage: input.usage, platform: input.platform, universal: input.universal }));
    });
    logger.info("IMAGE_LIBRARY", "IMAGE_IMPORT_COMPLETED", "图片已导入图片库", { brandId: input.brandId, count: imported.length });
    return imported.map(imageAssetView);
  });
  register("image-assets:update", (_event, payload) => { const input = z.object({ id: idSchema, input: z.object({ name: z.string().trim().max(200).optional(), tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(), business: z.array(z.string().trim().min(1).max(80)).max(20).optional(), city: z.array(z.string().trim().min(1).max(80)).max(20).optional(), usage: z.array(z.string().trim().min(1).max(80)).max(30).optional(), platform: z.array(z.string().trim().min(1).max(80)).max(20).optional(), universal: z.boolean().optional(), enabled: z.boolean().optional() }) }).parse(payload); return imageAssetView(repository.updateImageAsset(input.id, input.input)); });
  register("image-assets:delete", (_event, payload) => {
    const id = z.object({ id: idSchema }).parse(payload).id;
    const asset = repository.getImageAsset(id);
    if (!asset) throw new Error("图片不存在");
    const deleted = repository.deleteImageAsset(id);
    const imageRoot = resolve(join(dataDirectory, "media", "images"));
    const filePath = resolve(deleted.filePath);
    if (filePath === imageRoot || filePath.startsWith(`${imageRoot}\\`)) { try { unlinkSync(filePath); } catch { /* database deletion remains recoverable from backup */ } }
    logger.info("IMAGE_LIBRARY", "IMAGE_DELETED", "图片已从图片库删除", { imageAssetId: id });
  });
  register("image-assets:select-for-article", (_event, payload) => { const input = z.object({ articleId: idSchema, platformKey: idSchema, excludeImageAssetIds: z.array(idSchema).max(100).optional() }).parse(payload); const asset = repository.selectImageAssetForArticle(input.articleId, input.platformKey, 3, input.excludeImageAssetIds ?? []); return asset ? imageAssetView(asset) : null; });

  register("quality:items", (_event, payload) => repository.listContentQualityItems(z.object({ brandId: idSchema.optional() }).optional().parse(payload)?.brandId));
  register("quality:status", (_event, payload) => { const input = z.object({ contentType: z.enum(["article", "article_variant"]), contentId: idSchema }).parse(payload); return repository.getContentQualityState(input.contentType, input.contentId); });
  register("quality:history", (_event, payload) => { const input = z.object({ contentType: z.enum(["article", "article_variant"]), contentId: idSchema }).parse(payload); return { reviews: repository.listContentQualityReviews(input.contentType, input.contentId), audits: repository.listContentQualityAudits(input.contentType, input.contentId) }; });
  register("quality:recheck", (_event, payload) => { const input = z.object({ contentType: z.enum(["article", "article_variant"]), contentId: idSchema }).parse(payload); return runQualityGate(repository, input.contentType, input.contentId, "manual_recheck"); });
  register("quality:decide", (_event, payload) => { const input = z.object({ contentType: z.enum(["article", "article_variant"]), contentId: idSchema, status: z.enum(["Approved", "Rejected"]), reason: z.string().max(500).optional() }).parse(payload); return repository.decideContentQuality(input.contentType, input.contentId, input.status, "human-review", "manual", input.reason ?? (input.status === "Approved" ? "人工审核批准" : "人工审核驳回")); });
  register("human-review:dataset", () => repository.ensureHumanReviewDataset(HUMAN_REVIEW_DATASET_ID, HUMAN_REVIEW_BENCHMARK_RUN_ID));
  register("human-review:item", (_event, payload) => repository.getHumanReviewDatasetItem(z.object({ id: idSchema }).parse(payload).id));
  register("human-review:submit", (_event, payload) => repository.submitHumanReview(humanReviewSubmitSchema.parse(payload) as HumanReviewSubmitInput));
  register("quality-benchmark:run", async (_event, payload) => {
    const input = z.object({ brandId: idSchema, benchmarkId: z.string().min(1).max(100), datasetVersion: z.string().min(1).max(100), promptVersion: z.string().min(1).max(100), runType: z.enum(["MOCK_BASELINE", "DEEPSEEK_REAL"]), topics: z.array(z.object({ index: z.number().int().min(0).max(19), title: z.string().min(1), city: z.string().min(1), keyword: z.string().min(1), business: z.string().min(1) })).length(20), platforms: z.array(z.enum(CONTENT_STUDIO_PLATFORM_KEYS)).length(6), benchmarkRunId: z.string().min(1).optional(), concurrency: z.number().int().min(1).max(5).optional(), retryFailed: z.boolean().optional() }).parse(payload);
    const providerHint = input.runType === "DEEPSEEK_REAL" ? "deepseek" : "mock";
    const modelHint = input.runType === "DEEPSEEK_REAL" ? settingString(repository, "deepseekModel", "deepseek-v4-flash") : "mock-editor-v0.1";
    return runQualityBenchmark(repository, logger, { createAiProvider: () => input.runType === "MOCK_BASELINE" ? new MockAIProvider() : createAiProvider(repository, aiCredentials, logger) }, { ...input, providerHint, modelHint, temperature: settingNumber(repository, "temperature", 0.7), maxTokens: settingNumber(repository, "maxOutputTokens", 3000) });
  });
  register("quality-benchmark:control", (_event, payload) => { const input = z.object({ runId: idSchema, status: z.enum(["RUNNING", "PAUSED", "CANCELLED"]) }).parse(payload); return repository.setQualityBenchmarkControl(input.runId, input.status); });

  register("platforms:list", () => listPlatformViews());
  register("platforms:open", async (_event, payload) => { const input = z.object({ platformKey: idSchema }).parse(payload); const platform = repository.listPlatforms().find((item) => item.platformKey === input.platformKey); if (!platform?.officialWebsite) throw new Error("平台没有可打开的官方入口"); createUserAction("OPEN_BACKEND"); await shell.openExternal(platform.officialWebsite); return { opened: true }; });
  register("accounts:list", () => { recordRuntimeHeartbeat(logger, "accounts:list"); return repository.listAccounts(); });
  register("accounts:session-heartbeat", (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, phase: z.enum(["POST_LOGIN_IMMEDIATE", "POST_LOGIN_SURVIVAL", "PRE_CHECK_LOGIN", "POST_CHECK_LOGIN", "PRE_SUBMIT_GATE_PRECHECK", "POST_SUBMIT_GATE", "MANUAL"]).optional(), heartbeatSequence: z.string().min(1).max(200).optional(), loginGeneration: z.number().int().min(0).optional() }).parse(payload);
    const account = repository.listAccounts().find((item) => item.id === input.accountId && item.platformKey === input.platformKey);
    if (!account) throw new Error("账号与平台不匹配");
    const adapter = registry.tryGetForConnection(input.platformKey);
    if (!adapter || !isAutomationAdapter(adapter) || !adapter.getBrowserRuntimeSnapshot) throw new Error("该平台没有可读取的 BrowserSession runtime snapshot");
    recordRuntimeHeartbeat(logger, "accounts:session-heartbeat");
    const snapshot = adapter.getBrowserRuntimeSnapshot(accountContext(account.id, account.platformKey));
    logger.info("ACCOUNT", "CANONICAL_SESSION_HEARTBEAT", "只读读取 account-scoped BrowserSession live objects", { phase: input.phase ?? "MANUAL", heartbeatSequence: input.heartbeatSequence ?? randomUUID(), loginGeneration: input.loginGeneration ?? null, ...snapshot });
    return snapshot;
  });
  register("accounts:pre-submit-gate", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    if (!isAutomationAdapter(adapter) || !adapter.inspectPublishEditor) throw new Error("该平台没有 side-effect-free 编辑器 Gate 能力");
    return adapter.inspectPublishEditor(accountContext(input.accountId, input.platformKey, createUserAction("PRE_SUBMIT_GATE")));
  });
  register("accounts:editor-load-diagnostic", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: z.literal("xiaohongshu") }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    if (!isAutomationAdapter(adapter) || typeof (adapter as AutomationAdapter & { inspectEditorLoad?: unknown }).inspectEditorLoad !== "function") throw new Error("小红书没有可用的 editor load diagnostic 能力");
    const loadDiagnosticAdapter = adapter as AutomationAdapter & { inspectEditorLoad: (ctx: AccountContext) => Promise<XhsEditorLoadDiagnosticResult> };
    return loadDiagnosticAdapter.inspectEditorLoad(accountContext(input.accountId, input.platformKey, createUserAction("PRE_SUBMIT_GATE")));
  });
  register("accounts:editor-network-diagnostic", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: z.literal("xiaohongshu") }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    if (!isAutomationAdapter(adapter) || typeof (adapter as AutomationAdapter & { inspectEditorNetworkFailure?: unknown }).inspectEditorNetworkFailure !== "function") throw new Error("小红书没有可用的 editor network diagnostic 能力");
    const networkDiagnosticAdapter = adapter as AutomationAdapter & { inspectEditorNetworkFailure: (ctx: AccountContext) => Promise<XhsEditorNetworkDiagnosticResult> };
    return networkDiagnosticAdapter.inspectEditorNetworkFailure(accountContext(input.accountId, input.platformKey, createUserAction("PRE_SUBMIT_GATE")));
  });
  const readCredentialStatus = (accountId: string, platformKey: string): { configured: boolean; expired: boolean; fields: Array<CredentialField & { configured: boolean }> } => {
    const account = repository.listAccounts().find((item) => item.id === accountId);
    if (!account || account.platformKey !== platformKey) throw new Error("账号与平台不匹配");
    const adapter = registry.tryGet(platformKey);
    if (!adapter) return { configured: false, expired: account.loginStatus === "expired", fields: [] };
    const fields = adapter.getCredentialSchema().map((field) => ({ ...field, configured: field.type === "browser_login" && adapter.manifest.transport === "browser" ? credentials.has(browserSessionCredentialKey({ platformKey, accountId })) : credentials.has(`account:${accountId}:${platformKey}:${field.key}`) }));
    return { configured: fields.filter((field) => field.required).every((field) => field.configured), expired: account.loginStatus === "expired", fields };
  };
  register("accounts:overview", () => {
    const platforms = listPlatformViews();
    const records = repository.getPublishRecords();
    const lastDryRunAt = new Map<string, string>();
    for (const record of records) {
      if (!(record.dryRun === true || record.status === "DryRun") || !record.success) continue;
      const key = `${record.accountId}:${record.platformKey}`;
      if (!lastDryRunAt.has(key)) lastDryRunAt.set(key, record.publishedAt);
    }
    return repository.listAccounts().map((account) => {
      const registeredAdapter = registry.tryGetForConnection(account.platformKey);
      const browserConnecting = registeredAdapter ? isAutomationAdapter(registeredAdapter) && registeredAdapter.isConnectionPending(accountContext(account.id, account.platformKey)) : false;
      const runtimeAuthState = account.platformKey === "xiaohongshu" && registeredAdapter && isAutomationAdapter(registeredAdapter)
        ? registeredAdapter.getBrowserRuntimeState?.(accountContext(account.id, account.platformKey))?.state ?? null
        : null;
      const accountStatus: AccountStatus = account.platformKey === "xiaohongshu"
        ? runtimeAuthState === "AUTHENTICATED" ? "Connected"
          : runtimeAuthState === "CHECKING" ? "Connecting"
            : runtimeAuthState === "NEEDS_USER_ACTION" || runtimeAuthState === "DISCONNECTED" ? "NeedsLogin"
              : account.loginStatus === "logged_in" ? "Unverified"
                : account.loginStatus === "expired" ? "Expired"
                  : account.loginStatus === "needs_user_action" ? (browserConnecting || oauthSessions.isPending(account.id, account.platformKey)) ? "Connecting" : "NeedsLogin"
                    : account.loginStatus === "unknown" ? "Error" : "NotConnected"
        : account.loginStatus === "logged_in" ? "Connected" : account.loginStatus === "expired" ? "Expired" : account.loginStatus === "needs_user_action" ? (browserConnecting || oauthSessions.isPending(account.id, account.platformKey)) ? "Connecting" : "NeedsLogin" : account.loginStatus === "unknown" ? "Error" : "NotConnected";
      return {
      account,
      platform: platforms.find((item) => item.platformKey === account.platformKey) ?? null,
      credentialStatus: readCredentialStatus(account.id, account.platformKey),
      lastDryRunAt: lastDryRunAt.get(`${account.id}:${account.platformKey}`) ?? null,
      accountStatus,
      runtimeAuthState,
      authorizationStatus: repository.getAccountAuthorization(account.id, account.platformKey)?.status ?? (account.loginStatus === "logged_in" ? "Authorized" : "Unknown"),
      authorizationScopes: repository.getAccountAuthorization(account.id, account.platformKey)?.scopes ?? [],
      authorizationExpiresAt: repository.getAccountAuthorization(account.id, account.platformKey)?.expiresAt ?? null,
      providerAccountId: repository.getAccountAuthorization(account.id, account.platformKey)?.providerAccountId ?? null,
      providerAccountName: repository.getAccountAuthorization(account.id, account.platformKey)?.providerAccountName ?? null,
      publishVerification: (() => {
        const accountRecords = records.filter((record) => record.accountId === account.id && record.platformKey === account.platformKey && record.success);
        if (accountRecords.some((record) => !record.dryRun && record.status === "Published" && Boolean(record.publishedExternalId && record.publishedUrl))) return "PublishPassed" as const;
        if (accountRecords.some((record) => record.dryRun || record.status === "DryRun")) return "DryRunPassed" as const;
        return "NotTested" as const;
      })(),
      connectionStage: (() => {
        const accountRecords = records.filter((record) => record.accountId === account.id && record.platformKey === account.platformKey && record.success);
        if (accountRecords.some((record) => !record.dryRun && record.status === "Published" && Boolean(record.publishedExternalId && record.publishedUrl))) return "PublishPassed" as const;
        if (accountRecords.some((record) => record.dryRun || record.status === "DryRun")) return "PublishReady" as const;
        if (accountStatus === "Connected") return "ConnectionPassed" as const;
        if (["expired", "needs_user_action"].includes(account.loginStatus)) return "NeedsAttention" as const;
        return readCredentialStatus(account.id, account.platformKey).configured ? "CredentialConfigured" as const : "NotConfigured" as const;
      })()
      };
    });
  });
  register("accounts:create", (_event, payload) => repository.createAccount(z.object({ platformKey: idSchema, name: z.string().min(1), accountAlias: z.string().trim().min(1).max(100).optional(), allowAutoPublish: z.boolean().optional(), publishMode: z.enum(["inherit", "manual", "auto", "assisted"]).optional() }).parse(payload)));
  register("accounts:update", (_event, payload) => { const input = z.object({ id: idSchema, data: z.object({ accountAlias: z.string().trim().min(1).max(100).optional(), enabled: z.boolean().optional(), loginStatus: z.enum(["logged_in", "logged_out", "expired", "needs_user_action", "unknown"]).optional(), pausedReason: z.string().nullable().optional(), allowAutoPublish: z.boolean().optional(), publishMode: z.enum(["inherit", "manual", "auto", "assisted"]).optional(), minimumIntervalSeconds: z.number().int().min(0).max(86400).optional() }) }).parse(payload); return repository.updateAccount(input.id, input.data); });
  register("accounts:set-credentials", (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, values: z.record(z.string(), z.string().max(8192)) }).parse(payload);
    accountContext(input.accountId, input.platformKey);
    const adapter = registry.get(input.platformKey);
    const allowed = new Set(adapter.getCredentialSchema().map((field) => field.key));
    for (const [key, value] of Object.entries(input.values)) {
      if (!allowed.has(key)) throw new Error(`不允许的凭据字段：${key}`);
      if (value.trim()) credentials.set(`account:${input.accountId}:${input.platformKey}:${key}`, value.trim());
    }
    const fields = adapter.getCredentialSchema().map((field) => ({ ...field, configured: credentials.has(`account:${input.accountId}:${input.platformKey}:${field.key}`) }));
    return { configured: fields.filter((field) => field.required).every((field) => field.configured), fields };
  });
  register("accounts:credential-status", (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    return readCredentialStatus(input.accountId, input.platformKey);
  });
  register("accounts:begin-login", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    const action = createUserAction("CONNECT_ACCOUNT");
    if (input.platformKey === "cnblogs") {
      const status = await adapter.checkLogin(accountContext(input.accountId, input.platformKey, action));
      if (status === "logged_in") repository.syncOfficialApiAccount({ accountId: input.accountId, platformKey: input.platformKey, lastVerifiedAt: new Date().toISOString() });
      else repository.updateAccount(input.accountId, { loginStatus: status, pausedReason: status === "expired" ? "博客园 PAT 已失效" : status === "logged_out" ? "请先配置博客园 PAT" : "博客园连接需要处理" });
      return { sessionId: `cnblogs-pat-${Date.now()}`, requiresUserAction: status !== "logged_in", opened: false, authStrategy: adapter.manifest.authStrategy, callbackStrategy: adapter.manifest.callbackStrategy, message: status === "logged_in" ? "博客园 PAT 连接验证通过" : "博客园 PAT 尚未通过连接验证" };
    }
    if (isAutomationAdapter(adapter)) {
      repository.updateAccount(input.accountId, { loginStatus: "needs_user_action", pausedReason: "等待用户在官方浏览器完成登录和安全验证" });
      try {
        return await adapter.connectAccount(accountContext(input.accountId, input.platformKey, action));
      } catch (error) {
        if (!(error instanceof BrowserRuntimeError)) throw error;
        const diagnostic = error.diagnostic;
        logger.error("BROWSER_RUNTIME", diagnostic.errorCode, "浏览器组件启动失败", { platformKey: input.platformKey, module: diagnostic.module, timestamp: diagnostic.timestamp, attemptedChannels: diagnostic.attemptedChannels });
        repository.updateAccount(input.accountId, { loginStatus: "unknown", pausedReason: "浏览器组件启动失败，请安装 Microsoft Edge 或 Google Chrome 后重试" });
        return { sessionId: `browser-runtime-error-${Date.now()}`, requiresUserAction: false, opened: false, authStrategy: adapter.manifest.authStrategy, callbackStrategy: adapter.manifest.callbackStrategy, message: error.message, diagnostic };
      }
    }
    return oauthSessions.begin(input.accountId, input.platformKey, action);
  });
  register("accounts:complete-login", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, callbackUrl: z.string().max(8192), pendingLogin: z.object({ accountId: idSchema, platformKey: idSchema }).optional() }).parse(payload);
    const action = createUserAction("CONNECT_ACCOUNT");
    logger.info("ACCOUNT", "COMPLETE_LOGIN_REQUEST", "收到 Renderer 完成登录请求", { platformKey: input.platformKey, accountId: input.accountId, userActionId: action.userActionId, pendingLogin: input.pendingLogin ?? null, timestamp: new Date().toISOString() });
    if (input.pendingLogin && (input.pendingLogin.accountId !== input.accountId || input.pendingLogin.platformKey !== input.platformKey)) {
      logger.warn("ACCOUNT", "COMPLETE_LOGIN_ACCOUNT_ID_MISMATCH", "Renderer pendingLogin 与 IPC 请求不一致，已停止 Adapter 调查", { requestedAccountId: input.accountId, requestedPlatformKey: input.platformKey, pendingLoginAccountId: input.pendingLogin.accountId, pendingLoginPlatformKey: input.pendingLogin.platformKey, userActionId: action.userActionId });
      logger.info("ACCOUNT", "COMPLETE_CONNECTION_ENTERED", "Adapter 未进入：Renderer accountId mismatch", { entered: false, accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId });
      throw new Error("COMPLETE_LOGIN_ACCOUNT_ID_MISMATCH: Renderer pendingLogin 与请求账号不一致");
    }
    const adapter = registry.getForConnection(input.platformKey);
    if (input.platformKey === "xiaohongshu") platformSelfTests.invalidateXhsContextIdentityAttestation(input.accountId);
    if (isAutomationAdapter(adapter)) {
      const completedContext = accountContext(input.accountId, input.platformKey, action);
      const debugState = adapter.getBrowserConnectionDebugState?.(completedContext);
      logger.info("ACCOUNT", "ACTIVE_LOGIN_SESSION_STATE", "complete-login 调用 Adapter 前的 active Session 状态", { timestamp: new Date().toISOString(), ...(debugState ?? { requestedAccountId: input.accountId, activeSessionKeys: [], targetSessionFound: false, targetSessionState: "MISSING" }) });
      logger.info("ACCOUNT", "COMPLETE_CONNECTION_ENTERED", "即将调用 Adapter.completeConnection", { entered: true, accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, targetSessionFound: debugState?.targetSessionFound ?? false });
      let status: Awaited<ReturnType<typeof adapter.completeConnection>>;
      try {
        status = await adapter.completeConnection(completedContext);
      } catch (error) {
        logger.warn("ACCOUNT", "COMPLETE_LOGIN_RESPONSE", "Adapter.completeConnection 返回错误", { accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, status: null, reason: error instanceof Error ? error.message.slice(0, 300) : "unknown", errorCode: safeErrorCode(error) });
        throw error;
      }
      if (status !== "logged_in") {
        repository.updateAccount(input.accountId, { loginStatus: "needs_user_action", pausedReason: "浏览器仍停留在登录或安全验证页面" });
        const result = { configured: false, accountStatus: "NeedsLogin" as const, authorizationStatus: "Unknown" as const, accountId: null, accountName: null, scopes: [], expiresAt: null };
        logger.info("ACCOUNT", "COMPLETE_LOGIN_RESPONSE", "主进程完成登录结果", { accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, status, reason: "CHECK_LOGIN_NOT_PASSED", errorCode: null, resultContract: { configured: result.configured, accountStatus: result.accountStatus, authorizationStatus: result.authorizationStatus } });
        return result;
      }
      let identityProof: CreatorIdentityVerificationResult | null = null;
      if (input.platformKey === "xiaohongshu") {
        identityProof = await platformSelfTests.bootstrapXhsCreatorIdentity(input.accountId);
        logger.info("ACCOUNT", "COMPLETE_LOGIN_IDENTITY_PROOF", "complete-login 已复用 Task10W canonical Creator 身份证明", {
          accountId: input.accountId,
          platformKey: input.platformKey,
          userActionId: action.userActionId,
          canonicalContextId: identityProof.canonicalContextId,
          canonicalPageId: identityProof.canonicalPageId,
          expectedCreatorId: identityProof.expectedExternalCreatorId,
          observedCreatorId: identityProof.observed.externalCreatorId,
          verified: identityProof.verified,
          mismatch: identityProof.mismatch,
          pageUrlConsistency: identityProof.pageUrlConsistency,
          routeClass: identityProof.routeClass
        });
        if (!identityProof.verified) throw Object.assign(new Error("ACCOUNT_IDENTITY_UNVERIFIED: complete-login 的 Creator 身份证明未通过"), { code: "ACCOUNT_IDENTITY_UNVERIFIED" });
      }
      const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(completedContext) : undefined;
      if (input.platformKey === "xiaohongshu" && identityProof && profile?.accountId && profile.accountId !== identityProof.observed.externalCreatorId) {
        throw Object.assign(new Error("小红书 Adapter profile Creator ID 与已证明身份不一致，拒绝回写"), { code: "XHS_CREATOR_IDENTITY_MISMATCH" });
      }
      const archivedAccount = profile?.accountId ? repository.findArchivedAccountByExternalIdForConnection(input.accountId, input.platformKey, profile.accountId) : null;
      const effectiveAccountId = archivedAccount?.id ?? input.accountId;
      const effectiveContext = effectiveAccountId === input.accountId ? completedContext : accountContext(effectiveAccountId, input.platformKey, action, true);
      if (archivedAccount) {
        if (!adapter.rebindAccountSession) throw new Error("无法安全恢复归档账号：Adapter 不支持 Session 重绑定");
        repository.restoreArchivedAccountByExternalId(input.platformKey, profile?.accountId ?? "");
        if (input.platformKey === "xiaohongshu") platformSelfTests.invalidateXhsContextIdentityAttestation(effectiveAccountId);
        adapter.rebindAccountSession(completedContext, effectiveContext);
      }
      await adapter.persistConnectionSession?.(effectiveContext);
      const account = await syncBrowserAccount(adapter, effectiveAccountId, input.platformKey, action, profile);
      if (archivedAccount) repository.markPlatformAccountDisconnected(input.accountId, input.platformKey, adapter.manifest.authStrategy);
      const sessionEvidence = await adapter.getBrowserSessionEvidence?.(effectiveContext);
      if (adapter.releaseConnectionPage) await adapter.releaseConnectionPage(effectiveContext);
      else await adapter.releaseConnectionSession?.(effectiveContext);
      logger.info("ACCOUNT", "LOGIN_SUCCEEDED", "平台登录成功，Session 已安全保存，身份已回写，登录资源已释放", { accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, sessionEvidence: sessionEvidence ?? null });
      const result = browserAccountConnectionResult(account);
      logger.info("ACCOUNT", "COMPLETE_LOGIN_RESPONSE", "主进程完成登录结果", { accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, status, reason: null, errorCode: null, resultContract: { configured: result.configured, accountStatus: result.accountStatus, authorizationStatus: result.authorizationStatus } });
      return result;
    }
    logger.info("ACCOUNT", "COMPLETE_CONNECTION_ENTERED", "Adapter 未进入：当前平台走 OAuth completion", { entered: false, accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId });
    const result = await oauthSessions.complete(input.accountId, input.platformKey, input.callbackUrl);
    logger.info("ACCOUNT", "COMPLETE_LOGIN_RESPONSE", "主进程 OAuth 完成登录结果", { accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, status: "logged_in", reason: null, errorCode: null, resultContract: { configured: result.configured, accountStatus: result.accountStatus, authorizationStatus: result.authorizationStatus } });
    return result;
  });
  register("accounts:refresh-login", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    const action = createUserAction("CONNECT_ACCOUNT");
    if (isAutomationAdapter(adapter)) {
      const status = await adapter.checkSession(accountContext(input.accountId, input.platformKey, action));
      if (status !== "logged_in") throw new Error("浏览器 Session 仍需用户完成登录");
      await syncBrowserAccount(adapter, input.accountId, input.platformKey, action);
      return { accountStatus: "Connected" as const, authorizationStatus: "Authorized" as const, expiresAt: null };
    }
    return oauthSessions.refresh(input.accountId, input.platformKey);
  });
  register("accounts:cancel-login", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    if (!isAutomationAdapter(adapter) || !adapter.cancelConnection) throw new Error("该平台没有可取消的浏览器连接会话");
    await adapter.cancelConnection(accountContext(input.accountId, input.platformKey, createUserAction("CONNECT_ACCOUNT")));
    repository.updateAccount(input.accountId, { loginStatus: "logged_out", pausedReason: "连接已取消" });
    return { loginStatus: "logged_out" as const };
  });
  register("accounts:disconnect", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const account = repository.getAccountById(input.accountId, input.platformKey);
    if (!account) throw new Error("账号与平台不匹配");
    const adapter = registry.getForConnection(input.platformKey);
    const action = createUserAction("CONNECT_ACCOUNT");
    let result: AccountDisconnectResult;
    if (isAutomationAdapter(adapter)) {
      const context = accountContext(input.accountId, input.platformKey, action, true);
      const activeSession = adapter.getBrowserConnectionDebugState?.(context)?.targetSessionFound ?? false;
      result = browserAccountDisconnectResult({ loginStatus: account.loginStatus, credentialPresent: credentials.has(browserSessionCredentialKey({ platformKey: input.platformKey, accountId: input.accountId })), activeSession, archived: account.archivedAt != null });
      await adapter.logout(context);
      repository.markPlatformAccountDisconnected(input.accountId, input.platformKey, adapter.manifest.authStrategy);
    }
    else if (input.platformKey === "cnblogs") {
      const credentialPresent = adapter.getCredentialSchema().some((field) => credentials.has(`account:${input.accountId}:${input.platformKey}:${field.key}`));
      for (const field of adapter.getCredentialSchema()) credentials.delete(`account:${input.accountId}:${input.platformKey}:${field.key}`);
      result = browserAccountDisconnectResult({ loginStatus: account.loginStatus, credentialPresent, activeSession: false, archived: account.archivedAt != null });
      repository.markPlatformAccountDisconnected(input.accountId, input.platformKey, adapter.manifest.authStrategy);
    } else {
      result = browserAccountDisconnectResult({ loginStatus: account.loginStatus, credentialPresent: false, activeSession: false, archived: account.archivedAt != null });
      oauthSessions.disconnect(input.accountId, input.platformKey);
      repository.markPlatformAccountDisconnected(input.accountId, input.platformKey, adapter.manifest.authStrategy);
    }
    logger.info("ACCOUNT", "DISCONNECT_RESULT", "账号本地连接已断开并从活动账号中心移除", { accountId: input.accountId, platformKey: input.platformKey, outcome: result.outcome, accountRowArchived: true });
    return result;
  });
  register("accounts:open-backend", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    if (!isAutomationAdapter(adapter)) throw new Error("该平台没有浏览器后台操作能力");
    const result = await adapter.openBackend(accountContext(input.accountId, input.platformKey, createUserAction("OPEN_BACKEND")));
    repository.markAccountUsed(input.accountId);
    return result;
  });
  register("accounts:check-login", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const action = createUserAction("CHECK_LOGIN");
    const adapter = registry.getForConnection(input.platformKey);
    const consumeCheckLoginOperationId = (): string | null => {
      if (input.platformKey !== "xiaohongshu") return null;
      const diagnosticAdapter = adapter as unknown as { consumeCompletedCheckLoginOperationId?: (accountId: string) => string | null };
      return diagnosticAdapter.consumeCompletedCheckLoginOperationId?.(input.accountId) ?? null;
    };
    let operationId: string | null = null;
    try {
      const status = await adapter.checkLogin(accountContext(input.accountId, input.platformKey, action));
      operationId = consumeCheckLoginOperationId();
      if (status === "logged_in" && isAutomationAdapter(adapter)) {
        await syncBrowserAccount(adapter, input.accountId, input.platformKey, action);
      }
      else if (status === "logged_in" && input.platformKey === "cnblogs") {
        const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(accountContext(input.accountId, input.platformKey, action)) : undefined;
        repository.syncOfficialApiAccount({ accountId: input.accountId, platformKey: input.platformKey, accountName: profile?.accountName, externalAccountId: profile?.accountId, lastVerifiedAt: new Date().toISOString() });
      }
      else repository.updateAccount(input.accountId, { loginStatus: status, pausedReason: status === "expired" ? "平台登录已过期，需要重新授权" : status === "needs_user_action" ? "等待用户完成平台正常验证" : null });
      const authorization = repository.getAccountAuthorization(input.accountId, input.platformKey);
      if (status === "logged_in") repository.upsertAccountAuthorization({ accountId: input.accountId, platformKey: input.platformKey, authorizationType: adapter.manifest.authStrategy, status: authorization?.status === "Partial" ? "Partial" : "Authorized", scopes: authorization?.scopes ?? [], expiresAt: authorization?.expiresAt, providerAccountId: authorization?.providerAccountId, providerAccountName: authorization?.providerAccountName });
      if (status === "logged_out") repository.upsertAccountAuthorization({ accountId: input.accountId, platformKey: input.platformKey, authorizationType: adapter.manifest.authStrategy, status: "NotAuthorized" });
      if (status === "expired") repository.upsertAccountAuthorization({ accountId: input.accountId, platformKey: input.platformKey, authorizationType: adapter.manifest.authStrategy, status: "Revoked", scopes: authorization?.scopes ?? [] });
      logger.info("ACCOUNT", "CONNECTION_TEST", "平台连接测试完成；未修改平台生命周期", { accountId: input.accountId, platformKey: input.platformKey, loginStatus: status, operationId });
      return { loginStatus: status };
    } catch (error) {
      operationId ??= consumeCheckLoginOperationId();
      logger.warn("ACCOUNT", "CONNECTION_TEST_FAILED", "平台连接测试失败；未修改平台生命周期", { accountId: input.accountId, platformKey: input.platformKey, errorType: error instanceof Error ? error.name : "UnknownError", operationId });
      throw error;
    }
  });
  register("platform-self-test:list", () => platformSelfTests.listAccounts());
  register("platform-self-test:get", (_event, payload) => repository.getPlatformSelfTestRun(z.object({ testRunId: idSchema }).parse(payload).testRunId));
  register("platform-self-test:run-safe", async (_event, payload) => platformSelfTests.runSafe(z.object({ platformAccountId: idSchema }).parse(payload).platformAccountId));
  register("platform-self-test:run-post-upload-discovery", async (_event, payload) => { const input = z.object({ platformAccountId: idSchema, mode: z.literal("POST_UPLOAD_DISCOVERY_ONLY") }).parse(payload); return platformSelfTests.runPostUploadDiscovery(input.platformAccountId, input.mode); });
  register("platform-self-test:run-publish-flow-exploration", async (_event, payload) => { const input = z.object({ platformAccountId: idSchema, mode: z.literal("XHS_PUBLISH_FLOW_EXPLORATION") }).parse(payload); return platformSelfTests.runPublishFlowExploration(input.platformAccountId, input.mode); });
  register("platform-self-test:continue", async (_event, payload) => platformSelfTests.continue(z.object({ testRunId: idSchema }).parse(payload).testRunId));
  register("platform-self-test:run-level", async (_event, payload) => { const input = z.object({ platformAccountId: idSchema, level: z.enum(["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT", "L5_PUBLISH"]) }).parse(payload); return platformSelfTests.runLevel(input.platformAccountId, input.level); });
  register("platform-self-test:health-check", async () => platformSelfTests.healthCheckConnectedAccounts());
  register("platform-self-test:request-publish", (_event, payload) => platformSelfTests.requestPublish(z.object({ platformAccountId: idSchema }).parse(payload).platformAccountId));
  register("platform-self-test:confirm-publish", async (_event, payload) => { const input = z.object({ testRunId: idSchema, testVideoPath: z.string().max(8192).optional() }).parse(payload); return platformSelfTests.confirmPublish(input.testRunId, input.testVideoPath); });
  register("platform-self-test:cancel-publish", (_event, payload) => platformSelfTests.cancelPublish(z.object({ testRunId: idSchema }).parse(payload).testRunId));
  register("platform-self-test:request-one-shot-publish", (_event, payload) => platformSelfTests.requestOneShotPublish(z.object({ platformAccountId: idSchema }).parse(payload).platformAccountId));
  register("platform-self-test:prepare-one-shot-prepublish", async (_event, payload) => platformSelfTests.prepareOneShotPrepublish(z.object({ testRunId: idSchema }).parse(payload).testRunId));
  register("platform-self-test:confirm-one-shot-publish", async (_event, payload) => {
    const input = z.object({ testRunId: idSchema }).parse(payload);
    const run = repository.getPlatformSelfTestRun(input.testRunId);
    const account = run ? repository.listAccounts().find((item) => (item.platformAccountId ?? item.id) === run.platformAccountId && item.platformKey === run.platformKey) : undefined;
    logger.info("PLATFORM_SELF_TEST", "CONFIRM_IPC_ATTEMPT", "收到一次性发布确认 IPC 请求", {
      testRunId: input.testRunId,
      operationId: input.testRunId,
      platformKey: run?.platformKey,
      accountId: account?.id,
      platformAccountId: run?.platformAccountId,
      channel: "platform-self-test:confirm-one-shot-publish"
    });
    return platformSelfTests.confirmOneShotPublish(input.testRunId);
  });
  register("platform-self-test:cancel-one-shot-publish", (_event, payload) => platformSelfTests.cancelOneShotPublish(z.object({ testRunId: idSchema }).parse(payload).testRunId));
  register("platform-self-test:reconcile-failed-one-shot-confirmation", (_event, payload) => {
    const input = z.object({ testRunId: idSchema, platformKey: z.literal("xiaohongshu"), accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "PARTIAL_CONFIRM_RECONCILIATION_IPC_ATTEMPT", "收到指定一次性确认 partial state reconciliation 请求", { testRunId: input.testRunId, platformKey: input.platformKey, accountId: input.accountId, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
    return platformSelfTests.reconcileFailedOneShotConfirmation(input);
  });
  register("platform-self-test:verify-xhs-creator-identity", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_CREATOR_IDENTITY_PROOF_STARTED", "开始只读读取现有 canonical Page 的小红书 Creator 身份", { platformKey: "xiaohongshu", accountId: input.accountId });
    return platformSelfTests.verifyXhsCreatorIdentity(input.accountId);
  });
  register("platform-self-test:probe-xhs-canonical-page", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_CANONICAL_PAGE_RUNTIME_PROBE_STARTED", "开始只读读取现有小红书 canonical Page runtime", { platformKey: "xiaohongshu", accountId: input.accountId });
    return platformSelfTests.inspectCanonicalXhsPageRuntime(input.accountId);
  });
  register("platform-self-test:inspect-current-xhs-image-editor-readiness", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_CURRENT_IMAGE_EDITOR_READINESS_STARTED", "开始只读读取现有 retained canonical Page 的小红书图文编辑器 readiness", { platformKey: "xiaohongshu", accountId: input.accountId });
    return platformSelfTests.inspectCurrentXiaohongshuImageEditorReadiness(input.accountId);
  });
  register("platform-self-test:inspect-current-xhs-publish-editor-dom", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_EDITOR_DOM_DIAGNOSTIC_STARTED", "开始只读读取现有 canonical XHS publish editor bounded DOM", { platformKey: "xiaohongshu", accountId: input.accountId });
    return platformSelfTests.inspectCurrentXiaohongshuPublishEditorDom(input.accountId);
  });
  register("platform-self-test:inspect-current-xhs-publish-editor-semantic-candidates", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_EDITOR_SEMANTIC_DIAGNOSTIC_STARTED", "开始只读读取现有 canonical XHS publish editor semantic candidates", { platformKey: "xiaohongshu", accountId: input.accountId });
    return platformSelfTests.inspectCurrentXiaohongshuPublishEditorSemanticCandidates(input.accountId);
  });
  register("platform-self-test:inspect-current-xhs-post-upload-reconciliation", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_POST_UPLOAD_RECONCILIATION_STARTED", "开始只读读取现有 retained canonical XHS post-upload editor reconciliation", { platformKey: "xiaohongshu", accountId: input.accountId });
    return platformSelfTests.inspectCurrentXiaohongshuPostUploadReconciliation(input.accountId);
  });
  register("platform-self-test:inspect-current-xhs-file-input-state", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_FILE_INPUT_STATE_STARTED", "开始只读读取现有 retained canonical XHS file-input state", { platformKey: "xiaohongshu", accountId: input.accountId });
    return platformSelfTests.inspectCurrentXiaohongshuFileInputState(input.accountId);
  });
  register("platform-self-test:verify-and-converge-xhs-identity", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, ownerApproved: z.boolean().optional() }).parse(payload);
    logger.info("PLATFORM_SELF_TEST", "XHS_IDENTITY_CONVERGENCE_STARTED", "开始小红书 Creator 身份证明与未消费一次性授权收敛", { platformKey: "xiaohongshu", accountId: input.accountId, ownerApproved: input.ownerApproved === true });
    return platformSelfTests.verifyAndConvergeXhsIdentity(input.accountId, input.ownerApproved === true);
  });
  register("platform-self-test:confirm-delete", async (_event, payload) => platformSelfTests.confirmDelete(z.object({ testRunId: idSchema }).parse(payload).testRunId));

  register("plans:list", () => repository.listPlans());
  register("plans:create", (_event, payload) => repository.createPlan(z.object({ id: z.string().optional(), name: z.string().min(1), brandId: idSchema, enabled: z.boolean(), strategy: z.enum(["same_article", "per_platform", "platform_variant", "topic_rewrite", "account_variant"]), articlesPerDay: z.number().int().min(1).max(100), accountIds: z.array(idSchema), publishTimes: z.array(z.string()), reusePolicy: z.enum(["once", "same_platform", "same_platform_different_account", "always", "rewrite"]), minIntervalSeconds: z.number().int().min(0), maxRetries: z.number().int().min(0).max(10), consecutiveFailureThreshold: z.number().int().min(1).max(20), startDate: z.string(), endDate: z.string().nullable() }).omit({ id: true }).parse(payload)));
  register("plans:generate-jobs", (_event, payload) => { const input = z.object({ id: idSchema, scheduledAt: z.string() }).parse(payload); const blockers = repository.validatePlanContentQuality(input.id); if (blockers.length > 0) throw Object.assign(new Error(`Quality Gate blocked publishing: ${blockers.length} content item(s) are not Approved`), { code: "CONTENT_REJECTED", blockers }); return repository.createJobsForPlan(input.id, input.scheduledAt); });
  register("jobs:create-video", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, articleId: idSchema, videoAssetId: idSchema, scheduledAt: z.string().datetime().optional() }).parse(payload);
    const account = repository.listAccounts().find((item) => item.id === input.accountId);
    const article = repository.getArticle(input.articleId);
    const asset = repository.getManagedVideoAsset(input.videoAssetId);
    if (!repository.isContentApproved("article", input.articleId, article?.contentHash ?? "")) throw Object.assign(new Error("Quality Gate blocked video publishing: article is not Approved"), { code: "CONTENT_REJECTED" });
    if (!account || account.platformKey !== input.platformKey) throw new Error("账号与平台不匹配");
    if (!article) throw new Error("文章不存在");
    if (!asset) throw new Error("视频素材不存在");
    if (asset.brandId && asset.brandId !== article.brandId) throw new Error("视频素材与文章品牌不匹配");
    const result = await validateVideoAsset(input.videoAssetId, input.platformKey);
    if (!result.validation.valid) throw Object.assign(new Error(result.validation.errors.join("；")), { code: "CONTENT_REJECTED" });
    return repository.createVideoPublishJob({ accountId: input.accountId, platformKey: input.platformKey, articleId: input.articleId, videoAssetId: input.videoAssetId, title: asset.title, description: asset.description, tags: asset.tags, coverPath: asset.coverPath ?? undefined, platformFields: asset.platformFields, scheduledAt: input.scheduledAt ?? new Date().toISOString(), dryRun: true, manualConfirmationRequired: true });
  });
  register("jobs:list", (_event, payload) => repository.listJobs(z.object({ status: z.string().optional() }).optional().parse(payload)));
  register("jobs:run", async (_event, payload) => { const id = z.object({ id: idSchema }).parse(payload).id; const job = repository.getJob(id); const source = job && ["NeedsUserAction", "WaitingForUser"].includes(job.status) ? "CONTINUE_PENDING_ACTION" as const : "START_PUBLISH" as const; return publisher.executeJob(id, createUserAction(source)); });
  register("jobs:confirm", (_event, payload) => { const input = z.object({ id: idSchema, dryRun: z.boolean().default(false) }).parse(payload); return repository.confirmJob(input.id, input.dryRun); });
  register("jobs:reconcile", async (_event, payload) => publisher.reconcileJob(z.object({ id: idSchema }).parse(payload).id, createUserAction("CONTINUE_PENDING_ACTION")));
  register("jobs:reconcile-browser", async (_event, payload) => publisher.reconcileBrowserJob(z.object({ id: idSchema }).parse(payload).id, createUserAction("CONTINUE_PENDING_ACTION")));
  register("jobs:reconcile-not-submitted", (_event, payload) => repository.markJobReconciledNotSubmitted(z.object({ id: idSchema }).parse(payload).id));
  register("jobs:retry", (_event, payload) => { const id = z.object({ id: idSchema }).parse(payload).id; return repository.updateJobFailure(id, "Retry", "UNKNOWN", "用户手动重试", new Date().toISOString()); });
  register("jobs:recover", () => repository.recoverRunningJobs());
  register("logs:list", (_event, payload) => { const input = z.object({ limit: z.number().int().min(1).max(500).optional(), level: z.string().optional(), module: z.string().optional(), search: z.string().optional() }).optional().parse(payload); return repository.listLogs(input?.limit, input); });
  register("logs:export", async () => { const destination = await dialog.showSaveDialog({ defaultPath: join(dataDirectory, "logs", `publisher-diagnostics-${Date.now()}.zip`), filters: [{ name: "ZIP", extensions: ["zip"] }] }); if (destination.canceled || !destination.filePath) return null; return exportLogBundle({ outputPath: destination.filePath, applicationLogPath: deps.appLogPath, errorLogPath: deps.errorLogPath, diagnostics: { settings: repository.getSettings(), stats: repository.dashboardStats(), logs: repository.listLogs(500) } }); });
  register("notifications:list", (_event, payload) => repository.listNotifications(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional().parse(payload)?.limit));
  register("notifications:read", (_event, payload) => { repository.markNotificationRead(z.object({ id: idSchema }).parse(payload).id); });
  register("notifications:read-all", () => repository.markAllNotificationsRead());
  register("platforms:profiles", () => repository.getPlatformProfiles());
  register("platforms:content-rules", () => repository.getPlatformContentRules());
  register("ai:profiles", () => { const profiles = repository.listAiProviderProfiles(); if (profiles.some((profile) => profile.provider === "deepseek")) return profiles; const profile = repository.upsertAiProviderProfile({ name: "DeepSeek 经济模式", provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", credentialRef: "ai:apiKey", temperature: 0.7, maxOutputTokens: 3000, timeoutMs: 30000, retryCount: 3, concurrency: 5, enabled: true, isDefault: profiles.length === 0, isFallback: false }); return [...profiles, profile]; });
  register("ai:profile-upsert", (_event, payload) => repository.upsertAiProviderProfile(z.object({ id: z.string().optional(), name: z.string().min(1), provider: z.string().min(1), baseUrl: z.string().url(), model: z.string().min(1), credentialRef: z.string().min(1), temperature: z.number().min(0).max(2), maxOutputTokens: z.number().int().min(128).max(32000), timeoutMs: z.number().int().min(1000).max(300000), retryCount: z.number().int().min(0).max(5), concurrency: z.number().int().min(1).max(20), enabled: z.boolean(), isDefault: z.boolean(), isFallback: z.boolean() }).parse(payload)));
  register("ai:profile-delete", (_event, payload) => repository.deleteAiProviderProfile(z.object({ id: idSchema }).parse(payload).id));
  register("settings:get", () => {
    const settings = repository.getSettings();
    const storedStatus = settings.deepseekCredentialStatus;
    const currentStatus = aiCredentials.getStatus?.("ai:apiKey") ?? (aiCredentials.has("ai:apiKey") ? "Configured" : "NotConfigured");
    const deepseekCredentialStatus = currentStatus === "DecryptFailed" ? currentStatus : currentStatus === "NotConfigured" ? currentStatus : isCredentialStatus(storedStatus) && storedStatus !== "DecryptFailed" ? storedStatus : currentStatus;
    return { ...settings, apiKeyConfigured: currentStatus !== "NotConfigured" && currentStatus !== "DecryptFailed", deepseekCredentialStatus, imageApiKeyConfigured: aiCredentials.has("image:apiKey") };
  });
  register("settings:update", (_event, payload) => {
    const input = z.object({ key: z.enum(["provider", "baseUrl", "model", "temperature", "maxOutputTokens", "timeout", "concurrency", "retry", "imageProvider", "imageBaseUrl", "imageModel", "imageSize", "defaultAiProfileId", "fallbackAiProfileId", "autoFallback", "deepseekEnabled", "deepseekBaseUrl", "deepseekModel", "deepseekGenerationMode", "deepseekInputCostPer1k", "deepseekOutputCostPer1k", "defaultPublishMode", "contentReviewMode", "favoritePlatformKeys", "browserPublishMode", "finalPublishMode", "allowImageLessPublish"]), value: z.union([z.string(), z.number(), z.boolean()]) }).parse(payload);
    repository.setSetting(input.key, input.value);
  });
  register("settings:set-secret", async (_event, payload) => {
    const input = z.object({ kind: z.enum(["apiKey", "imageApiKey"]), value: z.string().trim().min(1) }).parse(payload);
    const key = input.kind === "apiKey" ? "ai:apiKey" : "image:apiKey";
    aiCredentials.set(key, input.value);
    if (input.kind === "imageApiKey") return { configured: true, validationStatus: "Configured" as const };
    repository.setSetting("provider", "deepseek");
    repository.setSetting("deepseekEnabled", true);
    repository.setSetting("deepseekCredentialStatus", "Configured");
    repository.setSetting("deepseekCredentialLastUpdatedAt", new Date().toISOString());
    const result = await testAiConnection(repository, aiCredentials, logger);
    const validationStatus = credentialStatusFromConnection(result);
    repository.setSetting("deepseekCredentialStatus", validationStatus);
    return { configured: true, validationStatus, validationResult: result };
  });
  register("settings:test-ai", async () => {
    return testAiConnection(repository, aiCredentials, logger);
  });
  register("backups:list", () => { const dir = join(dataDirectory, "backups"); try { return readdirSync(dir).filter((name) => name.endsWith(".db")).sort().reverse().map((name) => join(dir, name)); } catch { return []; } });
  register("backups:create", async () => { const dir = join(dataDirectory, "backups"); const path = join(dir, `publisher-${new Date().toISOString().replace(/[:.]/gu, "-")}.db`); await backupDatabase(repository.db, path); return path; });
  register("backups:validate", (_event, payload) => validateDatabaseBackup(z.object({ path: z.string().min(1) }).parse(payload).path));
  register("backups:restore", (_event, payload) => { const input = z.object({ path: z.string().min(1), confirm: z.literal(true) }).parse(payload); const result = validateDatabaseBackup(input.path); if (!result.valid) throw new Error(`备份校验失败：${result.message}`); if (!deps.restoreDatabase) throw new Error("当前运行模式不支持自动恢复，请关闭应用后手动恢复"); deps.restoreDatabase(input.path); return { accepted: true }; });
  void resumeRunningBatches(repository, logger, coverDir, aiCredentials);
  void resumeContentStudioTasks(repository, logger, { createAiProvider: () => createAiProvider(repository, aiCredentials, logger) });
  void scheduler;
  return platformSelfTests;
}

function settingString(repository: AppRepository, key: string, fallback: string): string { const value = repository.getSettings()[key]; return typeof value === "string" ? value : fallback; }
function settingNumber(repository: AppRepository, key: string, fallback: number): number { const value = repository.getSettings()[key]; return typeof value === "number" ? value : typeof value === "string" ? Number(value) || fallback : fallback; }

function createAiProvider(repository: AppRepository, credentials: CredentialStore, logger?: Logger): AIProvider {
  const defaultProfileId = settingString(repository, "defaultAiProfileId", "");
  const fallbackProfileId = settingString(repository, "fallbackAiProfileId", "");
  const profile = defaultProfileId ? repository.getAiProviderProfile(defaultProfileId) : null;
  const fallbackProfile = fallbackProfileId ? repository.getAiProviderProfile(fallbackProfileId) : null;
  if (profile?.enabled) {
    const primary = createProfileProvider(profile, credentials, logger);
    if (fallbackProfile?.enabled && settingBoolean(repository, "autoFallback", false)) return new FallbackAIProvider(primary, createProfileProvider(fallbackProfile, credentials, logger));
    return primary;
  }
  const provider = settingString(repository, "provider", "mock");
  if (provider === "mock") return new MockAIProvider();
  const apiKey = credentials.get("ai:apiKey");
  if (provider === "deepseek" && !apiKey) throw new AIProviderError("AI_AUTH", "DeepSeek API Key 未配置", { provider: "deepseek" });
  if (!apiKey) throw new Error("真实 AI Provider 已选择，但 API Key 尚未配置");
  if (provider === "deepseek" && settingBoolean(repository, "deepseekEnabled", true)) return new DeepSeekProvider({ apiKey, baseUrl: settingString(repository, "deepseekBaseUrl", "https://api.deepseek.com"), model: settingString(repository, "deepseekModel", "deepseek-v4-flash"), thinking: settingString(repository, "deepseekGenerationMode", "economy") === "quality" ? "enabled" : "disabled", temperature: settingNumber(repository, "temperature", 0.7), maxOutputTokens: settingNumber(repository, "maxOutputTokens", 3000), timeoutMs: settingNumber(repository, "timeout", 30000), retryCount: settingNumber(repository, "retry", 3), inputCostPer1k: settingNumber(repository, "deepseekInputCostPer1k", 0), outputCostPer1k: settingNumber(repository, "deepseekOutputCostPer1k", 0), logger });
  if (provider === "deepseek") return new MockAIProvider();
  return new OpenAICompatibleProvider({ providerKey: provider, baseUrl: settingString(repository, "baseUrl", "https://api.openai.com/v1"), apiKey, model: settingString(repository, "model", "gpt-4o-mini"), temperature: settingNumber(repository, "temperature", 0.7), maxOutputTokens: settingNumber(repository, "maxOutputTokens", 3000), timeoutMs: settingNumber(repository, "timeout", 30000), retryCount: settingNumber(repository, "retry", 2) });
}

function settingBoolean(repository: AppRepository, key: string, fallback: boolean): boolean {
  const value = repository.getSettings()[key];
  return typeof value === "boolean" ? value : fallback;
}

function isCredentialStatus(value: unknown): value is CredentialStatus {
  return ["NotConfigured", "Configured", "DecryptFailed", "Validated", "Invalid", "ExpiredOrRejected"].includes(value as string);
}

function credentialStatusFromConnection(result: AIConnectionResult): Exclude<CredentialStatus, "NotConfigured" | "DecryptFailed"> {
  if (result.ok) return "Validated";
  if (result.diagnostic?.errorCode === "credential" || result.diagnostic?.httpStatus === 401) return "Invalid";
  if (result.diagnostic?.httpStatus === 403) return "ExpiredOrRejected";
  return "Configured";
}

async function testAiConnection(repository: AppRepository, credentials: CredentialStore, logger: Logger): Promise<AIConnectionResult> {
  const startedAt = Date.now();
  const selectedProvider = settingString(repository, "provider", "mock");
  try {
    const result = await createAiProvider(repository, credentials, logger).testConnection();
    repository.setSetting("lastTestedAt", new Date().toISOString());
    repository.setSetting("lastTestStatus", result.ok ? "success" : "failed");
    repository.setSetting("lastTestDurationMs", Date.now() - startedAt);
    if (selectedProvider === "deepseek") repository.setSetting("deepseekCredentialStatus", credentialStatusFromConnection(result));
    return result;
  } catch (error) {
    const isDecryptFailure = error instanceof CredentialDecryptError;
    const mapped = selectedProvider === "deepseek" && !isDecryptFailure ? DeepSeekErrorMapper.map(error) : { message: isDecryptFailure ? "已保存的 DeepSeek 凭据无法在当前 Windows 用户环境中解密，请重新输入 API Key。" : error instanceof Error ? error.message : "AI connection failed", code: isDecryptFailure ? "CREDENTIAL_DECRYPT_FAILED" : "unknown", retryable: false };
    const providerError = error instanceof AIProviderError ? error : undefined;
    const diagnostic = selectedProvider === "deepseek" ? makeDeepSeekDiagnostic(repository, credentials, startedAt, providerError, mapped.code) : undefined;
    logger.warn("AI", "AI_CONNECTION_TEST_FAILED", mapped.message, { provider: selectedProvider, operation: "test_connection", errorCode: mapped.code, ...(providerError?.httpStatus === undefined ? {} : { httpStatus: providerError.httpStatus }), ...(providerError?.requestId ? { requestId: providerError.requestId } : {}), ...(providerError?.bodySummary ? { responseBodySummary: providerError.bodySummary } : {}) });
    repository.setSetting("lastTestedAt", new Date().toISOString());
    repository.setSetting("lastTestStatus", "failed");
    repository.setSetting("lastTestDurationMs", Date.now() - startedAt);
    if (selectedProvider === "deepseek") repository.setSetting("deepseekCredentialStatus", isDecryptFailure ? "DecryptFailed" : "Configured");
    return { ok: false, message: mapped.message, ...(diagnostic ? { diagnostic } : {}) };
  }
}

function makeDeepSeekDiagnostic(repository: AppRepository, credentials: CredentialStore, startedAt: number, error: AIProviderError | undefined, errorCode: string): AIConnectionDiagnostic {
  let apiKey = "";
  try { apiKey = credentials.get("ai:apiKey")?.trim() ?? ""; } catch { /* Keep diagnostics secret-safe when decryption fails. */ }
  const httpStatus = error?.httpStatus;
  const authentication = httpStatus === 401 || httpStatus === 403 ? "failed" : httpStatus === undefined ? "not_tested" : "normal";
  return {
    provider: "deepseek",
    operation: "test_connection",
    baseUrl: safeDiagnosticBaseUrl(settingString(repository, "deepseekBaseUrl", "https://api.deepseek.com")),
    endpoint: "/models",
    credentialPresent: apiKey.length > 0 || credentials.getStatus?.("ai:apiKey") === "DecryptFailed",
    credentialLength: apiKey.length,
    credentialPrefixValid: apiKey.startsWith("sk-"),
    model: settingString(repository, "deepseekModel", "deepseek-v4-flash"),
    apiAddress: "normal",
    authentication,
    api: httpStatus === undefined ? "not_tested" : "normal",
    modelStatus: "not_tested",
    chatCompletion: "not_tested",
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(error?.requestId ? { requestId: error.requestId } : {}),
    errorCode,
    durationMs: Date.now() - startedAt
  };
}

function safeDiagnosticBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return "[invalid-url]";
  }
}

function createProfileProvider(profile: NonNullable<ReturnType<AppRepository["getAiProviderProfile"]>>, credentials: CredentialStore, logger?: Logger): AIProvider {
  if (profile.provider === "mock") return new MockAIProvider();
  const apiKey = credentials.get(profile.credentialRef);
  if (!apiKey) throw new Error(`AI Profile「${profile.name}」的凭据尚未配置`);
  if (profile.provider === "deepseek") return new DeepSeekProvider({ apiKey, baseUrl: profile.baseUrl || "https://api.deepseek.com", model: profile.model || "deepseek-v4-flash", thinking: "disabled", temperature: profile.temperature, maxOutputTokens: profile.maxOutputTokens, timeoutMs: profile.timeoutMs, retryCount: profile.retryCount, logger });
  return new OpenAICompatibleProvider({ providerKey: profile.provider, baseUrl: profile.baseUrl, apiKey, model: profile.model, temperature: profile.temperature, maxOutputTokens: profile.maxOutputTokens, timeoutMs: profile.timeoutMs, retryCount: profile.retryCount });
}

function createImageProvider(repository: AppRepository, credentials: CredentialStore): ImageProvider {
  const provider = settingString(repository, "imageProvider", "mock");
  if (provider === "mock") return new MockImageProvider();
  const apiKey = credentials.get("image:apiKey");
  if (!apiKey) return new MockImageProvider();
  return new OpenAICompatibleImageProvider({ providerKey: provider, baseUrl: settingString(repository, "imageBaseUrl", settingString(repository, "baseUrl", "https://api.openai.com/v1")), apiKey, model: settingString(repository, "imageModel", "gpt-image-1"), size: settingString(repository, "imageSize", "1536x1024"), timeoutMs: settingNumber(repository, "timeout", 30000) });
}

interface BatchTarget { city: string; keyword: string; variant: number; }

async function startBatch(repository: AppRepository, logger: Logger, input: BatchGenerationInput, coverDir: string, credentials: CredentialStore): Promise<string> {
  const brand = repository.getBrand(input.brandId);
  if (!brand) throw new Error("品牌不存在");
  const templates = repository.listKeywordTemplates(input.brandId).filter((template) => input.templateIds.length === 0 || input.templateIds.includes(template.id));
  const keywords = repository.expandAndSaveKeywords({ brandId: input.brandId, cities: input.cities, templateIds: templates.map((template) => template.id) }).items;
  const targets: BatchTarget[] = keywords.flatMap((keyword) => Array.from({ length: Math.max(1, input.perKeyword) }, (_, index) => ({ city: keyword.city, keyword: keyword.keyword, variant: index + 1 }))).slice(0, 1000);
  if (targets.length === 0) throw new Error("没有可生成的关键词");
  const provider = createAiProvider(repository, credentials);
  const taskId = repository.createAiTask({ brandId: brand.id, type: "batch_article", provider: provider.providerKey, model: provider.model, totalCount: targets.length, payload: { input, targets } as unknown as Record<string, unknown> });
  repository.createAiBatch({ taskId, brandId: brand.id, concurrency: input.concurrency ?? settingNumber(repository, "concurrency", 2), targets: targets.map((target, targetIndex): AIBatchTarget => ({ city: target.city, keyword: target.keyword, articleType: input.articleType, targetIndex })) });
  void runPersistentBatchTask(repository, logger, coverDir, { createAiProvider: () => createAiProvider(repository, credentials), createImageProvider: () => createImageProvider(repository, credentials) }, taskId, brand.id, input);
  return taskId;
}

export async function resumeRunningBatches(repository: AppRepository, logger: Logger, coverDir: string, credentials: CredentialStore): Promise<void> {
  repository.recoverAiBatchItems();
  await resumePersistentBatches(repository, logger, coverDir, { createAiProvider: () => createAiProvider(repository, credentials), createImageProvider: () => createImageProvider(repository, credentials) });
  if (repository.getSettings().useLegacyCursorRecovery === true) {
  for (const task of repository.listResumableAiTasks()) {
    const input = task.payload.input as BatchGenerationInput | undefined;
    const targets = task.payload.targets as BatchTarget[] | undefined;
    const brandId = typeof task.payload.brandId === "string" ? task.payload.brandId : input?.brandId;
    if (!input || !targets || !brandId) {
      repository.updateAiTask(task.id, { completed: task.completed, success: task.success, failed: task.failed, status: "failed", errorMessage: "无法恢复：任务参数不完整" });
      continue;
    }
    const provider = createAiProvider(repository, credentials);
    void runBatchTask(repository, logger, credentials, coverDir, task.id, brandId, input, targets, task.nextIndex, task.completed, task.success, task.failed, provider);
  }
  }
}

async function runBatchTask(repository: AppRepository, logger: Logger, credentials: CredentialStore, coverDir: string, taskId: string, brandId: string, input: BatchGenerationInput, targets: BatchTarget[], nextIndex: number, completed: number, success: number, failed: number, providerOverride?: AIProvider): Promise<void> {
  const brand = repository.getBrand(brandId);
  if (!brand) { repository.updateAiTask(taskId, { completed, success, failed, status: "failed", errorMessage: "品牌不存在" }); return; }
  const provider = providerOverride ?? createAiProvider(repository, credentials);
  const imageProvider = createImageProvider(repository, credentials);
  const concurrency = Math.min(20, Math.max(1, input.concurrency ?? settingNumber(repository, "concurrency", 2)));
  const priorBodies: string[] = repository.listArticles({ brandId }).map((article) => article.body);
  const startedAt = Date.now();
  const totalUsage: AIUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let cursor = Math.max(0, nextIndex);
  let lastError: string | undefined;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= targets.length) return;
      const target = targets[index];
      const currentTask = repository.getAiTask(taskId);
      if (currentTask?.cancelRequested) return;
      try {
        const generated = await provider.generateArticle({ brand, city: target.city, keyword: target.keyword, variant: target.variant, articleType: input.articleType, minWords: input.minWords, maxWords: input.maxWords, includeFaq: true, includeSummary: input.includeSummary, includeTags: input.includeTags, includeSeoKeywords: input.includeSeoKeywords });
        if (generated.usage) {
          totalUsage.promptTokens += generated.usage.promptTokens;
          totalUsage.completionTokens += generated.usage.completionTokens;
          totalUsage.totalTokens += generated.usage.totalTokens;
          if (generated.usage.estimatedCost !== undefined) totalUsage.estimatedCost = (totalUsage.estimatedCost ?? 0) + generated.usage.estimatedCost;
          totalUsage.currency = generated.usage.currency;
        }
        const quality = checkGeneratedArticleQuality({ title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, keyword: target.keyword, brand: brand.name, city: target.city }, { minWords: input.minWords, maxWords: input.maxWords, forbiddenClaims: brand.aiForbiddenClaims, similarityTexts: priorBodies });
        if (quality.errors.length > 0) throw new Error(`Quality Gate：${quality.errors.join("；")}`);
        if (quality.warnings.length > 0) logger.warn("AI", "QUALITY_WARNING", quality.warnings.join("；"), { taskId, keyword: target.keyword, warnings: quality.warnings });
        priorBodies.push(generated.body);
        const article = repository.createArticle({ brandId: brand.id, topic: target.keyword, keyword: target.keyword, city: target.city, title: generated.title, body: generated.body, summary: generated.summary, tags: generated.tags, seoKeywords: generated.seoKeywords, articleType: input.articleType, aiProvider: provider.providerKey, aiModel: provider.model, generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: contentHash(generated), qualityStatus: quality.status, qualityWarnings: quality.warnings });
        if (!article) throw new Error("文章未写入：内容 Hash 重复或数据库约束失败");
        if (article && input.autoCover) {
          let image: Awaited<ReturnType<ImageProvider["generateCover"]>>;
          try { image = await imageProvider.generateCover({ articleId: article.id, title: article.title, brandName: brand.name, city: article.city, articleType: input.articleType, coverPrompt: generated.suggestedCoverPrompt }); }
          catch (error) { logger.warn("IMAGE", "IMAGE_PROVIDER_FALLBACK", "批量图片 Provider 失败，已回退模板封面", { articleId: article.id, error: error instanceof Error ? error.message : "unknown" }); image = await new MockImageProvider().generateCover({ articleId: article.id, title: article.title, brandName: brand.name, city: article.city, articleType: input.articleType, coverPrompt: generated.suggestedCoverPrompt }); }
          const filePath = await persistGeneratedImage(image, coverDir);
          repository.attachCover(article.id, repository.createMediaAsset({ brandId: brand.id, type: "cover", title: `${article.title} 封面`, filePath, provider: image.provider, model: image.model }));
        }
        success += 1;
      } catch (error) { failed += 1; lastError = error instanceof Error ? error.message : "生成失败"; logger.error("AI", "BATCH_ITEM_FAILED", lastError, { taskId, index, keyword: target.keyword }); }
      finally {
        completed += 1;
        const cancelled = repository.getAiTask(taskId)?.cancelRequested === true;
        repository.updateAiTask(taskId, { completed, success, failed, nextIndex: cursor, status: cancelled ? "cancelled" : completed >= targets.length ? (failed > 0 && success === 0 ? "failed" : "completed") : "running", errorMessage: lastError, usage: totalUsage, durationMs: Date.now() - startedAt });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const finalTask = repository.getAiTask(taskId);
  if (finalTask?.status === "running") repository.updateAiTask(taskId, { completed, success, failed, status: finalTask.cancelRequested ? "cancelled" : completed >= targets.length ? (failed > 0 && success === 0 ? "failed" : "completed") : "running", errorMessage: lastError, usage: totalUsage, durationMs: Date.now() - startedAt, nextIndex: cursor });
  logger.info("AI", "BATCH_COMPLETED", "批量文章生成完成或已暂停", { taskId, success, failed, completed, concurrency });
}
