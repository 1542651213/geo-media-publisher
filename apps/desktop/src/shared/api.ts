import type { ControlledPostUploadDiscoveryResult, ControlledSelfTestMode } from "@publisher/adapters-core";
import type { OfficialApiAccountView, OfficialApiAvailability, OfficialApiContentSettings, OfficialApiImageChoice, OfficialApiJobView, OfficialApiMaintenanceOperation } from "./official-api";
import type { Account, AccountStatus, ActivityLog, AIProviderProfile, Article, ArticleVariant, AuthorizationStatus, Brand, BrandAsset, BrandKnowledgeCategory, BrandKnowledgeEntry, CityRegion, ContentStudioPlatformKey, ContentStudioTopicPlan, CredentialField, DashboardStats, ExcelImportPreview, ExcelImportResult, FinalPublishMode, ImageAsset, ImageSelectionMode, KeywordItem, KeywordTemplate, KnowledgeSnapshot, LoginSession, Notification, Platform, PlatformContentRules, PlatformProfile, PlatformSelfTestLevel, PlatformSelfTestRun, PublishJob, PublishPlan, PublishRecord, PublishVerificationStatus, VideoAsset } from "@publisher/domain";
import type { AIConnectionResult } from "@publisher/ai";
import type { AIProductCenter } from "../main/ai-product-center";
import type { OperationsApi } from "./content-operations";
import type { AccountOnboardingApi } from "./account-onboarding";
import type { DraftWorkingCopiesApi } from "./draft-working-copies";
import type { ColleaguePackagesApi } from './colleague-data-package';
import type { BuildIdentity } from './build-identity';
import type { SafeAccountSessionSnapshot } from "@publisher/adapters-core";
import type { ProductAccountHealth, ProductPreflightResult } from "./product-platform-policy";
import type { ContentQualityAuditView, ContentQualityItemView, ContentQualityReviewView, ContentQualityStateView, HumanReviewDatasetItemView, HumanReviewDatasetView, HumanReviewSubmitInput, HumanReviewItemReviewView, QualityBenchmarkContentView, QualityBenchmarkMetrics, QualityBenchmarkRunView } from "@publisher/db";
import type { BrowserSessionRuntimeSnapshot, PreSubmitGateResult } from "@publisher/adapters-core";
import type { ToutiaoActivationResult, ToutiaoSessionStatus } from "../main/toutiao-session-activation";
import type { SprintAcceptanceSelection } from "../main/sprint-acceptance";
import type { ToutiaoLiveShadowResult, ControlledPublishCaptureResult } from "@publisher/adapters-toutiao/article-api";
import type { CapturedOneShotResult } from "../main/toutiao-captured-request-one-shot";
import type { ToutiaoDeepScanResult } from "@publisher/adapters-toutiao/browser";
import type { DouyinImageTextBrowserAdapter } from "@publisher/adapters-douyin/image-text-browser";
import type { Mvp5ReadinessResult } from "../main/toutiao-capture-binding-readiness";
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
  imageTextCreatorReady?: boolean;
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
  runtimeAuthState: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED" | "CONNECTED" | "NEEDS_LOGIN" | "CREDENTIAL_INVALID" | "IDENTITY_MISMATCH" | "NETWORK_UNAVAILABLE" | "DISABLED" | null;
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
  colleaguePackages:ColleaguePackagesApi;
  accountOnboarding: AccountOnboardingApi;
  drafts: DraftWorkingCopiesApi;
  lifecycle: { onDraftFlush(listener: (requestId: string) => void): () => void; draftFlushResult(requestId: string, success: boolean): void };
  sessions: { snapshots(): Promise<SafeAccountSessionSnapshot[]>; refresh(accountId: string): Promise<SafeAccountSessionSnapshot | null> };
  workspace: { companies(): Promise<Brand[]>; current(): Promise<string | null>; select(companyId: string): Promise<{ companyId: string }> };
  operations: OperationsApi & { pickImportFile(): Promise<{ fileName: string; columns: string[]; rows: Array<Record<string, string>> } | null> };
  product: { buildIdentity():Promise<BuildIdentity&{runtimeAppVersion:string;packaged:boolean;automaticExecutionDisabled:boolean}>;health(): Promise<ProductAccountHealth[]>; preflight(input: { articleId: string; platformKey: string; platformAccountId: string; selectedImageAssetId?: string | null; websiteSettings?: OfficialApiContentSettings }): Promise<ProductPreflightResult>; diagnostics(): Promise<Record<string, unknown>>; exportDiagnostics(): Promise<string | null> };
  aiCenter: {
    previewGeneration(input:Parameters<AIProductCenter["previewGeneration"]>[0]):Promise<ReturnType<AIProductCenter["previewGeneration"]>>;
    requestBudget(id:string,companyId:string):Promise<ReturnType<AIProductCenter["requestBudget"]>>;
    cancel(companyId:string):Promise<{requested:boolean}>;
    definitions(): Promise<ReturnType<AIProductCenter["definitions"]>>;
    profiles(): Promise<ReturnType<AIProductCenter["profiles"]>>;
    saveProfile(input: Parameters<AIProductCenter["saveProfile"]>[0]): Promise<ReturnType<AIProductCenter["saveProfile"]>>;
    setCredential(id: string, value: string): Promise<{ configured: boolean }>;
    listModels(id: string): ReturnType<AIProductCenter["listModels"]>;
    testConnection(id: string): ReturnType<AIProductCenter["testConnection"]>;
    context(companyId: string): Promise<ReturnType<AIProductCenter["context"]>>;
    saveContext(input: Parameters<AIProductCenter["saveContext"]>[0]): Promise<ReturnType<AIProductCenter["saveContext"]>>;
    templates(): Promise<ReturnType<AIProductCenter["templates"]>>;
    saveTemplate(input: Parameters<AIProductCenter["saveTemplate"]>[0]): Promise<ReturnType<AIProductCenter["saveTemplate"]>>;
    history(companyId?: string): Promise<ReturnType<AIProductCenter["history"]>>;
    draft(id: string): Promise<ReturnType<AIProductCenter["draft"]>>;
    generate(input: Parameters<AIProductCenter["generate"]>[0]): ReturnType<AIProductCenter["generate"]>;
    validateDraft(id: string, title: string, body: string): Promise<ReturnType<AIProductCenter["validateDraft"]>>;
    saveDraft(id: string, title: string, body: string): Promise<ReturnType<AIProductCenter["saveDraft"]>>;
  };
  sprint: { availability(): Promise<SprintAcceptanceSelection[]> };
  website: { listConnections(): Promise<OfficialApiAccountView[]>;
    imageChoices(articleId: string): Promise<OfficialApiImageChoice[]>;
    importCredentials(input: { environment: "staging" | "production"; accountId?: string }): Promise<OfficialApiAccountView>;
    verifyConnection(accountId: string): Promise<OfficialApiAccountView>;
    availability(): Promise<OfficialApiAvailability>;
    jobState(jobId: string): Promise<OfficialApiJobView | null>;
    recover(jobId: string): Promise<OfficialApiJobView>;
    maintain(input: { jobId: string; operation: OfficialApiMaintenanceOperation }): Promise<OfficialApiJobView> };
  b01: { availability(): Promise<{ enabled: boolean; reason: string }>;
    requestAuthorization(input: { platformKey: "douyin"; accountId: string; articleId: string; imageAssetId: string }): Promise<{
      id: string; status: string; eligible: boolean; reason: string }>;
    requestFinalApproval(jobId: string): Promise<{ status: string; jobId: string | null; reason: string }>;
    retirePreboundary(jobId: string): Promise<{ status: string; jobId: string | null; reason: string }>;
    eligibility(input: { accountId: string; articleId: string; imageAssetId: string }): Promise<{
    eligible: boolean; status: "Created" | "Bound" | "Prepared" | "FinalApproved" | "Consumed" | "Revoked" | "Missing" | "Expired"; reason: string
  }>; jobStatus(jobId: string): Promise<{ eligible: boolean; status: string; reason: string }> };
  toutiaoProduction: { readiness(accountId: string): Promise<{
    readOnly: boolean; ready: boolean; reasonCode: string | null; accountId: string | null;
    transport: "BrowserNative"; finalSubmitCount: number; accountIdentityMatch: boolean;
    sessionActive: boolean; contextOwnership: boolean; managementReady: boolean;
    availableStatuses: readonly string[]; rowsObserved: number; mainCodeSha256: string;
    formalSubmitEnabled: boolean; experimentalBrowserAssistedApiEnabled: boolean;
  }> };
  toutiaoDiagnostics: { protocolShadow(accountId: string, mode?: "HOME" | "EDITOR" | "SIGNER_CONTRACT" | "SIGNER_INPUT" | "BRIDGE" | "CONTROLLED_ARTICLE_NEW"): Promise<ToutiaoLiveShadowResult>;
    publishRequestCapture(accountId: string): Promise<ControlledPublishCaptureResult>;
    oneShotBuildIdentity(): Promise<{ mainCodeSha256: string; packageVersion: string; packaged: boolean }>;
    oneShotBindingReadiness(accountId: string, jobId: string): Promise<Mvp5ReadinessResult & {
      ownerLoginRequired: boolean; runtimeState: string; remoteAuthState: string;
      bundleVersion: number | null; loginGeneration: number | null }>;
    oneShotManagementDiagnostic(accountId: string): Promise<{ listStructureVerified: boolean;
      accountIdentityVerified: boolean; blockedMutationCount: number;
      blockedRequestShapes: readonly { host: string; path: string; method: string }[]; match: null;
      structure: { pagePath: string; anchorCount: number; structuredRowCount: number; emptyStateObserved: boolean;
        managementMarkerObserved: boolean; statusMarkerObserved: boolean; dateMarkerObserved: boolean;
        timeMarkerObserved: boolean; chineseDateObserved: boolean; bodyCharCount: number;
        articleHrefCount: number; candidateContainerCount: number;
        readonlyResponseShapes: readonly { path: string; status: number }[];
        framePaths: readonly { host: string; path: string }[]; loadingObserved: boolean; errorObserved: boolean } }>;
    oneShotRuntimePreflight(accountId: string): Promise<{ sessionActive: boolean; accountIdentityMatch: boolean;
      managementListStructureVerified: boolean; blockedReadOnlySmokeMutations: number; bundleVersion: number;
      loginGeneration: number; credentialChanged: boolean; backupVerified: boolean }>;
    oneShotPrepareTestJob(accountId: string): Promise<{ jobId: string; testRunId: string; articleId: string | null; reused: boolean }>;
    oneShotReconcile(accountId: string, jobId: string): Promise<{ state: string; reasonCode: string;
      externalId?: string | null; publicUrl?: string | null }>;
    oneShotDeepReconcileOnly(accountId: string, jobId: string): Promise<ToutiaoDeepScanResult & {
      readonly finalState: string; readonly accountIdentityMatch: boolean;
      readonly publicVerification: { readonly verified: boolean; readonly urlReachable: boolean;
        readonly titleMatch: boolean; readonly bodyMatch: boolean } | null }>;
    oneShotCapturedReplay(accountId: string, jobId: string): Promise<CapturedOneShotResult> };
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
  articles: { list(filters?: { brandId?: string; search?: string; status?: string; city?: string; source?: "production" | "content_studio" | "excel_import" | "benchmark" | "mock" | "test" }): Promise<Article[]>; page(filters?: { brandId?: string; search?: string; status?: string; city?: string; source?: "production" | "content_studio" | "excel_import" | "benchmark" | "mock" | "test"; page?: number; pageSize?: number }): Promise<{ items: Article[]; page: number; pageSize: number; total: number; totalPages: number }>; get(id: string): Promise<Article | null>; update(id: string, input: Record<string, unknown>): Promise<Article>; markNeedsRewrite(id: string): Promise<Article>; archive(id: string): Promise<Article>; delete(id: string): Promise<void>; generateCover(id: string): Promise<Article>; attachRecommendedImage(input: { articleId: string; platformKey: string }): Promise<ImageAsset | null>; variants(articleId: string): Promise<ArticleVariant[]>; generateVariant(articleId: string, platformKey: string): Promise<ArticleVariant>; updateVariant(id: string, input: { title?: string; body?: string; summary?: string }): Promise<ArticleVariant>; history(articleId: string): Promise<PublishRecord[]>; downloadTemplate(): Promise<{ path: string; fileName: string; fields: string[] } | null>; downloadSimpleTemplate(): Promise<{ path: string; fileName: string; fields: string[] } | null>; downloadAdvancedTemplate(): Promise<{ path: string; fileName: string; fields: string[] } | null>; importExcel(defaultBrandId?: string | null): Promise<ExcelImportPreview | null>; confirmExcelImport(preview: ExcelImportPreview, duplicateRowNumbers?: number[]): Promise<ExcelImportResult>; exportExcelErrors(preview: ExcelImportPreview): Promise<string | null>; preparePublish(input: { articleId: string; platformKey: string; platformAccountId: string; publishMode?: "ASSISTED" | "MANUAL"; finalPublishMode?: FinalPublishMode; selectedImageAssetId?: string | null; imageSelectionMode?: ImageSelectionMode; douyinImageTextSettings?: { version: 1; visibility: "public"; timing: "immediate" }; websiteSettings?: OfficialApiContentSettings }): Promise<{ job: PublishJob; record: PublishRecord | null; message: string }> };
  imageAssets: { list(filters?: { brandId?: string; enabledOnly?: boolean }): Promise<ImageAsset[]>; pickFiles(): Promise<string[]>; import(input: { brandId: string; sourcePaths: string[]; name?: string; tags: string[]; business: string[]; city: string[]; usage: string[]; platform: string[]; universal: boolean }): Promise<ImageAsset[]>; update(id: string, input: { name?: string; tags?: string[]; business?: string[]; city?: string[]; usage?: string[]; platform?: string[]; universal?: boolean; enabled?: boolean }): Promise<ImageAsset>; delete(id: string): Promise<void>; selectForArticle(input: { articleId: string; platformKey: string; excludeImageAssetIds?: string[] }): Promise<ImageAsset | null> };
  ai: { startBatch(input: BatchGenerationInput): Promise<string>; task(id: string): Promise<{ id: string; status: string; total: number; completed: number; success: number; failed: number; errorMessage: string | null; durationMs: number; nextIndex: number; cancelRequested: boolean } | null>; cancel(id: string): Promise<void>; profiles(): Promise<AIProviderProfile[]>; upsertProfile(input: Omit<AIProviderProfile, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<AIProviderProfile>; deleteProfile(id: string): Promise<void>; setProfileCredential(id: string, value: string): Promise<void> };
  contentStudio: { mediaAssets(brandId: string): Promise<ContentStudioMediaAssetView[]>; expandKeywords(input: { brandId: string; cities: string[]; keywords: string[]; industry?: string }): Promise<{ items: KeywordItem[]; duplicates: number }>; planTopics(input: ContentStudioGenerationInput): Promise<ContentStudioTopicPlan>; start(input: ContentStudioGenerationInput): Promise<string>; task(id: string): Promise<ContentStudioTaskView | null>; tasks(brandId?: string): Promise<ContentStudioTaskView[]>; versions(rootTaskId: string, platformKey?: ContentStudioPlatformKey): Promise<ContentStudioVersionView[]>; updateVersion(id: string, input: { title?: string; body?: string; summary?: string; tags?: string[]; seoKeywords?: string[] }): Promise<ContentStudioVersionView | null>; regenerate(rootTaskId: string, platformKey: ContentStudioPlatformKey): Promise<string> };
  quality: { items(brandId?: string): Promise<ContentQualityItemView[]>; status(contentType: "article" | "article_variant", contentId: string): Promise<ContentQualityStateView | null>; history(contentType: "article" | "article_variant", contentId: string): Promise<{ reviews: ContentQualityReviewView[]; audits: ContentQualityAuditView[] }>; recheck(contentType: "article" | "article_variant", contentId: string): Promise<ContentQualityReviewView>; decide(contentType: "article" | "article_variant", contentId: string, status: "Approved" | "Rejected", reason?: string): Promise<ContentQualityReviewView> };
  humanReview: { dataset(): Promise<HumanReviewDatasetView>; item(id: string): Promise<HumanReviewDatasetItemView | null>; submit(input: HumanReviewSubmitInput): Promise<HumanReviewItemReviewView> };
  qualityBenchmark: { run(input: QualityBenchmarkGenerationInput): Promise<{ run: QualityBenchmarkRunView; metrics: QualityBenchmarkMetrics; contents: QualityBenchmarkContentView[] }>; control(runId: string, status: "RUNNING" | "PAUSED" | "CANCELLED"): Promise<QualityBenchmarkRunView> };
  platforms: { list(): Promise<Platform[]>; profiles(): Promise<PlatformProfile[]>; contentRules(): Promise<PlatformContentRules[]>; open(platformKey: string): Promise<{ opened: boolean }> };
  accounts: { list(): Promise<Account[]>; overview(): Promise<AccountManagementRow[]>; sessionHeartbeat(accountId: string, platformKey: string, input?: BrowserSessionHeartbeatInput): Promise<BrowserSessionRuntimeSnapshot>; getRuntimeSessionStatus(accountId: string, platformKey: "toutiao"): Promise<ToutiaoSessionStatus>; activateSession(accountId: string, platformKey: "toutiao"): Promise<ToutiaoActivationResult>; activateDouyinImageText(accountId: string): Promise<{ status: "ACTIVE" | "WAITING_FOR_OWNER" | "IDENTITY_MISMATCH" | "BINDING_REQUIRED" | "NO_STORED_AUTH"; creatorId: string | null; pageHost: string | null; sessionIdHash: string | null }>; douyinImageTextReadiness(accountId: string): ReturnType<DouyinImageTextBrowserAdapter["inspectOwnedCreatorReadiness"]>; preflightDouyinManagement(accountId: string): ReturnType<DouyinImageTextBrowserAdapter["preflightManagementReadOnly"]>; inspectDouyinManagement(accountId: string): Promise<{ ready: boolean; creatorId: string | null; pageHost: string | null; pagePath: string | null; searchControlCount: number; stateLabels: string[]; visibleRowCount: number }>; inspectDouyinManagementTopology(accountId: string, jobId: string): ReturnType<DouyinImageTextBrowserAdapter["inspectManagementTopologyReadOnly"]>; inspectDouyinEditor(accountId: string): ReturnType<DouyinImageTextBrowserAdapter["inspectCurrentImageEditor"]>; closeRuntimeSession(accountId: string, platformKey: "toutiao"): Promise<ToutiaoSessionStatus>; inspectPublishEditor(accountId: string, platformKey: string): Promise<PreSubmitGateResult>; create(input: { platformKey: string; name: string; accountAlias?: string; allowAutoPublish?: boolean; publishMode?: Account["publishMode"] }): Promise<Account>; update(id: string, input: { accountAlias?: string; enabled?: boolean; loginStatus?: Account["loginStatus"]; pausedReason?: string | null; allowAutoPublish?: boolean; publishMode?: Account["publishMode"]; minimumIntervalSeconds?: number }): Promise<Account>; setCredentials(input: { accountId: string; platformKey: string, values: Record<string, string> }): Promise<{ configured: boolean; fields: Array<CredentialField & { configured: boolean }> }>; credentialStatus(accountId: string, platformKey: string): Promise<AccountCredentialStatusView>; beginLogin(accountId: string, platformKey: string, contentKind?: "article"): Promise<LoginSession>; completeLogin(accountId: string, platformKey: string, callbackUrl: string, contentKind?: "article"): Promise<{ configured: boolean; accountStatus: AccountStatus | "Connected"; authorizationStatus: "NotAuthorized" | "Authorized" | "Partial" | "Revoked" | "Unknown"; accountId: string | null; accountName: string | null; scopes: string[]; expiresAt: string | null }>; refreshLogin(accountId: string, platformKey: string): Promise<{ accountStatus: "Connected"; authorizationStatus: "NotAuthorized" | "Authorized" | "Partial" | "Revoked" | "Unknown"; expiresAt: string | null }>; cancelLogin(accountId: string, platformKey: string, contentKind?: "article"): Promise<{ loginStatus: Account["loginStatus"] }>; disconnect(accountId: string, platformKey: string): Promise<AccountDisconnectResult>; openBackend(accountId: string, platformKey: string): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string }>; checkLogin(accountId: string, platformKey: string): Promise<{ loginStatus: Account["loginStatus"] }> };
  platformSelfTest: { list(): Promise<PlatformSelfTestAccountView[]>; get(testRunId: string): Promise<PlatformSelfTestRun | null>; runSafe(platformAccountId: string): Promise<PlatformSelfTestRun>; runPostUploadDiscovery(input: { platformAccountId: string; mode: ControlledSelfTestMode }): Promise<ControlledPostUploadDiscoveryResult>; continue(testRunId: string): Promise<PlatformSelfTestRun>; runLevel(platformAccountId: string, level: PlatformSelfTestLevel): Promise<PlatformSelfTestRun>; healthCheck(): Promise<PlatformSelfTestRun[]>; requestPublish(platformAccountId: string): Promise<PlatformSelfTestRun>; confirmPublish(testRunId: string, testVideoPath?: string): Promise<PlatformSelfTestRun>; cancelPublish(testRunId: string): Promise<PlatformSelfTestRun>; confirmDelete(testRunId: string): Promise<PlatformSelfTestRun> };
  plans: { list(): Promise<PublishPlan[]>; create(input: Omit<PublishPlan, "id">): Promise<PublishPlan>; generateJobs(id: string, scheduledAt: string): Promise<PublishJob[]> };
  jobs: { list(filters?: { status?: string }): Promise<PublishJob[]>; createVideo(input: { accountId: string; platformKey: string; articleId: string; videoAssetId: string; scheduledAt: string }): Promise<PublishJob>; prepareExistingDouyin(id: string): Promise<{ job: PublishJob; record: PublishRecord | null; message: string }>; run(id: string): Promise<{ job: PublishJob; message: string }>; confirm(id: string, dryRun?: boolean): Promise<PublishJob>; reconcile(id: string): Promise<{ job: PublishJob; message: string }>; reconcileBrowser(id: string): Promise<{ job: PublishJob; message: string }>; reconcileNotSubmitted(id: string): Promise<PublishJob>; retry(id: string): Promise<PublishJob>; recover(): Promise<number> };
  logs: { list(limit?: number, filters?: { level?: string; module?: string; search?: string }): Promise<ActivityLog[]>; export(): Promise<string | null> };
  notifications: { list(limit?: number): Promise<Notification[]>; markRead(id: string): Promise<void>; markAllRead(): Promise<void> };
  backups: { queueFull(): Promise<{directory:string;status:"PendingClose"}>; fullList():Promise<{directory:string;status:string;createdAt:string;totalBytes:number}[]>; validateFull(path:string):Promise<{valid:boolean;message:string}>; restoreIsolated(path:string):Promise<{directory:string;automaticExecutionDisabled:true}>; list(): Promise<string[]>; create(): Promise<string>; validate(path: string): Promise<{ valid: boolean; message: string }>; restore(path: string): Promise<{ accepted: boolean }> };
  settings: { get(): Promise<Record<string, unknown>>; update(key: string, value: unknown): Promise<void>; setSecret(kind: "apiKey" | "imageApiKey", value: string): Promise<{ configured: boolean; validationStatus?: string; validationResult?: AIConnectionResult }>; testAi(): Promise<AIConnectionResult> };
}

declare global {
  interface Window { publisherAPI: PublisherApi }
}
