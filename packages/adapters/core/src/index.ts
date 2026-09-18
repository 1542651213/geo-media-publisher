import type { SubmissionReconciliationRequest, SubmissionNegativeEvidence } from "@publisher/domain";
import type {
  AccountContext,
  XhsContextIdentityAttestation,
  AccountProfile,
  AdapterManifest,
  CredentialField,
  ErrorCode,
  LoginSession,
  LoginStatus,
  PlatformCapabilities,
  PlatformCapability,
  PublishArticleInput,
  PublishResult,
  PublishStatusResult,
  PublishVideoInput,
  ValidationResult
} from "@publisher/domain";
import { isAutomationAdapter, type AutomationAdapter } from "./automation";
import type { OneShotPublicationGuard } from "./one-shot-publication";
export * from "./one-shot-publication";

export type BrowserPublishReconciliationStatus = "FOUND_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "STILL_UNCERTAIN";

export interface BrowserPublishAttemptContext {
  jobId: string;
  submissionIntentId: string;
  attempt: number;
  /** Called immediately before the adapter triggers the real final-submit side effect. */
  markSubmissionSideEffect?: () => void;
  /** Ordinary PRODUCTION boundary; supplied only by Publisher after explicit snapshot confirmation. */
  productionPublicationGuard?: { contentSnapshotId: string; accountId: string; claim: (subject: XhsContextIdentityAttestation) => void };
  /** Present only for the explicitly owner-authorized, XHS one-shot publish path. */
  oneShotPublicationGuard?: OneShotPublicationGuard;
  /** Present only for the fixed Task10S action completing an already-uploaded retained editor. */
  task10sRetainedEditor?: true;
}

export interface BrowserPublishPreflightResult {
  response: Record<string, unknown>;
}

export interface BrowserPublishReconciliationInput {
  submissionIntentId?: string;
  contentSnapshotId?: string;
  jobId: string;
  articleId: string;
  title: string;
  accountName: string;
  windowStart: string;
  windowEnd: string;
  /** Explicit persisted gates required before a platform may assert a negative result. */
  waitWindowSatisfied?: boolean;
  submissionIntentState?: string | null;
  finalSubmitCount?: number;
  expectedExternalId?: string | null;
  expectedPublishedUrl?: string | null;
}

export interface BrowserPublishReconciliationResult {
  status: BrowserPublishReconciliationStatus;
  externalId?: string;
  publishedUrl?: string;
  titleMatch: boolean;
  accountMatch: boolean;
  timeWindowMatch: boolean;
  response: Record<string, unknown>;
  message: string;
}

export interface PlatformAdapter {
  readonly supportsBoundImageBuffers?: boolean;
  validatePreparedSession?(ctx: AccountContext, article: PublishArticleInput): Promise<void>;
  releasePreparedSession?(ctx: AccountContext): Promise<void>;
  readonly platformKey: string;
  readonly manifest: AdapterManifest;
  getCapabilities(): PlatformCapabilities;
  getCredentialSchema(): CredentialField[];
  checkLogin(ctx: AccountContext): Promise<LoginStatus>;
  beginLogin(ctx: AccountContext): Promise<LoginSession>;
  completeLogin?(ctx: AccountContext, code: string, state: string): Promise<unknown>;
  refreshLogin?(ctx: AccountContext): Promise<unknown>;
  getAccountProfile?(ctx: AccountContext): Promise<AccountProfile>;
  publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult>;
  /** Optional platform-specific no-click readiness check before the atomic submit claim. */
  prepareFinalSubmit?(ctx: AccountContext, article: PublishArticleInput): Promise<BrowserPublishPreflightResult>;
  /** Platform-specific L5 final submit. Generic adapters must remain fail-closed. */
  finalSubmit?(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult>;
  /** Platform-specific result collection after the one final submit action. */
  collectPublishResult?(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult>;
  /** Platform-specific read-only verification of the collected public result. */
  verifyPublished?(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult>;
  /** Platform-specific read-only reconciliation for an existing uncertain Job. */
  reconcile?(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult>;
  /** Read-only, authoritative terminal non-submission proof for the exact persisted
   * operation. No implementation means no unlock. NOT_FOUND is not sufficient.
   * Ordinary publish calls receive this operation id in settings.submissionOperationId. */
  inspectSubmission?(ctx: AccountContext, request: SubmissionReconciliationRequest): Promise<SubmissionNegativeEvidence | { status: "UNKNOWN" }>;
  /** Capability marker and direct implementation for a real external draft. Self-test orchestration still routes through the persistent Job Queue. */
  createDraft?(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult>;
  /** Optional reviewed cleanup capability. It must never be called without a separate user confirmation. */
  deleteContent?(ctx: AccountContext, externalId: string): Promise<{ deleted: boolean; response: Record<string, unknown> }>;
  publishVideo?(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult>;
  getPublishStatus?(ctx: AccountContext, externalId: string): Promise<PublishStatusResult>;
  validateArticle?(article: PublishArticleInput): Promise<ValidationResult>;
  validateVideo?(video: PublishVideoInput): Promise<ValidationResult>;
}

export type AdapterContentKind = "article" | "video";

export class PlatformAdapterError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly providerCode?: string) {
    super(message);
    this.name = "PlatformAdapterError";
  }
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter[]>();

  register(adapter: PlatformAdapter): void {
    if (!adapter.platformKey.trim() || adapter.platformKey !== adapter.manifest.platformKey) throw new Error(`Adapter key does not match manifest: ${adapter.platformKey}`);
    const capabilities = adapter.getCapabilities();
    if (adapter.manifest.supportsArticle !== capabilities.article) throw new Error(`Adapter article capability does not match manifest: ${adapter.platformKey}`);
    if (adapter.manifest.supportsVideo !== capabilities.video) throw new Error(`Adapter video capability does not match manifest: ${adapter.platformKey}`);
    const credentialKeys = adapter.getCredentialSchema().map((field) => field.key);
    if (new Set(credentialKeys).size !== credentialKeys.length) throw new Error(`Adapter credential schema contains duplicate keys: ${adapter.platformKey}`);
    if (adapter.manifest.transport !== "manual" && adapter.manifest.officialSources.length === 0) throw new Error(`Adapter official sources are required: ${adapter.platformKey}`);
    const registered = this.adapters.get(adapter.platformKey) ?? [];
    const overlaps = registered.some((candidate) =>
      (candidate.manifest.supportsArticle && adapter.manifest.supportsArticle)
      || (candidate.manifest.supportsVideo && adapter.manifest.supportsVideo)
    );
    if (overlaps) throw new Error(`Adapter content capability already registered: ${adapter.platformKey}`);
    this.adapters.set(adapter.platformKey, [...registered, adapter]);
  }

  get(platformKey: string): PlatformAdapter {
    const adapter = this.defaultAdapter(platformKey);
    if (!adapter) throw new Error(`No adapter registered for platform: ${platformKey}`);
    return adapter;
  }

  tryGet(platformKey: string): PlatformAdapter | null {
    return this.defaultAdapter(platformKey);
  }

  getForConnection(platformKey: string): PlatformAdapter {
    const connectionAdapters = this.connectionAdapters(platformKey);
    if (connectionAdapters.length > 1) throw new Error(`Multiple account connection adapters registered for platform: ${platformKey}`);
    return connectionAdapters[0] ?? this.get(platformKey);
  }

  tryGetForConnection(platformKey: string): PlatformAdapter | null {
    const connectionAdapters = this.connectionAdapters(platformKey);
    if (connectionAdapters.length > 1) throw new Error(`Multiple account connection adapters registered for platform: ${platformKey}`);
    return connectionAdapters[0] ?? this.tryGet(platformKey);
  }

  getAccountConnectionMode(platformKey: string): PlatformCapability | null {
    return this.tryGetForConnection(platformKey)?.manifest.integrationMode ?? null;
  }

  getForContent(platformKey: string, contentKind: string): PlatformAdapter {
    if (contentKind !== "article" && contentKind !== "video") throw new Error(`Unsupported content kind: ${contentKind}`);
    const candidates = (this.adapters.get(platformKey) ?? []).filter((adapter) => contentKind === "article" ? adapter.manifest.supportsArticle : adapter.manifest.supportsVideo);
    if (candidates.length === 0) throw new Error(`No adapter registered for platform: ${platformKey} and content kind: ${contentKind}`);
    if (candidates.length > 1) throw new Error(`Multiple adapters registered for platform: ${platformKey} and content kind: ${contentKind}`);
    return candidates[0];
  }

  list(): PlatformAdapter[] {
    return [...this.adapters.keys()].map((platformKey) => this.defaultAdapter(platformKey)).filter((adapter): adapter is PlatformAdapter => Boolean(adapter));
  }

  listAll(): PlatformAdapter[] {
    return [...this.adapters.values()].flat();
  }

  manifests(): AdapterManifest[] {
    return this.list().map((adapter) => adapter.manifest);
  }

  private defaultAdapter(platformKey: string): PlatformAdapter | null {
    const candidates = this.adapters.get(platformKey) ?? [];
    if (candidates.length <= 1) return candidates[0] ?? null;
    return candidates.find((adapter) => adapter.manifest.supportsVideo && !adapter.manifest.supportsArticle)
      ?? candidates.find((adapter) => adapter.manifest.supportsArticle && !adapter.manifest.supportsVideo)
      ?? null;
  }

  private connectionAdapters(platformKey: string): AutomationAdapter[] {
    return (this.adapters.get(platformKey) ?? []).filter(isAutomationAdapter);
  }
}

export const defaultCapabilities: PlatformCapabilities = {
  article: true,
  imagePost: false,
  video: false,
  coverImage: true,
  tags: true,
  categories: false,
  scheduledPublish: false,
  draft: true,
  markdown: false,
  richText: true,
  maxTitleLength: 100,
  maxImageCount: 9,
  maxTagCount: 10,
  videoFormats: [],
  supportsVideoCover: false,
  supportsVideoTags: false,
  videoPublishAsync: false
};

export * from "./browser";
export * from "./automation";
export * from "./oauth";
