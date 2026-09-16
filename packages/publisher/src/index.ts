import { isAutomationAdapter, OneShotPublicationGuard, withUserInitiatedActionSettings, type AdapterRegistry, type BrowserExecutionMode, type BrowserPublishAttemptContext, type OneShotPublicationAuthorization, type UserInitiatedAction } from "@publisher/adapters-core";
import type { AppRepository } from "@publisher/db";
import { canReuseArticle, decideFailure, validatePlatformArticle, type Account, type AccountContext, type AdapterManifest, type ErrorCode, type PlatformCapability, type PublishJob, type PublishMode, type PublishResult, type PublishVideoInput, type XhsContextIdentityAttestation } from "@publisher/domain";
import type { Logger } from "@publisher/logger";

export interface PublishExecutionResult { job: PublishJob; message: string; }
export interface AssistedPrepareResult { job: PublishJob; record: ReturnType<AppRepository["getPublishRecordByJob"]>; message: string; }

type PublisherExecutionMode = "STANDARD" | "TASK10S_RETAINED_EDITOR";

export interface PublisherOptions {
  resolveSecrets?: (accountId: string, platformKey: string) => Record<string, string>;
  resolveRuntimeIdentityAttestation?: (accountId: string) => XhsContextIdentityAttestation | null;
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
    const allowed: ErrorCode[] = ["NETWORK_ERROR", "LOGIN_EXPIRED", "AUTH_REQUIRED", "USER_ACTION_REQUIRED", "UPLOAD_FAILED", "PLATFORM_CHANGED", "CONTENT_REJECTED", "RATE_LIMITED", "PERMISSION_DENIED", "API_REVIEW_REQUIRED", "PROCESSING", "TIMEOUT", "SUBMISSION_UNCERTAIN", "FINAL_SUBMIT_ALREADY_USED", "FINAL_SUBMIT_CONTROL_NOT_FOUND", "REQUIRED_FIELD_MISSING", "EXTERNAL_EVIDENCE_INCOMPLETE", "RECONCILIATION_UNCERTAIN", "CONFIRMED_NOT_PUBLISHED", "UNKNOWN"];
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
  constructor(private readonly repository: AppRepository, private readonly adapters: AdapterRegistry, private readonly logger: Logger, private readonly options: PublisherOptions = {}) {}

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
    if (!job || job.status !== "NeedsReconciliation") throw new Error("只有 NeedsReconciliation Job 才能执行浏览器只读回查");
    const account = this.repository.listAccounts().find((item) => item.id === job.accountId);
    const article = this.repository.getArticle(job.articleId);
    if (!account || !article) throw new Error("关联账号或文章不存在");
    const adapter = this.adapters.getForContent(job.platformKey, job.contentKind ?? "article");
    if (!adapter.reconcile) return { job, message: "STILL_UNCERTAIN: 当前平台没有经过审阅的只读内容列表回查契约，未重试" };
    const ctx = { accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({ dryRun: false, manualConfirmationRequired: true }, action, "VISIBLE"), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) };
    const variant = job.articleVariantId ? this.repository.getArticleVariant(job.articleVariantId) : null;
    const selectedImage = job.selectedImageAssetId ? this.repository.getImageAsset(job.selectedImageAssetId) : null;
    const input = { articleId: article.id, title: variant?.title ?? article.title, body: variant?.body ?? article.body, summary: variant?.summary ?? article.summary, tags: article.tags, ...(selectedImage ? { images: [selectedImage.filePath] } : {}) };
    const intent = this.repository.getSubmissionIntentByJob(job.id);
    const existingRecord = this.repository.getPublishRecordByJob(job.id);
    const createdAt = Date.parse(job.startedAt ?? job.createdAt);
    const windowStart = Number.isFinite(createdAt) ? new Date(createdAt - 5 * 60_000).toISOString() : job.createdAt;
    const submittedAt = Date.parse(intent?.updatedAt ?? job.finishedAt ?? job.startedAt ?? job.createdAt);
    const waitWindowSatisfied = intent?.state === "Unknown"
      && Number.isFinite(submittedAt)
      && Date.now() >= submittedAt + (this.options.reconciliationWaitMs ?? 30_000);
    const result = await withTimeout(adapter.reconcile(ctx, {
      jobId: job.id,
      articleId: article.id,
      title: input.title,
      accountName: account.name,
      windowStart,
      windowEnd: new Date().toISOString(),
      waitWindowSatisfied,
      submissionIntentState: intent?.state ?? null,
      finalSubmitCount: intent?.finalSubmitCount ?? 0,
      expectedExternalId: existingRecord?.publishedExternalId ?? intent?.externalId ?? null,
      expectedPublishedUrl: existingRecord?.publishedUrl ?? null
    }), this.options.operationTimeoutMs ?? 120_000, "Browser publish reconciliation");
    if (result.status === "FOUND_PUBLISHED") {
      if (!result.externalId || !result.publishedUrl || !result.titleMatch || !result.accountMatch || !result.timeWindowMatch || !adapter.verifyPublished) return { job, message: "STILL_UNCERTAIN: 回查未同时取得真实 External ID、URL、标题、账号和时间窗口证据，未写入成功" };
      const verification = await withTimeout(adapter.verifyPublished(ctx, input, { externalId: result.externalId, publishedUrl: result.publishedUrl }), this.options.operationTimeoutMs ?? 120_000, "Browser publish result verification");
      if (verification.status !== "published" || !verification.externalId || !verification.publishedUrl) return { job, message: `STILL_UNCERTAIN: 回收结果验证未通过，保持 NeedsReconciliation（${verification.errorMessage ?? "external result verification failed"}）` };
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
    const existing = this.repository.getPublishRecordByJob(job.id);
    if (existing?.status === "Prepared") return { job, record: existing, message: "知乎编辑器准备记录已存在，未重复打开或写入" };
    if (job.status !== "AwaitingConfirmation") throw new Error("文章发布任务当前不是 AwaitingConfirmation 状态");
    const account = this.repository.listAccounts().find((item) => item.platformAccountId === job.platformAccountId && item.platformKey === job.platformKey);
    const article = this.repository.getArticle(job.articleId);
    if (!account || !article) throw new Error("关联账号或文章不存在");
    this.repository.assertArticlePublishAllowed(article.id);
    const adapter = this.adapters.getForContent(job.platformKey, job.contentKind ?? "article");
    if (!isAutomationAdapter(adapter)) throw Object.assign(new Error("当前平台没有浏览器辅助发布能力"), { code: "PERMISSION_DENIED" });
    const effectiveBrowserExecutionMode = this.resolveBrowserExecutionMode(job.platformKey, browserExecutionMode, job.contentKind ?? "article");
    const ctx = { accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({ dryRun: false, manualConfirmationRequired: true }, action, effectiveBrowserExecutionMode), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) };
    const login = await withTimeout(adapter.checkLogin(ctx), this.options.loginCheckTimeoutMs ?? 30_000, "Platform login check");
    if (login !== "logged_in") throw Object.assign(new Error("知乎账号 Session 未通过登录检查，请先完成正常登录验证"), { code: login === "expired" || login === "logged_out" ? "LOGIN_EXPIRED" : "USER_ACTION_REQUIRED" });
    const variant = job.articleVariantId ? this.repository.getArticleVariant(job.articleVariantId) : null;
    const selectedImage = job.selectedImageAssetId ? this.repository.getImageAsset(job.selectedImageAssetId) : null;
    const input = { articleId: article.id, title: variant?.title ?? article.title, body: variant?.body ?? article.body, summary: variant?.summary ?? article.summary, tags: article.tags, ...(selectedImage ? { images: [selectedImage.filePath] } : {}) };
    const validation = await adapter.validateArticle(input);
    if (!validation.valid) throw Object.assign(new Error(validation.errors.join("；")), { code: "CONTENT_REJECTED" });
    if (selectedImage) this.logger.info("PUBLISHER", "IMAGE_UPLOAD_STARTED", "开始向平台编辑器上传任务主图", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
    const prepared = await withTimeout(adapter.preparePublish(ctx, input), this.options.operationTimeoutMs ?? 120_000, "Platform assisted prepare").catch((error: unknown) => {
      if (errorCode(error) === "UPLOAD_FAILED") this.logger.error("PUBLISHER", "IMAGE_UPLOAD_FAILED", error instanceof Error ? error.message : "图片上传失败", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage?.id ?? null });
      throw error;
    }).finally(async () => {
      await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
    });
    if (selectedImage && prepared.response.imageUploaded !== true) {
      this.logger.error("PUBLISHER", "IMAGE_UPLOAD_FAILED", "平台编辑器未返回图片 DOM 上传证据", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
      throw Object.assign(new Error("平台编辑器未返回图片上传完成证据，不能声明图片已插入"), { code: "UPLOAD_FAILED" });
    }
    if (selectedImage) this.logger.info("PUBLISHER", "IMAGE_UPLOAD_PASSED", "平台编辑器已返回图片 DOM 上传证据", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
    const preparedResponse = { ...prepared.response, selectedImageAssetId: job.selectedImageAssetId ?? null, imageSelectionMode: job.imageSelectionMode ?? "none", imageInsertion: selectedImage ? "uploaded_verified" : "none" };
    const record = this.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: job.platformKey, articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: preparedResponse, dryRun: false, status: "Prepared", publishMode: job.finalPublishMode === "PREPARE_ONLY" ? "MANUAL" : "ASSISTED", automationType: adapter.automationType, browserSessionIdHash: prepared.sessionIdHash ?? account.browserSessionId, operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: prepared.editorOpenedAt ?? null, titleFilled: prepared.titleFilled ?? false, bodyFilled: prepared.bodyFilled ?? false, selectedImageAssetId: job.selectedImageAssetId ?? null, imageSelectionMode: job.imageSelectionMode ?? "none" });
    this.logger.info("PUBLISHER", "ZHihu_EDITOR_PREPARED", "知乎编辑器已打开并完成标题、正文实际输入校验；等待用户确认", { jobId: job.id, platformKey: job.platformKey, accountId: account.id, titleFilled: prepared.titleFilled ?? false, bodyFilled: prepared.bodyFilled ?? false });
    return { job: this.repository.getJob(job.id) as PublishJob, record, message: prepared.message };
  }

  async executeJob(jobId: string, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode, oneShotAuthorization?: OneShotPublicationAuthorization): Promise<PublishExecutionResult> {
    return this.executeJobInternal(jobId, action, browserExecutionMode, oneShotAuthorization, "STANDARD");
  }

  async executeTask10sRetainedEditor(jobId: string, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode, oneShotAuthorization?: OneShotPublicationAuthorization): Promise<PublishExecutionResult> {
    return this.executeJobInternal(jobId, action, browserExecutionMode, oneShotAuthorization, "TASK10S_RETAINED_EDITOR");
  }

  private async executeJobInternal(jobId: string, action: UserInitiatedAction | undefined, browserExecutionMode: BrowserExecutionMode | undefined, oneShotAuthorization: OneShotPublicationAuthorization | undefined, executionMode: PublisherExecutionMode): Promise<PublishExecutionResult> {
    const existing = this.repository.getJob(jobId);
    if (!existing) throw new Error("Publish job not found");
    if (existing.status === "NeedsReconciliation") return { job: existing, message: "Submission result is unknown; reconcile before retry" };
    if (existing.status === "Submitted") return this.repairSubmittedJob(existing);
    if (["Publishing", "Published", "Success"].includes(existing.status)) return { job: existing, message: "Publish job already completed or is being polled" };
    const job = this.repository.claimJob(jobId);
    const account = this.repository.listAccounts().find((item) => item.id === job.accountId);
    const article = this.repository.getArticle(job.articleId);
    if (!account || !article) return this.fail(job, "UNKNOWN", "Associated account or article not found");
    if (oneShotAuthorization && (job.platformKey !== "xiaohongshu" || oneShotAuthorization.platformKey !== "xiaohongshu" || oneShotAuthorization.accountId !== account.id || oneShotAuthorization.mode !== "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE")) {
      throw Object.assign(new Error("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH"), { code: "USER_ACTION_REQUIRED" });
    }
    const records = this.repository.getPublishRecords(article.id);
    if (!canReuseArticle({ article, platformKey: job.platformKey, accountId: account.id, records })) return this.fail(job, "CONTENT_REJECTED", "Article reuse policy does not allow another publish");

    let submissionIntentId: string | null = null;
    let finalSubmitSideEffectTriggered = false;
    let platformFinalSubmitPath = false;
    try {
      const adapter = this.adapters.getForContent(job.platformKey, job.contentKind ?? "article");
      const oneShotOperationId = oneShotAuthorization?.operationId;
      const oneShotGuard = oneShotAuthorization
        ? new OneShotPublicationGuard(oneShotAuthorization, executionMode === "TASK10S_RETAINED_EDITOR"
          ? {
            onFinalMousePressDispatchStarted: (authorization) => {
              const intent = this.repository.getSubmissionIntentByJob(job.id);
              return intent ? this.repository.startOneShotFinalMousePress(authorization.operationId, authorization.accountId, authorization.platformKey, intent.id) : false;
            },
            onSubmissionReconciliationRequired: (authorization) => this.repository.markOneShotFinalMousePressReconciliationRequired(authorization.operationId),
            onConfirmationCommit: (authorization) => this.repository.recordOneShotPublicationConfirmationAction(authorization.operationId)
          }
          : {
            onConsumed: (authorization) => this.repository.consumeOneShotPublicationAuthorization(authorization.operationId, authorization.accountId, authorization.platformKey),
            onConfirmationCommit: (authorization) => this.repository.recordOneShotPublicationConfirmationAction(authorization.operationId)
          })
        : undefined;
      if (oneShotAuthorization && (job.dryRun || !isAutomationAdapter(adapter) || typeof adapter.finalSubmit !== "function")) throw Object.assign(new Error("ONE_SHOT_FINAL_SUBMIT_PATH_REQUIRED"), { code: "USER_ACTION_REQUIRED" });
      if (!job.dryRun && job.manualConfirmationRequired) throw Object.assign(new Error("Formal publishing requires user confirmation"), { code: "USER_ACTION_REQUIRED" });
      if (!job.dryRun && account.lastPublishAt && account.minimumIntervalSeconds > 0) {
        const nextAllowedAt = new Date(new Date(account.lastPublishAt).getTime() + account.minimumIntervalSeconds * 1000);
        if (nextAllowedAt.getTime() > Date.now()) throw Object.assign(new Error("Account publish rate limit has not elapsed"), { code: "RATE_LIMITED" });
      }
      const effectiveBrowserExecutionMode = this.resolveBrowserExecutionMode(job.platformKey, browserExecutionMode, job.contentKind ?? "article");
      const ctx: AccountContext = { accountId: account.id, accountName: account.name, platformKey: account.platformKey, settings: operationSettings({
        dryRun: job.dryRun,
        manualConfirmationRequired: job.manualConfirmationRequired,
        ...(oneShotAuthorization ? { oneShotImageSource: "SAFE_TEST_FIXTURE", oneShotOperationId: oneShotAuthorization.operationId } : {})
      }, action, effectiveBrowserExecutionMode), secrets: this.options.resolveSecrets?.(account.id, account.platformKey) };
      if (executionMode === "TASK10S_RETAINED_EDITOR" && job.platformKey === "xiaohongshu") {
        const attestation = this.options.resolveRuntimeIdentityAttestation?.(account.id) ?? null;
        if (attestation) ctx.runtimeIdentityAttestation = attestation;
      }
      const preparedRecord = this.repository.getPublishRecordByJob(job.id);
      if (preparedRecord?.response.OWNER_FINAL_SUBMIT_AUTHORIZATION === "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH" && !oneShotAuthorization) throw Object.assign(new Error("ONE_SHOT_AUTHORIZATION_REQUIRED"), { code: "USER_ACTION_REQUIRED" });
      const usePlatformFinalSubmit = !job.dryRun && typeof adapter.finalSubmit === "function" && preparedRecord?.status === "Prepared";
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
        if (!job.dryRun) submissionIntentId = this.repository.prepareSubmissionIntent(job.id).id;
        result = await withTimeout(adapter.publishVideo(ctx, input), this.options.operationTimeoutMs ?? 120_000, "Platform video publish").finally(async () => {
          if (isAutomationAdapter(adapter)) await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
        });
      } else {
        const variant = job.articleVariantId ? this.repository.getArticleVariant(job.articleVariantId) : null;
        const cover = (variant?.coverAssetId ?? article.coverAssetId) ? this.repository.getMediaAsset((variant?.coverAssetId ?? article.coverAssetId) as string) : null;
        const selectedImage = job.selectedImageAssetId ? this.repository.getImageAsset(job.selectedImageAssetId) : null;
        if (job.selectedImageAssetId && !selectedImage) throw Object.assign(new Error("任务所选图片不存在，已停止发布"), { code: "UPLOAD_FAILED" });
        const input = { articleId: article.id, title: variant?.title ?? article.title, body: variant?.body ?? article.body, summary: variant?.summary ?? article.summary, tags: article.tags, ...(cover ? { coverPath: cover.filePath } : {}), ...(selectedImage ? { images: [selectedImage.filePath] } : {}) };
        if (adapter.validateArticle) {
          const validation = await adapter.validateArticle(input);
          if (!validation.valid) throw Object.assign(new Error(validation.errors.join("; ")), { code: "CONTENT_REJECTED" });
        }
        const profile = this.repository.getPlatformProfile(job.platformKey);
        if (profile) {
          const validation = validatePlatformArticle(input, profile);
          if (!validation.valid) throw Object.assign(new Error(validation.errors.join("; ")), { code: "CONTENT_REJECTED" });
        }
        if (!job.dryRun) submissionIntentId = this.repository.prepareSubmissionIntent(job.id).id;
        if (selectedImage && this.isBrowserAutomationPlatform(job.platformKey, job.contentKind ?? "article")) this.logger.info("PUBLISHER", "IMAGE_UPLOAD_STARTED", "开始向平台编辑器上传任务主图", { jobId: job.id, platformKey: job.platformKey, selectedImageAssetId: selectedImage.id });
        if (usePlatformFinalSubmit && adapter.finalSubmit) {
          if (adapter.prepareFinalSubmit) await withTimeout(adapter.prepareFinalSubmit(ctx, input), this.options.operationTimeoutMs ?? 120_000, "Platform final-submit preflight");
          const intent = this.repository.getSubmissionIntentByJob(job.id);
          if (!intent) throw new Error("Persisted submission intent is missing before platform final submit");
          const claimedAttempt = executionMode === "TASK10S_RETAINED_EDITOR"
            ? { id: intent.id, jobId: intent.jobId, attempt: intent.attempt }
            : this.repository.claimFinalSubmitAttempt(intent.id);
          const attempt: BrowserPublishAttemptContext = {
            jobId: job.id,
            submissionIntentId: claimedAttempt.id,
            attempt: claimedAttempt.attempt,
            markSubmissionSideEffect: () => { finalSubmitSideEffectTriggered = true; },
            ...(oneShotGuard ? { oneShotPublicationGuard: oneShotGuard } : {}),
            ...(executionMode === "TASK10S_RETAINED_EDITOR" ? { task10sRetainedEditor: true as const } : {})
          };
          try {
            result = await withTimeout(adapter.finalSubmit(ctx, input, attempt), this.options.operationTimeoutMs ?? 120_000, "Platform final submit");
            if (oneShotGuard) {
              oneShotGuard.markFinalSubmitCompleted();
              if (oneShotOperationId) this.repository.completeOneShotPublicationAuthorization(oneShotOperationId);
            }
            result = await (async (submitted) => {
              let collected = submitted;
              if (adapter.collectPublishResult) collected = await withTimeout(adapter.collectPublishResult(ctx, input, attempt), this.options.operationTimeoutMs ?? 120_000, "Platform publish result collection");
              if (!collected.externalId || !collected.publishedUrl) throw Object.assign(new Error("Platform final submit did not return a verifiable External ID and URL"), { code: "EXTERNAL_EVIDENCE_INCOMPLETE" });
              if (!adapter.verifyPublished) throw Object.assign(new Error("Platform final submit has no platform-specific verification contract"), { code: "RECONCILIATION_UNCERTAIN" });
              const verification = await withTimeout(adapter.verifyPublished(ctx, input, { externalId: collected.externalId, publishedUrl: collected.publishedUrl }), this.options.operationTimeoutMs ?? 120_000, "Platform publish verification");
              if (verification.status !== "published" || !verification.externalId || !verification.publishedUrl) throw Object.assign(new Error(verification.errorMessage ?? "Platform publish verification did not pass"), { code: verification.errorCode ?? "RECONCILIATION_UNCERTAIN" });
              return { ...collected, externalId: verification.externalId, publishedUrl: verification.publishedUrl, status: "published" as const, response: { ...collected.response, verification: verification.response, verificationStatus: "Verified" } };
            })(result);
          } catch (error) {
            if (isAutomationAdapter(adapter) && errorCode(error) !== "USER_ACTION_REQUIRED") await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
            throw error;
          }
          if (isAutomationAdapter(adapter)) await adapter.releaseOperationSession?.(ctx).catch(() => undefined);
        } else {
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
          selectedImageAssetId: job.selectedImageAssetId ?? null,
          imageSelectionMode: job.imageSelectionMode ?? "none",
          imageInsertion: job.selectedImageAssetId ? result.response.imageUploaded === true ? "uploaded_verified" : "failed" : "none"
        }
      };
      if (submissionIntentId) this.repository.markSubmissionIntentSubmitted(submissionIntentId, result.externalId ?? null);
      const pending = !job.dryRun && result.status === "publishing";
      const record = usePlatformFinalSubmit && preparedRecord
        ? this.repository.updatePublishRecord(preparedRecord.id, { status: pending ? "Publishing" : "Published", success: !pending, publishedUrl: result.publishedUrl ?? null, publishedExternalId: result.externalId ?? null, response: result.response, verificationStatus: pending ? "WaitingUser" : "Verified" })
        : this.repository.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: result.publishedUrl ?? null, publishedExternalId: result.externalId ?? null, success: !pending, response: result.response, dryRun: job.dryRun, status: job.dryRun ? "DryRun" : pending ? "Publishing" : "Published", ...publishRecordMetadata(adapter.manifest, job, account, result) });
      if (job.dryRun) this.repository.markJobDryRunPassed(job.id);
      else if (pending) this.repository.markJobPublishing(job.id, record.id);
      else this.repository.markJobSuccess(job.id);
      if (!job.dryRun && !pending) { this.repository.markArticlePublished(article.id); this.repository.markAccountPublished(account.id); }
      const message = job.dryRun ? "Dry Run completed; awaiting confirmation" : pending ? "Submission accepted; waiting for platform status" : "Publish completed";
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
        if (preSubmitUserAction && !finalSubmitSideEffectTriggered && intent && (intent.finalSubmitCount === 0 || (intent.state === "Submitting" && intent.finalSubmitCount === 1))) {
          const waiting = this.repository.resetSubmissionIntentForUserAction(intent.id, errorCode(error));
          this.logger.warn("PUBLISHER", "USER_ACTION_REQUIRED", error instanceof Error ? error.message : "Platform final submit is waiting for user action", { jobId: job.id, finalSubmitCount: intent.finalSubmitCount, submissionSideEffectTriggered: false });
          return { job: waiting, message: error instanceof Error ? error.message : "平台最终提交前仍需要用户完成字段或安全验证" };
        }
        if (platformFinalSubmitPath && !finalSubmitSideEffectTriggered && intent && intent.finalSubmitCount === 0) return this.fail(job, code, error instanceof Error ? error.message : "Final submit did not execute");
        const uncertain = this.repository.markSubmissionIntentUncertain(intent?.id ?? submissionIntentId, errorCode(error));
        this.logger.error("PUBLISHER", "SUBMISSION_UNCERTAIN", error instanceof Error ? error.message : "Submission result is unknown", { jobId: job.id, attempt: job.attemptCount, submissionSideEffectTriggered: finalSubmitSideEffectTriggered });
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
    const record = this.repository.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: intent.externalId, success: true, response: { recoveredFromSubmissionIntent: true }, dryRun: false, status: "Submitted", publishMode: "AUTO", automationType: "API", operator: "desktop-user", verificationStatus: "WaitingUser" });
    const repaired = this.repository.markJobPublishing(job.id, record.id);
    return { job: repaired, message: "Recovered accepted submission without resubmitting" };
  }

  async pollPublishingJob(jobId: string, enforceDeadline = true, action?: UserInitiatedAction, browserExecutionMode?: BrowserExecutionMode): Promise<PublishExecutionResult> {
    const job = this.repository.getJob(jobId);
    if (!job || (job.status !== "Publishing" && job.status !== "NeedsReconciliation")) throw new Error("Job is not awaiting reconciliation");
    const pollingStartedAt = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.scheduledAt);
    if (enforceDeadline && Number.isFinite(pollingStartedAt) && Date.now() - pollingStartedAt >= (this.options.publishPollingTimeoutMs ?? 24 * 60 * 60 * 1000)) {
      const expired = this.repository.updateJobFailure(job.id, "NeedsReconciliation", "TIMEOUT", "Platform publish status exceeded the polling deadline; user reconciliation is required", null);
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
      if (status.status === "publishing") return { job: this.repository.getJob(job.id) as PublishJob, message: "Platform is still processing publish" };
      if (status.status === "failed") {
        if (record) this.repository.updatePublishRecord(record.id, { status: "Failed", success: false, response: status.response });
        return this.fail(job, status.errorCode ?? "UNKNOWN", status.errorMessage ?? "Platform publish failed");
      }
      if (record) this.repository.updatePublishRecord(record.id, { status: "Published", success: true, publishedUrl: status.publishedUrl ?? null, response: status.response });
      else this.repository.insertPublishRecord({ jobId: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: status.publishedUrl ?? null, publishedExternalId: externalId, success: true, response: status.response, dryRun: false, status: "Published", publishMode: "AUTO", automationType: inferredAutomationType(adapter.manifest), operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "Verified" });
      this.repository.markJobSuccess(job.id);
      const article = this.repository.getArticle(job.articleId);
      if (article) this.repository.markArticlePublished(article.id);
      this.repository.markAccountPublished(account.id);
      this.repository.updatePlatformHealth(job.platformKey, "healthy");
      return { job: this.repository.getJob(job.id) as PublishJob, message: "Reconciliation confirmed publish" };
    } catch (error) {
      return this.fail(job, errorCode(error), error instanceof Error ? error.message : "Status reconciliation failed");
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
      const globalLimit = Math.max(1, this.options.globalConcurrency ?? 2);
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
