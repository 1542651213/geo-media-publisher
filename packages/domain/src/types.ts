import type { BoundImageBytes } from "./content-snapshot";
import type { KnowledgeSnapshot } from "./brand-facts";

export const ARTICLE_STATUSES = [
  "draft",
  "generating",
  "available",
  "queued",
  "partially_published",
  "published",
  "failed",
  "archived"
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const JOB_STATUSES = [
  "Pending",
  "Scheduled",
  "Preparing",
  "ReadyToSubmit",
  "Running",
  "Submitting",
  "Submitted",
  "Publishing",
  "Published",
  "DryRunPassed",
  "AwaitingConfirmation",
  "Success",
  "Retry",
  "NeedsReconciliation",
  "ReconciledNotPublished",
  "NeedsUserAction",
  "Paused",
  "Failed",
  "Cancelled"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ERROR_CODES = [
  "SESSION_NOT_FOUND",
  "AUTH_NOT_VERIFIED",
  "ACCOUNT_IDENTITY_UNVERIFIED",
  "ACCOUNT_IDENTITY_MISMATCH",
  "CANONICAL_PAGE_NOT_FOUND",
  "CANONICAL_PAGE_CLOSED",
  "CREATOR_HOME_NOT_READY",
  "PUBLISH_NAVIGATION_FAILED",
  "PRE_UPLOAD_NOT_READY",
  "UPLOAD_CAPABILITY_NOT_FOUND",
  "POST_UPLOAD_NOT_READY",
  "INTERMEDIATE_ACTION_REQUIRED",
  "TITLE_EDITOR_NOT_FOUND",
  "TITLE_READBACK_FAILED",
  "BODY_EDITOR_NOT_FOUND",
  "BODY_READBACK_FAILED",
  "REQUIRED_SETTINGS_INCOMPLETE",
  "FINAL_SUBMIT_NOT_READY",
  "ONE_SHOT_AUTHORIZATION_MISSING",
  "ONE_SHOT_AUTHORIZATION_AMBIGUOUS",
  "ONE_SHOT_AUTHORIZATION_CONSUMED",
  "PUBLICATION_NEEDS_RECONCILIATION",
  "NETWORK_ERROR",
  "LOGIN_EXPIRED",
  "AUTH_REQUIRED",
  "USER_ACTION_REQUIRED",
  "UPLOAD_FAILED",
  "PLATFORM_CHANGED",
  "CONTENT_REJECTED",
  "RATE_LIMITED",
  "PERMISSION_DENIED",
  "API_REVIEW_REQUIRED",
  "PROCESSING",
  "TIMEOUT",
  "SUBMISSION_UNCERTAIN",
  "FINAL_SUBMIT_ALREADY_USED",
  "FINAL_SUBMIT_CONTROL_NOT_FOUND",
  "REQUIRED_FIELD_MISSING",
  "EXTERNAL_EVIDENCE_INCOMPLETE",
  "RECONCILIATION_UNCERTAIN",
  "CONFIRMED_NOT_PUBLISHED",
  "UNKNOWN"
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type LoginStatus = "logged_in" | "logged_out" | "expired" | "needs_user_action" | "unknown";
export type AdapterStatus = "ready" | "not_implemented" | "degraded";
export type AuthStrategy = "OAuth2" | "OAuth2PKCE" | "AppCredential" | "ManualSession" | "ManualOnly" | "Unsupported";
export type OAuthCallbackStrategy = "LoopbackCallback" | "CustomProtocolCallback" | "HttpsCallback" | "ManualCodeCallback";
export type AccountStatus = "NotConnected" | "Connecting" | "Connected" | "Unverified" | "Expired" | "NeedsLogin" | "Error";
export type AuthorizationStatus = "NotAuthorized" | "Authorized" | "Partial" | "Revoked" | "Unknown";
export type PublishVerificationStatus = "NotTested" | "DryRunPassed" | "PublishPassed";
export type PlatformResearchStatus = "verified" | "partial" | "unverified" | "manual_only" | "blocked";
export type PlatformHealthStatus = "unknown" | "healthy" | "degraded" | "paused";
export const BACKGROUND_AUTOMATION_STATUSES = ["UNKNOWN", "PASSED", "FAILED", "REQUIRES_VISIBLE_BROWSER"] as const;
export type BackgroundAutomationStatus = (typeof BACKGROUND_AUTOMATION_STATUSES)[number];
export const PLATFORM_LIFECYCLE_STATUSES = [
  "NotResearched",
  "NotImplemented",
  "Researched",
  "Planned",
  "Developing",
  "CodeComplete",
  "WaitingForUser",
  "DryRunPassed",
  "PublishPassed",
  "Stable",
  "Blocked",
  "ManualOnly",
  "Deprecated"
] as const;
export type PlatformLifecycleStatus = (typeof PLATFORM_LIFECYCLE_STATUSES)[number];
/** @deprecated Use PlatformLifecycleStatus. Kept as an alias for V0.3 callers. */
export type PlatformVerificationStatus = PlatformLifecycleStatus;
export type PlatformCapability = "API" | "OAuth" | "BrowserAutomation" | "SemiAuto" | "Manual" | "Blocked";
export type AdapterTransport = "official_api" | "official_sdk" | "browser" | "semi_auto" | "hybrid" | "manual";
export type PublishMode = "AUTO" | "ASSISTED" | "MANUAL";
export type FinalPublishMode = "PREPARE_ONLY" | "CONFIRM_BEFORE_PUBLISH" | "AUTO_PUBLISH";
export type ImageSelectionMode = "random" | "manual" | "none";
export const CONTENT_REVIEW_MODES = ["Off", "WarningOnly", "Strict"] as const;
export type ContentReviewMode = (typeof CONTENT_REVIEW_MODES)[number];
export const normalizeContentReviewMode = (value: unknown): ContentReviewMode =>
  CONTENT_REVIEW_MODES.includes(value as ContentReviewMode) ? value as ContentReviewMode : "WarningOnly";
export type PublishRecordVerificationStatus = "NotTested" | "WaitingUser" | "Verified" | "OwnerVerified" | "Failed";
export const PLATFORM_SELF_TEST_LEVELS = ["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT", "L5_PUBLISH"] as const;
export type PlatformSelfTestLevel = (typeof PLATFORM_SELF_TEST_LEVELS)[number];
export const PLATFORM_SELF_TEST_RESULTS = ["NOT_TESTED", "TESTING", "PASSED", "PARTIAL_PASSED", "WAITING_FOR_USER", "FAILED", "NOT_SUPPORTED"] as const;
export type PlatformSelfTestResult = (typeof PLATFORM_SELF_TEST_RESULTS)[number];
export type PlatformSelfTestCleanupStatus = "NOT_AVAILABLE" | "AVAILABLE" | "WAITING_FOR_CONFIRMATION" | "CLEANED" | "FAILED";
export type CredentialFieldType = "text" | "secret" | "oauth" | "browser_login";
export type ReusePolicy = "once" | "same_platform" | "same_platform_different_account" | "always" | "rewrite";
export type ContentStrategy = "same_article" | "per_platform" | "platform_variant" | "topic_rewrite" | "account_variant";
export type ContentSource = "production" | "content_studio" | "excel_import" | "benchmark" | "mock" | "test";
export const CONTENT_GOALS = ["BrandPromotion", "SEOArticle", "GEOArticle", "Educational", "FAQ", "CaseStyle", "VideoScript"] as const;
export type ContentGoal = (typeof CONTENT_GOALS)[number];
export const PROMOTION_STRENGTHS = ["Soft", "Balanced", "Strong"] as const;
export type PromotionStrength = (typeof PROMOTION_STRENGTHS)[number];
export const CONTENT_INTENTS = ["ServiceIntroduction", "SelectionGuide", "BrandAnswer", "ProblemSolution", "ProfessionalInsight", "LocalService", "FAQ", "CaseStyle", "Educational", "VideoScript"] as const;
export type ContentIntent = (typeof CONTENT_INTENTS)[number];
export const SEARCH_INTENTS = ["Commercial", "CommercialInvestigation", "Informational", "Navigational"] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

export interface CredentialField {
  key: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  helpText?: string;
}

export interface AdapterManifest {
  platformKey: string;
  displayName: string;
  category: string;
  version: string;
  adapterStatus: AdapterStatus;
  authStrategy: AuthStrategy;
  callbackStrategy: OAuthCallbackStrategy;
  status: PlatformLifecycleStatus;
  researchStatus: PlatformResearchStatus;
  transport: AdapterTransport;
  /** Primary integration capability; kept separate from content capabilities. */
  integrationMode?: PlatformCapability;
  supportsArticle: boolean;
  supportsVideo: boolean;
  officialWebsite: string;
  developerPortal?: string;
  lastVerifiedAt?: string;
  blockingReason?: string;
  credentialSchema: CredentialField[];
  officialSources: string[];
}

export interface Brand {
  id: string;
  name: string;
  companyName: string;
  description: string;
  industry?: string;
  officialWebsite?: string;
  notes?: string;
  mainBusiness: string;
  serviceRegions: string[];
  advantages: string[];
  contact: Record<string, string>;
  establishedAt: string;
  address: string;
  serviceProcess: string;
  afterSales: string;
  faq: string;
  certificates: string;
  patents: string;
  equipment: string;
  cases: string;
  aiForbiddenClaims: string[];
  knowledgeEntries?: BrandKnowledgeEntry[];
  createdAt: string;
  updatedAt: string;
}

export type BrandKnowledgeCategory =
  | "company_profile"
  | "service_item"
  | "service_process"
  | "service_area"
  | "enterprise_advantage"
  | "qualification_certificate"
  | "patent"
  | "equipment"
  | "case"
  | "team"
  | "contact"
  | "other_material";

export interface BrandKnowledgeEntry {
  id: string;
  brandId: string;
  category: BrandKnowledgeCategory;
  title: string;
  content: string;
  enabled: boolean;
  sourceKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandAsset {
  id: string;
  brandId: string;
  type: "logo" | "environment" | "team" | "project" | "product" | "equipment" | "certificate" | "case" | "other";
  title: string;
  filePath: string;
  description: string;
  createdAt: string;
}

export interface KeywordTemplate {
  id: string;
  brandId: string;
  template: string;
  category: string;
  enabled: boolean;
}

export interface KeywordItem {
  id: string;
  brandId: string;
  city: string;
  keyword: string;
  sourceTemplateId: string;
  status: "new" | "selected" | "used" | "archived";
  createdAt: string;
}

export interface Article {
  id: string;
  brandId: string;
  topic: string;
  keyword: string;
  city: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  seoKeywords: string[];
  coverAssetId: string | null;
  articleType: string;
  aiProvider: string;
  aiModel: string;
  generatedAt: string;
  status: ArticleStatus;
  reusePolicy: ReusePolicy;
  contentHash: string;
  contentFingerprint?: string;
  qualityStatus?: "unchecked" | "passed" | "warning" | "failed";
  qualityWarnings?: string[];
  useCount: number;
  publishCount: number;
  createdAt: string;
  updatedAt: string;
  contentBindingId?: string | null;
  source?: ContentSource;
  company?: string;
  business?: string;
  targetPlatforms?: string[];
  promotionStrength?: PromotionStrength | null;
  sourceNote?: string;
  importBatchId?: string | null;
  importedAt?: string | null;
  sourceFilename?: string | null;
  contentStudioTaskId?: string | null;
  benchmarkRunId?: string | null;
  benchmarkId?: string | null;
  promptVersion?: string | null;
  contentGoal?: ContentGoal | null;
  contentIntent?: ContentIntent | null;
  searchIntent?: SearchIntent | null;
  knowledgeSnapshot?: KnowledgeSnapshot | null;
  brandMentionCount?: number | null;
  brandFactUsageCount?: number | null;
  uniqueBrandFactCount?: number | null;
  brandDifferentiationScore?: number | null;
  brandDifferentiation?: BrandDifferentiationMetrics | null;
  needsRewrite?: boolean;
}

export interface BrandDifferentiationMetrics {
  brandMentionCount: number;
  brandFactUsageCount: number;
  uniqueBrandFactCount: number;
  serviceFactUsed: boolean;
  regionFactUsed: boolean;
  processFactUsed: boolean;
  qualificationFactUsed: boolean;
  deviceFactUsed: boolean;
  caseFactUsed: boolean;
  score: number;
  genericBrandContent: boolean;
}

export interface ArticleVariant {
  id: string;
  articleId: string;
  platformKey: string;
  title: string;
  body: string;
  summary: string;
  coverAssetId: string | null;
  contentHash: string;
  createdAt: string;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  estimatedCost?: number;
  currency?: string;
}

export interface AIProviderProfile {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  credentialRef: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: number;
  concurrency: number;
  enabled: boolean;
  isDefault: boolean;
  isFallback: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformProfile {
  platformKey: string;
  style: string;
  titleLimit: number;
  preferredMinWords: number;
  preferredMaxWords: number;
  minBodyLength?: number;
  maxBodyLength?: number;
  supportsCover: boolean;
  coverRequired?: boolean;
  coverSizes?: string[];
  maxImages?: number;
  supportsTags: boolean;
  maxTags?: number;
  supportsHtml?: boolean;
  supportsMarkdown: boolean;
  supportsRichText: boolean;
  sourceUrl: string;
  researchStatus: PlatformResearchStatus;
  lastVerifiedAt: string | null;
}

export interface Platform {
  id: string;
  platformKey: string;
  displayName: string;
  category: string;
  enabled: boolean;
  adapterStatus: AdapterStatus;
  authStrategy: AuthStrategy;
  callbackStrategy: OAuthCallbackStrategy;
  adapterVersion: string;
  capabilities: PlatformCapabilities;
  researchStatus: PlatformResearchStatus;
  healthStatus: PlatformHealthStatus;
  verificationStatus: PlatformVerificationStatus;
  lastVerifiedAt: string | null;
  backgroundAutomationStatus: BackgroundAutomationStatus;
  backgroundAutomationLastTestedAt: string | null;
  backgroundAutomationReason: string | null;
  transport: AdapterTransport;
  integrationMode?: PlatformCapability;
  /** Account lifecycle capability; distinct from the platform's publish transport. */
  accountConnectionMode?: PlatformCapability;
  blockingReason: string | null;
  officialWebsite: string;
  developerPortal: string | null;
  credentialSchema: CredentialField[];
  officialSources: string[];
}

export interface Account {
  id: string;
  /** Stable canonical PlatformAccount id. It intentionally equals the legacy account row id. */
  platformAccountId?: string;
  platformKey: string;
  /** Local-only alias used to distinguish multiple accounts on one platform. */
  accountAlias: string;
  /** Display name read from the platform when it can be obtained safely. */
  accountName: string | null;
  name: string;
  groupId: string | null;
  enabled: boolean;
  loginStatus: LoginStatus;
  pausedReason: string | null;
  lastLoginCheck: string | null;
  lastPublishAt: string | null;
  todayPublishCount: number;
  allowAutoPublish: boolean;
  publishMode: "inherit" | "manual" | "auto" | "assisted";
  minimumIntervalSeconds: number;
  failedCount: number;
  connectionMode?: "BrowserAutomation" | "OfficialAPI" | "OAuth" | "Manual";
  authorizationStatus?: AuthorizationStatus;
  browserSessionId?: string | null;
  externalAccountId?: string | null;
  lastVerifiedAt?: string | null;
  lastUsedAt?: string | null;
  /** Non-destructive lifecycle marker; archived accounts remain queryable by id for history. */
  archivedAt?: string | null;
}

export type CreatorIdentityProofSource = "CREATOR_PROFILE_LINK" | "CREATOR_STRUCTURED_DATA" | "CREATOR_ACCOUNT_SURFACE";

export interface CreatorIdentityProof {
  platformKey: "xiaohongshu";
  externalCreatorId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  source: CreatorIdentityProofSource;
  stable: boolean;
}

/** A short-lived identity proof bound to one live BrowserSession Context/Page. */
export interface CurrentRuntimeIdentityProof {
  accountId: string;
  platformKey: "xiaohongshu";
  expectedExternalCreatorId: string;
  observedExternalCreatorId: string;
  canonicalContextId: string;
  canonicalPageId: string;
  verified: true;
}

/** Short-lived identity proof bound to a live XHS BrowserSession and Context.
 * The source Page is only the fresh proof origin; later editor Pages may differ.
 */
export interface XhsContextIdentityAttestation {
  accountId: string;
  platformKey: "xiaohongshu";
  expectedExternalCreatorId: string;
  observedExternalCreatorId: string;
  browserSessionIdentity: string;
  browserContextIdentity: string;
  sourcePageIdentity: string;
  sourceOrigin: "https://creator.xiaohongshu.com";
  sourcePathname: string;
  externalAccountId: string | null;
  issuedAt: string;
  expiresAt: string;
  verified: true;
}

export interface PlatformAccountIdentityBinding {
  id: string;
  platformKey: string;
  accountId: string;
  externalCreatorId: string;
  displayName: string | null;
  profileUrl: string | null;
  bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH" | "OWNER_APPROVED_CREATOR_IDENTITY_BINDING";
  boundAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorIdentityVerificationResult {
  expectedExternalCreatorId: string | null;
  observed: CreatorIdentityProof;
  verified: boolean;
  mismatch: boolean;
  canonicalContextId: string;
  canonicalPageId: string;
  canonicalPageUrl: string;
  domLocationHref: string;
  pageUrlConsistency: "PASS" | "FAIL";
  routeClass: "CREATOR_HOME" | "PUBLISH_EDITOR" | "CREATOR_CONTENT" | "OTHER_CREATOR_PAGE" | "LOGIN" | "SECURITY_VERIFICATION" | "UNKNOWN";
}

export type PlatformAccount = Account;

export interface PlatformSelfTestStep {
  id: string;
  testRunId: string;
  platformKey: string;
  platformAccountId: string;
  testLevel: PlatformSelfTestLevel;
  stepKey: string;
  startedAt: string;
  finishedAt: string | null;
  result: PlatformSelfTestResult;
  errorCode: string | null;
  message: string | null;
  verificationSignal: string | null;
  externalId: string | null;
  externalUrl: string | null;
}

export interface PlatformSelfTestRun {
  id: string;
  testRunId: string;
  platformKey: string;
  /** Immutable local Account primary key selected for this run. */
  accountId: string;
  platformAccountId: string;
  requestedLevel: PlatformSelfTestLevel;
  overallResult: PlatformSelfTestResult;
  startedAt: string;
  finishedAt: string | null;
  lastTestedAt: string;
  publishConfirmedAt: string | null;
  deleteConfirmedAt: string | null;
  testArticleId: string | null;
  publishJobId: string | null;
  publishRecordId: string | null;
  contentBindingId?: string | null;
  externalId: string | null;
  externalUrl: string | null;
  cleanupStatus: PlatformSelfTestCleanupStatus;
  cleanedAt: string | null;
  steps: PlatformSelfTestStep[];
}

export interface Task10SPrepublishResult {
  testRunId: string;
  operationId: string;
  platformKey: "xiaohongshu";
  accountId: string;
  status: "READY_FOR_FINAL_SUBMIT" | "BLOCKED";
  authorizationState: "AUTHORIZED_UNUSED";
  canonicalAuthorizationId: string;
  accountIdentityVerified: boolean;
  creatorId: string | null;
  editor: { attemptCount: number; result: "PASSED" | "BLOCKED"; pageUrl: string | null; routeClass: "PUBLISH_EDITOR" | "UNKNOWN"; contextId: string | null; pageId: string | null; contextCorrelation: "PASS" | "NOT_OBSERVED"; pageCorrelation: "PASS" | "NOT_OBSERVED" };
  safeFixture: { path: string; sha256: string | null; exists: boolean; assetId: string | null };
  image: { attemptCount: number; result: PlatformSelfTestResult; assetId: string | null; domReadback: string | null; previewCount: number | null; error: string | null };
  title: { attemptCount: number; expected: string; observed: string | null; readbackMatch: boolean };
  body: { attemptCount: number; expected: string; observed: string | null; readbackMatch: boolean };
  requiredFields: { total: number; pass: number; missing: string[]; result: "PASS" | "BLOCKED" | "NOT_OBSERVED" };
  settings: { readOnlyCheck: "PASS" | "BLOCKED" | "NOT_OBSERVED"; mutationCount: number; values: Array<{ label: string; required: boolean; value: string }> };
  finalSubmit: { found: boolean; enabled: boolean; text: string | null; count: number; clickCount: number | null };
  preparedContent: { prepared: boolean; imageAssetId: string | null; response: Record<string, unknown> | null };
  prepublishEvidence: { total: number; pass: number; missing: string[] };
  readyToResumeExistingOneShot: boolean;
  database: { before: Record<string, number>; after: Record<string, number> };
  safety: { authorizationMutationCount: 0; prepublishEvidenceMutationCount: number; jobMutationCount: 0; intentMutationCount: 0; publishRecordMutationCount: 0; uploadMutationCount: number; titleMutationCount: number; bodyMutationCount: number; settingsMutationCount: 0; publicationTransactionCount: 0; finalSubmitCount: number | null };
  evidencePath: string | null;
  run: PlatformSelfTestRun;
}

export function defaultAccountSelection(accounts: Account[]): { selectedAccountId: string | null; requiresChoice: boolean } {
  if (accounts.length === 1) return { selectedAccountId: accounts[0]?.platformAccountId ?? accounts[0]?.id ?? null, requiresChoice: false };
  return { selectedAccountId: null, requiresChoice: accounts.length > 1 };
}

export interface PublishPlan {
  id: string;
  name: string;
  brandId: string;
  enabled: boolean;
  strategy: ContentStrategy;
  articlesPerDay: number;
  accountIds: string[];
  publishTimes: string[];
  reusePolicy: ReusePolicy;
  minIntervalSeconds: number;
  maxRetries: number;
  consecutiveFailureThreshold: number;
  startDate: string;
  endDate: string | null;
}

export interface PublishJob {
  id: string;
  planId: string | null;
  accountId: string;
  platformAccountId: string;
  platformKey: string;
  articleId: string;
  articleVariantId: string | null;
  scheduledAt: string;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastErrorCode: ErrorCode | null;
  lastErrorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  dryRun: boolean;
  manualConfirmationRequired: boolean;
  finalPublishMode: FinalPublishMode;
  confirmedAt: string | null;
  contentKind?: "article" | "video";
  videoAssetId?: string | null;
  selectedImageAssetId?: string | null;
  imageSelectionMode?: ImageSelectionMode;
  contentBindingId?: string | null;
}

export interface PublishRecord {
  id: string;
  jobId: string;
  accountId: string;
  /** Persisted records populate this; optional for legacy callers and old fixtures. */
  platformAccountId?: string;
  platformKey: string;
  articleId: string;
  publishedUrl: string | null;
  publishedExternalId: string | null;
  success: boolean;
  status?: "DryRun" | "Prepared" | "Submitted" | "Publishing" | "Published" | "Failed";
  response: Record<string, unknown>;
  publishedAt: string;
  dryRun?: boolean;
  publishMode?: PublishMode;
  automationType?: PlatformCapability;
  contentBindingId?: string | null;
  browserSessionIdHash?: string | null;
  operator?: string;
  verificationStatus?: PublishRecordVerificationStatus;
  editorOpenedAt?: string | null;
  titleFilled?: boolean | null;
  bodyFilled?: boolean | null;
  selectedImageAssetId?: string | null;
  imageSelectionMode?: ImageSelectionMode;
}

export interface ImageAsset {
  id: string;
  brandId: string | null;
  name: string;
  filePath: string;
  previewUrl?: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  tags: string[];
  business: string[];
  city: string[];
  usage: string[];
  platform: string[];
  universal: boolean;
  enabled: boolean;
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCapabilities {
  article: boolean;
  imagePost: boolean;
  video: boolean;
  /** Explicit, typed entry modes exposed by the platform UI. */
  controlledSelfTestModes?: string[];
  coverImage: boolean;
  tags: boolean;
  categories: boolean;
  scheduledPublish: boolean;
  draft: boolean;
  markdown: boolean;
  richText: boolean;
  maxTitleLength: number;
  maxImageCount: number;
  maxTagCount?: number;
  maxVideoSize?: number;
  maxVideoDuration?: number;
  videoFormats?: string[];
  supportsVideoCover?: boolean;
  supportsVideoTags?: boolean;
  videoPublishAsync?: boolean;
}

export interface AccountContext {
  assertContentSnapshotCurrent?: () => void;
  accountId: string;
  accountName: string;
  platformKey: string;
  settings: Record<string, string | number | boolean>;
  /** Main-process-only proof bound to the current canonical browser runtime. */
  runtimeIdentityProof?: CurrentRuntimeIdentityProof;
  /** Main-process-only proof bound to the current XHS Session and Context. */
  runtimeIdentityAttestation?: XhsContextIdentityAttestation;
  /** Main-process-only credentials. Never serialize or log this object in the renderer. */
  secrets?: Record<string, string>;
}

export interface PublishArticleInput {
  boundImages?: BoundImageBytes[];
  contentSnapshotId?: string;
  articleId: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  coverPath?: string;
  images?: string[];
  variantId?: string;
  category?: string;
  location?: string;
  topic?: string;
}

export interface VideoAsset {
  id: string;
  localPath: string;
  fileName: string;
  mimeType: string;
  size: number;
  durationMs?: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface PublishVideoInput {
  title: string;
  description?: string;
  tags: string[];
  videoPath: string;
  coverPath?: string;
}

export interface PublishResult {
  success: boolean;
  status?: "published" | "publishing" | "failed";
  dryRun?: boolean;
  prepared?: boolean;
  publishedUrl?: string;
  externalId?: string;
  response: Record<string, unknown>;
  editorOpenedAt?: string | null;
  titleFilled?: boolean;
  bodyFilled?: boolean;
}

export const OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH = "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH" as const;
export const ONE_SHOT_REAL_PUBLISH_ACCEPTANCE = "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE" as const;

export type OneShotPublicationAuthorizationState =
  | "NOT_AUTHORIZED"
  | "AUTHORIZED_UNUSED"
  | "ARMED"
  | "FINAL_MOUSEPRESS_DISPATCH_STARTED"
  | "SUBMIT_RECONCILIATION_REQUIRED"
  | "CONSUMED"
  | "COMPLETED"
  | "SUPERSEDED_UNUSED";

export interface OneShotPublicationAuthorization {
  authorization: typeof OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH;
  state: OneShotPublicationAuthorizationState;
  platformKey: "xiaohongshu";
  /** Immutable account selected when the run/operation was created. */
  accountId: string;
  operationId: string;
  mode: typeof ONE_SHOT_REAL_PUBLISH_ACCEPTANCE;
  publicationTransactionCount: number;
  publicationCommitActionCount: number;
  finalSubmitAttemptCount: number;
  finalSubmitRetryCount: number;
  finalSubmitActionStarted: boolean;
  finalSubmitActionCompleted: boolean;
  createdAt?: string;
  updatedAt?: string;
  consumedAt?: string | null;
  contentBindingId?: string | null;
}

export interface OneShotAuthorizationConvergenceResult {
  reusableOperationId: string | null;
  supersededOperationIds: string[];
  activeUnusedAuthorizationCount: number;
  mutationCount: number;
}

export interface XhsIdentityAcceptance {
  verification: CreatorIdentityVerificationResult;
  binding: PlatformAccountIdentityBinding | null;
  convergence: OneShotAuthorizationConvergenceResult;
}

export interface FailedOneShotConfirmationIdentity {
  testRunId: string;
  platformKey: "xiaohongshu";
  accountId: string;
}

export interface OneShotConfirmationReconciliationSnapshot {
  identity: FailedOneShotConfirmationIdentity;
  run: PlatformSelfTestRun;
  authorizationCount: number;
  operationCount: number;
  publicationTransactionCount: number;
  finalSubmitAttemptCount: number;
  externalPublicationEvidence: boolean;
  needsReconciliation: boolean;
  publishedOrVerified: boolean;
}

export type OneShotConfirmationReconciliationStatus = "RECONCILED_RETRYABLE" | "ALREADY_RECONCILED";

export interface OneShotConfirmationReconciliationResult {
  status: OneShotConfirmationReconciliationStatus;
  testRunId: string;
  mutationCount: 0 | 1;
  retryEligible: true;
}

export const EXCEL_TEMPLATE_VERSION = "1.0";
export const EXCEL_SIMPLE_ARTICLE_HEADERS = ["标题", "内容"] as const;
export const EXCEL_ADVANCED_ARTICLE_HEADERS = [
  "标题",
  "正文",
  "摘要",
  "企业",
  "业务",
  "城市",
  "关键词",
  "标签",
  "目标平台",
  "内容类型",
  "推广程度",
  "来源备注"
] as const;
export const EXCEL_ARTICLE_HEADERS = [
  "templateVersion",
  "标题",
  "正文",
  "摘要",
  "企业",
  "业务",
  "城市",
  "关键词",
  "标签",
  "目标平台",
  "内容类型",
  "推广程度",
  "来源备注"
] as const;

export interface ExcelArticleRowInput {
  rowNumber: number;
  templateVersion: string;
  title: string;
  body: string;
  summary: string;
  company: string;
  business: string;
  city: string;
  keywords: string;
  tags: string;
  targetPlatforms: string;
  contentType: string;
  promotionStrength: string;
  sourceNote: string;
}

export const EXCEL_IMPORT_DIAGNOSTIC_CODES = [
  "MISSING_TITLE",
  "MISSING_CONTENT",
  "DUPLICATE_CONTENT",
  "INVALID_HEADER",
  "UNSUPPORTED_WORKBOOK",
  "UNKNOWN_COLUMN",
  "TITLE_TOO_LONG",
  "CONTENT_TOO_LONG",
  "INVALID_TEMPLATE_VERSION",
  "UNKNOWN_BRAND",
  "INVALID_PLATFORM",
  "INVALID_CONTENT_TYPE",
  "INVALID_PROMOTION_STRENGTH"
] as const;

export type ExcelImportDiagnosticCode = typeof EXCEL_IMPORT_DIAGNOSTIC_CODES[number];
export type ExcelImportRowStatus = "VALID" | "DUPLICATE" | "WARNING" | "UNKNOWN_BRAND" | "INVALID";
export type ExcelImportDiagnosticSeverity = "ERROR" | "WARNING";

export interface ExcelImportSheetCandidate {
  sheetName: string;
  headers: string[];
  rowCount: number;
  unknownColumns: string[];
}

export interface ExcelImportDiagnostic {
  sheetName: string | null;
  rowNumber: number | null;
  title: string;
  severity: ExcelImportDiagnosticSeverity;
  code: ExcelImportDiagnosticCode;
  message: string;
}

export interface ExcelImportPreviewRow extends ExcelArticleRowInput {
  contentHash: string;
  matchedBrandId: string | null;
  normalizedTargetPlatforms: string[];
  status: ExcelImportRowStatus;
  diagnosticCodes: ExcelImportDiagnosticCode[];
  errorCodes: string[];
  errorReason: string;
  duplicateArticleId: string | null;
  duplicateRowNumber: number | null;
}

export interface ExcelImportPreview {
  fileName: string;
  templateVersion: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  warningRows: number;
  warnings: string[];
  diagnostics: ExcelImportDiagnostic[];
  selectedSheetName: string | null;
  sheetCandidates: ExcelImportSheetCandidate[];
  requiresSheetSelection: boolean;
  defaultBrandId: string | null;
  rows: ExcelImportPreviewRow[];
}

export interface ExcelImportResult {
  importBatchId: string;
  imported: number;
  skippedDuplicates: number;
  failed: number;
  articleIds: string[];
}

export interface PublishStatusResult {
  status: "publishing" | "published" | "failed";
  externalId?: string;
  publishedUrl?: string;
  response: Record<string, unknown>;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export interface Notification {
  id: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  relatedId: string | null;
  read: boolean;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface LoginSession {
  sessionId: string;
  requiresUserAction: boolean;
  message?: string;
  authorizationUrl?: string;
  callbackUrl?: string;
  opened?: boolean;
  authStrategy?: AuthStrategy;
  callbackStrategy?: OAuthCallbackStrategy;
  diagnostic?: {
    errorCode: string;
    module: string;
    timestamp: string;
    attemptedChannels?: string[];
    selectedChannel?: string;
  };
}

export interface AccountProfile {
  accountId?: string;
  accountName?: string;
  scopes?: string[];
  expiresAt?: string;
  authorizationStatus?: AuthorizationStatus;
}

export interface DashboardStats {
  publishedToday: number;
  pendingJobs: number;
  failedJobs: number;
  runningJobs: number;
  totalAccounts: number;
  onlineAccounts: number;
  expiredAccounts: number;
  availableArticles: number;
  generatedToday: number;
  estimatedStockDays: number;
  activeAiTasks: number;
  benchmarkArticles?: number;
  productionArticles?: number;
  aiGeneratedToday?: number;
  aiInputTokensToday?: number;
  aiOutputTokensToday?: number;
  aiEstimatedCostToday?: number | null;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  module: string;
  code: string;
  message: string;
  context: Record<string, unknown>;
}
