import { createHash } from "node:crypto";
import { isAutomationAdapter, withUserInitiatedActionSettings, type AdapterRegistry, type BrowserExecutionMode, type BrowserPublishAttemptContext, type BrowserPublishReconciliationResult, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import type { AppRepository } from "@publisher/db";
import { canReuseArticle, decideFailure, validatePlatformArticle, type Account, type AdapterManifest, type ErrorCode, type PlatformCapability, type PublishArticleInput, type PublishJob, type PublishMode, type PublishResult, type PublishStatusResult, type PublishVideoInput } from "@publisher/domain";
import { freezeDouyinImageText, type DouyinMusicBinding } from "@publisher/domain/douyin-image-text";
import type { Logger } from "@publisher/logger";
import { GlobalPublishExecutionGate } from "./global-publish-execution-gate";
export { GlobalPublishExecutionGate } from "./global-publish-execution-gate";

export interface PublishExecutionResult { job: PublishJob; message: string; }
export interface AssistedPrepareResult { job: PublishJob; record: ReturnType<AppRepository["getPublishRecordByJob"]>; message: string; }

/** Only the Douyin image-post route can prove a failed preflight never reserved a final attempt. */
export function douyinPreBoundaryFailure(input: { platformKey: string; platformFinalSubmitPath: boolean;
  sideEffectTriggered: boolean; intent: { state: string; finalSubmitCount: number;
    submitBoundaryEnteredAt: string | null; submissionAttemptId: string | null } | null }): boolean {
  const { intent } = input;
  return input.platformKey === "douyin" && input.platformFinalSubmitPath && !input.sideEffectTriggered
    && intent?.state === "Prepared" && intent.finalSubmitCount === 0
    && !intent.submitBoundaryEnteredAt && !intent.submissionAttemptId;
}

export interface PublisherOptions {
  resolveSecrets?: (accountId: string, platformKey: string) => Record<string, string>;
  accountFailurePauseThreshold?: number;
  platformFailurePauseThreshold?: number;
  operationTimeoutMs?: number;
  loginCheckTimeoutMs?: number;
  statusCheckTimeoutMs?: number;
  publishPollingTimeoutMs?: number;
  reconciliationWaitMs?: number;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: "TIMEOUT" })), timeoutMs);
  });
  return Promise.race([operation, expired]).finally(() => { if (timeout) clearTimeout(timeout); });
}

function errorCode(error: unknown): ErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    const allowed: ErrorCode[] = ["NETWORK_ERROR", "LOGIN_EXPIRED", "AUTH_REQUIRED", "USER_ACTION_REQUIRED", "UPLOAD_FAILED", "PLATFORM_CHANGED", "CONTENT_REJECTED", "RATE_LIMITED", "PERMISSION_DENIED", "API_REVIEW_REQUIRED", "PROCESSING", "TIMEOUT", "SUBMISSION_UNCERTAIN", "FINAL_SUBMIT_ALREADY_USED", "FINAL_SUBMIT_CONTROL_NOT_FOUND", "REQUIRED_FIELD_MISSING", "EXTERNAL_EVIDENCE_INCOMPLETE", "RECONCILIATION_UNCERTAIN", "CONFIRMED_NOT_PUBLISHED", "ARTICLE_API_SUBMIT_NOT_IMPLEMENTED", "TRANSPORT_FALLBACK_FORBIDDEN", "UNKNOWN"];
    if (typeof code === "string" && allowed.includes(code as ErrorCode)) return code as ErrorCode;
  }
  return "UNKNOWN";
}

function inferredAutomationType(manifest: AdapterManifest): PlatformCapability {
  if (manifest.integrationMode) return manifest.integrationMode;
  if (manifest.transport === "browser") return "BrowserAutomation";
  if (manifest.transport === "semi_auto") return "SemiAuto";
  if (manifest.transport === "manual") return "Manual";
  if (manifest.authStrategy === "OAuth2" || manifest.authStrategy === "OAuth2PKCE") return "OAuth";
  return "API";
}

function operationSettings(
  settings: Record<string, string | number | boolean>,
  action?: UserInitiatedAction,
  browserExecutionMode?: BrowserExecutionMode
): Record<string, string | number | boolean> {
  return {
    ...withUserInitiatedActionSettings(settings, action),
    ...(browserExecutionMode ? { browserExecutionMode } : {})
  };
}

function publishInputHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function douyinMandatorySelections(value: unknown): Array<{ key: string; value: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || typeof item.key !== "string" || typeof item.value !== "string"))
    throw Object.assign(new Error("Douyin mandatory settings snapshot is invalid"), { code: "CONTENT_REJECTED" });
  return value.map((item: { key: string; value: string }) => ({ key: item.key, value: item.value }));
}

function douyinMusicBinding(value: unknown): DouyinMusicBinding | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Douyin music binding is invalid"), { code: "CONTENT_REJECTED" });
  const item = value as Record<string, unknown>;
  if (item.mode === "NONE") return { mode: "NONE" };
  if (item.mode === "AUTO_RECOMMENDED" && typeof item.identity === "string" && typeof item.title === "string"
    && typeof item.artist === "string" && typeof item.duration === "string"
    && (item.trackId === null || typeof item.trackId === "string"))
    return { mode: "AUTO_RECOMMENDED", identity: item.identity, trackId: item.trackId as string | null,
      title: item.title, artist: item.artist, duration: item.duration };
  throw Object.assign(new Error("Douyin music binding is invalid"), { code: "CONTENT_REJECTED" });
}

/** Persist only reviewed public-read flags; never copy arbitrary adapter response text. */
function publicVerificationEvidence(verification: PublishStatusResult): Record<string, unknown> {
  const evidence: Record<string, unknown> = { status: verification.status,
    errorCode: errorCode({ code: verification.errorCode ?? verification.response.errorCode }) };
  for (const key of ["verified", "urlReachable", "titleMatch", "bodyMatch"] as const)
    if (typeof verification.response[key] === "boolean") evidence[key] = verification.response[key];
  for (const key of ["blockedContentMutationCount", "blockedUnknownRequestCount", "domReadAttempts"] as const) {
    const value = verification.response[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) evidence[key] = value;
  }
  return evidence;
}

/** Shared by normal preparation and the explicitly approved self-test path. */
export function hashPreparedBrowserArticleInput(input: PublishArticleInput): string {
  return publishInputHash({ articleId: input.articleId, title: input.title, body: input.body, summary: input.summary, tags: input.tags,
    ...(input.coverPath !== undefined ? { coverPath: input.coverPath } : {}), ...(input.images !== undefined ? { images: input.images } : {}),
    ...(input.variantId !== undefined ? { variantId: input.variantId } : {}), ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}), ...(input.topic !== undefined ? { topic: input.topic } : {}) });
}

function usesBrowserManagementReconciliation(adapter: PlatformAdapter): boolean {
  const capabilities = adapter.getCapabilities();
  return capabilities.browserManagementReconciliation === true
    && (capabilities.contentTransport === "ARTICLE_BROWSER" || capabilities.contentTransport === "DOUYIN_IMAGE_TEXT_BROWSER");
}

function browserIdentitySettings(account: Account, required: boolean, douyinConnection?: ReturnType<AppRepository["getDouyinImageTextConnection"]>): Record<string, string | number> {
  if (!required) return {};
  const expectedCreatorId = account.platformKey === "douyin" ? (douyinConnection?.active ? douyinConnection.creatorId : null) : account.externalAccountId?.trim();
  if (!expectedCreatorId) throw Object.assign(new Error("Browser publishing requires a verified stable account identity"), { code: "USER_ACTION_REQUIRED" });
  return { expectedCreatorId, ...(account.platformKey === "douyin" ? { expectedLoginGeneration: douyinConnection!.loginGeneration } : {}) };
}

function publishRecordMetadata(manifest: AdapterManifest, job: PublishJob, account: Account, result: PublishResult): {
  publishMode: PublishMode;
  automationType: PlatformCapability;
  browserSessionIdHash: string | null;
  operator: string;
  verificationStatus: "NotTested" | "WaitingUser" | "Verified" | "Failed";
  editorOpenedAt: string | null;
  titleFilled: boolean | null;
  bodyFilled: boolean | null;
  selectedImageAssetId: string | null;
  imageSelectionMode: "random" | "manual" | "none";
} {
  const response = result.response;
  const browserSessionIdHash = typeof response.browserSessionIdHash === "string" ? response.browserSessionIdHash : null;
  const verificationStatus = response.verificationStatus === "WaitingUser" || job.dryRun ? "WaitingUser" : result.success ? "Verified" : "Failed";
  const automationType = inferredAutomationType(manifest);
  return {
    publishMode: automationType === "Manual" || job.finalPublishMode === "PREPARE_ONLY" ? "MANUAL" : job.finalPublishMode === "AUTO_PUBLISH" && !job.manualConfirmationRequired ? "AUTO" : "ASSISTED",
    automationType,
    browserSessionIdHash,
    operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user",
    verificationStatus,
    editorOpenedAt: result.editorOpenedAt ?? null,
    titleFilled: result.titleFilled ?? null,
    bodyFilled: result.bodyFilled ?? null,
    selectedImageAssetId: job.selectedImageAssetId ?? null,
    imageSelectionMode: job.imageSelectionMode ?? "none"
  };
}

export class PublisherService {
  private readonly formalExecutionGate: GlobalPublishExecutionGate;
  constructor(private readonly repository: AppRepository, private readonly adapters: AdapterRegistry, private readonly logger: Logger, private readonly options: PublisherOptions = {}) {
    this.formalExecutionGate = GlobalPublishExecutionGate.forRepository(repository);
  }

  isPlatformRegistered(platformKey: string): boolean {
    return this.adapters.tryGet(platformKey) !== null;
  }

  isBrowserAutomationPlatform(platformKey: string, contentKind?: string): boolean {
    let adapter = this.adapters.tryGet(platformKey);
    if (contentKind) {
      try { adapter = this.adapters.getForContent(platformKey, contentKind); }
      catch { return false; }
    }
    if (!adapter) return false;
    const manifest = adapter.manifest;
    return manifest.integrationMode === "BrowserAutomation" || manifest.transport === "browser";
  }

  async reconcileBrowserJob(jobId: string, action?: UserInitiatedAction): Promise<PublishExecutionResult> {
    const job = this.repository.getJob(jobId);
    if (!job) throw new Error("Publish job not found");
    const adapter = this.adapters.getForContent(job.platformKey, job.contentKind ?? "article");
    const managementReconciliation = usesBrowserManagementReconciliation(adapter);
    if (job.status !== "NeedsReconciliation" && !(managementReconciliation && ["Submitted", "Publishing"].includes(job.status))) throw new Error("只有已提交或 NeedsReconciliation Job 才能执行浏览器只读回查");
    const account = this.repository.listAccounts().find((item) => item.id === job.accountId);
    const article = this.repository.getArticle(job.articleId);
    if (!account || !article) throw new Error("关联账号或文章不存在");
    if (!adapter.reconcile) return { job, message: "STILL_UNCERTAIN: 当前平台没有经过审阅的只读内容列表回查契约，未重试" };
    const douyinConnection = job.platformKey === "douyin" ? this.repository.getDouyinImageTextConnection(account.id) : null;
    const expectedCreatorId = job.platformKey === "douyin" ? douyinConnection?.creatorId : account.externalAccountId;
    const ctx = { accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({ dryRun: false, manualConfirmationRequired: true, ...browserIdentitySettings(account, managementReconciliation, douyinConnection) }, action, "VISIBLE"), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) };
    const variant = job.articleVariantId ? this.repository.getArticleVariant(job.articleVariantId) : null;
    const selectedImage = job.selectedImageAssetId ? this.repository.getImageAsset(job.selectedImageAssetId) : null;
    const input = { articleId: article.id, title: variant?.title ?? article.title, body: variant?.body ?? article.body, summary: variant?.summary ?? article.summary, tags: article.tags, ...(selectedImage ? { images: [selectedImage.filePath] } : {}) };
    const intent = this.repository.getSubmissionIntentByJob(job.id);
    const existingRecord = this.repository.getPublishRecordByJob(job.id);
    if (managementReconciliation && (!intent || intent.finalSubmitCount !== 1)) throw new Error("Toutiao management reconciliation requires a persisted final submit claim");
    if (managementReconciliation && typeof existingRecord?.response.expectedCreatorId === "string"
      && existingRecord.response.expectedCreatorId !== expectedCreatorId) throw Object.assign(new Error("Browser reconciliation account identity differs from the prepared binding"), { code: "USER_ACTION_REQUIRED" });
    if (job.platformKey === "douyin") {
      const preparedGeneration = existingRecord?.response.expectedLoginGeneration;
      if (preparedGeneration === undefined) {
        // Earlier accepted responses replaced the Prepared response without this field. The one-time
        // file-selection claim is durable and can recover the original binding for read-only lookup.
        const selection = this.repository.getPublishPayload(job.id).douyinImageSelection;
        const claim = selection && typeof selection === "object" && !Array.isArray(selection)
          ? selection as Record<string, unknown> : null;
        const original = selectedImage && expectedCreatorId && job.imageSelectionMode === "manual"
          && selectedImage.brandId === article.brandId
          ? await freezeDouyinImageText({ articleId: article.id, accountId: account.id, creatorId: expectedCreatorId,
            title: input.title, body: input.body, imagePaths: [selectedImage.filePath], topics: [],
            visibility: "public", scheduledAt: null }) : null;
        if (!douyinConnection?.active || !existingRecord || !claim || !original
          || existingRecord.accountId !== account.id || existingRecord.articleId !== article.id
          || existingRecord.selectedImageAssetId !== selectedImage?.id
          || existingRecord.browserSessionIdHash !== douyinConnection.browserSessionIdHash
          || existingRecord.response.expectedCreatorId !== douyinConnection.creatorId
          || existingRecord.response.contentTransport !== adapter.getCapabilities().contentTransport
          || existingRecord.response.preparedInputHash !== hashPreparedBrowserArticleInput(input)
          || claim.stage !== "FILE_SELECTION_DISPATCHED" || typeof claim.operationId !== "string" || !claim.operationId
          || claim.accountId !== account.id || claim.articleId !== article.id
          || claim.sessionIdHash !== douyinConnection.browserSessionIdHash
          || claim.loginGeneration !== douyinConnection.loginGeneration
          || claim.imageSha256 !== original.imageHashes[0]
          || claim.sourceContentHash !== original.sourceContentHash)
          throw Object.assign(new Error("Douyin legacy reconciliation binding cannot be uniquely verified"), { code: "USER_ACTION_REQUIRED" });
      } else if (preparedGeneration !== douyinConnection?.loginGeneration) {
        throw Object.assign(new Error("Douyin login generation changed after preparation"), { code: "USER_ACTION_REQUIRED" });
      }
    }
    const boundaryAt = intent?.submitBoundaryEnteredAt ?? job.startedAt ?? job.createdAt;
    const createdAt = Date.parse(managementReconciliation ? boundaryAt : job.startedAt ?? job.createdAt);
    const windowStart = Number.isFinite(createdAt) ? new Date(createdAt - (managementReconciliation ? 15 : 5) * 60_000).toISOString() : job.createdAt;
    const windowEnd = managementReconciliation && Number.isFinite(createdAt) ? new Date(createdAt + 15 * 60_000).toISOString() : new Date().toISOString();
    const expectedExternalId = managementReconciliation
      ? [existingRecord?.publishedExternalId, intent?.externalId].find((value) => typeof value === "string" && /^[1-9]\d*$/u.test(value)) ?? null
      : existingRecord?.publishedExternalId ?? intent?.externalId ?? null;
    const submittedAt = Date.parse(intent?.updatedAt ?? job.finishedAt ?? job.startedAt ?? job.createdAt);
    const waitWindowSatisfied = intent?.state === "Unknown"
      && Number.isFinite(submittedAt)
      && Date.now() >= submittedAt + (this.options.reconciliationWaitMs ?? 30_000);
    const result: BrowserPublishReconciliationResult = await withTimeout(adapter.reconcile(ctx, {
      jobId: job.id,
      articleId: article.id,
      title: input.title,
      accountName: account.name,
      windowStart,
      windowEnd,
      waitWindowSatisfied,
      submissionIntentState: intent?.state ?? null,
      finalSubmitCount: intent?.finalSubmitCount ?? 0,
      expectedExternalId,
      expectedPublishedUrl: existingRecord?.publishedUrl ?? null,
      ...(managementReconciliation ? { expectedCreatorId: expectedCreatorId!, submittedAt: boundaryAt } : {})
    }), this.options.operationTimeoutMs ?? 120_000, "Browser publish reconciliation").catch((error: unknown) => {
      if (!managementReconciliation) throw error;
      return { status: "STILL_UNCERTAIN" as const, remoteState: "UNKNOWN" as const, titleMatch: false, accountMatch: false, timeWindowMatch: false,
        response: { readOnly: true, errorCode: errorCode(error) }, message: "Management read failed; no submit was attempted" };
    });
    const preserveUncertain = (message: string, observed?: { externalId: string; publishedUrl: string; verification: PublishStatusResult }): PublishExecutionResult => {
      if (managementReconciliation && intent) {
        const uncertain = this.repository.markSubmissionIntentUncertain(intent.id, "RECONCILIATION_UNCERTAIN");
        if (existingRecord) this.repository.updatePublishRecord(existingRecord.id, { status: "Submitted", success: false,
          ...(observed ? { publishedExternalId: observed.externalId, publishedUrl: observed.publishedUrl } : {}),
          response: { ...existingRecord.response, reconciliation: result.response, managementState: result.remoteState ?? "UNKNOWN",
            ...(observed ? { publishedCandidateObserved: true, publishedCandidateSource: "MATCHED_MANAGEMENT_ROW",
              verification: publicVerificationEvidence(observed.verification) } : {}) }, verificationStatus: "WaitingUser" });
        return { job: uncertain, message };
      }
      return { job, message };
    };
    const matchedByTrustedId = managementReconciliation && Boolean(expectedExternalId && result.externalId === expectedExternalId
      && result.response.matchedBy === "REMOTE_ID" && result.accountMatch);
    if (managementReconciliation) {
      const matchedTarget = matchedByTrustedId || result.titleMatch && result.accountMatch && result.timeWindowMatch;
      if (matchedTarget && (result.remoteState === "REVIEWING" || result.remoteState === "SCHEDULED")) {
        const accepted = this.repository.reconcileJobAsSubmitted(job.id, { response: { ...result.response, managementState: result.remoteState },
          externalId: result.externalId ?? null, remoteStatus: result.remoteState === "SCHEDULED" ? "SCHEDULED_ACCEPTED" : "SUBMIT_ACCEPTED" });
        return { job: accepted.job, message: result.remoteState === "REVIEWING" ? "SUBMITTED_REVIEWING: 目标作品审核中，未再次提交" : "SCHEDULED_ACCEPTED: 目标作品定时待发布，未再次提交" };
      }
      if (matchedTarget && result.remoteState === "REJECTED") {
        this.repository.updateSubmissionRemoteStatus(job.id, "FAILED_CONFIRMED", false);
        if (existingRecord) this.repository.updatePublishRecord(existingRecord.id, { status: "Failed", success: false,
          response: { ...existingRecord.response, reconciliation: result.response, managementState: "REJECTED" }, verificationStatus: "Failed" });
        return { job: this.repository.updateJobFailure(job.id, "Failed", "CONTENT_REJECTED", "The uniquely matched remote article was rejected", null), message: "REJECTED: 已确认目标作品未通过，提交计数保留，未重试" };
      }
      if (!matchedTarget || result.remoteState !== "PUBLISHED") return preserveUncertain(`STILL_UNCERTAIN: ${result.remoteState ?? "UNKNOWN"}; no resubmission permitted`);
    }
    if (result.status === "FOUND_PUBLISHED") {
      if (job.platformKey === "douyin" && matchedByTrustedId && result.remoteState === "PUBLISHED" && result.externalId) {
        const verification = result.publishedUrl && adapter.verifyPublished
          ? await withTimeout(adapter.verifyPublished(ctx, input, { externalId: result.externalId, publishedUrl: result.publishedUrl }),
            this.options.operationTimeoutMs ?? 120_000, "Douyin public read-only verification").catch((error: unknown) => ({
              status: "publishing" as const, response: { errorCode: errorCode(error), publicVerification: "LIMITED" } }))
          : { status: "publishing" as const, response: { publicVerification: "LIMITED", reason: "PUBLIC_URL_UNAVAILABLE" } };
        const publicVerified = verification.status === "published" && verification.externalId === result.externalId
          && verification.response.urlReachable === true && verification.response.titleMatch === true
          && verification.response.bodyMatch === true && verification.response.imageMatch === true;
        const reconciled = this.repository.reconcileJobAsPublished(job.id, { externalId: result.externalId,
          publishedUrl: result.publishedUrl ?? null, publicVerified,
          response: { ...existingRecord?.response, reconciliation: result.response, verification: verification.response,
            publicVerification: publicVerified ? "CONFIRMED" : "LIMITED" } });
        return { job: reconciled.job, message: publicVerified
          ? `PUBLISHED_CONFIRMED: Douyin work and public page verified (PublishRecord ${reconciled.record.id})`
          : `PUBLISHED: Douyin management row verified; public verification limited (PublishRecord ${reconciled.record.id})` };
      }
      if (!result.externalId || !result.publishedUrl || !(matchedByTrustedId || result.titleMatch && result.accountMatch && result.timeWindowMatch) || !adapter.verifyPublished) return preserveUncertain("STILL_UNCERTAIN: 回查未同时取得真实 External ID、URL、目标身份和匹配证据，未写入成功");
      const verification = await withTimeout(adapter.verifyPublished(ctx, input, { externalId: result.externalId, publishedUrl: result.publishedUrl }), this.options.operationTimeoutMs ?? 120_000, "Browser publish result verification").catch((error: unknown) => {
        if (!managementReconciliation) throw error;
        return { status: "failed" as const, response: { errorCode: errorCode(error) }, errorMessage: "Public read failed" };
      });
      if (verification.status !== "published" || !verification.externalId || !verification.publishedUrl
        || managementReconciliation && (verification.externalId !== result.externalId || verification.response.urlReachable !== true
          || verification.response.titleMatch !== true || verification.response.bodyMatch !== true)) {
        let observed: { externalId: string; publishedUrl: string; verification: PublishStatusResult } | undefined;
        if (managementReconciliation && /^[1-9]\d*$/u.test(result.externalId)) {
          try {
            const candidateUrl = new URL(result.publishedUrl);
            if (["https:", "http:"].includes(candidateUrl.protocol) && !candidateUrl.username && !candidateUrl.password)
              observed = { externalId: result.externalId, publishedUrl: `${candidateUrl.origin}${candidateUrl.pathname}`, verification };
          } catch { /* Malformed public evidence is never promoted to a trusted ID. */ }
        }
        return preserveUncertain(`STILL_UNCERTAIN: 回收结果验证未通过，保持 NeedsReconciliation（${verification.errorMessage ?? "external result verification failed"}）`,
          observed);
      }
      const reconciled = this.repository.reconcileJobAsPublished(job.id, { externalId: verification.externalId, publishedUrl: verification.publishedUrl, response: { reconciliation: result.response, verification: verification.response } });
      this.logger.info("PUBLISHER", "BROWSER_RECONCILIATION_FOUND", "只读浏览器回查找到并验证了已发布内容", { jobId: job.id, platformKey: job.platformKey, externalId: verification.externalId, publishedUrl: verification.publishedUrl });
      return { job: reconciled.job, message: `FOUND_PUBLISHED: 已回收并保存真实 External ID/URL（PublishRecord ${reconciled.record.id}）` };
    }
    if (result.status === "CONFIRMED_NOT_PUBLISHED") {
      const failed = this.repository.markJobReconciledNotPublished(job.id, result.message, result.response);
      this.logger.info("PUBLISHER", "BROWSER_RECONCILIATION_NOT_PUBLISHED", "只读浏览器回查确认平台未发布，未创建重试", { jobId: job.id, platformKey: job.platformKey });
      return { job: failed, message: "CONFIRMED_NOT_PUBLISHED: 已确认未发布，Job 已收口为 ReconciledNotPublished，未创建或触发重试" };
    }
    return { job, message: `STILL_UNCERTAIN: ${result.message}; evidence=${JSON.stringify(result.response).slice(0, 12_000)}` };
  }

  private resolveBrowserExecutionMode(platformKey: string, requestedMode?: BrowserExecutionMode, contentKind?: string): BrowserExecutionMode {
    if (!this.isBrowserAutomationPlatform(platformKey, contentKind) || requestedMode === "VISIBLE") return "VISIBLE";
    if (usesBrowserManagementReconciliation(this.adapters.getForContent(platformKey, contentKind ?? "article"))) return "VISIBLE";
    const preferenceAllowsBackground = this.repository.getSettings().browserPublishMode === "background";
    const platformAllowsBackground = this.repository.listPlatforms().find((platform) => platform.platformKey === platformKey)?.backgroundAutomationStatus === "PASSED";
    return preferenceAllowsBackground && platformAllowsBackground ? "BACKGROUND" : "VISIBLE";
  }

  async checkAccountLogin(accountId: string, action?: UserInitiatedAction, _browserExecutionMode?: BrowserExecutionMode): Promise<void> {
    const account = this.repository.listAccounts().find((item) => item.id === accountId);
    if (!account || !account.enabled) return;
    try {
      const adapter = this.adapters.get(account.platformKey);
      const login = await withTimeout(adapter.checkLogin({ accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({}, action, "VISIBLE"), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) }), this.options.loginCheckTimeoutMs ?? 30_000, "Platform login check");
      if (login === "logged_in") this.repository.updateAccount(account.id, { loginStatus: "logged_in", pausedReason: null, failedCount: 0 });
      else if (login === "expired" || login === "logged_out") this.repository.updateAccount(account.id, { enabled: false, loginStatus: "expired", pausedReason: "Account login expired; user action required" });
      else if (login === "needs_user_action") this.repository.updateAccount(account.id, { loginStatus: "needs_user_action", pausedReason: "Platform verification requires user action" });
    } catch (error) {
      this.logger.warn("ACCOUNT", "LOGIN_CHECK_FAILED", error instanceof Error ? error.message : "Account login check failed", { accountId });
    }
  }

  async prepareArticle(jobId: string, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode): Promise<AssistedPrepareResult> {
    const job = this.repository.getJob(jobId);
    if (!job) throw new Error("Publish job not found");
    const adapter = this.adapters.getForContent(job.platformKey, job.contentKind ?? "article");
    const managementReconciliation = usesBrowserManagementReconciliation(adapter);
    const frozenTransport = this.repository.getFrozenContentTransport(job.id);
    if (managementReconciliation && frozenTransport && frozenTransport !== adapter.getCapabilities().contentTransport)
      throw Object.assign(new Error("The Job is bound to another content transport; browser preparation is forbidden"), { code: "TRANSPORT_FALLBACK_FORBIDDEN" });
    const existing = this.repository.getPublishRecordByJob(job.id);
    const priorIntent = managementReconciliation ? this.repository.getSubmissionIntentByJob(job.id) : null;
    if (managementReconciliation && (priorIntent && (priorIntent.finalSubmitCount >= 1 || priorIntent.submitBoundaryEnteredAt
      || priorIntent.state === "Unknown" || priorIntent.remoteStatus === "UNCERTAIN")
      || ["Submitted", "Publishing", "NeedsReconciliation", "Success"].includes(job.status)))
      throw Object.assign(new Error("Toutiao final submission is already claimed or uncertain; editor preparation cannot be repeated"), { code: "FINAL_SUBMIT_ALREADY_USED" });
    if (existing?.status === "Prepared" && !managementReconciliation) return { job, record: existing, message: "知乎编辑器准备记录已存在，未重复打开或写入" };
    if (job.status !== "AwaitingConfirmation" && !(managementReconciliation && existing?.status === "Prepared" && job.status === "NeedsUserAction")) throw new Error("文章发布任务当前不是 AwaitingConfirmation 状态");
    const account = this.repository.listAccounts().find((item) => item.platformAccountId === job.platformAccountId && item.platformKey === job.platformKey);
    const article = this.repository.getArticle(job.articleId);
    if (!account || !article) throw new Error("关联账号或文章不存在");
    this.repository.assertArticlePublishAllowed(article.id);
    if (!isAutomationAdapter(adapter)) throw Object.assign(new Error("当前平台没有浏览器辅助发布能力"), { code: "PERMISSION_DENIED" });
    const douyinSettings = job.platformKey === "douyin" ? this.repository.getDouyinImageTextJobSettings(job.id) : null;
    if (job.platformKey === "douyin" && !douyinSettings) throw Object.assign(new Error("Douyin Owner-selected image/text settings are missing"), { code: "CONTENT_REJECTED" });
    const effectiveBrowserExecutionMode = this.resolveBrowserExecutionMode(job.platformKey, browserExecutionMode, job.contentKind ?? "article");
    const douyinConnection = job.platformKey === "douyin" ? this.repository.getDouyinImageTextConnection(account.id) : null;
    const expectedCreatorId = job.platformKey === "douyin" ? douyinConnection?.creatorId : account.externalAccountId;
    const ctx = { accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({ dryRun: false, manualConfirmationRequired: true, ...browserIdentitySettings(account, managementReconciliation, douyinConnection), ...(douyinSettings ? { expectedVisibility: douyinSettings.visibility, expectedMusicMode: douyinSettings.musicMode ?? "NONE", recentDouyinMusicJson: JSON.stringify(this.repository.getRecentDouyinImageTextMusic(account.id)), publishJobId: job.id } : {}) }, action, effectiveBrowserExecutionMode), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) };
    const login = await withTimeout(adapter.checkLogin(ctx), this.options.loginCheckTimeoutMs ?? 30_000, "Platform login check");
    if (login !== "logged_in") throw Object.assign(new Error(`${managementReconciliation ? "头条" : "知乎"}账号 Session 未通过登录检查，请先完成正常登录验证`), { code: login === "expired" || login === "logged_out" ? "LOGIN_EXPIRED" : "USER_ACTION_REQUIRED" });
    const variant = job.articleVariantId ? this.repository.getArticleVariant(job.articleVariantId) : null;
    const selectedImage = job.selectedImageAssetId ? this.repository.getImageAsset(job.selectedImageAssetId) : null;
    const coverId = job.platformKey === "toutiao" && managementReconciliation ? variant?.coverAssetId ?? article.coverAssetId : null;
    const cover = coverId ? this.repository.getMediaAsset(coverId) : null;
    const input = { articleId: article.id, title: variant?.title ?? article.title, body: variant?.body ?? article.body, summary: variant?.summary ?? article.summary, tags: article.tags, ...(cover ? { coverPath: cover.filePath } : {}), ...(selectedImage ? { images: [selectedImage.filePath] } : {}) };
    const frozenDouyin = job.platformKey === "douyin" ? await (async () => {
      if (!selectedImage || job.imageSelectionMode !== "manual" || selectedImage.brandId !== article.brandId)
        throw Object.assign(new Error("Douyin image must be manually selected from the same Article brand"), { code: "CONTENT_REJECTED" });
      return freezeDouyinImageText({ articleId: article.id, accountId: account.id, creatorId: expectedCreatorId ?? "",
        title: input.title, body: input.body, imagePaths: [selectedImage.filePath], topics: [], visibility: douyinSettings!.visibility, scheduledAt: null });
    })() : null;
    const existingFrozenDouyin = frozenDouyin && existing
      ? await freezeDouyinImageText({ ...frozenDouyin, mandatorySelections: douyinMandatorySelections(existing.response.mandatorySelections), musicBinding: douyinMusicBinding(existing.response.musicBinding) }) : frozenDouyin;
    if (managementReconciliation && existing && (existing.status !== "Prepared" || existing.response.contentTransport !== adapter.getCapabilities().contentTransport
      || existing.response.preparedInputHash !== hashPreparedBrowserArticleInput(input) || existing.response.expectedCreatorId !== expectedCreatorId
      || job.platformKey === "douyin" && existing.response.expectedLoginGeneration !== douyinConnection?.loginGeneration
      || existingFrozenDouyin && (existing.response.sourceContentHash !== existingFrozenDouyin.sourceContentHash
        || existing.response.contentBindingHash !== existingFrozenDouyin.contentBindingHash
        || JSON.stringify(existing.response.imageHashes) !== JSON.stringify(existingFrozenDouyin.imageHashes))))
      throw Object.assign(new Error("Toutiao preparation recovery must preserve the frozen content, transport and identity"), { code: "CONTENT_REJECTED" });
    const validation = await adapter.validateArticle(input);
    if (!validation.valid) throw Object.assign(new Error(validation.errors.join("；")), { code: "CONTENT_REJECTED" });
    if (selectedImage) this.logger.info("PUBLISHER", "IMAGE_UPLOAD_STARTED", "开始向平台编辑器上传任务主图", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
    const prepared = await withTimeout(adapter.preparePublish(ctx, input), this.options.operationTimeoutMs ?? 120_000, "Platform assisted prepare").catch((error: unknown) => {
      if (errorCode(error) === "UPLOAD_FAILED") this.logger.error("PUBLISHER", "IMAGE_UPLOAD_FAILED", error instanceof Error ? error.message : "图片上传失败", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage?.id ?? null });
      if (job.platformKey === "douyin" && job.contentKind === "article") {
        const currentJob = this.repository.getJob(job.id);
        const selection = this.repository.getPublishPayload(job.id).douyinImageSelection;
        const claim = selection && typeof selection === "object" && !Array.isArray(selection)
          ? selection as Record<string, unknown> : null;
        if (currentJob?.status === "AwaitingConfirmation" && currentJob.accountId === account.id
          && currentJob.articleId === article.id && claim?.stage === "FILE_SELECTION_DISPATCHED"
          && typeof claim.operationId === "string" && claim.operationId.length > 0
          && claim.accountId === account.id && claim.articleId === article.id
          && frozenDouyin && claim.loginGeneration === douyinConnection?.loginGeneration
          && claim.imageSha256 === frozenDouyin?.imageHashes[0]
          && claim.sourceContentHash === frozenDouyin.sourceContentHash
          && !this.repository.getSubmissionIntentByJob(job.id)
          && !this.repository.getPublishRecordByJob(job.id)) {
          this.repository.updateJobFailure(job.id, "NeedsUserAction", errorCode(error),
            error instanceof Error ? error.message : "Douyin image-text editor preparation failed after image selection", null);
          this.logger.warn("PUBLISHER", "DOUYIN_PREPARE_PRE_BOUNDARY_USER_ACTION", "Douyin image-text preparation stopped after one image-selection claim and before Prepared Record/Intent", {
            jobId: job.id, articleId: article.id, accountId: account.id, operationId: claim.operationId,
            errorCode: errorCode(error), finalSubmitCount: 0 });
        }
      }
      throw error;
    }).finally(async () => {
      await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
    });
    if (selectedImage && prepared.response.imageUploaded !== true) {
      this.logger.error("PUBLISHER", "IMAGE_UPLOAD_FAILED", "平台编辑器未返回图片 DOM 上传证据", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
      throw Object.assign(new Error("平台编辑器未返回图片上传完成证据，不能声明图片已插入"), { code: "UPLOAD_FAILED" });
    }
    if (selectedImage) this.logger.info("PUBLISHER", "IMAGE_UPLOAD_PASSED", "平台编辑器已返回图片 DOM 上传证据", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
    const preparedFrozenDouyin = frozenDouyin
      ? await freezeDouyinImageText({ ...frozenDouyin, mandatorySelections: douyinMandatorySelections(prepared.response.mandatorySelections), musicBinding: douyinMusicBinding(prepared.response.musicBinding) }) : null;
    if (preparedFrozenDouyin && (prepared.response.sourceContentHash !== preparedFrozenDouyin.sourceContentHash
      || prepared.response.contentBindingHash !== preparedFrozenDouyin.contentBindingHash
      || JSON.stringify(prepared.response.imageHashes) !== JSON.stringify(preparedFrozenDouyin.imageHashes)))
      throw Object.assign(new Error("Douyin editor preparation does not match the frozen image and content binding"), { code: "CONTENT_REJECTED" });
    const preparedResponse = { ...prepared.response, selectedImageAssetId: job.selectedImageAssetId ?? null, imageSelectionMode: job.imageSelectionMode ?? "none", imageInsertion: selectedImage ? "uploaded_verified" : "none",
      ...(managementReconciliation ? { contentTransport: adapter.getCapabilities().contentTransport, preparedInputHash: hashPreparedBrowserArticleInput(input), expectedCreatorId,
        ...(job.platformKey === "douyin" ? { expectedLoginGeneration: douyinConnection?.loginGeneration } : {}) } : {}) };
    const record = managementReconciliation && existing
      ? this.repository.updatePublishRecord(existing.id, { status: "Prepared", success: false, response: preparedResponse, verificationStatus: "WaitingUser" })
      : this.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: job.platformKey, articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: preparedResponse, dryRun: false, status: "Prepared", publishMode: job.finalPublishMode === "PREPARE_ONLY" ? "MANUAL" : "ASSISTED", automationType: adapter.automationType, browserSessionIdHash: prepared.sessionIdHash ?? account.browserSessionId, operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: prepared.editorOpenedAt ?? null, titleFilled: prepared.titleFilled ?? false, bodyFilled: prepared.bodyFilled ?? false, selectedImageAssetId: job.selectedImageAssetId ?? null, imageSelectionMode: job.imageSelectionMode ?? "none" });
    this.logger.info("PUBLISHER", managementReconciliation ? "TOUTIAO_EDITOR_PREPARED" : "ZHihu_EDITOR_PREPARED", `${managementReconciliation ? "头条" : "知乎"}编辑器已打开并完成标题、正文实际输入校验；等待用户确认`, { jobId: job.id, platformKey: job.platformKey, accountId: account.id, titleFilled: prepared.titleFilled ?? false, bodyFilled: prepared.bodyFilled ?? false });
    return { job: this.repository.getJob(job.id) as PublishJob, record, message: prepared.message };
  }

  async executeJob(jobId: string, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode): Promise<PublishExecutionResult> {
    const job = this.repository.getJob(jobId);
    if (!job) throw new Error("Publish job not found");
    if (job.dryRun || ["NeedsReconciliation", "Submitted", "Publishing", "Published", "Success"].includes(job.status)) return this.executeJobWithinGate(jobId, action, browserExecutionMode);
    return this.formalExecutionGate.run(jobId, () => this.executeJobWithinGate(jobId, action, browserExecutionMode));
  }

  private async executeJobWithinGate(jobId: string, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode): Promise<PublishExecutionResult> {
    const existing = this.repository.getJob(jobId);
    if (!existing) throw new Error("Publish job not found");
    if (existing.status === "NeedsReconciliation") return { job: existing, message: "Submission result is unknown; reconcile before retry" };
    if (existing.status === "Submitted") return this.repairSubmittedJob(existing);
    if (["Publishing", "Published", "Success"].includes(existing.status)) return { job: existing, message: "Publish job already completed or is being polled" };
    const job = this.repository.claimJob(jobId);
    const account = this.repository.listAccounts().find((item) => item.id === job.accountId);
    const article = this.repository.getArticle(job.articleId);
    if (!account || !article) return this.fail(job, "UNKNOWN", "Associated account or article not found");
    const records = this.repository.getPublishRecords(article.id);
    if (!canReuseArticle({ article, platformKey: job.platformKey, accountId: account.id, records })) return this.fail(job, "CONTENT_REJECTED", "Article reuse policy does not allow another publish");

    let submissionIntentId: string | null = null;
    let finalSubmitSideEffectTriggered = false;
    let platformFinalSubmitPath = false;
    try {
      if (!job.dryRun) this.repository.updateGlobalFormalPublishExecution(job.id, "EXECUTING");
      const adapter = this.adapters.getForContent(job.platformKey, job.contentKind ?? "article");
      const managementReconciliation = usesBrowserManagementReconciliation(adapter);
      const requiredTransport = this.repository.getFrozenContentTransport(job.id);
      if (requiredTransport && adapter.getCapabilities().contentTransport !== requiredTransport) throw Object.assign(new Error("Job content transport differs from its frozen preparation; automatic fallback is forbidden"), { code: "TRANSPORT_FALLBACK_FORBIDDEN" });
      if (!job.dryRun) adapter.assertFormalSubmitAvailable?.();
      if (!job.dryRun && job.manualConfirmationRequired) throw Object.assign(new Error("Formal publishing requires user confirmation"), { code: "USER_ACTION_REQUIRED" });
      if (!job.dryRun && account.lastPublishAt && account.minimumIntervalSeconds > 0) {
        const nextAllowedAt = new Date(new Date(account.lastPublishAt).getTime() + account.minimumIntervalSeconds * 1000);
        if (nextAllowedAt.getTime() > Date.now()) throw Object.assign(new Error("Account publish rate limit has not elapsed"), { code: "RATE_LIMITED" });
      }
      const effectiveBrowserExecutionMode = this.resolveBrowserExecutionMode(job.platformKey, browserExecutionMode, job.contentKind ?? "article");
      const douyinSettings = job.platformKey === "douyin" ? this.repository.getDouyinImageTextJobSettings(job.id) : null;
      if (job.platformKey === "douyin" && !douyinSettings) throw Object.assign(new Error("Douyin Owner-selected image/text settings are missing"), { code: "CONTENT_REJECTED" });
      const douyinConnection = job.platformKey === "douyin" ? this.repository.getDouyinImageTextConnection(account.id) : null;
      const expectedCreatorId = job.platformKey === "douyin" ? douyinConnection?.creatorId : account.externalAccountId;
      const ctx = { accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({ dryRun: job.dryRun, manualConfirmationRequired: job.manualConfirmationRequired, ...browserIdentitySettings(account, managementReconciliation, douyinConnection), ...(douyinSettings ? { expectedVisibility: douyinSettings.visibility, expectedMusicMode: douyinSettings.musicMode ?? "NONE" } : {}) }, action, effectiveBrowserExecutionMode), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) };
      const preparedRecord = this.repository.getPublishRecordByJob(job.id);
      const usePlatformFinalSubmit = !job.dryRun && typeof adapter.finalSubmit === "function" && preparedRecord?.status === "Prepared";
      if (!job.dryRun && managementReconciliation && !usePlatformFinalSubmit) throw Object.assign(new Error("Toutiao BrowserNative requires a persisted prepared editor before final submission"), { code: "USER_ACTION_REQUIRED" });
      platformFinalSubmitPath = usePlatformFinalSubmit;
      if (!usePlatformFinalSubmit) {
        const login = await withTimeout(adapter.checkLogin(ctx), this.options.loginCheckTimeoutMs ?? 30_000, "Platform login check");
        if (login === "expired" || login === "logged_out") throw Object.assign(new Error("Account login expired"), { code: "LOGIN_EXPIRED" });
        if (login !== "logged_in") throw Object.assign(new Error("Platform verification requires user action"), { code: "USER_ACTION_REQUIRED" });
      }
      let result: PublishResult;
      if (job.contentKind === "video") {
        if (!adapter.publishVideo) throw Object.assign(new Error("该平台 Adapter 尚未实现视频发布"), { code: "PERMISSION_DENIED" });
        const asset = job.videoAssetId ? this.repository.getVideoAsset(job.videoAssetId) : null;
        if (!asset) throw Object.assign(new Error("视频素材不存在"), { code: "CONTENT_REJECTED" });
        const payload = this.repository.getPublishPayload(job.id);
        const input: PublishVideoInput = {
          title: typeof payload.title === "string" && payload.title.trim() ? payload.title : article.title,
          description: typeof payload.description === "string" ? payload.description : article.body,
          tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === "string") : article.tags,
          videoPath: asset.localPath,
          ...(typeof payload.coverPath === "string" && payload.coverPath ? { coverPath: payload.coverPath } : {})
        };
        if (adapter.validateVideo) {
          const validation = await adapter.validateVideo(input);
          if (!validation.valid) throw Object.assign(new Error(validation.errors.join("; ")), { code: "CONTENT_REJECTED" });
        }
        if (!job.dryRun) {
          submissionIntentId = this.repository.prepareSubmissionIntent(job.id).id;
          const claimed = this.repository.claimFinalSubmitAttempt(submissionIntentId, { payloadHash: publishInputHash(input), adapterId: `${adapter.platformKey}@${adapter.manifest.version}` });
          this.logger.info("PUBLISHER", "FINAL_SUBMIT_BOUNDARY_ENTERED", "Durable formal submit boundary entered", { jobId: job.id, submissionAttemptId: claimed.submissionAttemptId, platformKey: job.platformKey });
        }
        result = await withTimeout(adapter.publishVideo(ctx, input), this.options.operationTimeoutMs ?? 120_000, "Platform video publish").finally(async () => {
          if (isAutomationAdapter(adapter)) await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
        });
      } else {
        const variant = job.articleVariantId ? this.repository.getArticleVariant(job.articleVariantId) : null;
        const cover = job.platformKey !== "douyin" && (variant?.coverAssetId ?? article.coverAssetId)
          ? this.repository.getMediaAsset((variant?.coverAssetId ?? article.coverAssetId) as string) : null;
        const selectedImage = job.selectedImageAssetId ? this.repository.getImageAsset(job.selectedImageAssetId) : null;
        if (job.selectedImageAssetId && !selectedImage) throw Object.assign(new Error("任务所选图片不存在，已停止发布"), { code: "UPLOAD_FAILED" });
        const input = { articleId: article.id, title: variant?.title ?? article.title, body: variant?.body ?? article.body, summary: variant?.summary ?? article.summary, tags: article.tags, ...(cover ? { coverPath: cover.filePath } : {}), ...(selectedImage ? { images: [selectedImage.filePath] } : {}) };
        if (!job.dryRun && job.platformKey === "douyin") {
          if (!selectedImage || job.imageSelectionMode !== "manual" || selectedImage.brandId !== article.brandId)
            throw Object.assign(new Error("Douyin image binding is missing or no longer belongs to this Article brand"), { code: "CONTENT_REJECTED" });
          const frozen = await freezeDouyinImageText({ articleId: article.id, accountId: account.id,
            creatorId: expectedCreatorId ?? "", title: input.title, body: input.body,
            imagePaths: [selectedImage.filePath], topics: [], visibility: douyinSettings!.visibility, scheduledAt: null,
            mandatorySelections: douyinMandatorySelections(preparedRecord?.response.mandatorySelections),
            musicBinding: douyinMusicBinding(preparedRecord?.response.musicBinding) });
          if (preparedRecord?.response.sourceContentHash !== frozen.sourceContentHash
            || preparedRecord?.response.contentBindingHash !== frozen.contentBindingHash
            || JSON.stringify(preparedRecord?.response.imageHashes) !== JSON.stringify(frozen.imageHashes))
            throw Object.assign(new Error("Douyin prepared title, body, account or image bytes changed"), { code: "CONTENT_REJECTED" });
        }
        if (!job.dryRun && managementReconciliation && (preparedRecord?.response.contentTransport !== adapter.getCapabilities().contentTransport
          || preparedRecord?.response.preparedInputHash !== hashPreparedBrowserArticleInput(input)
          || preparedRecord?.response.expectedCreatorId !== expectedCreatorId
          || job.platformKey === "douyin" && preparedRecord?.response.expectedLoginGeneration !== douyinConnection?.loginGeneration)) throw Object.assign(new Error("Browser prepared content, transport or stable account binding changed; prepare and confirm again"), { code: "CONTENT_REJECTED" });
        if (adapter.validateArticle) {
          const validation = await adapter.validateArticle(input);
          if (!validation.valid) throw Object.assign(new Error(validation.errors.join("; ")), { code: "CONTENT_REJECTED" });
        }
        const profile = this.repository.getPlatformProfile(job.platformKey);
        if (profile && job.platformKey !== "douyin") {
          const validation = validatePlatformArticle(input, profile);
          if (!validation.valid) throw Object.assign(new Error(validation.errors.join("; ")), { code: "CONTENT_REJECTED" });
        }
        if (!job.dryRun) submissionIntentId = this.repository.prepareSubmissionIntent(job.id).id;
        if (selectedImage && this.isBrowserAutomationPlatform(job.platformKey, job.contentKind ?? "article")) this.logger.info("PUBLISHER", "IMAGE_UPLOAD_STARTED", "开始向平台编辑器上传任务主图", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
        if (usePlatformFinalSubmit && adapter.finalSubmit) {
          if (adapter.prepareFinalSubmit) await withTimeout(adapter.prepareFinalSubmit(ctx, input), this.options.operationTimeoutMs ?? 120_000, "Platform final-submit preflight");
          const intent = this.repository.getSubmissionIntentByJob(job.id);
          if (!intent) throw new Error("Persisted submission intent is missing before platform final submit");
          const submissionAttemptId = this.repository.reserveSubmissionAttempt(intent.id);
          const attempt: BrowserPublishAttemptContext = {
            jobId: job.id,
            submissionIntentId: intent.id,
            submissionAttemptId,
            attempt: intent.attempt,
            markSubmissionSideEffect: () => {
              const claimed = this.repository.claimFinalSubmitAttempt(intent.id, { payloadHash: publishInputHash(input), adapterId: `${adapter.platformKey}@${adapter.manifest.version}` });
              finalSubmitSideEffectTriggered = true;
              this.logger.info("PUBLISHER", "FINAL_SUBMIT_BOUNDARY_ENTERED", "Durable formal submit boundary entered", { jobId: job.id, submissionAttemptId: claimed.submissionAttemptId, platformKey: job.platformKey });
            }
          };
          try {
            result = await withTimeout(adapter.finalSubmit(ctx, input, attempt), this.options.operationTimeoutMs ?? 120_000, "Platform final submit").then(async (submitted) => {
              if (!finalSubmitSideEffectTriggered) throw Object.assign(new Error("Platform final submit returned without a durable submit boundary"), { code: "RECONCILIATION_UNCERTAIN" });
              if (managementReconciliation) {
                if (!submitted.success || !["publishing", "scheduled"].includes(submitted.status ?? "") || submitted.response.submissionAccepted !== true)
                  throw Object.assign(new Error("Toutiao submit has no explicit accepted evidence; management reconciliation is required"), { code: "SUBMISSION_UNCERTAIN" });
                return submitted;
              }
              let collected = submitted;
              if (adapter.collectPublishResult) collected = await withTimeout(adapter.collectPublishResult(ctx, input, attempt), this.options.operationTimeoutMs ?? 120_000, "Platform publish result collection");
              if (!collected.externalId || !collected.publishedUrl) throw Object.assign(new Error("Platform final submit did not return a verifiable External ID and URL"), { code: "EXTERNAL_EVIDENCE_INCOMPLETE" });
              if (!adapter.verifyPublished) throw Object.assign(new Error("Platform final submit has no platform-specific verification contract"), { code: "RECONCILIATION_UNCERTAIN" });
              const verification = await withTimeout(adapter.verifyPublished(ctx, input, { externalId: collected.externalId, publishedUrl: collected.publishedUrl }), this.options.operationTimeoutMs ?? 120_000, "Platform publish verification");
              if (verification.status !== "published" || !verification.externalId || !verification.publishedUrl) throw Object.assign(new Error(verification.errorMessage ?? "Platform publish verification did not pass"), { code: verification.errorCode ?? "RECONCILIATION_UNCERTAIN" });
              return { ...collected, externalId: verification.externalId, publishedUrl: verification.publishedUrl, status: "published" as const, response: { ...collected.response, verification: verification.response, verificationStatus: "Verified" } };
            });
          } catch (error) {
            if (isAutomationAdapter(adapter) && errorCode(error) !== "USER_ACTION_REQUIRED") await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
            throw error;
          }
          if (isAutomationAdapter(adapter)) await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
        } else {
          if (submissionIntentId) {
            const claimed = this.repository.claimFinalSubmitAttempt(submissionIntentId, { payloadHash: publishInputHash(input), adapterId: `${adapter.platformKey}@${adapter.manifest.version}` });
            this.logger.info("PUBLISHER", "FINAL_SUBMIT_BOUNDARY_ENTERED", "Durable formal submit boundary entered", { jobId: job.id, submissionAttemptId: claimed.submissionAttemptId, platformKey: job.platformKey });
          }
          result = await withTimeout(adapter.publishArticle(ctx, input), this.options.operationTimeoutMs ?? 120_000, "Platform article publish").finally(async () => {
            if (isAutomationAdapter(adapter)) await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
          });
        }
        if (selectedImage && this.isBrowserAutomationPlatform(job.platformKey, job.contentKind ?? "article") && result.response.imageUploaded !== true) throw Object.assign(new Error("平台编辑器未返回图片上传完成证据，不能声明图片已插入"), { code: "UPLOAD_FAILED" });
        if (selectedImage && result.response.imageUploaded === true) this.logger.info("PUBLISHER", "IMAGE_UPLOAD_PASSED", "平台编辑器已返回图片 DOM 上传证据", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
      }
      if (!result.success) throw Object.assign(new Error("Platform rejected publish request"), { code: "UNKNOWN" });
      result = {
        ...result,
        response: {
          ...result.response,
          ...(managementReconciliation ? { contentTransport: adapter.getCapabilities().contentTransport, preparedInputHash: preparedRecord?.response.preparedInputHash,
            expectedCreatorId: preparedRecord?.response.expectedCreatorId } : {}),
          ...(job.platformKey === "douyin" && preparedRecord ? {
            expectedLoginGeneration: preparedRecord.response.expectedLoginGeneration,
            sourceContentHash: preparedRecord.response.sourceContentHash,
            contentBindingHash: preparedRecord.response.contentBindingHash,
            imageHashes: preparedRecord.response.imageHashes,
            mandatorySelections: preparedRecord.response.mandatorySelections,
            musicBinding: preparedRecord.response.musicBinding } : {}),
          selectedImageAssetId: job.selectedImageAssetId ?? null,
          imageSelectionMode: job.imageSelectionMode ?? "none",
          imageInsertion: job.selectedImageAssetId ? result.response.imageUploaded === true ? "uploaded_verified" : "failed" : "none"
        }
      };
      const publishedConfirmed = result.status === "published" && Boolean(result.externalId && result.publishedUrl);
      const remoteStatus = result.status === "scheduled" ? "SCHEDULED_ACCEPTED" : publishedConfirmed ? "PUBLISHED_CONFIRMED" : "SUBMIT_ACCEPTED";
      if (submissionIntentId) this.repository.markSubmissionIntentSubmitted(submissionIntentId, result.externalId ?? null, remoteStatus);
      const pending = !job.dryRun && !publishedConfirmed;
      const record = usePlatformFinalSubmit && preparedRecord
        ? this.repository.updatePublishRecord(preparedRecord.id, { status: pending ? "Publishing" : "Published", success: !pending, publishedUrl: result.publishedUrl ?? null, publishedExternalId: result.externalId ?? null, response: result.response, verificationStatus: pending ? "WaitingUser" : "Verified" })
        : this.repository.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: result.publishedUrl ?? null, publishedExternalId: result.externalId ?? null, success: !pending, response: result.response, dryRun: job.dryRun, status: job.dryRun ? "DryRun" : pending ? "Publishing" : "Published", ...publishRecordMetadata(adapter.manifest, job, account, result) });
      if (job.dryRun) this.repository.markJobDryRunPassed(job.id);
      else if (pending) this.repository.markJobPublishing(job.id, record.id);
      else this.repository.markJobSuccess(job.id);
      if (!job.dryRun && !pending) { this.repository.markArticlePublished(article.id); this.repository.markAccountPublished(account.id); }
      const message = job.dryRun ? "Dry Run completed; awaiting confirmation" : result.status === "scheduled" ? "Remote schedule accepted; publication is not confirmed" : pending ? "Submission accepted; waiting for platform status" : "Publish completed";
      this.repository.updatePlatformHealth(job.platformKey, "healthy");
      this.repository.createNotification({ level: job.dryRun ? "info" : "success", title: job.dryRun ? "Dry Run completed" : "Publish completed", message, relatedId: job.id });
      this.logger.info("PUBLISHER", job.dryRun ? "PUBLISH_DRY_RUN" : "PUBLISH_SUCCESS", message, { jobId: job.id, platformKey: job.platformKey, accountId: account.id, dryRun: job.dryRun });
      return { job: this.repository.getJob(job.id) as PublishJob, message };
    } catch (error) {
      if (errorCode(error) === "UPLOAD_FAILED") this.logger.error("PUBLISHER", "IMAGE_UPLOAD_FAILED", error instanceof Error ? error.message : "图片上传失败", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: job.selectedImageAssetId ?? null });
      if (submissionIntentId) {
        const intent = this.repository.getSubmissionIntentByJob(job.id);
        if (intent?.state === "Submitted") return { job: this.repository.getJob(job.id) as PublishJob, message: "Submission accepted; record recovery is pending" };
        const code = errorCode(error);
        const preSubmitUserAction = platformFinalSubmitPath && ["FINAL_SUBMIT_CONTROL_NOT_FOUND", "REQUIRED_FIELD_MISSING", "USER_ACTION_REQUIRED"].includes(code);
        const douyinProvenPreBoundary = douyinPreBoundaryFailure({ platformKey: job.platformKey,
          platformFinalSubmitPath, sideEffectTriggered: finalSubmitSideEffectTriggered, intent });
        if ((preSubmitUserAction && !finalSubmitSideEffectTriggered && intent && intent.finalSubmitCount === 0
          || douyinProvenPreBoundary) && intent) {
          const waiting = this.repository.resetSubmissionIntentForUserAction(intent.id, errorCode(error));
          this.logger.warn("PUBLISHER", "USER_ACTION_REQUIRED", error instanceof Error ? error.message : "Platform final submit is waiting for user action", { jobId: job.id, finalSubmitCount: intent.finalSubmitCount, submissionSideEffectTriggered: false });
          return { job: waiting, message: error instanceof Error ? error.message : "平台最终提交前仍需要用户完成字段或安全验证" };
        }
        const uncertain = this.repository.markSubmissionIntentUncertain(intent?.id ?? submissionIntentId, errorCode(error));
        this.logger.error("PUBLISHER", "SUBMISSION_UNCERTAIN", error instanceof Error ? error.message : "Submission result is unknown", { jobId: job.id, submissionAttemptId: intent?.submissionAttemptId ?? null, submissionSideEffectTriggered: finalSubmitSideEffectTriggered });
        return { job: uncertain, message: `Submission result is unknown; reconciliation is required${error instanceof Error ? `: ${error.message}` : ""}` };
      }
      return this.fail(job, errorCode(error), error instanceof Error ? error.message : "Unknown publish error");
    }
  }

  private repairSubmittedJob(job: PublishJob): PublishExecutionResult {
    const existing = this.repository.getPublishRecordByJob(job.id);
    if (existing) return { job, message: "Submission already recorded; no duplicate publish was attempted" };
    const intent = this.repository.getSubmissionIntentByJob(job.id);
    if (!intent?.externalId) return { job, message: "Submission was accepted without an external id; reconciliation is required" };
    const record = this.repository.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: intent.externalId, success: false, response: { recoveredFromSubmissionIntent: true }, dryRun: false, status: "Submitted", publishMode: "AUTO", automationType: "API", operator: "desktop-user", verificationStatus: "WaitingUser" });
    const repaired = this.repository.markJobPublishing(job.id, record.id);
    return { job: repaired, message: "Recovered accepted submission without resubmitting" };
  }

  async pollPublishingJob(jobId: string, enforceDeadline = true, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode): Promise<PublishExecutionResult> {
    const job = this.repository.getJob(jobId);
    if (job && ["Publishing", "Submitted", "NeedsReconciliation"].includes(job.status)
      && usesBrowserManagementReconciliation(this.adapters.getForContent(job.platformKey, job.contentKind ?? "article")))
      return this.reconcileBrowserJob(jobId, action);
    if (!job || (job.status !== "Publishing" && job.status !== "NeedsReconciliation")) throw new Error("Job is not awaiting reconciliation");
    const pollingStartedAt = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.scheduledAt);
    const currentIntent = this.repository.getSubmissionIntentByJob(job.id);
    if (enforceDeadline && currentIntent?.remoteStatus !== "SCHEDULED_ACCEPTED" && Number.isFinite(pollingStartedAt) && Date.now() - pollingStartedAt >= (this.options.publishPollingTimeoutMs ?? 24 * 60 * 60 * 1000)) {
      const expired = this.repository.updateJobFailure(job.id, "NeedsReconciliation", "TIMEOUT", "Platform publish status exceeded the polling deadline; user reconciliation is required", null);
      this.repository.updateSubmissionRemoteStatus(job.id, "UNCERTAIN", true);
      this.repository.createNotification({ level: "warning", title: "Publish requires reconciliation", message: "Platform status polling reached its time limit. Confirm the platform result before any retry.", relatedId: job.id });
      return { job: expired, message: "Platform status polling reached its time limit; manual reconciliation is required" };
    }
    const account = this.repository.listAccounts().find((item) => item.id === job.accountId);
    const record = this.repository.getPublishRecordByJob(job.id);
    const intent = this.repository.getSubmissionIntentByJob(job.id);
    const externalId = record?.publishedExternalId ?? intent?.externalId;
    if (!account || !externalId) return { job, message: "No external id is available; user must confirm whether the platform received the request" };
    try {
      const adapter = this.adapters.getForContent(job.platformKey, job.contentKind ?? "article");
      if (!adapter.getPublishStatus) return { job, message: "This platform does not support status reconciliation" };
      const effectiveBrowserExecutionMode = this.resolveBrowserExecutionMode(job.platformKey, browserExecutionMode, job.contentKind ?? "article");
      const ctx = { accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({ dryRun: false, manualConfirmationRequired: false }, action, effectiveBrowserExecutionMode), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) };
      const status = await withTimeout(adapter.getPublishStatus(ctx, externalId), this.options.statusCheckTimeoutMs ?? 30_000, "Platform publish status check");
      this.repository.markJobPolled(job.id);
      if (status.status === "scheduled") {
        this.repository.updateSubmissionRemoteStatus(job.id, "SCHEDULED_ACCEPTED", true);
        return { job: this.repository.getJob(job.id) as PublishJob, message: "Remote schedule is accepted; publication is not confirmed" };
      }
      if (status.status === "publishing") {
        if (intent?.remoteStatus !== "SCHEDULED_ACCEPTED") this.repository.updateSubmissionRemoteStatus(job.id, "CONFIRMING", true);
        return { job: this.repository.getJob(job.id) as PublishJob, message: "Platform is still processing publish" };
      }
      if (status.status === "failed") {
        this.repository.updateSubmissionRemoteStatus(job.id, "FAILED_CONFIRMED", false);
        if (record) this.repository.updatePublishRecord(record.id, { status: "Failed", success: false, response: status.response });
        const failed = this.repository.updateJobFailure(job.id, "Failed", status.errorCode ?? "UNKNOWN", status.errorMessage ?? "Platform publish failed", null);
        return { job: failed, message: status.errorMessage ?? "Platform publish failed" };
      }
      if (status.status !== "published" || !status.publishedUrl || (status.externalId && status.externalId !== externalId)) {
        this.repository.updateSubmissionRemoteStatus(job.id, "UNCERTAIN", true);
        return { job: this.repository.getJob(job.id) as PublishJob, message: "Platform confirmation lacks a public URL or remote identifier" };
      }
      this.repository.updateSubmissionRemoteStatus(job.id, "PUBLISHED_CONFIRMED", false);
      if (record) this.repository.updatePublishRecord(record.id, { status: "Published", success: true, publishedUrl: status.publishedUrl ?? null, response: status.response });
      else this.repository.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: status.publishedUrl ?? null, publishedExternalId: externalId, success: true, response: status.response, dryRun: false, status: "Published", publishMode: "AUTO", automationType: inferredAutomationType(adapter.manifest), operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "Verified" });
      this.repository.markJobSuccess(job.id);
      const article = this.repository.getArticle(job.articleId);
      if (article) this.repository.markArticlePublished(article.id);
      this.repository.markAccountPublished(account.id);
      this.repository.updatePlatformHealth(job.platformKey, "healthy");
      return { job: this.repository.getJob(job.id) as PublishJob, message: "Reconciliation confirmed publish" };
    } catch (error) {
      this.logger.warn("PUBLISHER", "CONFIRMATION_UNCERTAIN", error instanceof Error ? error.message : "Status reconciliation failed", { jobId: job.id, platformKey: job.platformKey, code: errorCode(error) });
      this.repository.markJobPolled(job.id);
      return { job: this.repository.getJob(job.id) as PublishJob, message: "Confirmation is still uncertain; no new submit was attempted" };
    }
  }

  async reconcileJob(jobId: string, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode): Promise<PublishExecutionResult> { return this.pollPublishingJob(jobId, false, action, browserExecutionMode); }

  private fail(job: PublishJob, code: ErrorCode, message: string): PublishExecutionResult {
    const decision = decideFailure(code, job.attemptCount, job.maxAttempts, job.maxAttempts);
    if (decision.shouldPauseAccount) this.repository.updateAccount(job.accountId, { enabled: false, loginStatus: code === "LOGIN_EXPIRED" ? "expired" : "unknown", pausedReason: message });
    if (["AUTH_REQUIRED", "LOGIN_EXPIRED", "PERMISSION_DENIED", "API_REVIEW_REQUIRED"].includes(code)) this.repository.recordAccountFailure(job.accountId, this.options.accountFailurePauseThreshold ?? 5, message);
    this.repository.updatePlatformHealth(job.platformKey, decision.status === "Paused" ? "paused" : "degraded", code, message);
    const updated = this.repository.updateJobFailure(job.id, decision.status, code, message, decision.nextRetryAt);
    this.repository.createNotification({ level: decision.status === "NeedsUserAction" ? "warning" : "error", title: decision.status === "NeedsUserAction" ? "Publish requires user action" : "Publish failed", message, relatedId: job.id });
    this.logger.error("PUBLISHER", code, message, { jobId: job.id, status: decision.status, attempt: job.attemptCount });
    return { job: updated, message };
  }
}

export class PersistentScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastLoginSweepAt = 0;

  constructor(private readonly repository: AppRepository, private readonly publisher: PublisherService, private readonly logger: Logger, private readonly intervalMs = 5_000, private readonly options: { globalConcurrency?: number; platformConcurrency?: number; accountConcurrency?: number } = {}) {}
  start(): void {
    if (this.timer) return;
    const recoveredBrowserJobs = this.repository.listJobs().filter((job) => this.publisher.isPlatformRegistered(job.platformKey) && ["Running", "Preparing", "ReadyToSubmit"].includes(job.status) && this.publisher.isBrowserAutomationPlatform(job.platformKey, job.contentKind ?? "article"));
    const recovered = this.repository.recoverRunningJobs();
    for (const job of recoveredBrowserJobs) {
      if (this.repository.getJob(job.id)?.status !== "Retry") continue;
      this.repository.updateJobFailure(job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "应用已恢复；浏览器平台任务等待用户点击“继续”，不会自动打开平台窗口", null);
      this.repository.createNotification({ level: "warning", title: "有任务需要继续", message: `${job.platformKey} 任务等待用户继续`, relatedId: job.id });
    }
    if (recovered > 0) this.logger.warn("SCHEDULER", "JOB_RECOVERED", "Recovered safe jobs; uncertain submissions remain paused for reconciliation", { count: recovered });
    this.timer = setInterval(() => { void this.runDueJobs(); }, this.intervalMs);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runDueJobs(now = new Date()): Promise<PublishExecutionResult[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const accounts = new Map(this.repository.listAccounts().map((account) => [account.id, account]));
      const platforms = new Map(this.repository.listPlatforms().map((platform) => [platform.platformKey, platform]));
      if (now.getTime() - this.lastLoginSweepAt >= 6 * 60 * 60 * 1000) {
        this.lastLoginSweepAt = now.getTime();
        await Promise.all([...accounts.values()].filter((account) => this.publisher.isPlatformRegistered(account.platformKey) && account.enabled && !this.publisher.isBrowserAutomationPlatform(account.platformKey) && account.connectionMode !== "BrowserAutomation").map((account) => this.publisher.checkAccountLogin(account.id)));
      }
      const due = this.repository.listDueJobs(now.toISOString(), 50).filter((job) => {
        const account = accounts.get(job.accountId);
        if (!this.publisher.isPlatformRegistered(job.platformKey)) return false;
        const safeDryRun = job.dryRun;
        const globalAutoPublish = this.repository.getSettings()["defaultPublishMode"] === "auto";
        const approvedAutoPublish = !job.dryRun && !job.manualConfirmationRequired && (job.finalPublishMode === "AUTO_PUBLISH" || account?.allowAutoPublish === true || globalAutoPublish);
        if (this.publisher.isBrowserAutomationPlatform(job.platformKey, job.contentKind ?? "article")) {
          this.repository.updateJobFailure(job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "浏览器平台任务等待用户点击“继续”，不会自动打开平台窗口", null);
          this.repository.createNotification({ level: "warning", title: "有任务需要继续", message: `${job.platformKey} 任务等待用户继续`, relatedId: job.id });
          return false;
        }
        return account?.enabled === true && platforms.get(job.platformKey)?.healthStatus !== "paused" && (safeDryRun || approvedAutoPublish) && (!job.nextRetryAt || new Date(job.nextRetryAt).getTime() <= now.getTime());
      });
      const results: PublishExecutionResult[] = [];
      const globalLimit = 1;
      const platformRunning = new Map<string, number>();
      const accountRunning = new Map<string, number>();
      let selectedCount = 0;
      const selected = due.filter((job) => {
        const platformCount = platformRunning.get(job.platformKey) ?? 0;
        const accountCount = accountRunning.get(job.accountId) ?? 0;
        if (platformCount >= Math.max(1, this.options.platformConcurrency ?? 1) || accountCount >= Math.max(1, this.options.accountConcurrency ?? 1) || selectedCount >= globalLimit) return false;
        selectedCount += 1;
        platformRunning.set(job.platformKey, platformCount + 1); accountRunning.set(job.accountId, accountCount + 1); return true;
      });
      await Promise.all(selected.map(async (job) => { try { results.push(await this.publisher.executeJob(job.id)); } catch (error) { this.logger.error("SCHEDULER", "JOB_EXECUTION_FAILED", error instanceof Error ? error.message : "Job execution failed", { jobId: job.id }); } }));
      const pollingCutoff = new Date(now.getTime() - 30_000).toISOString();
      await Promise.all(this.repository.listPublishingJobs(globalLimit, pollingCutoff).filter((job) => this.publisher.isPlatformRegistered(job.platformKey) && !this.publisher.isBrowserAutomationPlatform(job.platformKey, job.contentKind ?? "article")).map(async (job) => { try { results.push(await this.publisher.pollPublishingJob(job.id)); } catch (error) { this.logger.error("SCHEDULER", "PUBLISH_STATUS_FAILED", error instanceof Error ? error.message : "Publish status check failed", { jobId: job.id }); } }));
      return results;
    } finally { this.running = false; }
  }
}
