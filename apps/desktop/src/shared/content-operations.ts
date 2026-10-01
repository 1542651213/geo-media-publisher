export const OPERATIONS_QUEUE_STATUSES = ["Pending", "Running", "Paused", "Completed", "Failed", "Cancelled"] as const;
export type OperationsQueueStatus = typeof OPERATIONS_QUEUE_STATUSES[number];
export const OPERATIONS_ITEM_STATUSES = ["Pending", "Running", "Completed", "Failed", "Cancelled", "Recoverable", "Blocked"] as const;
export type OperationsItemStatus = typeof OPERATIONS_ITEM_STATUSES[number];
export const OPERATIONS_PLAN_STATUSES = ["Planned", "DraftCreated", "Archived"] as const;
export type OperationsPlanStatus = typeof OPERATIONS_PLAN_STATUSES[number];
export const OPERATIONS_REVIEW_ACTIONS = ["approve", "return_to_draft", "archive"] as const;
export type OperationsReviewAction = typeof OPERATIONS_REVIEW_ACTIONS[number];
export const OPERATIONS_USAGE_RANGES = [1, 7, 30] as const;
export type OperationsUsageRange = typeof OPERATIONS_USAGE_RANGES[number];
export const OPERATIONS_RUNTIME_AUTH_STATES = ["CHECKING", "AUTHENTICATED", "CONNECTED", "NEEDS_LOGIN", "CREDENTIAL_INVALID", "IDENTITY_MISMATCH", "NETWORK_UNAVAILABLE", "UNVERIFIED", "DISABLED"] as const;
export type OperationsRuntimeAuthState = typeof OPERATIONS_RUNTIME_AUTH_STATES[number];
export interface OperationsRuntimeHealth { state: OperationsRuntimeAuthState; checkedAt: string | null }

export type OperationsErrorCode =
  | "COMPANY_NOT_FOUND"
  | "COMPANY_CONTEXT_MISMATCH"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_ALREADY_BOUND"
  | "ARTICLE_NOT_FOUND"
  | "ARTICLE_CONTENT_CHANGED"
  | "QUALITY_STATE_REQUIRED"
  | "PLAN_NOT_FOUND"
  | "FACT_NOT_FOUND"
  | "QUEUE_NOT_FOUND"
  | "QUEUE_STATE_INVALID"
  | "IMPORT_PREVIEW_INVALID";

export interface OperationsErrorDTO { code: OperationsErrorCode | string; message: string }

export interface OperationsAccountBinding {
  accountId: string;
  companyId: string;
  platformKey: string;
  accountAlias: string;
  accountName: string | null;
  enabled: boolean;
  loginStatus: string;
  boundAt: string;
  updatedAt: string;
}

export interface OperationsUnboundAccount { accountId: string; platformKey: string; accountName: string }

export interface OperationsReviewItem {
  articleId: string;
  companyId: string;
  title: string;
  source: string;
  aiGenerated: boolean;
  targetPlatforms: string[];
  articleStatus: string;
  reviewStatus: "Draft" | "AI_Checked" | "Needs_Review" | "Approved" | "Rejected";
  contentHash: string;
  validationWarnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentPlanItem {
  id: string;
  companyId: string;
  date: string;
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  status: OperationsPlanStatus;
  source: "Generated7" | "Generated30" | "Manual";
  articleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsPlanGenerationSeed {
  articleId: string;
  topic: string;
  targetPlatforms: string[];
}

export interface OperationsFact {
  id: string;
  companyId: string;
  category: string;
  statement: string;
  source: "Manual" | "Company Profile" | "Internal Document" | "Published Website" | "Verified Case";
  sourceDate: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  approvedForAI: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateWarningResult {
  companyId: string;
  exactTitleCount: number;
  exactBodyCount: number;
  matchedArticleIds: string[];
  warnings: string[];
}

export interface OperationsGenerationQueue {
  id: string;
  companyId: string;
  provider: string;
  model: string;
  profileId: string;
  templateId: string;
  templateVersion: number;
  topic: string;
  requestedCount: number;
  targetPlatforms: string[];
  completedCount: number;
  failedCount: number;
  status: OperationsQueueStatus;
  concurrency: number;
  executionPolicy: "SerialPerCompany";
  createdAt: string;
  updatedAt: string;
}

export interface OperationsGenerationItem {
  id: string;
  queueId: string;
  companyId: string;
  sourceIndex: number;
  itemKind: "Source" | "Variant";
  targetPlatform: string;
  status: OperationsItemStatus;
  attemptCount: number;
  generationId: string | null;
  sourceDraftId: string | null;
  outputArticleId: string | null;
  errorCode: string | null;
  availableAfter: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsUsageRow {
  provider: string;
  model: string;
  requestCount: number;
  successCount: number;
  failedCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  currency: string | null;
}

export interface OperationsOwnerAction {
  id: string;
  what: string;
  why: string;
  action: string;
  lastCheckedAt: string | null;
}

export interface OperationsDashboard {
  pendingReview: number;
  approved: number;
  draftPlansToday: number;
  generating: number;
  failed: number;
  needsOwnerAction: number;
  todayPublished: number;
}

export interface OperationsStudioDefaults {
  companyId: string;
  profileId: string | null;
  model: string | null;
  templateId: string | null;
  templateVersion: number | null;
  purpose: "生成文章" | "生成标题" | "改写" | "缩写" | "扩写" | "语气调整" | "SEO/GEO 改写" | "平台适配" | "多平台草稿";
  targetPlatforms: Array<typeof STUDIO_TARGETS[number]>;
  updatedAt: string | null;
}

export interface OperationsSnapshot {
  companyId: string;
  accounts: OperationsAccountBinding[];
  review: OperationsReviewItem[];
  plans: ContentPlanItem[];
  generationQueues: OperationsGenerationQueue[];
  generationItems: OperationsGenerationItem[];
  facts: OperationsFact[];
  usage: OperationsUsageRow[];
  studioDefaults: OperationsStudioDefaults;
  dashboard: OperationsDashboard;
  ownerActions: OperationsOwnerAction[];
}

export interface OperationsImportMapping {
  title: string;
  body: string;
  summary?: string;
  company?: string;
  business?: string;
  city?: string;
  keywords?: string;
  tags?: string;
  targetPlatforms?: string;
  contentType?: string;
  promotionStrength?: string;
  sourceNote?: string;
  templateVersion?: string;
}

export interface OperationsImportRowError { row: number; column: string; reason: string }
export interface OperationsImportPreviewRow { rowNumber: number; title: string; body: string; status: string; duplicate: boolean; errors: OperationsImportRowError[] }
export interface OperationsImportPreview { previewId: string; companyId: string; fileName: string; mapping: OperationsImportMapping; totalRows: number; validRows: number; duplicateRows: number; rows: OperationsImportPreviewRow[] }
export interface OperationsImportResult { imported: number; skippedDuplicates: number; failed: number; articleIds: string[] }

export interface OperationsApi {
  snapshot(companyId: string): Promise<OperationsSnapshot>;
  accountCompany(accountId: string): Promise<string | null>;
  listUnboundAccounts(): Promise<OperationsUnboundAccount[]>;
  bindAccount(input: { companyId: string; accountId: string }): Promise<OperationsAccountBinding>;
  reviewArticle(input: { companyId: string; articleId: string; action: OperationsReviewAction; expectedContentHash: string; reason?: string }): Promise<OperationsReviewItem>;
  generatePlan(input: { companyId: string; days: 7 | 30; startDate: string; targetPlatforms: string[] }): Promise<ContentPlanItem[]>;
  createPlanItem(input: { companyId: string; date: string; topic: string; contentType: string; targetPlatforms: string[] }): Promise<ContentPlanItem>;
  createDraftFromPlan(input: { companyId: string; planId: string; title: string; body: string }): Promise<{ articleId: string; plan: ContentPlanItem }>;
  preparePlanGeneration(input: { companyId: string; planId: string }): Promise<OperationsPlanGenerationSeed>;
  consumePlanGenerationSeed(companyId: string): Promise<OperationsPlanGenerationSeed | null>;
  saveFact(input: Omit<OperationsFact, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<OperationsFact>;
  activeFacts(companyId: string): Promise<OperationsFact[]>;
  getStudioDefaults(companyId: string): Promise<OperationsStudioDefaults>;
  saveStudioDefaults(input: Omit<OperationsStudioDefaults, "updatedAt">): Promise<OperationsStudioDefaults>;
  duplicateWarnings(input: { companyId: string; title: string; body: string }): Promise<DuplicateWarningResult>;
  usage(input: { companyId: string; days: OperationsUsageRange }): Promise<OperationsUsageRow[]>;
  createGenerationQueue(input: { companyId: string; topic: string; requestedCount: number; targetPlatforms: string[]; profileId: string; model: string; templateId: string; templateVersion: number; concurrency?: number }): Promise<OperationsGenerationQueue>;
  generationQueue(input: { companyId: string; queueId: string }): Promise<OperationsGenerationQueue>;
  runGenerationQueue(input: { companyId: string; queueId: string }): Promise<OperationsGenerationQueue>;
  pauseGenerationQueue(input: { companyId: string; queueId: string }): Promise<OperationsGenerationQueue>;
  resumeGenerationQueue(input: { companyId: string; queueId: string }): Promise<OperationsGenerationQueue>;
  cancelGenerationQueue(input: { companyId: string; queueId: string }): Promise<OperationsGenerationQueue>;
  retryFailedGeneration(input: { companyId: string; queueId: string }): Promise<OperationsGenerationQueue>;
  reconcileGenerationQueue(input: { companyId: string; queueId: string }): Promise<OperationsGenerationQueue>;
  resolveValidationGeneration(input: { companyId: string; queueId: string; itemId: string; decision: "regenerate" | "cancel" }): Promise<OperationsGenerationQueue>;
  resolveRecoverableGeneration(input: { companyId: string; queueId: string; itemId: string; decision: "retry" | "cancel" }): Promise<OperationsGenerationQueue>;
  previewImport(input: { companyId: string; fileName: string; rows: Array<Record<string, string>>; mapping: OperationsImportMapping }): Promise<OperationsImportPreview>;
  commitImport(input: { companyId: string; previewId: string; duplicateRowNumbers?: number[] }): Promise<OperationsImportResult>;
}
import type { STUDIO_TARGETS } from "@publisher/domain";
