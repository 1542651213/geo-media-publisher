import { captureAccountAuthBoundary, invalidateAccountAuthBoundary } from "./account-auth-boundary";
import { assertExternalOperationAllowed } from './external-operation-policy';
import { exportColleaguePackage,inspectColleaguePackage,importColleaguePackage } from './colleague-data-package';
import { BUILD_IDENTITY } from '../shared/build-identity';
import { fullSnapshotSummary, restoreFullSnapshot, validateFullSnapshot } from "./backup-restore";
import { AccountOnboarding } from "./account-onboarding";
import { assertCurrentContentApproved } from "./content-review-authority";
import { DraftWorkingCopies, assertNoUnsubmittedEdits } from "./draft-working-copies";
import { app, dialog, ipcMain, shell } from "electron";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { importOfficialApiCredential, officialApiAccountView, verifyOfficialApiConnection } from "./official-api-account";
import type { OfficialApiController } from "./official-api-controller";
import { officialApiContentSettingsSchema } from "../../../../packages/adapters/official-api/src/mapping";
import { credentialFingerprint, prepareToutiaoArticleJob, ToutiaoCredentialBundleService } from "@publisher/adapters-toutiao/article-api";
import { protocolShadowEnabled } from "@publisher/adapters-toutiao/article-api";
import { ToutiaoArticleBrowserAdapter } from "@publisher/adapters-toutiao/browser";
import { DouyinImageTextBrowserAdapter } from "@publisher/adapters-douyin/image-text-browser";
import { freezeDouyinImageText } from "@publisher/domain/douyin-image-text";
import { assertDouyinImageTextTitle, b01ArticleMarker } from "@publisher/domain";
import { backupDatabase, validateDatabaseBackup, type AIBatchTarget, type AppRepository, type ContentStudioTaskPayload, type HumanReviewSubmitInput } from "@publisher/db";
import type { AccountDisconnectResult, BatchGenerationInput, ContentStudioGenerationInput } from "../shared/api";
import { AIProviderError, DeepSeekErrorMapper, DeepSeekProvider, FallbackAIProvider, MockAIProvider, OpenAICompatibleProvider, contentHash, validateProviderConfig, type AIConnectionDiagnostic, type AIConnectionResult, type AIProvider } from "@publisher/ai";
import { MockImageProvider, OpenAICompatibleImageProvider, persistGeneratedImage, type ImageProvider } from "@publisher/image";
import { CredentialDecryptError, SafeStorageCredentialStore, type CredentialStatus, type CredentialStore } from "@publisher/security";
import { BRAND_KNOWLEDGE_CATEGORIES, CONTENT_GOALS, CONTENT_INTENTS, CONTENT_STUDIO_PLATFORM_KEYS, EXCEL_ADVANCED_ARTICLE_HEADERS, EXCEL_SIMPLE_ARTICLE_HEADERS, PROMOTION_STRENGTHS, SEARCH_INTENTS, checkGeneratedArticleQuality, selectRelevantBrandFacts, type Account, type AccountContext, type AccountProfile, type AccountStatus, type AIUsage, type CredentialField, type ContentStudioPlatformKey, type ExcelImportPreview, type ImageAsset, type Platform } from "@publisher/domain";
import { BrowserRuntimeError, assertExternalLaunchAllowed, browserSessionCredentialKey, browserSessionIdHash, isAutomationAdapter, type AdapterRegistry, type AutomationAdapter, type ExternalLaunchTriggerSource, type UserInitiatedAction } from "@publisher/adapters-core";
import type { Logger } from "@publisher/logger";
import type { PublisherService, PersistentScheduler } from "@publisher/publisher";
import { resumePersistentBatches, runPersistentBatchTask } from "./ai-batch";
import { CONTENT_STUDIO_PROMPT_VERSION, runContentStudioTask } from "./content-studio";
import { AIProductCenter } from "./ai-product-center";
import { runQualityGate, runQualityGateForArticle, runQualityGateForVariant } from "./quality-gate";
import { runQualityBenchmark } from "./quality-benchmark";
import { OAuthSessionManager } from "./oauth-session-manager";
import { ToutiaoSessionActivation } from "./toutiao-session-activation";
import { runToutiaoProductionPreflight } from "./toutiao-production-preflight";
import { assertToutiaoProductReadiness } from "./toutiao-product-readiness";
import { auditMvp5OneShotCapture, claimControlledArticleNewCapture, claimControlledPublishRequestCapture,
  claimMvp53OwnerRecapture, readMvp5LockedClaimEvidence } from "./toutiao-article-new-once";
import { evaluateMvp5CaptureReadiness } from "./toutiao-capture-binding-readiness";
import { ToutiaoCapturedRequestOneShot } from "./toutiao-captured-request-one-shot";
import { synchronizeOwnedToutiaoCredential } from "./toutiao-owned-credential-binding";
import { writeAdvancedExcelTemplate, writeSimpleExcelTemplate } from "./excel-templates";
import { buildExcelImportErrorReportCsv, readExcelArticleFile } from "./excel-import";
import { PlatformSelfTestService } from "./platform-self-test";
import type { ProcessDiagnostics } from "./process-diagnostics";
import { addAccountConnectionModes, browserAccountConnectionResult, browserAccountDisconnectResult, toutiaoArticlePlatformView } from "./account-connection";
import { recordRuntimeHeartbeat } from "./runtime-observability";
import { assertDouyinAcceptanceChannel } from "./douyin-acceptance-gate";
import { selectDouyinBodyDiagnosticTarget } from "./douyin-body-diagnostic-gate";
import { selectDouyinMusicDiagnosticTarget } from "./douyin-music-diagnostic-gate";
import { assertDouyinR14ReadOnlyChannel } from "./douyin-r14-readonly-gate";
import { assertProductDeveloperOperation, assertOperatorBatchPlanAllowed, assertOperatorPublishIpcRequest } from "./operator-publish-gate";
import { assertB01OperatorIpcException, assertNoProductE2EDiagnosticSubmit } from "./b01-product-e2e-gate";
import { productPlatform, PRODUCT_PLATFORM_POLICY, productAccountHealth, evaluateProductPreflight, buildProductDiagnosticBundle } from "../shared/product-platform-policy";
import type { SprintAcceptanceController } from "./sprint-acceptance";
import { ContentOperations } from "./content-operations";
import { CompanyWorkspace } from "./company-workspace";
import { OperationsAssets } from "./operations-assets";
import * as XLSX from "xlsx";
import { AccountSessionRehydrationCoordinator, type AccountSessionTarget } from "./account-session-rehydration";
import type { BrowserSessionManager } from "@publisher/adapters-core";
import { sessionAccountHealth } from "../shared/product-platform-policy";

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
  browserSessions?: BrowserSessionManager;
  resolveAccountSecrets: (accountId: string, platformKey: string) => Record<string, string>;
  dataDirectory: string;
  coverDir: string;
  logger: Logger;
  credentials: CredentialStore;
  aiCredentials: CredentialStore;
  appLogPath: string;
  errorLogPath?: string;
  databasePath: string;
  registerShutdown?(cleanup:()=>Promise<void>):void;
  runInAuthScope?<T>(isCurrent:()=>boolean,operation:()=>Promise<T>):Promise<T>;
  automaticExecutionDisabled?: boolean;
  queueClosedSnapshot?: ()=>{directory:string;status:"PendingClose"};
  restoreDatabase?: (backupPath: string) => void;
  processDiagnostics?: ProcessDiagnostics;
  /** True only for an explicitly marked B01 Candidate package. */
  b01AcceptanceEnabled?: boolean;
  officialApi?: OfficialApiController;
  sprintAcceptance?: SprintAcceptanceController;
}

let processDiagnostics: ProcessDiagnostics | null = null;
let acceptanceRepository: AppRepository | null = null;
let b01CandidateActive = false;
let officialApiController: OfficialApiController | null = null;
let sprintAcceptanceController: SprintAcceptanceController | null = null;
let operatorPlatformFinder: ((key: string) => Platform | undefined) | null = null;
const mvp5PausedChannels = new Set(["articles:prepare-publish", "jobs:run", "jobs:confirm", "jobs:retry", "jobs:prepare-existing-douyin",
  "platform-self-test:run-post-upload-discovery", "platform-self-test:continue", "platform-self-test:run-level",
  "platform-self-test:request-publish", "platform-self-test:confirm-publish"]);

let restoredExecutionPaused = false;
let workspaceController: CompanyWorkspace | null = null;
function register(channel: string, handler: (event: Electron.IpcMainInvokeEvent, payload: unknown) => unknown): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, payload) => {
    try {
      assertExternalOperationAllowed(channel,payload,restoredExecutionPaused);
      if (!workspaceController?.current() && ["articles:list", "image-assets:list"].includes(channel)) return [];
      if (!workspaceController?.current() && channel === "articles:page") return { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1, qualityStatuses: {} };
      payload = workspaceController?.prepare(channel, payload) ?? payload;
      assertNoProductE2EDiagnosticSubmit(channel, payload);
      if (acceptanceRepository) assertOperatorPublishIpcRequest(
        channel, payload,
        (platformKey) => operatorPlatformFinder?.(platformKey),
        (jobId) => acceptanceRepository?.getJob(jobId),
        (requestChannel, requestPayload) => (b01CandidateActive
          && assertB01OperatorIpcException(requestChannel, requestPayload, acceptanceRepository!))
          || officialApiController?.allowsCandidateRequest(requestChannel, requestPayload) === true
          || sprintAcceptanceController?.allowsRequest(requestChannel, requestPayload) === true
      );
      if (acceptanceRepository && ["jobs:confirm", "jobs:run", "jobs:retry"].includes(channel)) {
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const job = typeof input.id === "string" ? acceptanceRepository.getJob(input.id) : null;
        if (job && !job.dryRun && !["Published", "Success", "Publishing", "Submitted", "NeedsReconciliation"].includes(job.status)) assertCurrentContentApproved(acceptanceRepository, job.articleId);
        if (job?.platformKey === "website") {
          if (channel === "jobs:retry") throw new Error("WEBSITE_ORIGINAL_OPERATION_RECOVERY_REQUIRED");
          if (channel === "jobs:confirm" && input.dryRun !== false) throw new Error("WEBSITE_CONFIRMED_FINAL_ONLY");
          const state = officialApiController?.jobState(job.id);
          if (state?.phase !== "PREPARED" || job.status !== (channel === "jobs:confirm" ? "AwaitingConfirmation" : "Scheduled")
            || (acceptanceRepository.getSubmissionIntentByJob(job.id)?.finalSubmitCount ?? 0) !== 0)
            throw new Error("WEBSITE_PREPARED_ORIGINAL_JOB_REQUIRED");
        }
        if (job?.platformKey === "douyin") {
          if ((job.contentKind ?? "article") !== "article") throw new Error("DOUYIN_ORDINARY_IMAGE_TEXT_ONLY");
          acceptanceRepository.assertArticlePublishAllowed(job.articleId);
        }
        if (typeof input.id === "string" && acceptanceRepository.getB01Authorization(input.id)) {
          if (channel === "jobs:retry") throw new Error("B01_RETRY_DISABLED");
          acceptanceRepository.assertB01Job(input.id, "final");
        }
      }
      const douyinR14JobId = process.env.DOUYIN_R1_14_READONLY_JOB_ID?.trim();
      if (douyinR14JobId) assertDouyinR14ReadOnlyChannel(channel, payload, {
        jobId: douyinR14JobId,
        accountId: process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim() ?? "",
        articleId: process.env.DOUYIN_R1_ACCEPTANCE_ARTICLE_ID?.trim() ?? "",
        nativeSubmitEnabled: process.env.DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED === "true"
      });
      if ((process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED === "true" || process.env.TOUTIAO_READONLY_PREFLIGHT === "true") && mvp5PausedChannels.has(channel))
        throw new Error("TOUTIAO_MVP5_OTHER_PUBLISH_PATHS_PAUSED");
      if (process.env.TOUTIAO_NATIVE_ACCEPTANCE_ACCOUNT_ID?.trim() && mvp5PausedChannels.has(channel)
        && !["platform-self-test:request-publish", "platform-self-test:confirm-publish", "platform-self-test:continue"].includes(channel))
        throw new Error("TOUTIAO_NATIVE_ACCEPTANCE_OTHER_PUBLISH_PATHS_PAUSED");
      const douyinAcceptanceAccountId = process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim();
      if (douyinAcceptanceAccountId && mvp5PausedChannels.has(channel)) {
        const douyinAcceptanceArticleId = process.env.DOUYIN_R1_ACCEPTANCE_ARTICLE_ID?.trim();
        if (!douyinAcceptanceArticleId) throw new Error("DOUYIN_ACCEPTANCE_ARTICLE_BINDING_REQUIRED");
        if (!acceptanceRepository) throw new Error("DOUYIN_ACCEPTANCE_REPOSITORY_UNAVAILABLE");
        assertDouyinAcceptanceChannel(channel, payload,
          { accountId: douyinAcceptanceAccountId, articleId: douyinAcceptanceArticleId },
          (id) => {
            const job = acceptanceRepository?.getJob(id);
            return job ? { id: job.id, accountId: job.accountId, articleId: job.articleId,
              platformKey: job.platformKey, contentKind: job.contentKind ?? null } : null;
          });
      }
      const diagnosticInput = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const diagnosticAccount = typeof diagnosticInput.platformAccountId === "string" ? acceptanceRepository?.listAccounts().find(account => account.platformAccountId === diagnosticInput.platformAccountId || account.id === diagnosticInput.platformAccountId) : null;
      const diagnosticRun = typeof diagnosticInput.testRunId === "string" ? acceptanceRepository?.getPlatformSelfTestRun(diagnosticInput.testRunId) : null;
      assertProductDeveloperOperation(channel, acceptanceRepository?.getSettings().developerMode === true, diagnosticAccount?.platformKey ?? diagnosticRun?.platformKey, diagnosticInput.level);
      const result = await handler(event, payload);
      if (channel === "brands:list" && Array.isArray(result)) return result.filter(brand => brand.id === workspaceController?.current());
      if (channel === "accounts:list" && Array.isArray(result)) return result.filter(account => workspaceController?.accountAllowed(account.id));
      return result;
    } catch (error) {
      processDiagnostics?.recordIpcError(channel, error);
      throw error;
    }
  });
}

export function registerIpc(deps: IpcDependencies): AccountSessionRehydrationCoordinator | null {
  restoredExecutionPaused = deps.automaticExecutionDisabled===true;
  processDiagnostics = deps.processDiagnostics ?? null;
  acceptanceRepository = deps.repository;
  b01CandidateActive = deps.b01AcceptanceEnabled === true;
  officialApiController = deps.officialApi ?? null;
  sprintAcceptanceController = deps.sprintAcceptance ?? null;
  const { repository, publisher, scheduler, registry, resolveAccountSecrets, dataDirectory, coverDir, logger, credentials, aiCredentials } = deps;
  let sessionRuntime: AccountSessionRehydrationCoordinator | null = null;
  const aiCenter: AIProductCenter = new AIProductCenter(repository, aiCredentials, fetch, companyId => operations?.activeFacts(companyId).map(fact => fact.statement) ?? []);
  const operations: ContentOperations = new ContentOperations(repository, aiCenter, accountId => {
    const account = repository.listAccounts().find(item => item.id === accountId);
    return account && sessionRuntime ? safeRuntimeSnapshot(account.id, account.platformKey) : null;
  }, false);
  const workspace = new CompanyWorkspace(repository, accountId => operations.accountCompany(accountId));
  const drafts = new DraftWorkingCopies(repository, { assertCompany: id => workspace.assertCompany(id),
    studio: { get: id => { const history = aiCenter.store.generation(id), draft = aiCenter.draft(id); return history && draft ? { companyId: history.companyId, title: draft.title, body: draft.body, outputArticleId: history.outputArticleId, variantId: history.variantId } : null; }, saveDraft: (id, title, body) => aiCenter.saveDraft(id, title, body) },
    audit: (event, metadata) => logger.info("DRAFT", event, "本地编辑工作副本状态更新", { ...metadata }) });
  for (const method of ["open", "get", "persist", "listRecovery", "commit", "discard", "release", "resolve"] as const)
    register(`drafts:${method.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`, (_event, payload) => drafts[method](payload));
  workspaceController = workspace;
  const assets = new OperationsAssets(repository, join(dataDirectory, "media", "images"));
  const sessionTarget = (accountId: string): AccountSessionTarget | null => {
    const account = repository.listAccounts().find(item => item.id === accountId);
    if (!account) return null;
    const binding = account.platformKey === "douyin" ? repository.getDouyinImageTextConnection(account.id) : null;
    const adapter = registry.tryGetForConnection(account.platformKey);
    return { accountId: account.id, accountName: account.accountAlias || account.name, platformKey: account.platformKey,
      companyId: operations.accountCompany(account.id) ?? "", enabled: account.enabled && !account.archivedAt,
      connectionMode: binding?.active || adapter?.manifest.transport === "browser" ? "BrowserAutomation" : account.connectionMode === "OAuth" ? "OAuth" : "OfficialAPI",
      expectedRemoteIdentity: binding?.active ? binding.creatorId : account.externalAccountId ?? repository.getAccountAuthorization(account.id, account.platformKey)?.providerAccountId ?? null,
      loginGeneration: binding?.active ? binding.loginGeneration : Number((repository.db.prepare("SELECT version FROM operations_account_company_bindings WHERE account_id=?").get(account.id) as {version:number}|undefined)?.version ?? 0) };
  };
  sessionRuntime = deps.browserSessions ? new AccountSessionRehydrationCoordinator({ registry, browserSessions: deps.browserSessions, resolveCompanyId: accountId => operations.accountCompany(accountId), resolveAdapter: target => target.platformKey === "douyin" && target.connectionMode === "BrowserAutomation" ? registry.getForContent("douyin", "article") : registry.tryGetForConnection(target.platformKey), resolveAuthoritativeTarget: (accountId, platformKey) => { const target = sessionTarget(accountId); return target?.platformKey === platformKey ? target : null; }, resolveSecrets: resolveAccountSecrets, concurrency: 2,runInAuthScope:deps.runInAuthScope,isAuthoritativeTargetCurrent: target=>{const current=sessionTarget(target.accountId);return current?.platformKey===target.platformKey&&JSON.stringify(current)===JSON.stringify(target);} }) : null;
  function safeRuntimeSnapshot(accountId: string, platformKey: string) {
    const target = sessionTarget(accountId);
    if (!target || target.platformKey !== platformKey) return null;
    const snapshot = target && sessionRuntime?.getSnapshotForTarget(target);
    if (!snapshot || !target) return null;
    if (snapshot.companyId !== target.companyId || snapshot.loginGeneration !== target.loginGeneration || !target.enabled) return { ...snapshot, state: target.enabled ? "UNVERIFIED" as const : "DISABLED" as const, identityMatched: false };
    return snapshot;
  }
  const onboarding = new AccountOnboarding(repository, { invalidateAuthentication: (id, key) => { invalidateAccountAuthBoundary(repository,id,key);sessionRuntime?.invalidate(id, key);oauthSessions.invalidate(id,key); }, runtimeHealth: (id, key) => safeRuntimeSnapshot(id, key) });
  register("account-onboarding:preview", () => onboarding.preview());
  register("account-onboarding:confirm", (_event, payload) => { const result = onboarding.confirm(payload); logger.info("ACCOUNT", "OWNER_COMPANY_CONFIRMED", "Owner 已逐账号确认所属企业；身份须重新验证", { accountId: result.accountId, companyId: result.companyId, bindingVersion: result.bindingVersion }); return result; });
  register("operations:bind-account", () => { throw new Error("历史账号归属须在 Owner Action 一页入口核对证据及版本后逐账号确认"); });
  register("sessions:snapshots", () => repository.listAccounts().map(account => safeRuntimeSnapshot(account.id, account.platformKey)).filter(item => item && item.companyId === workspace.current()));
  register("sessions:refresh", (_event, payload) => {
    const accountId = z.strictObject({ accountId: idSchema }).parse(payload).accountId;
    workspace.assertAccount(accountId);
    const target = sessionTarget(accountId);
    return target && sessionRuntime ? sessionRuntime.refresh(target, "MANUAL") : null;
  });
  if (sessionRuntime && !restoredExecutionPaused) void sessionRuntime.rehydrate(repository.listAccounts().map(account => sessionTarget(account.id)).filter((target): target is AccountSessionTarget => target !== null && Boolean(target.companyId)));
  register("workspace:companies", () => repository.listBrands());
  register("workspace:current", () => workspace.current());
  register("workspace:select", (_event, payload) => { const input=z.strictObject({companyId:idSchema}).parse(payload);const previous=workspace.current();if(previous&&previous!==input.companyId)aiCenter.cancel(previous);return workspace.select(input.companyId); });
  const operationsMethods = ["previewGenerationQueue", "saveStudioDefaults", "reviewArticle", "generatePlan", "createPlanItem", "createDraftFromPlan", "saveFact", "duplicateWarnings", "usage", "createGenerationQueue", "generationQueue", "runGenerationQueue", "pauseGenerationQueue", "resumeGenerationQueue", "cancelGenerationQueue", "retryFailedGeneration", "previewImport", "commitImport", "resolveRecoverableGeneration", "reconcileGenerationQueue", "resolveValidationGeneration", "preparePlanGeneration"] as const;
  for (const method of operationsMethods) register(`operations:${method.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`, (_event, payload) => { if(method==="createGenerationQueue")z.object({previewId:idSchema}).parse(payload); return operations[method](payload as never); });
  register("operations:snapshot", (_event, payload) => operations.snapshot(z.strictObject({ companyId: idSchema }).parse(payload).companyId));
  register("operations:consume-plan-generation-seed", (_event, payload) => operations.consumePlanGenerationSeed(z.strictObject({ companyId: idSchema }).parse(payload).companyId));
  register("operations:get-studio-defaults", (_event, payload) => operations.getStudioDefaults(z.strictObject({ companyId: idSchema }).parse(payload).companyId));
  register("operations:active-facts", (_event, payload) => operations.activeFacts(z.strictObject({ companyId: idSchema }).parse(payload).companyId));
  register("operations:account-company", (_event, payload) => operations.accountCompany(z.strictObject({ accountId: idSchema }).parse(payload).accountId));
  register("operations:unbound-accounts", () => operations.listUnboundAccounts());
  register("operations:pick-import-file", async () => {
    const selection = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "文章数据", extensions: ["xlsx", "csv"] }] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const path = selection.filePaths[0];
    if (statSync(path).size > 8 * 1024 * 1024) throw new Error("导入文件超过 8MB，请拆分后再导入");
    const book = XLSX.read(readFileSync(path), { type: "buffer", cellFormula: false, cellHTML: false, sheetRows: 1002 });
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    if (!sheet) throw new Error("文件中没有可读取的工作表");
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false });
    if (rows.length > 1000) throw new Error("一次最多导入 1000 行，请拆分文件");
    return { fileName: basename(path), columns: Object.keys(rows[0] ?? {}), rows };
  });
  const productDiagnostics = () => buildProductDiagnosticBundle({ version: app.getVersion(), migrationCount: Number((repository.db.prepare("SELECT COUNT(*) AS count FROM migrations").get() as { count: number }).count), providers: aiCenter.profiles(), generationStatuses: aiCenter.history().map(item => item.status), jobs: repository.listJobs().length });
  const exportProductDiagnostics = async (): Promise<string | null> => { const destination = await dialog.showSaveDialog({ defaultPath: join(app.getPath("downloads"), `publisher-diagnostics-${Date.now()}.json`), filters: [{ name: "脱敏诊断包", extensions: ["json"] }] }); if (destination.canceled || !destination.filePath) return null; writeFileSync(destination.filePath, JSON.stringify(productDiagnostics(), null, 2), "utf8"); return destination.filePath; };
  register("product:diagnostics", () => productDiagnostics());
  register("product:export-diagnostics", () => exportProductDiagnostics());
  aiCenter.store.recoverInterrupted();
  register("ai-center:definitions", () => aiCenter.definitions());
  register("ai-center:profiles", () => aiCenter.profiles());
  register("ai-center:save-profile", (_event, payload) => aiCenter.saveProfile(payload));
  register("ai-center:set-credential", (_event, payload) => { const input = z.strictObject({ id: idSchema, value: z.string().min(1).max(8192) }).parse(payload); aiCenter.setCredential(input.id, input.value); return { configured: true }; });
  register("ai-center:list-models", (_event, payload) => aiCenter.listModels(z.object({ id: idSchema }).parse(payload).id));
  register("ai-center:test-connection", (_event, payload) => aiCenter.testConnection(z.object({ id: idSchema }).parse(payload).id));
  register("ai-center:context", (_event, payload) => aiCenter.context(z.object({ companyId: idSchema }).parse(payload).companyId));
  register("ai-center:save-context", (_event, payload) => aiCenter.saveContext(payload));
  register("ai-center:templates", () => aiCenter.templates());
  register("ai-center:save-template", (_event, payload) => aiCenter.saveTemplate(payload));
  register("ai-center:history", (_event, payload) => aiCenter.history(z.object({ companyId: idSchema.optional() }).parse(payload).companyId));
  register("ai-center:draft", (_event, payload) => aiCenter.draft(z.object({ id: idSchema }).parse(payload).id));
  register("ai-center:preview-generation",(_event,payload)=>aiCenter.previewGeneration(payload));
  register("ai-center:request-budget",(_event,payload)=>{const input=z.strictObject({id:idSchema,companyId:idSchema}).parse(payload);workspace.assertCompany(input.companyId);return aiCenter.requestBudget(input.id,input.companyId);});
  register("ai-center:cancel",(_event,payload)=>{const {companyId}=z.strictObject({companyId:idSchema}).parse(payload);workspace.assertCompany(companyId);aiCenter.cancel(companyId);return{requested:true};});
  register("ai-center:generate", (_event, payload) => { const input=z.object({companyId:idSchema,previewId:idSchema}).parse(payload);workspace.assertCompany(input.companyId);return aiCenter.generate(payload,{beforeRequest:()=>workspace.assertCompany(input.companyId)}); });
  const aiDraftInput = z.strictObject({ id: idSchema, title: z.string().max(2000), body: z.string().max(100000) });
  register("ai-center:validate-draft", (_event, payload) => { const input = aiDraftInput.parse(payload); return aiCenter.validateDraft(input.id, input.title, input.body); });
  register("ai-center:save-draft", (_event, payload) => { const input = aiDraftInput.parse(payload); return aiCenter.saveDraft(input.id, input.title, input.body); });
  operatorPlatformFinder = key => {
    const platform = repository.listPlatforms().find(item => item.platformKey === key);
    if (platform && key === "toutiao") return toutiaoArticlePlatformView(platform, registry.getForContent("toutiao", "article").getCapabilities());
    if (!platform || key !== "douyin") return platform;
    try { return { ...platform, capabilities: { ...platform.capabilities, ...registry.getForContent("douyin", "article").getCapabilities() } }; }
    catch { return platform; }
  };
  const capturedDouyinBodyDiagnosticJobs = new Set<string>();
  const capturedDouyinMusicDiagnosticJobs = new Set<string>();
  const listPlatformViews = (): ReturnType<AppRepository["listPlatforms"]> => addAccountConnectionModes(repository.listPlatforms(), registry).map((platform) =>
    platform.platformKey === "douyin" ? { ...platform,
      capabilities: { ...platform.capabilities, ...registry.getForContent("douyin", "article").getCapabilities(), maxTitleLength: 20, maxImageCount: 1,
        scheduledPublish: false, draft: false, tags: false } } : platform.platformKey === "toutiao"
          ? toutiaoArticlePlatformView(platform, registry.getForContent("toutiao", "article").getCapabilities()) : platform);
  const createUserAction = (triggerSource: Exclude<ExternalLaunchTriggerSource, "APP_STARTUP">): UserInitiatedAction => {
    const action = { userActionId: randomUUID(), triggerSource } satisfies UserInitiatedAction;
    assertExternalLaunchAllowed(action);
    logger.info("EXTERNAL_LAUNCH", "USER_INITIATED_ACTION", "已记录用户发起的平台操作", action);
    return action;
  };
  const accountContext = (accountId: string, platformKey: string, action?: UserInitiatedAction, includeArchived = false): AccountContext => {
    const account = includeArchived ? repository.getAccountById(accountId, platformKey) : repository.listAccounts().find((item) => item.id === accountId && item.platformKey === platformKey);
    if (!account || account.platformKey !== platformKey) throw new Error("账号与平台不匹配");
    workspace.assertAccount(account.id);
    return {
      accountId,
      accountName: account.name,
      platformKey,
      settings: {
        triggerSource: action?.triggerSource ?? "APP_STARTUP",
        ...(platformKey === "toutiao" && account.externalAccountId ? { expectedCreatorId: account.externalAccountId } : {}),
        ...(platformKey === "douyin" && repository.getDouyinImageTextConnection(accountId)?.active
          ? { expectedCreatorId: repository.getDouyinImageTextConnection(accountId)!.creatorId,
            expectedLoginGeneration: repository.getDouyinImageTextConnection(accountId)!.loginGeneration } : {}),
        ...(action?.userActionId ? { userActionId: action.userActionId } : {})
      },
      secrets: resolveAccountSecrets(accountId, platformKey)
    };
  };
  const productPreflightSchema = z.strictObject({ articleId: idSchema, platformKey: idSchema, platformAccountId: idSchema, selectedImageAssetId: idSchema.nullable().optional(), websiteSettings: officialApiContentSettingsSchema.optional() });
  const collectProductPreflight = (input: z.infer<typeof productPreflightSchema>, identityVerified: boolean, publishMode = "CONFIRM_BEFORE_PUBLISH") => {
    const article = repository.getArticle(input.articleId), brand = article && repository.getBrand(article.brandId);
    if (article) assertNoUnsubmittedEdits(repository, article.id);
    const account = repository.listAccounts().find(item => item.platformKey === input.platformKey && (item.platformAccountId === input.platformAccountId || item.id === input.platformAccountId)) ?? null;
    workspace.assertCompany(article?.brandId);
    workspace.assertAccount(account?.id ?? "");
    const ids = input.platformKey === "website" && input.websiteSettings ? [input.websiteSettings.coverAssetId, ...input.websiteSettings.bodyImageAssetIds, ...input.websiteSettings.galleryAssetIds].filter((id): id is string => Boolean(id)) : input.selectedImageAssetId ? [input.selectedImageAssetId] : [];
    const images = [...new Set(ids)].map(id => { const image = repository.getImageAsset(id); return { brandId: image?.brandId ?? null, available: Boolean(image?.enabled && existsSync(image.filePath)) }; });
    const reviewApproved = article ? operations.approvedForPublish(article.brandId, article.id) : false;
    return evaluateProductPreflight({ platformKey: input.platformKey, companyId: article?.brandId ?? "", companyName: brand?.companyName || brand?.name || "未选择", article, account, identityVerified, images, contentType: input.websiteSettings?.kind ?? "article", publishMode, reviewApproved });
  };
  const inspectProductIdentity = async (account: Account | undefined): Promise<boolean> => {
    let verified = false;
    const assertCurrent=account?captureAccountAuthBoundary(repository,account.id,account.platformKey):null;
    if (account && productPlatform(account.platformKey)?.ordinaryPublishEnabled) {
      try {
        if (account.platformKey === "website") verified = (await verifyOfficialApiConnection({ repository, credentials }, account.id)).status === "CONNECTED";
        else {
          const adapter = registry.getForContent(account.platformKey, "article");
          if (adapter instanceof DouyinImageTextBrowserAdapter) {
            const binding = repository.getDouyinImageTextConnection(account.id), state = await adapter.inspectOwnedCreatorReadiness(accountContext(account.id, "douyin"));
            verified = Boolean(binding?.active && state.identityVerified && state.contextOwnership && state.creatorId === binding.creatorId && state.runtimeAuthState === "AUTHENTICATED"
              && state.sessionExists && state.browserConnected && state.canonicalPageExists && !state.canonicalPageClosed && state.canonicalPageContextMatchesSession);
          } else if (adapter instanceof ToutiaoArticleBrowserAdapter) {
            const state = await adapter.inspectAccountPreflight(accountContext(account.id, "toutiao", createUserAction("CHECK_LOGIN")));
            verified = state.allowed && state.creatorCenterAccessible && state.articlePublishPermission && state.identity.externalAccountId === account.externalAccountId;
          }
        }
      } catch { verified = false; }
    }
    try{assertCurrent?.();}catch{return false;}
    return verified;
  };
  register("product:health", async () => {
    const accounts = repository.listAccounts().filter(account => !account.archivedAt && workspace.accountAllowed(account.id));
    const health = await Promise.all(accounts.map(async account => {
      if (sessionRuntime) {
        const snapshot = safeRuntimeSnapshot(account.id, account.platformKey);
        return { ...productAccountHealth(account.platformKey, account), ...sessionAccountHealth(account.platformKey, snapshot?.state ?? "CHECKING"), companyName: repository.getBrand(workspace.current() ?? "")?.companyName ?? "", lastVerifiedAt: snapshot?.checkedAt ?? null };
      }
      const verified = await inspectProductIdentity(account);
      return productAccountHealth(account.platformKey, verified ? { ...account, loginStatus: "logged_in", lastVerifiedAt: new Date().toISOString() } : account, verified);
    }));
    return PRODUCT_PLATFORM_POLICY.flatMap(definition => {
      const rows = health.filter(row => row.platformKey === definition.platformKey);
      return rows.length ? rows : [productAccountHealth(definition.platformKey)];
    });
  });
  register("product:preflight", async (_event, payload) => {
    const input = productPreflightSchema.parse(payload);
    const account = repository.listAccounts().find(item => item.platformKey === input.platformKey && (item.platformAccountId === input.platformAccountId || item.id === input.platformAccountId));
    const verified = await inspectProductIdentity(account);
    return collectProductPreflight(input, verified);
  });
  const authIo=async<T>(assertCurrent:()=>void,operation:()=>Promise<T>):Promise<T>=>{assertCurrent();const result=await(deps.runInAuthScope?deps.runInAuthScope(()=>{try{assertCurrent();return true;}catch{return false;}},operation):operation());assertCurrent();return result;};
  const startAuthRequest=(accountId:string,platformKey:string):(()=>void)=>{invalidateAccountAuthBoundary(repository,accountId,platformKey);sessionRuntime?.invalidate(accountId,platformKey);const guard=captureAccountAuthBoundary(repository,accountId,platformKey),company=workspace.current();return()=>{guard();if(workspace.current()!==company)throw new Error('ACCOUNT_AUTH_WORKSPACE_CHANGED');};};
  const syncBrowserAccount = async (adapter: AutomationAdapter, accountId: string, platformKey: string, action: UserInitiatedAction, assertCurrent:()=>void, profileOverride?: AccountProfile) => {
    const profile = profileOverride ?? (adapter.getAccountProfile ? await authIo(assertCurrent,()=>adapter.getAccountProfile!(accountContext(accountId, platformKey, action))) : undefined);
    assertCurrent();
    const localAccount = repository.listAccounts().find((item) => item.id === accountId);
    const account=repository.syncBrowserPlatformAccount({
      accountId,
      platformKey,
      accountName: profile?.accountName ?? localAccount?.name,
      browserSessionId: browserSessionIdHash({ platformKey, accountId }),
      ...(adapter.getAccountProfile ? { externalAccountId: profile?.accountId ?? null } : {}),
      lastVerifiedAt: new Date().toISOString()
    });
    return{account,assertCurrent:captureAccountAuthBoundary(repository,accountId,platformKey)};
  };
  const oauthSessions = new OAuthSessionManager({ repository, registry, credentials, logger, accountContext,runInAuthScope:deps.runInAuthScope,sessionFingerprint:(id,key)=>{const target=sessionTarget(id);return target?.platformKey===key&&target.companyId?JSON.stringify(target):null;} });
  deps.registerShutdown?.(async()=>{for(const account of repository.listAccounts()){invalidateAccountAuthBoundary(repository,account.id,account.platformKey);sessionRuntime?.invalidate(account.id,account.platformKey);oauthSessions.invalidate(account.id,account.platformKey);}operations.cancelAllGeneration();aiCenter.cancelAll();await Promise.all([operations.waitForIdle(),aiCenter.waitForIdle()]);});
  const toutiaoSessionActivation = new ToutiaoSessionActivation({
    account: (accountId) => repository.listAccounts().find((item) => item.id === accountId && item.platformKey === "toutiao") ?? null,
    hasStoredSession: (accountId) => credentials.has(browserSessionCredentialKey({ platformKey: "toutiao", accountId })),
    snapshot: (accountId) => {
      const adapter = registry.getForConnection("toutiao");
      if (!isAutomationAdapter(adapter) || !adapter.getBrowserRuntimeSnapshot) throw new Error("TOUTIAO_BROWSER_RUNTIME_UNAVAILABLE");
      return adapter.getBrowserRuntimeSnapshot(accountContext(accountId, "toutiao"));
    },
    openBackend: (accountId) => {
      const adapter = registry.getForConnection("toutiao");
      if (!isAutomationAdapter(adapter)) throw new Error("TOUTIAO_BROWSER_RUNTIME_UNAVAILABLE");
      return adapter.openBackend(accountContext(accountId, "toutiao", createUserAction("OPEN_BACKEND")));
    },
    beginLogin: (accountId) => {
      const adapter = registry.getForConnection("toutiao");
      if (!isAutomationAdapter(adapter)) throw new Error("TOUTIAO_BROWSER_RUNTIME_UNAVAILABLE");
      return adapter.beginLogin(accountContext(accountId, "toutiao", createUserAction("CONNECT_ACCOUNT")));
    },
    closeRuntime: async (accountId) => {
      const adapter = registry.getForConnection("toutiao");
      if (!isAutomationAdapter(adapter) || !adapter.closeRuntimeSession) throw new Error("TOUTIAO_BROWSER_RUNTIME_UNAVAILABLE");
      await adapter.closeRuntimeSession(accountContext(accountId, "toutiao"));
    },
    onHeartbeat: (status) => logger.info("ACCOUNT", "TOUTIAO_RUNTIME_HEARTBEAT", "头条 BrowserSession 运行时心跳", { accountId: status.accountId, sessionExists: status.sessionExists, contextExists: status.contextExists, canonicalPageExists: status.canonicalPageExists, contextOwnsPage: status.contextOwnsPage, pageAlive: status.pageAlive, pageHost: status.pageHost, runtimeState: status.runtimeState, lastHeartbeatAt: status.lastHeartbeatAt })
  });
  const platformSelfTests = new PlatformSelfTestService({ repository, registry, publisher, resolveAccountSecrets, logger,
    toutiaoNativeAcceptanceAccountId: process.env.TOUTIAO_NATIVE_ACCEPTANCE_ACCOUNT_ID?.trim() });
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
  register("dashboard:get", () => {
    recordRuntimeHeartbeat(logger, "dashboard:get");
    const companyId = workspace.current(), articles = companyId ? repository.listArticles({ brandId: companyId }) : [];
    const ids = new Set(articles.map(article => article.id)), jobs = repository.listJobs().filter(job => ids.has(job.articleId));
    const accounts = repository.listAccounts().filter(account => !account.archivedAt && workspace.accountAllowed(account.id));
    const today = new Date().toISOString().slice(0, 10), usage = companyId ? operations.usage({ companyId, days: 1 }) : [];
    const publishedToday = companyId ? Number((repository.db.prepare("SELECT COUNT(*) n FROM publish_records r JOIN publish_jobs j ON j.id=r.job_id JOIN articles a ON a.id=j.article_id WHERE a.brand_id=? AND r.success=1 AND r.dry_run=0 AND r.published_at>=?").get(companyId, today) as { n: number }).n) : 0;
    const availableArticles = articles.filter(article => ["available", "partially_published"].includes(article.status)).length;
    return { publishedToday, pendingJobs: jobs.filter(job => ["Pending", "Scheduled", "Retry"].includes(job.status)).length, failedJobs: jobs.filter(job => ["Failed", "NeedsReconciliation", "NeedsUserAction"].includes(job.status)).length, runningJobs: jobs.filter(job => ["Running", "Preparing", "Submitting", "Publishing"].includes(job.status)).length, totalAccounts: accounts.length,
      onlineAccounts: accounts.filter(account => ["AUTHENTICATED", "CONNECTED"].includes(safeRuntimeSnapshot(account.id, account.platformKey)?.state ?? "UNVERIFIED")).length,
      expiredAccounts: accounts.filter(account => ["NEEDS_LOGIN", "CREDENTIAL_INVALID"].includes(safeRuntimeSnapshot(account.id, account.platformKey)?.state ?? "UNVERIFIED")).length,
      availableArticles, generatedToday: articles.filter(article => article.generatedAt >= today).length, estimatedStockDays: Math.ceil(availableArticles / Math.max(1, accounts.length)), activeAiTasks: companyId ? operations.snapshot(companyId).dashboard.generating : 0,
      aiGeneratedToday: usage.reduce((sum, row) => sum + row.successCount, 0), aiInputTokensToday: usage.reduce((sum, row) => sum + row.inputTokens, 0), aiOutputTokensToday: usage.reduce((sum, row) => sum + row.outputTokens, 0), aiEstimatedCostToday: null };
  });
  register("sprint:availability", () => deps.sprintAcceptance?.availability() ?? []);
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
      image = await new MockImageProvider().generateCover({ articleId: article.id, title: article.title, brandName: brand.name, city: article.city, articleType: article.articleType });
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
    const input = z.object({ articleId: idSchema, platformKey: idSchema, platformAccountId: idSchema, publishMode: z.enum(["ASSISTED", "MANUAL"]).optional(), finalPublishMode: z.enum(["PREPARE_ONLY", "CONFIRM_BEFORE_PUBLISH", "AUTO_PUBLISH"]).optional(), selectedImageAssetId: idSchema.nullable().optional(), imageSelectionMode: z.enum(["random", "manual", "none"]).optional(), websiteSettings: officialApiContentSettingsSchema.optional(), douyinImageTextSettings: z.strictObject({ version: z.literal(1), visibility: z.literal("public"), timing: z.literal("immediate"), musicMode: z.literal("NONE").optional() }).optional(), toutiaoArticleSettings: z.object({ version: z.literal(1), coverMode: z.enum(["auto", "none", "single", "multiple"]), coverImages: z.array(idSchema), articleAdType: z.enum(["none", "platform_default"]), remoteScheduledAt: z.string().nullable() }).optional() }).parse(payload);
    const currentArticle = repository.getArticle(input.articleId);
    if (!currentArticle || !operations.approvedForPublish(currentArticle.brandId, currentArticle.id)) throw new Error("内容尚未人工审核通过，请先进入内容审核");
    if (input.platformKey === "website") {
      if (!deps.officialApi || input.finalPublishMode === "AUTO_PUBLISH") throw new Error("WEBSITE_MAIN_CONFIRMED_PATH_REQUIRED");
      return deps.officialApi.prepare({ articleId: input.articleId, platformAccountId: input.platformAccountId, websiteSettings: input.websiteSettings });
    }
    const configuredMode = repository.getSettings().finalPublishMode;
    const finalPublishMode = ["douyin", "cnblogs"].includes(input.platformKey) ? input.finalPublishMode === "PREPARE_ONLY" ? "PREPARE_ONLY" : "CONFIRM_BEFORE_PUBLISH" : input.finalPublishMode ?? (configuredMode === "prepare_only" ? "PREPARE_ONLY" : configuredMode === "auto_publish" ? "AUTO_PUBLISH" : "CONFIRM_BEFORE_PUBLISH");
    const articleAdapter = registry.getForContent(input.platformKey, "article");
    const b01 = input.platformKey === "douyin" && deps.b01AcceptanceEnabled === true;
    let productIdentityVerified = false;
    if (input.platformKey === "douyin" && !b01) {
      const account = repository.listAccounts().find(item => item.platformKey === "douyin" && item.platformAccountId === input.platformAccountId);
      const binding = account && repository.getDouyinImageTextConnection(account.id);
      if (!account || !binding?.active || !binding.creatorId || !("inspectOwnedCreatorReadiness" in articleAdapter)
        || typeof articleAdapter.inspectOwnedCreatorReadiness !== "function") throw new Error("DOUYIN_CREATOR_IDENTITY_REQUIRED");
      const readiness = await articleAdapter.inspectOwnedCreatorReadiness(accountContext(account.id, "douyin"));
      if (!readiness.identityVerified || !readiness.contextOwnership || !readiness.sessionExists || !readiness.contextExists
        || !readiness.canonicalPageExists || readiness.creatorId !== binding.creatorId || readiness.runtimeAuthState !== "AUTHENTICATED")
        throw new Error("DOUYIN_CREATOR_IDENTITY_UNVERIFIED");
      productIdentityVerified = true;
    }
    const isApiPlatform = articleAdapter.manifest.transport === "official_api" || articleAdapter.manifest.transport === "web_api";
    const isToutiaoArticleApi = input.platformKey === "toutiao" && articleAdapter.manifest.transport === "web_api";
    if (input.platformKey === "toutiao" && articleAdapter instanceof ToutiaoArticleBrowserAdapter) {
      const account = repository.listAccounts().find(item => item.platformKey === "toutiao" && item.platformAccountId === input.platformAccountId && item.enabled && !item.archivedAt);
      const article = repository.getArticle(input.articleId);
      const image = input.selectedImageAssetId ? repository.getImageAsset(input.selectedImageAssetId) : null;
      if (!account || !article) throw new Error("TOUTIAO_ACCOUNT_CONTENT_UNAVAILABLE");
      await assertToutiaoProductReadiness({ expectedCreatorId: account.externalAccountId,
        input: { articleId: article.id, title: article.title, body: article.body, summary: article.summary, tags: article.tags,
          ...(image ? { images: [image.filePath] } : {}) },
        imageAvailable: Boolean(image?.enabled && existsSync(image.filePath)), imageBrandMatch: image?.brandId === article.brandId,
        validate: value => articleAdapter.validateArticle(value), inspect: () => articleAdapter.inspectAccountPreflight(accountContext(account.id, "toutiao", createUserAction("START_PUBLISH"))) });
      productIdentityVerified = true;
    }
    if (!b01 && productPlatform(input.platformKey)?.ordinaryPublishEnabled) {
      const preflight = collectProductPreflight(input, productIdentityVerified, finalPublishMode);
      if (!preflight.allowed) throw new Error(preflight.blockers.join("；"));
    }
    const candidateAccount = !productPlatform(input.platformKey)?.ordinaryPublishEnabled
      ? repository.listAccounts().find(account => account.platformAccountId === input.platformAccountId && account.platformKey === input.platformKey) : null;
    const originalSprintJob = candidateAccount && deps.sprintAcceptance
      ? deps.sprintAcceptance.originalJob(input.platformKey, input.articleId, candidateAccount.id) : null;
    const job = originalSprintJob ? repository.getJob(originalSprintJob.id)! : isToutiaoArticleApi
      ? repository.createToutiaoArticlePublishJob({ ...input, finalPublishMode, settings: input.toutiaoArticleSettings })
      : b01
        ? repository.createB01Job({ ...input, finalPublishMode, articleTransport: "browser" })
        : repository.createArticlePublishJob({ ...input, finalPublishMode, articleTransport: isApiPlatform ? "api" : "browser" });
    if (b01) logger.info("B01", "ONE_SHOT_JOB_BOUND", "B01 单次验收 Job 已绑定", { jobId: job.id, accountId: job.accountId, articleId: job.articleId, imageAssetId: job.selectedImageAssetId });
    logger.info("QUALITY_GATE", "CONTENT_REVIEW_MODE_APPLIED", "文章按当前内容审核模式进入发布流程", { articleId: input.articleId, platformKey: input.platformKey, contentReviewMode: repository.getContentReviewMode() });
    if (isToutiaoArticleApi) {
      const prepared = prepareToutiaoArticleJob(repository, job.id);
      logger.info("PUBLISHER", "TOUTIAO_ARTICLE_PREPARED", "头条图文离线准备完成", { jobId: job.id, payloadHash: prepared.payloadHash, settingsSnapshotVersion: prepared.payload.settingsSnapshotVersion });
      if (finalPublishMode !== "AUTO_PUBLISH") return { job, record: null, message: "头条图文已离线准备；API 提交尚未实现。" };
    }
    if (finalPublishMode === "PREPARE_ONLY" && isApiPlatform) return { job, record: null, message: "内容已准备并写入任务；只准备内容模式不会调用平台发布 API。" };
    const action = createUserAction("START_PUBLISH");
    if (finalPublishMode === "AUTO_PUBLISH" && isApiPlatform) {
      const result = await publisher.executeJob(job.id, action);
      return { ...result, record: repository.getPublishRecordByJob(result.job.id) };
    }
    if (input.platformKey === "cnblogs") {
      return { job, record: null, message: "内容已在本地准备，等待单独确认后单次创建并进入审核。" };
    }
    const prepared = await publisher.prepareArticle(job.id, action);
    if (b01) {
      repository.markB01Prepared(job.id);
      logger.info("B01", "AWAITING_OWNER_FINAL_APPROVAL", "B01 内容已准备，等待 Owner 单独批准最终提交", { jobId: job.id });
    }
    return finalPublishMode === "AUTO_PUBLISH"
      ? { ...prepared, message: `${prepared.message}；该浏览器平台尚无已验证的最终提交能力，已降级为发布前确认。` }
      : prepared;
  });
  register("b01:eligibility", (_event, payload) => {
    const input = z.object({ accountId: idSchema, articleId: idSchema, imageAssetId: idSchema }).parse(payload);
    if (!deps.b01AcceptanceEnabled) return { eligible: false, status: "Missing" as const, reason: "当前安装版未开放 B01 验收申请" };
    return repository.b01Eligibility(input);
  });
  register("b01:availability", () => ({ enabled: deps.b01AcceptanceEnabled === true,
    reason: deps.b01AcceptanceEnabled ? "可申请指定组合的一次 B01 验收授权" : "当前安装版未开放 B01 验收申请" }));
  register("b01:request-authorization", async (_event, payload) => {
    const input = z.strictObject({ platformKey: z.literal("douyin"), accountId: idSchema,
      articleId: idSchema, imageAssetId: idSchema }).parse(payload);
    if (!deps.b01AcceptanceEnabled || productPlatform("douyin")?.ordinaryPublishEnabled !== false
      || productPlatform("douyin")?.batchPublishEnabled !== false) throw new Error("B01_CANDIDATE_CAPABILITY_REQUIRED");
    const adapter = registry.getForContent("douyin", "article");
    if (adapter.manifest.transport !== "browser" || !adapter.getCapabilities().article || !adapter.getCapabilities().imagePost)
      throw new Error("B01_DOUYIN_CAPABILITY_UNAVAILABLE");
    const account = repository.getAccountById(input.accountId, "douyin");
    const article = repository.getArticle(input.articleId);
    const image = repository.getImageAsset(input.imageAssetId);
    const marker = article ? b01ArticleMarker(article.title, article.body) : null;
    if (!account || account.archivedAt || !account.enabled || !article || !marker || !article.body.includes(marker)
      || !image?.enabled || image.brandId !== article.brandId || !existsSync(image.filePath))
      throw new Error("B01_EXACT_NEW_TEST_SELECTION_REQUIRED");
    assertDouyinImageTextTitle(article.title);
    if (!repository.canCreateB01Authorization()) throw new Error("B01_AUTHORIZATION_ALREADY_EXISTS");
    const answer = await dialog.showMessageBox({ type: "warning", title: "B01 单次产品验收授权",
      message: "确认仅为当前账号、文章和单张图片创建一次验收授权？",
      detail: `账号：${account.accountAlias || account.name}\n文章：${article.title}\n图片：${image.name}\n\n此操作不批准最终提交；授权创建后不可改绑或重建。`,
      buttons: ["取消", "确认创建一次验收授权"], cancelId: 0, defaultId: 0, noLink: true });
    if (answer.response !== 1) throw new Error("B01_OWNER_AUTHORIZATION_REQUIRED");
    // The Repository re-reads the Article and image bytes, checks history, and owns the single INSERT.
    const imageSha256 = createHash("sha256").update(readFileSync(image.filePath)).digest("hex");
    const authorization = repository.createB01Authorization({ platformKey: input.platformKey,
      accountId: input.accountId, articleId: input.articleId, imageAssetId: input.imageAssetId,
      imageSha256, expiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString() });
    const eligibility = repository.b01Eligibility(input);
    logger.info("B01", "OWNER_AUTHORIZATION_CREATED", "B01 单次验收授权已由 Main 创建", {
      accountId: authorization.accountId, articleId: authorization.articleId, imageAssetId: authorization.imageAssetId });
    return { id: authorization.id, status: authorization.status, eligible: eligibility.eligible, reason: eligibility.reason };
  });
  register("b01:retire-preboundary", async (_event, payload) => {
    const { jobId } = z.strictObject({ jobId: idSchema }).parse(payload);
    if (!deps.b01AcceptanceEnabled) throw new Error("B01_CANDIDATE_CAPABILITY_REQUIRED");
    const result = repository.retireB01Preboundary(jobId);
    logger.info("B01", "PREBOUNDARY_RETIRED", "Owner 撤销未提交的 B01 尝试；历史与冻结内容保留", { jobId, authorizationId: result.id });
    return { status: result.status, jobId: result.jobId, reason: "此未提交验收已撤销，旧任务永远不能提交。" };
  });
  register("b01:job-status", (_event, payload) => {
    const jobId = z.object({ jobId: idSchema }).parse(payload).jobId;
    const status = repository.getB01Authorization(jobId)?.status ?? "Missing";
    if (!deps.b01AcceptanceEnabled) return { eligible: false, status, reason: status === "Missing"
      ? "当前安装版未开放 B01 单次验收" : "历史验收任务保留原授权边界，不允许再次提交" };
    try { repository.assertB01Job(jobId, "final"); return { eligible: true, status, reason: "仅此任务可进行一次 B01 最终提交" }; }
    catch { return { eligible: false, status, reason: status === "Prepared" ? "B01 内容已准备，等待 Owner 单独批准最终提交" : "当前任务没有 B01 最终提交资格" }; }
  });
  register("b01:request-final-approval", async (_event, payload) => {
    const { jobId } = z.strictObject({ jobId: idSchema }).parse(payload);
    if (!deps.b01AcceptanceEnabled) throw new Error("B01_CANDIDATE_CAPABILITY_REQUIRED");
    const authorization = repository.getB01Authorization();
    const job = repository.getJob(jobId);
    const record = repository.getPublishRecordByJob(jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const image = authorization ? repository.getImageAsset(authorization.imageAssetId) : null;
    const connection = authorization ? repository.getDouyinImageTextConnection(authorization.accountId) : null;
    const settings = job ? repository.getDouyinImageTextJobSettings(job.id) : null;
    const evidence = record?.response;
    if (!authorization || authorization.status !== "Prepared" || authorization.jobId !== jobId
      || !job || job.status !== "AwaitingConfirmation" || job.attemptCount !== 0
      || !record || record.status !== "Prepared" || !record.titleFilled || !record.bodyFilled
      || !article || !image || !connection?.active || !settings || settings.visibility !== "public" || settings.timing !== "immediate"
      || repository.getSubmissionIntentByJob(jobId) || evidence?.imageUploaded !== true
      || evidence?.contentTransport !== "DOUYIN_IMAGE_TEXT_BROWSER"
      || evidence?.selectedImageAssetId !== image.id || evidence?.imageSelectionMode !== "manual"
      || !Array.isArray(evidence?.imageHashes) || evidence.imageHashes.length !== 1 || evidence.imageHashes[0] !== authorization.imageSha256
      || evidence?.musicModeRequested !== "NONE" || evidence?.musicResult !== "DISABLED"
      || evidence?.expectedCreatorId !== connection.creatorId || evidence?.expectedLoginGeneration !== connection.loginGeneration)
      throw new Error("B01_PREPARED_BINDING_REQUIRED");
    const adapter = registry.getForContent("douyin", "article");
    if (typeof adapter.prepareFinalSubmit !== "function" || !("inspectOwnedCreatorReadiness" in adapter)
      || typeof adapter.inspectOwnedCreatorReadiness !== "function") throw new Error("B01_DOUYIN_FINAL_PREFLIGHT_UNAVAILABLE");
    const ctx = accountContext(authorization.accountId, "douyin");
    ctx.settings.expectedMusicMode = "NONE";
    const readiness = await adapter.inspectOwnedCreatorReadiness(ctx);
    if (!readiness.identityVerified || !readiness.contextOwnership || !readiness.sessionExists
      || !readiness.contextExists || !readiness.canonicalPageExists || readiness.creatorId !== connection.creatorId)
      throw new Error("B01_REMOTE_IDENTITY_UNVERIFIED");
    const preflight = await adapter.prepareFinalSubmit(ctx, { articleId: article.id, title: article.title,
      body: article.body, summary: article.summary, tags: article.tags, images: [image.filePath] });
    if (preflight.response.contentBindingHash !== evidence.contentBindingHash || preflight.response.titleReadback !== true
      || preflight.response.bodyReadback !== true || preflight.response.settingsReadback !== true
      || preflight.response.managementReadOnlyReady !== true) throw new Error("B01_FINAL_READBACK_MISMATCH");
    const answer = await dialog.showMessageBox({ type: "warning", title: "B01 Owner 最终批准",
      message: "仅在 Owner 已另行明确授权这一次最终提交后确认",
      detail: `Job：${jobId}\n账号：${authorization.accountId}\n文章：${article.title}\n\n批准后仍需单独执行最终提交；结果不确定时只能只读回查。`,
      buttons: ["取消", "我已获得 Owner 对此 Job 唯一一次最终提交的明确授权"], cancelId: 0, defaultId: 0, noLink: true });
    if (answer.response !== 1) throw new Error("B01_OWNER_FINAL_APPROVAL_REQUIRED");
    const approved = repository.approveB01Final(jobId, `B01-OWNER-${randomUUID()}`);
    logger.info("B01", "OWNER_FINAL_APPROVED", "B01 Prepared Job 获得单次最终批准", { jobId });
    return { status: approved.status, jobId: approved.jobId, reason: "Owner 已批准此 Job 的唯一一次最终提交" };
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
  const imageInputSchema = z.strictObject({ brandId: idSchema, sourcePaths: z.array(z.string().min(1).max(8192)).min(1).max(100), name: z.string().trim().max(200).optional(), tags: z.array(z.string().trim().min(1).max(80)).max(30), business: z.array(z.string().trim().min(1).max(80)).max(20), city: z.array(z.string().trim().min(1).max(80)).max(20), usage: z.array(z.string().trim().min(1).max(80)).max(30), platform: z.array(z.string().trim().min(1).max(80)).max(20), universal: z.boolean() });
  register("image-assets:list", (_event, payload) => { const input = z.object({ brandId: idSchema.optional(), enabledOnly: z.boolean().optional() }).optional().parse(payload); return assets.views(repository.listImageAssets(input?.brandId, input?.enabledOnly ?? false)).map(imageAssetView); });
  register("image-assets:pick-files", async () => { const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] }); return result.canceled ? [] : result.filePaths; });
  register("image-assets:import", (_event, payload) => {
    const input = imageInputSchema.parse(payload);
    if (!repository.getBrand(input.brandId)) throw new Error("品牌不存在");
    const imported = assets.import(input.brandId, input.sourcePaths, { name: input.name, tags: input.tags, business: input.business, city: input.city, usage: input.usage, platform: input.platform, universal: input.universal });
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
    const { canonicalPagePath: _canonicalPagePath, ...safeSnapshot } = snapshot;
    logger.info("ACCOUNT", "CANONICAL_SESSION_HEARTBEAT", "只读读取 account-scoped BrowserSession live objects", { phase: input.phase ?? "MANUAL", heartbeatSequence: input.heartbeatSequence ?? randomUUID(), loginGeneration: input.loginGeneration ?? null, ...safeSnapshot });
    return snapshot;
  });
  register("accounts:get-runtime-session-status", (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: z.literal("toutiao") }).parse(payload);
    return toutiaoSessionActivation.status(input.accountId);
  });
  register("accounts:activate-session", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: z.literal("toutiao") }).parse(payload);
    const result = await toutiaoSessionActivation.activate(input.accountId);
    logger.info("ACCOUNT", "TOUTIAO_SESSION_ACTIVATION", "头条账号 BrowserSession 激活结果", { accountId: input.accountId, outcome: result.outcome, runtimeState: result.runtimeState, reasonCode: result.reasonCode, sessionExists: result.sessionExists, contextExists: result.contextExists, canonicalPageExists: result.canonicalPageExists, contextOwnsPage: result.contextOwnsPage, pageAlive: result.pageAlive, pageHost: result.pageHost, lastHeartbeatAt: result.lastHeartbeatAt });
    return result;
  });
  register("accounts:activate-douyin-image-text", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    const account = repository.getAccountById(input.accountId, "douyin");
    if (!account || account.archivedAt) throw new Error("Douyin account is unavailable");
    const binding = repository.getDouyinImageTextConnection(input.accountId);
    if (!binding?.active) return { status: "BINDING_REQUIRED" as const, creatorId: null, pageHost: null, sessionIdHash: null };
    if (!credentials.has(browserSessionCredentialKey({ platformKey: "douyin", accountId: input.accountId })))
      return { status: "NO_STORED_AUTH" as const, creatorId: null, pageHost: null, sessionIdHash: null };
    const adapter = registry.getForContent("douyin", "article");
    if (!(adapter instanceof DouyinImageTextBrowserAdapter)) throw new Error("Douyin image/text BrowserNative route is unavailable");
    const result = await adapter.activateStoredCreatorSession(accountContext(input.accountId, "douyin", createUserAction("OPEN_BACKEND")),
      Boolean(process.env.DOUYIN_R1_14_READONLY_JOB_ID && process.env.DOUYIN_R1_14_READONLY_JOB_ID.trim()
        && process.env.DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED !== "true"));
    logger.info("ACCOUNT", "DOUYIN_IMAGE_TEXT_SESSION_ACTIVATION", "抖音图文受控会话激活检查", {
      accountId: input.accountId, status: result.status, pageHost: result.pageHost, sessionIdHash: result.sessionIdHash });
    return result;
  });
  register("accounts:readiness-douyin-image-text", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    const account = repository.getAccountById(input.accountId, "douyin");
    if (!account || account.archivedAt || !repository.getDouyinImageTextConnection(input.accountId)?.active)
      throw new Error("Douyin Creator binding is unavailable");
    const adapter = registry.getForContent("douyin", "article");
    if (!(adapter instanceof DouyinImageTextBrowserAdapter)) throw new Error("Douyin image/text BrowserNative route is unavailable");
    const readiness = await adapter.inspectOwnedCreatorReadiness(accountContext(input.accountId, "douyin"));
    if (process.env.DOUYIN_BODY_DIAGNOSTIC_ENABLED === "true") {
      const configuredJobId = process.env.DOUYIN_BODY_DIAGNOSTIC_JOB_ID?.trim() ?? "";
      if (!capturedDouyinBodyDiagnosticJobs.has(configuredJobId)) {
        const job = configuredJobId ? repository.getJob(configuredJobId) : null;
        const article = job ? repository.getArticle(job.articleId) : null;
        const target = selectDouyinBodyDiagnosticTarget({ enabled: true,
          configuredAccountId: process.env.DOUYIN_BODY_DIAGNOSTIC_ACCOUNT_ID?.trim() ?? null,
          configuredJobId: configuredJobId || null, requestedAccountId: input.accountId,
          job, article, connection: repository.getDouyinImageTextConnection(input.accountId),
          payload: job ? repository.getPublishPayload(job.id) : {},
          intentPresent: Boolean(job && repository.getSubmissionIntentByJob(job.id)),
          recordPresent: Boolean(job && repository.getPublishRecordByJob(job.id)) });
        if (!target || !article) throw new Error("DOUYIN_BODY_DIAGNOSTIC_TARGET_MISSING");
        const image = repository.getImageAsset(target.imageAssetId);
        if (!image || image.brandId !== article.brandId) throw new Error("DOUYIN_BODY_DIAGNOSTIC_IMAGE_BINDING_MISMATCH");
        const frozen = await freezeDouyinImageText({ articleId: article.id, accountId: input.accountId,
          creatorId: target.binding.creatorId, title: article.title, body: article.body,
          imagePaths: [image.filePath], topics: [], visibility: "public", scheduledAt: null });
        if (frozen.sourceContentHash !== target.sourceContentHash
          || frozen.imageHashes[0] !== target.binding.imageSha256)
          throw new Error("DOUYIN_BODY_DIAGNOSTIC_CONTENT_BINDING_MISMATCH");
        const diagnostic = await adapter.inspectCurrentImageTextBodyReadOnly(
          accountContext(input.accountId, "douyin"), target.binding, target.expectedBody);
        const diagnosticDir = join(dataDirectory, "diagnostics");
        mkdirSync(diagnosticDir, { recursive: true });
        const evidencePath = join(diagnosticDir, `douyin-body-${job!.id}-${randomUUID()}.json`);
        writeFileSync(evidencePath, JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), diagnostic }), "utf8");
        capturedDouyinBodyDiagnosticJobs.add(job!.id);
        logger.info("ACCOUNT", "DOUYIN_BODY_DIAGNOSTIC_CAPTURED", "抖音图文只读正文诊断已保存", {
          accountId: input.accountId, jobId: job!.id, artifactPath: evidencePath,
          identityMode: diagnostic.identityVerificationMode, candidateCount: diagnostic.body.candidateCount });
      }
    }
    if (process.env.DOUYIN_MUSIC_DIAGNOSTIC_ENABLED === "true") {
      const configuredJobId = process.env.DOUYIN_MUSIC_DIAGNOSTIC_JOB_ID?.trim() ?? "";
      if (!capturedDouyinMusicDiagnosticJobs.has(configuredJobId)) {
        const job = configuredJobId ? repository.getJob(configuredJobId) : null;
        const target = selectDouyinMusicDiagnosticTarget({
          configuredAccountId: process.env.DOUYIN_MUSIC_DIAGNOSTIC_ACCOUNT_ID?.trim() ?? null,
          configuredJobId: configuredJobId || null, requestedAccountId: input.accountId, job,
          connection: repository.getDouyinImageTextConnection(input.accountId),
          intent: job ? repository.getSubmissionIntentByJob(job.id) : null,
          record: job ? repository.getPublishRecordByJob(job.id) : null
        });
        const diagnostic = await adapter.inspectCurrentImageTextMusicReadOnly(
          accountContext(input.accountId, "douyin"), target);
        const diagnosticDir = join(dataDirectory, "diagnostics");
        mkdirSync(diagnosticDir, { recursive: true });
        const evidencePath = join(diagnosticDir, `douyin-music-${target.jobId}-${randomUUID()}.json`);
        writeFileSync(evidencePath, JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), diagnostic }), "utf8");
        capturedDouyinMusicDiagnosticJobs.add(target.jobId);
        logger.info("ACCOUNT", "DOUYIN_MUSIC_DIAGNOSTIC_CAPTURED", "抖音图文只读音乐诊断已保存", {
          accountId: input.accountId, jobId: target.jobId, artifactPath: evidencePath,
          classification: diagnostic.music.classification });
      }
    }
    return readiness;
  });
  register("accounts:preflight-douyin-management", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    const account = repository.getAccountById(input.accountId, "douyin");
    if (!account || account.archivedAt || !repository.getDouyinImageTextConnection(input.accountId)?.active)
      throw new Error("Douyin Creator binding is unavailable");
    const adapter = registry.getForContent("douyin", "article");
    if (!(adapter instanceof DouyinImageTextBrowserAdapter)) throw new Error("Douyin image/text BrowserNative route is unavailable");
    const result = await adapter.preflightManagementReadOnly(accountContext(input.accountId, "douyin"));
    logger.info("ACCOUNT", "DOUYIN_MANAGEMENT_OWNED_PAGE_PREFLIGHT", "抖音同一受控 Page 的作品管理只读预检", {
      accountId: input.accountId, ready: result.ready, managementUrl: result.managementUrl,
      returnUrl: result.returnUrl, stateLabels: result.stateLabels, searchControlCount: result.searchControlCount,
      imageEntryCount: result.imageEntryCount });
    return result;
  });
  register("accounts:inspect-douyin-management", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    const binding = repository.getDouyinImageTextConnection(input.accountId);
    if (!binding?.active) throw new Error("Douyin Creator binding is unavailable");
    const adapter = registry.getForContent("douyin", "article");
    if (!(adapter instanceof DouyinImageTextBrowserAdapter)) throw new Error("Douyin image/text BrowserNative route is unavailable");
    const result = await adapter.inspectCurrentManagementPage(accountContext(input.accountId, "douyin"));
    logger.info("ACCOUNT", "DOUYIN_MANAGEMENT_READONLY_SMOKE", "抖音图文作品管理只读检查", {
      accountId: input.accountId, ready: result.ready, pageHost: result.pageHost, pagePath: result.pagePath,
      searchControlCount: result.searchControlCount, stateLabels: result.stateLabels, visibleRowCount: result.visibleRowCount });
    return result;
  });
  register("accounts:inspect-douyin-management-topology", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, jobId: idSchema }).parse(payload);
    if (process.env.DOUYIN_R1_14_READONLY_JOB_ID?.trim() !== input.jobId
      || process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim() !== input.accountId
      || process.env.DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED === "true")
      throw new Error("DOUYIN_R14_READONLY_RUNTIME_REQUIRED");
    const job = repository.getJob(input.jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const intent = repository.getSubmissionIntentByJob(input.jobId);
    const record = repository.getPublishRecordByJob(input.jobId);
    const account = repository.getAccountById(input.accountId, "douyin");
    const connection = repository.getDouyinImageTextConnection(input.accountId);
    if (!job || job.platformKey !== "douyin" || job.contentKind === "video"
      || job.accountId !== input.accountId || job.articleId !== process.env.DOUYIN_R1_ACCEPTANCE_ARTICLE_ID?.trim()
      || !article || !account || account.archivedAt || !connection?.active
      || !intent || intent.finalSubmitCount !== 1 || !intent.submitBoundaryEnteredAt
      || !intent.externalId || !/^\d{10,30}$/u.test(intent.externalId)
      || !record || record.jobId !== job.id || record.articleId !== article.id
      || record.accountId !== input.accountId || record.publishedExternalId !== intent.externalId)
      throw new Error("DOUYIN_R14_READONLY_TARGET_BINDING_INVALID");
    const adapter = registry.getForContent("douyin", "article");
    if (!(adapter instanceof DouyinImageTextBrowserAdapter)) throw new Error("DOUYIN_R14_READONLY_ADAPTER_UNAVAILABLE");
    const marker = /DYCORE[A-Za-z0-9]{4,32}/u.exec(article.body)?.[0];
    const result = await adapter.inspectManagementTopologyReadOnly(accountContext(input.accountId, "douyin"),
      intent.externalId, article.title, marker, intent.submitBoundaryEnteredAt ?? undefined);
    logger.info("ACCOUNT", "DOUYIN_MANAGEMENT_TOPOLOGY_READONLY", "抖音作品管理受控页面结构只读检查", {
      accountId: input.accountId, jobId: input.jobId, creatorId: result.creatorId, pagePath: result.pagePath,
      visibleAnchorCount: result.visibleAnchorCount, rowCandidateCount: result.rowCandidateCount,
      statusControlCount: result.statusControls.length, scrollContainerCount: result.scrollContainers.length });
    return result;
  });
  register("accounts:inspect-douyin-editor", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    const binding = repository.getDouyinImageTextConnection(input.accountId);
    if (!binding?.active) throw new Error("Douyin Creator binding is unavailable");
    const adapter = registry.getForContent("douyin", "article");
    if (!(adapter instanceof DouyinImageTextBrowserAdapter)) throw new Error("Douyin image/text BrowserNative route is unavailable");
    const result = await adapter.inspectCurrentImageEditor(accountContext(input.accountId, "douyin"));
    logger.info("ACCOUNT", "DOUYIN_EDITOR_READONLY_INSPECTION", "抖音图文编辑器只读检查", {
      accountId: input.accountId, pagePath: result.pagePath, creatorId: result.creatorId, imageCount: result.imageCount,
      imageLoaded: result.imageLoaded, titleLength: result.titleLength, bodyLength: result.bodyLength,
      visibility: result.settings?.visibility, timing: result.settings?.timing });
    return result;
  });
  register("accounts:close-runtime-session", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: z.literal("toutiao") }).parse(payload);
    return toutiaoSessionActivation.close(input.accountId);
  });
  register("toutiao:protocol-shadow", async (_event, payload) => {
    if (!protocolShadowEnabled(process.env)) throw new Error("TOUTIAO_PROTOCOL_SHADOW_DISABLED");
    const input = z.object({ accountId: idSchema, mode: z.enum(["HOME", "EDITOR", "SIGNER_CONTRACT", "SIGNER_INPUT", "BRIDGE", "CONTROLLED_ARTICLE_NEW"]).optional() }).parse(payload);
    const status = toutiaoSessionActivation.status(input.accountId);
    if (status.storedAuthorization !== "AUTHORIZED_SAVED" || status.runtimeState !== "ACTIVE") throw new Error("TOUTIAO_SHADOW_SESSION_UNAVAILABLE");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter)) throw new Error("TOUTIAO_SHADOW_BROWSER_ADAPTER_REQUIRED");
    if (input.mode === "CONTROLLED_ARTICLE_NEW") {
      if (process.env.TOUTIAO_ARTICLE_NEW_CAPTURE_ENABLED !== "true") throw new Error("TOUTIAO_ARTICLE_NEW_CAPTURE_DISABLED");
      claimControlledArticleNewCapture(dataDirectory);
    }
    return adapter.runReadOnlyProtocolShadow(accountContext(input.accountId, "toutiao"), input.mode);
  });
  register("toutiao:publish-request-capture", async (_event, payload) => {
    if (!protocolShadowEnabled(process.env) || process.env.TOUTIAO_PUBLISH_REQUEST_CAPTURE_ENABLED !== "true")
      throw new Error("TOUTIAO_PUBLISH_CAPTURE_DISABLED");
    const input = z.object({ accountId: idSchema }).parse(payload);
    const status = toutiaoSessionActivation.status(input.accountId);
    if (status.storedAuthorization !== "AUTHORIZED_SAVED" || status.runtimeState !== "ACTIVE"
      || !status.sessionExists || !status.contextExists || !status.canonicalPageExists || !status.contextOwnsPage || !status.pageAlive
      || status.pageHost !== "mp.toutiao.com") throw new Error("TOUTIAO_CAPTURE_SESSION_UNAVAILABLE");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter)) throw new Error("TOUTIAO_CAPTURE_BROWSER_ADAPTER_REQUIRED");
    claimControlledPublishRequestCapture(dataDirectory);
    return adapter.runGuardedPublishRequestCapture(accountContext(input.accountId, "toutiao"));
  });
  register("toutiao:production-readiness", async (_event, payload) => {
    const input = z.object({ accountId: idSchema }).parse(payload);
    const account = repository.getAccountById(input.accountId, "toutiao");
    const adapter = registry.getForContent("toutiao", "article");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter)) throw new Error("TOUTIAO_NATIVE_ROUTE_REQUIRED");
    const ctx = accountContext(input.accountId, "toutiao", createUserAction("OPEN_BACKEND"));
    const result = await runToutiaoProductionPreflight({ account,
      readonlyMode: process.env.TOUTIAO_READONLY_PREFLIGHT === "true",
      formalExecutionActive: repository.getGlobalFormalPublishExecution() !== null,
      activate: () => toutiaoSessionActivation.activate(input.accountId),
      auth: () => adapter.checkOwnedCreatorSession(ctx),
      identity: () => adapter.inspectOwnedCreatorIdentity(ctx),
      smoke: () => adapter.deepReconcileOwnedManagement(ctx, account?.externalAccountId ?? "", {
        title: "__read_only_readiness_no_submission__", submittedAt: new Date().toISOString(), remoteId: null })
    });
    return { ...result, mainCodeSha256: createHash("sha256").update(readFileSync(join(__dirname, "main.js"))).digest("hex"),
      formalSubmitEnabled: process.env.TOUTIAO_BROWSER_NATIVE_SUBMIT_ENABLED === "true",
      experimentalBrowserAssistedApiEnabled: process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED === "true" };
  });
  register("toutiao:mvp5-build-identity", () => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true") throw new Error("TOUTIAO_MVP5_ONE_SHOT_DISABLED");
    return { mainCodeSha256: createHash("sha256").update(readFileSync(join(__dirname, "main.js"))).digest("hex"),
      packageVersion: app.getVersion(), packaged: app.isPackaged };
  });
  register("toutiao:mvp5-binding-readiness", async (_event, payload) => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true" || !protocolShadowEnabled(process.env))
      throw new Error("TOUTIAO_MVP5_READINESS_DISABLED");
    const input = z.object({ accountId: idSchema, jobId: idSchema }).parse(payload);
    const expectedCreatorId = process.env.TOUTIAO_MVP5_EXPECTED_CREATOR_ID;
    if (input.accountId !== process.env.TOUTIAO_MVP5_ACCOUNT_ID || !expectedCreatorId || !/^\d+$/u.test(expectedCreatorId))
      throw new Error("TOUTIAO_MVP5_TARGET_IDENTITY_NOT_CONFIGURED");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter) || !(credentials instanceof SafeStorageCredentialStore))
      throw new Error("TOUTIAO_MVP5_RUNTIME_UNAVAILABLE");
    // Activation restores the saved account-owned Context but never touches the old capture ticket.
    const activation = await toutiaoSessionActivation.activate(input.accountId);
    const ctx = accountContext(input.accountId, "toutiao");
    const snapshot = adapter.getBrowserRuntimeSnapshot(ctx);
    const runtimeActive = activation.runtimeState === "ACTIVE" && activation.contextOwnsPage && activation.pageAlive;
    const remoteAuthState = runtimeActive ? await adapter.checkOwnedCreatorSession(ctx) : "UNKNOWN";
    const remoteCreatorId = runtimeActive && remoteAuthState === "VALID"
      ? await adapter.inspectOwnedCreatorIdentity(ctx) : null;
    const account = repository.getAccountById(input.accountId, "toutiao");
    const job = repository.getJob(input.jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const preparation = repository.getToutiaoArticlePreparation(input.jobId);
    const metadata = repository.getToutiaoCredentialMetadata(input.accountId);
    const intent = repository.getSubmissionIntentByJob(input.jobId);
    const record = repository.getPublishRecordByJob(input.jobId);
    const ticket = auditMvp5OneShotCapture(dataDirectory, {
      accountId: input.accountId, jobId: input.jobId, articleId: article?.id ?? "",
      contentBindingHash: preparation?.contentBindingHash ?? ""
    }, intent?.finalSubmitCount ?? 0);
    let bundle: ReturnType<ToutiaoCredentialBundleService["read"]> = null;
    let credentialReadError = false;
    try { bundle = new ToutiaoCredentialBundleService(credentials, repository).read(input.accountId); }
    catch { credentialReadError = true; }
    let runtimeCookiesChangedSinceBundle: boolean | null = null;
    if (runtimeActive && remoteAuthState === "VALID" && bundle && !credentialReadError) {
      try {
        const current = await adapter.snapshotOwnedCreatorCookies(ctx);
        runtimeCookiesChangedSinceBundle = credentialFingerprint({ ...bundle, cookieMaterial: current })
          !== credentialFingerprint(bundle);
      } catch { runtimeCookiesChangedSinceBundle = null; }
    }
    const result = evaluateMvp5CaptureReadiness({ expectedAccountId: input.accountId, expectedCreatorId,
      account, job, article, preparation, metadata, credentialReadError,
      bundle: bundle ? { version: bundle.version, loginGeneration: bundle.loginGeneration,
        sessionIdentity: bundle.sessionIdentity, state: bundle.state, validatedAt: bundle.validatedAt } : null,
      runtime: { accountId: input.accountId, runtimeState: activation.runtimeState,
        sessionExists: activation.sessionExists, contextExists: activation.contextExists,
        canonicalPageExists: activation.canonicalPageExists, contextOwnsPage: activation.contextOwnsPage,
        pageAlive: activation.pageAlive, pageHost: activation.pageHost, contextDebugId: snapshot.contextDebugId },
      remoteAuthState, remoteCreatorId, runtimeCookiesChangedSinceBundle, ticket,
      intentCount: intent ? 1 : 0, recordCount: record ? 1 : 0 });
    logger.info("TOUTIAO", "MVP5_BINDING_READINESS", "Read-only capture binding readiness", {
      accountId: input.accountId, jobId: input.jobId, ticketState: result.ticketState,
      reasonCodes: result.reasonCodes, recaptureEligibility: result.recaptureEligibility });
    return { ...result, ownerLoginRequired: activation.outcome === "OWNER_LOGIN_REQUIRED",
      runtimeState: activation.runtimeState, remoteAuthState,
      bundleVersion: metadata?.bundleVersion ?? null, loginGeneration: metadata?.loginGeneration ?? null };
  });
  register("toutiao:mvp5-management-diagnostic", async (_event, payload) => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true") throw new Error("TOUTIAO_MVP5_ONE_SHOT_DISABLED");
    const input = z.object({ accountId: idSchema }).parse(payload);
    const expectedCreatorId = process.env.TOUTIAO_MVP5_EXPECTED_CREATOR_ID;
    if (input.accountId !== process.env.TOUTIAO_MVP5_ACCOUNT_ID || !expectedCreatorId)
      throw new Error("TOUTIAO_MVP5_TARGET_IDENTITY_NOT_CONFIGURED");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter)) throw new Error("TOUTIAO_MVP5_RUNTIME_UNAVAILABLE");
    return adapter.inspectOwnedManagementList(accountContext(input.accountId, "toutiao"), expectedCreatorId, null);
  });
  register("toutiao:mvp5-runtime-preflight", async (_event, payload) => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true" || !protocolShadowEnabled(process.env))
      throw new Error("TOUTIAO_MVP5_ONE_SHOT_DISABLED");
    const input = z.object({ accountId: idSchema }).parse(payload);
    const expectedAccountId = process.env.TOUTIAO_MVP5_ACCOUNT_ID;
    const expectedCreatorId = process.env.TOUTIAO_MVP5_EXPECTED_CREATOR_ID;
    if (!expectedAccountId || input.accountId !== expectedAccountId || !expectedCreatorId || !/^\d+$/u.test(expectedCreatorId))
      throw new Error("TOUTIAO_MVP5_TARGET_IDENTITY_NOT_CONFIGURED");
    if (existsSync(join(dataDirectory, "diagnostics", "toutiao-mvp-5-one-shot.claim")))
      throw new Error("TOUTIAO_MVP5_CAPTURE_ALREADY_CLAIMED_READONLY_RECONCILIATION_ONLY");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter) || !(credentials instanceof SafeStorageCredentialStore))
      throw new Error("TOUTIAO_MVP5_RUNTIME_UNAVAILABLE");
    const activation = await toutiaoSessionActivation.activate(input.accountId);
    if (activation.runtimeState !== "ACTIVE" || !activation.contextOwnsPage || !activation.pageAlive
      || activation.pageHost !== "mp.toutiao.com") throw new Error("TOUTIAO_MVP5_SESSION_NOT_ACTIVE");
    const ctx = accountContext(input.accountId, "toutiao");
    const remoteAuthState = await adapter.checkOwnedCreatorSession(ctx);
    if (remoteAuthState !== "VALID") throw new Error("TOUTIAO_MVP5_REMOTE_AUTH_UNVERIFIED");
    const creatorId = await adapter.inspectOwnedCreatorIdentity(ctx);
    if (creatorId !== expectedCreatorId) throw new Error("TOUTIAO_MVP5_ACCOUNT_IDENTITY_MISMATCH");
    const management = await adapter.inspectOwnedManagementList(ctx, expectedCreatorId, null);
    if (!management.listStructureVerified || !management.accountIdentityVerified)
      throw new Error("TOUTIAO_MVP5_READONLY_RECONCILIATION_UNAVAILABLE");
    const backupDir = join(dataDirectory, "backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, `toutiao-mvp5-preflight-${new Date().toISOString().replace(/[:.]/gu, "-")}.db`);
    await backupDatabase(repository.db, backupPath);
    if (!validateDatabaseBackup(backupPath).valid) throw new Error("TOUTIAO_MVP5_BACKUP_FAILED");
    const binding = synchronizeOwnedToutiaoCredential(repository,
      new ToutiaoCredentialBundleService(credentials, repository), {
        accountId: input.accountId, creatorId, remoteAuthState, runtimeActive: true,
        contextOwnsPage: true, cookies: await adapter.snapshotOwnedCreatorCookies(ctx),
        validatedAt: new Date().toISOString()
      }, expectedCreatorId);
    return { sessionActive: true, accountIdentityMatch: true, managementListStructureVerified: true,
      blockedReadOnlySmokeMutations: management.blockedMutationCount,
      bundleVersion: binding.bundleVersion, loginGeneration: binding.loginGeneration,
      credentialChanged: binding.changed, backupVerified: true };
  });
  register("toutiao:mvp5-prepare-test-job", async (_event, payload) => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true" || !protocolShadowEnabled(process.env))
      throw new Error("TOUTIAO_MVP5_ONE_SHOT_DISABLED");
    const input = z.object({ accountId: idSchema }).parse(payload);
    if (input.accountId !== process.env.TOUTIAO_MVP5_ACCOUNT_ID
      || existsSync(join(dataDirectory, "diagnostics", "toutiao-mvp-5-one-shot.claim")))
      throw new Error("TOUTIAO_MVP5_TARGET_OR_QUOTA_INVALID");
    const expectedCreatorId = process.env.TOUTIAO_MVP5_EXPECTED_CREATOR_ID;
    const account = repository.getAccountById(input.accountId, "toutiao");
    const runtime = toutiaoSessionActivation.status(input.accountId);
    const metadata = repository.getToutiaoCredentialMetadata(input.accountId);
    const adapter = registry.getForConnection("toutiao");
    const backups = existsSync(join(dataDirectory, "backups"))
      ? readdirSync(join(dataDirectory, "backups")).filter((name) => name.startsWith("toutiao-mvp5-preflight-") && name.endsWith(".db")) : [];
    if (!expectedCreatorId || account?.externalAccountId !== expectedCreatorId
      || runtime.runtimeState !== "ACTIVE" || !runtime.contextOwnsPage || !runtime.pageAlive
      || !metadata || metadata.credentialState !== "VALID" || !metadata.validatedAt
      || !(adapter instanceof ToutiaoArticleBrowserAdapter)
      || !(credentials instanceof SafeStorageCredentialStore) || backups.length === 0
      || !validateDatabaseBackup(join(dataDirectory, "backups", backups.sort().at(-1)!)).valid)
      throw new Error("TOUTIAO_MVP5_PREPARE_PRECONDITION_FAILED");
    const ctx = accountContext(input.accountId, "toutiao");
    if (await adapter.checkOwnedCreatorSession(ctx) !== "VALID"
      || await adapter.inspectOwnedCreatorIdentity(ctx) !== expectedCreatorId)
      throw new Error("TOUTIAO_MVP5_PREPARE_IDENTITY_UNVERIFIED");
    new ToutiaoCredentialBundleService(credentials, repository).assertBound(input.accountId,
      metadata.bundleVersion, metadata.loginGeneration, "pre_submit");
    const existing = repository.listPlatformSelfTestRuns(account.platformAccountId ?? account.id)
      .find((run) => run.publishJobId && repository.getArticle(repository.getJob(run.publishJobId)?.articleId ?? "")?.title
        .startsWith("GMP头条单次测试"));
    if (existing?.publishJobId) return { jobId: existing.publishJobId, testRunId: existing.testRunId,
      articleId: repository.getJob(existing.publishJobId)?.articleId ?? null, reused: true };
    const run = repository.createPlatformSelfTestRun({ platformAccountId: account.platformAccountId ?? account.id,
      requestedLevel: "L5_PUBLISH" });
    repository.confirmPlatformSelfTestPublish(run.testRunId);
    const title = `GMP头条单次测试${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(2, 14)}`;
    const body = "本文仅用于验证 GEO Media Publisher 的单次发布与只读确认流程。室内环境治理服务应先评估现场条件，再依据实际检测结果制定方案。";
    const job = repository.createPlatformSelfTestPublishJob({ testRunId: run.testRunId, title, body, dryRun: false });
    repository.freezeToutiaoArticleSettings(job.id, { version: 1, coverMode: "none", coverImages: [],
      articleAdType: "none", remoteScheduledAt: null });
    prepareToutiaoArticleJob(repository, job.id);
    return { jobId: job.id, testRunId: run.testRunId, articleId: job.articleId, reused: false };
  });
  register("toutiao:mvp5-one-shot", async (_event, payload) => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true" || !protocolShadowEnabled(process.env))
      throw new Error("TOUTIAO_MVP5_ONE_SHOT_DISABLED");
    const input = z.object({ accountId: idSchema, jobId: idSchema }).parse(payload);
    const expectedCreatorId = process.env.TOUTIAO_MVP5_EXPECTED_CREATOR_ID;
    if (process.env.TOUTIAO_MVP5_ACCOUNT_ID !== input.accountId || !expectedCreatorId || !/^\d+$/u.test(expectedCreatorId))
      throw new Error("TOUTIAO_MVP5_TARGET_IDENTITY_NOT_CONFIGURED");
    const job = repository.getJob(input.jobId);
    if (!job || !job.articleId || job.accountId !== input.accountId || job.platformKey !== "toutiao")
      throw new Error("TOUTIAO_MVP5_JOB_ACCOUNT_MISMATCH");
    const testArticle = repository.getArticle(job.articleId);
    if (!testArticle || testArticle.source !== "test" || !testArticle.sourceNote?.startsWith("platform-self-test:")
      || !testArticle.title.startsWith("GMP头条单次测试") || job.dryRun)
      throw new Error("TOUTIAO_MVP5_TRANSPARENT_SELF_TEST_REQUIRED");
    const account = repository.getAccountById(input.accountId, "toutiao");
    const originalRunId = testArticle.sourceNote.slice("platform-self-test:".length);
    const originalRun = repository.getPlatformSelfTestRun(originalRunId);
    if (!account || !originalRun || originalRun.publishJobId !== job.id || originalRun.testArticleId !== testArticle.id
      || originalRun.platformAccountId !== (account.platformAccountId ?? account.id)
      || originalRun.platformKey !== "toutiao" || !originalRun.publishConfirmedAt)
      throw new Error("TOUTIAO_MVP53_ORIGINAL_PUBLISH_AUTHORIZATION_UNVERIFIED");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter) || !(credentials instanceof SafeStorageCredentialStore))
      throw new Error("TOUTIAO_MVP5_RUNTIME_UNAVAILABLE");
    if (repository.getAccountById(input.accountId, "toutiao")?.externalAccountId !== expectedCreatorId
      || await adapter.checkOwnedCreatorSession(accountContext(input.accountId, "toutiao")) !== "VALID"
      || await adapter.inspectOwnedCreatorIdentity(accountContext(input.accountId, "toutiao")) !== expectedCreatorId)
      throw new Error("TOUTIAO_MVP5_RUNTIME_IDENTITY_UNVERIFIED");
    const managementSmoke = await adapter.inspectOwnedManagementList(accountContext(input.accountId, "toutiao"), expectedCreatorId, null);
    if (!managementSmoke.listStructureVerified || !managementSmoke.accountIdentityVerified)
      throw new Error("TOUTIAO_MVP5_READONLY_RECONCILIATION_UNAVAILABLE");
    const sessionBound = (accountId: string): boolean => {
      const status = toutiaoSessionActivation.status(accountId);
      return status.accountId === accountId && status.storedAuthorization === "AUTHORIZED_SAVED"
        && status.runtimeState === "ACTIVE" && status.sessionExists && status.contextExists
        && status.canonicalPageExists && status.contextOwnsPage && status.pageAlive && status.pageHost === "mp.toutiao.com";
    };
    const service = new ToutiaoCapturedRequestOneShot(repository,
      new ToutiaoCredentialBundleService(credentials, repository), undefined, undefined, sessionBound,
      async (accountId) => {
        if (accountId !== input.accountId || !sessionBound(accountId)) throw new Error("TOUTIAO_MVP5_SESSION_CHANGED");
        const currentCtx = accountContext(accountId, "toutiao");
        if (await adapter.checkOwnedCreatorSession(currentCtx) !== "VALID"
          || await adapter.inspectOwnedCreatorIdentity(currentCtx) !== expectedCreatorId)
          throw new Error("TOUTIAO_MVP5_SESSION_IDENTITY_CHANGED");
        return adapter.snapshotOwnedCreatorCookies(currentCtx);
      }, (accountId) => accountId === input.accountId && sessionBound(accountId)
        ? adapter.getBrowserRuntimeSnapshot(accountContext(accountId, "toutiao")).contextDebugId : null);
    const preparation = repository.getToutiaoArticlePreparation(input.jobId);
    if (!preparation?.contentBindingHash) throw new Error("TOUTIAO_MVP5_PREPARATION_MISSING");
    const articleId = job.articleId;
    if (!articleId) throw new Error("TOUTIAO_MVP5_ARTICLE_MISSING");
    const contentBindingHash = preparation.contentBindingHash;
    if (!contentBindingHash) throw new Error("TOUTIAO_MVP5_PREPARATION_MISSING");
    const ticketBinding = { accountId: input.accountId, jobId: input.jobId, articleId, contentBindingHash };
    const predecessor = readMvp5LockedClaimEvidence(dataDirectory, ticketBinding);
    if (!predecessor || auditMvp5OneShotCapture(dataDirectory, ticketBinding, 0).state !== "LOCKED")
      throw new Error("TOUTIAO_MVP53_OLD_TICKET_NOT_LOCKED");
    if (existsSync(join(dataDirectory, "diagnostics", "toutiao-mvp-5-3-owner-recapture.claim"))
      || repository.getSubmissionIntentByJob(input.jobId) || repository.getPublishRecordByJob(input.jobId))
      throw new Error("TOUTIAO_MVP53_RECAPTURE_OR_SUBMIT_ALREADY_CLAIMED");
    const targetCheck = await adapter.inspectOwnedManagementList(accountContext(input.accountId, "toutiao"),
      expectedCreatorId, { title: testArticle.title, submittedAt: predecessor.claimedAt,
        remoteId: null, accountIdentityVerified: true });
    if (!targetCheck.listStructureVerified || !targetCheck.accountIdentityVerified || !targetCheck.match
      || targetCheck.structure.targetTitleAnchorCount > 0 || targetCheck.match.state !== "NOT_FOUND")
      throw new Error("TOUTIAO_MVP53_EXISTING_OR_UNVERIFIED_TARGET");
    const ownerConfirmation = await dialog.showMessageBox({
      type: "warning", title: "头条 MVP-5.3：重新捕获与单次发布确认",
      message: "请确认同一头条测试任务的唯一一次重新捕获与剩余发布额度",
      detail: `账号 ID：${input.accountId}\nCreator ID：${expectedCreatorId}\n原 Job：${input.jobId}\n原发布授权：platform-self-test:${originalRunId}\n文章：${testArticle.title}\n内容绑定 Hash：${contentBindingHash}\n旧票据：${predecessor.ticketId}\n\n仅新建一张 Capture 票据，旧票据保持锁定；article/new 最多一次，不存草稿、不上传。浏览器原 publish 请求必须中止，Main/Node 最多正式发送一次并只读回查。未知结果不重试、不回退浏览器。`,
      buttons: ["取消", "同意本次重新捕获及剩余一次发布"], cancelId: 0, defaultId: 0, noLink: true
    });
    if (ownerConfirmation.response !== 1) throw new Error("TOUTIAO_MVP53_OWNER_RECAPTURE_AUTHORIZATION_REQUIRED");
    const ownerApprovalReference = `main-dialog:${randomUUID()}`;
    const approvedAt = new Date().toISOString();
    await adapter.installMvp5PublishQuarantine(accountContext(input.accountId, "toutiao"));
    const result = await service.captureAndSubmit(input.jobId, accountContext(input.accountId, "toutiao"), adapter,
      () => {
        const currentIntent = repository.getSubmissionIntentByJob(input.jobId);
        const currentRecord = repository.getPublishRecordByJob(input.jobId);
        claimMvp53OwnerRecapture(dataDirectory, ticketBinding, { ownerApprovalReference, approvedAt,
          originalPublishAuthorizationReference: `platform-self-test:${originalRunId}`,
          finalSubmitCount: currentIntent?.finalSubmitCount ?? 0,
          intentCount: currentIntent ? 1 : 0, recordCount: currentRecord ? 1 : 0 });
      });
    if (result.bindingReasonCode) logger.warn("TOUTIAO", "MVP5_CAPTURE_BINDING_FAILED", "Captured request rejected before submit", {
      accountId: input.accountId, jobId: input.jobId, requestHash: result.requestHash,
      bindingReasonCode: result.bindingReasonCode });
    return result;
  });
  register("toutiao:mvp5-reconcile", async (_event, payload) => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true") throw new Error("TOUTIAO_MVP5_ONE_SHOT_DISABLED");
    const input = z.object({ accountId: idSchema, jobId: idSchema }).parse(payload);
    const expectedCreatorId = process.env.TOUTIAO_MVP5_EXPECTED_CREATOR_ID;
    if (input.accountId !== process.env.TOUTIAO_MVP5_ACCOUNT_ID || !expectedCreatorId)
      throw new Error("TOUTIAO_MVP5_TARGET_IDENTITY_NOT_CONFIGURED");
    const job = repository.getJob(input.jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const intent = repository.getSubmissionIntentByJob(input.jobId);
    const record = repository.getPublishRecordByJob(input.jobId);
    if (!job || job.platformKey !== "toutiao" || job.accountId !== input.accountId || !article
      || !intent || intent.finalSubmitCount !== 1 || !record)
      throw new Error("TOUTIAO_MVP5_RECONCILIATION_TARGET_INVALID");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter)) throw new Error("TOUTIAO_MVP5_RUNTIME_UNAVAILABLE");
    const activation = await toutiaoSessionActivation.activate(input.accountId);
    if (activation.runtimeState !== "ACTIVE" || !activation.contextOwnsPage || !activation.pageAlive)
      return { state: "UNKNOWN" as const, reasonCode: "SESSION_UNAVAILABLE" };
    const ctx = accountContext(input.accountId, "toutiao");
    if (await adapter.checkOwnedCreatorSession(ctx) !== "VALID"
      || await adapter.inspectOwnedCreatorIdentity(ctx) !== expectedCreatorId)
      return { state: "UNKNOWN" as const, reasonCode: "IDENTITY_UNVERIFIED" };
    try {
      const observed = await adapter.inspectOwnedManagementList(ctx, expectedCreatorId, {
        title: article.title, submittedAt: intent.submitBoundaryEnteredAt ?? intent.updatedAt,
        remoteId: intent.externalId, accountIdentityVerified: true
      });
      if (!observed.listStructureVerified || !observed.match)
        return { state: "UNKNOWN" as const, reasonCode: "MANAGEMENT_LIST_UNAVAILABLE" };
      const match = observed.match;
      if (match.state === "REVIEWING" && job.status === "NeedsReconciliation") {
        repository.reconcileJobAsSubmitted(job.id, { response: { readOnly: true, platformStatus: "REVIEWING",
          externalId: match.externalId, matchedRowCount: match.matchedRowCount } });
      }
      if (match.state === "PUBLISHED" && match.externalId && match.publicUrl) {
        const verification = await adapter.verifyOwnedPublicArticle(ctx, article,
          match.externalId, match.publicUrl);
        if (verification.verified) {
          repository.reconcileJobAsPublished(job.id, { externalId: match.externalId,
            publishedUrl: match.publicUrl, response: { readOnly: true, verified: true,
              urlReachable: true, titleMatch: true, bodyMatch: true } });
          return { state: "PUBLISHED_CONFIRMED" as const, reasonCode: "PUBLIC_PAGE_VERIFIED",
            externalId: match.externalId, publicUrl: match.publicUrl };
        }
        return { state: "UNKNOWN" as const, reasonCode: "PUBLIC_PAGE_UNVERIFIED",
          externalId: match.externalId, publicUrl: match.publicUrl };
      }
      return { state: match.state, reasonCode: match.state === "NOT_FOUND" ? "NO_MATCH_NOT_NEGATIVE_PROOF"
        : match.state === "AMBIGUOUS" ? "MULTIPLE_TARGET_ROWS" : "TARGET_ROW_CLASSIFIED",
        externalId: match.externalId, publicUrl: match.publicUrl };
    } catch {
      return { state: "UNKNOWN" as const, reasonCode: "READONLY_RECONCILIATION_ERROR" };
    }
  });
  /** Reconciliation-only: derives the target from the durable Job/Intent, never reaches capture or replay. */
  register("toutiao:mvp5-deep-reconcile-only", async (_event, payload) => {
    if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true") throw new Error("TOUTIAO_MVP5_ONE_SHOT_DISABLED");
    const input = z.object({ accountId: idSchema, jobId: idSchema }).parse(payload);
    const expectedCreatorId = process.env.TOUTIAO_MVP5_EXPECTED_CREATOR_ID;
    if (input.accountId !== process.env.TOUTIAO_MVP5_ACCOUNT_ID || !expectedCreatorId)
      throw new Error("TOUTIAO_RECONCILIATION_TARGET_IDENTITY_NOT_CONFIGURED");
    const job = repository.getJob(input.jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const intent = repository.getSubmissionIntentByJob(input.jobId);
    if (!job || job.platformKey !== "toutiao" || job.accountId !== input.accountId || !article
      || !intent || intent.finalSubmitCount !== 1)
      throw new Error("TOUTIAO_RECONCILIATION_TARGET_INVALID");
    const adapter = registry.getForConnection("toutiao");
    if (!(adapter instanceof ToutiaoArticleBrowserAdapter)) throw new Error("TOUTIAO_RECONCILIATION_RUNTIME_UNAVAILABLE");
    const activation = await toutiaoSessionActivation.activate(input.accountId);
    if (activation.runtimeState !== "ACTIVE" || !activation.contextOwnsPage || !activation.pageAlive)
      throw new Error("TOUTIAO_RECONCILIATION_SESSION_UNAVAILABLE");
    const ctx = accountContext(input.accountId, "toutiao");
    if (await adapter.checkOwnedCreatorSession(ctx) !== "VALID"
      || await adapter.inspectOwnedCreatorIdentity(ctx) !== expectedCreatorId)
      throw new Error("TOUTIAO_RECONCILIATION_IDENTITY_UNVERIFIED");
    const result = await adapter.deepReconcileOwnedManagement(ctx, expectedCreatorId, {
      title: article.title, submittedAt: intent.submitBoundaryEnteredAt ?? intent.updatedAt,
      remoteId: intent.externalId && intent.externalId !== "0" ? intent.externalId : null
    });
    const match = result.match;
    const publicVerification = match.state === "PUBLISHED" && match.externalId && match.publicUrl
      ? await adapter.verifyOwnedPublicArticle(ctx, article, match.externalId, match.publicUrl) : null;
    const finalState = publicVerification?.verified ? "PUBLISHED_CONFIRMED"
      : match.state === "REVIEWING" ? "FOUND_REVIEWING"
        : match.state === "REJECTED" ? "FOUND_REJECTED"
          : match.state === "DRAFT" ? "FOUND_DRAFT"
            : match.state !== "NOT_FOUND" ? "FOUND_OTHER_REMOTE_STATE" : "NEEDS_RECONCILIATION";
    return { ...result, finalState, accountIdentityMatch: true, publicVerification };
  });
  register("accounts:pre-submit-gate", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const adapter = registry.getForConnection(input.platformKey);
    if (!isAutomationAdapter(adapter) || !adapter.inspectPublishEditor) throw new Error("该平台没有 side-effect-free 编辑器 Gate 能力");
    return adapter.inspectPublishEditor(accountContext(input.accountId, input.platformKey, createUserAction("PRE_SUBMIT_GATE")));
  });
  const readCredentialStatus = (accountId: string, platformKey: string): { configured: boolean; expired: boolean; fields: Array<CredentialField & { configured: boolean }> } => {
    const account = repository.listAccounts().find((item) => item.id === accountId);
    if (!account || account.platformKey !== platformKey) throw new Error("账号与平台不匹配");
    const adapter = registry.tryGet(platformKey);
    if (!adapter) return { configured: false, expired: account.loginStatus === "expired", fields: [] };
    const fields = adapter.getCredentialSchema().map((field) => ({ ...field, configured: field.type === "browser_login" && adapter.manifest.transport === "browser" ? credentials.has(browserSessionCredentialKey({ platformKey, accountId })) : credentials.has(`account:${accountId}:${platformKey}:${field.key}`) }));
    return { configured: fields.filter((field) => field.required).every((field) => field.configured), expired: account.loginStatus === "expired", fields };
  };
  register("accounts:overview", async () => {
    const platforms = listPlatformViews();
    const records = repository.getPublishRecords();
    const lastDryRunAt = new Map<string, string>();
    for (const record of records) {
      if (!(record.dryRun === true || record.status === "DryRun") || !record.success) continue;
      const key = `${record.accountId}:${record.platformKey}`;
      if (!lastDryRunAt.has(key)) lastDryRunAt.set(key, record.publishedAt);
    }
    return Promise.all(repository.listAccounts().filter(account => workspace.accountAllowed(account.id)).map(async (account) => {
      const registeredAdapter = registry.tryGetForConnection(account.platformKey);
      const douyinImageTextAdapter = account.platformKey === "douyin" ? registry.getForContent("douyin", "article") : null;
      const douyinImageTextConnection = account.platformKey === "douyin" ? repository.getDouyinImageTextConnection(account.id) : null;
      let douyinCreatorVerified = false;
      if (!sessionRuntime && douyinImageTextConnection?.active && douyinImageTextAdapter instanceof DouyinImageTextBrowserAdapter) {
        try {
          const readiness = await douyinImageTextAdapter.inspectOwnedCreatorReadiness(accountContext(account.id, "douyin"));
          douyinCreatorVerified = readiness.identityVerified && readiness.contextOwnership && readiness.sessionExists
            && readiness.browserConnected === true && readiness.canonicalPageExists && readiness.canonicalPageClosed === false
            && readiness.canonicalPageContextMatchesSession === true && readiness.runtimeAuthState === "AUTHENTICATED";
        } catch (error) {
          logger.warn("ACCOUNT", "DOUYIN_IMAGE_TEXT_READINESS_FAILED", "抖音图文账号身份复核未通过", {
            accountId: account.id, errorCode: safeErrorCode(error) });
        }
      }
      const douyinImageTextRuntime = douyinImageTextAdapter && isAutomationAdapter(douyinImageTextAdapter)
        ? douyinImageTextAdapter.getBrowserRuntimeState?.(accountContext(account.id, "douyin"))?.state : null;
      const toutiaoRuntime = account.platformKey === "toutiao" ? toutiaoSessionActivation.status(account.id) : null;
      const browserConnecting = registeredAdapter ? isAutomationAdapter(registeredAdapter) && registeredAdapter.isConnectionPending(accountContext(account.id, account.platformKey)) : false;
      const sessionSnapshot = safeRuntimeSnapshot(account.id, account.platformKey);
      const runtimeAuthState = sessionRuntime ? sessionSnapshot?.state ?? "CHECKING" : account.platformKey === "xiaohongshu" && registeredAdapter && isAutomationAdapter(registeredAdapter)
        ? registeredAdapter.getBrowserRuntimeState?.(accountContext(account.id, account.platformKey))?.state ?? null
        : null;
      const accountStatus: AccountStatus = sessionRuntime ? ["AUTHENTICATED", "CONNECTED"].includes(runtimeAuthState ?? "") ? "Connected" : runtimeAuthState === "CHECKING" ? "Connecting" : runtimeAuthState === "NEEDS_LOGIN" ? "NeedsLogin" : runtimeAuthState === "CREDENTIAL_INVALID" ? "Expired" : ["NETWORK_UNAVAILABLE", "IDENTITY_MISMATCH"].includes(runtimeAuthState ?? "") ? "Error" : "Unverified" : account.platformKey === "douyin"
        ? douyinCreatorVerified ? "Connected" : "Unverified"
        : account.platformKey === "toutiao" && account.loginStatus === "logged_in"
        ? toutiaoRuntime?.runtimeState === "ACTIVE" ? "Connected" : "Unverified"
        : account.platformKey === "xiaohongshu"
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
      imageTextCreatorReady: Boolean(douyinImageTextConnection?.active && (sessionRuntime ? runtimeAuthState === "AUTHENTICATED" && sessionSnapshot?.loginGeneration === douyinImageTextConnection.loginGeneration : douyinCreatorVerified && douyinImageTextRuntime === "AUTHENTICATED")),
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
    }));
  });
  register("accounts:create", (_event, payload) => { const companyId = workspace.current(); if (!companyId) throw new Error("请先选择企业工作区"); const account = repository.createAccount(z.object({ platformKey: idSchema, name: z.string().min(1), accountAlias: z.string().trim().min(1).max(100).optional(), allowAutoPublish: z.boolean().optional(), publishMode: z.enum(["inherit", "manual", "auto", "assisted"]).optional() }).parse(payload)); operations.bindAccount({ companyId, accountId: account.id }); return account; });
  register("accounts:update", (_event, payload) => { const input = z.object({ id: idSchema, data: z.object({ accountAlias: z.string().trim().min(1).max(100).optional(), enabled: z.boolean().optional(), loginStatus: z.enum(["logged_in", "logged_out", "expired", "needs_user_action", "unknown"]).optional(), pausedReason: z.string().nullable().optional(), allowAutoPublish: z.boolean().optional(), publishMode: z.enum(["inherit", "manual", "auto", "assisted"]).optional(), minimumIntervalSeconds: z.number().int().min(0).max(86400).optional() }) }).parse(payload); const account = repository.getAccountById(input.id); if (!account) throw new Error("账号不存在"); invalidateAccountAuthBoundary(repository,input.id,account.platformKey);sessionRuntime?.invalidate(input.id, account.platformKey);oauthSessions.invalidate(input.id,account.platformKey); return repository.updateAccount(input.id, input.data); });
  register("accounts:set-credentials", (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, values: z.record(z.string(), z.string().max(8192)) }).parse(payload);
    if (input.platformKey === "website") throw new Error("官网凭据须通过 Main 安全文件导入入口配置");
    accountContext(input.accountId, input.platformKey);
    const adapter = registry.get(input.platformKey);
    const allowed = new Set(adapter.getCredentialSchema().map((field) => field.key));
    for (const [key, value] of Object.entries(input.values)) {
      if (!allowed.has(key)) throw new Error(`不允许的凭据字段：${key}`);
      if (value.trim()) credentials.set(`account:${input.accountId}:${input.platformKey}:${key}`, value.trim());
    }
    invalidateAccountAuthBoundary(repository,input.accountId,input.platformKey);sessionRuntime?.invalidate(input.accountId, input.platformKey);oauthSessions.invalidate(input.accountId,input.platformKey);
    const fields = adapter.getCredentialSchema().map((field) => ({ ...field, configured: credentials.has(`account:${input.accountId}:${input.platformKey}:${field.key}`) }));
    return { configured: fields.filter((field) => field.required).every((field) => field.configured), fields };
  });
  register("accounts:credential-status", (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    return readCredentialStatus(input.accountId, input.platformKey);
  });
  register("website:list-connections", () => repository.listAccounts().filter(account => account.platformKey === "website" && !account.archivedAt && workspace.accountAllowed(account.id))
    .map(account => {
      const view = officialApiAccountView(repository, credentials, account.id);
      const runtime = safeRuntimeSnapshot(account.id, "website");
      return view.configured && runtime?.state === "CONNECTED" && runtime.identityMatched
        ? { ...view, status: "CONNECTED" as const, writesEnabled: true, lastVerifiedAt: runtime.checkedAt }
        : view;
    }));
  register("website:availability", () => deps.officialApi?.availability() ?? { ordinaryEnabled: false, candidateSelections: [] });
  register("website:image-choices", (_event, payload) => {
    const { articleId } = z.strictObject({ articleId: idSchema }).parse(payload);
    const article = repository.getArticle(articleId);
    if (!article || repository.getBrand(article.brandId)?.companyName !== "江苏康一环保科技有限公司") throw new Error("WEBSITE_KANGYI_BRAND_REQUIRED");
    return repository.listImageAssets().filter(value => value.enabled && (value.brandId === article.brandId || value.universal))
      .map(({ id, brandId, universal, enabled, name }) => ({ id, brandId, universal, enabled, name }));
  });
  register("website:job-state", (_event, payload) => {
    const { jobId } = z.strictObject({ jobId: idSchema }).parse(payload);
    return deps.officialApi?.jobState(jobId) ?? null;
  });
  register("website:recover", (_event, payload) => {
    const { jobId } = z.strictObject({ jobId: idSchema }).parse(payload);
    if (!deps.officialApi) throw new Error("WEBSITE_MAIN_CONTROLLER_UNAVAILABLE");
    return deps.officialApi.recover(jobId);
  });
  register("website:maintain", (_event, payload) => {
    const input = z.strictObject({ jobId: idSchema, operation: z.enum(["unpublish", "delete", "restore", "purge"]) }).parse(payload);
    if (!deps.officialApi) throw new Error("WEBSITE_MAIN_CONTROLLER_UNAVAILABLE");
    return deps.officialApi.maintain(input);
  });
  register("website:import-credentials", async (_event, payload) => {
    const input = z.strictObject({ environment: z.enum(["staging", "production"]), accountId: idSchema.optional() }).parse(payload);
    const selectedCompany = workspace.current();
    if (!selectedCompany) throw new Error("请先选择企业工作区");
    const picked = await dialog.showOpenDialog({ title: `安全导入康一官网 ${input.environment} 凭据`, properties: ["openFile"],
      filters: [{ name: "本机受控凭据配置", extensions: ["json"] }] });
    if (picked.canceled || picked.filePaths.length !== 1) throw new Error("WEBSITE_CREDENTIAL_IMPORT_CANCELLED");
    const path = picked.filePaths[0]!;
    let raw: string;
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 16 * 1024 || stat.size < 1) throw new Error("Invalid file");
      const bytes = readFileSync(path);
      if (bytes.length > 16 * 1024 || bytes.length < 1) throw new Error("Invalid file");
      raw = bytes.toString("utf8");
    } catch { throw new Error("WEBSITE_CREDENTIAL_FILE_INVALID"); }
    // File bytes and the secret never pass through Renderer or IPC payloads.
    const result = await importOfficialApiCredential({ repository, credentials,
      assertBeforePersist: () => workspace.assertCompany(selectedCompany), bindAccount: accountId => operations.bindAccount({ companyId: selectedCompany, accountId }),
       assertReconfiguration: (accountId, config) => deps.officialApi?.assertCredentialReconfiguration(accountId, config) }, raw, input.environment, input.accountId);
    invalidateAccountAuthBoundary(repository,result.accountId,'website');sessionRuntime?.invalidate(result.accountId,'website');oauthSessions.invalidate(result.accountId,'website');
    logger.info("ACCOUNT", "WEBSITE_CREDENTIAL_IMPORTED", "官网签名凭据已安全导入", {
      accountId: result.accountId, siteId: result.siteId, environment: result.environment, configured: result.configured });
    return result;
  });
  register("website:verify-connection", async (_event, payload) => {
    const { accountId } = z.strictObject({ accountId: idSchema }).parse(payload);
    return verifyOfficialApiConnection({ repository, credentials }, accountId);
  });
  register("accounts:begin-login", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, contentKind: z.enum(["article", "video"]).optional() }).parse(payload);
    if (input.contentKind && (input.platformKey !== "douyin" || input.contentKind !== "article")) throw new Error("Unsupported content-specific account login route");
    const adapter = input.contentKind === "article" ? registry.getForContent("douyin", "article") : registry.getForConnection(input.platformKey);
    const action = createUserAction("CONNECT_ACCOUNT");
    if (input.platformKey === "cnblogs") {
      const assertCurrent=startAuthRequest(input.accountId,input.platformKey);
      const status = await authIo(assertCurrent,()=>adapter.checkLogin(accountContext(input.accountId, input.platformKey, action)));
      if (status === "logged_in") repository.syncOfficialApiAccount({ accountId: input.accountId, platformKey: input.platformKey, lastVerifiedAt: new Date().toISOString(),enabled:repository.getAccountById(input.accountId,input.platformKey)?.enabled });
      else repository.updateAccount(input.accountId, { loginStatus: status, pausedReason: status === "expired" ? "博客园 PAT 已失效" : status === "logged_out" ? "请先配置博客园 PAT" : "博客园连接需要处理" });
      return { sessionId: `cnblogs-pat-${Date.now()}`, requiresUserAction: status !== "logged_in", opened: false, authStrategy: adapter.manifest.authStrategy, callbackStrategy: adapter.manifest.callbackStrategy, message: status === "logged_in" ? "博客园 PAT 连接验证通过" : "博客园 PAT 尚未通过连接验证" };
    }
    if (isAutomationAdapter(adapter)) {
      const assertCurrent=startAuthRequest(input.accountId,input.platformKey);
      if (input.contentKind !== "article") repository.updateAccount(input.accountId, { loginStatus: "needs_user_action", pausedReason: "等待用户在官方浏览器完成登录和安全验证" });
      try {
        return await authIo(assertCurrent,()=>adapter.connectAccount(accountContext(input.accountId, input.platformKey, action)));
      } catch (error) {
        assertCurrent();
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
    const input = z.object({ accountId: idSchema, platformKey: idSchema, contentKind: z.enum(["article", "video"]).optional(), callbackUrl: z.string().max(8192), pendingLogin: z.object({ accountId: idSchema, platformKey: idSchema, contentKind: z.enum(["article", "video"]).optional() }).optional() }).parse(payload);
    if (input.contentKind && (input.platformKey !== "douyin" || input.contentKind !== "article")) throw new Error("Unsupported content-specific account login route");
    const action = createUserAction("CONNECT_ACCOUNT");
    logger.info("ACCOUNT", "COMPLETE_LOGIN_REQUEST", "收到 Renderer 完成登录请求", { platformKey: input.platformKey, accountId: input.accountId, userActionId: action.userActionId, pendingLogin: input.pendingLogin ?? null, timestamp: new Date().toISOString() });
    if (input.pendingLogin && (input.pendingLogin.accountId !== input.accountId || input.pendingLogin.platformKey !== input.platformKey || input.pendingLogin.contentKind !== input.contentKind)) {
      logger.warn("ACCOUNT", "COMPLETE_LOGIN_ACCOUNT_ID_MISMATCH", "Renderer pendingLogin 与 IPC 请求不一致，已停止 Adapter 调查", { requestedAccountId: input.accountId, requestedPlatformKey: input.platformKey, pendingLoginAccountId: input.pendingLogin.accountId, pendingLoginPlatformKey: input.pendingLogin.platformKey, userActionId: action.userActionId });
      logger.info("ACCOUNT", "COMPLETE_CONNECTION_ENTERED", "Adapter 未进入：Renderer accountId mismatch", { entered: false, accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId });
      throw new Error("COMPLETE_LOGIN_ACCOUNT_ID_MISMATCH: Renderer pendingLogin 与请求账号不一致");
    }
    const adapter = input.contentKind === "article" ? registry.getForContent("douyin", "article") : registry.getForConnection(input.platformKey);
    if (isAutomationAdapter(adapter)) {
      let assertCurrent=startAuthRequest(input.accountId,input.platformKey);
      const completedContext = accountContext(input.accountId, input.platformKey, action);
      const debugState = adapter.getBrowserConnectionDebugState?.(completedContext);
      logger.info("ACCOUNT", "ACTIVE_LOGIN_SESSION_STATE", "complete-login 调用 Adapter 前的 active Session 状态", { timestamp: new Date().toISOString(), ...(debugState ?? { requestedAccountId: input.accountId, activeSessionKeys: [], targetSessionFound: false, targetSessionState: "MISSING" }) });
      logger.info("ACCOUNT", "COMPLETE_CONNECTION_ENTERED", "即将调用 Adapter.completeConnection", { entered: true, accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, targetSessionFound: debugState?.targetSessionFound ?? false });
      let status: Awaited<ReturnType<typeof adapter.completeConnection>>;
      try {
        status = await authIo(assertCurrent,()=>adapter.completeConnection(completedContext));
      } catch (error) {
        logger.warn("ACCOUNT", "COMPLETE_LOGIN_RESPONSE", "Adapter.completeConnection 返回错误", { accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, status: null, reason: error instanceof Error ? error.message.slice(0, 300) : "unknown", errorCode: safeErrorCode(error) });
        throw error;
      }
      if (status !== "logged_in") {
        if (input.contentKind !== "article") repository.updateAccount(input.accountId, { loginStatus: "needs_user_action", pausedReason: "浏览器仍停留在登录或安全验证页面" });
        const result = { configured: false, accountStatus: "NeedsLogin" as const, authorizationStatus: "Unknown" as const, accountId: null, accountName: null, scopes: [], expiresAt: null };
        logger.info("ACCOUNT", "COMPLETE_LOGIN_RESPONSE", "主进程完成登录结果", { accountId: input.accountId, platformKey: input.platformKey, userActionId: action.userActionId, status, reason: "CHECK_LOGIN_NOT_PASSED", errorCode: null, resultContract: { configured: result.configured, accountStatus: result.accountStatus, authorizationStatus: result.authorizationStatus } });
        return result;
      }
      const profile = adapter.getAccountProfile ? await authIo(assertCurrent,()=>adapter.getAccountProfile!(completedContext)) : undefined;
      if (input.platformKey === "douyin" && input.contentKind === "article") {
        const imageTextAdapter = adapter instanceof DouyinImageTextBrowserAdapter ? adapter : null;
        if (!imageTextAdapter) throw new Error("Douyin image/text BrowserNative route is unavailable");
        if (!profile?.accountId) throw new Error("Douyin Creator stable identity is required");
        const prior = repository.getDouyinImageTextConnection(input.accountId);
        if (prior?.active && prior.creatorId !== profile.accountId)
          throw new Error("Douyin Creator identity changed; disconnect the old image-text binding before connecting another account");
        await authIo(assertCurrent,async()=>adapter.persistConnectionSession?.(completedContext));
        const sessionEvidence = await authIo(assertCurrent,async()=>adapter.getBrowserSessionEvidence?.(completedContext));
        if (!sessionEvidence || sessionEvidence.accountId !== input.accountId || sessionEvidence.platformKey !== "douyin")
          throw new Error("Douyin account-scoped Browser Session evidence is missing");
        const binding = repository.saveDouyinImageTextConnection({ accountId: input.accountId,
          creatorId: profile.accountId, browserSessionIdHash: sessionEvidence.sessionIdHash });
        await authIo(assertCurrent,async()=>adapter.releaseConnectionPage?.(completedContext));
        const readiness = await authIo(assertCurrent,()=>imageTextAdapter.inspectOwnedCreatorReadiness(accountContext(input.accountId, "douyin")));
        if (!readiness.identityVerified || readiness.runtimeAuthState !== "AUTHENTICATED")
          throw new Error("Douyin Creator identity was not verified in the active owned session after binding");
        logger.info("ACCOUNT", "DOUYIN_IMAGE_TEXT_LOGIN_VERIFIED", "抖音图文账号身份和受控浏览器会话已绑定", {
          accountId: input.accountId, creatorId: profile.accountId, loginGeneration: binding.loginGeneration,
          browserSessionIdHash: sessionEvidence.sessionIdHash });
        return browserAccountConnectionResult(repository.getAccountById(input.accountId, "douyin")!);
      }
      const archivedAccount = profile?.accountId ? repository.findArchivedAccountByExternalIdForConnection(input.accountId, input.platformKey, profile.accountId) : null;
      const effectiveAccountId = archivedAccount?.id ?? input.accountId;
      const effectiveContext = effectiveAccountId === input.accountId ? completedContext : accountContext(effectiveAccountId, input.platformKey, action, true);
      if (archivedAccount) {
        if(operations.accountCompany(archivedAccount.id)!==operations.accountCompany(input.accountId))throw new Error('ARCHIVED_ACCOUNT_COMPANY_REVIEW_REQUIRED');
        if (!adapter.rebindAccountSession) throw new Error("无法安全恢复归档账号：Adapter 不支持 Session 重绑定");
        repository.restoreArchivedAccountByExternalId(input.platformKey, profile?.accountId ?? "");
        adapter.rebindAccountSession(completedContext, effectiveContext);
      }
      const assertEffective=captureAccountAuthBoundary(repository,effectiveAccountId,input.platformKey),assertBeforeSync=()=>{assertCurrent();assertEffective();};
      await authIo(assertBeforeSync,async()=>adapter.persistConnectionSession?.(effectiveContext));
      const synced = await syncBrowserAccount(adapter, effectiveAccountId, input.platformKey, action, assertBeforeSync,profile);synced.assertCurrent();const account=synced.account;
      if (archivedAccount) repository.markPlatformAccountDisconnected(input.accountId, input.platformKey, adapter.manifest.authStrategy);
      assertCurrent=synced.assertCurrent;
      const sessionEvidence = await authIo(assertCurrent,async()=>adapter.getBrowserSessionEvidence?.(effectiveContext));
      if (adapter.releaseConnectionPage) await authIo(assertCurrent,()=>adapter.releaseConnectionPage!(effectiveContext));
      else await authIo(assertCurrent,async()=>adapter.releaseConnectionSession?.(effectiveContext));
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
      const assertCurrent=startAuthRequest(input.accountId,input.platformKey);
      const status = await authIo(assertCurrent,()=>adapter.checkSession(accountContext(input.accountId, input.platformKey, action)));
      if (status !== "logged_in") throw new Error("浏览器 Session 仍需用户完成登录");
      const synced=await syncBrowserAccount(adapter, input.accountId, input.platformKey, action,assertCurrent);synced.assertCurrent();
      return { accountStatus: "Connected" as const, authorizationStatus: "Authorized" as const, expiresAt: null };
    }
    return oauthSessions.refresh(input.accountId, input.platformKey);
  });
  register("accounts:cancel-login", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, contentKind: z.literal("article").optional() }).parse(payload);
    if (input.contentKind && input.platformKey !== "douyin") throw new Error("Unsupported content-specific account login route");
    const adapter = input.contentKind === "article" ? registry.getForContent("douyin", "article") : registry.getForConnection(input.platformKey);
    if (!isAutomationAdapter(adapter) || !adapter.cancelConnection) throw new Error("该平台没有可取消的浏览器连接会话");
    const assertCurrent=startAuthRequest(input.accountId,input.platformKey);
    await authIo(assertCurrent,()=>adapter.cancelConnection!(accountContext(input.accountId, input.platformKey, createUserAction("CONNECT_ACCOUNT"))));
    if (input.contentKind === "article") return { loginStatus: repository.getAccountById(input.accountId, input.platformKey)?.loginStatus ?? "unknown" };
    repository.updateAccount(input.accountId, { loginStatus: "logged_out", pausedReason: "连接已取消" });
    return { loginStatus: "logged_out" as const };
  });
  register("accounts:disconnect", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema }).parse(payload);
    const account = repository.getAccountById(input.accountId, input.platformKey);
    if (!account) throw new Error("账号与平台不匹配");
    const assertCurrent=startAuthRequest(input.accountId,input.platformKey);oauthSessions.invalidate(input.accountId,input.platformKey);
    const adapter = registry.getForConnection(input.platformKey);
    const action = createUserAction("CONNECT_ACCOUNT");
    if (input.platformKey === "douyin") {
      const imageAdapter = registry.getForContent("douyin", "article");
      if (isAutomationAdapter(imageAdapter)) await authIo(assertCurrent,()=>imageAdapter.logout(accountContext(input.accountId, "douyin", action, true)));
      assertCurrent();
      repository.disconnectDouyinImageTextConnection(input.accountId);
    }
    let result: AccountDisconnectResult;
    if (isAutomationAdapter(adapter)) {
      const context = accountContext(input.accountId, input.platformKey, action, true);
      const activeSession = adapter.getBrowserConnectionDebugState?.(context)?.targetSessionFound ?? false;
      result = browserAccountDisconnectResult({ loginStatus: account.loginStatus, credentialPresent: credentials.has(browserSessionCredentialKey({ platformKey: input.platformKey, accountId: input.accountId })), activeSession, archived: account.archivedAt != null });
      await authIo(assertCurrent,()=>adapter.logout(context));
      assertCurrent();
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
    if (sessionRuntime) {
      const target = sessionTarget(input.accountId);
      if (!target || target.platformKey !== input.platformKey) throw new Error("账号与平台不匹配");
      const snapshot = await sessionRuntime.refresh(target, "MANUAL");
      return { loginStatus: ["AUTHENTICATED", "CONNECTED"].includes(snapshot.state) ? "logged_in" as const : snapshot.state === "CREDENTIAL_INVALID" || snapshot.state === "NEEDS_LOGIN" ? "expired" as const : "unknown" as const };
    }
    const action = createUserAction("CHECK_LOGIN");
    const adapter = registry.getForConnection(input.platformKey);
    const consumeCheckLoginOperationId = (): string | null => {
      if (input.platformKey !== "xiaohongshu") return null;
      const diagnosticAdapter = adapter as unknown as { consumeCompletedCheckLoginOperationId?: (accountId: string) => string | null };
      return diagnosticAdapter.consumeCompletedCheckLoginOperationId?.(input.accountId) ?? null;
    };
    let operationId: string | null = null;
    const assertCurrent=startAuthRequest(input.accountId,input.platformKey);
    try {
      const status = await authIo(assertCurrent,()=>adapter.checkLogin(accountContext(input.accountId, input.platformKey, action)));
      operationId = consumeCheckLoginOperationId();
      if (status === "logged_in" && isAutomationAdapter(adapter)) {
        const synced=await syncBrowserAccount(adapter, input.accountId, input.platformKey, action,assertCurrent);synced.assertCurrent();
      }
      else if (status === "logged_in" && input.platformKey === "cnblogs") {
        const profile = adapter.getAccountProfile ? await authIo(assertCurrent,()=>adapter.getAccountProfile!(accountContext(input.accountId, input.platformKey, action))) : undefined;
        repository.syncOfficialApiAccount({ accountId: input.accountId, platformKey: input.platformKey, accountName: profile?.accountName, externalAccountId: profile?.accountId, lastVerifiedAt: new Date().toISOString(),enabled:repository.getAccountById(input.accountId,input.platformKey)?.enabled });
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
  register("platform-self-test:continue", async (_event, payload) => platformSelfTests.continue(z.object({ testRunId: idSchema }).parse(payload).testRunId));
  register("platform-self-test:run-level", async (_event, payload) => { const input = z.object({ platformAccountId: idSchema, level: z.enum(["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT", "L5_PUBLISH"]) }).parse(payload); return platformSelfTests.runLevel(input.platformAccountId, input.level); });
  register("platform-self-test:health-check", async () => platformSelfTests.healthCheckConnectedAccounts());
  register("platform-self-test:request-publish", (_event, payload) => platformSelfTests.requestPublish(z.object({ platformAccountId: idSchema }).parse(payload).platformAccountId));
  register("platform-self-test:confirm-publish", async (_event, payload) => { const input = z.object({ testRunId: idSchema, testVideoPath: z.string().max(8192).optional() }).parse(payload); return platformSelfTests.confirmPublish(input.testRunId, input.testVideoPath); });
  register("platform-self-test:cancel-publish", (_event, payload) => platformSelfTests.cancelPublish(z.object({ testRunId: idSchema }).parse(payload).testRunId));
  register("platform-self-test:confirm-delete", async (_event, payload) => platformSelfTests.confirmDelete(z.object({ testRunId: idSchema }).parse(payload).testRunId));

  register("plans:list", () => repository.listPlans().filter(plan => plan.brandId === workspace.current()));
  register("plans:create", (_event, payload) => repository.createPlan(z.object({ id: z.string().optional(), name: z.string().min(1), brandId: idSchema, enabled: z.boolean(), strategy: z.enum(["same_article", "per_platform", "platform_variant", "topic_rewrite", "account_variant"]), articlesPerDay: z.number().int().min(1).max(100), accountIds: z.array(idSchema), publishTimes: z.array(z.string()), reusePolicy: z.enum(["once", "same_platform", "same_platform_different_account", "always", "rewrite"]), minIntervalSeconds: z.number().int().min(0), maxRetries: z.number().int().min(0).max(10), consecutiveFailureThreshold: z.number().int().min(1).max(20), startDate: z.string(), endDate: z.string().nullable() }).omit({ id: true }).parse(payload)));
  register("plans:generate-jobs", (_event, payload) => { const input = z.object({ id: idSchema, scheduledAt: z.string() }).parse(payload); assertOperatorBatchPlanAllowed(repository.listPlans().find((plan) => plan.id === input.id), repository.listAccounts(), repository.listPlatforms()); const blockers = repository.validatePlanContentQuality(input.id); if (blockers.length > 0) throw Object.assign(new Error(`Quality Gate blocked publishing: ${blockers.length} content item(s) are not Approved`), { code: "CONTENT_REJECTED", blockers }); return repository.createJobsForPlan(input.id, input.scheduledAt); });
  register("jobs:create-video", async (_event, payload) => {
    const input = z.object({ accountId: idSchema, platformKey: idSchema, articleId: idSchema, videoAssetId: idSchema, scheduledAt: z.string().datetime().optional() }).parse(payload);
    if (input.platformKey === "douyin") throw new Error("B01_DOUYIN_VIDEO_ROUTE_DISABLED");
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
  register("jobs:list", (_event, payload) => repository.listJobs(z.object({ status: z.string().optional() }).optional().parse(payload)).filter(job => repository.getArticle(job.articleId)?.brandId === workspace.current()));
  register("jobs:prepare-existing-douyin", async (_event, payload) => {
    const id = z.object({ id: idSchema }).parse(payload).id;
    if (process.env.DOUYIN_BODY_DIAGNOSTIC_ENABLED !== "true"
      || process.env.DOUYIN_BODY_DIAGNOSTIC_JOB_ID?.trim() !== id
      || !process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim()
      || !process.env.DOUYIN_R1_ACCEPTANCE_ARTICLE_ID?.trim())
      throw new Error("DOUYIN_EXACT_DIAGNOSTIC_JOB_REQUIRED");
    const job = repository.getJob(id);
    if (!job || job.platformKey !== "douyin" || job.contentKind === "video"
      || job.accountId !== process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim()
      || job.articleId !== process.env.DOUYIN_R1_ACCEPTANCE_ARTICLE_ID?.trim()
      || job.status !== "AwaitingConfirmation" || job.attemptCount !== 0
      || repository.getSubmissionIntentByJob(id) || repository.getPublishRecordByJob(id)
      || repository.getPublishPayload(id).douyinImageSelection)
      throw new Error("DOUYIN_EXACT_PREBOUNDARY_JOB_REQUIRED");
    return publisher.prepareArticle(id, createUserAction("START_PUBLISH"));
  });
  register("jobs:run", async (_event, payload) => { const id = z.object({ id: idSchema }).parse(payload).id; const job = repository.getJob(id); const source = job && ["NeedsUserAction", "WaitingForUser"].includes(job.status) ? "CONTINUE_PENDING_ACTION" as const : "START_PUBLISH" as const; return publisher.executeJob(id, createUserAction(source)); });
  register("jobs:confirm", (_event, payload) => { const input = z.object({ id: idSchema, dryRun: z.boolean().default(false) }).parse(payload); return repository.confirmJob(input.id, input.dryRun); });
  register("jobs:reconcile", async (_event, payload) => publisher.reconcileJob(z.object({ id: idSchema }).parse(payload).id, createUserAction("CONTINUE_PENDING_ACTION")));
  register("jobs:reconcile-browser", async (_event, payload) => {
    const id = z.object({ id: idSchema }).parse(payload).id;
    if (process.env.DOUYIN_R1_14_READONLY_JOB_ID?.trim()) {
      const job = repository.getJob(id);
      const intent = repository.getSubmissionIntentByJob(id);
      const record = repository.getPublishRecordByJob(id);
      if (id !== process.env.DOUYIN_R1_14_READONLY_JOB_ID?.trim() || !job || job.platformKey !== "douyin"
        || job.accountId !== process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim()
        || job.articleId !== process.env.DOUYIN_R1_ACCEPTANCE_ARTICLE_ID?.trim()
        || !intent || intent.finalSubmitCount !== 1 || !intent.externalId
        || !record || record.publishedExternalId !== intent.externalId)
        throw new Error("DOUYIN_R14_READONLY_RECONCILIATION_TARGET_INVALID");
    }
    return publisher.reconcileBrowserJob(id, createUserAction("CONTINUE_PENDING_ACTION"));
  });
  register("jobs:reconcile-not-submitted", (_event, payload) => repository.markJobReconciledNotSubmitted(z.object({ id: idSchema }).parse(payload).id));
  register("jobs:retry", (_event, payload) => { const id = z.object({ id: idSchema }).parse(payload).id; return repository.updateJobFailure(id, "Retry", "UNKNOWN", "用户手动重试", new Date().toISOString()); });
  register("jobs:recover", () => repository.recoverRunningJobs());
  register("logs:list", (_event, payload) => { const input = z.object({ limit: z.number().int().min(1).max(500).optional(), level: z.string().optional(), module: z.string().optional(), search: z.string().optional() }).optional().parse(payload); return repository.listLogs(input?.limit, input); });
  register("logs:export", () => exportProductDiagnostics());
  register("notifications:list", (_event, payload) => repository.listNotifications(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional().parse(payload)?.limit));
  register("notifications:read", (_event, payload) => { repository.markNotificationRead(z.object({ id: idSchema }).parse(payload).id); });
  register("notifications:read-all", () => repository.markAllNotificationsRead());
  register("platforms:profiles", () => repository.getPlatformProfiles());
  register("platforms:content-rules", () => repository.getPlatformContentRules());
  register("ai:profiles", () => { const profiles = repository.listAiProviderProfiles().filter(profile => !aiCenter.store.isProductProfile(profile.id)); if (profiles.some((profile) => profile.provider === "deepseek")) return profiles; const profile = repository.upsertAiProviderProfile({ name: "DeepSeek 经济模式", provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", credentialRef: "ai:apiKey", temperature: 0.7, maxOutputTokens: 3000, timeoutMs: 30000, retryCount: 3, concurrency: 5, enabled: true, isDefault: profiles.length === 0, isFallback: false }); return [...profiles, profile]; });
  register("ai:profile-upsert", (_event, payload) => aiCenter.saveLegacyProfile(payload));
  register("ai:profile-delete", (_event, payload) => aiCenter.deleteLegacyProfile(z.object({ id: idSchema }).parse(payload).id));
  register("ai:set-profile-secret", (_event, payload) => { const input = z.strictObject({ id: idSchema, value: z.string() }).parse(payload); aiCenter.setLegacyCredential(input.id, input.value); });
  register("settings:get", () => {
    const settings = repository.getSettings();
    const storedStatus = settings.deepseekCredentialStatus;
    const currentStatus = aiCredentials.getStatus?.("ai:apiKey") ?? (aiCredentials.has("ai:apiKey") ? "Configured" : "NotConfigured");
    const deepseekCredentialStatus = currentStatus === "DecryptFailed" ? currentStatus : currentStatus === "NotConfigured" ? currentStatus : isCredentialStatus(storedStatus) && storedStatus !== "DecryptFailed" ? storedStatus : currentStatus;
    return { ...settings, apiKeyConfigured: currentStatus !== "NotConfigured" && currentStatus !== "DecryptFailed", deepseekCredentialStatus, imageApiKeyConfigured: aiCredentials.has("image:apiKey") };
  });
  register("settings:update", (_event, payload) => {
    const input = z.object({ key: z.enum(["provider", "baseUrl", "model", "temperature", "maxOutputTokens", "timeout", "concurrency", "retry", "imageProvider", "imageBaseUrl", "imageModel", "imageSize", "defaultAiProfileId", "fallbackAiProfileId", "autoFallback", "deepseekEnabled", "deepseekBaseUrl", "deepseekModel", "deepseekGenerationMode", "deepseekInputCostPer1k", "deepseekOutputCostPer1k", "defaultPublishMode", "contentReviewMode", "favoritePlatformKeys", "browserPublishMode", "finalPublishMode", "allowImageLessPublish", "developerMode"]), value: z.union([z.string(), z.number(), z.boolean()]) }).parse(payload);
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
  const fullSnapshotRoot=join(dirname(app.getPath("userData")),"geo-full-snapshots");
  const isolatedRestoreRoot=join(dirname(app.getPath("userData")),"geo-isolated-restores");
  const colleaguePreviews=new Map<string,{directory:string;contentFingerprint:string;createdAt:number}>();
  register('product:build-identity',()=>({...BUILD_IDENTITY,runtimeAppVersion:app.getVersion(),packaged:app.isPackaged,automaticExecutionDisabled:restoredExecutionPaused}));
  register('colleague-packages:export',async(_event,payload)=>{
    const input=z.strictObject({companyId:idSchema,articleIds:z.array(idSchema).max(1000),assetIds:z.array(idSchema).max(1000),includeTemplates:z.boolean()}).parse(payload);workspace.assertCompany(input.companyId);
    const picked=await dialog.showOpenDialog({title:'选择同事资料包的保存目录',properties:['openDirectory','createDirectory']});if(picked.canceled||picked.filePaths.length!==1)throw new Error('资料包导出已取消');workspace.assertCompany(input.companyId);
    const directory=join(picked.filePaths[0]!,`GEO-资料包-${new Date().toISOString().slice(0,10)}-${randomUUID().slice(0,8)}`),currentUserData=resolve(app.getPath('userData')).toLowerCase();if(resolve(directory).toLowerCase().startsWith(currentUserData+'\\'))throw new Error('资料包应保存到当前工作区外的新目录');
    const result=exportColleaguePackage(repository,input,directory,{appVersion:app.getVersion(),deliveryId:BUILD_IDENTITY.deliveryId});logger.info('BACKUP','COLLEAGUE_PACKAGE_EXPORTED','已导出选中的企业资料包',{packageId:result.packageId,articleCount:result.articleCount,assetCount:result.assetCount});return{...result,directory};
  });
  register('colleague-packages:pick',async()=>{const picked=await dialog.showOpenDialog({title:'选择同事资料包（包含 manifest.json）',properties:['openDirectory']});if(picked.canceled||picked.filePaths.length!==1)return null;const directory=picked.filePaths[0]!,preview=inspectColleaguePackage(directory),previewId=randomUUID();colleaguePreviews.set(previewId,{directory,contentFingerprint:preview.contentFingerprint,createdAt:Date.now()});if(colleaguePreviews.size>20)colleaguePreviews.delete(colleaguePreviews.keys().next().value!);return{...preview,previewId};});
  register('colleague-packages:import',(_event,payload)=>{const {previewId}=z.strictObject({previewId:idSchema}).parse(payload),selected=colleaguePreviews.get(previewId);if(!selected||Date.now()-selected.createdAt>30*60*1000)throw new Error('资料包预览已失效，请重新选择');if(inspectColleaguePackage(selected.directory).contentFingerprint!==selected.contentFingerprint)throw new Error('资料包已变化，请重新预览');const result=importColleaguePackage(repository,selected.directory,join(dataDirectory,'media','colleague-imports'),selected.contentFingerprint);colleaguePreviews.delete(previewId);logger.info('BACKUP','COLLEAGUE_PACKAGE_IMPORTED','资料包已作为新的 Draft 企业导入',{packageId:result.packageId,companyId:result.companyId,articleCount:result.articleCount,assetCount:result.assetCount});return result;});
  register("backups:queue-full",()=>{if(!deps.queueClosedSnapshot)throw new Error("当前运行方式不支持关闭后完整快照");return deps.queueClosedSnapshot();});
  register("backups:full-list",()=>{try{return readdirSync(fullSnapshotRoot).filter(name=>!name.includes(".")||name.startsWith("snapshot-")).filter(name=>{try{return statSync(join(fullSnapshotRoot,name)).isDirectory();}catch{return false;}}).sort().reverse().slice(0,100).map(name=>fullSnapshotSummary(join(fullSnapshotRoot,name)));}catch{return[];}});
  register("backups:validate-full",(_event,payload)=>{const {path}=z.strictObject({path:z.string().min(1).max(1000)}).parse(payload);const result=validateFullSnapshot(path,app.getVersion());return{valid:result.valid,message:result.message};});
  register("backups:restore-isolated",(_event,payload)=>{const {path}=z.strictObject({path:z.string().min(1).max(1000)}).parse(payload);const destination=join(isolatedRestoreRoot,new Date().toISOString().replace(/[:.]/gu,"-"),"b01-isolated-user-data");return restoreFullSnapshot(path,destination,app.getVersion(),[app.getPath("userData"),join(app.getPath("appData"),"codex-media-publisher")]);});
  register("backups:list", () => { const dir = join(dataDirectory, "backups"); try { return readdirSync(dir).filter((name) => name.endsWith(".db")).sort().reverse().map((name) => join(dir, name)); } catch { return []; } });
  register("backups:create", async () => { const dir = join(dataDirectory, "backups"); const path = join(dir, `publisher-${new Date().toISOString().replace(/[:.]/gu, "-")}.db`); await backupDatabase(repository.db, path); return path; });
  register("backups:validate", (_event, payload) => validateDatabaseBackup(z.object({ path: z.string().min(1) }).parse(payload).path));
  register("backups:restore", () => {throw new Error('单文件数据库备份不能覆盖当前工作区。请使用校验通过的完整快照，恢复到新的隔离目录。');});
  // A process restart is not consent for another paid request. Preserve unfinished legacy tasks for explicit review.
  logger.info("AI", "AUTO_REPLAY_PAUSED", "重启后的未知生成结果保留，未经人工确认不自动补发", {});

  void scheduler;
  return sessionRuntime;
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
  validateProviderConfig({ provider: provider === "deepseek" ? "deepseek" : "openai", baseUrl: settingString(repository, provider === "deepseek" ? "deepseekBaseUrl" : "baseUrl", provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1"), defaultModel: settingString(repository, "model", "manual-model") });
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
  if (profile.credentialRef.startsWith("ai:provider:") || profile.credentialRef !== `ai:legacy:${profile.id}` && profile.credentialRef !== "ai:apiKey") throw new Error("此服务商须在 Provider Center 生成，或配置独立凭据");
  if (profile.credentialRef === "ai:apiKey") validateProviderConfig({ provider: profile.provider === "deepseek" ? "deepseek" : "openai", baseUrl: profile.baseUrl, defaultModel: profile.model });
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
