import type { ControlledPostUploadDiscoveryResult, ControlledSelfTestMode, PublishFlowExplorationResult } from "@publisher/adapters-core";
import type { Account, AccountStatus, ActivityLog, AIProviderProfile, Article, ArticleVariant, AuthorizationStatus, Brand, BrandAsset, BrandKnowledgeCategory, BrandKnowledgeEntry, CityRegion, ContentStudioPlatformKey, ContentStudioTopicPlan, CredentialField, DashboardStats, ExcelImportPreview, ExcelImportResult, FailedOneShotConfirmationIdentity, FinalPublishMode, ImageAsset, ImageSelectionMode, KeywordItem, KeywordTemplate, KnowledgeSnapshot, LoginSession, Notification, OneShotConfirmationReconciliationResult, Platform, PlatformContentRules, PlatformProfile, PlatformSelfTestLevel, PlatformSelfTestRun, PublishJob, PublishPlan, PublishRecord, PublishVerificationStatus, Task10SPrepublishResult, VideoAsset, XhsIdentityAcceptance, CreatorIdentityVerificationResult } from "@publisher/domain";
import type { AIConnectionResult } from "@publisher/ai";
import type { ContentQualityAuditView, ContentQualityItemView, ContentQualityReviewView, ContentQualityStateView, HumanReviewDatasetItemView, HumanReviewDatasetView, HumanReviewSubmitInput, HumanReviewItemReviewView, QualityBenchmarkContentView, QualityBenchmarkMetrics, QualityBenchmarkRunView } from "@publisher/db";
import type { BrowserSessionRuntimeSnapshot, PreSubmitGateResult } from "@publisher/adapters-core";
import type { XiaohongshuCanonicalPageRuntimeProbe } from "@publisher/adapters-xiaohongshu/browser";
import type { XiaohongshuCurrentImageEditorReadiness } from "@publisher/adapters-xiaohongshu/browser";
import type { XiaohongshuPublishEditorDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import type { XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import type { XiaohongshuCurrentPostUploadReconciliation } from "@publisher/adapters-xiaohongshu/browser";
import type { XiaohongshuCurrentFileInputState } from "@publisher/adapters-xiaohongshu/browser";
import type { XhsEditorLoadDiagnosticResult } from "@publisher/adapters-xiaohongshu/browser";
import type { XhsEditorNetworkDiagnosticResult } from "@publisher/adapters-xiaohongshu/browser";
import type { ContentGoal, ContentIntent, ContentQualityStatus, PromotionStrength, SearchIntent } from "@publisher/domain";

export interface BatchGenerationInput {
  brandId: string;
  cities: string[];
  templateIds: string[];
  articleType: string;
  perKeyword: number;
  minWords: number;
  maxWords: number;
  autoCover: boolean;
  includeSummary: boolean;
  includeTags: boolean;
  includeSeoKeywords: boolean;
  concurrency?: number;
}

export interface ContentStudioGenerationInput {
  brandId: string;
  industry: string;
  cities: string[];
  keywords: string[];
  targetPlatforms: ContentStudioPlatformKey[];
  topicPlan?: ContentStudioTopicPlan | null;
  mediaAssetIds: string[];
  videoAssetIds: string[];
  concurrency?: number;
  business?: string;
  city?: string;
  keyword?: string;
  topic?: string;
  contentGoal?: ContentGoal;
  promotionStrength?: PromotionStrength;
  contentIntent?: ContentIntent;
  searchIntent?: SearchIntent;
  promptVersion?: string;
}

export interface QualityBenchmarkGenerationInput {
  brandId: string;
  benchmarkId: string;
  datasetVersion: string;
  promptVersion: string;
  runType: "MOCK_BASELINE" | "DEEPSEEK_REAL";
  topics: Array<{ index: number; title: string; city: string; keyword: string; business: string }>;
  platforms: ContentStudioPlatformKey[];
  benchmarkRunId?: string;
  concurrency?: number;
  retryFailed?: boolean;
}

export interface ContentStudioTaskView {
  id: string;
  parentTaskId: string | null;
  rootTaskId: string;
  brandId: string;
  type: string;
  status: string;
  total: number;
  completed: number;
  success: number;
  failed: number;
  errorMessage: string | null;
  provider: string;
  model: string;
  durationMs: number;
  sourceArticleId: string | null;
  createdAt: string;
  finishedAt: string | null;
  payload: ContentStudioGenerationInput;
  output: { topicPlan?: ContentStudioTopicPlan; sourceArticleId?: string; knowledgeSnapshot?: KnowledgeSnapshot; promptVersion?: string; contentIntent?: ContentIntent; searchIntent?: SearchIntent; brandDifferentiationByPlatform?: Record<string, { score: number; brandMentionCount: number; brandFactUsageCount: number; uniqueBrandFactCount: number; serviceFactUsed: boolean; regionFactUsed: boolean; processFactUsed: boolean; qualificationFactUsed: boolean; deviceFactUsed: boolean; caseFactUsed: boolean; genericBrandContent: boolean }>; providerDiagnostics?: Record<string, unknown> };
}

export interface ContentStudioVersionView {
  id: string;
  taskId: string;
  rootTaskId: string;
  platformKey: ContentStudioPlatformKey;
  versionNumber: number;
  contentType: "article" | "video_script";
  title: string;
  body: string;
  summary: string;
  tags: string[];
  seoKeywords: string[];
  tone: string;
  structure: string[];
  keywordLayout: { primary: string; secondary: string[]; placements: string[] };
  mediaAssetIds: string[];
  videoAssetIds: string[];
  sourceArticleId: string | null;
  articleVariantId: string | null;
  provider: string;
  model: string;
  isCurrent: boolean;
  qualityStatus: ContentQualityStatus;
  qualityReviewId: string | null;
  createdAt: string;
}

export interface ContentStudioMediaAssetView {
  id: string;
  title: string;
  type: string;
  provider: string | null;
  model: string | null;
  description: string;
  tags: string[];
}

export interface AccountCredentialStatusView {
  configured: boolean;
  expired: boolean;
  fields: Array<CredentialField & { configured: boolean }>;
}

export interface AccountManagementRow {
  account: Account;
  platform: Platform | null;
  credentialStatus: AccountCredentialStatusView;
  lastDryRunAt: string | null;
  accountStatus: AccountStatus;
  authorizationStatus: AuthorizationStatus;
  authorizationScopes: string[];
  authorizationExpiresAt: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  publishVerification: PublishVerificationStatus;
  connectionStage: "NotConfigured" | "CredentialConfigured" | "ConnectionPassed" | "PublishReady" | "PublishPassed" | "NeedsAttention";
  runtimeAuthState: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED" | null;
}

export type AccountDisconnectOutcome = "DISCONNECTED" | "ALREADY_DISCONNECTED";

export interface AccountDisconnectResult {
  disconnected: true;
  accountStatus: "NotConnected";
  outcome: AccountDisconnectOutcome;
}

export interface PlatformSelfTestAccountView {
  account: Account;
  latestRun: PlatformSelfTestRun | null;
}

export type BrowserSessionHeartbeatPhase = "POST_LOGIN_IMMEDIATE" | "POST_LOGIN_SURVIVAL" | "PRE_CHECK_LOGIN" | "POST_CHECK_LOGIN" | "PRE_SUBMIT_GATE_PRECHECK" | "POST_SUBMIT_GATE" | "MANUAL";

export interface BrowserSessionHeartbeatInput {
  phase: BrowserSessionHeartbeatPhase;
  heartbeatSequence: string;
  loginGeneration: number;
}

export type VideoAssetLifecycleStatus = "Draft" | "Ready" | "DryRun" | "Published" | "Failed";

export interface ManagedVideoAsset extends VideoAsset {
  brandId: string | null;
  title: string;
  description: string;
  tags: string[];
  coverPath: string | null;
  coverAssetId: string | null;
  platformFields: Record<string, Record<string, string>>;
  status: VideoAssetLifecycleStatus;
}

export interface PublisherApi {
  dashboard: { get(): Promise<DashboardStats> };
  videoAssets: {
    list(filters?: { brandId?: string }): Promise<ManagedVideoAsset[]>;
    pickVideo(): Promise<string | null>;
    pickCover(): Promise<string | null>;
    create(input: { brandId: string; sourcePath: string; title: string; description: string; tags: string[]; coverSourcePath?: string; durationMs?: number; width?: number; height?: number; platformFields: Record<string, Record<string, string>> }): Promise<ManagedVideoAsset>;
    update(id: string, input: { title?: string; description?: string; tags?: string[]; coverSourcePath?: string | null; durationMs?: number; width?: number; height?: number; platformFields?: Record<string, Record<string, string>> }): Promise<ManagedVideoAsset>;
    preflight(input: { id: string; platformKey: string }): Promise<{ valid: boolean; errors: string[]; warnings: string[] }>;
  };
  brands: { list(): Promise<Brand[]>; create(input: Record<string, unknown>): Promise<Brand>; update(id: string, input: Record<string, unknown>): Promise<Brand>; assets(brandId: string): Promise<BrandAsset[]>; addAsset(input: Record<string, unknown>): Promise<BrandAsset> };
  brandKnowledge: { list(brandId: string): Promise<BrandKnowledgeEntry[]>; create(input: { brandId: string; category: BrandKnowledgeCategory; title: string; content: string; enabled?: boolean }): Promise<BrandKnowledgeEntry>; update(id: string, input: { category?: BrandKnowledgeCategory; title?: string; content?: string; enabled?: boolean }): Promise<BrandKnowledgeEntry>; delete(id: string): Promise<void> };
  keywords: { templates(brandId: string): Promise<KeywordTemplate[]>; items(brandId: string): Promise<KeywordItem[]>; createTemplate(input: { brandId: string; template: string; category: string }): Promise<KeywordTemplate>; updateTemplate(id: string, input: Partial<Pick<KeywordTemplate, "template" | "category" | "enabled">>): Promise<KeywordTemplate>; deleteTemplate(id: string): Promise<void>; expand(input: { brandId: string; cities: string[]; templateIds?: string[] }): Promise<{ count: number; duplicates: number }>; import(brandId: string, source: string): Promise<{ imported: number; duplicates: number; errors: string[] }>; regions(brandId: string): Promise<CityRegion[]>; importRegions(brandId: string, rows: CityRegion[]): Promise<{ imported: number; duplicates: number; errors: string[] }> };
  articles: { list(filters?: { brandId?: string; search?: string; status?: string; city?: string; source?: "production" | "content_studio" | "excel_import" | "benchmark" | "mock" | "test" }): Promise<Article[]>; page(filters?: { brandId?: string; search?: string; status?: string; city?: string; source?: "production" | "content_studio" | "excel_import" | "benchmark" | "mock" | "test"; page?: number; pageSize?: number }): Promise<{ items: Article[]; page: number; pageSize: number; total: number; totalPages: number }>; get(id: string): Promise<Article | null>; update(id: string, input: Record<string, unknown>): Promise<Article>; markNeedsRewrite(id: string): Promise<Article>; archive(id: string): Promise<Article>; delete(id: string): Promise<void>; generateCover(id: string): Promise<Article>; attachRecommendedImage(input: { articleId: string; platformKey: string }): Promise<ImageAsset | null>; variants(articleId: string): Promise<ArticleVariant[]>; generateVariant(articleId: string, platformKey: string): Promise<ArticleVariant>; updateVariant(id: string, input: { title?: string; body?: string; summary?: string }): Promise<ArticleVariant>; history(articleId: string): Promise<PublishRecord[]>; downloadTemplate(): Promise<{ path: string; fileName: string; fields: string[] } | null>; downloadSimpleTemplate(): Promise<{ path: string; fileName: string; fields: string[] } | null>; downloadAdvancedTemplate(): Promise<{ path: string; fileName: string; fields: string[] } | null>; importExcel(defaultBrandId?: string | null): Promise<ExcelImportPreview | null>; confirmExcelImport(preview: ExcelImportPreview, duplicateRowNumbers?: number[]): Promise<ExcelImportResult>; exportExcelErrors(preview: ExcelImportPreview): Promise<string | null>; preparePublish(input: { articleId: string; platformKey: string; platformAccountId: string; publishMode?: "ASSISTED" | "MANUAL"; finalPublishMode?: FinalPublishMode; selectedImageAssetId?: string | null; imageSelectionMode?: ImageSelectionMode }): Promise<{ job: PublishJob; record: PublishRecord | null; message: string }> };
  imageAssets: { list(filters?: { brandId?: string; enabledOnly?: boolean }): Promise<ImageAsset[]>; pickFiles(): Promise<string[]>; import(input: { brandId: string; sourcePaths: string[]; name?: string; tags: string[]; business: string[]; city: string[]; usage: string[]; platform: string[]; universal: boolean }): Promise<ImageAsset[]>; update(id: string, input: { name?: string; tags?: string[]; business?: string[]; city?: string[]; usage?: string[]; platform?: string[]; universal?: boolean; enabled?: boolean }): Promise<ImageAsset>; delete(id: string): Promise<void>; selectForArticle(input: { articleId: string; platformKey: string; excludeImageAssetIds?: string[] }): Promise<ImageAsset | null> };
  ai: { startBatch(input: BatchGenerationInput): Promise<string>; task(id: string): Promise<{ id: string; status: string; total: number; completed: number; success: number; failed: number; errorMessage: string | null; durationMs: number; nextIndex: number; cancelRequested: boolean } | null>; cancel(id: string): Promise<void>; profiles(): Promise<AIProviderProfile[]>; upsertProfile(input: Omit<AIProviderProfile, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<AIProviderProfile>; deleteProfile(id: string): Promise<void> };
  contentStudio: { mediaAssets(brandId: string): Promise<ContentStudioMediaAssetView[]>; expandKeywords(input: { brandId: string; cities: string[]; keywords: string[]; industry?: string }): Promise<{ items: KeywordItem[]; duplicates: number }>; planTopics(input: ContentStudioGenerationInput): Promise<ContentStudioTopicPlan>; start(input: ContentStudioGenerationInput): Promise<string>; task(id: string): Promise<ContentStudioTaskView | null>; tasks(brandId?: string): Promise<ContentStudioTaskView[]>; versions(rootTaskId: string, platformKey?: ContentStudioPlatformKey): Promise<ContentStudioVersionView[]>; updateVersion(id: string, input: { title?: string; body?: string; summary?: string; tags?: string[]; seoKeywords?: string[] }): Promise<ContentStudioVersionView | null>; regenerate(rootTaskId: string, platformKey: ContentStudioPlatformKey): Promise<string> };
  quality: { items(brandId?: string): Promise<ContentQualityItemView[]>; status(contentType: "article" | "article_variant", contentId: string): Promise<ContentQualityStateView | null>; history(contentType: "article" | "article_variant", contentId: string): Promise<{ reviews: ContentQualityReviewView[]; audits: ContentQualityAuditView[] }>; recheck(contentType: "article" | "article_variant", contentId: string): Promise<ContentQualityReviewView>; decide(contentType: "article" | "article_variant", contentId: string, status: "Approved" | "Rejected", reason?: string): Promise<ContentQualityReviewView> };
  humanReview: { dataset(): Promise<HumanReviewDatasetView>; item(id: string): Promise<HumanReviewDatasetItemView | null>; submit(input: HumanReviewSubmitInput): Promise<HumanReviewItemReviewView> };
  qualityBenchmark: { run(input: QualityBenchmarkGenerationInput): Promise<{ run: QualityBenchmarkRunView; metrics: QualityBenchmarkMetrics; contents: QualityBenchmarkContentView[] }>; control(runId: string, status: "RUNNING" | "PAUSED" | "CANCELLED"): Promise<QualityBenchmarkRunView> };
  platforms: { list(): Promise<Platform[]>; profiles(): Promise<PlatformProfile[]>; contentRules(): Promise<PlatformContentRules[]>; open(platformKey: string): Promise<{ opened: boolean }> };
  accounts: { list(): Promise<Account[]>; overview(): Promise<AccountManagementRow[]>; sessionHeartbeat(accountId: string, platformKey: string, input?: BrowserSessionHeartbeatInput): Promise<BrowserSessionRuntimeSnapshot>; inspectPublishEditor(accountId: string, platformKey: string): Promise<PreSubmitGateResult>; inspectEditorLoad(accountId: string, platformKey: string): Promise<XhsEditorLoadDiagnosticResult>; inspectEditorNetworkFailure(accountId: string, platformKey: string): Promise<XhsEditorNetworkDiagnosticResult>; create(input: { platformKey: string; name: string; accountAlias?: string; allowAutoPublish?: boolean; publishMode?: Account["publishMode"] }): Promise<Account>; update(id: string, input: { accountAlias?: string; enabled?: boolean; loginStatus?: Account["loginStatus"]; pausedReason?: string | null; allowAutoPublish?: boolean; publishMode?: Account["publishMode"]; minimumIntervalSeconds?: number }): Promise<Account>; setCredentials(input: { accountId: string; platformKey: string; values: Record<string, string> }): Promise<{ configured: boolean; fields: Array<CredentialField & { configured: boolean }> }>; credentialStatus(accountId: string, platformKey: string): Promise<AccountCredentialStatusView>; beginLogin(accountId: string, platformKey: string): Promise<LoginSession>; completeLogin(accountId: string, platformKey: string, callbackUrl: string): Promise<{ configured: boolean; accountStatus: AccountStatus | "Connected"; authorizationStatus: "NotAuthorized" | "Authorized" | "Partial" | "Revoked" | "Unknown"; accountId: string | null; accountName: string | null; scopes: string[]; expiresAt: string | null }>; refreshLogin(accountId: string, platformKey: string): Promise<{ accountStatus: "Connected"; authorizationStatus: "NotAuthorized" | "Authorized" | "Partial" | "Revoked" | "Unknown"; expiresAt: string | null }>; cancelLogin(accountId: string, platformKey: string): Promise<{ loginStatus: Account["loginStatus"] }>; disconnect(accountId: string, platformKey: string): Promise<AccountDisconnectResult>; openBackend(accountId: string, platformKey: string): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string }>; checkLogin(accountId: string, platformKey: string): Promise<{ loginStatus: Account["loginStatus"] }> };
  platformSelfTest: { list(): Promise<PlatformSelfTestAccountView[]>; get(testRunId: string): Promise<PlatformSelfTestRun | null>; runSafe(platformAccountId: string): Promise<PlatformSelfTestRun>; runPostUploadDiscovery(input: { platformAccountId: string; mode: ControlledSelfTestMode }): Promise<ControlledPostUploadDiscoveryResult>; runPublishFlowExploration(input: { platformAccountId: string; mode: "XHS_PUBLISH_FLOW_EXPLORATION" }): Promise<PublishFlowExplorationResult>; continue(testRunId: string): Promise<PlatformSelfTestRun>; runLevel(platformAccountId: string, level: PlatformSelfTestLevel): Promise<PlatformSelfTestRun>; healthCheck(): Promise<PlatformSelfTestRun[]>; requestPublish(platformAccountId: string): Promise<PlatformSelfTestRun>; confirmPublish(testRunId: string, testVideoPath?: string): Promise<PlatformSelfTestRun>; cancelPublish(testRunId: string): Promise<PlatformSelfTestRun>; requestOneShotPublish(platformAccountId: string): Promise<PlatformSelfTestRun>; prepareOneShotPrepublish(testRunId: string): Promise<Task10SPrepublishResult>; confirmOneShotPublish(testRunId: string): Promise<PlatformSelfTestRun>; cancelOneShotPublish(testRunId: string): Promise<PlatformSelfTestRun>; reconcileFailedOneShotConfirmation(input: FailedOneShotConfirmationIdentity): Promise<OneShotConfirmationReconciliationResult>; verifyXhsCreatorIdentity(accountId: string): Promise<CreatorIdentityVerificationResult>; probeXhsCanonicalPage(accountId: string): Promise<XiaohongshuCanonicalPageRuntimeProbe>; inspectCurrentXiaohongshuImageEditorReadiness(accountId: string): Promise<XiaohongshuCurrentImageEditorReadiness>; inspectCurrentXiaohongshuPublishEditorDom(accountId: string): Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic>; inspectCurrentXiaohongshuPublishEditorSemanticCandidates(accountId: string): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>; inspectCurrentXiaohongshuPostUploadReconciliation(accountId: string): Promise<XiaohongshuCurrentPostUploadReconciliation>; inspectCurrentXiaohongshuFileInputState(accountId: string): Promise<XiaohongshuCurrentFileInputState>; verifyAndConvergeXhsIdentity(accountId: string, ownerApproved?: boolean): Promise<XhsIdentityAcceptance>; confirmDelete(testRunId: string): Promise<PlatformSelfTestRun> };
  plans: { list(): Promise<PublishPlan[]>; create(input: Omit<PublishPlan, "id">): Promise<PublishPlan>; generateJobs(id: string, scheduledAt: string): Promise<PublishJob[]> };
  jobs: { list(filters?: { status?: string }): Promise<PublishJob[]>; createVideo(input: { accountId: string; platformKey: string; articleId: string; videoAssetId: string; scheduledAt: string }): Promise<PublishJob>; run(id: string): Promise<{ job: PublishJob; message: string }>; confirm(id: string, dryRun?: boolean): Promise<PublishJob>; reconcile(id: string): Promise<{ job: PublishJob; message: string }>; reconcileBrowser(id: string): Promise<{ job: PublishJob; message: string }>; reconcileNotSubmitted(id: string): Promise<PublishJob>; retry(id: string): Promise<PublishJob>; recover(): Promise<number> };
  logs: { list(limit?: number, filters?: { level?: string; module?: string; search?: string }): Promise<ActivityLog[]>; export(): Promise<string | null> };
  notifications: { list(limit?: number): Promise<Notification[]>; markRead(id: string): Promise<void>; markAllRead(): Promise<void> };
  backups: { list(): Promise<string[]>; create(): Promise<string>; validate(path: string): Promise<{ valid: boolean; message: string }>; restore(path: string): Promise<{ accepted: boolean }> };
  settings: { get(): Promise<Record<string, unknown>>; update(key: string, value: unknown): Promise<void>; setSecret(kind: "apiKey" | "imageApiKey", value: string): Promise<{ configured: boolean; validationStatus?: string; validationResult?: AIConnectionResult }>; testAi(): Promise<AIConnectionResult> };
}

declare global {
  interface Window { publisherAPI: PublisherApi }
}
