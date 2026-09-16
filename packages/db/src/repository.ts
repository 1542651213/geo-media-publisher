import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { CONTENT_STUDIO_PLATFORM_KEYS, CORE_AI_FABRICATION_RULES, conservativePlatformContentRules, expandKeywords, normalizeContentReviewMode } from "@publisher/domain";
import type { Account, ActivityLog, AdapterManifest, AIProviderProfile, AIUsage, Article, ArticleVariant, BackgroundAutomationStatus, Brand, BrandAsset, BrandDifferentiationMetrics, BrandKnowledgeCategory, BrandKnowledgeEntry, CityRegion, ContentGoal, ContentIntent, ContentQualityCheckResult, ContentQualityContentType, ContentQualityIssue, ContentQualityStatus, ContentQualityTrigger, ContentReviewMode, ContentSource, ContentStudioContent, ContentStudioPlatformKey, ContentStudioTopicPlan, DashboardStats, ExcelArticleRowInput, ExcelImportDiagnostic, ExcelImportDiagnosticCode, ExcelImportPreview, ExcelImportPreviewRow, ExcelImportResult, ExcelImportSheetCandidate, FailedOneShotConfirmationIdentity, FinalPublishMode, ImageAsset, ImageSelectionMode, KnowledgeSnapshot, KeywordItem, KeywordTemplate, LoginStatus, Notification, OneShotAuthorizationConvergenceResult, OneShotConfirmationReconciliationResult, OneShotConfirmationReconciliationSnapshot, OneShotPublicationAuthorization, Platform, PlatformAccountIdentityBinding, PlatformCapability, PlatformCapabilities, PlatformContentRules, PlatformProfile, PlatformSelfTestCleanupStatus, PlatformSelfTestLevel, PlatformSelfTestResult, PlatformSelfTestRun, PlatformSelfTestStep, PromotionStrength, PublishJob, PublishPlan, PublishRecord, SearchIntent, VideoAsset } from "@publisher/domain";

type SqlValue = string | number | null;
type Row = Record<string, unknown>;

export type StoredVideoAssetStatus = "Draft" | "Ready" | "DryRun" | "Published" | "Failed";

export interface OneShotConfirmationPersistenceResult {
  authorization: OneShotPublicationAuthorization;
  created: boolean;
}

const ONE_SHOT_CONFIRMATION_ERROR = "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED";
const ONE_SHOT_CONFIRMATION_STEP = "PUBLISH_CONFIRMATION";

function reconciliationFailure(snapshot: OneShotConfirmationReconciliationSnapshot): string | null {
  const step = snapshot.run.steps.find((item) => item.stepKey === ONE_SHOT_CONFIRMATION_STEP);
  if (snapshot.identity.platformKey !== "xiaohongshu") return "ONE_SHOT_RECONCILIATION_PLATFORM_MISMATCH";
  if (snapshot.run.platformKey !== snapshot.identity.platformKey || snapshot.run.accountId !== snapshot.identity.accountId || snapshot.run.platformAccountId !== snapshot.identity.accountId) return "ONE_SHOT_RECONCILIATION_ACCOUNT_MISMATCH";
  if (snapshot.run.requestedLevel !== "L5_PUBLISH" || snapshot.run.overallResult !== "WAITING_FOR_USER") return "ONE_SHOT_RECONCILIATION_STATE_MISMATCH";
  if (!snapshot.run.publishConfirmedAt) return "ONE_SHOT_RECONCILIATION_NOT_PARTIAL";
  if (snapshot.authorizationCount !== 0) return "ONE_SHOT_RECONCILIATION_AUTHORIZATION_EXISTS";
  if (snapshot.operationCount !== 0) return "ONE_SHOT_RECONCILIATION_OPERATION_EXISTS";
  if (snapshot.publicationTransactionCount !== 0) return "ONE_SHOT_RECONCILIATION_PUBLICATION_STARTED";
  if (snapshot.finalSubmitAttemptCount !== 0) return "ONE_SHOT_RECONCILIATION_FINAL_SUBMIT_STARTED";
  if (snapshot.externalPublicationEvidence) return "ONE_SHOT_RECONCILIATION_EXTERNAL_EVIDENCE_EXISTS";
  if (snapshot.needsReconciliation) return "ONE_SHOT_RECONCILIATION_NEEDS_RECONCILIATION";
  if (snapshot.publishedOrVerified) return "ONE_SHOT_RECONCILIATION_ALREADY_PUBLISHED";
  if (!step || step.result !== "WAITING_FOR_USER" || step.errorCode !== ONE_SHOT_CONFIRMATION_ERROR) return "ONE_SHOT_RECONCILIATION_CONFIRMATION_STEP_MISMATCH";
  return null;
}

function isCanonicalRetryable(snapshot: OneShotConfirmationReconciliationSnapshot): boolean {
  const step = snapshot.run.steps.find((item) => item.stepKey === ONE_SHOT_CONFIRMATION_STEP);
  return snapshot.run.platformKey === snapshot.identity.platformKey
    && snapshot.run.accountId === snapshot.identity.accountId
    && snapshot.run.platformAccountId === snapshot.identity.accountId
    && snapshot.run.requestedLevel === "L5_PUBLISH"
    && snapshot.run.overallResult === "WAITING_FOR_USER"
    && snapshot.run.publishConfirmedAt === null
    && snapshot.run.publishJobId === null
    && snapshot.run.publishRecordId === null
    && snapshot.run.testArticleId === null
    && snapshot.authorizationCount === 0
    && snapshot.operationCount === 0
    && snapshot.publicationTransactionCount === 0
    && snapshot.finalSubmitAttemptCount === 0
    && !snapshot.externalPublicationEvidence
    && !snapshot.needsReconciliation
    && !snapshot.publishedOrVerified
    && step?.result === "WAITING_FOR_USER"
    && step.errorCode === ONE_SHOT_CONFIRMATION_ERROR;
}

export interface StoredVideoAsset extends VideoAsset {
  brandId: string | null;
  title: string;
  description: string;
  tags: string[];
  coverPath: string | null;
  coverAssetId: string | null;
  platformFields: Record<string, Record<string, string>>;
  status: StoredVideoAssetStatus;
}

export interface AccountAuthorizationView {
  accountId: string;
  platformKey: string;
  authorizationType: string;
  status: "NotAuthorized" | "Authorized" | "Partial" | "Revoked" | "Unknown";
  scopes: string[];
  expiresAt: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  updatedAt: string;
}

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const studioContentHash = (title: string, body: string, platformKey?: string): string => createHash("sha256").update(`${title}\n${body}${platformKey ? `\n${platformKey}` : ""}`).digest("hex");
const excelContentHash = (title: string, body: string): string => createHash("sha256").update(`${title.trim()}\n${body.trim()}`).digest("hex");
const CONTENT_REVIEW_PLATFORM_KEYS = [...CONTENT_STUDIO_PLATFORM_KEYS];
const legacyKnowledgeColumn: Record<string, string> = {
  advantages: "advantages_json",
  serviceProcess: "service_process",
  afterSales: "after_sales",
  faq: "faq",
  certificates: "certificates",
  patents: "patents",
  equipment: "equipment",
  cases: "cases"
};
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
function textValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function boolValue(value: unknown): boolean { return value === 1 || value === true; }
function intValue(value: unknown): number { return typeof value === "number" ? value : Number(value ?? 0); }
function stringArray(value: unknown): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}
function stringRecord(value: unknown): Record<string, string> {
  const parsed = parseJson<unknown>(value, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"));
}
function splitSemicolon(value: string): string[] { return [...new Set(value.split(/[;；]/u).map((item) => item.trim()).filter(Boolean))]; }
function normalizeLabels(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function nestedStringRecord(value: unknown): Record<string, Record<string, string>> {
  const parsed = parseJson<unknown>(value, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, stringRecord(JSON.stringify(item))]));
}
function isPlatformCapability(value: unknown): value is PlatformCapability { return ["API", "OAuth", "BrowserAutomation", "SemiAuto", "Manual", "Blocked"].includes(value as string); }
function inferIntegrationMode(transport: string, authStrategy?: string): PlatformCapability {
  if (transport === "browser") return "BrowserAutomation";
  if (transport === "semi_auto") return "SemiAuto";
  if (transport === "manual") return "Manual";
  if (authStrategy === "OAuth2" || authStrategy === "OAuth2PKCE") return "OAuth";
  if (transport === "official_api" || transport === "official_sdk" || transport === "hybrid") return "API";
  return "Blocked";
}
const sensitiveLogKey = /^(authorization|bearer|api[_-]?key|apikey|appsecret|secret|cookie|set-cookie|access_token|refresh_token|password|storagestate|token)$/iu;
function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
  if (Array.isArray(value)) return value.map(sanitizeLogValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => sensitiveLogKey.test(key) ? [key, "[REDACTED]"] : [key, sanitizeLogValue(item)]));
  return value;
}
function sanitizeSelfTestEvidence(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/(authorization|cookie|storageState|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .slice(0, 2_000);
}

export interface BrandInput {
  name: string;
  companyName: string;
  description?: string;
  industry?: string;
  officialWebsite?: string;
  notes?: string;
  mainBusiness?: string;
  serviceRegions?: string[];
  advantages?: string[];
  contact?: Record<string, string>;
  establishedAt?: string;
  address?: string;
  serviceProcess?: string;
  afterSales?: string;
  faq?: string;
  certificates?: string;
  patents?: string;
  equipment?: string;
  cases?: string;
  aiForbiddenClaims?: string[];
}

export interface BrandKnowledgeEntryInput {
  brandId: string;
  category: BrandKnowledgeCategory;
  title: string;
  content: string;
  enabled?: boolean;
}

export interface ArticleInput {
  brandId: string;
  topic: string;
  keyword: string;
  city: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  seoKeywords: string[];
  articleType: string;
  aiProvider: string;
  aiModel: string;
  generatedAt: string;
  reusePolicy: string;
  contentHash: string;
  qualityStatus?: Article["qualityStatus"];
  qualityWarnings?: string[];
  source?: ContentSource;
  company?: string;
  business?: string;
  targetPlatforms?: string[];
  promotionStrength?: PromotionStrength | null;
  sourceNote?: string;
  importBatchId?: string | null;
  importedAt?: string | null;
  sourceFilename?: string | null;
  contentFingerprint?: string;
}

export interface JobInput {
  planId: string | null;
  accountId: string;
  platformKey: string;
  articleId: string;
  articleVariantId: string | null;
  scheduledAt: string;
  maxAttempts: number;
}

export interface AIBatchTarget {
  keywordId?: string;
  city: string;
  keyword: string;
  articleType: string;
  targetIndex: number;
}

export interface AIBatchItem {
  id: string;
  batchId: string;
  keywordId: string | null;
  city: string;
  keyword: string;
  articleType: string;
  targetIndex: number;
  status: "Pending" | "Running" | "Completed" | "Retry" | "Failed" | "Cancelled";
  attemptCount: number;
  articleId: string | null;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ArticlePage {
  items: Article[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface JobPage {
  items: PublishJob[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AIProviderProfileInput extends Omit<AIProviderProfile, "id" | "createdAt" | "updatedAt"> {
  id?: string;
}

export interface ContentStudioTaskPayload {
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

export interface ContentStudioTaskView {
  id: string;
  parentTaskId: string | null;
  rootTaskId: string;
  brandId: string;
  type: string;
  payload: ContentStudioTaskPayload;
  output: { topicPlan?: ContentStudioTopicPlan; sourceArticleId?: string; structuredDiagnostics?: Array<Record<string, unknown>>; knowledgeSnapshot?: KnowledgeSnapshot; promptVersion?: string; contentIntent?: ContentIntent; searchIntent?: SearchIntent; brandDifferentiationByPlatform?: Record<string, BrandDifferentiationMetrics>; providerDiagnostics?: Record<string, unknown> };
  provider: string;
  model: string;
  status: string;
  total: number;
  completed: number;
  success: number;
  failed: number;
  errorMessage: string | null;
  usage: AIUsage;
  durationMs: number;
  sourceArticleId: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface ContentStudioVersionView extends ContentStudioContent {
  id: string;
  taskId: string;
  rootTaskId: string;
  versionNumber: number;
  mediaAssetIds: string[];
  videoAssetIds: string[];
  sourceArticleId: string | null;
  articleVariantId: string | null;
  provider: string;
  model: string;
  usage: AIUsage;
  isCurrent: boolean;
  qualityStatus: ContentQualityStatus;
  qualityReviewId: string | null;
  createdAt: string;
}

export interface ContentQualityStateView {
  contentType: ContentQualityContentType;
  contentId: string;
  brandId: string;
  platformKey: string | null;
  status: ContentQualityStatus;
  contentHash: string;
  lastReviewId: string | null;
  version: number;
  updatedAt: string;
}

export interface ContentQualityReviewView {
  id: string;
  contentType: ContentQualityContentType;
  contentId: string;
  brandId: string;
  platformKey: string | null;
  status: Exclude<ContentQualityStatus, "Draft">;
  trigger: ContentQualityTrigger;
  provider: string;
  model: string;
  score: number;
  checks: ContentQualityCheckResult[];
  issues: ContentQualityIssue[];
  contentHash: string;
  snapshot: Record<string, unknown>;
  operatorType: "system" | "human";
  previousStatus: ContentQualityStatus | null;
  newStatus: ContentQualityStatus | null;
  reason: string | null;
  createdAt: string;
}

export interface ContentQualityAuditView {
  id: string;
  contentType: ContentQualityContentType;
  contentId: string;
  operatorType: "system" | "human";
  previousStatus: ContentQualityStatus;
  newStatus: ContentQualityStatus;
  reason: string;
  timestamp: string;
  contentHash: string;
}

export type QualityBenchmarkRunType = "MOCK_BASELINE" | "DEEPSEEK_REAL";
export type QualityBenchmarkRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "BLOCKED" | "FAILED";

export interface QualityBenchmarkRunView {
  benchmarkRunId: string;
  benchmarkId: string;
  datasetVersion: string;
  runType: QualityBenchmarkRunType;
  provider: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  promptVersion: string;
  status: QualityBenchmarkRunStatus;
  controlStatus: "RUNNING" | "PAUSED" | "CANCELLED";
  startedAt: string;
  completedAt: string | null;
  totalDurationMs: number;
  successCount: number;
  failureCount: number;
  totalTokenUsage: AIUsage;
  estimatedCost: number | null;
  similaritySummary: Record<string, number>;
  blockReason: string | null;
  createdAt: string;
}

export type QualityBenchmarkItemStatus = "Pending" | "Running" | "Success" | "Failed" | "RetryableFailure";
export type QualityBenchmarkItemAttemptStatus = "Success" | "Failed" | "RetryableFailure";

export interface QualityBenchmarkItemAttemptView {
  id: string;
  benchmarkItemId: string;
  attemptNumber: number;
  status: QualityBenchmarkItemAttemptStatus;
  failureCategory: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  diagnostics: Array<Record<string, unknown>>;
  finishReason: string | null;
  responseLength: number;
  requestDurationMs: number;
  tokenUsage: AIUsage;
  createdAt: string;
}

export interface QualityBenchmarkItemView {
  id: string;
  benchmarkRunId: string;
  benchmarkId: string;
  datasetVersion: string;
  promptVersion: string;
  topicIndex: number;
  topic: string;
  city: string;
  keyword: string;
  business: string;
  platformKey: string;
  status: QualityBenchmarkItemStatus;
  attemptCount: number;
  contentStudioTaskId: string | null;
  contentTypeId: string | null;
  provider: string;
  model: string;
  errorCode: string | null;
  errorMessage: string | null;
  failureCategory: string | null;
  diagnostics: Array<Record<string, unknown>>;
  requestDurationMs: number;
  tokenUsage: AIUsage;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityBenchmarkContentView {
  id: string;
  benchmarkRunId: string;
  benchmarkId: string;
  datasetVersion: string;
  topicIndex: number;
  topic: string;
  city: string;
  keyword: string;
  platformKey: string;
  contentType: "article" | "video_script";
  contentTypeId: string;
  provider: string;
  model: string;
  contentHash: string;
  qualityStatus: ContentQualityStatus;
  riskCount: number;
  revisionNumber: number;
  isCurrent: boolean;
  requestDurationMs: number;
  tokenUsage: AIUsage;
  intraPlatformSimilarity: number | null;
  crossPlatformSimilarity: number | null;
  createdAt: string;
}

export interface QualityBenchmarkMetrics {
  generatedVariantCount: number;
  currentUniqueContentCount: number;
  currentStatusCount: Record<ContentQualityStatus, number>;
  reviewEventCount: number;
  revisionCount: number;
  approvedUniqueContentCount: number;
  rejectedUniqueContentCount: number;
}

export interface ContentQualityItemView {
  contentType: ContentQualityContentType;
  contentId: string;
  brandId: string;
  articleId: string;
  platformKey: string | null;
  title: string;
  body: string;
  summary: string;
  city: string;
  keyword: string;
  status: ContentQualityStatus;
  score: number | null;
  issueCount: number;
  contentHash: string;
  updatedAt: string;
}

export type HumanReviewDatasetStatus = "WAITING_FOR_HUMAN_REVIEW" | "HUMAN_REVIEW_COMPLETED";
export type HumanReviewItemStatus = "Pending" | "Completed";
export type HumanReviewDecision = "TruePositive" | "FalsePositive" | "Uncertain" | "MissedIssue";
export type HumanReviewMachineDecision = "Detected" | "NotDetected";
export type HumanReviewFinalStatus = Exclude<ContentQualityStatus, "Draft">;

export interface HumanReviewContentSnapshot {
  contentType: ContentQualityContentType;
  contentId: string;
  platformKey: string | null;
  title: string;
  body: string;
  summary: string;
  contentHash: string;
}

export interface HumanReviewIssueDecisionView {
  id: string;
  ruleId: string;
  issueIndex: number;
  machineDecision: HumanReviewMachineDecision;
  humanDecision: HumanReviewDecision;
  reason: string | null;
  issue: ContentQualityIssue | null;
}

export interface HumanReviewMachineIssueView {
  ruleId: string;
  issueIndex: number;
  machineDecision: HumanReviewMachineDecision;
  issue: ContentQualityIssue;
  humanDecision: HumanReviewDecision | null;
  reason: string | null;
}

export interface HumanReviewItemReviewView {
  id: string;
  datasetItemId: string;
  reviewerType: "human";
  reviewedAt: string;
  originalStatus: ContentQualityStatus;
  finalStatus: HumanReviewFinalStatus;
  reviewDurationMs: number;
  editCount: number;
  originalContentHash: string;
  finalContentHash: string;
  originalContent: HumanReviewContentSnapshot;
  finalContent: HumanReviewContentSnapshot;
  reason: string | null;
  issueDecisions: HumanReviewIssueDecisionView[];
  createdAt: string;
}

export interface HumanReviewDatasetItemView {
  id: string;
  datasetId: string;
  sequence: number;
  contentType: ContentQualityContentType;
  contentId: string;
  benchmarkContentId: string;
  topicIndex: number;
  topic: string;
  city: string;
  keyword: string;
  business: string;
  platformKey: string | null;
  title: string;
  originalStatus: ContentQualityStatus;
  originalRiskCount: number;
  originalContentHash: string;
  selectionReason: string;
  reviewStatus: HumanReviewItemStatus;
  finalStatus: HumanReviewFinalStatus | null;
  originalContent: HumanReviewContentSnapshot;
  content: HumanReviewContentSnapshot;
  issues: HumanReviewMachineIssueView[];
  latestReview: HumanReviewItemReviewView | null;
  createdAt: string;
  updatedAt: string;
}

export interface HumanReviewDatasetView {
  id: string;
  datasetId: string;
  benchmarkRunId: string;
  version: string;
  status: HumanReviewDatasetStatus;
  targetCount: number;
  completedCount: number;
  selectionReason: string;
  composition: Record<HumanReviewFinalStatus | "Draft", number>;
  platforms: string[];
  items: HumanReviewDatasetItemView[];
  createdAt: string;
  updatedAt: string;
}

export interface HumanReviewSubmitInput {
  datasetItemId: string;
  finalStatus: HumanReviewFinalStatus;
  reviewDurationMs: number;
  editCount: number;
  originalContentHash: string;
  finalContentHash: string;
  originalContent: HumanReviewContentSnapshot;
  finalContent: HumanReviewContentSnapshot;
  issueDecisions: Array<{
    ruleId: string;
    issueIndex: number;
    machineDecision: HumanReviewMachineDecision;
    humanDecision: HumanReviewDecision;
    reason?: string | null;
    issue?: ContentQualityIssue | null;
  }>;
  reason?: string | null;
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

export class AppRepository {
  readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  listBrands(): Brand[] {
    return (this.db.prepare("SELECT * FROM brands ORDER BY updated_at DESC").all() as Row[]).map((row) => this.brandFromRow(row));
  }

  getBrand(id: string): Brand | null {
    const row = this.db.prepare("SELECT * FROM brands WHERE id = ?").get(id) as Row | undefined;
    return row ? this.brandFromRow(row) : null;
  }

  createBrand(input: BrandInput): Brand {
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO brands (id,name,company_name,description,industry,official_website,notes,main_business,service_regions_json,advantages_json,contact_json,established_at,address,service_process,after_sales,faq,certificates,patents,equipment,cases,ai_forbidden_claims_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.name.trim(), input.companyName.trim(), input.description ?? "", input.industry ?? "", input.officialWebsite ?? "", input.notes ?? "", input.mainBusiness ?? "", json(input.serviceRegions ?? []), json(input.advantages ?? []), json(input.contact ?? {}), input.establishedAt ?? "", input.address ?? "", input.serviceProcess ?? "", input.afterSales ?? "", input.faq ?? "", input.certificates ?? "", input.patents ?? "", input.equipment ?? "", input.cases ?? "", json(input.aiForbiddenClaims ?? []), timestamp, timestamp
    );
    this.createLegacyKnowledgeEntries(id, input, timestamp);
    return this.getBrand(id) as Brand;
  }

  updateBrand(id: string, input: Partial<BrandInput>): Brand {
    const current = this.getBrand(id);
    if (!current) throw new Error("品牌不存在");
    const merged: BrandInput = {
      name: input.name ?? current.name,
      companyName: input.companyName ?? current.companyName,
      description: input.description ?? current.description,
      industry: input.industry ?? current.industry ?? "",
      officialWebsite: input.officialWebsite ?? current.officialWebsite ?? "",
      notes: input.notes ?? current.notes ?? "",
      mainBusiness: input.mainBusiness ?? current.mainBusiness,
      serviceRegions: input.serviceRegions ?? current.serviceRegions,
      advantages: input.advantages ?? current.advantages,
      contact: input.contact ?? current.contact,
      establishedAt: input.establishedAt ?? current.establishedAt,
      address: input.address ?? current.address,
      serviceProcess: input.serviceProcess ?? current.serviceProcess,
      afterSales: input.afterSales ?? current.afterSales,
      faq: input.faq ?? current.faq,
      certificates: input.certificates ?? current.certificates,
      patents: input.patents ?? current.patents,
      equipment: input.equipment ?? current.equipment,
      cases: input.cases ?? current.cases,
      aiForbiddenClaims: input.aiForbiddenClaims ?? current.aiForbiddenClaims
    };
    const timestamp = now();
    this.db.prepare(`UPDATE brands SET name=?, company_name=?, description=?, industry=?, official_website=?, notes=?, main_business=?, service_regions_json=?, advantages_json=?, contact_json=?, established_at=?, address=?, service_process=?, after_sales=?, faq=?, certificates=?, patents=?, equipment=?, cases=?, ai_forbidden_claims_json=?, updated_at=? WHERE id=?`).run(
      merged.name, merged.companyName, merged.description, merged.industry, merged.officialWebsite, merged.notes, merged.mainBusiness, json(merged.serviceRegions), json(merged.advantages), json(merged.contact), merged.establishedAt, merged.address, merged.serviceProcess, merged.afterSales, merged.faq, merged.certificates, merged.patents, merged.equipment, merged.cases, json(merged.aiForbiddenClaims), timestamp, id
    );
    return this.getBrand(id) as Brand;
  }

  listBrandKnowledgeEntries(brandId: string): BrandKnowledgeEntry[] {
    return (this.db.prepare("SELECT * FROM brand_knowledge_entries WHERE brand_id=? ORDER BY category, updated_at DESC, created_at DESC").all(brandId) as Row[]).map(toBrandKnowledgeEntry);
  }

  createBrandKnowledgeEntry(input: BrandKnowledgeEntryInput): BrandKnowledgeEntry {
    if (!this.getBrand(input.brandId)) throw new Error("企业资料不存在");
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare("INSERT INTO brand_knowledge_entries (id,brand_id,category,title,content,enabled,source_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, input.brandId, input.category, input.title.trim(), input.content.trim(), input.enabled === false ? 0 : 1, null, timestamp, timestamp);
    this.touchBrand(input.brandId, timestamp);
    return toBrandKnowledgeEntry(this.db.prepare("SELECT * FROM brand_knowledge_entries WHERE id=?").get(id) as Row);
  }

  updateBrandKnowledgeEntry(id: string, input: Partial<Pick<BrandKnowledgeEntryInput, "category" | "title" | "content" | "enabled">>): BrandKnowledgeEntry {
    const row = this.db.prepare("SELECT * FROM brand_knowledge_entries WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new Error("知识资料不存在");
    const current = toBrandKnowledgeEntry(row);
    const timestamp = now();
    const updated = {
      category: input.category ?? current.category,
      title: input.title?.trim() ?? current.title,
      content: input.content?.trim() ?? current.content,
      enabled: input.enabled ?? current.enabled
    };
    this.db.prepare("UPDATE brand_knowledge_entries SET category=?,title=?,content=?,enabled=?,updated_at=? WHERE id=?").run(updated.category, updated.title, updated.content, updated.enabled ? 1 : 0, timestamp, id);
    this.syncLegacyKnowledge(row.source_key, current.brandId, updated.content);
    this.touchBrand(current.brandId, timestamp);
    return toBrandKnowledgeEntry(this.db.prepare("SELECT * FROM brand_knowledge_entries WHERE id=?").get(id) as Row);
  }

  deleteBrandKnowledgeEntry(id: string): void {
    const row = this.db.prepare("SELECT * FROM brand_knowledge_entries WHERE id=?").get(id) as Row | undefined;
    if (!row) return;
    this.db.prepare("DELETE FROM brand_knowledge_entries WHERE id=?").run(id);
    this.syncLegacyKnowledge(row.source_key, textValue(row.brand_id), "");
    this.touchBrand(textValue(row.brand_id), now());
  }

  private brandFromRow(row: Row): Brand {
    const brand = toBrand(row);
    const entries = this.listBrandKnowledgeEntries(brand.id);
    for (const entry of entries) {
      if (!entry.sourceKey) continue;
      const content = entry.enabled ? entry.content : "";
      if (entry.sourceKey === "advantages") brand.advantages = content ? normalizeLabels(content.split(/[、,，；;|\n]+/u)) : [];
      else if (entry.sourceKey === "serviceProcess") brand.serviceProcess = content;
      else if (entry.sourceKey === "afterSales") brand.afterSales = content;
      else if (entry.sourceKey === "faq") brand.faq = content;
      else if (entry.sourceKey === "certificates") brand.certificates = content;
      else if (entry.sourceKey === "patents") brand.patents = content;
      else if (entry.sourceKey === "equipment") brand.equipment = content;
      else if (entry.sourceKey === "cases") brand.cases = content;
    }
    brand.knowledgeEntries = entries;
    brand.aiForbiddenClaims = [...new Set([...CORE_AI_FABRICATION_RULES, ...brand.aiForbiddenClaims.map((item) => item.trim()).filter(Boolean)])];
    return brand;
  }

  private createLegacyKnowledgeEntries(brandId: string, input: BrandInput, timestamp: string): void {
    const rows: Array<{ category: BrandKnowledgeCategory; title: string; content: string; sourceKey: string }> = [
      { category: "enterprise_advantage", title: "企业优势", content: (input.advantages ?? []).join("；"), sourceKey: "advantages" },
      { category: "service_process", title: "服务流程", content: input.serviceProcess ?? "", sourceKey: "serviceProcess" },
      { category: "service_process", title: "售后服务", content: input.afterSales ?? "", sourceKey: "afterSales" },
      { category: "other_material", title: "常见问题", content: input.faq ?? "", sourceKey: "faq" },
      { category: "qualification_certificate", title: "资质证书", content: input.certificates ?? "", sourceKey: "certificates" },
      { category: "patent", title: "专利", content: input.patents ?? "", sourceKey: "patents" },
      { category: "equipment", title: "设备", content: input.equipment ?? "", sourceKey: "equipment" },
      { category: "case", title: "案例", content: input.cases ?? "", sourceKey: "cases" }
    ];
    const insert = this.db.prepare("INSERT OR IGNORE INTO brand_knowledge_entries (id,brand_id,category,title,content,enabled,source_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const item of rows.filter((item) => item.content.trim())) insert.run(`legacy:${brandId}:${item.sourceKey}`, brandId, item.category, item.title, item.content.trim(), 1, item.sourceKey, timestamp, timestamp);
  }

  private syncLegacyKnowledge(sourceKey: unknown, brandId: string, content: string): void {
    const column = typeof sourceKey === "string" ? legacyKnowledgeColumn[sourceKey] : undefined;
    if (!column) return;
    const value = sourceKey === "advantages" ? json(normalizeLabels(content.split(/[、,，；;|\n]+/u))) : content;
    this.db.prepare(`UPDATE brands SET ${column}=? WHERE id=?`).run(value, brandId);
  }

  private touchBrand(brandId: string, timestamp: string): void {
    this.db.prepare("UPDATE brands SET updated_at=? WHERE id=?").run(timestamp, brandId);
  }

  listAssets(brandId: string): BrandAsset[] {
    return (this.db.prepare("SELECT * FROM brand_assets WHERE brand_id = ? ORDER BY created_at DESC").all(brandId) as Row[]).map(toAsset);
  }

  createAsset(input: Omit<BrandAsset, "id" | "createdAt">): BrandAsset {
    const asset = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO brand_assets (id,brand_id,type,title,file_path,description,created_at) VALUES (?,?,?,?,?,?,?)").run(asset.id, asset.brandId, asset.type, asset.title, asset.filePath, asset.description, asset.createdAt);
    return asset;
  }

  createMediaAsset(input: { id?: string; brandId: string; type: string; title: string; filePath: string; provider?: string; model?: string; metadata?: Record<string, unknown> }): string {
    const id = input.id ?? randomUUID();
    this.db.prepare("INSERT INTO media_assets (id,brand_id,type,title,file_path,provider,model,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, input.brandId, input.type, input.title, input.filePath, input.provider ?? null, input.model ?? null, json(input.metadata ?? {}), now());
    return id;
  }

  getMediaAsset(id: string): { id: string; filePath: string; provider: string; model: string } | null {
    const row = this.db.prepare("SELECT id,file_path,provider,model FROM media_assets WHERE id=?").get(id) as Row | undefined;
    if (!row) return null;
    return { id: textValue(row.id), filePath: textValue(row.file_path), provider: textValue(row.provider), model: textValue(row.model) };
  }

  listImageAssets(brandId?: string, enabledOnly = false): ImageAsset[] {
    const clauses = ["type='image'"];
    const values: SqlValue[] = [];
    if (brandId) { clauses.push("brand_id=?"); values.push(brandId); }
    const rows = this.db.prepare(`SELECT * FROM media_assets WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`).all(...values) as Row[];
    const assets = rows.map(toImageAsset);
    return enabledOnly ? assets.filter((asset) => asset.enabled) : assets;
  }

  getImageAsset(id: string): ImageAsset | null {
    const row = this.db.prepare("SELECT * FROM media_assets WHERE id=? AND type='image'").get(id) as Row | undefined;
    return row ? toImageAsset(row) : null;
  }

  createImageAsset(input: { id?: string; brandId: string | null; name: string; filePath: string; originalFileName: string; mimeType: string; size: number; tags?: string[]; business?: string[]; city?: string[]; usage?: string[]; platform?: string[]; universal?: boolean; enabled?: boolean }): ImageAsset {
    const id = input.id ?? randomUUID();
    const timestamp = now();
    const metadata = { originalFileName: input.originalFileName, mimeType: input.mimeType, size: input.size, tags: normalizeLabels(input.tags ?? []), business: normalizeLabels(input.business ?? []), city: normalizeLabels(input.city ?? []), usage: normalizeLabels(input.usage ?? []), platform: normalizeLabels(input.platform ?? []), universal: input.universal ?? false, enabled: input.enabled ?? true, lastUsedAt: null, useCount: 0, updatedAt: timestamp };
    this.db.prepare("INSERT INTO media_assets (id,brand_id,type,title,file_path,provider,model,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, input.brandId, "image", input.name.trim() || input.originalFileName, input.filePath, "local", null, json(metadata), timestamp);
    return this.getImageAsset(id) as ImageAsset;
  }

  updateImageAsset(id: string, input: { name?: string; tags?: string[]; business?: string[]; city?: string[]; usage?: string[]; platform?: string[]; universal?: boolean; enabled?: boolean }): ImageAsset {
    const current = this.getImageAsset(id);
    if (!current) throw new Error("图片不存在");
    const next = { ...current, name: input.name?.trim() || current.name, tags: input.tags === undefined ? current.tags : normalizeLabels(input.tags), business: input.business === undefined ? current.business : normalizeLabels(input.business), city: input.city === undefined ? current.city : normalizeLabels(input.city), usage: input.usage === undefined ? current.usage : normalizeLabels(input.usage), platform: input.platform === undefined ? current.platform : normalizeLabels(input.platform), universal: input.universal ?? current.universal, enabled: input.enabled ?? current.enabled, updatedAt: now() };
    this.db.prepare("UPDATE media_assets SET title=?, metadata_json=? WHERE id=? AND type='image'").run(next.name, json({ originalFileName: next.originalFileName, mimeType: next.mimeType, size: next.size, tags: next.tags, business: next.business, city: next.city, usage: next.usage, platform: next.platform, universal: next.universal, enabled: next.enabled, lastUsedAt: next.lastUsedAt, useCount: next.useCount, updatedAt: next.updatedAt }), id);
    return this.getImageAsset(id) as ImageAsset;
  }

  deleteImageAsset(id: string): ImageAsset {
    const current = this.getImageAsset(id);
    if (!current) throw new Error("图片不存在");
    this.db.prepare("DELETE FROM media_assets WHERE id=? AND type='image'").run(id);
    return current;
  }

  markImageAssetUsed(id: string): ImageAsset {
    const current = this.getImageAsset(id);
    if (!current) throw new Error("图片不存在");
    const timestamp = now();
    this.db.prepare("UPDATE media_assets SET metadata_json=? WHERE id=? AND type='image'").run(json({ originalFileName: current.originalFileName, mimeType: current.mimeType, size: current.size, tags: current.tags, business: current.business, city: current.city, usage: current.usage, platform: current.platform, universal: current.universal, enabled: current.enabled, lastUsedAt: timestamp, useCount: current.useCount + 1, updatedAt: timestamp }), id);
    return this.getImageAsset(id) as ImageAsset;
  }

  selectImageAssetForArticle(articleId: string, platformKey: string, recentCount = 3, excludedIds: string[] = []): ImageAsset | null {
    const article = this.getArticle(articleId);
    if (!article) throw new Error("文章不存在");
    const assets = this.listImageAssets(article.brandId, true);
    if (assets.length === 0) return null;
    const recentRows = this.db.prepare("SELECT selected_image_asset_id FROM publish_jobs WHERE selected_image_asset_id IS NOT NULL ORDER BY created_at DESC LIMIT ?").all(Math.max(0, Math.floor(recentCount))) as Row[];
    const recentIds = new Set(recentRows.map((row) => textValue(row.selected_image_asset_id)).filter(Boolean));
    assets.filter((asset) => asset.lastUsedAt).sort((left, right) => String(right.lastUsedAt).localeCompare(String(left.lastUsedAt))).slice(0, recentCount).forEach((asset) => recentIds.add(asset.id));
    const business = article.business ? [article.business] : [];
    const city = article.city ? [article.city] : [];
    const platformAliases: Record<string, string[]> = {
      zhihu: ["zhihu", "知乎"],
      baijiahao: ["baijiahao", "百家号"],
      weibo: ["weibo", "微博"],
    };
    const platforms = [
      ...(platformAliases[platformKey] ?? [platformKey]),
      ...(article.targetPlatforms ?? []),
    ];
    const usageTargets = [article.keyword, article.business, ...article.seoKeywords, ...article.tags].filter((value): value is string => Boolean(value));
    const equal = (left: string, right: string): boolean => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
    const has = (labels: string[], targets: string[]): boolean => labels.some((label) => targets.some((target) => equal(label, target)));
    const scored = assets.map((asset) => {
      const universal = asset.universal || [...asset.tags, ...asset.business, ...asset.city, ...asset.platform].some((label) => equal(label, "通用"));
      const businessMatch = business.length > 0 && has(asset.business, business);
      const cityMatch = city.length > 0 && has(asset.city, city);
      const platformMatch = has(asset.platform, platforms);
      const usageMatch = has([...asset.usage, ...asset.tags], usageTargets);
      let score = 0;
      if (businessMatch && cityMatch) score = 500;
      else if (businessMatch) score = 400;
      else if (cityMatch) score = 300;
      else if (usageMatch) score = 200;
      else if (universal) score = 100;
      if (platformMatch && score > 0) score += 10;
      return { asset, score };
    }).filter((item) => item.score > 0);
    const notExcluded = scored.filter((item) => !excludedIds.includes(item.asset.id));
    const candidates = notExcluded.length > 0 ? notExcluded : scored;
    const fresh = candidates.filter((item) => !recentIds.has(item.asset.id) && item.asset.useCount === 0);
    const nonRecent = candidates.filter((item) => !recentIds.has(item.asset.id));
    const pool = fresh.length > 0 ? fresh : nonRecent.length > 0 ? nonRecent : candidates;
    if (pool.length === 0) return null;
    const highest = Math.max(...pool.map((item) => item.score));
    const matched = pool.filter((item) => item.score === highest);
    const lowestUsage = Math.min(...matched.map((item) => item.asset.useCount));
    const best = matched.filter((item) => item.asset.useCount === lowestUsage);
    return best[Math.floor(Math.random() * best.length)]?.asset ?? null;
  }

  createVideoAsset(input: Omit<VideoAsset, "id" | "createdAt"> & { id?: string }): VideoAsset {
    const asset: VideoAsset = { ...input, id: input.id ?? randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO video_assets (id,local_path,file_name,mime_type,size_bytes,duration_ms,width,height,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
      asset.id, asset.localPath, asset.fileName, asset.mimeType, asset.size, asset.durationMs ?? null,
      asset.width ?? null, asset.height ?? null, asset.createdAt
    );
    return asset;
  }

  getVideoAsset(id: string): VideoAsset | null {
    const row = this.db.prepare("SELECT * FROM video_assets WHERE id=?").get(id) as Row | undefined;
    return row ? toVideoAsset(row) : null;
  }

  getManagedVideoAsset(id: string): StoredVideoAsset | null {
    return this.listVideoAssets().find((asset) => asset.id === id) ?? null;
  }

  listVideoAssets(brandId?: string): StoredVideoAsset[] {
    const rows = (brandId
      ? this.db.prepare("SELECT v.*, m.brand_id, m.title, m.metadata_json FROM video_assets v LEFT JOIN media_assets m ON m.id=v.id AND m.type='video' WHERE m.brand_id=? ORDER BY v.created_at DESC").all(brandId)
      : this.db.prepare("SELECT v.*, m.brand_id, m.title, m.metadata_json FROM video_assets v LEFT JOIN media_assets m ON m.id=v.id AND m.type='video' ORDER BY v.created_at DESC").all()) as Row[];
    return rows.map((row) => toStoredVideoAsset(row, this.db));
  }

  updateVideoAsset(id: string, input: { title?: string; description?: string; tags?: string[]; coverPath?: string | null; coverAssetId?: string | null; durationMs?: number; width?: number; height?: number; platformFields?: Record<string, Record<string, string>> }): StoredVideoAsset {
    const current = this.getManagedVideoAsset(id);
    if (!current) throw new Error("视频素材不存在");
    const metadata = {
      description: input.description ?? current.description,
      tags: input.tags ?? current.tags,
      coverPath: input.coverPath === undefined ? current.coverPath : input.coverPath,
      coverAssetId: input.coverAssetId === undefined ? current.coverAssetId : input.coverAssetId,
      platformFields: input.platformFields ?? current.platformFields,
      status: current.status
    };
    this.db.prepare("UPDATE media_assets SET title=?, metadata_json=? WHERE id=? AND type='video'").run(input.title ?? current.title, json(metadata), id);
    if (input.durationMs !== undefined || input.width !== undefined || input.height !== undefined) {
      this.db.prepare("UPDATE video_assets SET duration_ms=?, width=?, height=? WHERE id=?").run(input.durationMs ?? current.durationMs ?? null, input.width ?? current.width ?? null, input.height ?? current.height ?? null, id);
    }
    return this.getManagedVideoAsset(id) as StoredVideoAsset;
  }

  listContentStudioMediaAssets(brandId: string): ContentStudioMediaAssetView[] {
    const rows = this.db.prepare("SELECT id,title,type,provider,model,metadata_json FROM media_assets WHERE brand_id=? ORDER BY created_at DESC").all(brandId) as Row[];
    return rows.map((row) => {
      const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
      return {
        id: textValue(row.id),
        title: textValue(row.title),
        type: textValue(row.type),
        provider: typeof row.provider === "string" ? row.provider : null,
        model: typeof row.model === "string" ? row.model : null,
        description: typeof metadata.description === "string" ? metadata.description : "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.filter((item): item is string => typeof item === "string") : []
      };
    });
  }

  expandContentStudioKeywords(input: { brandId: string; cities: string[]; keywords: string[]; industry?: string }): { items: KeywordItem[]; duplicates: number } {
    const cities = [...new Set(input.cities.map((city) => city.trim()).filter(Boolean))];
    const seeds = [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))];
    if (cities.length === 0 || seeds.length === 0) return { items: [], duplicates: 0 };
    const template = this.listKeywordTemplates(input.brandId).find((item) => item.template.includes("{城市}")) ?? this.createKeywordTemplate({ brandId: input.brandId, template: "{城市}{业务}", category: "AI Content Studio" });
    const insert = this.db.prepare("INSERT OR IGNORE INTO keyword_items (id,brand_id,city,keyword,source_template_id,status,created_at) VALUES (?,?,?,?,?,?,?)");
    const items: KeywordItem[] = [];
    let attempted = 0;
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      for (const city of cities) {
        for (const seed of seeds) {
          const keyword = seed.includes(city) ? seed : `${city}${input.industry?.trim() && !seed.includes(input.industry.trim()) ? `${input.industry.trim()}${seed}` : seed}`;
          attempted += 1;
          const id = randomUUID();
          const result = insert.run(id, input.brandId, city, keyword, template.id, "new", timestamp);
          if (result.changes > 0) items.push({ id, brandId: input.brandId, city, keyword, sourceTemplateId: template.id, status: "new", createdAt: timestamp });
        }
      }
    });
    transaction();
    return { items, duplicates: attempted - items.length };
  }

  getContentStudioTask(id: string): ContentStudioTaskView | null {
    const row = this.db.prepare("SELECT * FROM content_studio_tasks WHERE id=?").get(id) as Row | undefined;
    return row ? toContentStudioTask(row) : null;
  }

  listContentStudioTasks(brandId?: string): ContentStudioTaskView[] {
    const rows = (brandId
      ? this.db.prepare("SELECT * FROM content_studio_tasks WHERE brand_id=? ORDER BY created_at DESC").all(brandId)
      : this.db.prepare("SELECT * FROM content_studio_tasks ORDER BY created_at DESC").all()) as Row[];
    return rows.map(toContentStudioTask);
  }

  listResumableContentStudioTasks(): ContentStudioTaskView[] {
    return (this.db.prepare("SELECT * FROM content_studio_tasks WHERE status='running' ORDER BY created_at").all() as Row[]).map(toContentStudioTask);
  }

  createContentStudioTask(input: { brandId: string; type: string; provider: string; model: string; totalCount: number; payload: ContentStudioTaskPayload; parentTaskId?: string | null }): string {
    const id = randomUUID();
    const timestamp = now();
    const parent = input.parentTaskId ? this.getContentStudioTask(input.parentTaskId) : null;
    const rootTaskId = parent?.rootTaskId ?? input.parentTaskId ?? id;
    this.db.prepare("INSERT INTO content_studio_tasks (id,parent_task_id,root_task_id,brand_id,type,input_json,output_json,provider,model,status,total_count,source_article_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.parentTaskId ?? null, rootTaskId, input.brandId, input.type, json(input.payload), json(parent?.output ?? {}), input.provider, input.model, "running", input.totalCount, parent?.sourceArticleId ?? null, timestamp, timestamp);
    return id;
  }

  updateContentStudioTask(id: string, input: { completed: number; success: number; failed: number; status: string; errorMessage?: string | null; usage?: AIUsage; durationMs?: number; output?: Record<string, unknown>; sourceArticleId?: string | null }): ContentStudioTaskView {
    const current = this.getContentStudioTask(id);
    if (!current) throw new Error("Content Studio task not found");
    const timestamp = now();
    const mergedOutput = { ...current.output, ...(input.output ?? {}) };
    const finished = ["completed", "partial", "failed", "cancelled"].includes(input.status);
    this.db.prepare("UPDATE content_studio_tasks SET completed_count=?,success_count=?,failed_count=?,status=?,error_message=?,usage_json=?,duration_ms=?,output_json=?,source_article_id=COALESCE(?,source_article_id),updated_at=?,finished_at=? WHERE id=?").run(input.completed, input.success, input.failed, input.status, input.errorMessage ?? null, json(input.usage ?? current.usage), input.durationMs ?? current.durationMs, json(mergedOutput), input.sourceArticleId ?? null, timestamp, finished ? timestamp : null, id);
    return this.getContentStudioTask(id) as ContentStudioTaskView;
  }

  resetContentStudioTaskForRecovery(id: string, payload: ContentStudioTaskPayload): ContentStudioTaskView {
    const current = this.getContentStudioTask(id);
    if (!current) throw new Error("Content Studio task not found");
    if (current.sourceArticleId) throw new Error("Content Studio task already has a source article");
    const output = payload.topicPlan ? { topicPlan: payload.topicPlan } : {};
    this.db.prepare("UPDATE content_studio_tasks SET input_json=?,output_json=?,completed_count=0,success_count=0,failed_count=0,status='running',error_message=NULL,usage_json=?,duration_ms=0,updated_at=?,finished_at=NULL WHERE id=?").run(json(payload), json(output), json({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }), now(), id);
    return this.getContentStudioTask(id) as ContentStudioTaskView;
  }

  persistContentStudioPlan(id: string, plan: ContentStudioTopicPlan, usage?: AIUsage): ContentStudioTaskView {
    const task = this.getContentStudioTask(id);
    if (!task) throw new Error("Content Studio task not found");
    this.db.prepare("UPDATE content_studio_tasks SET output_json=?,usage_json=?,updated_at=? WHERE id=?").run(json({ ...task.output, topicPlan: plan }), json(usage ?? task.usage), now(), id);
    return this.getContentStudioTask(id) as ContentStudioTaskView;
  }

  persistContentStudioOutput(input: { taskId: string; brandId: string; output: ContentStudioContent; mediaAssetIds: string[]; videoAssetIds: string[]; provider: string; model: string; usage?: AIUsage }): ContentStudioVersionView {
    const task = this.getContentStudioTask(input.taskId);
    if (!task) throw new Error("Content Studio task not found");
    const rootTaskId = task.rootTaskId;
    const versionRow = this.db.prepare("SELECT COALESCE(MAX(version_number),0)+1 AS next_version FROM content_studio_versions WHERE root_task_id=? AND platform_key=?").get(rootTaskId, input.output.platformKey) as Row;
    const versionNumber = intValue(versionRow.next_version);
    let sourceArticleId = task.sourceArticleId;
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      if (!sourceArticleId) {
        const articleInput: ArticleInput = {
          brandId: input.brandId,
          topic: task.output.topicPlan?.topics[0]?.title ?? `${task.payload.industry}${task.payload.keywords[0] ?? "内容主题"}`,
          keyword: task.payload.keywords[0] ?? "",
          city: task.payload.cities[0] ?? "",
          title: input.output.title,
          body: input.output.body,
          summary: input.output.summary,
          tags: input.output.tags,
          seoKeywords: input.output.seoKeywords,
          articleType: "AI Content Studio",
          aiProvider: input.provider,
          aiModel: input.model,
          generatedAt: timestamp,
          reusePolicy: "rewrite",
          contentHash: studioContentHash(input.output.title, input.output.body),
          source: "production",
          company: this.getBrand(input.brandId)?.companyName ?? "",
          business: task.payload.business ?? task.payload.keyword ?? task.payload.keywords[0] ?? "",
          targetPlatforms: task.payload.targetPlatforms
        };
        const article = this.createArticle(articleInput);
        const existing = this.getArticleByContentHash(articleInput.contentHash);
        if (existing && existing.brandId !== input.brandId) throw new Error("Content Studio 内容 Hash 已属于其他品牌");
        sourceArticleId = article?.id ?? existing?.id ?? null;
        if (!sourceArticleId) throw new Error("Content Studio source article was not persisted");
        this.db.prepare("UPDATE content_studio_tasks SET source_article_id=?,output_json=?,updated_at=? WHERE id=?").run(sourceArticleId, json({ ...task.output, sourceArticleId }), timestamp, input.taskId);
      }
      const variant = this.createArticleVariant({ articleId: sourceArticleId as string, platformKey: input.output.platformKey, title: input.output.title, body: input.output.body, summary: input.output.summary, coverAssetId: null, contentHash: studioContentHash(input.output.title, input.output.body, input.output.platformKey) });
      this.db.prepare("UPDATE content_studio_versions SET is_current=0 WHERE root_task_id=? AND platform_key=?").run(rootTaskId, input.output.platformKey);
      this.db.prepare("INSERT INTO content_studio_versions (id,task_id,root_task_id,brand_id,platform_key,version_number,content_type,title,body,summary,tags_json,seo_keywords_json,tone,structure_json,keyword_layout_json,media_asset_ids_json,video_asset_ids_json,source_article_id,article_variant_id,provider,model,usage_json,is_current,quality_status,quality_review_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), input.taskId, rootTaskId, input.brandId, input.output.platformKey, versionNumber, input.output.contentType, input.output.title, input.output.body, input.output.summary, json(input.output.tags), json(input.output.seoKeywords), input.output.tone, json(input.output.structure), json(input.output.keywordLayout), json(input.mediaAssetIds), json(input.videoAssetIds), sourceArticleId, variant.id, input.provider, input.model, json(input.usage ?? {}), 1, "Draft", null, timestamp);
    });
    transaction();
    const row = this.db.prepare("SELECT * FROM content_studio_versions WHERE root_task_id=? AND platform_key=? AND version_number=?").get(rootTaskId, input.output.platformKey, versionNumber) as Row;
    return toContentStudioVersion(row);
  }

  listContentStudioVersions(rootTaskId: string, platformKey?: ContentStudioPlatformKey): ContentStudioVersionView[] {
    const rows = (platformKey
      ? this.db.prepare("SELECT * FROM content_studio_versions WHERE root_task_id=? AND platform_key=? ORDER BY version_number DESC").all(rootTaskId, platformKey)
      : this.db.prepare("SELECT * FROM content_studio_versions WHERE root_task_id=? ORDER BY created_at DESC").all(rootTaskId)) as Row[];
    return rows.map(toContentStudioVersion);
  }

  getContentStudioVersion(id: string): ContentStudioVersionView | null {
    const row = this.db.prepare("SELECT * FROM content_studio_versions WHERE id=?").get(id) as Row | undefined;
    return row ? toContentStudioVersion(row) : null;
  }

  updateContentStudioVersion(id: string, input: Partial<Pick<ContentStudioContent, "title" | "body" | "summary" | "tags" | "seoKeywords">>): ContentStudioVersionView {
    const current = this.getContentStudioVersion(id);
    if (!current) throw new Error("Content Studio version not found");
    const title = input.title ?? current.title;
    const body = input.body ?? current.body;
    const summary = input.summary ?? current.summary;
    const tags = input.tags ?? current.tags;
    const seoKeywords = input.seoKeywords ?? current.seoKeywords;
    if (current.articleVariantId) this.updateArticleVariant(current.articleVariantId, { title, body, summary });
    this.db.prepare("UPDATE content_studio_versions SET title=?,body=?,summary=?,tags_json=?,seo_keywords_json=?,quality_status='Draft',quality_review_id=NULL WHERE id=?").run(title, body, summary, json(tags), json(seoKeywords), id);
    return this.getContentStudioVersion(id) as ContentStudioVersionView;
  }

  private ensureQualityState(contentType: ContentQualityContentType, contentId: string, brandId: string, platformKey: string | null, contentHash: string, status: ContentQualityStatus): void {
    this.db.prepare("INSERT INTO content_quality_states (content_type,content_id,brand_id,platform_key,status,content_hash,last_review_id,version,updated_at) VALUES (?,?,?,?,?,?,NULL,0,?) ON CONFLICT(content_type,content_id) DO UPDATE SET brand_id=excluded.brand_id,platform_key=excluded.platform_key,status=excluded.status,content_hash=excluded.content_hash,last_review_id=CASE WHEN excluded.status='Draft' THEN NULL ELSE content_quality_states.last_review_id END,version=content_quality_states.version+1,updated_at=excluded.updated_at").run(contentType, contentId, brandId, platformKey, status, contentHash, now());
  }

  getContentQualityState(contentType: ContentQualityContentType, contentId: string): ContentQualityStateView | null {
    const row = this.db.prepare("SELECT * FROM content_quality_states WHERE content_type=? AND content_id=?").get(contentType, contentId) as Row | undefined;
    return row ? toContentQualityState(row) : null;
  }

  saveContentQualityReview(input: { contentType: ContentQualityContentType; contentId: string; brandId: string; platformKey: string | null; contentHash: string; trigger: ContentQualityTrigger; provider: string; model: string; result: { status: Exclude<ContentQualityStatus, "Draft">; score: number; checks: ContentQualityCheckResult[]; issues: ContentQualityIssue[] }; snapshot: Record<string, unknown>; operatorType?: "system" | "human"; previousStatus?: ContentQualityStatus; reason?: string; benchmarkRunId?: string }): ContentQualityReviewView {
    const id = randomUUID();
    const timestamp = now();
    const previousState = this.getContentQualityState(input.contentType, input.contentId);
    const previousStatus = input.previousStatus ?? previousState?.status ?? "Draft";
    const operatorType = input.operatorType ?? "system";
    const reason = input.reason ?? (operatorType === "human" ? "人工审核状态变更" : "自动质量检查");
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO content_quality_reviews (id,content_type,content_id,brand_id,platform_key,status,trigger,provider,model,score,checks_json,issues_json,content_hash,snapshot_json,operator_type,previous_status,new_status,reason,created_at,benchmark_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.contentType, input.contentId, input.brandId, input.platformKey, input.result.status, input.trigger, input.provider, input.model, input.result.score, json(input.result.checks), json(input.result.issues), input.contentHash, json(input.snapshot), operatorType, previousStatus, input.result.status, reason, timestamp, input.benchmarkRunId ?? null);
      this.db.prepare("INSERT INTO content_quality_states (content_type,content_id,brand_id,platform_key,status,content_hash,last_review_id,version,updated_at) VALUES (?,?,?,?,?,?,?,1,?) ON CONFLICT(content_type,content_id) DO UPDATE SET brand_id=excluded.brand_id,platform_key=excluded.platform_key,status=excluded.status,content_hash=excluded.content_hash,last_review_id=excluded.last_review_id,version=content_quality_states.version+1,updated_at=excluded.updated_at").run(input.contentType, input.contentId, input.brandId, input.platformKey, input.result.status, input.contentHash, id, timestamp);
      this.recordContentQualityAudit({ contentType: input.contentType, contentId: input.contentId, operatorType, previousStatus, newStatus: input.result.status, reason, contentHash: input.contentHash, benchmarkRunId: input.benchmarkRunId });
      if (input.contentType === "article") {
        const legacyStatus = input.result.status === "AI_Checked" || input.result.status === "Approved" ? "passed" : input.result.status === "Needs_Review" ? "warning" : "failed";
        this.db.prepare("UPDATE articles SET quality_status=?,quality_warnings_json=?,updated_at=? WHERE id=?").run(legacyStatus, json(input.result.issues.map((item) => item.message)), timestamp, input.contentId);
      }
      if (input.contentType === "article_variant") this.db.prepare("UPDATE content_studio_versions SET quality_status=?,quality_review_id=? WHERE article_variant_id=? AND is_current=1").run(input.result.status, id, input.contentId);
    })();
    return this.getContentQualityReview(id) as ContentQualityReviewView;
  }

  createQualityBenchmarkRun(input: { benchmarkRunId: string; benchmarkId: string; datasetVersion: string; runType: QualityBenchmarkRunType; provider: string; model: string; temperature?: number | null; maxTokens?: number | null; promptVersion: string; status?: QualityBenchmarkRunStatus; startedAt?: string }): QualityBenchmarkRunView {
    const timestamp = input.startedAt ?? now();
    this.db.prepare("INSERT INTO quality_benchmark_runs (benchmark_run_id,benchmark_id,dataset_version,run_type,provider,model,temperature,max_tokens,prompt_version,status,started_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(input.benchmarkRunId, input.benchmarkId, input.datasetVersion, input.runType, input.provider, input.model, input.temperature ?? null, input.maxTokens ?? null, input.promptVersion, input.status ?? "PENDING", timestamp, timestamp);
    return this.getQualityBenchmarkRun(input.benchmarkRunId) as QualityBenchmarkRunView;
  }

  seedQualityBenchmarkItems(items: Array<{ id?: string; benchmarkRunId: string; benchmarkId: string; datasetVersion: string; promptVersion: string; topicIndex: number; topic: string; city: string; keyword: string; business: string; platformKey: string; provider: string; model: string }>): QualityBenchmarkItemView[] {
    const timestamp = now();
    const insert = this.db.prepare("INSERT OR IGNORE INTO quality_benchmark_items (id,benchmark_run_id,benchmark_id,dataset_version,prompt_version,topic_index,topic,city,keyword,business,platform_key,status,provider,model,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const transaction = this.db.transaction(() => {
      for (const item of items) insert.run(item.id ?? randomUUID(), item.benchmarkRunId, item.benchmarkId, item.datasetVersion, item.promptVersion, item.topicIndex, item.topic, item.city, item.keyword, item.business, item.platformKey, "Pending", item.provider, item.model, timestamp, timestamp);
    });
    transaction();
    return this.listQualityBenchmarkItems(items[0]?.benchmarkRunId ?? "");
  }

  getQualityBenchmarkItem(id: string): QualityBenchmarkItemView | null {
    const row = this.db.prepare("SELECT * FROM quality_benchmark_items WHERE id=?").get(id) as Row | undefined;
    return row ? toQualityBenchmarkItem(row) : null;
  }

  listQualityBenchmarkItems(benchmarkRunId: string): QualityBenchmarkItemView[] {
    return (this.db.prepare("SELECT * FROM quality_benchmark_items WHERE benchmark_run_id=? ORDER BY topic_index,platform_key").all(benchmarkRunId) as Row[]).map(toQualityBenchmarkItem);
  }

  recordQualityBenchmarkItemAttempt(input: { benchmarkItemId: string; attemptNumber: number; status: QualityBenchmarkItemAttemptStatus; failureCategory?: string | null; errorCode?: string | null; errorMessage?: string | null; diagnostics?: Array<Record<string, unknown>>; finishReason?: string | null; responseLength?: number; requestDurationMs?: number; tokenUsage?: AIUsage }): QualityBenchmarkItemAttemptView {
    const id = randomUUID();
    this.db.prepare("INSERT INTO quality_benchmark_item_attempts (id,benchmark_item_id,attempt_number,status,failure_category,error_code,error_message,diagnostics_json,finish_reason,response_length,request_duration_ms,token_usage_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(benchmark_item_id,attempt_number) DO UPDATE SET status=excluded.status,failure_category=excluded.failure_category,error_code=excluded.error_code,error_message=excluded.error_message,diagnostics_json=excluded.diagnostics_json,finish_reason=excluded.finish_reason,response_length=excluded.response_length,request_duration_ms=excluded.request_duration_ms,token_usage_json=excluded.token_usage_json,created_at=excluded.created_at").run(id, input.benchmarkItemId, input.attemptNumber, input.status, input.failureCategory ?? null, input.errorCode ?? null, input.errorMessage ?? null, json(input.diagnostics ?? []), input.finishReason ?? null, input.responseLength ?? 0, input.requestDurationMs ?? 0, json(input.tokenUsage ?? {}), now());
    return this.getQualityBenchmarkItemAttempt(input.benchmarkItemId, input.attemptNumber) as QualityBenchmarkItemAttemptView;
  }

  getQualityBenchmarkItemAttempt(benchmarkItemId: string, attemptNumber: number): QualityBenchmarkItemAttemptView | null {
    const row = this.db.prepare("SELECT * FROM quality_benchmark_item_attempts WHERE benchmark_item_id=? AND attempt_number=?").get(benchmarkItemId, attemptNumber) as Row | undefined;
    return row ? toQualityBenchmarkItemAttempt(row) : null;
  }

  listQualityBenchmarkItemAttempts(benchmarkItemId: string): QualityBenchmarkItemAttemptView[] {
    return (this.db.prepare("SELECT * FROM quality_benchmark_item_attempts WHERE benchmark_item_id=? ORDER BY attempt_number").all(benchmarkItemId) as Row[]).map(toQualityBenchmarkItemAttempt);
  }

  recoverQualityBenchmarkItems(benchmarkRunId?: string): number {
    const timestamp = now();
    const result = benchmarkRunId
      ? this.db.prepare("UPDATE quality_benchmark_items SET status='RetryableFailure',error_code='PROCESS_RESTARTED',error_message='进程重启后恢复未完成项',updated_at=? WHERE benchmark_run_id=? AND status='Running'").run(timestamp, benchmarkRunId)
      : this.db.prepare("UPDATE quality_benchmark_items SET status='RetryableFailure',error_code='PROCESS_RESTARTED',error_message='进程重启后恢复未完成项',updated_at=? WHERE status='Running'").run(timestamp);
    return result.changes;
  }

  claimQualityBenchmarkItem(id: string, allowFailed = false): QualityBenchmarkItemView | null {
    const timestamp = now();
    const claimableStatuses = allowFailed ? "('Pending','RetryableFailure','Failed')" : "('Pending','RetryableFailure')";
    const result = this.db.prepare(`UPDATE quality_benchmark_items SET status='Running',attempt_count=attempt_count+1,started_at=?,completed_at=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND status IN ${claimableStatuses} AND benchmark_run_id IN (SELECT benchmark_run_id FROM quality_benchmark_runs WHERE control_status='RUNNING')`).run(timestamp, timestamp, id);
    return result.changes === 0 ? null : this.getQualityBenchmarkItem(id);
  }

  updateQualityBenchmarkItem(id: string, input: { status: QualityBenchmarkItemStatus; contentStudioTaskId?: string | null; contentTypeId?: string | null; provider?: string; model?: string; errorCode?: string | null; errorMessage?: string | null; failureCategory?: string | null; diagnostics?: Array<Record<string, unknown>>; requestDurationMs?: number; tokenUsage?: AIUsage; completedAt?: string | null }): QualityBenchmarkItemView {
    const current = this.getQualityBenchmarkItem(id);
    if (!current) throw new Error("Quality benchmark item not found");
    const finished = input.status === "Success" || input.status === "Failed";
    this.db.prepare("UPDATE quality_benchmark_items SET status=?,content_studio_task_id=?,content_type_id=?,provider=?,model=?,error_code=?,error_message=?,failure_category=?,diagnostics_json=?,request_duration_ms=?,token_usage_json=?,completed_at=?,updated_at=? WHERE id=?").run(input.status, input.contentStudioTaskId === undefined ? current.contentStudioTaskId : input.contentStudioTaskId, input.contentTypeId === undefined ? current.contentTypeId : input.contentTypeId, input.provider ?? current.provider, input.model ?? current.model, input.errorCode === undefined ? current.errorCode : input.errorCode, input.errorMessage === undefined ? current.errorMessage : input.errorMessage, input.failureCategory === undefined ? current.failureCategory : input.failureCategory, json(input.diagnostics ?? current.diagnostics), input.requestDurationMs ?? current.requestDurationMs, json(input.tokenUsage ?? current.tokenUsage), input.completedAt === undefined ? (finished ? now() : current.completedAt) : input.completedAt, now(), id);
    return this.getQualityBenchmarkItem(id) as QualityBenchmarkItemView;
  }

  setQualityBenchmarkControl(benchmarkRunId: string, status: "RUNNING" | "PAUSED" | "CANCELLED"): QualityBenchmarkRunView {
    const result = this.db.prepare("UPDATE quality_benchmark_runs SET control_status=? WHERE benchmark_run_id=?").run(status, benchmarkRunId);
    if (result.changes === 0) throw new Error("Quality benchmark run not found");
    return this.getQualityBenchmarkRun(benchmarkRunId) as QualityBenchmarkRunView;
  }

  getQualityBenchmarkRun(benchmarkRunId: string): QualityBenchmarkRunView | null {
    const row = this.db.prepare("SELECT * FROM quality_benchmark_runs WHERE benchmark_run_id=?").get(benchmarkRunId) as Row | undefined;
    return row ? toQualityBenchmarkRun(row) : null;
  }

  listQualityBenchmarkRuns(benchmarkId?: string): QualityBenchmarkRunView[] {
    const rows = (benchmarkId ? this.db.prepare("SELECT * FROM quality_benchmark_runs WHERE benchmark_id=? ORDER BY created_at DESC").all(benchmarkId) : this.db.prepare("SELECT * FROM quality_benchmark_runs ORDER BY created_at DESC").all()) as Row[];
    return rows.map(toQualityBenchmarkRun);
  }

  updateQualityBenchmarkRun(benchmarkRunId: string, input: { status: QualityBenchmarkRunStatus; completedAt?: string | null; totalDurationMs?: number; successCount?: number; failureCount?: number; totalTokenUsage?: AIUsage; estimatedCost?: number | null; similaritySummary?: Record<string, number>; blockReason?: string | null }): QualityBenchmarkRunView {
    const current = this.getQualityBenchmarkRun(benchmarkRunId);
    if (!current) throw new Error("Quality benchmark run not found");
    this.db.prepare("UPDATE quality_benchmark_runs SET status=?,completed_at=?,total_duration_ms=?,success_count=?,failure_count=?,total_token_usage_json=?,estimated_cost=?,similarity_summary_json=?,block_reason=? WHERE benchmark_run_id=?").run(input.status, input.completedAt ?? (input.status === "RUNNING" || input.status === "PENDING" ? current.completedAt : now()), input.totalDurationMs ?? current.totalDurationMs, input.successCount ?? current.successCount, input.failureCount ?? current.failureCount, json(input.totalTokenUsage ?? current.totalTokenUsage), input.estimatedCost === undefined ? current.estimatedCost : input.estimatedCost, json(input.similaritySummary ?? current.similaritySummary), input.blockReason === undefined ? current.blockReason : input.blockReason, benchmarkRunId);
    return this.getQualityBenchmarkRun(benchmarkRunId) as QualityBenchmarkRunView;
  }

  recordQualityBenchmarkContent(input: { id?: string; benchmarkRunId: string; benchmarkId: string; datasetVersion: string; topicIndex: number; topic: string; city: string; keyword: string; platformKey: string; contentType: "article" | "video_script"; contentTypeId: string; provider: string; model: string; contentHash: string; qualityStatus: ContentQualityStatus; riskCount: number; revisionNumber?: number; requestDurationMs?: number; tokenUsage?: AIUsage; intraPlatformSimilarity?: number | null; crossPlatformSimilarity?: number | null }): QualityBenchmarkContentView {
    const revisionNumber = input.revisionNumber ?? 0;
    const id = input.id ?? randomUUID();
    const timestamp = now();
    this.db.transaction(() => {
      this.db.prepare("UPDATE quality_benchmark_contents SET is_current=0 WHERE benchmark_run_id=? AND topic_index=? AND platform_key=?").run(input.benchmarkRunId, input.topicIndex, input.platformKey);
      this.db.prepare("INSERT INTO quality_benchmark_contents (id,benchmark_run_id,benchmark_id,dataset_version,topic_index,topic,city,keyword,platform_key,content_type,content_type_id,provider,model,content_hash,quality_status,risk_count,revision_number,is_current,request_duration_ms,token_usage_json,intra_platform_similarity,cross_platform_similarity,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.benchmarkRunId, input.benchmarkId, input.datasetVersion, input.topicIndex, input.topic, input.city, input.keyword, input.platformKey, input.contentType, input.contentTypeId, input.provider, input.model, input.contentHash, input.qualityStatus, input.riskCount, revisionNumber, 1, input.requestDurationMs ?? 0, json(input.tokenUsage ?? {}), input.intraPlatformSimilarity ?? null, input.crossPlatformSimilarity ?? null, timestamp);
    })();
    return this.getQualityBenchmarkContent(id) as QualityBenchmarkContentView;
  }

  getQualityBenchmarkContent(id: string): QualityBenchmarkContentView | null {
    const row = this.db.prepare("SELECT * FROM quality_benchmark_contents WHERE id=?").get(id) as Row | undefined;
    return row ? toQualityBenchmarkContent(row) : null;
  }

  updateQualityBenchmarkContentCurrent(id: string, input: { qualityStatus: ContentQualityStatus; riskCount: number; contentHash?: string }): QualityBenchmarkContentView {
    const current = this.getQualityBenchmarkContent(id);
    if (!current) throw new Error("Quality benchmark content not found");
    this.db.prepare("UPDATE quality_benchmark_contents SET quality_status=?,risk_count=?,content_hash=? WHERE id=?").run(input.qualityStatus, input.riskCount, input.contentHash ?? current.contentHash, id);
    return this.getQualityBenchmarkContent(id) as QualityBenchmarkContentView;
  }

  listQualityBenchmarkContents(benchmarkRunId: string, currentOnly = false): QualityBenchmarkContentView[] {
    const rows = (currentOnly ? this.db.prepare("SELECT * FROM quality_benchmark_contents WHERE benchmark_run_id=? AND is_current=1 ORDER BY topic_index,platform_key").all(benchmarkRunId) : this.db.prepare("SELECT * FROM quality_benchmark_contents WHERE benchmark_run_id=? ORDER BY topic_index,platform_key,revision_number").all(benchmarkRunId)) as Row[];
    return rows.map(toQualityBenchmarkContent);
  }

  ensureHumanReviewDataset(datasetId: string, benchmarkRunId: string, version = "V0.9.3"): HumanReviewDatasetView {
    const existing = this.getHumanReviewDataset(datasetId);
    if (existing) return existing;
    const run = this.getQualityBenchmarkRun(benchmarkRunId);
    if (!run) throw new Error(`找不到用于人工校准的 benchmark run：${benchmarkRunId}`);
    const contents = this.listQualityBenchmarkContents(benchmarkRunId, true);
    if (contents.length < 20) throw new Error(`固定人工审核队列需要至少 20 条当前内容，实际只有 ${contents.length} 条`);
    const benchmarkItems = new Map(this.listQualityBenchmarkItems(benchmarkRunId).map((item) => [`${item.topicIndex}:${item.platformKey}`, item]));
    const candidates = contents.flatMap((content) => {
      const variant = this.getArticleVariant(content.contentTypeId);
      const article = variant ? this.getArticle(variant.articleId) : this.getArticle(content.contentTypeId);
      const contentType: ContentQualityContentType = variant ? "article_variant" : "article";
      const contentId = variant?.id ?? article?.id ?? content.contentTypeId;
      const snapshot = variant
        ? humanReviewSnapshot(contentType, variant.id, variant.platformKey, variant.title, variant.body, variant.summary, variant.contentHash)
        : article
          ? humanReviewSnapshot(contentType, article.id, null, article.title, article.body, article.summary, article.contentHash)
          : null;
      if (!snapshot || !article) return [];
      const state = this.getContentQualityState(contentType, contentId);
      const latest = this.listContentQualityReviews(contentType, contentId)[0];
      const status = state?.status ?? content.qualityStatus;
      const item = benchmarkItems.get(`${content.topicIndex}:${content.platformKey}`);
      return [{
        content,
        benchmarkItem: item,
        snapshot,
        status,
        issues: latest?.issues ?? [],
        riskCount: latest?.issues.length ?? content.riskCount,
        business: item?.business ?? "未标注业务类型"
      }];
    });
    const desired: Array<[ContentQualityStatus, number]> = [["Approved", 3], ["Needs_Review", 7], ["Rejected", 10]];
    const selected: typeof candidates = [];
    const selectedIds = new Set<string>();
    const coveredPlatforms = new Set<string>();
    const coveredBusinesses = new Set<string>();
    const coveredRisks = new Set<string>();
    const adjustmentReasons: string[] = [];
    const pick = (pool: typeof candidates, count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const available = pool.filter((candidate) => !selectedIds.has(candidate.content.id));
        if (available.length === 0) break;
        available.sort((left, right) => {
          const score = (candidate: (typeof available)[number]): number => {
            const platform = candidate.content.platformKey && !coveredPlatforms.has(candidate.content.platformKey) ? 10000 : 0;
            const business = !coveredBusinesses.has(candidate.business) ? 1000 : 0;
            const risk = candidate.issues.reduce((total, issue) => total + (coveredRisks.has(issue.code) ? 0 : 100), 0);
            return platform + business + risk;
          };
          return score(right) - score(left) || left.content.topicIndex - right.content.topicIndex || left.content.platformKey.localeCompare(right.content.platformKey);
        });
        const choice = available[0];
        if (!choice) return;
        selected.push(choice);
        selectedIds.add(choice.content.id);
        if (choice.content.platformKey) coveredPlatforms.add(choice.content.platformKey);
        coveredBusinesses.add(choice.business);
        for (const issue of choice.issues) coveredRisks.add(issue.code);
      }
    };
    for (const [status, count] of desired) {
      const pool = candidates.filter((candidate) => candidate.status === status);
      const before = selected.length;
      pick(pool, count);
      if (selected.length - before < count) adjustmentReasons.push(`${status} 目标 ${count} 条但可用 ${selected.length - before} 条`);
    }
    if (selected.length < 20) {
      const remaining = candidates.filter((candidate) => !selectedIds.has(candidate.content.id));
      pick(remaining, 20 - selected.length);
      adjustmentReasons.push(`按可用候选补足至 ${selected.length} 条`);
    }
    const missingPlatforms = CONTENT_REVIEW_PLATFORM_KEYS.filter((platform) => !coveredPlatforms.has(platform));
    if (missingPlatforms.length > 0) adjustmentReasons.push(`候选选择后仍缺少平台：${missingPlatforms.join(",")}`);
    if (selected.length !== 20) throw new Error(`无法建立固定 20 条人工审核队列，实际选中 ${selected.length} 条`);
    const selectionReason = `V0.9.3 fixed selection: Approved=3, Needs_Review=7, Rejected=10; maximize six-platform, business and risk coverage; deterministic topic_index/platform_key order; no random resampling.${adjustmentReasons.length > 0 ? ` Adjustments: ${adjustmentReasons.join("；")}` : ""}`;
    const datasetRowId = randomUUID();
    const timestamp = now();
    const insertDataset = this.db.prepare("INSERT INTO human_review_datasets (id,dataset_id,benchmark_run_id,version,status,target_count,completed_count,selection_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
    const insertItem = this.db.prepare("INSERT INTO human_review_dataset_items (id,dataset_id,sequence,content_type,content_id,benchmark_content_id,topic_index,topic,city,keyword,business,platform_key,title_snapshot,original_content_json,original_status,original_risk_count,original_content_hash,selection_reason,review_status,final_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    this.db.transaction(() => {
      insertDataset.run(datasetRowId, datasetId, benchmarkRunId, version, "WAITING_FOR_HUMAN_REVIEW", 20, 0, selectionReason, timestamp, timestamp);
      selected.sort((left, right) => left.content.topicIndex - right.content.topicIndex || left.content.platformKey.localeCompare(right.content.platformKey));
      selected.forEach((candidate, index) => {
        const item = candidate.benchmarkItem;
        insertItem.run(randomUUID(), datasetRowId, index + 1, candidate.snapshot.contentType, candidate.snapshot.contentId, candidate.content.id, candidate.content.topicIndex, candidate.content.topic, candidate.content.city, candidate.content.keyword, candidate.business, candidate.content.platformKey, candidate.snapshot.title, json(candidate.snapshot), candidate.status, candidate.riskCount, candidate.snapshot.contentHash, selectionReason, "Pending", null, timestamp, timestamp);
        if (!item) adjustmentReasons.push(`topic_index=${candidate.content.topicIndex},platform=${candidate.content.platformKey} 缺少 benchmark item 业务元数据`);
      });
    })();
    return this.getHumanReviewDataset(datasetId) as HumanReviewDatasetView;
  }

  getHumanReviewDataset(datasetId: string): HumanReviewDatasetView | null {
    const row = this.db.prepare("SELECT * FROM human_review_datasets WHERE dataset_id=?").get(datasetId) as Row | undefined;
    if (!row) return null;
    const items = (this.db.prepare("SELECT * FROM human_review_dataset_items WHERE dataset_id=? ORDER BY sequence").all(textValue(row.id)) as Row[]).map((item) => this.toHumanReviewDatasetItem(item));
    const composition: Record<HumanReviewFinalStatus | "Draft", number> = { Draft: 0, AI_Checked: 0, Needs_Review: 0, Approved: 0, Rejected: 0 };
    for (const item of items) composition[item.originalStatus] += 1;
    return {
      id: textValue(row.id), datasetId: textValue(row.dataset_id), benchmarkRunId: textValue(row.benchmark_run_id), version: textValue(row.version),
      status: textValue(row.status) === "HUMAN_REVIEW_COMPLETED" ? "HUMAN_REVIEW_COMPLETED" : "WAITING_FOR_HUMAN_REVIEW",
      targetCount: intValue(row.target_count), completedCount: intValue(row.completed_count), selectionReason: textValue(row.selection_reason), composition,
      platforms: [...new Set(items.map((item) => item.platformKey).filter((platform): platform is string => Boolean(platform)))].sort(), items,
      createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at)
    };
  }

  getHumanReviewDatasetItem(datasetItemId: string): HumanReviewDatasetItemView | null {
    const row = this.db.prepare("SELECT * FROM human_review_dataset_items WHERE id=?").get(datasetItemId) as Row | undefined;
    return row ? this.toHumanReviewDatasetItem(row) : null;
  }

  submitHumanReview(input: HumanReviewSubmitInput): HumanReviewItemReviewView {
    const item = this.getHumanReviewDatasetItem(input.datasetItemId);
    if (!item) throw new Error("固定人工审核条目不存在");
    if (item.reviewStatus === "Completed") throw new Error("该人工审核条目已经提交，不能重复提交");
    if (item.originalContentHash !== input.originalContentHash) throw new Error("原始内容 Hash 不匹配，已拒绝提交以保护机器基线");
    if (input.originalContent.contentHash !== item.originalContentHash) throw new Error("原始内容快照与固定数据集不一致");
    if (input.finalContentHash !== input.finalContent.contentHash) throw new Error("最终内容 Hash 与最终内容快照不一致");
    const detectedIssues = new Map(item.issues.map((issue) => [`${issue.ruleId}:${issue.issueIndex}`, issue]));
    for (const issue of item.issues) if (!input.issueDecisions.some((decision) => decision.ruleId === issue.ruleId && decision.issueIndex === issue.issueIndex && decision.machineDecision === "Detected")) throw new Error(`机器风险尚未完成判断：${issue.ruleId}`);
    for (const decision of input.issueDecisions) {
      if (decision.machineDecision === "Detected" && !detectedIssues.has(`${decision.ruleId}:${decision.issueIndex}`)) throw new Error(`人工判断引用了不存在的机器风险：${decision.ruleId}`);
    }
    const reviewId = randomUUID();
    const timestamp = now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO human_review_item_reviews (id,dataset_item_id,reviewer_type,reviewed_at,original_status,final_status,review_duration_ms,edit_count,original_content_hash,final_content_hash,original_content_json,final_content_json,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(reviewId, item.id, "human", timestamp, item.originalStatus, input.finalStatus, Math.max(0, Math.floor(input.reviewDurationMs)), Math.max(0, Math.floor(input.editCount)), input.originalContentHash, input.finalContentHash, json(input.originalContent), json(input.finalContent), input.reason ?? null, timestamp);
      const insertDecision = this.db.prepare("INSERT INTO human_review_issue_decisions (id,review_id,rule_id,issue_index,machine_decision,human_decision,reason,issue_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
      for (const decision of input.issueDecisions) insertDecision.run(randomUUID(), reviewId, decision.ruleId, decision.issueIndex, decision.machineDecision, decision.humanDecision, decision.reason ?? null, json(decision.issue ?? detectedIssues.get(`${decision.ruleId}:${decision.issueIndex}`)?.issue ?? {}), timestamp);
      this.db.prepare("UPDATE human_review_dataset_items SET review_status='Completed',final_status=?,updated_at=? WHERE id=?").run(input.finalStatus, timestamp, item.id);
      const dataset = this.db.prepare("SELECT dataset_id,target_count FROM human_review_datasets WHERE id=?").get(item.datasetId) as Row | undefined;
      if (!dataset) throw new Error("人工审核数据集不存在");
      const completedCount = intValue((this.db.prepare("SELECT COUNT(*) AS count FROM human_review_dataset_items WHERE dataset_id=? AND review_status='Completed'").get(item.datasetId) as Row).count);
      this.db.prepare("UPDATE human_review_datasets SET completed_count=?,status=?,updated_at=? WHERE id=?").run(completedCount, completedCount === intValue(dataset.target_count) ? "HUMAN_REVIEW_COMPLETED" : "WAITING_FOR_HUMAN_REVIEW", timestamp, item.datasetId);
    })();
    return this.getHumanReviewItemReview(reviewId) as HumanReviewItemReviewView;
  }

  private getHumanReviewItemReview(reviewId: string): HumanReviewItemReviewView | null {
    const row = this.db.prepare("SELECT * FROM human_review_item_reviews WHERE id=?").get(reviewId) as Row | undefined;
    if (!row) return null;
    const decisions = (this.db.prepare("SELECT * FROM human_review_issue_decisions WHERE review_id=? ORDER BY issue_index,rule_id").all(reviewId) as Row[]).map(toHumanReviewIssueDecision);
    return toHumanReviewItemReview(row, decisions);
  }

  private toHumanReviewDatasetItem(row: Row): HumanReviewDatasetItemView {
    const originalContent = parseJson<HumanReviewContentSnapshot>(row.original_content_json, humanReviewSnapshot("article_variant", textValue(row.content_id), typeof row.platform_key === "string" ? row.platform_key : null, textValue(row.title_snapshot), "", "", textValue(row.original_content_hash)));
    const latestReviewRow = this.db.prepare("SELECT * FROM human_review_item_reviews WHERE dataset_item_id=? ORDER BY reviewed_at DESC LIMIT 1").get(textValue(row.id)) as Row | undefined;
    const latestReview = latestReviewRow ? this.getHumanReviewItemReview(textValue(latestReviewRow.id)) : null;
    const reviewContent = latestReview?.finalContent ?? originalContent;
    const contentType = textValue(row.content_type) === "article" ? "article" : "article_variant";
    const issues = this.listContentQualityReviews(contentType, textValue(row.content_id))[0]?.issues ?? [];
    const decisions = new Map((latestReview?.issueDecisions ?? []).map((decision) => [`${decision.ruleId}:${decision.issueIndex}`, decision]));
    return {
      id: textValue(row.id), datasetId: textValue(row.dataset_id), sequence: intValue(row.sequence), contentType, contentId: textValue(row.content_id), benchmarkContentId: textValue(row.benchmark_content_id),
      topicIndex: intValue(row.topic_index), topic: textValue(row.topic), city: textValue(row.city), keyword: textValue(row.keyword), business: textValue(row.business), platformKey: typeof row.platform_key === "string" ? row.platform_key : null,
      title: textValue(row.title_snapshot), originalStatus: textValue(row.original_status) as ContentQualityStatus, originalRiskCount: intValue(row.original_risk_count), originalContentHash: textValue(row.original_content_hash), selectionReason: textValue(row.selection_reason),
      reviewStatus: textValue(row.review_status) === "Completed" ? "Completed" : "Pending", finalStatus: ["AI_Checked", "Needs_Review", "Approved", "Rejected"].includes(textValue(row.final_status)) ? textValue(row.final_status) as HumanReviewFinalStatus : null,
      originalContent, content: reviewContent, issues: issues.map((issue, issueIndex) => { const decision = decisions.get(`${issue.code}:${issueIndex}`); return { ruleId: issue.code, issueIndex, machineDecision: "Detected", issue, humanDecision: decision?.humanDecision ?? null, reason: decision?.reason ?? null }; }), latestReview,
      createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at)
    };
  }

  getQualityBenchmarkMetrics(benchmarkRunId: string): QualityBenchmarkMetrics {
    const contents = this.listQualityBenchmarkContents(benchmarkRunId);
    const current = contents.filter((item) => item.isCurrent);
    const currentStatusCount: Record<ContentQualityStatus, number> = { Draft: 0, AI_Checked: 0, Needs_Review: 0, Approved: 0, Rejected: 0 };
    for (const item of current) currentStatusCount[item.qualityStatus] += 1;
    const contentIds = [...new Set(contents.map((item) => item.contentTypeId))];
    const reviewEventCount = contentIds.reduce((total, contentId) => total + intValue((this.db.prepare("SELECT COUNT(*) AS count FROM content_quality_reviews WHERE content_id=?").get(contentId) as Row).count), 0);
    return {
      generatedVariantCount: contents.filter((item) => item.revisionNumber === 0).length,
      currentUniqueContentCount: current.length,
      currentStatusCount,
      reviewEventCount,
      revisionCount: contents.filter((item) => item.revisionNumber > 0).length,
      approvedUniqueContentCount: currentStatusCount.Approved,
      rejectedUniqueContentCount: currentStatusCount.Rejected
    };
  }

  getContentQualityReview(id: string): ContentQualityReviewView | null {
    const row = this.db.prepare("SELECT * FROM content_quality_reviews WHERE id=?").get(id) as Row | undefined;
    return row ? toContentQualityReview(row) : null;
  }

  listContentQualityReviews(contentType: ContentQualityContentType, contentId: string): ContentQualityReviewView[] {
    return (this.db.prepare("SELECT * FROM content_quality_reviews WHERE content_type=? AND content_id=? ORDER BY created_at DESC").all(contentType, contentId) as Row[]).map(toContentQualityReview);
  }

  listContentQualityAudits(contentType: ContentQualityContentType, contentId: string): ContentQualityAuditView[] {
    return (this.db.prepare("SELECT * FROM content_quality_audits WHERE content_type=? AND content_id=? ORDER BY timestamp DESC").all(contentType, contentId) as Row[]).map(toContentQualityAudit);
  }

  private recordContentQualityAudit(input: { contentType: ContentQualityContentType; contentId: string; operatorType: "system" | "human"; previousStatus: ContentQualityStatus; newStatus: ContentQualityStatus; reason: string; contentHash: string; benchmarkRunId?: string }): void {
    this.db.prepare("INSERT INTO content_quality_audits (id,content_type,content_id,operator_type,previous_status,new_status,reason,timestamp,content_hash,benchmark_run_id) VALUES (?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), input.contentType, input.contentId, input.operatorType, input.previousStatus, input.newStatus, input.reason, now(), input.contentHash, input.benchmarkRunId ?? null);
  }

  decideContentQuality(contentType: ContentQualityContentType, contentId: string, status: "Approved" | "Rejected", provider = "human-review", model = "manual", reason = "人工审核状态变更"): ContentQualityReviewView {
    const state = this.getContentQualityState(contentType, contentId);
    if (!state) throw new Error("Quality Gate has not checked this content");
    if (status === "Approved" && state.status === "Rejected") throw new Error("Rejected content must pass a new quality check before approval");
    if (status === "Approved" && state.status !== "AI_Checked" && state.status !== "Needs_Review") throw new Error("Content must be AI_Checked or Needs_Review before approval");
    const latest = this.listContentQualityReviews(contentType, contentId)[0];
    const result: { status: Exclude<ContentQualityStatus, "Draft">; score: number; checks: ContentQualityCheckResult[]; issues: ContentQualityIssue[] } = { status, score: latest?.score ?? 0, checks: latest?.checks ?? [], issues: latest?.issues ?? [] };
    return this.saveContentQualityReview({ contentType, contentId, brandId: state.brandId, platformKey: state.platformKey, contentHash: state.contentHash, trigger: "manual_review", provider, model, result, snapshot: latest?.snapshot ?? {}, operatorType: "human", previousStatus: state.status, reason });
  }

  listContentQualityItems(brandId?: string): ContentQualityItemView[] {
    const articles = (brandId ? this.db.prepare("SELECT * FROM articles WHERE brand_id=? ORDER BY updated_at DESC") : this.db.prepare("SELECT * FROM articles ORDER BY updated_at DESC")).all(...(brandId ? [brandId] : [])) as Row[];
    const variants = (brandId ? this.db.prepare("SELECT v.*,a.brand_id,a.city,a.keyword FROM article_variants v JOIN articles a ON a.id=v.article_id WHERE a.brand_id=? ORDER BY v.created_at DESC") : this.db.prepare("SELECT v.*,a.brand_id,a.city,a.keyword FROM article_variants v JOIN articles a ON a.id=v.article_id ORDER BY v.created_at DESC")).all(...(brandId ? [brandId] : [])) as Row[];
    const items: ContentQualityItemView[] = [];
    for (const row of articles) items.push(this.toQualityItem("article", row, textValue(row.id), null));
    for (const row of variants) items.push(this.toQualityItem("article_variant", row, textValue(row.article_id), textValue(row.platform_key)));
    return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private toQualityItem(contentType: ContentQualityContentType, row: Row, articleId: string, platformKey: string | null): ContentQualityItemView {
    const contentId = textValue(row.id);
    const state = this.getContentQualityState(contentType, contentId);
    const latest = this.listContentQualityReviews(contentType, contentId)[0];
    return { contentType, contentId, brandId: textValue(row.brand_id), articleId, platformKey, title: textValue(row.title), body: textValue(row.body), summary: textValue(row.summary), city: textValue(row.city), keyword: textValue(row.keyword), status: state?.status ?? "Draft", score: latest?.score ?? null, issueCount: latest?.issues.length ?? 0, contentHash: textValue(row.content_hash), updatedAt: state?.updatedAt ?? textValue(row.updated_at || row.created_at) };
  }

  isContentApproved(contentType: ContentQualityContentType, contentId: string, contentHash: string): boolean {
    const state = this.getContentQualityState(contentType, contentId);
    return state?.status === "Approved" && state.contentHash === contentHash;
  }

  validatePlanContentQuality(planId: string): string[] {
    const plan = this.listPlans().find((item) => item.id === planId);
    if (!plan) throw new Error("Publish plan not found");
    const accounts = this.listAccounts().filter((account) => plan.accountIds.includes(account.id) && account.enabled);
    const articles = this.listArticles({ brandId: plan.brandId, status: "available" });
    const blockers: string[] = [];
    const platformIndexes = new Map<string, number>();
    const accountIndexes = new Map<string, number>();
    for (const account of accounts) {
      for (let dayIndex = 0; dayIndex < Math.max(1, plan.articlesPerDay); dayIndex += 1) {
        const accountIndex = accountIndexes.get(account.id) ?? 0;
        accountIndexes.set(account.id, accountIndex + 1);
        const platformIndex = platformIndexes.get(account.platformKey) ?? 0;
        platformIndexes.set(account.platformKey, platformIndex + 1);
        const index = plan.strategy === "account_variant" ? accounts.indexOf(account) * Math.max(1, plan.articlesPerDay) + dayIndex : plan.strategy === "per_platform" ? platformIndex : dayIndex;
        const article = articles[index % Math.max(1, articles.length)];
        if (!article) continue;
        const variant = plan.strategy === "platform_variant" ? this.getArticleVariantForPlatform(article.id, account.platformKey) : null;
        const approved = variant ? this.isContentApproved("article_variant", variant.id, variant.contentHash) : this.isContentApproved("article", article.id, article.contentHash);
        if (!approved) blockers.push(`${account.platformKey}:${article.id}${variant ? `:${variant.id}` : ""}`);
      }
    }
    return [...new Set(blockers)];
  }

  private getArticleByContentHash(contentHash: string): Article | null {
    const row = this.db.prepare("SELECT * FROM articles WHERE content_hash=?").get(contentHash) as Row | undefined;
    return row ? toArticle(row) : null;
  }

  getAiTask(id: string): { id: string; batchId: string | null; status: string; total: number; completed: number; success: number; failed: number; errorMessage: string | null; usage: AIUsage; durationMs: number; nextIndex: number; cancelRequested: boolean; payload: Record<string, unknown> } | null {
    const row = this.db.prepare("SELECT * FROM ai_tasks WHERE id=?").get(id) as Row | undefined;
    if (!row) return null;
    return { id: textValue(row.id), batchId: typeof row.batch_id === "string" ? row.batch_id : null, status: textValue(row.status), total: intValue(row.total_count), completed: intValue(row.completed_count), success: intValue(row.success_count), failed: intValue(row.failed_count), errorMessage: typeof row.error_message === "string" ? row.error_message : null, usage: parseJson<AIUsage>(row.usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }), durationMs: intValue(row.duration_ms), nextIndex: intValue(row.next_index), cancelRequested: boolValue(row.cancel_requested), payload: parseJson<Record<string, unknown>>(row.input_json, {}) };
  }

  listResumableAiTasks(): NonNullable<ReturnType<AppRepository["getAiTask"]>>[] {
    return (this.db.prepare("SELECT id FROM ai_tasks WHERE status='running' AND cancel_requested=0 ORDER BY created_at").all() as Row[]).map((row) => this.getAiTask(textValue(row.id))).filter((task): task is NonNullable<ReturnType<AppRepository["getAiTask"]>> => task !== null);
  }

  cancelAiTask(id: string): void { const task = this.getAiTask(id); this.db.prepare("UPDATE ai_tasks SET cancel_requested=1,updated_at=? WHERE id=? AND status='running'").run(now(), id); if (task?.batchId) this.cancelAiBatchItems(task.batchId); }

  getSettings(): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const row of this.db.prepare("SELECT key,value_json FROM app_settings").all() as Row[]) settings[textValue(row.key)] = parseJson<unknown>(row.value_json, null);
    return settings;
  }

  setSetting(key: string, value: unknown): void { this.db.prepare("INSERT INTO app_settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at").run(key, json(value), now()); }

  getContentReviewMode(): ContentReviewMode { return normalizeContentReviewMode(this.getSettings().contentReviewMode); }

  /**
   * Apply the single publish gate used by both Job creation and Browser
   * assisted preparation. Operational content follows the configured review
   * mode; benchmark/mock/test content never enters the formal publish path.
   */
  assertArticlePublishAllowed(articleId: string): void {
    const article = this.getArticle(articleId);
    if (!article) throw Object.assign(new Error("文章不存在"), { code: "CONTENT_REJECTED" });
    const source = article.source ?? "production";
    if (!["production", "content_studio", "excel_import"].includes(source)) {
      throw Object.assign(new Error("benchmark、mock、test 内容只能通过专用自测入口处理，禁止进入正式发布"), { code: "CONTENT_REJECTED" });
    }
    if (this.getContentReviewMode() === "Strict" && !this.isContentApproved("article", article.id, article.contentHash)) {
      throw Object.assign(new Error("严格审核模式要求内容达到 Approved，禁止创建发布任务"), { code: "CONTENT_REJECTED" });
    }
  }

  listAiProviderProfiles(): AIProviderProfile[] {
    return (this.db.prepare("SELECT * FROM ai_provider_profiles ORDER BY is_default DESC, name").all() as Row[]).map(toAiProviderProfile);
  }

  getAiProviderProfile(id: string): AIProviderProfile | null {
    const row = this.db.prepare("SELECT * FROM ai_provider_profiles WHERE id=?").get(id) as Row | undefined;
    return row ? toAiProviderProfile(row) : null;
  }

  upsertAiProviderProfile(input: AIProviderProfileInput): AIProviderProfile {
    const id = input.id ?? randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO ai_provider_profiles (id,name,provider,base_url,model,credential_ref,temperature,max_output_tokens,timeout_ms,retry_count,concurrency,enabled,is_default,is_fallback,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,credential_ref=excluded.credential_ref,temperature=excluded.temperature,max_output_tokens=excluded.max_output_tokens,timeout_ms=excluded.timeout_ms,retry_count=excluded.retry_count,concurrency=excluded.concurrency,enabled=excluded.enabled,is_default=excluded.is_default,is_fallback=excluded.is_fallback,updated_at=excluded.updated_at`).run(id, input.name.trim(), input.provider, input.baseUrl, input.model, input.credentialRef, input.temperature, input.maxOutputTokens, input.timeoutMs, input.retryCount, input.concurrency, input.enabled ? 1 : 0, input.isDefault ? 1 : 0, input.isFallback ? 1 : 0, timestamp, timestamp);
    return this.getAiProviderProfile(id) as AIProviderProfile;
  }

  deleteAiProviderProfile(id: string): void { this.db.prepare("DELETE FROM ai_provider_profiles WHERE id=?").run(id); }

  listKeywordTemplates(brandId: string): KeywordTemplate[] {
    return (this.db.prepare("SELECT * FROM keyword_templates WHERE brand_id = ? ORDER BY rowid").all(brandId) as Row[]).map(toTemplate);
  }

  createKeywordTemplate(input: Pick<KeywordTemplate, "brandId" | "template" | "category">): KeywordTemplate {
    const item: KeywordTemplate = { id: randomUUID(), brandId: input.brandId, template: input.template.trim(), category: input.category.trim() || "通用", enabled: true };
    this.db.prepare("INSERT INTO keyword_templates (id,brand_id,template,category,enabled) VALUES (?,?,?,?,1)").run(item.id, item.brandId, item.template, item.category);
    return item;
  }

  updateKeywordTemplate(id: string, input: Partial<Pick<KeywordTemplate, "template" | "category" | "enabled">>): KeywordTemplate {
    const row = this.db.prepare("SELECT * FROM keyword_templates WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("关键词模板不存在");
    const current = toTemplate(row);
    const next = { ...current, ...input };
    this.db.prepare("UPDATE keyword_templates SET template=?, category=?, enabled=? WHERE id=?").run(next.template, next.category, next.enabled ? 1 : 0, id);
    return next;
  }

  deleteKeywordTemplate(id: string): void { this.db.prepare("DELETE FROM keyword_templates WHERE id = ?").run(id); }

  listKeywordItems(brandId: string): KeywordItem[] {
    return (this.db.prepare("SELECT * FROM keyword_items WHERE brand_id = ? ORDER BY created_at DESC").all(brandId) as Row[]).map(toKeywordItem);
  }

  expandAndSaveKeywords(input: { brandId: string; cities: string[]; templateIds?: string[] }): { items: KeywordItem[]; duplicates: number } {
    const templates = this.listKeywordTemplates(input.brandId).filter((template) => !input.templateIds || input.templateIds.includes(template.id));
    const expanded = expandKeywords({ brandId: input.brandId, cities: input.cities, templates });
    const insert = this.db.prepare("INSERT OR IGNORE INTO keyword_items (id,brand_id,city,keyword,source_template_id,status,created_at) VALUES (?,?,?,?,?,?,?)");
    const timestamp = now();
    const items: KeywordItem[] = [];
    const transaction = this.db.transaction(() => {
      for (const item of expanded) {
        const id = randomUUID();
        const result = insert.run(id, item.brandId, item.city, item.keyword, item.sourceTemplateId, "new", timestamp);
        if (result.changes > 0) items.push({ ...item, id, status: "new", createdAt: timestamp });
      }
    });
    transaction();
    return { items, duplicates: expanded.length - items.length };
  }

  listCityRegions(brandId: string): CityRegion[] {
    return (this.db.prepare("SELECT province,city,district FROM city_regions WHERE brand_id=? ORDER BY province,city,district").all(brandId) as Row[]).map((row) => ({ province: textValue(row.province), city: textValue(row.city), ...(textValue(row.district) ? { district: textValue(row.district) } : {}) }));
  }

  importCityRegions(brandId: string, rows: CityRegion[]): { imported: number; duplicates: number; errors: string[] } {
    const insert = this.db.prepare("INSERT OR IGNORE INTO city_regions (id,brand_id,province,city,district,created_at) VALUES (?,?,?,?,?,?)");
    let imported = 0;
    let duplicates = 0;
    const errors: string[] = [];
    const transaction = this.db.transaction(() => {
      for (const [index, item] of rows.entries()) {
        const province = item.province.trim();
        const city = item.city.trim();
        const district = item.district?.trim() ?? "";
        if (!city) { errors.push(`第 ${index + 1} 行缺少城市`); continue; }
        const result = insert.run(randomUUID(), brandId, province, city, district, now());
        if (result.changes > 0) imported += 1; else duplicates += 1;
      }
    });
    transaction();
    return { imported, duplicates, errors };
  }

  importKeywords(brandId: string, source: string): { imported: number; duplicates: number; errors: string[] } {
    const rows = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const template = this.listKeywordTemplates(brandId)[0] ?? this.createKeywordTemplate({ brandId, template: "{城市}{业务}", category: "导入" });
    const insert = this.db.prepare("INSERT OR IGNORE INTO keyword_items (id,brand_id,city,keyword,source_template_id,status,created_at) VALUES (?,?,?,?,?,?,?)");
    let imported = 0;
    let duplicates = 0;
    const errors: string[] = [];
    const transaction = this.db.transaction(() => {
      for (const [index, line] of rows.entries()) {
        const columns = line.split(",").map((item) => item.trim()).filter(Boolean);
        const keyword = columns[columns.length - 1] ?? "";
        if (!keyword) { errors.push(`第 ${index + 1} 行为空`); continue; }
        const city = columns.length > 1 ? columns[0] ?? "" : "导入";
        const result = insert.run(randomUUID(), brandId, city, keyword, template.id, "new", now());
        if (result.changes > 0) imported += 1; else duplicates += 1;
      }
    });
    transaction();
    return { imported, duplicates, errors };
  }

  listArticles(filters: { brandId?: string; search?: string; status?: string; city?: string; source?: ContentSource } = {}): Article[] {
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    if (filters.brandId) { clauses.push("brand_id = ?"); values.push(filters.brandId); }
    if (filters.status) { clauses.push("status = ?"); values.push(filters.status); }
    if (filters.city) { clauses.push("city = ?"); values.push(filters.city); }
    if (filters.search) { clauses.push("(title LIKE ? OR keyword LIKE ? OR body LIKE ?)"); values.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`); }
    const sourceClause = articleSourceWhere(filters.source ?? "production");
    clauses.push(sourceClause.sql);
    values.push(...sourceClause.values);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return (this.db.prepare(`${articleSelectSql} ${where} ORDER BY a.created_at DESC`).all(...values) as Row[]).map(toArticle);
  }

  listArticlesPage(filters: { brandId?: string; search?: string; status?: string; city?: string; source?: ContentSource; page?: number; pageSize?: number } = {}): ArticlePage {
    const pageSize = Math.min(200, Math.max(1, Math.floor(filters.pageSize ?? 50)));
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    if (filters.brandId) { clauses.push("brand_id=?"); values.push(filters.brandId); }
    if (filters.status) { clauses.push("status=?"); values.push(filters.status); }
    if (filters.city) { clauses.push("city=?"); values.push(filters.city); }
    if (filters.search) { clauses.push("(title LIKE ? OR keyword LIKE ? OR body LIKE ?)"); values.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`); }
    const sourceClause = articleSourceWhere(filters.source ?? "production");
    clauses.push(sourceClause.sql);
    values.push(...sourceClause.values);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = intValue((this.db.prepare(`SELECT COUNT(*) AS count FROM articles a ${where}`).get(...values) as Row).count);
    const items = (this.db.prepare(`${articleSelectSql} ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[]).map(toArticle);
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  getArticle(id: string): Article | null {
    const row = this.db.prepare(`${articleSelectSql} WHERE a.id = ?`).get(id) as Row | undefined;
    return row ? toArticle(row) : null;
  }

  createArticle(input: ArticleInput): Article | null {
    const id = randomUUID();
    const timestamp = now();
    const contentFingerprint = input.contentFingerprint ?? input.contentHash;
    try {
      this.db.prepare(`INSERT INTO articles (id,brand_id,topic,keyword,city,title,body,summary,tags_json,seo_keywords_json,article_type,ai_provider,ai_model,generated_at,status,reuse_policy,content_hash,quality_status,quality_warnings_json,created_at,updated_at,source,company,business,target_platforms_json,promotion_strength,source_note,import_batch_id,imported_at,source_filename,content_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, input.brandId, input.topic, input.keyword, input.city, input.title, input.body, input.summary, json(input.tags), json(input.seoKeywords), input.articleType, input.aiProvider, input.aiModel, input.generatedAt, "available", input.reusePolicy, input.contentHash, input.qualityStatus ?? "unchecked", json(input.qualityWarnings ?? []), timestamp, timestamp,
        input.source ?? "production", input.company ?? "", input.business ?? "", json(input.targetPlatforms ?? []), input.promotionStrength ?? null, input.sourceNote ?? "", input.importBatchId ?? null, input.importedAt ?? null, input.sourceFilename ?? null, contentFingerprint
      );
      const article = this.getArticle(id);
      if (article) this.ensureQualityState("article", article.id, article.brandId, null, article.contentHash, "Draft");
      return article;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) return null;
      throw error;
    }
  }

  updateArticle(id: string, input: Partial<Pick<Article, "title" | "body" | "summary" | "tags" | "seoKeywords" | "status" | "reusePolicy">>): Article {
    const current = this.getArticle(id);
    if (!current) throw new Error("文章不存在");
    const previousState = this.getContentQualityState("article", id);
    const next = { ...current, ...input, contentHash: studioContentHash(input.title ?? current.title, input.body ?? current.body), updatedAt: now() };
    this.db.prepare("UPDATE articles SET title=?, body=?, summary=?, tags_json=?, seo_keywords_json=?, status=?, reuse_policy=?, content_hash=?, content_fingerprint=?, updated_at=? WHERE id=?").run(next.title, next.body, next.summary, json(next.tags), json(next.seoKeywords), next.status, next.reusePolicy, next.contentHash, next.contentFingerprint ?? next.contentHash, next.updatedAt, id);
    this.ensureQualityState("article", id, current.brandId, null, next.contentHash, "Draft");
    this.recordContentQualityAudit({ contentType: "article", contentId: id, operatorType: "human", previousStatus: previousState?.status ?? "Draft", newStatus: "Draft", reason: "人工编辑后需要重新检查", contentHash: next.contentHash });
    return this.getArticle(id) as Article;
  }

  markArticleNeedsRewrite(id: string): Article {
    const current = this.getArticle(id);
    if (!current) throw new Error("文章不存在");
    const warnings = [...new Set([...(current.qualityWarnings ?? []), "NEEDS_REWRITE"])]
      .filter((value) => value.trim());
    this.db.prepare("UPDATE articles SET quality_warnings_json=?,updated_at=? WHERE id=?").run(json(warnings), now(), id);
    return this.getArticle(id) as Article;
  }

  archiveArticle(id: string): Article {
    const current = this.markArticleNeedsRewrite(id);
    this.db.prepare("UPDATE articles SET status='archived',updated_at=? WHERE id=?").run(now(), id);
    return this.getArticle(current.id) as Article;
  }

  deleteArticle(id: string): void { this.db.prepare("DELETE FROM articles WHERE id = ?").run(id); }

  attachCover(articleId: string, assetId: string): Article {
    this.db.prepare("UPDATE articles SET cover_asset_id=?, updated_at=? WHERE id=?").run(assetId, now(), articleId);
    return this.getArticle(articleId) as Article;
  }

  createArticleVariant(input: Omit<ArticleVariant, "id" | "createdAt">): ArticleVariant {
    const variant: ArticleVariant = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO article_variants (id,article_id,platform_key,title,body,summary,cover_asset_id,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(article_id,platform_key) DO UPDATE SET title=excluded.title, body=excluded.body, summary=excluded.summary, cover_asset_id=excluded.cover_asset_id, content_hash=excluded.content_hash, created_at=excluded.created_at").run(variant.id, variant.articleId, variant.platformKey, variant.title, variant.body, variant.summary, variant.coverAssetId, variant.contentHash, variant.createdAt);
    const row = this.db.prepare("SELECT * FROM article_variants WHERE article_id=? AND platform_key=?").get(variant.articleId, variant.platformKey) as Row;
    const result = toArticleVariant(row);
    const article = this.getArticle(result.articleId);
    if (article) this.ensureQualityState("article_variant", result.id, article.brandId, result.platformKey, result.contentHash, "Draft");
    return result;
  }

  listArticleVariants(articleId: string): ArticleVariant[] {
    return (this.db.prepare("SELECT * FROM article_variants WHERE article_id=? ORDER BY created_at DESC").all(articleId) as Row[]).map(toArticleVariant);
  }

  getArticleVariant(id: string): ArticleVariant | null {
    const row = this.db.prepare("SELECT * FROM article_variants WHERE id=?").get(id) as Row | undefined;
    return row ? toArticleVariant(row) : null;
  }

  updateArticleVariant(id: string, input: Partial<Pick<ArticleVariant, "title" | "body" | "summary" | "coverAssetId">>): ArticleVariant {
    const current = this.getArticleVariant(id);
    if (!current) throw new Error("Article variant not found");
    const previousState = this.getContentQualityState("article_variant", id);
    const title = input.title ?? current.title;
    const body = input.body ?? current.body;
    const summary = input.summary ?? current.summary;
    const contentHash = studioContentHash(`${title}\n${body}`, current.platformKey);
    this.db.prepare("UPDATE article_variants SET title=?,body=?,summary=?,cover_asset_id=?,content_hash=?,created_at=? WHERE id=?").run(title, body, summary, input.coverAssetId ?? current.coverAssetId, contentHash, now(), id);
    const article = this.getArticle(current.articleId);
    if (article) this.ensureQualityState("article_variant", id, article.brandId, current.platformKey, contentHash, "Draft");
    this.recordContentQualityAudit({ contentType: "article_variant", contentId: id, operatorType: "human", previousStatus: previousState?.status ?? "Draft", newStatus: "Draft", reason: "人工编辑后需要重新检查", contentHash });
    return this.getArticleVariant(id) as ArticleVariant;
  }

  getPlatformProfiles(): PlatformProfile[] {
    return (this.db.prepare("SELECT * FROM platform_profiles ORDER BY platform_key").all() as Row[]).map(toPlatformProfile);
  }

  getPlatformProfile(platformKey: string): PlatformProfile | null {
    const row = this.db.prepare("SELECT * FROM platform_profiles WHERE platform_key=?").get(platformKey) as Row | undefined;
    return row ? toPlatformProfile(row) : null;
  }

  upsertPlatformProfile(input: PlatformProfile): PlatformProfile {
    this.db.prepare("INSERT INTO platform_profiles (platform_key,style,title_limit,preferred_min_words,preferred_max_words,min_body_length,max_body_length,supports_cover,cover_required,cover_sizes_json,max_images,supports_tags,max_tags,supports_markdown,supports_html,supports_rich_text,source_url,research_status,last_verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform_key) DO UPDATE SET style=excluded.style,title_limit=excluded.title_limit,preferred_min_words=excluded.preferred_min_words,preferred_max_words=excluded.preferred_max_words,min_body_length=excluded.min_body_length,max_body_length=excluded.max_body_length,supports_cover=excluded.supports_cover,cover_required=excluded.cover_required,cover_sizes_json=excluded.cover_sizes_json,max_images=excluded.max_images,supports_tags=excluded.supports_tags,max_tags=excluded.max_tags,supports_markdown=excluded.supports_markdown,supports_html=excluded.supports_html,supports_rich_text=excluded.supports_rich_text,source_url=excluded.source_url,research_status=excluded.research_status,last_verified_at=excluded.last_verified_at").run(input.platformKey, input.style, input.titleLimit, input.preferredMinWords, input.preferredMaxWords, input.minBodyLength, input.maxBodyLength, input.supportsCover ? 1 : 0, input.coverRequired ? 1 : 0, json(input.coverSizes), input.maxImages, input.supportsTags ? 1 : 0, input.maxTags, input.supportsMarkdown ? 1 : 0, input.supportsHtml ? 1 : 0, input.supportsRichText ? 1 : 0, input.sourceUrl, input.researchStatus, input.lastVerifiedAt);
    return toPlatformProfile(this.db.prepare("SELECT * FROM platform_profiles WHERE platform_key=?").get(input.platformKey) as Row);
  }

  getPlatformContentRules(platformKey?: string): PlatformContentRules[] {
    const rows = (platformKey
      ? this.db.prepare("SELECT * FROM platform_content_rules WHERE platform_key=? ORDER BY platform_key").all(platformKey)
      : this.db.prepare("SELECT * FROM platform_content_rules ORDER BY platform_key").all()) as Row[];
    return rows.map(toPlatformContentRules);
  }

  getPlatformContentRule(platformKey: string): PlatformContentRules {
    const rule = this.getPlatformContentRules(platformKey)[0];
    return rule ?? conservativePlatformContentRules(platformKey);
  }

  upsertPlatformContentRules(input: PlatformContentRules): PlatformContentRules {
    this.db.prepare("INSERT INTO platform_content_rules (platform_key,title_min_length,title_max_length,body_min_length,body_max_length,summary_max_length,max_tags,max_images,supports_links,supports_markdown,supports_html,content_type,source,last_verified_at,verification_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform_key) DO UPDATE SET title_min_length=excluded.title_min_length,title_max_length=excluded.title_max_length,body_min_length=excluded.body_min_length,body_max_length=excluded.body_max_length,summary_max_length=excluded.summary_max_length,max_tags=excluded.max_tags,max_images=excluded.max_images,supports_links=excluded.supports_links,supports_markdown=excluded.supports_markdown,supports_html=excluded.supports_html,content_type=excluded.content_type,source=excluded.source,last_verified_at=excluded.last_verified_at,verification_status=excluded.verification_status,updated_at=excluded.updated_at").run(input.platformKey, input.titleMinLength, input.titleMaxLength, input.bodyMinLength, input.bodyMaxLength, input.summaryMaxLength, input.maxTags, input.maxImages, input.supportsLinks ? 1 : 0, input.supportsMarkdown ? 1 : 0, input.supportsHtml ? 1 : 0, input.contentType, input.source, input.lastVerifiedAt, input.verificationStatus, now());
    return this.getPlatformContentRule(input.platformKey);
  }

  listPlatforms(): Platform[] {
    return (this.db.prepare("SELECT * FROM platforms ORDER BY display_name").all() as Row[]).map(toPlatform);
  }

  updatePlatformBackgroundAutomation(
    platformKey: string,
    status: BackgroundAutomationStatus,
    reason: string | null = null,
    testedAt = now()
  ): Platform {
    const sanitizedReason = sanitizeSelfTestEvidence(reason);
    const result = this.db.prepare("UPDATE platforms SET background_automation_status=?,background_automation_last_tested_at=?,background_automation_reason=? WHERE platform_key=?")
      .run(status, testedAt, sanitizedReason, platformKey);
    if (result.changes !== 1) throw new Error("平台不存在");
    return this.listPlatforms().find((platform) => platform.platformKey === platformKey) as Platform;
  }

  syncAdapterManifests(entries: Array<{ manifest: AdapterManifest; capabilities: PlatformCapabilities }>): void {
    const sync = this.db.transaction(() => {
      const upsertPlatform = this.db.prepare(`
        INSERT INTO platforms (
          id,platform_key,display_name,category,adapter_status,adapter_version,enabled,capabilities_json,
          research_status,health_status,last_verified_at,verification_status,transport,integration_mode,blocking_reason,
          official_website,developer_portal,credential_schema_json,official_sources_json,auth_strategy,callback_strategy
        ) VALUES (?,?,?,?,?,?,?,?,?,'unknown',?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(platform_key) DO UPDATE SET
          display_name=excluded.display_name,
          category=excluded.category,
          adapter_status=excluded.adapter_status,
          adapter_version=excluded.adapter_version,
          capabilities_json=excluded.capabilities_json,
          research_status=excluded.research_status,
          last_verified_at=excluded.last_verified_at,
          verification_status=CASE
            WHEN platforms.verification_status IN ('DryRunPassed','PublishPassed','Stable') THEN platforms.verification_status
            ELSE excluded.verification_status
          END,
          transport=excluded.transport,
          integration_mode=excluded.integration_mode,
          blocking_reason=excluded.blocking_reason,
          official_website=excluded.official_website,
          developer_portal=excluded.developer_portal,
          credential_schema_json=excluded.credential_schema_json,
          official_sources_json=excluded.official_sources_json,
          auth_strategy=excluded.auth_strategy,
          callback_strategy=excluded.callback_strategy
      `);
      const upsertProfile = this.db.prepare(`
        INSERT INTO platform_profiles (
          platform_key,style,title_limit,preferred_min_words,preferred_max_words,min_body_length,max_body_length,
          supports_cover,cover_required,cover_sizes_json,max_images,supports_tags,max_tags,supports_markdown,
          supports_html,supports_rich_text,source_url,research_status,last_verified_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(platform_key) DO UPDATE SET
          title_limit=excluded.title_limit,
          supports_cover=excluded.supports_cover,
          max_images=excluded.max_images,
          supports_tags=excluded.supports_tags,
          max_tags=excluded.max_tags,
          supports_markdown=excluded.supports_markdown,
          supports_rich_text=excluded.supports_rich_text,
          source_url=excluded.source_url,
          research_status=excluded.research_status,
          last_verified_at=excluded.last_verified_at
      `);
      const upsertHealth = this.db.prepare("INSERT OR IGNORE INTO platform_health (platform_key,status) VALUES (?, 'unknown')");
      for (const { manifest, capabilities } of entries) {
        upsertPlatform.run(
          randomUUID(), manifest.platformKey, manifest.displayName, manifest.category, manifest.adapterStatus,
          manifest.version, 1, json(capabilities), manifest.researchStatus, manifest.lastVerifiedAt ?? null,
          manifest.status, manifest.transport, manifest.integrationMode ?? inferIntegrationMode(manifest.transport, manifest.authStrategy), manifest.blockingReason ?? null, manifest.officialWebsite,
          manifest.developerPortal ?? null, json(manifest.credentialSchema), json(manifest.officialSources), manifest.authStrategy, manifest.callbackStrategy
        );
        upsertProfile.run(
          manifest.platformKey, `${manifest.displayName} 平台格式以官方规则为准`, capabilities.maxTitleLength,
          300, 2000, 0, 0, capabilities.coverImage ? 1 : 0, 0, "[]", capabilities.maxImageCount,
          capabilities.tags ? 1 : 0, capabilities.maxTagCount ?? 0, capabilities.markdown ? 1 : 0, 0,
          capabilities.richText ? 1 : 0, manifest.officialSources[0] ?? manifest.officialWebsite,
          manifest.researchStatus, manifest.lastVerifiedAt ?? null
        );
        upsertHealth.run(manifest.platformKey);
      }
    });
    sync();
  }

  reconcileAdapterRegistrations(registeredPlatformKeys: string[]): number {
    const keys = [...new Set(registeredPlatformKeys.filter(Boolean))];
    const rows = this.db.prepare("SELECT platform_key FROM platforms WHERE adapter_status <> 'not_implemented'").all() as Row[];
    const stale = rows.map((row) => textValue(row.platform_key)).filter((key) => !keys.includes(key));
    const update = this.db.prepare("UPDATE platforms SET adapter_status='not_implemented', adapter_version='0.0.0', capabilities_json='{}', verification_status='NotImplemented', health_status='unknown', blocking_reason='Adapter is not registered in the current runtime' WHERE platform_key=?");
    const transaction = this.db.transaction(() => stale.reduce((count, key) => count + update.run(key).changes, 0));
    return transaction();
  }

  listAccounts(options: { includeArchived?: boolean } = {}): Account[] {
    const sql = options.includeArchived ? "SELECT * FROM accounts ORDER BY platform_key, name" : "SELECT * FROM accounts WHERE archived_at IS NULL ORDER BY platform_key, name";
    return (this.db.prepare(sql).all() as Row[]).map(toAccount);
  }

  getAccountById(accountId: string, platformKey?: string): Account | null {
    const row = platformKey
      ? this.db.prepare("SELECT * FROM accounts WHERE id=? AND platform_key=?").get(accountId, platformKey) as Row | undefined
      : this.db.prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as Row | undefined;
    return row ? toAccount(row) : null;
  }

  getPlatformAccountIdentityBinding(platformKey: string, accountId: string): PlatformAccountIdentityBinding | null {
    const row = this.db.prepare("SELECT * FROM platform_account_identity_bindings WHERE platform_key=? AND account_id=?").get(platformKey, accountId) as Row | undefined;
    return row ? toPlatformAccountIdentityBinding(row) : null;
  }

  bindPlatformAccountIdentity(input: {
    platformKey: "xiaohongshu";
    accountId: string;
    externalCreatorId: string;
    displayName?: string | null;
    profileUrl?: string | null;
    bindingSource: PlatformAccountIdentityBinding["bindingSource"];
  }): PlatformAccountIdentityBinding {
    const transaction = this.db.transaction(() => {
      const account = this.db.prepare("SELECT id FROM accounts WHERE id=? AND platform_key=? AND archived_at IS NULL").get(input.accountId, input.platformKey) as Row | undefined;
      if (!account) throw new Error("身份绑定账号不存在或已归档");
      const existing = this.db.prepare("SELECT * FROM platform_account_identity_bindings WHERE platform_key=? AND account_id=?").get(input.platformKey, input.accountId) as Row | undefined;
      if (existing) {
        if (textValue(existing.external_creator_id) !== input.externalCreatorId) throw new Error("当前账号已有不同的小红书 Creator 身份绑定，拒绝覆盖");
        return toPlatformAccountIdentityBinding(existing);
      }
      const conflict = this.db.prepare("SELECT account_id FROM platform_account_identity_bindings WHERE platform_key=? AND external_creator_id=?").get(input.platformKey, input.externalCreatorId) as Row | undefined;
      if (conflict && textValue(conflict.account_id) !== input.accountId) throw new Error("小红书 Creator 身份已绑定到其他内部账号");
      const timestamp = now();
      const id = randomUUID();
      this.db.prepare(`INSERT INTO platform_account_identity_bindings (
        id, platform_key, account_id, external_creator_id, display_name, profile_url,
        binding_source, bound_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.platformKey, input.accountId, input.externalCreatorId, input.displayName ?? null, input.profileUrl ?? null,
        input.bindingSource, timestamp, timestamp, timestamp
      );
      return toPlatformAccountIdentityBinding(this.db.prepare("SELECT * FROM platform_account_identity_bindings WHERE id=?").get(id) as Row);
    });
    return transaction();
  }

  /**
   * Atomically establishes the first trusted XHS Creator identity for an
   * active internal account, while also repairing the two supported partial
   * legacy states. Ownership conflicts are deliberately fail-closed.
   */
  bootstrapXhsCreatorIdentity(input: {
    accountId: string;
    observedCreatorId: string;
    displayName?: string | null;
    profileUrl?: string | null;
  }): { account: Account; binding: PlatformAccountIdentityBinding } {
    const externalCreatorId = input.observedCreatorId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(externalCreatorId)) {
      throw Object.assign(new Error("小红书 Creator 外部 ID 格式无效，拒绝绑定"), { code: "XHS_CREATOR_ID_INVALID" });
    }
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM accounts WHERE id=? AND platform_key=?").get(input.accountId, "xiaohongshu") as Row | undefined;
      if (!current) throw Object.assign(new Error("小红书身份绑定账号不存在"), { code: "XHS_IDENTITY_ACCOUNT_NOT_FOUND" });
      if (current.archived_at != null || !boolValue(current.enabled)) throw Object.assign(new Error("小红书身份绑定账号不可用或已归档"), { code: "XHS_IDENTITY_ACCOUNT_UNAVAILABLE" });

      const accountExternalCreatorId = typeof current.external_account_id === "string" && current.external_account_id.trim() ? current.external_account_id.trim() : null;
      const currentBinding = this.db.prepare("SELECT * FROM platform_account_identity_bindings WHERE platform_key=? AND account_id=?").get("xiaohongshu", input.accountId) as Row | undefined;
      const bindingExternalCreatorId = currentBinding && typeof currentBinding.external_creator_id === "string" && currentBinding.external_creator_id.trim() ? currentBinding.external_creator_id.trim() : null;
      if (accountExternalCreatorId && bindingExternalCreatorId && accountExternalCreatorId !== bindingExternalCreatorId) {
        throw Object.assign(new Error("账号 external account ID 与 Creator identity binding 冲突，拒绝选择其一"), { code: "XHS_IDENTITY_PARTIAL_STATE_CONFLICT" });
      }
      if (accountExternalCreatorId && accountExternalCreatorId !== externalCreatorId) {
        throw Object.assign(new Error("小红书 Creator 身份与账号已有绑定不一致，拒绝覆盖"), { code: "XHS_CREATOR_IDENTITY_MISMATCH" });
      }
      if (bindingExternalCreatorId && bindingExternalCreatorId !== externalCreatorId) {
        throw Object.assign(new Error("小红书 Creator identity binding 与当前证明不一致，拒绝覆盖"), { code: "XHS_CREATOR_IDENTITY_MISMATCH" });
      }

      const accountOwners = this.db.prepare("SELECT id, archived_at FROM accounts WHERE platform_key=? AND external_account_id=? AND id<>?").all("xiaohongshu", externalCreatorId, input.accountId) as Row[];
      if (accountOwners.some((row) => row.archived_at == null)) {
        throw Object.assign(new Error("小红书 Creator 身份已绑定到其他活动内部账号"), { code: "XHS_CREATOR_ID_ALREADY_BOUND_TO_ANOTHER_ACTIVE_ACCOUNT" });
      }
      if (accountOwners.some((row) => row.archived_at != null)) {
        throw Object.assign(new Error("小红书 Creator 身份已属于归档内部账号，拒绝静默迁移"), { code: "XHS_CREATOR_ID_BOUND_TO_ARCHIVED_ACCOUNT" });
      }
      const bindingOwners = this.db.prepare("SELECT b.account_id, a.archived_at FROM platform_account_identity_bindings b LEFT JOIN accounts a ON a.id=b.account_id AND a.platform_key=b.platform_key WHERE b.platform_key=? AND b.external_creator_id=? AND b.account_id<>?").all("xiaohongshu", externalCreatorId, input.accountId) as Row[];
      if (bindingOwners.some((row) => row.archived_at == null)) {
        throw Object.assign(new Error("小红书 Creator identity binding 已属于其他活动内部账号"), { code: "XHS_CREATOR_ID_ALREADY_BOUND_TO_ANOTHER_ACTIVE_ACCOUNT" });
      }
      if (bindingOwners.some((row) => row.archived_at != null)) {
        throw Object.assign(new Error("小红书 Creator identity binding 已属于归档内部账号，拒绝静默迁移"), { code: "XHS_CREATOR_ID_BOUND_TO_ARCHIVED_ACCOUNT" });
      }

      const timestamp = now();
      if (!accountExternalCreatorId) {
        this.db.prepare("UPDATE accounts SET external_account_id=?, updated_at=? WHERE id=? AND platform_key=? AND archived_at IS NULL").run(externalCreatorId, timestamp, input.accountId, "xiaohongshu");
      }
      if (!currentBinding) {
        const id = randomUUID();
        this.db.prepare(`INSERT INTO platform_account_identity_bindings (
          id, platform_key, account_id, external_creator_id, display_name, profile_url,
          binding_source, bound_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, "xiaohongshu", input.accountId, externalCreatorId, input.displayName ?? null, input.profileUrl ?? null,
          accountExternalCreatorId ? "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH" : "OWNER_APPROVED_CREATOR_IDENTITY_BINDING", timestamp, timestamp, timestamp
        );
      }
      const account = this.db.prepare("SELECT * FROM accounts WHERE id=? AND platform_key=?").get(input.accountId, "xiaohongshu") as Row | undefined;
      const binding = this.db.prepare("SELECT * FROM platform_account_identity_bindings WHERE platform_key=? AND account_id=?").get("xiaohongshu", input.accountId) as Row | undefined;
      if (!account || !binding) throw Object.assign(new Error("小红书 Creator identity bootstrap 写入后复读失败"), { code: "XHS_IDENTITY_BOOTSTRAP_REVALIDATION_FAILED" });
      return { account: toAccount(account), binding: toPlatformAccountIdentityBinding(binding) };
    });
    try {
      transaction();
      const account = this.getAccountById(input.accountId, "xiaohongshu");
      const binding = this.getPlatformAccountIdentityBinding("xiaohongshu", input.accountId);
      if (!account || !binding || account.externalAccountId !== externalCreatorId || binding.accountId !== input.accountId || binding.externalCreatorId !== externalCreatorId) {
        throw Object.assign(new Error("小红书 Creator identity bootstrap 提交后一致性复核失败"), { code: "XHS_IDENTITY_BOOTSTRAP_REVALIDATION_FAILED" });
      }
      return { account, binding };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed: platform_account_identity_bindings\.external_creator_id/i.test(message)) {
        const owner = this.db.prepare("SELECT a.archived_at FROM platform_account_identity_bindings b LEFT JOIN accounts a ON a.id=b.account_id AND a.platform_key=b.platform_key WHERE b.platform_key=? AND b.external_creator_id=? AND b.account_id<>?").get("xiaohongshu", externalCreatorId, input.accountId) as Row | undefined;
        if (owner?.archived_at != null) throw Object.assign(new Error("小红书 Creator identity binding 并发命中归档账号，拒绝静默迁移"), { code: "XHS_CREATOR_ID_BOUND_TO_ARCHIVED_ACCOUNT" });
        throw Object.assign(new Error("小红书 Creator identity binding 并发冲突，已拒绝覆盖"), { code: "XHS_CREATOR_ID_ALREADY_BOUND_TO_ANOTHER_ACTIVE_ACCOUNT" });
      }
      throw error;
    }
  }

  findArchivedAccountByExternalIdForConnection(accountId: string, platformKey: string, externalAccountId: string): Account | null {
    const current = this.getAccountById(accountId, platformKey);
    if (!current) throw new Error("账号不存在");
    if (current.externalAccountId || current.archivedAt) return null;
    const references = this.db.prepare("SELECT (SELECT COUNT(*) FROM publish_jobs WHERE account_id=?) + (SELECT COUNT(*) FROM submission_intents WHERE account_id=?) + (SELECT COUNT(*) FROM publish_records WHERE account_id=?) AS count").get(accountId, accountId, accountId) as Row;
    if (intValue(references.count) > 0) return null;
    const active = this.db.prepare("SELECT id FROM accounts WHERE platform_key=? AND external_account_id=? AND archived_at IS NULL AND id<>?").get(platformKey, externalAccountId, accountId) as Row | undefined;
    if (active) throw new Error("平台外部账号已绑定到其他内部账号");
    const rows = this.db.prepare("SELECT * FROM accounts WHERE platform_key=? AND external_account_id=? AND archived_at IS NOT NULL ORDER BY updated_at DESC").all(platformKey, externalAccountId) as Row[];
    if (rows.length > 1) throw new Error("归档账号身份不唯一，拒绝自动恢复");
    return rows[0] ? toAccount(rows[0]) : null;
  }

  getAccountAuthorization(accountId: string, platformKey: string): AccountAuthorizationView | null {
    const row = this.db.prepare("SELECT * FROM account_authorizations WHERE account_id=? AND platform_key=?").get(accountId, platformKey) as Row | undefined;
    return row ? toAccountAuthorization(row) : null;
  }

  upsertAccountAuthorization(input: { accountId: string; platformKey: string; authorizationType: string; status: AccountAuthorizationView["status"]; scopes?: string[]; expiresAt?: string | null; providerAccountId?: string | null; providerAccountName?: string | null }): AccountAuthorizationView {
    const timestamp = now();
    this.db.prepare("INSERT INTO account_authorizations (account_id,platform_key,authorization_type,encrypted_token_ref,status,scopes_json,expires_at,provider_account_id,provider_account_name,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,platform_key) DO UPDATE SET authorization_type=excluded.authorization_type,status=excluded.status,scopes_json=excluded.scopes_json,expires_at=excluded.expires_at,provider_account_id=excluded.provider_account_id,provider_account_name=excluded.provider_account_name,updated_at=excluded.updated_at").run(input.accountId, input.platformKey, input.authorizationType, `account:${input.accountId}:${input.platformKey}`, input.status, json(input.scopes ?? []), input.expiresAt ?? null, input.providerAccountId ?? null, input.providerAccountName ?? null, timestamp);
    return this.getAccountAuthorization(input.accountId, input.platformKey) as AccountAuthorizationView;
  }

  createAccount(input: { platformKey: string; name: string; accountAlias?: string; groupId?: string | null; allowAutoPublish?: boolean; publishMode?: Account["publishMode"]; minimumIntervalSeconds?: number }): Account {
    const id = randomUUID();
    const timestamp = now();
    const publishMode = input.publishMode ?? (input.allowAutoPublish === undefined ? "inherit" : input.allowAutoPublish ? "auto" : "manual");
    const alias = (input.accountAlias ?? input.name).trim();
    this.db.prepare("INSERT INTO accounts (id,platform_key,name,account_alias,group_id,login_status,enabled,allow_auto_publish,minimum_interval_seconds,publish_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.platformKey, alias, alias, input.groupId ?? null, "unknown", 1, publishMode === "auto" ? 1 : 0, input.minimumIntervalSeconds ?? 0, publishMode, timestamp, timestamp);
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=?").get(id) as Row);
  }

  syncBrowserPlatformAccount(input: { accountId: string; platformKey: string; accountName?: string; browserSessionId: string; externalAccountId?: string | null; lastVerifiedAt?: string }): Account {
    const current = this.db.prepare("SELECT * FROM accounts WHERE id=? AND platform_key=?").get(input.accountId, input.platformKey) as Row | undefined;
    if (!current) throw new Error("知乎账号映射不存在");
    const existingByExternal = input.externalAccountId ? this.db.prepare("SELECT id FROM accounts WHERE platform_key=? AND external_account_id=? AND id<>?").get(input.platformKey, input.externalAccountId, input.accountId) as Row | undefined : undefined;
    if (existingByExternal) throw new Error("平台外部账号已绑定到其他内部账号");
    const timestamp = input.lastVerifiedAt ?? now();
    const preservedExternalId = input.externalAccountId === undefined ? (typeof current.external_account_id === "string" ? current.external_account_id : null) : input.externalAccountId;
    this.db.prepare("UPDATE accounts SET platform_account_name=COALESCE(NULLIF(?,''),platform_account_name), login_status='logged_in', enabled=1, paused_reason=NULL, connection_mode='BrowserAutomation', authorization_status='Authorized', browser_session_id=?, external_account_id=?, archived_at=NULL, last_verified_at=?, last_login_check_at=?, last_used_at=?, updated_at=? WHERE id=? AND platform_key=?").run(input.accountName?.trim() ?? "", input.browserSessionId, preservedExternalId, timestamp, timestamp, timestamp, timestamp, input.accountId, input.platformKey);
    this.upsertAccountAuthorization({ accountId: input.accountId, platformKey: input.platformKey, authorizationType: "BrowserAutomation", status: "Authorized", providerAccountId: preservedExternalId, providerAccountName: input.accountName ?? null });
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=?").get(input.accountId) as Row);
  }

  markPlatformAccountDisconnected(accountId: string, platformKey: string, authorizationType = "BrowserAutomation"): Account {
    const current = this.db.prepare("SELECT * FROM accounts WHERE id=? AND platform_key=?").get(accountId, platformKey) as Row | undefined;
    if (!current) throw new Error("账号不存在");
    const timestamp = now();
    const disconnect = this.db.transaction(() => {
      this.db.prepare("UPDATE accounts SET login_status='logged_out', authorization_status='NotAuthorized', browser_session_id=NULL, paused_reason=NULL, archived_at=COALESCE(archived_at,?), last_login_check_at=?, updated_at=? WHERE id=? AND platform_key=?").run(timestamp, timestamp, timestamp, accountId, platformKey);
      this.upsertAccountAuthorization({ accountId, platformKey, authorizationType, status: "NotAuthorized", providerAccountId: typeof current.external_account_id === "string" ? current.external_account_id : null, providerAccountName: typeof current.name === "string" ? current.name : null });
    });
    disconnect();
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as Row);
  }

  restoreArchivedAccountByExternalId(platformKey: string, externalAccountId: string): Account {
    const active = this.db.prepare("SELECT id FROM accounts WHERE platform_key=? AND external_account_id=? AND archived_at IS NULL").get(platformKey, externalAccountId) as Row | undefined;
    if (active) throw new Error("平台外部账号已绑定到其他内部账号");
    const rows = this.db.prepare("SELECT * FROM accounts WHERE platform_key=? AND external_account_id=? AND archived_at IS NOT NULL ORDER BY updated_at DESC").all(platformKey, externalAccountId) as Row[];
    if (rows.length === 0) throw new Error("归档账号不存在");
    if (rows.length > 1) throw new Error("归档账号身份不唯一，拒绝自动恢复");
    const accountId = textValue(rows[0]?.id);
    const timestamp = now();
    this.db.prepare("UPDATE accounts SET archived_at=NULL, enabled=1, login_status='logged_out', authorization_status='NotAuthorized', browser_session_id=NULL, paused_reason=NULL, updated_at=? WHERE id=? AND platform_key=? AND external_account_id=? AND archived_at IS NOT NULL").run(timestamp, accountId, platformKey, externalAccountId);
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=? AND platform_key=?").get(accountId, platformKey) as Row);
  }

  syncOfficialApiAccount(input: { accountId: string; platformKey: string; accountName?: string | null; externalAccountId?: string | null; lastVerifiedAt?: string }): Account {
    const current = this.db.prepare("SELECT * FROM accounts WHERE id=? AND platform_key=?").get(input.accountId, input.platformKey) as Row | undefined;
    if (!current) throw new Error("账号不存在");
    const timestamp = input.lastVerifiedAt ?? now();
    this.db.prepare("UPDATE accounts SET platform_account_name=COALESCE(NULLIF(?,''),platform_account_name), login_status='logged_in', enabled=1, paused_reason=NULL, connection_mode='OfficialAPI', authorization_status='Authorized', external_account_id=COALESCE(?,external_account_id), last_verified_at=?, last_login_check_at=?, last_used_at=?, updated_at=? WHERE id=? AND platform_key=?").run(input.accountName?.trim() ?? "", input.externalAccountId ?? null, timestamp, timestamp, timestamp, timestamp, input.accountId, input.platformKey);
    this.upsertAccountAuthorization({ accountId: input.accountId, platformKey: input.platformKey, authorizationType: "AppCredential", status: "Authorized", providerAccountId: input.externalAccountId ?? null, providerAccountName: input.accountName ?? null });
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=?").get(input.accountId) as Row);
  }

  markAccountUsed(accountId: string): Account {
    const timestamp = now();
    const result = this.db.prepare("UPDATE accounts SET last_used_at=?,updated_at=? WHERE id=?").run(timestamp, timestamp, accountId);
    if (result.changes !== 1) throw new Error("账号不存在");
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as Row);
  }

  updateAccount(id: string, input: { accountAlias?: string; enabled?: boolean; loginStatus?: LoginStatus; pausedReason?: string | null; allowAutoPublish?: boolean; publishMode?: Account["publishMode"]; minimumIntervalSeconds?: number; failedCount?: number }): Account {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new Error("账号不存在");
    const account = toAccount(row);
    const next = { ...account, ...input, publishMode: input.publishMode ?? (input.allowAutoPublish === undefined ? account.publishMode : input.allowAutoPublish ? "auto" : "manual") };
    const timestamp = now();
    const alias = (input.accountAlias ?? account.accountAlias).trim();
    if (!alias) throw new Error("账号别名不能为空");
    this.db.prepare("UPDATE accounts SET name=?, account_alias=?, enabled=?, login_status=?, paused_reason=?, allow_auto_publish=?, publish_mode=?, minimum_interval_seconds=?, failed_count=?, last_login_check_at=?, updated_at=? WHERE id=?").run(alias, alias, next.enabled ? 1 : 0, next.loginStatus, next.pausedReason, next.publishMode === "auto" ? 1 : 0, next.publishMode, next.minimumIntervalSeconds, next.failedCount, timestamp, timestamp, id);
    return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=?").get(id) as Row);
  }

  createPlatformSelfTestRun(input: { platformAccountId: string; requestedLevel: PlatformSelfTestLevel }): PlatformSelfTestRun {
    const account = this.listAccounts().find((item) => item.platformAccountId === input.platformAccountId || item.id === input.platformAccountId);
    if (!account) throw new Error("平台自测账号不存在");
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO platform_self_test_runs (
      id,test_run_id,platform_key,platform_account_id,requested_level,overall_result,started_at,last_tested_at,cleanup_status,updated_at
    ) VALUES (?,?,?,?,?,'TESTING',?,?,?,?)`).run(id, id, account.platformKey, account.platformAccountId ?? account.id, input.requestedLevel, timestamp, timestamp, "NOT_AVAILABLE", timestamp);
    return this.getPlatformSelfTestRun(id) as PlatformSelfTestRun;
  }

  getPlatformSelfTestRun(testRunId: string): PlatformSelfTestRun | null {
    const row = this.db.prepare("SELECT * FROM platform_self_test_runs WHERE test_run_id=? OR id=?").get(testRunId, testRunId) as Row | undefined;
    if (!row) return null;
    const steps = (this.db.prepare("SELECT * FROM platform_self_test_steps WHERE test_run_id=? ORDER BY started_at, step_key").all(textValue(row.test_run_id)) as Row[]).map(toPlatformSelfTestStep);
    return toPlatformSelfTestRun(row, steps);
  }

  getOneShotConfirmationReconciliationSnapshot(identity: FailedOneShotConfirmationIdentity): OneShotConfirmationReconciliationSnapshot {
    const runRows = this.db.prepare("SELECT * FROM platform_self_test_runs WHERE test_run_id=?").all(identity.testRunId) as Row[];
    if (runRows.length !== 1) throw new Error(runRows.length === 0 ? "ONE_SHOT_RECONCILIATION_IDENTITY_NOT_FOUND" : "ONE_SHOT_RECONCILIATION_IDENTITY_AMBIGUOUS");
    const run = this.getPlatformSelfTestRun(identity.testRunId);
    if (!run) throw new Error("ONE_SHOT_RECONCILIATION_IDENTITY_NOT_FOUND");
    if (run.platformKey !== "xiaohongshu" || run.accountId !== identity.accountId || run.platformAccountId !== identity.accountId) throw new Error("ONE_SHOT_RECONCILIATION_IDENTITY_MISMATCH");
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='one_shot_publication_authorizations'").get()) throw new Error("ONE_SHOT_RECONCILIATION_AUTHORIZATION_TABLE_MISSING");
    const authorizationRows = this.db.prepare("SELECT publication_transaction_count,final_submit_attempt_count FROM one_shot_publication_authorizations WHERE operation_id=?").all(identity.testRunId) as Row[];
    const jobRows = run.publishJobId
      ? this.db.prepare("SELECT status,external_id FROM publish_jobs WHERE id=?").all(run.publishJobId) as Row[]
      : [];
    const recordRows = run.publishRecordId
      ? this.db.prepare("SELECT status,verification_status,published_external_id,published_url FROM publish_records WHERE id=?").all(run.publishRecordId) as Row[]
      : [];
    const operationStepCount = run.steps.filter((step) => step.stepKey !== ONE_SHOT_CONFIRMATION_STEP).length;
    const operationCount = operationStepCount + (run.testArticleId ? 1 : 0) + (run.publishJobId ? 1 : 0) + (run.publishRecordId ? 1 : 0) + jobRows.length + recordRows.length;
    const externalPublicationEvidence = Boolean(run.externalId || run.externalUrl)
      || run.steps.some((step) => Boolean(step.externalId || step.externalUrl))
      || jobRows.some((row) => Boolean(row.external_id))
      || recordRows.some((row) => Boolean(row.published_external_id || row.published_url));
    const needsReconciliation = jobRows.some((row) => textValue(row.status) === "NeedsReconciliation") || recordRows.some((row) => textValue(row.status) === "NeedsReconciliation");
    const publishedOrVerified = jobRows.some((row) => textValue(row.status) === "Published")
      || recordRows.some((row) => textValue(row.status) === "Published" || textValue(row.verification_status) === "Verified");
    return {
      identity,
      run,
      authorizationCount: authorizationRows.length,
      operationCount,
      publicationTransactionCount: authorizationRows.reduce((total, row) => total + intValue(row.publication_transaction_count), 0),
      finalSubmitAttemptCount: authorizationRows.reduce((total, row) => total + intValue(row.final_submit_attempt_count), 0),
      externalPublicationEvidence,
      needsReconciliation,
      publishedOrVerified
    };
  }

  reconcileFailedOneShotConfirmation(identity: FailedOneShotConfirmationIdentity): OneShotConfirmationReconciliationResult {
    const transaction = this.db.transaction(() => {
      const snapshot = this.getOneShotConfirmationReconciliationSnapshot(identity);
      if (isCanonicalRetryable(snapshot)) return { status: "ALREADY_RECONCILED" as const, testRunId: identity.testRunId, mutationCount: 0 as const, retryEligible: true as const };
      const failure = reconciliationFailure(snapshot);
      if (failure) throw Object.assign(new Error(failure), { code: failure });
      const timestamp = now();
      const runUpdate = this.db.prepare("UPDATE platform_self_test_runs SET publish_confirmed_at=NULL,updated_at=? WHERE test_run_id=? AND publish_confirmed_at IS NOT NULL").run(timestamp, identity.testRunId);
      if (runUpdate.changes !== 1) throw new Error("ONE_SHOT_RECONCILIATION_STATE_CHANGED");
      const stepUpdate = this.db.prepare(`UPDATE platform_self_test_steps SET
        result='WAITING_FOR_USER',error_code=?,message=?,verification_signal=?
        WHERE test_run_id=? AND step_key=?`).run(
        ONE_SHOT_CONFIRMATION_ERROR,
        "一次性真实发布测试需要 Owner 确认",
        "authorization:OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH:state:NOT_AUTHORIZED",
        identity.testRunId,
        ONE_SHOT_CONFIRMATION_STEP
      );
      if (stepUpdate.changes !== 1) throw new Error("ONE_SHOT_RECONCILIATION_CONFIRMATION_STEP_MISSING");
      return { status: "RECONCILED_RETRYABLE" as const, testRunId: identity.testRunId, mutationCount: 1 as const, retryEligible: true as const };
    });
    return transaction();
  }

  listPlatformSelfTestRuns(platformAccountId?: string): PlatformSelfTestRun[] {
    const rows = platformAccountId
      ? this.db.prepare("SELECT * FROM platform_self_test_runs WHERE platform_account_id=? ORDER BY last_tested_at DESC").all(platformAccountId) as Row[]
      : this.db.prepare("SELECT * FROM platform_self_test_runs ORDER BY last_tested_at DESC").all() as Row[];
    return rows.map((row) => this.getPlatformSelfTestRun(textValue(row.test_run_id)) as PlatformSelfTestRun);
  }

  recordPlatformSelfTestStep(input: {
    testRunId: string;
    testLevel: PlatformSelfTestLevel;
    stepKey: string;
    startedAt: string;
    finishedAt?: string | null;
    result: PlatformSelfTestResult;
    errorCode?: string | null;
    message?: string | null;
    verificationSignal?: string | null;
    externalId?: string | null;
    externalUrl?: string | null;
  }): PlatformSelfTestStep {
    const run = this.getPlatformSelfTestRun(input.testRunId);
    if (!run) throw new Error("平台自测运行不存在");
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO platform_self_test_steps (
      id,test_run_id,platform_key,platform_account_id,test_level,step_key,started_at,finished_at,result,error_code,message,verification_signal,external_id,external_url,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(test_run_id,step_key) DO UPDATE SET
      test_level=excluded.test_level,started_at=excluded.started_at,finished_at=excluded.finished_at,result=excluded.result,
      error_code=excluded.error_code,message=excluded.message,verification_signal=excluded.verification_signal,
      external_id=excluded.external_id,external_url=excluded.external_url`).run(
      id, run.testRunId, run.platformKey, run.platformAccountId, input.testLevel, input.stepKey, input.startedAt,
      input.finishedAt ?? timestamp, input.result, sanitizeSelfTestEvidence(input.errorCode), sanitizeSelfTestEvidence(input.message),
      sanitizeSelfTestEvidence(input.verificationSignal), input.externalId ?? null, input.externalUrl ?? null, timestamp
    );
    this.db.prepare("UPDATE platform_self_test_runs SET last_tested_at=?,updated_at=? WHERE test_run_id=?").run(timestamp, timestamp, run.testRunId);
    return (this.getPlatformSelfTestRun(run.testRunId) as PlatformSelfTestRun).steps.find((step) => step.stepKey === input.stepKey) as PlatformSelfTestStep;
  }

  finishPlatformSelfTestRun(testRunId: string, result: PlatformSelfTestResult): PlatformSelfTestRun {
    const timestamp = now();
    const update = this.db.prepare("UPDATE platform_self_test_runs SET overall_result=?,finished_at=?,last_tested_at=?,updated_at=? WHERE test_run_id=?").run(result, timestamp, timestamp, timestamp, testRunId);
    if (update.changes === 0) throw new Error("平台自测运行不存在");
    return this.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
  }

  confirmPlatformSelfTestOneShotAtomically(testRunId: string, authorization: OneShotPublicationAuthorization): OneShotConfirmationPersistenceResult {
    if (authorization.operationId !== testRunId) throw new Error("ONE_SHOT_OPERATION_BINDING_MISMATCH");
    const transaction = this.db.transaction(() => {
      const run = this.getPlatformSelfTestRun(testRunId);
      if (!run || run.platformKey !== "xiaohongshu" || run.accountId !== authorization.accountId || run.platformAccountId !== authorization.accountId) throw new Error("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
      const existing = this.getOneShotPublicationAuthorization(authorization.operationId);
      if (existing) {
        const sameIdentity = existing.authorization === authorization.authorization
          && existing.platformKey === authorization.platformKey
          && existing.accountId === authorization.accountId
          && existing.operationId === authorization.operationId
          && existing.mode === authorization.mode;
        if (!sameIdentity) throw new Error("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
        return { authorization: existing, created: false };
      }
      const timestamp = now();
      const update = this.db.prepare("UPDATE platform_self_test_runs SET publish_confirmed_at=COALESCE(publish_confirmed_at,?),updated_at=? WHERE test_run_id=? AND requested_level='L5_PUBLISH'").run(timestamp, timestamp, testRunId);
      if (update.changes === 0) throw new Error("当前运行不是可确认的真实发布测试");
      this.db.prepare(`INSERT INTO one_shot_publication_authorizations (
        id,authorization,platform_key,account_id,operation_id,mode,state,publication_transaction_count,
        publication_commit_action_count,final_submit_attempt_count,final_submit_retry_count,
        final_submit_action_started,final_submit_action_completed,created_at,updated_at,consumed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), authorization.authorization, authorization.platformKey, authorization.accountId, authorization.operationId,
        authorization.mode, authorization.state, authorization.publicationTransactionCount, authorization.publicationCommitActionCount,
        authorization.finalSubmitAttemptCount, authorization.finalSubmitRetryCount, authorization.finalSubmitActionStarted ? 1 : 0,
        authorization.finalSubmitActionCompleted ? 1 : 0, timestamp, timestamp, authorization.consumedAt ?? null
      );
      return { authorization: this.getOneShotPublicationAuthorization(authorization.operationId) as OneShotPublicationAuthorization, created: true };
    });
    return transaction();
  }

  confirmPlatformSelfTestPublish(testRunId: string): PlatformSelfTestRun {
    const timestamp = now();
    const update = this.db.prepare("UPDATE platform_self_test_runs SET publish_confirmed_at=?,updated_at=? WHERE test_run_id=? AND requested_level='L5_PUBLISH'").run(timestamp, timestamp, testRunId);
    if (update.changes === 0) throw new Error("当前运行不是可确认的真实发布测试");
    return this.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
  }

  confirmPlatformSelfTestDelete(testRunId: string): PlatformSelfTestRun {
    const timestamp = now();
    const update = this.db.prepare("UPDATE platform_self_test_runs SET delete_confirmed_at=?,cleanup_status='WAITING_FOR_CONFIRMATION',updated_at=? WHERE test_run_id=? AND external_id IS NOT NULL").run(timestamp, timestamp, testRunId);
    if (update.changes === 0) throw new Error("没有可确认删除的真实测试内容");
    return this.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
  }

  createPlatformSelfTestPublishJob(input: { testRunId: string; title: string; body: string; dryRun: boolean; selectedImageAssetId?: string | null }): PublishJob {
    const run = this.getPlatformSelfTestRun(input.testRunId);
    if (!run) throw new Error("平台自测运行不存在");
    if (!input.dryRun && !run.publishConfirmedAt) throw new Error("真实发布测试尚未获得用户明确确认");
    if (run.publishJobId) return this.getJob(run.publishJobId) as PublishJob;
    const account = this.listAccounts().find((item) => (item.platformAccountId ?? item.id) === run.platformAccountId && item.platformKey === run.platformKey);
    if (!account || account.id !== run.accountId || account.platformKey !== run.platformKey || !account.enabled || account.archivedAt) throw new Error("平台自测账号绑定不可用");
    const brand = this.listBrands()[0];
    if (!brand) throw new Error("请先创建企业资料，再执行需要持久化内容的 L4/L5 自测");
    const timestamp = now();
    const article = this.createArticle({
      brandId: brand.id, topic: `platform_self_test:${run.platformKey}`, keyword: "平台发布链路测试", city: "", title: input.title,
      body: input.body, summary: "Geo Media Publisher 内部发布链路测试", tags: ["内部测试"], seoKeywords: [], articleType: "自测",
      aiProvider: "system", aiModel: "transparent-self-test-v1.1.3", generatedAt: timestamp, reusePolicy: "once",
      contentHash: createHash("sha256").update(`${run.testRunId}\n${input.title}\n${input.body}`).digest("hex"), qualityStatus: "passed",
      qualityWarnings: [], source: "test", sourceNote: `platform-self-test:${run.testRunId}`
    });
    if (!article) throw new Error("平台自测内容创建失败");
    const jobId = randomUUID();
    const selectedImageAssetId = input.selectedImageAssetId ?? null;
    const imageSelectionMode = selectedImageAssetId ? "manual" : "none";
    this.db.prepare(`INSERT INTO publish_jobs (
      id,plan_id,account_id,platform_account_id,platform_key,article_id,article_variant_id,scheduled_at,status,max_attempts,created_at,
      dry_run,manual_confirmation_required,content_kind,selected_image_asset_id,image_selection_mode,publish_payload_json
    ) VALUES (?,NULL,?,?,?,?,NULL,?,'AwaitingConfirmation',1,?,?,?,?,?,?,?)`).run(
      jobId, account.id, account.platformAccountId ?? account.id, account.platformKey, article.id, timestamp, timestamp, input.dryRun ? 1 : 0, 1, "article", selectedImageAssetId, imageSelectionMode, json({ selfTestRunId: run.testRunId, transparentTestContent: true })
    );
    this.db.prepare("UPDATE platform_self_test_runs SET test_article_id=?,publish_job_id=?,updated_at=? WHERE test_run_id=?").run(article.id, jobId, timestamp, run.testRunId);
    return this.getJob(jobId) as PublishJob;
  }

  linkPlatformSelfTestPublishEvidence(testRunId: string, publishRecordId: string): PlatformSelfTestRun {
    const record = this.db.prepare("SELECT * FROM publish_records WHERE id=?").get(publishRecordId) as Row | undefined;
    if (!record) throw new Error("发布证据不存在");
    const realSuccess = boolValue(record.success) && !boolValue(record.dry_run) && ["Published", "Submitted"].includes(textValue(record.status));
    const timestamp = now();
    this.db.prepare("UPDATE platform_self_test_runs SET publish_record_id=?,external_id=?,external_url=?,cleanup_status=?,updated_at=? WHERE test_run_id=?").run(
      publishRecordId,
      realSuccess && typeof record.published_external_id === "string" ? record.published_external_id : null,
      realSuccess && typeof record.published_url === "string" ? record.published_url : null,
      realSuccess && typeof record.published_external_id === "string" ? "AVAILABLE" : "NOT_AVAILABLE",
      timestamp,
      testRunId
    );
    return this.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
  }

  markPlatformSelfTestCleaned(testRunId: string, result: "CLEANED" | "FAILED"): PlatformSelfTestRun {
    const timestamp = now();
    const update = this.db.prepare("UPDATE platform_self_test_runs SET cleanup_status=?,cleaned_at=?,updated_at=? WHERE test_run_id=?").run(result, result === "CLEANED" ? timestamp : null, timestamp, testRunId);
    if (update.changes === 0) throw new Error("平台自测运行不存在");
    return this.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
  }

  listPlans(): PublishPlan[] { return (this.db.prepare("SELECT * FROM publish_plans ORDER BY created_at DESC").all() as Row[]).map(toPlan); }

  createPlan(input: Omit<PublishPlan, "id">): PublishPlan {
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare("INSERT INTO publish_plans (id,name,brand_id,enabled,strategy,articles_per_day,time_rules_json,account_scope_json,reuse_policy,min_interval_seconds,max_retries,consecutive_failure_threshold,start_date,end_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.name, input.brandId, input.enabled ? 1 : 0, input.strategy, input.articlesPerDay, json({ publishTimes: input.publishTimes }), json(input.accountIds), input.reusePolicy, input.minIntervalSeconds, input.maxRetries, input.consecutiveFailureThreshold, input.startDate, input.endDate, timestamp, timestamp);
    return this.listPlans().find((plan) => plan.id === id) as PublishPlan;
  }

  createJobsForPlan(planId: string, scheduledAt: string): PublishJob[] {
    const plan = this.listPlans().find((item) => item.id === planId);
    if (!plan) throw new Error("发布计划不存在");
    const accounts = this.listAccounts().filter((account) => plan.accountIds.includes(account.id) && account.enabled);
    const articles = this.listArticles({ brandId: plan.brandId, status: "available" });
    if (articles.length === 0) throw new Error("No available articles for publishing plan");
    const defaultPublishMode = this.getSettings().defaultPublishMode === "auto" ? "auto" : "manual";
    const platformIndexes = new Map<string, number>();
    const accountIndexes = new Map<string, number>();
    const articleFor = (account: Account, dayIndex: number): { article: Article; articleVariantId: string | null } => {
      const accountIndex = accountIndexes.get(account.id) ?? 0;
      accountIndexes.set(account.id, accountIndex + 1);
      const platformIndex = platformIndexes.get(account.platformKey) ?? 0;
      platformIndexes.set(account.platformKey, platformIndex + 1);
      const index = plan.strategy === "account_variant" ? accounts.indexOf(account) * Math.max(1, plan.articlesPerDay) + dayIndex : plan.strategy === "per_platform" ? platformIndex : dayIndex;
      const article = articles[index % articles.length] as Article;
      const articleVariantId = plan.strategy === "platform_variant" ? this.getArticleVariantForPlatform(article.id, account.platformKey)?.id ?? null : null;
      return { article, articleVariantId };
    };
    const jobs: PublishJob[] = [];
    const insert = this.db.prepare("INSERT INTO publish_jobs (id,plan_id,account_id,platform_account_id,platform_key,article_id,article_variant_id,scheduled_at,status,max_attempts,created_at,dry_run,manual_confirmation_required) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      for (const account of accounts) {
        for (let index = 0; index < Math.max(1, plan.articlesPerDay); index += 1) {
          const { article, articleVariantId } = articleFor(account, index);
      const existing = this.db.prepare("SELECT id FROM publish_jobs WHERE account_id=? AND article_id=? AND status NOT IN ('Failed','Cancelled','ReconciledNotPublished')").get(account.id, article.id) as Row | undefined;
          if (existing) continue;
          const id = randomUUID();
          const mode = account.publishMode === "inherit" ? defaultPublishMode : account.publishMode;
          const auto = mode === "auto";
          insert.run(id, plan.id, account.id, account.platformAccountId, account.platformKey, article.id, articleVariantId, scheduledAt, "Scheduled", plan.maxRetries, timestamp, auto ? 0 : 1, auto ? 0 : 1);
          jobs.push(this.getJob(id) as PublishJob);
        }
      }
    });
    transaction();
    return jobs;
  }

  createVideoPublishJob(input: {
    accountId: string;
    platformAccountId?: string;
    platformKey: string;
    articleId: string;
    videoAssetId: string;
    title: string;
    description?: string;
    tags?: string[];
    coverPath?: string;
    platformFields?: Record<string, Record<string, string>>;
    scheduledAt: string;
    dryRun?: boolean;
    manualConfirmationRequired?: boolean;
    maxAttempts?: number;
  }): PublishJob {
    if (!this.getVideoAsset(input.videoAssetId)) throw new Error("视频素材不存在");
    const active = this.db.prepare("SELECT id FROM publish_jobs WHERE account_id=? AND video_asset_id=? AND status NOT IN ('Failed','Cancelled','ReconciledNotPublished')").get(input.accountId, input.videoAssetId) as Row | undefined;
    if (active) return this.getJob(textValue(active.id)) as PublishJob;
    const id = randomUUID();
    this.db.prepare(`INSERT INTO publish_jobs (
      id,plan_id,account_id,platform_account_id,platform_key,article_id,article_variant_id,scheduled_at,status,max_attempts,created_at,
      dry_run,manual_confirmation_required,content_kind,video_asset_id,publish_payload_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, null, input.accountId, input.platformAccountId ?? input.accountId, input.platformKey, input.articleId, null, input.scheduledAt, "Scheduled",
      input.maxAttempts ?? 3, now(), input.dryRun === false ? 0 : 1,
      input.manualConfirmationRequired === false ? 0 : 1, "video", input.videoAssetId,
      json({ title: input.title, description: input.description ?? "", tags: input.tags ?? [], coverPath: input.coverPath, platformFields: input.platformFields ?? {} })
    );
    return this.getJob(id) as PublishJob;
  }

  createArticlePublishJob(input: { articleId: string; platformKey: string; platformAccountId: string; publishMode?: "ASSISTED" | "MANUAL"; finalPublishMode?: FinalPublishMode; selectedImageAssetId?: string | null; imageSelectionMode?: ImageSelectionMode }): PublishJob {
    const article = this.getArticle(input.articleId);
    if (!article) throw new Error("文章不存在");
    this.assertArticlePublishAllowed(article.id);
    const account = this.listAccounts().find((item) => item.platformAccountId === input.platformAccountId && item.platformKey === input.platformKey);
    if (!account) throw new Error("目标平台账号不存在");
    if (!account.enabled || account.loginStatus !== "logged_in") throw new Error("目标账号未连接，禁止创建发布任务");
    const requestedImageMode = input.imageSelectionMode ?? "none";
    let selectedImageAssetId = input.selectedImageAssetId ?? null;
    if (selectedImageAssetId) {
      const image = this.getImageAsset(selectedImageAssetId);
      if (!image || !image.enabled || (image.brandId && image.brandId !== article.brandId)) throw new Error("所选配图不可用或与文章品牌不匹配");
    }
    const existing = this.db.prepare("SELECT id FROM publish_jobs WHERE platform_account_id=? AND platform_key=? AND article_id=? AND status NOT IN ('Failed','Cancelled','ReconciledNotPublished') ORDER BY created_at DESC LIMIT 1").get(account.platformAccountId, input.platformKey, input.articleId) as Row | undefined;
    if (existing) return this.getJob(textValue(existing.id)) as PublishJob;
    if (requestedImageMode === "random" && !selectedImageAssetId) selectedImageAssetId = this.selectImageAssetForArticle(article.id, input.platformKey)?.id ?? null;
    if (selectedImageAssetId) this.markImageAssetUsed(selectedImageAssetId);
    const id = randomUUID();
    const timestamp = now();
    const finalPublishMode = input.finalPublishMode ?? (input.publishMode === "MANUAL" ? "PREPARE_ONLY" : "CONFIRM_BEFORE_PUBLISH");
    const platform = this.listPlatforms().find((item) => item.platformKey === input.platformKey);
    const apiAutoPublish = finalPublishMode === "AUTO_PUBLISH" && platform?.integrationMode === "API";
    this.db.prepare("INSERT INTO publish_jobs (id,plan_id,account_id,platform_account_id,platform_key,article_id,article_variant_id,scheduled_at,status,max_attempts,created_at,dry_run,manual_confirmation_required,selected_image_asset_id,image_selection_mode,final_publish_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, null, account.id, account.platformAccountId, input.platformKey, input.articleId, null, timestamp, apiAutoPublish ? "Scheduled" : "AwaitingConfirmation", 3, timestamp, 0, apiAutoPublish ? 0 : 1, selectedImageAssetId, requestedImageMode, finalPublishMode);
    return this.getJob(id) as PublishJob;
  }

  previewExcelArticleImport(input: {
    fileName: string;
    rows: ExcelArticleRowInput[];
    warnings?: string[];
    diagnostics?: ExcelImportDiagnostic[];
    selectedSheetName?: string | null;
    sheetCandidates?: ExcelImportSheetCandidate[];
    requiresSheetSelection?: boolean;
    defaultBrandId?: string | null;
  }): ExcelImportPreview {
    const brands = this.listBrands();
    const platforms = this.listPlatforms().filter((platform) => platform.enabled);
    const allowedContentTypes = new Set(["BrandPromotion", "SEOArticle", "GEOArticle", "Educational", "FAQ", "CaseStyle", "VideoScript", "科普", "推荐", "问答", "避坑", "案例", "服务介绍", "流程", "城市本地化"]);
    const allowedPromotion = new Set(["Soft", "Balanced", "Strong"]);
    const defaultBrand = input.defaultBrandId ? this.getBrand(input.defaultBrandId) : null;
    if (input.defaultBrandId && !defaultBrand) throw new Error("Excel 导入指定的默认企业不存在");
    const seenContentHashes = new Map<string, number>();
    const rows = input.rows.map((raw): ExcelImportPreviewRow => {
      const diagnosticCodes: ExcelImportDiagnosticCode[] = [];
      const errorCodes: string[] = [];
      const addError = (code: ExcelImportDiagnosticCode, legacyCode: string = code): void => {
        diagnosticCodes.push(code);
        errorCodes.push(legacyCode);
      };
      const title = raw.title.trim();
      const body = raw.body.trim();
      const normalizedTargetPlatforms = splitSemicolon(raw.targetPlatforms).map((value) => {
        const platform = platforms.find((item) => item.platformKey.toLowerCase() === value.toLowerCase() || item.displayName.toLowerCase() === value.toLowerCase());
        return platform?.platformKey ?? value;
      });
      if (raw.templateVersion && raw.templateVersion !== "1.0") addError("INVALID_TEMPLATE_VERSION");
      if (!title) addError("MISSING_TITLE", "TITLE_REQUIRED");
      if (!body) addError("MISSING_CONTENT", "BODY_REQUIRED");
      if (title.length > 200) addError("TITLE_TOO_LONG");
      if (body.length > 200000) addError("CONTENT_TOO_LONG", "BODY_TOO_LONG");
      const matchedBrand = brands.find((brand) => raw.company.trim() && (brand.name.trim().toLowerCase() === raw.company.trim().toLowerCase() || brand.companyName.trim().toLowerCase() === raw.company.trim().toLowerCase()))
        ?? (!raw.company.trim() ? defaultBrand ?? (brands.length === 1 ? brands[0] : undefined) : undefined);
      if (!matchedBrand) addError("UNKNOWN_BRAND");
      for (const platformKey of normalizedTargetPlatforms) if (!platforms.some((platform) => platform.platformKey === platformKey)) addError("INVALID_PLATFORM");
      if (raw.contentType.trim() && !allowedContentTypes.has(raw.contentType.trim())) addError("INVALID_CONTENT_TYPE");
      if (raw.promotionStrength.trim() && !allowedPromotion.has(raw.promotionStrength.trim())) addError("INVALID_PROMOTION_STRENGTH");
      const contentHash = excelContentHash(title, body);
      const duplicate = title && body ? this.db.prepare("SELECT id FROM articles WHERE content_fingerprint=? OR content_hash=? ORDER BY created_at LIMIT 1").get(contentHash, contentHash) as Row | undefined : undefined;
      const duplicateRowNumber = title && body ? seenContentHashes.get(contentHash) ?? null : null;
      if (title && body && !seenContentHashes.has(contentHash)) seenContentHashes.set(contentHash, raw.rowNumber);
      if (duplicate || duplicateRowNumber !== null) addError("DUPLICATE_CONTENT");
      const uniqueErrors = [...new Set(errorCodes)];
      const uniqueDiagnosticCodes = [...new Set(diagnosticCodes)];
      const blockingErrors = uniqueDiagnosticCodes.filter((code) => code !== "UNKNOWN_BRAND" && code !== "DUPLICATE_CONTENT");
      const status: ExcelImportPreviewRow["status"] = blockingErrors.length > 0 ? "INVALID" : !matchedBrand ? "UNKNOWN_BRAND" : duplicate || duplicateRowNumber !== null ? "DUPLICATE" : "VALID";
      const reasonMap: Record<ExcelImportDiagnosticCode, string> = { INVALID_TEMPLATE_VERSION: "模板版本不匹配", MISSING_TITLE: "标题为空", MISSING_CONTENT: "内容为空", TITLE_TOO_LONG: "标题超过 200 字符", CONTENT_TOO_LONG: "内容超过 200000 字符", UNKNOWN_BRAND: "企业未匹配到现有品牌", INVALID_PLATFORM: "目标平台不在已启用文章平台中", INVALID_CONTENT_TYPE: "内容类型不合法", INVALID_PROMOTION_STRENGTH: "推广程度不合法", DUPLICATE_CONTENT: duplicateRowNumber !== null ? `与本次工作簿第 ${duplicateRowNumber} 行重复` : "与已有文章重复", INVALID_HEADER: "第一行缺少标题或内容表头", UNSUPPORTED_WORKBOOK: "工作簿不受支持", UNKNOWN_COLUMN: "存在无法识别的列" };
      return { ...raw, title, body, contentHash, matchedBrandId: matchedBrand?.id ?? null, normalizedTargetPlatforms, status, diagnosticCodes: uniqueDiagnosticCodes, errorCodes: uniqueErrors, errorReason: [...new Set(uniqueDiagnosticCodes.map((code) => reasonMap[code]))].join("；"), duplicateArticleId: duplicate ? textValue(duplicate.id) : null, duplicateRowNumber };
    });
    const diagnostics = [...(input.diagnostics ?? [])];
    const rowErrors = new Set(rows.filter((row) => row.status === "INVALID" || row.status === "UNKNOWN_BRAND").map((row) => row.rowNumber));
    for (const diagnostic of diagnostics.filter((item) => item.severity === "ERROR")) rowErrors.add(diagnostic.rowNumber ?? 1);
    const warningRows = new Set(diagnostics.filter((item) => item.severity === "WARNING").map((item) => item.rowNumber ?? 1));
    return {
      fileName: input.fileName.replace(/[\\/]/gu, ""),
      templateVersion: rows.find((row) => row.templateVersion)?.templateVersion || "1.0",
      totalRows: rows.length,
      validRows: rows.filter((row) => row.status === "VALID" || row.status === "WARNING").length,
      errorRows: rowErrors.size,
      duplicateRows: rows.filter((row) => row.status === "DUPLICATE").length,
      warningRows: warningRows.size,
      warnings: [...new Set(input.warnings ?? [])],
      diagnostics,
      selectedSheetName: input.selectedSheetName ?? null,
      sheetCandidates: input.sheetCandidates ?? [],
      requiresSheetSelection: input.requiresSheetSelection ?? false,
      defaultBrandId: defaultBrand?.id ?? null,
      rows
    };
  }

  confirmExcelArticleImport(input: { preview: ExcelImportPreview; duplicateRowNumbers?: number[] }): ExcelImportResult {
    const importBatchId = randomUUID();
    const importedAt = now();
    const duplicateOverrides = new Set(input.duplicateRowNumbers ?? []);
    const articleIds: string[] = [];
    let skippedDuplicates = 0;
    let failed = 0;
    for (const row of input.preview.rows) {
      const brand = row.matchedBrandId ? this.getBrand(row.matchedBrandId) : null;
      const resolvedUnknownBrand = row.status === "UNKNOWN_BRAND" && Boolean(brand);
      if (row.status === "INVALID" || (!brand && !resolvedUnknownBrand)) { failed += 1; continue; }
      if (row.status === "DUPLICATE" && !duplicateOverrides.has(row.rowNumber)) { skippedDuplicates += 1; continue; }
      const contentHash = row.status === "DUPLICATE" ? `${row.contentHash}:${randomUUID()}` : row.contentHash;
      const created = this.createArticle({ brandId: brand?.id ?? row.matchedBrandId ?? "", topic: row.business.trim(), keyword: splitSemicolon(row.keywords)[0] ?? "", city: row.city.trim(), title: row.title.trim(), body: row.body.trim(), summary: row.summary.trim(), tags: splitSemicolon(row.tags), seoKeywords: splitSemicolon(row.keywords), articleType: row.contentType.trim() || "科普", aiProvider: "excel_import", aiModel: row.templateVersion || "1.0", generatedAt: importedAt, reusePolicy: "once", contentHash, qualityStatus: "unchecked", qualityWarnings: [], source: "excel_import", company: row.company.trim() || brand?.companyName || "", business: row.business.trim(), targetPlatforms: row.normalizedTargetPlatforms, promotionStrength: ["Soft", "Balanced", "Strong"].includes(row.promotionStrength.trim()) ? row.promotionStrength.trim() as PromotionStrength : null, sourceNote: row.sourceNote.trim(), importBatchId, importedAt, sourceFilename: input.preview.fileName.replace(/[\\/]/gu, ""), contentFingerprint: row.contentHash });
      if (!created) { failed += 1; continue; }
      articleIds.push(created.id);
    }
    return { importBatchId, imported: articleIds.length, skippedDuplicates, failed, articleIds };
  }

  private getArticleVariantForPlatform(articleId: string, platformKey: string): ArticleVariant | null {
    const row = this.db.prepare("SELECT * FROM article_variants WHERE article_id=? AND platform_key=?").get(articleId, platformKey) as Row | undefined;
    return row ? toArticleVariant(row) : null;
  }

  listJobs(filters: { status?: string } = {}): PublishJob[] {
    if (filters.status) return (this.db.prepare("SELECT * FROM publish_jobs WHERE status=? ORDER BY scheduled_at").all(filters.status) as Row[]).map(toJob);
    return (this.db.prepare("SELECT * FROM publish_jobs ORDER BY scheduled_at DESC").all() as Row[]).map(toJob);
  }

  /** Read-only counts used by bounded platform exploration evidence. */
  getPublishDomainCounts(): { publishJobs: number; submissionIntents: number; publishRecords: number } {
    const count = (table: "publish_jobs" | "submission_intents" | "publish_records"): number => {
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row;
      return intValue(row.count);
    };
    return { publishJobs: count("publish_jobs"), submissionIntents: count("submission_intents"), publishRecords: count("publish_records") };
  }

  listDueJobs(currentTime = new Date().toISOString(), limit = 50): PublishJob[] {
    const boundedLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    return (this.db.prepare("SELECT * FROM publish_jobs WHERE status IN ('Pending','Scheduled','Retry') AND scheduled_at <= ? AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY scheduled_at ASC, platform_key ASC, account_id ASC LIMIT ?").all(currentTime, currentTime, boundedLimit) as Row[]).map(toJob);
  }

  listPublishingJobs(limit = 50, polledBefore = new Date(Date.now() - 30_000).toISOString()): PublishJob[] {
    return (this.db.prepare("SELECT * FROM publish_jobs WHERE status='Publishing' AND (last_polled_at IS NULL OR last_polled_at <= ?) ORDER BY last_polled_at ASC NULLS FIRST, scheduled_at ASC LIMIT ?").all(polledBefore, Math.min(500, Math.max(1, limit))) as Row[]).map(toJob);
  }

  getJob(id: string): PublishJob | null { const row = this.db.prepare("SELECT * FROM publish_jobs WHERE id=?").get(id) as Row | undefined; return row ? toJob(row) : null; }
  getPublishPayload(id: string): Record<string, unknown> {
    const row = this.db.prepare("SELECT publish_payload_json FROM publish_jobs WHERE id=?").get(id) as Row | undefined;
    return parseJson<Record<string, unknown>>(row?.publish_payload_json, {});
  }

  confirmJob(id: string, dryRun = false): PublishJob {
    const job = this.getJob(id);
    if (!job) throw new Error("任务不存在");
    if (job.finalPublishMode === "PREPARE_ONLY" && !dryRun) throw new Error("该任务为只准备内容模式，不能执行最终发布；请重新创建发布任务并选择发布前确认或自动发布");
    const result = this.db.prepare("UPDATE publish_jobs SET dry_run=?, manual_confirmation_required=?, confirmed_at=?, status='Scheduled', next_retry_at=NULL WHERE id=? AND status IN ('Pending','Scheduled','Retry','NeedsUserAction','DryRunPassed','AwaitingConfirmation')").run(dryRun ? 1 : 0, dryRun ? 1 : 0, dryRun ? null : now(), id);
    if (result.changes === 0) throw new Error("任务当前不可确认");
    return this.getJob(id) as PublishJob;
  }

  claimJob(id: string): PublishJob {
    const timestamp = now();
    const result = this.db.prepare("UPDATE publish_jobs SET status='Preparing', attempt_count=attempt_count+1, started_at=?, finished_at=NULL WHERE id=? AND status IN ('Pending','Scheduled','Retry','NeedsUserAction')").run(timestamp, id);
    if (result.changes === 0) throw new Error("任务当前不可执行");
    return this.getJob(id) as PublishJob;
  }

  updateJobFailure(id: string, status: string, code: string, message: string, nextRetryAt: string | null): PublishJob {
    this.db.prepare("UPDATE publish_jobs SET status=?, last_error_code=?, last_error_message=?, next_retry_at=?, finished_at=? WHERE id=?").run(status, code, message, nextRetryAt, status === "Retry" ? null : now(), id);
    return this.getJob(id) as PublishJob;
  }

  markJobSuccess(id: string): PublishJob {
    this.db.prepare("UPDATE publish_jobs SET status='Success', finished_at=?, next_retry_at=NULL WHERE id=?").run(now(), id);
    return this.getJob(id) as PublishJob;
  }

  markJobPublishing(id: string, publishRecordId: string): PublishJob {
    this.db.prepare("UPDATE publish_jobs SET status='Publishing', publish_record_id=?, external_id=(SELECT published_external_id FROM publish_records WHERE id=?), last_polled_at=? WHERE id=?").run(publishRecordId, publishRecordId, now(), id);
    return this.getJob(id) as PublishJob;
  }

  markJobPolled(id: string): void { this.db.prepare("UPDATE publish_jobs SET last_polled_at=? WHERE id=?").run(now(), id); }

  recoverRunningJobs(): number {
    const timestamp = now();
    const recover = this.db.transaction(() => {
      const safe = this.db.prepare("UPDATE publish_jobs SET status='Retry', next_retry_at=?, finished_at=NULL WHERE status IN ('Running','Preparing','ReadyToSubmit')").run(timestamp).changes;
      const uncertain = this.db.prepare("UPDATE publish_jobs SET status='NeedsReconciliation', next_retry_at=NULL, finished_at=? WHERE status='Submitting'").run(timestamp).changes;
      this.db.prepare("UPDATE submission_intents SET state='Unknown', updated_at=? WHERE state IN ('Prepared','Submitting') AND job_id IN (SELECT id FROM publish_jobs WHERE status='NeedsReconciliation')").run(timestamp);
      return safe + uncertain;
    });
    return recover();
  }

  prepareSubmissionIntent(jobId: string): { id: string; job: PublishJob } {
    const job = this.getJob(jobId);
    if (!job) throw new Error("Publish job not found");
    const existing = this.getSubmissionIntentByJob(jobId);
    if (existing && ["Prepared", "Submitting", "Submitted", "Unknown"].includes(existing.state)) return { id: existing.id, job: this.getJob(jobId) as PublishJob };
    const id = randomUUID();
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO submission_intents (id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at) VALUES (?,?,?,?,?,?, 'Prepared',?,?)").run(id, job.id, job.accountId, job.articleId, job.platformKey, job.attemptCount, timestamp, timestamp);
      this.db.prepare("UPDATE publish_jobs SET status='Submitting', submission_intent_id=?, next_retry_at=NULL WHERE id=?").run(id, job.id);
    });
    transaction();
    return { id, job: this.getJob(jobId) as PublishJob };
  }

  getSubmissionIntentByJob(jobId: string): { id: string; jobId: string; state: string; externalId: string | null; attempt: number; finalSubmitCount: number; errorCode: string | null; updatedAt: string } | null {
    const row = this.db.prepare("SELECT id,job_id,state,external_id,attempt,final_submit_count,error_code,updated_at FROM submission_intents WHERE job_id=? ORDER BY created_at DESC LIMIT 1").get(jobId) as Row | undefined;
    if (!row) return null;
    return { id: textValue(row.id), jobId: textValue(row.job_id), state: textValue(row.state), externalId: typeof row.external_id === "string" ? row.external_id : null, attempt: intValue(row.attempt), finalSubmitCount: intValue(row.final_submit_count), errorCode: typeof row.error_code === "string" ? row.error_code : null, updatedAt: textValue(row.updated_at) };
  }

  listReusableOneShotPublicationAuthorizations(input: { platformKey: "xiaohongshu"; accountId: string; mode: "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE" }): OneShotPublicationAuthorization[] {
    const rows = this.db.prepare(`SELECT auth.* FROM one_shot_publication_authorizations auth
      INNER JOIN platform_self_test_runs run ON run.test_run_id=auth.operation_id
      WHERE auth.platform_key=? AND auth.account_id=? AND auth.mode=? AND auth.state='AUTHORIZED_UNUSED'
        AND auth.publication_transaction_count=0 AND auth.publication_commit_action_count=0
        AND auth.final_submit_attempt_count=0 AND auth.final_submit_retry_count=0
        AND auth.final_submit_action_started=0 AND auth.final_submit_action_completed=0
        AND run.platform_key=? AND run.platform_account_id=? AND run.publish_job_id IS NULL
      ORDER BY auth.created_at DESC, auth.operation_id DESC`).all(
      input.platformKey, input.accountId, input.mode, input.platformKey, input.accountId
    ) as Row[];
    return rows.map((row) => toOneShotPublicationAuthorization(row));
  }

  convergeUnusedOneShotAuthorization(input: { platformKey: "xiaohongshu"; accountId: string; mode: "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE" }): OneShotAuthorizationConvergenceResult {
    const transaction = this.db.transaction(() => {
      const candidates = this.listReusableOneShotPublicationAuthorizations(input);
      const winner = candidates[0] ?? null;
      if (!winner) return { reusableOperationId: null, supersededOperationIds: [], activeUnusedAuthorizationCount: 0, mutationCount: 0 } satisfies OneShotAuthorizationConvergenceResult;
      const supersededOperationIds: string[] = [];
      const update = this.db.prepare(`UPDATE one_shot_publication_authorizations SET state='SUPERSEDED_UNUSED', updated_at=?
        WHERE operation_id=? AND platform_key=? AND account_id=? AND mode=? AND state='AUTHORIZED_UNUSED'
          AND publication_transaction_count=0 AND publication_commit_action_count=0
          AND final_submit_attempt_count=0 AND final_submit_retry_count=0
          AND final_submit_action_started=0 AND final_submit_action_completed=0`);
      for (const candidate of candidates.slice(1)) {
        const result = update.run(now(), candidate.operationId, input.platformKey, input.accountId, input.mode);
        if (result.changes === 1) supersededOperationIds.push(candidate.operationId);
      }
      return { reusableOperationId: winner.operationId, supersededOperationIds, activeUnusedAuthorizationCount: 1, mutationCount: supersededOperationIds.length } satisfies OneShotAuthorizationConvergenceResult;
    });
    return transaction();
  }

  createOneShotPublicationAuthorization(authorization: OneShotPublicationAuthorization): OneShotPublicationAuthorization {
    const timestamp = now();
    this.db.prepare(`INSERT INTO one_shot_publication_authorizations (
      id,authorization,platform_key,account_id,operation_id,mode,state,publication_transaction_count,
      publication_commit_action_count,final_submit_attempt_count,final_submit_retry_count,
      final_submit_action_started,final_submit_action_completed,created_at,updated_at,consumed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      randomUUID(), authorization.authorization, authorization.platformKey, authorization.accountId, authorization.operationId,
      authorization.mode, authorization.state, authorization.publicationTransactionCount, authorization.publicationCommitActionCount,
      authorization.finalSubmitAttemptCount, authorization.finalSubmitRetryCount, authorization.finalSubmitActionStarted ? 1 : 0,
      authorization.finalSubmitActionCompleted ? 1 : 0, timestamp, timestamp, authorization.consumedAt ?? null
    );
    return this.getOneShotPublicationAuthorization(authorization.operationId) as OneShotPublicationAuthorization;
  }

  getOneShotPublicationAuthorization(operationId: string): OneShotPublicationAuthorization | null {
    const row = this.db.prepare("SELECT * FROM one_shot_publication_authorizations WHERE operation_id=?").get(operationId) as Row | undefined;
    if (!row) return null;
    return {
      authorization: textValue(row.authorization) as OneShotPublicationAuthorization["authorization"],
      state: textValue(row.state) as OneShotPublicationAuthorization["state"],
      platformKey: textValue(row.platform_key) as OneShotPublicationAuthorization["platformKey"],
      accountId: textValue(row.account_id) as OneShotPublicationAuthorization["accountId"],
      operationId: textValue(row.operation_id),
      mode: textValue(row.mode) as OneShotPublicationAuthorization["mode"],
      publicationTransactionCount: intValue(row.publication_transaction_count),
      publicationCommitActionCount: intValue(row.publication_commit_action_count),
      finalSubmitAttemptCount: intValue(row.final_submit_attempt_count),
      finalSubmitRetryCount: intValue(row.final_submit_retry_count),
      finalSubmitActionStarted: boolValue(row.final_submit_action_started),
      finalSubmitActionCompleted: boolValue(row.final_submit_action_completed),
      createdAt: textValue(row.created_at),
      updatedAt: textValue(row.updated_at),
      consumedAt: typeof row.consumed_at === "string" ? row.consumed_at : null
    };
  }

  consumeOneShotPublicationAuthorization(operationId: string, accountId: string, platformKey: string): boolean {
    const timestamp = now();
    const result = this.db.prepare(`UPDATE one_shot_publication_authorizations SET
      state='CONSUMED', publication_transaction_count=1, publication_commit_action_count=1,
      final_submit_attempt_count=1, final_submit_retry_count=0, final_submit_action_started=1,
      consumed_at=?, updated_at=? WHERE operation_id=? AND account_id=? AND platform_key=? AND authorization='OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH'
      AND mode='ONE_SHOT_REAL_PUBLISH_ACCEPTANCE' AND state='AUTHORIZED_UNUSED'
      AND publication_transaction_count=0 AND publication_commit_action_count=0
      AND final_submit_attempt_count=0 AND final_submit_retry_count=0`).run(timestamp, timestamp, operationId, accountId, platformKey);
    return result.changes === 1;
  }

  /**
   * Atomically claims the final submission intent together with the durable
   * one-shot authorization immediately before the only mousePressed dispatch.
   * A rollback leaves both records reusable when browser-side preparation
   * fails before that boundary.
   */
  startOneShotFinalMousePress(operationId: string, accountId: string, platformKey: string, intentId: string): boolean {
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      const authorization = this.db.prepare(`UPDATE one_shot_publication_authorizations SET
        state='FINAL_MOUSEPRESS_DISPATCH_STARTED', publication_transaction_count=1, publication_commit_action_count=1,
        final_submit_attempt_count=1, final_submit_retry_count=0, final_submit_action_started=1,
        consumed_at=?, updated_at=? WHERE operation_id=? AND account_id=? AND platform_key=?
        AND authorization='OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH' AND mode='ONE_SHOT_REAL_PUBLISH_ACCEPTANCE'
        AND state='AUTHORIZED_UNUSED' AND publication_transaction_count=0 AND publication_commit_action_count=0
        AND final_submit_attempt_count=0 AND final_submit_retry_count=0`).run(timestamp, timestamp, operationId, accountId, platformKey);
      if (authorization.changes !== 1) throw new Error("One-shot authorization was already used or is not available");
      const intent = this.db.prepare("UPDATE submission_intents SET final_submit_count=final_submit_count+1,state='Submitting',updated_at=? WHERE id=? AND state='Prepared' AND final_submit_count=0").run(timestamp, intentId);
      if (intent.changes !== 1) throw new Error("The persisted publish attempt has already been used or is not ready for final submit");
    });
    try {
      transaction();
      return true;
    } catch {
      return false;
    }
  }

  markOneShotFinalMousePressReconciliationRequired(operationId: string): boolean {
    const result = this.db.prepare("UPDATE one_shot_publication_authorizations SET state='SUBMIT_RECONCILIATION_REQUIRED', updated_at=? WHERE operation_id=? AND state='FINAL_MOUSEPRESS_DISPATCH_STARTED' AND final_submit_attempt_count=1").run(now(), operationId);
    return result.changes === 1;
  }

  recordOneShotPublicationConfirmationAction(operationId: string): boolean {
    const result = this.db.prepare(`UPDATE one_shot_publication_authorizations SET publication_commit_action_count=2, updated_at=?
      WHERE operation_id=? AND state IN ('CONSUMED','FINAL_MOUSEPRESS_DISPATCH_STARTED') AND publication_transaction_count=1
      AND final_submit_attempt_count=1 AND publication_commit_action_count=1`).run(now(), operationId);
    return result.changes === 1;
  }

  completeOneShotPublicationAuthorization(operationId: string): boolean {
    const result = this.db.prepare("UPDATE one_shot_publication_authorizations SET state=CASE WHEN state IN ('FINAL_MOUSEPRESS_DISPATCH_STARTED','SUBMIT_RECONCILIATION_REQUIRED') THEN 'COMPLETED' ELSE state END, final_submit_action_completed=1, updated_at=? WHERE operation_id=? AND state IN ('CONSUMED','FINAL_MOUSEPRESS_DISPATCH_STARTED','SUBMIT_RECONCILIATION_REQUIRED') AND final_submit_attempt_count=1").run(now(), operationId);
    return result.changes === 1;
  }

  claimFinalSubmitAttempt(intentId: string): { id: string; jobId: string; attempt: number } {
    const timestamp = now();
    const update = this.db.prepare("UPDATE submission_intents SET final_submit_count=final_submit_count+1,state='Submitting',updated_at=? WHERE id=? AND state='Prepared' AND final_submit_count=0").run(timestamp, intentId);
    if (update.changes === 0) throw Object.assign(new Error("The persisted publish attempt has already been used or is not ready for final submit"), { code: "FINAL_SUBMIT_ALREADY_USED" });
    const row = this.db.prepare("SELECT id,job_id,attempt FROM submission_intents WHERE id=?").get(intentId) as Row | undefined;
    if (!row) throw new Error("Submission intent not found");
    return { id: textValue(row.id), jobId: textValue(row.job_id), attempt: intValue(row.attempt) };
  }

  markSubmissionIntentSubmitted(intentId: string, externalId: string | null): void {
    this.db.prepare("UPDATE submission_intents SET state='Submitted', external_id=?, updated_at=? WHERE id=?").run(externalId, now(), intentId);
    // Keep the job recoverable until PublishRecord is persisted, even without an external id.
    this.db.prepare("UPDATE publish_jobs SET status='Submitted', external_id=? WHERE submission_intent_id=?").run(externalId, intentId);
  }

  reconcileJobAsSubmitted(jobId: string, input: { response: Record<string, unknown> }): { job: PublishJob; record: PublishRecord } {
    const job = this.getJob(jobId);
    if (!job || job.status !== "NeedsReconciliation") throw new Error("Only a NeedsReconciliation Job can be closed as an accepted submission");
    const intent = this.getSubmissionIntentByJob(jobId);
    if (!intent || intent.finalSubmitCount < 1) throw new Error("An accepted submission reconciliation requires a persisted final submit attempt");
    const existing = this.getPublishRecordByJob(jobId);
    if (!existing) throw new Error("An accepted submission reconciliation requires the existing PublishRecord");
    const timestamp = now();
    const response = { ...existing.response, reconciliation: input.response, reconciliationStatus: "PENDING_REVIEW" };
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE publish_records SET status='Submitted', success=0, response_json=?, verification_status='WaitingUser' WHERE id=?").run(json(response), existing.id);
      this.db.prepare("UPDATE submission_intents SET state='Submitted', error_code=NULL, updated_at=? WHERE id=?").run(timestamp, intent.id);
      this.db.prepare("UPDATE publish_jobs SET status='Submitted', external_id=NULL, publish_record_id=?, last_error_code=NULL, last_error_message=NULL, next_retry_at=NULL, finished_at=NULL WHERE id=? AND status='NeedsReconciliation'").run(existing.id, jobId);
    });
    transaction();
    return { job: this.getJob(jobId) as PublishJob, record: this.getPublishRecordByJob(jobId) as PublishRecord };
  }

  markSubmissionIntentUncertain(intentId: string, errorCode: string): PublishJob {
    this.db.prepare("UPDATE submission_intents SET state='Unknown', error_code=?, updated_at=? WHERE id=?").run(errorCode, now(), intentId);
    const row = this.db.prepare("SELECT job_id FROM submission_intents WHERE id=?").get(intentId) as Row | undefined;
    if (!row) throw new Error("Submission intent not found");
    this.db.prepare("UPDATE publish_jobs SET status='NeedsReconciliation', last_error_code=?, next_retry_at=NULL, finished_at=? WHERE id=?").run(errorCode, now(), textValue(row.job_id));
    return this.getJob(textValue(row.job_id)) as PublishJob;
  }

  resetSubmissionIntentForUserAction(intentId: string, errorCode: string): PublishJob {
    const timestamp = now();
    this.db.prepare("UPDATE submission_intents SET state='Prepared', final_submit_count=0, error_code=?, updated_at=? WHERE id=? AND ((state='Prepared' AND final_submit_count=0) OR (state='Submitting' AND final_submit_count=1) OR (state='Unknown' AND final_submit_count=1 AND error_code='FINAL_SUBMIT_ALREADY_USED'))").run(errorCode, timestamp, intentId);
    const row = this.db.prepare("SELECT job_id FROM submission_intents WHERE id=?").get(intentId) as Row | undefined;
    if (!row) throw new Error("Submission intent not found");
    this.db.prepare("UPDATE publish_jobs SET status='NeedsUserAction', last_error_code=?, last_error_message=?, next_retry_at=NULL, finished_at=? WHERE id=?").run(errorCode, errorCode === "USER_ACTION_REQUIRED" ? "平台最终提交前仍需要用户完成字段或安全验证" : errorCode, timestamp, textValue(row.job_id));
    return this.getJob(textValue(row.job_id)) as PublishJob;
  }

  resetSubmissionIntentAfterPreviewOnly(intentId: string, errorCode: string): PublishJob {
    const timestamp = now();
    this.db.prepare("UPDATE submission_intents SET state='Prepared', final_submit_count=0, error_code=?, updated_at=? WHERE id=? AND state='Unknown' AND final_submit_count=1 AND error_code='SUBMISSION_UNCERTAIN'").run(errorCode, timestamp, intentId);
    const row = this.db.prepare("SELECT job_id FROM submission_intents WHERE id=?").get(intentId) as Row | undefined;
    if (!row) throw new Error("Submission intent not found");
    this.db.prepare("UPDATE publish_jobs SET status='NeedsUserAction', last_error_code=?, last_error_message=?, next_retry_at=NULL, finished_at=? WHERE id=?").run(errorCode, errorCode, timestamp, textValue(row.job_id));
    return this.getJob(textValue(row.job_id)) as PublishJob;
  }

  markJobDryRunPassed(id: string): PublishJob {
    this.db.prepare("UPDATE publish_jobs SET status='AwaitingConfirmation', finished_at=?, next_retry_at=NULL WHERE id=?").run(now(), id);
    return this.getJob(id) as PublishJob;
  }

  markJobReconciledNotSubmitted(id: string): PublishJob {
    const intent = this.getSubmissionIntentByJob(id);
    if (intent) this.db.prepare("UPDATE submission_intents SET state='NotSubmitted', updated_at=? WHERE id=?").run(now(), intent.id);
    this.db.prepare("UPDATE publish_jobs SET status='Retry', next_retry_at=?, last_error_code=NULL, last_error_message=NULL, finished_at=NULL WHERE id=?").run(now(), id);
    return this.getJob(id) as PublishJob;
  }

  getPublishRecords(articleId?: string): PublishRecord[] {
    const rows = articleId ? this.db.prepare("SELECT * FROM publish_records WHERE article_id=? ORDER BY published_at DESC").all(articleId) : this.db.prepare("SELECT * FROM publish_records ORDER BY published_at DESC").all();
    return (rows as Row[]).map(toRecord);
  }

  insertPublishRecord(input: Omit<PublishRecord, "id" | "publishedAt" | "dryRun" | "status"> & { dryRun?: boolean; status?: PublishRecord["status"] }): PublishRecord {
    const dryRun = input.dryRun ?? false;
    const record: PublishRecord = { ...input, platformAccountId: input.platformAccountId ?? input.accountId, status: input.status ?? (dryRun ? "DryRun" : input.success ? "Published" : "Failed"), dryRun, id: randomUUID(), publishedAt: now(), publishMode: input.publishMode ?? (dryRun ? "ASSISTED" : "MANUAL"), automationType: input.automationType ?? "Manual", browserSessionIdHash: input.browserSessionIdHash ?? null, operator: input.operator ?? "desktop-user", verificationStatus: input.verificationStatus ?? (dryRun ? "WaitingUser" : input.success ? "Verified" : "Failed"), editorOpenedAt: input.editorOpenedAt ?? null, titleFilled: input.titleFilled ?? null, bodyFilled: input.bodyFilled ?? null, selectedImageAssetId: input.selectedImageAssetId ?? null, imageSelectionMode: input.imageSelectionMode ?? "none" };
    this.db.prepare("INSERT INTO publish_records (id,job_id,account_id,platform_account_id,platform_key,article_id,published_url,published_external_id,success,response_json,published_at,dry_run,status,publish_mode,automation_type,browser_session_id_hash,operator,verification_status,editor_opened_at,title_filled,body_filled,selected_image_asset_id,image_selection_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(record.id, record.jobId, record.accountId, record.platformAccountId, record.platformKey, record.articleId, record.publishedUrl, record.publishedExternalId, record.success ? 1 : 0, json(record.response), record.publishedAt, record.dryRun ? 1 : 0, record.status, record.publishMode, record.automationType, record.browserSessionIdHash, record.operator, record.verificationStatus, record.editorOpenedAt, record.titleFilled === null || record.titleFilled === undefined ? null : record.titleFilled ? 1 : 0, record.bodyFilled === null || record.bodyFilled === undefined ? null : record.bodyFilled ? 1 : 0, record.selectedImageAssetId, record.imageSelectionMode);
    return record;
  }

  getPublishRecordByJob(jobId: string): PublishRecord | null {
    const row = this.db.prepare("SELECT * FROM publish_records WHERE job_id=? ORDER BY published_at DESC LIMIT 1").get(jobId) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  updatePublishRecord(id: string, input: { status: PublishRecord["status"]; success: boolean; publishedUrl?: string | null; publishedExternalId?: string | null; response?: Record<string, unknown>; verificationStatus?: PublishRecord["verificationStatus"] }): PublishRecord {
    this.db.prepare("UPDATE publish_records SET status=?,success=?,published_url=COALESCE(?,published_url),published_external_id=COALESCE(?,published_external_id),response_json=?,verification_status=COALESCE(?,verification_status) WHERE id=?").run(input.status, input.success ? 1 : 0, input.publishedUrl ?? null, input.publishedExternalId ?? null, json(input.response ?? {}), input.verificationStatus ?? null, id);
    const row = this.db.prepare("SELECT * FROM publish_records WHERE id=?").get(id) as Row;
    return toRecord(row);
  }

  reconcileJobAsPublished(jobId: string, input: { externalId: string; publishedUrl: string; response: Record<string, unknown> }): { job: PublishJob; record: PublishRecord } {
    const job = this.getJob(jobId);
    if (!job || !["NeedsReconciliation", "Submitted"].includes(job.status)) throw new Error("Only a NeedsReconciliation or Submitted Job can be closed by read-only publish reconciliation");
    const existing = this.getPublishRecordByJob(jobId);
    const record = existing
      ? this.updatePublishRecord(existing.id, { status: "Published", success: true, publishedExternalId: input.externalId, publishedUrl: input.publishedUrl, response: input.response, verificationStatus: "Verified" })
      : this.insertPublishRecord({ jobId, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: input.publishedUrl, publishedExternalId: input.externalId, success: true, response: input.response, dryRun: false, status: "Published", publishMode: "ASSISTED", automationType: "BrowserAutomation", operator: "desktop-user", verificationStatus: "Verified" });
    const intent = this.getSubmissionIntentByJob(jobId);
    if (intent) this.db.prepare("UPDATE submission_intents SET state='Submitted',external_id=?,updated_at=? WHERE id=?").run(input.externalId, now(), intent.id);
    this.db.prepare("UPDATE publish_jobs SET status='Success',external_id=?,last_error_code=NULL,last_error_message=NULL,next_retry_at=NULL,finished_at=? WHERE id=?").run(input.externalId, now(), jobId);
    if (!existing?.success) {
      this.markArticlePublished(job.articleId);
      this.markAccountPublished(job.accountId);
    }
    return { job: this.getJob(jobId) as PublishJob, record };
  }

  markJobReconciledNotPublished(id: string, message: string, response: Record<string, unknown> = {}): PublishJob {
    const intent = this.getSubmissionIntentByJob(id);
    if (intent) this.db.prepare("UPDATE submission_intents SET state='NotSubmitted',error_code='CONFIRMED_NOT_PUBLISHED',updated_at=? WHERE id=?").run(now(), intent.id);
    const existing = this.getPublishRecordByJob(id);
    if (existing) this.updatePublishRecord(existing.id, { status: "Failed", success: false, response: { ...existing.response, reconciliation: response, reconciliationStatus: "CONFIRMED_NOT_PUBLISHED" }, verificationStatus: "Failed" });
    this.db.prepare("UPDATE publish_jobs SET status='ReconciledNotPublished',last_error_code='CONFIRMED_NOT_PUBLISHED',last_error_message=?,next_retry_at=NULL,finished_at=? WHERE id=? AND status='NeedsReconciliation'").run(message, now(), id);
    return this.getJob(id) as PublishJob;
  }

  markJobConfirmedNotPublished(id: string, message: string): PublishJob {
    return this.markJobReconciledNotPublished(id, message);
  }

  markArticlePublished(articleId: string): void { this.db.prepare("UPDATE articles SET publish_count=publish_count+1, use_count=use_count+1, status='partially_published', updated_at=? WHERE id=?").run(now(), articleId); }
  markAccountPublished(accountId: string): void { this.db.prepare("UPDATE accounts SET today_publish_count=today_publish_count+1, last_publish_at=?, failed_count=0, updated_at=? WHERE id=?").run(now(), now(), accountId); }

  recordAccountFailure(accountId: string, pauseThreshold: number, reason: string): Account {
    const current = this.listAccounts().find((item) => item.id === accountId);
    if (!current) throw new Error("账号不存在");
    const failedCount = current.failedCount + 1;
    const paused = failedCount >= pauseThreshold;
    return this.updateAccount(accountId, { enabled: paused ? false : current.enabled, failedCount, pausedReason: paused ? reason : current.pausedReason, loginStatus: paused ? "expired" : current.loginStatus });
  }

  createNotification(input: Omit<Notification, "id" | "createdAt" | "read"> & { read?: boolean }): Notification {
    const item: Notification = { ...input, id: randomUUID(), read: input.read ?? false, createdAt: now() };
    this.db.prepare("INSERT INTO notifications (id,level,title,message,related_id,read,created_at) VALUES (?,?,?,?,?,?,?)").run(item.id, item.level, item.title, item.message, item.relatedId, item.read ? 1 : 0, item.createdAt);
    return item;
  }

  listNotifications(limit = 50): Notification[] { return (this.db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(toNotification); }
  markNotificationRead(id: string): void { this.db.prepare("UPDATE notifications SET read=1 WHERE id=?").run(id); }
  markAllNotificationsRead(): void { this.db.prepare("UPDATE notifications SET read=1 WHERE read=0").run(); }

  updatePlatformHealth(platformKey: string, status: "unknown" | "healthy" | "degraded" | "paused", errorCode: string | null = null, errorMessage: string | null = null): void {
    const current = this.db.prepare("SELECT consecutive_failures FROM platform_health WHERE platform_key=?").get(platformKey) as Row | undefined;
    const failures = status === "healthy" ? 0 : intValue(current?.consecutive_failures) + 1;
    this.db.prepare("INSERT INTO platform_health (platform_key,status,consecutive_failures,last_error_code,last_error_message,checked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(platform_key) DO UPDATE SET status=excluded.status, consecutive_failures=excluded.consecutive_failures, last_error_code=excluded.last_error_code, last_error_message=excluded.last_error_message, checked_at=excluded.checked_at").run(platformKey, status, failures, errorCode, errorMessage, now());
    this.db.prepare("UPDATE platforms SET health_status=? WHERE platform_key=?").run(status, platformKey);
  }

  getPlatformConsecutiveFailures(platformKey: string): number {
    const row = this.db.prepare("SELECT consecutive_failures FROM platform_health WHERE platform_key=?").get(platformKey) as Row | undefined;
    return intValue(row?.consecutive_failures);
  }

  dashboardStats(): DashboardStats {
    const count = (sql: string, ...values: SqlValue[]): number => intValue((this.db.prepare(sql).get(...values) as Row).count);
    const publishedToday = count("SELECT COUNT(*) count FROM publish_records WHERE success=1 AND dry_run=0 AND published_at >= date('now')");
    const productionSource = articleSourceWhere("production").sql;
    const benchmarkSource = articleSourceWhere("benchmark").sql;
    const availableArticles = count(`SELECT COUNT(*) count FROM articles a WHERE a.status IN ('available','partially_published') AND ${productionSource}`);
    const benchmarkArticles = count(`SELECT COUNT(*) count FROM articles a WHERE ${benchmarkSource}`);
    const aiUsage = this.aiUsageStats();
    return { publishedToday, pendingJobs: count("SELECT COUNT(*) count FROM publish_jobs WHERE status IN ('Pending','Scheduled','Retry')"), failedJobs: count("SELECT COUNT(*) count FROM publish_jobs WHERE status='Failed'"), runningJobs: count("SELECT COUNT(*) count FROM publish_jobs WHERE status IN ('Running','Preparing','Submitting','Publishing')"), totalAccounts: count("SELECT COUNT(*) count FROM accounts WHERE archived_at IS NULL"), onlineAccounts: count("SELECT COUNT(*) count FROM accounts WHERE archived_at IS NULL AND login_status='logged_in' AND enabled=1"), expiredAccounts: count("SELECT COUNT(*) count FROM accounts WHERE archived_at IS NULL AND login_status IN ('expired','logged_out')"), availableArticles, generatedToday: count(`SELECT COUNT(*) count FROM articles a WHERE a.generated_at >= date('now') AND ${productionSource}`), estimatedStockDays: availableArticles > 0 ? Math.max(1, Math.round(availableArticles / Math.max(1, count("SELECT COUNT(*) count FROM accounts WHERE archived_at IS NULL AND enabled=1")))) : 0, activeAiTasks: count("SELECT COUNT(*) count FROM ai_tasks WHERE status IN ('pending','running')") + count("SELECT COUNT(*) count FROM content_studio_tasks WHERE status IN ('pending','running')"), benchmarkArticles, productionArticles: availableArticles, ...aiUsage };
  }

  aiUsageStats(): { aiGeneratedToday: number; aiInputTokensToday: number; aiOutputTokensToday: number; aiEstimatedCostToday: number | null } {
    const rows = [...this.db.prepare("SELECT usage_json FROM ai_tasks WHERE created_at >= date('now')").all(), ...this.db.prepare("SELECT usage_json FROM content_studio_tasks WHERE created_at >= date('now')").all()] as Row[];
    let aiInputTokensToday = 0; let aiOutputTokensToday = 0; let estimatedCost = 0; let hasCost = false;
    for (const row of rows) { const usage = parseJson<AIUsage>(row.usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }); aiInputTokensToday += usage.promptTokens; aiOutputTokensToday += usage.completionTokens; if (typeof usage.estimatedCost === "number") { estimatedCost += usage.estimatedCost; hasCost = true; } }
    return { aiGeneratedToday: intValue((this.db.prepare(`SELECT COUNT(*) count FROM articles a WHERE a.generated_at >= date('now') AND ${articleSourceWhere("production").sql}`).get() as Row).count), aiInputTokensToday, aiOutputTokensToday, aiEstimatedCostToday: hasCost ? estimatedCost : null };
  }

  createAiTask(input: { brandId: string; type: string; provider: string; model: string; totalCount: number; payload: Record<string, unknown> }): string {
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare("INSERT INTO ai_tasks (id,brand_id,type,input_json,provider,model,status,total_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, input.brandId, input.type, json(input.payload), input.provider, input.model, "running", input.totalCount, timestamp, timestamp);
    return id;
  }

  createAiBatch(input: { taskId: string; brandId: string; concurrency: number; targets: AIBatchTarget[] }): string {
    const id = randomUUID();
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO ai_batches (id,task_id,brand_id,total_count,concurrency,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, input.taskId, input.brandId, input.targets.length, Math.max(1, Math.min(20, input.concurrency)), "running", timestamp, timestamp);
      const insert = this.db.prepare("INSERT INTO ai_batch_items (id,batch_id,keyword_id,city,keyword,article_type,target_index,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
      for (const target of input.targets) insert.run(randomUUID(), id, target.keywordId ?? null, target.city, target.keyword, target.articleType, target.targetIndex, "Pending", timestamp);
      this.db.prepare("UPDATE ai_tasks SET batch_id=?, status='running', updated_at=? WHERE id=?").run(id, timestamp, input.taskId);
    });
    transaction();
    return id;
  }

  listAiBatchItems(batchId: string): AIBatchItem[] {
    return (this.db.prepare("SELECT * FROM ai_batch_items WHERE batch_id=? ORDER BY target_index").all(batchId) as Row[]).map(toAiBatchItem);
  }

  claimNextAiBatchItem(batchId: string): AIBatchItem | null {
    const claim = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM ai_batch_items WHERE batch_id=? AND status IN ('Pending','Retry') ORDER BY target_index LIMIT 1").get(batchId) as Row | undefined;
      if (!row) return null;
      const result = this.db.prepare("UPDATE ai_batch_items SET status='Running', attempt_count=attempt_count+1, started_at=?, last_error=NULL WHERE id=? AND status IN ('Pending','Retry')").run(now(), textValue(row.id));
      return result.changes === 1 ? toAiBatchItem(this.db.prepare("SELECT * FROM ai_batch_items WHERE id=?").get(textValue(row.id)) as Row) : null;
    });
    return claim();
  }

  completeAiBatchItem(itemId: string, articleId: string): void {
    this.db.prepare("UPDATE ai_batch_items SET status='Completed', article_id=?, last_error=NULL, completed_at=? WHERE id=? AND status='Running'").run(articleId, now(), itemId);
  }

  failAiBatchItem(itemId: string, message: string, retryable: boolean): void {
    const row = this.db.prepare("SELECT attempt_count FROM ai_batch_items WHERE id=?").get(itemId) as Row | undefined;
    const retry = retryable && intValue(row?.attempt_count) < 3;
    this.db.prepare("UPDATE ai_batch_items SET status=?, last_error=?, completed_at=? WHERE id=? AND status='Running'").run(retry ? "Retry" : "Failed", message, retry ? null : now(), itemId);
  }

  cancelAiBatchItems(batchId: string): void {
    this.db.prepare("UPDATE ai_batch_items SET status='Cancelled', completed_at=? WHERE batch_id=? AND status IN ('Pending','Retry')").run(now(), batchId);
  }

  recoverAiBatchItems(): number {
    return this.db.prepare("UPDATE ai_batch_items SET status='Retry', last_error=COALESCE(last_error,'worker interrupted'), started_at=NULL WHERE status='Running'").run().changes;
  }

  refreshAiTaskFromBatch(taskId: string, usage?: AIUsage, durationMs = 0, errorMessage?: string): NonNullable<ReturnType<AppRepository["getAiTask"]>> {
    const task = this.getAiTask(taskId);
    if (!task?.batchId) throw new Error("AI batch not found");
    const counts = this.db.prepare("SELECT COUNT(*) AS total, SUM(status='Completed') AS completed, SUM(status='Failed') AS failed, SUM(status='Cancelled') AS cancelled, SUM(status IN ('Pending','Running','Retry')) AS active FROM ai_batch_items WHERE batch_id=?").get(task.batchId) as Row;
    const completed = intValue(counts.completed);
    const failed = intValue(counts.failed);
    const cancelled = intValue(counts.cancelled);
    const active = intValue(counts.active);
    const status = task.cancelRequested ? "cancelled" : active > 0 ? "running" : failed > 0 && completed === 0 ? "failed" : "completed";
    this.db.prepare("UPDATE ai_tasks SET completed_count=?,success_count=?,failed_count=?,status=?,error_message=?,usage_json=COALESCE(?,usage_json),duration_ms=?,updated_at=?,finished_at=? WHERE id=?").run(completed + failed + cancelled, completed, failed, status, errorMessage ?? null, usage ? json(usage) : null, durationMs, now(), active === 0 || task.cancelRequested ? now() : null, taskId);
    this.db.prepare("UPDATE ai_batches SET status=?,updated_at=?,finished_at=? WHERE id=?").run(status, now(), active === 0 || task.cancelRequested ? now() : null, task.batchId);
    return this.getAiTask(taskId) as NonNullable<ReturnType<AppRepository["getAiTask"]>>;
  }
  updateAiTask(id: string, input: { completed: number; success: number; failed: number; status: string; errorMessage?: string; usage?: AIUsage; durationMs?: number; nextIndex?: number }): void { const timestamp = now(); this.db.prepare("UPDATE ai_tasks SET completed_count=?, success_count=?, failed_count=?, next_index=COALESCE(?,next_index), status=?, error_message=?, usage_json=?, duration_ms=?, updated_at=?, finished_at=? WHERE id=?").run(input.completed, input.success, input.failed, input.nextIndex ?? null, input.status, input.errorMessage ?? null, json(input.usage ?? {}), input.durationMs ?? 0, timestamp, input.status === "completed" || input.status === "failed" || input.status === "cancelled" ? timestamp : null, id); }

  listLogs(limit = 100, filters: { level?: string; module?: string; search?: string } = {}): ActivityLog[] {
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    if (filters.level) { clauses.push("level=?"); values.push(filters.level); }
    if (filters.module) { clauses.push("module=?"); values.push(filters.module); }
    if (filters.search) { clauses.push("(message LIKE ? OR code LIKE ? OR context_json LIKE ?)"); values.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (this.db.prepare(`SELECT * FROM app_logs ${where} ORDER BY created_at DESC LIMIT ?`).all(...values, Math.min(1000, Math.max(1, limit))) as Row[]).map(toLog);
  }
  insertLog(input: Omit<ActivityLog, "id" | "timestamp"> & { timestamp?: string }): void { this.db.prepare("INSERT INTO app_logs (id,level,module,code,message,context_json,created_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), input.level, input.module, input.code, sanitizeLogValue(input.message), json(sanitizeLogValue(input.context)), input.timestamp ?? now()); }

  seedDevelopment(csvPath: string): void {
    const transaction = this.db.transaction(() => {
      this.seedPlatforms(csvPath, true);
      this.seedPlatformProfiles();
      if (this.listBrands().length === 0) {
        const brand = this.createBrand({ name: "康一环保", companyName: "江苏康一环保科技有限公司", description: "提供本地化环保治理服务的示例品牌，内容生成仅使用已录入资料。", mainBusiness: "甲醛检测与治理、室内空气质量服务", serviceRegions: ["江苏"], advantages: ["本地服务流程清晰", "支持现场评估"], contact: { phone: "待填写", email: "待填写" }, serviceProcess: "需求沟通 → 现场评估 → 方案确认 → 服务实施 → 售后反馈", afterSales: "以双方确认的服务约定为准", faq: "服务前需要准备哪些信息？可先提供房屋类型、面积和问题描述。", aiForbiddenClaims: ["禁止虚构不存在的资质证书", "禁止写行业第一或绝对化排名", "禁止虚构客户名称、检测数据和专利"] });
        const templates = ["{城市}甲醛治理哪家好", "{城市}除甲醛公司推荐", "{城市}专业除甲醛公司", "{城市}新房除甲醛多少钱", "{城市}办公室甲醛治理", "{城市}甲醛检测机构", "{城市}甲醛治理公司怎么选", "{城市}新房甲醛治理流程"];
        for (const template of templates) this.createKeywordTemplate({ brandId: brand.id, template, category: "本地服务" });
      }
      const testPlatform = this.db.prepare("SELECT platform_key FROM platforms WHERE platform_key='test'").get() as Row | undefined;
      if (testPlatform) {
        const count = intValue((this.db.prepare("SELECT COUNT(*) count FROM accounts WHERE platform_key='test'").get() as Row).count);
        for (let index = count; index < 3; index += 1) this.createAccount({ platformKey: "test", name: `测试账号${String(index + 1).padStart(2, "0")}` });
      }
    });
    transaction();
  }

  seedPlatformCatalog(csvPath: string): void {
    const transaction = this.db.transaction(() => {
      this.seedPlatforms(csvPath, false);
      this.seedPlatformProfiles();
    });
    transaction();
  }

  private seedPlatforms(csvPath: string, includeTest: boolean): void {
    const fallback = [{ key: "test", name: "TestPlatform", category: "测试", target: "ready", researchStatus: "verified", lifecycleStatus: "Stable", transport: "manual", integrationMode: "Manual", officialWebsite: "test://platform", blockingReason: "", lastVerifiedAt: "2026-08-20" }];
    const lines = existsSync(csvPath) ? readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean).slice(1) : [];
    const parsed = lines.map((line) => line.split(",")).filter((parts) => parts.length >= 3).map((parts) => ({
      key: parts[0].replace(/^\uFEFF/, ""), name: parts[1], category: parts[2], target: "not_implemented",
      researchStatus: parts[5] || "unverified", lifecycleStatus: parts[6] || "NotImplemented", transport: parts[7] || "manual", integrationMode: parts[11] || inferIntegrationMode(parts[7] || "manual"),
      officialWebsite: parts[8] || "", blockingReason: parts[9] || "", lastVerifiedAt: parts[10] || null
    }));
    const platforms = includeTest ? [...parsed, ...fallback] : parsed;
    const insert = this.db.prepare("INSERT OR IGNORE INTO platforms (id,platform_key,display_name,category,adapter_status,adapter_version,enabled,capabilities_json,research_status,verification_status,transport,integration_mode,official_website,blocking_reason,last_verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const refresh = this.db.prepare("UPDATE platforms SET display_name=?,category=?,research_status=?,verification_status=?,transport=?,integration_mode=?,official_website=?,blocking_reason=?,last_verified_at=? WHERE platform_key=? AND adapter_status='not_implemented'");
    for (const platform of platforms) {
      insert.run(randomUUID(), platform.key, platform.name, platform.category, platform.key === "test" ? "ready" : "not_implemented", "0.1.0", 1, json(platform.key === "test" ? { article: true, coverImage: true, scheduledPublish: true } : { article: false }), platform.researchStatus, platform.lifecycleStatus, platform.transport, platform.integrationMode, platform.officialWebsite, platform.blockingReason || null, platform.lastVerifiedAt);
      refresh.run(platform.name, platform.category, platform.researchStatus, platform.lifecycleStatus, platform.transport, platform.integrationMode, platform.officialWebsite, platform.blockingReason || null, platform.lastVerifiedAt, platform.key);
    }
  }

  private seedPlatformProfiles(): void {
    const platforms = this.db.prepare("SELECT platform_key FROM platforms").all() as Row[];
    const insert = this.db.prepare("INSERT OR IGNORE INTO platform_profiles (platform_key,style,title_limit,preferred_min_words,preferred_max_words,supports_cover,supports_tags,supports_markdown,supports_rich_text,source_url,research_status,last_verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const health = this.db.prepare("INSERT OR IGNORE INTO platform_health (platform_key,status) VALUES (?, 'unknown')");
    for (const row of platforms) {
      const key = textValue(row.platform_key);
      const official = key === "wechat_official";
      insert.run(key, official ? "微信公众号图文：信息密度适中、段落清晰、适合富文本" : "待官方规则确认", official ? 64 : 100, 300, 2000, official ? 1 : 0, official ? 1 : 0, 0, official ? 1 : 0, official ? "https://developers.weixin.qq.com/doc/offiaccount/" : "", official ? "partial" : "unverified", official ? "2026-08-19" : null);
      health.run(key);
    }
    this.db.prepare("UPDATE platforms SET verification_status='Stable' WHERE platform_key='test'").run();
  }
}

function toContentStudioTask(row: Row): ContentStudioTaskView {
  return {
    id: textValue(row.id),
    parentTaskId: typeof row.parent_task_id === "string" ? row.parent_task_id : null,
    rootTaskId: textValue(row.root_task_id) || textValue(row.id),
    brandId: textValue(row.brand_id),
    type: textValue(row.type),
    payload: parseJson<ContentStudioTaskPayload>(row.input_json, { brandId: textValue(row.brand_id), industry: "", cities: [], keywords: [], targetPlatforms: [], mediaAssetIds: [], videoAssetIds: [] }),
    output: parseJson<{ topicPlan?: ContentStudioTopicPlan; sourceArticleId?: string; structuredDiagnostics?: Array<Record<string, unknown>>; knowledgeSnapshot?: KnowledgeSnapshot; promptVersion?: string; contentIntent?: ContentIntent; searchIntent?: SearchIntent; brandDifferentiationByPlatform?: Record<string, BrandDifferentiationMetrics>; providerDiagnostics?: Record<string, unknown> }>(row.output_json, {}),
    provider: textValue(row.provider),
    model: textValue(row.model),
    status: textValue(row.status),
    total: intValue(row.total_count),
    completed: intValue(row.completed_count),
    success: intValue(row.success_count),
    failed: intValue(row.failed_count),
    errorMessage: typeof row.error_message === "string" ? row.error_message : null,
    usage: parseJson<AIUsage>(row.usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    durationMs: intValue(row.duration_ms),
    sourceArticleId: typeof row.source_article_id === "string" ? row.source_article_id : null,
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : null
  };
}
function toContentStudioVersion(row: Row): ContentStudioVersionView {
  return {
    id: textValue(row.id),
    taskId: textValue(row.task_id),
    rootTaskId: textValue(row.root_task_id),
    platformKey: textValue(row.platform_key) as ContentStudioPlatformKey,
    contentType: textValue(row.content_type) === "video_script" ? "video_script" : "article",
    title: textValue(row.title),
    body: textValue(row.body),
    summary: textValue(row.summary),
    tags: stringArray(row.tags_json),
    seoKeywords: stringArray(row.seo_keywords_json),
    tone: textValue(row.tone),
    structure: stringArray(row.structure_json),
    keywordLayout: parseJson<ContentStudioContent["keywordLayout"]>(row.keyword_layout_json, { primary: "", secondary: [], placements: [] }),
    mediaAssetIds: stringArray(row.media_asset_ids_json),
    videoAssetIds: stringArray(row.video_asset_ids_json),
    sourceArticleId: typeof row.source_article_id === "string" ? row.source_article_id : null,
    articleVariantId: typeof row.article_variant_id === "string" ? row.article_variant_id : null,
    provider: textValue(row.provider),
    model: textValue(row.model),
    usage: parseJson<AIUsage>(row.usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    isCurrent: boolValue(row.is_current),
    qualityStatus: ["Draft", "AI_Checked", "Needs_Review", "Approved", "Rejected"].includes(textValue(row.quality_status)) ? textValue(row.quality_status) as ContentQualityStatus : "Draft",
    qualityReviewId: typeof row.quality_review_id === "string" ? row.quality_review_id : null,
    versionNumber: intValue(row.version_number),
    createdAt: textValue(row.created_at)
  };
}
function toQualityBenchmarkRun(row: Row): QualityBenchmarkRunView {
  const runTypes = ["MOCK_BASELINE", "DEEPSEEK_REAL"] as const;
  const statuses = ["PENDING", "RUNNING", "COMPLETED", "BLOCKED", "FAILED"] as const;
  const runType = runTypes.includes(textValue(row.run_type) as QualityBenchmarkRunType) ? textValue(row.run_type) as QualityBenchmarkRunType : "MOCK_BASELINE";
  const status = statuses.includes(textValue(row.status) as QualityBenchmarkRunStatus) ? textValue(row.status) as QualityBenchmarkRunStatus : "FAILED";
  return {
    benchmarkRunId: textValue(row.benchmark_run_id), benchmarkId: textValue(row.benchmark_id), datasetVersion: textValue(row.dataset_version), runType,
    provider: textValue(row.provider), model: textValue(row.model), temperature: row.temperature === null || row.temperature === undefined ? null : Number(row.temperature), maxTokens: row.max_tokens === null || row.max_tokens === undefined ? null : intValue(row.max_tokens),
    promptVersion: textValue(row.prompt_version), status, controlStatus: ["RUNNING", "PAUSED", "CANCELLED"].includes(textValue(row.control_status)) ? textValue(row.control_status) as QualityBenchmarkRunView["controlStatus"] : "RUNNING", startedAt: textValue(row.started_at), completedAt: typeof row.completed_at === "string" ? row.completed_at : null, totalDurationMs: intValue(row.total_duration_ms), successCount: intValue(row.success_count), failureCount: intValue(row.failure_count),
    totalTokenUsage: parseJson<AIUsage>(row.total_token_usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }), estimatedCost: row.estimated_cost === null || row.estimated_cost === undefined ? null : Number(row.estimated_cost), similaritySummary: parseJson<Record<string, number>>(row.similarity_summary_json, {}), blockReason: typeof row.block_reason === "string" ? row.block_reason : null, createdAt: textValue(row.created_at)
  };
}
function toQualityBenchmarkItem(row: Row): QualityBenchmarkItemView {
  const statuses = ["Pending", "Running", "Success", "Failed", "RetryableFailure"] as const;
  const rawStatus = textValue(row.status);
  return {
    id: textValue(row.id), benchmarkRunId: textValue(row.benchmark_run_id), benchmarkId: textValue(row.benchmark_id), datasetVersion: textValue(row.dataset_version), promptVersion: textValue(row.prompt_version), topicIndex: intValue(row.topic_index), topic: textValue(row.topic), city: textValue(row.city), keyword: textValue(row.keyword), business: textValue(row.business), platformKey: textValue(row.platform_key), status: statuses.includes(rawStatus as QualityBenchmarkItemStatus) ? rawStatus as QualityBenchmarkItemStatus : "Failed", attemptCount: intValue(row.attempt_count), contentStudioTaskId: typeof row.content_studio_task_id === "string" ? row.content_studio_task_id : null, contentTypeId: typeof row.content_type_id === "string" ? row.content_type_id : null, provider: textValue(row.provider), model: textValue(row.model), errorCode: typeof row.error_code === "string" ? row.error_code : null, errorMessage: typeof row.error_message === "string" ? row.error_message : null, failureCategory: typeof row.failure_category === "string" ? row.failure_category : null, diagnostics: parseJson<Array<Record<string, unknown>>>(row.diagnostics_json, []), requestDurationMs: intValue(row.request_duration_ms), tokenUsage: parseJson<AIUsage>(row.token_usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }), startedAt: typeof row.started_at === "string" ? row.started_at : null, completedAt: typeof row.completed_at === "string" ? row.completed_at : null, createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at)
  };
}
function toQualityBenchmarkItemAttempt(row: Row): QualityBenchmarkItemAttemptView {
  const statuses = ["Success", "Failed", "RetryableFailure"] as const;
  const rawStatus = textValue(row.status);
  return { id: textValue(row.id), benchmarkItemId: textValue(row.benchmark_item_id), attemptNumber: intValue(row.attempt_number), status: statuses.includes(rawStatus as QualityBenchmarkItemAttemptStatus) ? rawStatus as QualityBenchmarkItemAttemptStatus : "Failed", failureCategory: typeof row.failure_category === "string" ? row.failure_category : null, errorCode: typeof row.error_code === "string" ? row.error_code : null, errorMessage: typeof row.error_message === "string" ? row.error_message : null, diagnostics: parseJson<Array<Record<string, unknown>>>(row.diagnostics_json, []), finishReason: typeof row.finish_reason === "string" ? row.finish_reason : null, responseLength: intValue(row.response_length), requestDurationMs: intValue(row.request_duration_ms), tokenUsage: parseJson<AIUsage>(row.token_usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }), createdAt: textValue(row.created_at) };
}
function toQualityBenchmarkContent(row: Row): QualityBenchmarkContentView {
  const status = ["Draft", "AI_Checked", "Needs_Review", "Approved", "Rejected"].includes(textValue(row.quality_status)) ? textValue(row.quality_status) as ContentQualityStatus : "Draft";
  return {
    id: textValue(row.id), benchmarkRunId: textValue(row.benchmark_run_id), benchmarkId: textValue(row.benchmark_id), datasetVersion: textValue(row.dataset_version), topicIndex: intValue(row.topic_index), topic: textValue(row.topic), city: textValue(row.city), keyword: textValue(row.keyword), platformKey: textValue(row.platform_key), contentType: textValue(row.content_type) === "video_script" ? "video_script" : "article", contentTypeId: textValue(row.content_type_id), provider: textValue(row.provider), model: textValue(row.model), contentHash: textValue(row.content_hash), qualityStatus: status, riskCount: intValue(row.risk_count), revisionNumber: intValue(row.revision_number), isCurrent: boolValue(row.is_current), requestDurationMs: intValue(row.request_duration_ms), tokenUsage: parseJson<AIUsage>(row.token_usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }), intraPlatformSimilarity: row.intra_platform_similarity === null || row.intra_platform_similarity === undefined ? null : Number(row.intra_platform_similarity), crossPlatformSimilarity: row.cross_platform_similarity === null || row.cross_platform_similarity === undefined ? null : Number(row.cross_platform_similarity), createdAt: textValue(row.created_at)
  };
}
function toBrand(row: Row): Brand { return { id: textValue(row.id), name: textValue(row.name), companyName: textValue(row.company_name), description: textValue(row.description), industry: textValue(row.industry), officialWebsite: textValue(row.official_website), notes: textValue(row.notes), mainBusiness: textValue(row.main_business), serviceRegions: stringArray(row.service_regions_json), advantages: stringArray(row.advantages_json), contact: stringRecord(row.contact_json), establishedAt: textValue(row.established_at), address: textValue(row.address), serviceProcess: textValue(row.service_process), afterSales: textValue(row.after_sales), faq: textValue(row.faq), certificates: textValue(row.certificates), patents: textValue(row.patents), equipment: textValue(row.equipment), cases: textValue(row.cases), aiForbiddenClaims: stringArray(row.ai_forbidden_claims_json), knowledgeEntries: [], createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at) }; }
function toBrandKnowledgeEntry(row: Row): BrandKnowledgeEntry { return { id: textValue(row.id), brandId: textValue(row.brand_id), category: textValue(row.category) as BrandKnowledgeCategory, title: textValue(row.title), content: textValue(row.content), enabled: boolValue(row.enabled), sourceKey: typeof row.source_key === "string" ? row.source_key : null, createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at) }; }
function toAiProviderProfile(row: Row): AIProviderProfile { return { id: textValue(row.id), name: textValue(row.name), provider: textValue(row.provider), baseUrl: textValue(row.base_url), model: textValue(row.model), credentialRef: textValue(row.credential_ref), temperature: Number(row.temperature ?? 0.7), maxOutputTokens: intValue(row.max_output_tokens) || 3000, timeoutMs: intValue(row.timeout_ms) || 30000, retryCount: intValue(row.retry_count), concurrency: intValue(row.concurrency) || 1, enabled: boolValue(row.enabled), isDefault: boolValue(row.is_default), isFallback: boolValue(row.is_fallback), createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at) }; }
function toAiBatchItem(row: Row): AIBatchItem { const statuses = ["Pending", "Running", "Completed", "Retry", "Failed", "Cancelled"] as const; const status = statuses.includes(textValue(row.status) as AIBatchItem["status"]) ? textValue(row.status) as AIBatchItem["status"] : "Failed"; return { id: textValue(row.id), batchId: textValue(row.batch_id), keywordId: typeof row.keyword_id === "string" ? row.keyword_id : null, city: textValue(row.city), keyword: textValue(row.keyword), articleType: textValue(row.article_type), targetIndex: intValue(row.target_index), status, attemptCount: intValue(row.attempt_count), articleId: typeof row.article_id === "string" ? row.article_id : null, lastError: typeof row.last_error === "string" ? row.last_error : null, startedAt: typeof row.started_at === "string" ? row.started_at : null, completedAt: typeof row.completed_at === "string" ? row.completed_at : null }; }
function toAsset(row: Row): BrandAsset { return { id: textValue(row.id), brandId: textValue(row.brand_id), type: row.type as BrandAsset["type"], title: textValue(row.title), filePath: textValue(row.file_path), description: textValue(row.description), createdAt: textValue(row.created_at) }; }
function toImageAsset(row: Row): ImageAsset {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const labels = (key: string): string[] => Array.isArray(metadata[key]) ? metadata[key].filter((item): item is string => typeof item === "string") : [];
  const createdAt = textValue(row.created_at);
  return { id: textValue(row.id), brandId: typeof row.brand_id === "string" ? row.brand_id : null, name: textValue(row.title), filePath: textValue(row.file_path), originalFileName: typeof metadata.originalFileName === "string" ? metadata.originalFileName : textValue(row.title), mimeType: typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream", size: intValue(metadata.size), tags: labels("tags"), business: labels("business"), city: labels("city"), usage: labels("usage"), platform: labels("platform"), universal: metadata.universal === true, enabled: metadata.enabled !== false, lastUsedAt: typeof metadata.lastUsedAt === "string" ? metadata.lastUsedAt : null, useCount: intValue(metadata.useCount), createdAt, updatedAt: typeof metadata.updatedAt === "string" ? metadata.updatedAt : createdAt };
}
function toTemplate(row: Row): KeywordTemplate { return { id: textValue(row.id), brandId: textValue(row.brand_id), template: textValue(row.template), category: textValue(row.category), enabled: boolValue(row.enabled) }; }
function toKeywordItem(row: Row): KeywordItem { return { id: textValue(row.id), brandId: textValue(row.brand_id), city: textValue(row.city), keyword: textValue(row.keyword), sourceTemplateId: textValue(row.source_template_id), status: row.status as KeywordItem["status"], createdAt: textValue(row.created_at) }; }
const benchmarkArticleExists = "EXISTS (SELECT 1 FROM quality_benchmark_items bi JOIN content_studio_versions sv_bi ON sv_bi.article_variant_id=bi.content_type_id WHERE sv_bi.source_article_id=a.id)";
const contentStudioArticleExists = "EXISTS (SELECT 1 FROM content_studio_versions sv_cs WHERE sv_cs.source_article_id=a.id)";
const articleSourceExpression = `(CASE WHEN a.source='excel_import' THEN 'excel_import' WHEN ${benchmarkArticleExists} THEN 'benchmark' WHEN ${contentStudioArticleExists} THEN 'content_studio' WHEN lower(a.ai_provider)='mock' THEN 'mock' WHEN lower(a.ai_provider)='test' OR lower(a.article_type) LIKE 'test%' THEN 'test' ELSE COALESCE(a.source,'production') END)`;
const articleSelectSql = `SELECT a.*, ${articleSourceExpression} AS content_source,
  (SELECT sv.task_id FROM content_studio_versions sv WHERE sv.source_article_id=a.id ORDER BY sv.created_at DESC LIMIT 1) AS content_studio_task_id,
  (SELECT bi.benchmark_run_id FROM quality_benchmark_items bi JOIN content_studio_versions sv ON sv.article_variant_id=bi.content_type_id WHERE sv.source_article_id=a.id ORDER BY bi.updated_at DESC LIMIT 1) AS benchmark_run_id,
  (SELECT bi.benchmark_id FROM quality_benchmark_items bi JOIN content_studio_versions sv ON sv.article_variant_id=bi.content_type_id WHERE sv.source_article_id=a.id ORDER BY bi.updated_at DESC LIMIT 1) AS benchmark_id,
  (SELECT bi.prompt_version FROM quality_benchmark_items bi JOIN content_studio_versions sv ON sv.article_variant_id=bi.content_type_id WHERE sv.source_article_id=a.id ORDER BY bi.updated_at DESC LIMIT 1) AS benchmark_prompt_version,
  (SELECT t.input_json FROM content_studio_tasks t JOIN content_studio_versions sv ON sv.task_id=t.id WHERE sv.source_article_id=a.id ORDER BY sv.created_at DESC LIMIT 1) AS content_studio_input_json,
  (SELECT t.output_json FROM content_studio_tasks t JOIN content_studio_versions sv ON sv.task_id=t.id WHERE sv.source_article_id=a.id ORDER BY sv.created_at DESC LIMIT 1) AS content_studio_output_json,
  (SELECT sv.platform_key FROM content_studio_versions sv WHERE sv.source_article_id=a.id ORDER BY sv.created_at DESC LIMIT 1) AS content_studio_platform_key
  FROM articles a`;

function articleSourceWhere(source: ContentSource): { sql: string; values: SqlValue[] } {
  if (source === "excel_import") return { sql: `${articleSourceExpression}='excel_import'`, values: [] };
  if (source === "benchmark") return { sql: benchmarkArticleExists, values: [] };
  if (source === "mock") return { sql: `${articleSourceExpression}='mock'`, values: [] };
  if (source === "test") return { sql: `${articleSourceExpression}='test'`, values: [] };
  if (source === "content_studio") return { sql: `${contentStudioArticleExists} AND NOT ${benchmarkArticleExists}`, values: [] };
  return { sql: `${articleSourceExpression} IN ('production','content_studio','excel_import')`, values: [] };
}

function toArticle(row: Row): Article {
  const input = parseJson<Record<string, unknown>>(row.content_studio_input_json, {});
  const output = parseJson<Record<string, unknown>>(row.content_studio_output_json, {});
  const contentGoal = ["BrandPromotion", "SEOArticle", "GEOArticle", "Educational", "FAQ", "CaseStyle", "VideoScript"].includes(String(input.contentGoal)) ? input.contentGoal as ContentGoal : null;
  const promotionStrength = ["Soft", "Balanced", "Strong"].includes(textValue(row.promotion_strength)) ? textValue(row.promotion_strength) as PromotionStrength : ["Soft", "Balanced", "Strong"].includes(String(input.promotionStrength)) ? input.promotionStrength as PromotionStrength : null;
  const contentIntents = ["ServiceIntroduction", "SelectionGuide", "BrandAnswer", "ProblemSolution", "ProfessionalInsight", "LocalService", "FAQ", "CaseStyle", "Educational", "VideoScript"];
  const searchIntents = ["Commercial", "CommercialInvestigation", "Informational", "Navigational"];
  const contentIntent = contentIntents.includes(String(output.contentIntent)) ? output.contentIntent as ContentIntent : contentIntents.includes(String(input.contentIntent)) ? input.contentIntent as ContentIntent : null;
  const searchIntent = searchIntents.includes(String(output.searchIntent)) ? output.searchIntent as SearchIntent : searchIntents.includes(String(input.searchIntent)) ? input.searchIntent as SearchIntent : null;
  const byPlatform = output.brandDifferentiationByPlatform && typeof output.brandDifferentiationByPlatform === "object" ? output.brandDifferentiationByPlatform as Record<string, BrandDifferentiationMetrics> : {};
  const platformMetrics = typeof row.content_studio_platform_key === "string" ? byPlatform[row.content_studio_platform_key] : Object.values(byPlatform)[0];
  const warnings = stringArray(row.quality_warnings_json);
  const source = ["production", "content_studio", "excel_import", "benchmark", "mock", "test"].includes(textValue(row.content_source)) ? textValue(row.content_source) as ContentSource : "production";
  return {
    id: textValue(row.id), brandId: textValue(row.brand_id), topic: textValue(row.topic), keyword: textValue(row.keyword), city: textValue(row.city), title: textValue(row.title), body: textValue(row.body), summary: textValue(row.summary), tags: stringArray(row.tags_json), seoKeywords: stringArray(row.seo_keywords_json), coverAssetId: typeof row.cover_asset_id === "string" ? row.cover_asset_id : null, articleType: textValue(row.article_type), aiProvider: textValue(row.ai_provider), aiModel: textValue(row.ai_model), generatedAt: textValue(row.generated_at), status: row.status as Article["status"], reusePolicy: row.reuse_policy as Article["reusePolicy"], contentHash: textValue(row.content_hash), qualityStatus: row.quality_status === "passed" || row.quality_status === "warning" || row.quality_status === "failed" ? row.quality_status : "unchecked", qualityWarnings: warnings.filter((value) => value !== "NEEDS_REWRITE"), needsRewrite: warnings.includes("NEEDS_REWRITE"), useCount: intValue(row.use_count), publishCount: intValue(row.publish_count), createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at), source,
    contentFingerprint: typeof row.content_fingerprint === "string" ? row.content_fingerprint : textValue(row.content_hash),
    company: textValue(row.company), business: textValue(row.business), targetPlatforms: stringArray(row.target_platforms_json), sourceNote: textValue(row.source_note), importBatchId: typeof row.import_batch_id === "string" ? row.import_batch_id : null, importedAt: typeof row.imported_at === "string" ? row.imported_at : null, sourceFilename: typeof row.source_filename === "string" ? row.source_filename : null,
    contentStudioTaskId: typeof row.content_studio_task_id === "string" ? row.content_studio_task_id : null,
    benchmarkRunId: typeof row.benchmark_run_id === "string" ? row.benchmark_run_id : null,
    benchmarkId: typeof row.benchmark_id === "string" ? row.benchmark_id : null,
    promptVersion: typeof row.benchmark_prompt_version === "string" ? row.benchmark_prompt_version : typeof output.promptVersion === "string" ? output.promptVersion : typeof input.promptVersion === "string" ? input.promptVersion : null,
    contentGoal, promotionStrength, contentIntent, searchIntent,
    knowledgeSnapshot: output.knowledgeSnapshot && typeof output.knowledgeSnapshot === "object" ? output.knowledgeSnapshot as KnowledgeSnapshot : null,
    brandMentionCount: platformMetrics?.brandMentionCount ?? null,
    brandFactUsageCount: platformMetrics?.brandFactUsageCount ?? null,
    uniqueBrandFactCount: platformMetrics?.uniqueBrandFactCount ?? null,
    brandDifferentiationScore: platformMetrics?.score ?? null,
    brandDifferentiation: platformMetrics ?? null
  };
}
function humanReviewSnapshot(contentType: ContentQualityContentType, contentId: string, platformKey: string | null, title: string, body: string, summary: string, contentHash: string): HumanReviewContentSnapshot {
  return { contentType, contentId, platformKey, title, body, summary, contentHash };
}
function toHumanReviewIssueDecision(row: Row): HumanReviewIssueDecisionView {
  const decisions = ["TruePositive", "FalsePositive", "Uncertain", "MissedIssue"] as const;
  const humanDecision = decisions.includes(textValue(row.human_decision) as HumanReviewDecision) ? textValue(row.human_decision) as HumanReviewDecision : "Uncertain";
  const machineDecision = textValue(row.machine_decision) === "NotDetected" ? "NotDetected" : "Detected";
  return { id: textValue(row.id), ruleId: textValue(row.rule_id), issueIndex: intValue(row.issue_index), machineDecision, humanDecision, reason: typeof row.reason === "string" ? row.reason : null, issue: parseJson<ContentQualityIssue | null>(row.issue_json, null) };
}
function toHumanReviewItemReview(row: Row, issueDecisions: HumanReviewIssueDecisionView[]): HumanReviewItemReviewView {
  const statuses = ["Draft", "AI_Checked", "Needs_Review", "Approved", "Rejected"] as const;
  const finalStatuses = ["AI_Checked", "Needs_Review", "Approved", "Rejected"] as const;
  const originalStatus = statuses.includes(textValue(row.original_status) as ContentQualityStatus) ? textValue(row.original_status) as ContentQualityStatus : "Draft";
  const finalStatus = finalStatuses.includes(textValue(row.final_status) as HumanReviewFinalStatus) ? textValue(row.final_status) as HumanReviewFinalStatus : "Needs_Review";
  return {
    id: textValue(row.id), datasetItemId: textValue(row.dataset_item_id), reviewerType: "human", reviewedAt: textValue(row.reviewed_at), originalStatus, finalStatus,
    reviewDurationMs: intValue(row.review_duration_ms), editCount: intValue(row.edit_count), originalContentHash: textValue(row.original_content_hash), finalContentHash: textValue(row.final_content_hash),
    originalContent: parseJson<HumanReviewContentSnapshot>(row.original_content_json, humanReviewSnapshot("article_variant", "", null, "", "", "", textValue(row.original_content_hash))),
    finalContent: parseJson<HumanReviewContentSnapshot>(row.final_content_json, humanReviewSnapshot("article_variant", "", null, "", "", "", textValue(row.final_content_hash))),
    reason: typeof row.reason === "string" ? row.reason : null, issueDecisions, createdAt: textValue(row.created_at)
  };
}
function toArticleVariant(row: Row): ArticleVariant { return { id: textValue(row.id), articleId: textValue(row.article_id), platformKey: textValue(row.platform_key), title: textValue(row.title), body: textValue(row.body), summary: textValue(row.summary), coverAssetId: typeof row.cover_asset_id === "string" ? row.cover_asset_id : null, contentHash: textValue(row.content_hash), createdAt: textValue(row.created_at) }; }
function toContentQualityState(row: Row): ContentQualityStateView { return { contentType: textValue(row.content_type) as ContentQualityContentType, contentId: textValue(row.content_id), brandId: textValue(row.brand_id), platformKey: typeof row.platform_key === "string" ? row.platform_key : null, status: ["Draft", "AI_Checked", "Needs_Review", "Approved", "Rejected"].includes(textValue(row.status)) ? textValue(row.status) as ContentQualityStatus : "Draft", contentHash: textValue(row.content_hash), lastReviewId: typeof row.last_review_id === "string" ? row.last_review_id : null, version: intValue(row.version), updatedAt: textValue(row.updated_at) }; }
function toContentQualityReview(row: Row): ContentQualityReviewView { return { id: textValue(row.id), contentType: textValue(row.content_type) as ContentQualityContentType, contentId: textValue(row.content_id), brandId: textValue(row.brand_id), platformKey: typeof row.platform_key === "string" ? row.platform_key : null, status: textValue(row.status) as ContentQualityReviewView["status"], trigger: textValue(row.trigger) as ContentQualityTrigger, provider: textValue(row.provider), model: textValue(row.model), score: intValue(row.score), checks: parseJson<ContentQualityCheckResult[]>(row.checks_json, []), issues: parseJson<ContentQualityIssue[]>(row.issues_json, []), contentHash: textValue(row.content_hash), snapshot: parseJson<Record<string, unknown>>(row.snapshot_json, {}), operatorType: row.operator_type === "human" ? "human" : "system", previousStatus: ["Draft", "AI_Checked", "Needs_Review", "Approved", "Rejected"].includes(textValue(row.previous_status)) ? textValue(row.previous_status) as ContentQualityStatus : null, newStatus: ["Draft", "AI_Checked", "Needs_Review", "Approved", "Rejected"].includes(textValue(row.new_status)) ? textValue(row.new_status) as ContentQualityStatus : null, reason: typeof row.reason === "string" ? row.reason : null, createdAt: textValue(row.created_at) }; }
function toContentQualityAudit(row: Row): ContentQualityAuditView { return { id: textValue(row.id), contentType: textValue(row.content_type) as ContentQualityContentType, contentId: textValue(row.content_id), operatorType: row.operator_type === "human" ? "human" : "system", previousStatus: textValue(row.previous_status) as ContentQualityStatus, newStatus: textValue(row.new_status) as ContentQualityStatus, reason: textValue(row.reason), timestamp: textValue(row.timestamp), contentHash: textValue(row.content_hash) }; }
function toPlatformContentRules(row: Row): PlatformContentRules { const contentType = ["article", "video_script", "mixed"].includes(textValue(row.content_type)) ? textValue(row.content_type) as PlatformContentRules["contentType"] : "article"; return { platformKey: textValue(row.platform_key), titleMinLength: intValue(row.title_min_length), titleMaxLength: intValue(row.title_max_length), bodyMinLength: intValue(row.body_min_length), bodyMaxLength: intValue(row.body_max_length), summaryMaxLength: intValue(row.summary_max_length), maxTags: intValue(row.max_tags), maxImages: intValue(row.max_images), supportsLinks: boolValue(row.supports_links), supportsMarkdown: boolValue(row.supports_markdown), supportsHtml: boolValue(row.supports_html), contentType, source: typeof row.source === "string" ? row.source : null, lastVerifiedAt: typeof row.last_verified_at === "string" ? row.last_verified_at : null, verificationStatus: row.verification_status === "verified" ? "verified" : "unverified" }; }
function toPlatformProfile(row: Row): PlatformProfile { return { platformKey: textValue(row.platform_key), style: textValue(row.style), titleLimit: intValue(row.title_limit), preferredMinWords: intValue(row.preferred_min_words), preferredMaxWords: intValue(row.preferred_max_words), minBodyLength: intValue(row.min_body_length), maxBodyLength: intValue(row.max_body_length), supportsCover: boolValue(row.supports_cover), coverRequired: boolValue(row.cover_required), coverSizes: stringArray(row.cover_sizes_json), maxImages: intValue(row.max_images) || 1, supportsTags: boolValue(row.supports_tags), maxTags: intValue(row.max_tags), supportsMarkdown: boolValue(row.supports_markdown), supportsHtml: boolValue(row.supports_html), supportsRichText: boolValue(row.supports_rich_text), sourceUrl: textValue(row.source_url), researchStatus: row.research_status as PlatformProfile["researchStatus"], lastVerifiedAt: typeof row.last_verified_at === "string" ? row.last_verified_at : null }; }
function toPlatformAccountIdentityBinding(row: Row): PlatformAccountIdentityBinding {
  return {
    id: textValue(row.id),
    platformKey: textValue(row.platform_key),
    accountId: textValue(row.account_id),
    externalCreatorId: textValue(row.external_creator_id),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    profileUrl: typeof row.profile_url === "string" ? row.profile_url : null,
    bindingSource: textValue(row.binding_source) as PlatformAccountIdentityBinding["bindingSource"],
    boundAt: textValue(row.bound_at),
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at)
  };
}
function toOneShotPublicationAuthorization(row: Row): OneShotPublicationAuthorization {
  return {
    authorization: textValue(row.authorization) as OneShotPublicationAuthorization["authorization"],
    state: textValue(row.state) as OneShotPublicationAuthorization["state"],
    platformKey: textValue(row.platform_key) as OneShotPublicationAuthorization["platformKey"],
    accountId: textValue(row.account_id) as OneShotPublicationAuthorization["accountId"],
    operationId: textValue(row.operation_id),
    mode: textValue(row.mode) as OneShotPublicationAuthorization["mode"],
    publicationTransactionCount: intValue(row.publication_transaction_count),
    publicationCommitActionCount: intValue(row.publication_commit_action_count),
    finalSubmitAttemptCount: intValue(row.final_submit_attempt_count),
    finalSubmitRetryCount: intValue(row.final_submit_retry_count),
    finalSubmitActionStarted: boolValue(row.final_submit_action_started),
    finalSubmitActionCompleted: boolValue(row.final_submit_action_completed),
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
    consumedAt: typeof row.consumed_at === "string" ? row.consumed_at : null
  };
}
function toPlatform(row: Row): Platform {
  const lifecycle = textValue(row.verification_status);
  const transport = (textValue(row.transport) || "manual") as Platform["transport"];
  const authStrategy = textValue(row.auth_strategy) as Platform["authStrategy"] || "Unsupported";
  return {
    id: textValue(row.id),
    platformKey: textValue(row.platform_key),
    displayName: textValue(row.display_name),
    category: textValue(row.category),
    enabled: boolValue(row.enabled),
    adapterStatus: row.adapter_status as Platform["adapterStatus"],
    adapterVersion: textValue(row.adapter_version),
    capabilities: parseJson<Platform["capabilities"]>(row.capabilities_json, { article: false, imagePost: false, video: false, coverImage: false, tags: false, categories: false, scheduledPublish: false, draft: false, markdown: false, richText: false, maxTitleLength: 0, maxImageCount: 0 }),
    researchStatus: row.research_status as Platform["researchStatus"] ?? "unverified",
    healthStatus: row.health_status as Platform["healthStatus"] ?? "unknown",
    verificationStatus: (lifecycle === "Unverified" || !lifecycle ? row.adapter_status === "not_implemented" ? "NotImplemented" : "NotResearched" : lifecycle) as Platform["verificationStatus"],
    lastVerifiedAt: typeof row.last_verified_at === "string" ? row.last_verified_at : null,
    backgroundAutomationStatus: ["UNKNOWN", "PASSED", "FAILED", "REQUIRES_VISIBLE_BROWSER"].includes(textValue(row.background_automation_status))
      ? textValue(row.background_automation_status) as Platform["backgroundAutomationStatus"]
      : "UNKNOWN",
    backgroundAutomationLastTestedAt: typeof row.background_automation_last_tested_at === "string" ? row.background_automation_last_tested_at : null,
    backgroundAutomationReason: typeof row.background_automation_reason === "string" ? row.background_automation_reason : null,
    transport,
    integrationMode: isPlatformCapability(row.integration_mode) ? row.integration_mode : inferIntegrationMode(transport, authStrategy),
    authStrategy,
    callbackStrategy: textValue(row.callback_strategy) as Platform["callbackStrategy"] || "ManualCodeCallback",
    blockingReason: typeof row.blocking_reason === "string" ? row.blocking_reason : null,
    officialWebsite: textValue(row.official_website),
    developerPortal: typeof row.developer_portal === "string" ? row.developer_portal : null,
    credentialSchema: parseJson<Platform["credentialSchema"]>(row.credential_schema_json, []),
    officialSources: stringArray(row.official_sources_json)
  };
}
function toAccount(row: Row): Account { const publishMode = ["auto", "manual", "assisted"].includes(textValue(row.publish_mode)) ? textValue(row.publish_mode) as Account["publishMode"] : "inherit"; const authorizationStatus = ["NotAuthorized", "Authorized", "Partial", "Revoked", "Unknown"].includes(textValue(row.authorization_status)) ? textValue(row.authorization_status) as Account["authorizationStatus"] : "Unknown"; const connectionMode = ["BrowserAutomation", "OfficialAPI", "OAuth", "Manual"].includes(textValue(row.connection_mode)) ? textValue(row.connection_mode) as Account["connectionMode"] : "Manual"; const alias = textValue(row.account_alias) || textValue(row.name); return { id: textValue(row.id), platformAccountId: textValue(row.id), platformKey: textValue(row.platform_key), name: alias, accountAlias: alias, accountName: typeof row.platform_account_name === "string" ? row.platform_account_name : null, groupId: typeof row.group_id === "string" ? row.group_id : null, enabled: boolValue(row.enabled), loginStatus: row.login_status as Account["loginStatus"], pausedReason: typeof row.paused_reason === "string" ? row.paused_reason : null, lastLoginCheck: typeof row.last_login_check_at === "string" ? row.last_login_check_at : null, lastPublishAt: typeof row.last_publish_at === "string" ? row.last_publish_at : null, todayPublishCount: intValue(row.today_publish_count), allowAutoPublish: publishMode === "auto" || (row.publish_mode === undefined && boolValue(row.allow_auto_publish)), publishMode, minimumIntervalSeconds: intValue(row.minimum_interval_seconds), failedCount: intValue(row.failed_count), connectionMode, authorizationStatus, browserSessionId: typeof row.browser_session_id === "string" ? row.browser_session_id : null, externalAccountId: typeof row.external_account_id === "string" ? row.external_account_id : null, lastVerifiedAt: typeof row.last_verified_at === "string" ? row.last_verified_at : null, lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null, archivedAt: typeof row.archived_at === "string" ? row.archived_at : null }; }
function toAccountAuthorization(row: Row): AccountAuthorizationView {
  const status = ["NotAuthorized", "Authorized", "Partial", "Revoked", "Unknown"].includes(textValue(row.status)) ? textValue(row.status) as AccountAuthorizationView["status"] : "Unknown";
  return { accountId: textValue(row.account_id), platformKey: textValue(row.platform_key), authorizationType: textValue(row.authorization_type), status, scopes: stringArray(row.scopes_json), expiresAt: typeof row.expires_at === "string" ? row.expires_at : null, providerAccountId: typeof row.provider_account_id === "string" ? row.provider_account_id : null, providerAccountName: typeof row.provider_account_name === "string" ? row.provider_account_name : null, updatedAt: textValue(row.updated_at) };
}
function toPlan(row: Row): PublishPlan { return { id: textValue(row.id), name: textValue(row.name), brandId: textValue(row.brand_id), enabled: boolValue(row.enabled), strategy: row.strategy as PublishPlan["strategy"], articlesPerDay: intValue(row.articles_per_day), accountIds: stringArray(row.account_scope_json), publishTimes: parseJson<{ publishTimes?: string[] }>(row.time_rules_json, {}).publishTimes ?? [], reusePolicy: row.reuse_policy as PublishPlan["reusePolicy"], minIntervalSeconds: intValue(row.min_interval_seconds), maxRetries: intValue(row.max_retries), consecutiveFailureThreshold: intValue(row.consecutive_failure_threshold), startDate: textValue(row.start_date), endDate: typeof row.end_date === "string" ? row.end_date : null }; }
function selfTestLevel(value: unknown): PlatformSelfTestLevel { return ["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT", "L5_PUBLISH"].includes(textValue(value)) ? textValue(value) as PlatformSelfTestLevel : "L1_LOGIN"; }
function selfTestResult(value: unknown): PlatformSelfTestResult { return ["NOT_TESTED", "TESTING", "PASSED", "PARTIAL_PASSED", "WAITING_FOR_USER", "FAILED", "NOT_SUPPORTED"].includes(textValue(value)) ? textValue(value) as PlatformSelfTestResult : "NOT_TESTED"; }
function selfTestCleanupStatus(value: unknown): PlatformSelfTestCleanupStatus { return ["NOT_AVAILABLE", "AVAILABLE", "WAITING_FOR_CONFIRMATION", "CLEANED", "FAILED"].includes(textValue(value)) ? textValue(value) as PlatformSelfTestCleanupStatus : "NOT_AVAILABLE"; }
function toPlatformSelfTestStep(row: Row): PlatformSelfTestStep { return { id: textValue(row.id), testRunId: textValue(row.test_run_id), platformKey: textValue(row.platform_key), platformAccountId: textValue(row.platform_account_id), testLevel: selfTestLevel(row.test_level), stepKey: textValue(row.step_key), startedAt: textValue(row.started_at), finishedAt: typeof row.finished_at === "string" ? row.finished_at : null, result: selfTestResult(row.result), errorCode: typeof row.error_code === "string" ? row.error_code : null, message: typeof row.message === "string" ? row.message : null, verificationSignal: typeof row.verification_signal === "string" ? row.verification_signal : null, externalId: typeof row.external_id === "string" ? row.external_id : null, externalUrl: typeof row.external_url === "string" ? row.external_url : null }; }
function toPlatformSelfTestRun(row: Row, steps: PlatformSelfTestStep[]): PlatformSelfTestRun { const platformAccountId = textValue(row.platform_account_id); return { id: textValue(row.id), testRunId: textValue(row.test_run_id), platformKey: textValue(row.platform_key), accountId: platformAccountId, platformAccountId, requestedLevel: selfTestLevel(row.requested_level), overallResult: selfTestResult(row.overall_result), startedAt: textValue(row.started_at), finishedAt: typeof row.finished_at === "string" ? row.finished_at : null, lastTestedAt: textValue(row.last_tested_at), publishConfirmedAt: typeof row.publish_confirmed_at === "string" ? row.publish_confirmed_at : null, deleteConfirmedAt: typeof row.delete_confirmed_at === "string" ? row.delete_confirmed_at : null, testArticleId: typeof row.test_article_id === "string" ? row.test_article_id : null, publishJobId: typeof row.publish_job_id === "string" ? row.publish_job_id : null, publishRecordId: typeof row.publish_record_id === "string" ? row.publish_record_id : null, externalId: typeof row.external_id === "string" ? row.external_id : null, externalUrl: typeof row.external_url === "string" ? row.external_url : null, cleanupStatus: selfTestCleanupStatus(row.cleanup_status), cleanedAt: typeof row.cleaned_at === "string" ? row.cleaned_at : null, steps }; }
function toJob(row: Row): PublishJob { const imageSelectionMode = ["random", "manual", "none"].includes(textValue(row.image_selection_mode)) ? textValue(row.image_selection_mode) as PublishJob["imageSelectionMode"] : "none"; const finalPublishMode = ["PREPARE_ONLY", "CONFIRM_BEFORE_PUBLISH", "AUTO_PUBLISH"].includes(textValue(row.final_publish_mode)) ? textValue(row.final_publish_mode) as PublishJob["finalPublishMode"] : "CONFIRM_BEFORE_PUBLISH"; return { id: textValue(row.id), planId: typeof row.plan_id === "string" ? row.plan_id : null, accountId: textValue(row.account_id), platformAccountId: textValue(row.platform_account_id) || textValue(row.account_id), platformKey: textValue(row.platform_key), articleId: textValue(row.article_id), articleVariantId: typeof row.article_variant_id === "string" ? row.article_variant_id : null, scheduledAt: textValue(row.scheduled_at), status: row.status as PublishJob["status"], attemptCount: intValue(row.attempt_count), maxAttempts: intValue(row.max_attempts), nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null, lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code as PublishJob["lastErrorCode"] : null, lastErrorMessage: typeof row.last_error_message === "string" ? row.last_error_message : null, startedAt: typeof row.started_at === "string" ? row.started_at : null, finishedAt: typeof row.finished_at === "string" ? row.finished_at : null, createdAt: textValue(row.created_at), dryRun: boolValue(row.dry_run), manualConfirmationRequired: boolValue(row.manual_confirmation_required), finalPublishMode, confirmedAt: typeof row.confirmed_at === "string" ? row.confirmed_at : null, contentKind: row.content_kind === "video" ? "video" : "article", videoAssetId: typeof row.video_asset_id === "string" ? row.video_asset_id : null, selectedImageAssetId: typeof row.selected_image_asset_id === "string" ? row.selected_image_asset_id : null, imageSelectionMode }; }
function toVideoAsset(row: Row): VideoAsset { return { id: textValue(row.id), localPath: textValue(row.local_path), fileName: textValue(row.file_name), mimeType: textValue(row.mime_type), size: intValue(row.size_bytes), ...(row.duration_ms === null || row.duration_ms === undefined ? {} : { durationMs: intValue(row.duration_ms) }), ...(row.width === null || row.width === undefined ? {} : { width: intValue(row.width) }), ...(row.height === null || row.height === undefined ? {} : { height: intValue(row.height) }), createdAt: textValue(row.created_at) }; }
function toStoredVideoAsset(row: Row, db: Database.Database): StoredVideoAsset {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const records = db.prepare("SELECT r.success, r.dry_run, r.status FROM publish_records r INNER JOIN publish_jobs j ON j.id=r.job_id WHERE j.video_asset_id=? ORDER BY r.published_at DESC").all(textValue(row.id)) as Row[];
  const jobs = db.prepare("SELECT status FROM publish_jobs WHERE video_asset_id=? ORDER BY created_at DESC").all(textValue(row.id)) as Row[];
  const storedStatus = textValue(metadata.status) as StoredVideoAssetStatus;
  const status: StoredVideoAssetStatus = records.some((record) => boolValue(record.success) && !boolValue(record.dry_run) && textValue(record.status) === "Published") ? "Published" : records.some((record) => textValue(record.status) === "Failed" || (!boolValue(record.success) && !boolValue(record.dry_run))) || jobs.some((job) => textValue(job.status) === "Failed") ? "Failed" : records.some((record) => boolValue(record.success) && boolValue(record.dry_run)) ? "DryRun" : jobs.length > 0 ? "Ready" : ["Draft", "Ready", "DryRun", "Published", "Failed"].includes(storedStatus) ? storedStatus : "Draft";
  return { ...toVideoAsset(row), brandId: typeof row.brand_id === "string" ? row.brand_id : null, title: textValue(row.title) || textValue(row.file_name), description: textValue(metadata.description), tags: Array.isArray(metadata.tags) ? metadata.tags.filter((item): item is string => typeof item === "string") : [], coverPath: typeof metadata.coverPath === "string" ? metadata.coverPath : null, coverAssetId: typeof metadata.coverAssetId === "string" ? metadata.coverAssetId : null, platformFields: nestedStringRecord(metadata.platformFields), status };
}
function toRecord(row: Row): PublishRecord { const status = ["DryRun", "Prepared", "Submitted", "Publishing", "Published", "Failed"].includes(textValue(row.status)) ? textValue(row.status) as PublishRecord["status"] : "Published"; const publishMode = ["AUTO", "ASSISTED", "MANUAL"].includes(textValue(row.publish_mode)) ? textValue(row.publish_mode) as PublishRecord["publishMode"] : "MANUAL"; const verificationStatus = ["NotTested", "WaitingUser", "Verified", "Failed"].includes(textValue(row.verification_status)) ? textValue(row.verification_status) as PublishRecord["verificationStatus"] : "NotTested"; const imageSelectionMode = ["random", "manual", "none"].includes(textValue(row.image_selection_mode)) ? textValue(row.image_selection_mode) as PublishRecord["imageSelectionMode"] : "none"; return { id: textValue(row.id), jobId: textValue(row.job_id), accountId: textValue(row.account_id), platformAccountId: textValue(row.platform_account_id) || textValue(row.account_id), platformKey: textValue(row.platform_key), articleId: textValue(row.article_id), publishedUrl: typeof row.published_url === "string" ? row.published_url : null, publishedExternalId: typeof row.published_external_id === "string" ? row.published_external_id : null, success: boolValue(row.success), status, response: parseJson<Record<string, unknown>>(row.response_json, {}), publishedAt: textValue(row.published_at), dryRun: boolValue(row.dry_run), publishMode, automationType: isPlatformCapability(row.automation_type) ? row.automation_type : "Manual", browserSessionIdHash: typeof row.browser_session_id_hash === "string" ? row.browser_session_id_hash : null, operator: textValue(row.operator) || "desktop-user", verificationStatus, editorOpenedAt: typeof row.editor_opened_at === "string" ? row.editor_opened_at : null, titleFilled: row.title_filled === null || row.title_filled === undefined ? null : boolValue(row.title_filled), bodyFilled: row.body_filled === null || row.body_filled === undefined ? null : boolValue(row.body_filled), selectedImageAssetId: typeof row.selected_image_asset_id === "string" ? row.selected_image_asset_id : null, imageSelectionMode }; }
function toNotification(row: Row): Notification { return { id: textValue(row.id), level: row.level as Notification["level"], title: textValue(row.title), message: textValue(row.message), relatedId: typeof row.related_id === "string" ? row.related_id : null, read: boolValue(row.read), createdAt: textValue(row.created_at) }; }
function toLog(row: Row): ActivityLog { return { id: textValue(row.id), timestamp: textValue(row.created_at), level: row.level as ActivityLog["level"], module: textValue(row.module), code: textValue(row.code), message: textValue(row.message), context: parseJson<Record<string, unknown>>(row.context_json, {}) }; }
