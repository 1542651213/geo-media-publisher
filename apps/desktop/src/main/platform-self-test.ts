import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppRepository } from "@publisher/db";
import { isAutomationAdapter, type AdapterRegistry, type AutomationAdapter, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import type { AutomationPrepareResult, ControlledPostUploadDiscoveryResult } from "@publisher/adapters-core";
import type { Logger } from "@publisher/logger";
import type { PublisherService } from "@publisher/publisher";
import type { Account, AccountContext, BackgroundAutomationStatus, PlatformSelfTestLevel, PlatformSelfTestResult, PlatformSelfTestRun, PublishArticleInput } from "@publisher/domain";

const ARTICLE_TEST_TITLE = "Geo Media Publisher 发布链路测试";
const ZHIHU_TEST_TITLE_PREFIX = "Geo Media Publisher 知乎发布测试";
const BAIJIAHAO_TEST_TITLE_PREFIX = "GMP 百家号真实发布测试";
const ARTICLE_TEST_BODY = "本内容用于公司内部 Geo Media Publisher 发布系统功能验证，\n用于确认账号登录、编辑器填充和发布回查是否正常。\n无商业推广用途，可忽略。";
const SHORT_TEST_BODY = "Geo Media Publisher 内部发布链路测试。用于验证账号连接与发布功能，无商业推广用途，可忽略。";
const SHORT_CONTENT_PLATFORMS = new Set(["weibo"]);
const VIDEO_PLATFORMS = new Set(["douyin", "tiktok", "youtube", "bilibili"]);
const SELF_TEST_LEVEL_ORDER: PlatformSelfTestLevel[] = ["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT", "L5_PUBLISH"];
const SECURITY_OR_LOGIN_CODES = new Set(["AUTH_REQUIRED", "LOGIN_EXPIRED", "USER_ACTION_REQUIRED", "CAPTCHA", "SECURITY_CHECK", "SMS_REQUIRED", "QR_LOGIN", "RISK_CONTROL"]);
const SAFE_TEST_IMAGE_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAACoE2KBAAAADUlEQVR42mNk+M/wHwAF/gL+J1Q6WQAAAABJRU5ErkJggg==", "base64");

function safeSelfTestImagePath(): string {
  const directory = join(tmpdir(), "geo-media-publisher-safe-fixtures");
  const imagePath = join(directory, "task10n-safe-test.png");
  mkdirSync(directory, { recursive: true });
  if (!existsSync(imagePath) || statSync(imagePath).size !== SAFE_TEST_IMAGE_BYTES.byteLength) writeFileSync(imagePath, SAFE_TEST_IMAGE_BYTES, { flag: "w" });
  return imagePath;
}
function realPublishTestBatchConfirmed(): boolean {
  return ["1", "true", "yes"].includes((process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED ?? "").trim().toLowerCase());
}

export function selfTestContentKind(platformKey: string): "article" | "video" {
  return VIDEO_PLATFORMS.has(platformKey) ? "video" : "article";
}
type BrowserSelfTestMode = "BACKGROUND" | "VISIBLE";

interface BackgroundEvidence {
  passed: boolean;
  waitingForUser: boolean;
  missingRequiredImage: boolean;
  reason: string;
}

export interface PlatformSelfTestAccountView {
  account: Account;
  latestRun: PlatformSelfTestRun | null;
}

interface PreparedEditorRun {
  input: PublishArticleInput;
  imageAssetId: string | null;
  prepared: AutomationPrepareResult | null;
}

export interface PlatformSelfTestServiceOptions {
  repository: AppRepository;
  registry: AdapterRegistry;
  publisher: PublisherService;
  resolveAccountSecrets: (accountId: string, platformKey: string) => Record<string, string>;
  logger?: Logger;
}

export function transparentSelfTestContent(platformKey: string, platformName: string, testedAt = new Date()): PublishArticleInput {
  if (platformKey === "zhihu") {
    const timestamp = testedAt.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false }).replace("T", " ");
    return { articleId: `platform-self-test-${platformKey}`, title: `${ZHIHU_TEST_TITLE_PREFIX} ${timestamp}`, body: "这是一篇用于验证 Geo Media Publisher 知乎发布链路的内部测试内容。内容无商业推广用途。", summary: "内部测试", tags: ["内部测试"] };
  }
  const suffix = `\n\n测试时间：${testedAt.toISOString()}\n平台：${platformName}`;
  const articleId = `platform-self-test-${platformKey}`;
  if (platformKey === "baijiahao") {
    const timestamp = testedAt.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false }).replace("T", " ");
    const uniqueMarker = `${BAIJIAHAO_TEST_TITLE_PREFIX} ${timestamp}`;
    return { articleId, title: uniqueMarker, body: `${uniqueMarker}\n用于验证百家号真实图文发布链路。`, summary: "", tags: [] };
  }
  if (SHORT_CONTENT_PLATFORMS.has(platformKey)) return { articleId, title: SHORT_TEST_BODY, body: SHORT_TEST_BODY, summary: "", tags: [] };
  return { articleId, title: ARTICLE_TEST_TITLE, body: `${ARTICLE_TEST_BODY}${suffix}`, summary: "内部发布链路测试", tags: ["内部测试"] };
}

export function requiredSelfTestLevels(target: PlatformSelfTestLevel): PlatformSelfTestLevel[] {
  return SELF_TEST_LEVEL_ORDER.slice(0, SELF_TEST_LEVEL_ORDER.indexOf(target) + 1);
}

export function assertHealthCheckLevels(levels: PlatformSelfTestLevel[]): void {
  if (levels.length !== 1 || levels[0] !== "L1_LOGIN") throw new Error("批量健康检查只能执行 L1_LOGIN");
}

export function summarizeSelfTestResult(run: PlatformSelfTestRun): PlatformSelfTestResult {
  if (run.steps.length === 0) return "NOT_TESTED";
  if (run.steps.some((step) => step.result === "TESTING")) return "TESTING";
  const mandatoryStepKeys: Record<PlatformSelfTestLevel, string[]> = {
    L1_LOGIN: ["ACCOUNT_CONNECTION", "SESSION_OR_OAUTH"],
    L2_EDITOR: ["EDITOR_OPEN"],
    L3_CONTENT_FILL: ["TITLE_FILL", "BODY_FILL"],
    L4_DRAFT: ["DRAFT_SAVE"],
    L5_PUBLISH: ["PUBLISH_SUBMIT", "EXTERNAL_EVIDENCE", "STATUS_RECONCILIATION"]
  };
  const requiredKeys = requiredSelfTestLevels(run.requestedLevel).flatMap((level) => mandatoryStepKeys[level]);
  const requiredSteps = requiredKeys.map((key) => run.steps.find((step) => step.stepKey === key)).filter((step): step is NonNullable<typeof step> => Boolean(step));
  if (requiredSteps.some((step) => step.result === "FAILED")) return "FAILED";
  if (requiredSteps.some((step) => step.result === "WAITING_FOR_USER")) return "WAITING_FOR_USER";
  if (requiredSteps.length === 0) return "NOT_TESTED";
  if (requiredSteps.every((step) => step.result === "NOT_SUPPORTED")) return "NOT_SUPPORTED";
  if (requiredSteps.some((step) => step.result === "PARTIAL_PASSED" || step.result === "NOT_SUPPORTED" || step.result === "NOT_TESTED")) return "PARTIAL_PASSED";
  return requiredSteps.every((step) => step.result === "PASSED") ? "PASSED" : "PARTIAL_PASSED";
}

export function isBlockingImageUploadFailure(result: PlatformSelfTestResult, imageUploadRequired: boolean | undefined): boolean {
  return result === "FAILED" && imageUploadRequired !== false;
}

function selfTestError(error: unknown): { result: PlatformSelfTestResult; errorCode: string; message: string } {
  const message = error instanceof Error ? error.message : "平台自测失败";
  const rawCode = typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string" ? (error as { code: string }).code : "UNKNOWN";
  if (/客户端.{0,12}(升级|更新)|版本过低|upgrade.{0,12}client/iu.test(message)) return { result: "FAILED", errorCode: "CLIENT_UPGRADE_REQUIRED", message };
  const unstructuredSecuritySignal = rawCode === "UNKNOWN" && /captcha|security.?check|sms.?required|qr.?login|risk.?control|验证码|短信|拼图|扫码|安全验证|人机|风控/iu.test(message);
  if (SECURITY_OR_LOGIN_CODES.has(rawCode) || unstructuredSecuritySignal) return { result: "WAITING_FOR_USER", errorCode: rawCode, message };
  if (rawCode === "PERMISSION_DENIED" || rawCode === "API_REVIEW_REQUIRED" || /scope|权限|permission/iu.test(message)) return { result: "WAITING_FOR_USER", errorCode: "PERMISSION_REQUIRED", message };
  return { result: "FAILED", errorCode: rawCode, message };
}

export class PlatformSelfTestService {
  constructor(private readonly options: PlatformSelfTestServiceOptions) {}

  listAccounts(): PlatformSelfTestAccountView[] {
    const latestByAccount = new Map<string, PlatformSelfTestRun>();
    for (const run of this.options.repository.listPlatformSelfTestRuns()) if (!latestByAccount.has(run.platformAccountId)) latestByAccount.set(run.platformAccountId, run);
    return this.options.repository.listAccounts().map((account) => ({ account, latestRun: latestByAccount.get(account.platformAccountId ?? account.id) ?? null }));
  }

  async runSafe(platformAccountId: string): Promise<PlatformSelfTestRun> {
    const run = this.options.repository.createPlatformSelfTestRun({ platformAccountId, requestedLevel: "L3_CONTENT_FILL" });
    const account = this.account(run);
    const adapter = this.options.registry.getForContent(run.platformKey, selfTestContentKind(run.platformKey));
    if (!isAutomationAdapter(adapter)) {
      if (!await this.runLogin(run, account, adapter, "VISIBLE")) return this.finish(run.testRunId);
      await this.runEditorAndContent(run, account, adapter, "VISIBLE");
      return this.finish(run.testRunId);
    }

    // The connected-platform survey is a visible Playwright harness check. It
    // must use the BrowserSessionManager-owned system browser/page so the
    // evidence is page.url()/DOM-backed and never depends on desktop windows.
    return this.runVisibleAutomation(run, account, adapter);
  }

  /**
   * Runs the explicitly controlled first-upload proof without creating a
   * PlatformSelfTestRun, Job, SubmissionIntent, or PublishRecord. The XHS
   * adapter owns the browser/mutex lifecycle and stops before content fill.
   */
  async runPostUploadDiscovery(platformAccountId: string): Promise<ControlledPostUploadDiscoveryResult> {
    const account = this.options.repository.listAccounts().find((item) => (item.platformAccountId ?? item.id) === platformAccountId && item.platformKey === "xiaohongshu");
    if (!account) throw new Error("小红书受控上传自测账号不存在");
    const adapter = this.options.registry.getForContent("xiaohongshu", "article");
    if (!isAutomationAdapter(adapter) || typeof adapter.runControlledPostUploadDiscovery !== "function") throw new Error("当前小红书 Adapter 未提供受控上传后发现能力");
    const operationId = randomUUID();
    const context: AccountContext = {
      accountId: account.id,
      accountName: account.accountAlias || account.name,
      platformKey: "xiaohongshu",
      settings: { userActionId: operationId, triggerSource: "RUN_SELF_TEST", browserExecutionMode: "VISIBLE" },
      secrets: this.options.resolveAccountSecrets(account.id, account.platformKey)
    };
    const imagePath = safeSelfTestImagePath();
    this.options.logger?.info("PLATFORM_SELF_TEST", "CONTROLLED_POST_UPLOAD_DISCOVERY_STARTED", "开始小红书受控首次上传后发现；仅使用安全测试夹具，不创建发布域记录", { platformKey: "xiaohongshu", platformAccountId, mode: "POST_UPLOAD_DISCOVERY_ONLY", imageSource: "SAFE_TEST_FIXTURE" });
    const result = await adapter.runControlledPostUploadDiscovery(context, { imagePath, imageSource: "SAFE_TEST_FIXTURE" });
    this.options.logger?.info("PLATFORM_SELF_TEST", "CONTROLLED_POST_UPLOAD_DISCOVERY_COMPLETED", "小红书受控首次上传后发现已停止在标题/正文/最终发布之前", { platformKey: "xiaohongshu", platformAccountId, mode: result.mode, status: result.status, operationId: result.operationId, uploadMutationCount: result.uploadMutationCount, contentMutationCount: result.contentMutationCount, finalSubmitCount: result.finalSubmitCount });
    return result;
  }

  async continue(testRunId: string): Promise<PlatformSelfTestRun> {
    const run = this.options.repository.getPlatformSelfTestRun(testRunId);
    if (!run || run.overallResult !== "WAITING_FOR_USER") throw new Error("只有等待用户处理的自测才能继续");
    const account = this.account(run);
    const adapter = this.options.registry.getForContent(run.platformKey, selfTestContentKind(run.platformKey));
    if (run.requestedLevel === "L5_PUBLISH") {
      if (run.publishJobId) return this.continueExistingPublishJob(run.testRunId, run.publishJobId);
      return this.confirmPublish(testRunId);
    }
    if (!isAutomationAdapter(adapter)) return this.finish(run.testRunId);
    return this.runVisibleAutomation(run, account, adapter);
  }

  private async runVisibleAutomation(run: PlatformSelfTestRun, account: Account, adapter: AutomationAdapter): Promise<PlatformSelfTestRun> {
    try {
      if (await this.runLogin(run, account, adapter, "VISIBLE")) await this.runEditorAndContent(run, account, adapter, "VISIBLE");
      const current = this.options.repository.getPlatformSelfTestRun(run.testRunId);
      return current?.steps.some((step) => step.result === "FAILED") ? this.finishAs(run.testRunId, "FAILED") : this.finish(run.testRunId);
    } finally {
      const current = this.options.repository.getPlatformSelfTestRun(run.testRunId);
      if (current?.overallResult !== "WAITING_FOR_USER") await this.closeAutomationSessions(adapter);
    }
  }

  private async runBackgroundAutomation(run: PlatformSelfTestRun, account: Account, adapter: AutomationAdapter): Promise<PlatformSelfTestRun> {
    try {
      // A prior visible account/backend window must never be reused as evidence
      // for a background-mode pass.
      if (isAutomationAdapter(adapter)) await this.closeAutomationSessions(adapter);
      if (await this.runLogin(run, account, adapter, "BACKGROUND")) await this.runEditorAndContent(run, account, adapter, "BACKGROUND");
      const background = this.backgroundEvidence(run, adapter);
      if (background.passed) {
        this.step(run, "L3_CONTENT_FILL", "BACKGROUND_AUTOMATION", "PASSED", null, "后台自动模式已通过 L1、L2、标题、正文和必需图片的真实证据验证", "browser_execution_mode:BACKGROUND");
        this.persistBackgroundStatus(run.platformKey, "PASSED", null);
        return this.finishAs(run.testRunId, "PASSED");
      }
      if (background.waitingForUser) {
        this.step(run, "L3_CONTENT_FILL", "BACKGROUND_AUTOMATION", "WAITING_FOR_USER", "USER_ACTION_REQUIRED", "后台自测遇到登录或平台安全验证，已停止；不会自动切换可见模式", "browser_execution_mode:BACKGROUND");
        this.persistBackgroundStatus(run.platformKey, "FAILED", background.reason);
        return this.finishAs(run.testRunId, "WAITING_FOR_USER");
      }
      if (background.missingRequiredImage) {
        this.step(run, "L3_CONTENT_FILL", "BACKGROUND_AUTOMATION", "FAILED", "WAITING_FOR_TEST_IMAGE", "知乎后台模式必须使用测试图片取得真实上传证据；当前没有可用测试图片", "browser_execution_mode:BACKGROUND");
        this.persistBackgroundStatus(run.platformKey, "FAILED", background.reason);
        return this.finishAs(run.testRunId, "FAILED");
      }

      this.step(run, "L3_CONTENT_FILL", "BACKGROUND_AUTOMATION", "FAILED", "BACKGROUND_ATTEMPT_FAILED", background.reason, "browser_execution_mode:BACKGROUND");
      if (isAutomationAdapter(adapter)) await this.closeAutomationSessions(adapter);

      if (await this.runLogin(run, account, adapter, "VISIBLE")) await this.runEditorAndContent(run, account, adapter, "VISIBLE");
      const visible = this.backgroundEvidence(run, adapter);
      if (visible.passed) {
        this.step(run, "L3_CONTENT_FILL", "BACKGROUND_AUTOMATION", "PARTIAL_PASSED", "REQUIRES_VISIBLE_BROWSER", "后台运行未通过，但同一次用户自测的可见辅助模式取得完整证据", "browser_execution_mode:VISIBLE");
        this.persistBackgroundStatus(run.platformKey, "REQUIRES_VISIBLE_BROWSER", background.reason);
        return this.finishAs(run.testRunId, "PASSED");
      }
      const result: PlatformSelfTestResult = visible.waitingForUser ? "WAITING_FOR_USER" : "FAILED";
      this.step(run, "L3_CONTENT_FILL", "BACKGROUND_AUTOMATION", result, visible.waitingForUser ? "USER_ACTION_REQUIRED" : "BACKGROUND_AND_VISIBLE_FAILED", visible.reason, "browser_execution_mode:VISIBLE");
      this.persistBackgroundStatus(run.platformKey, "FAILED", visible.reason);
      return this.finishAs(run.testRunId, result);
    } finally {
      await this.closeAutomationSessions(adapter);
    }
  }

  async runLevel(platformAccountId: string, level: PlatformSelfTestLevel): Promise<PlatformSelfTestRun> {
    if (level === "L5_PUBLISH") return this.requestPublish(platformAccountId);
    const run = this.options.repository.createPlatformSelfTestRun({ platformAccountId, requestedLevel: level });
    const account = this.account(run);
    const adapter = this.options.registry.getForContent(run.platformKey, selfTestContentKind(run.platformKey));
    if (!await this.runLogin(run, account, adapter, "VISIBLE") || level === "L1_LOGIN") return this.finish(run.testRunId);
    if (["L2_EDITOR", "L3_CONTENT_FILL"].includes(level)) {
      await this.runEditorAndContent(run, account, adapter, "VISIBLE");
      return this.finish(run.testRunId);
    }
    await this.runEditorAndContent(run, account, adapter, "VISIBLE");
    if (level === "L4_DRAFT") await this.runDraft(run, account, adapter);
    return this.finish(run.testRunId);
  }

  async healthCheckConnectedAccounts(): Promise<PlatformSelfTestRun[]> {
    assertHealthCheckLevels(["L1_LOGIN"]);
    const accounts = this.options.repository.listAccounts().filter((account) => account.enabled && account.loginStatus === "logged_in");
    const results: PlatformSelfTestRun[] = [];
    for (const account of accounts) {
      const run = this.options.repository.createPlatformSelfTestRun({ platformAccountId: account.platformAccountId ?? account.id, requestedLevel: "L1_LOGIN" });
      await this.runLogin(run, account, this.options.registry.getForContent(account.platformKey, selfTestContentKind(account.platformKey)), "VISIBLE");
      results.push(this.finish(run.testRunId));
    }
    return results;
  }

  requestPublish(platformAccountId: string): PlatformSelfTestRun {
    const run = this.options.repository.createPlatformSelfTestRun({ platformAccountId, requestedLevel: "L5_PUBLISH" });
    const account = this.account(run);
    const platformName = this.options.repository.listPlatforms().find((platform) => platform.platformKey === run.platformKey)?.displayName ?? run.platformKey;
    if (!realPublishTestBatchConfirmed()) {
      this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "WAITING_FOR_USER", "REAL_PUBLISH_TEST_BATCH_CONFIRMATION_REQUIRED", "REAL_PUBLISH_TEST_BATCH_CONFIRMED is not set; no real publish Job will be created. Restart the app after enabling this one-batch flag.", "batch_confirmation:missing");
      return this.options.repository.finishPlatformSelfTestRun(run.testRunId, "WAITING_FOR_USER");
    }
    this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "WAITING_FOR_USER", "PUBLISH_CONFIRMATION_REQUIRED", `即将在【${platformName}】账号【${account.accountAlias || account.name}】真实发布一条测试内容，是否继续？`);
    return this.options.repository.finishPlatformSelfTestRun(run.testRunId, "WAITING_FOR_USER");
  }

  cancelPublish(testRunId: string): PlatformSelfTestRun {
    const run = this.mustRun(testRunId, "L5_PUBLISH");
    this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "NOT_TESTED", "PUBLISH_TEST_CANCELLED", "用户取消了真实发布测试，未创建发布任务");
    return this.options.repository.finishPlatformSelfTestRun(testRunId, "NOT_TESTED");
  }

  async confirmPublish(testRunId: string, testVideoPath?: string): Promise<PlatformSelfTestRun> {
    let run = this.mustRun(testRunId, "L5_PUBLISH");
    if (!realPublishTestBatchConfirmed()) {
      this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "WAITING_FOR_USER", "REAL_PUBLISH_TEST_BATCH_CONFIRMATION_REQUIRED", "REAL_PUBLISH_TEST_BATCH_CONFIRMED is not set; no real publish Job will be created.", "batch_confirmation:missing");
      return this.options.repository.finishPlatformSelfTestRun(run.testRunId, "WAITING_FOR_USER");
    }
    run = this.options.repository.confirmPlatformSelfTestPublish(run.testRunId);
    this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "PASSED", null, "用户已明确确认本次单账号真实发布测试");
    const account = this.account(run);
    const adapter = this.options.registry.getForContent(run.platformKey, selfTestContentKind(run.platformKey));
    if (!await this.runLogin(run, account, adapter, "VISIBLE")) return this.finish(run.testRunId);
    const preparedContent = await this.runEditorAndContent(run, account, adapter, "VISIBLE");
    if (isAutomationAdapter(adapter)) {
      const preparedRun = this.options.repository.getPlatformSelfTestRun(run.testRunId) as PlatformSelfTestRun;
      const imageStep = preparedRun.steps.find((item) => item.stepKey === "IMAGE_FILL") ?? { result: "NOT_TESTED" as const, errorCode: null, verificationSignal: null };
      if (isBlockingImageUploadFailure(imageStep?.result ?? "NOT_TESTED", preparedContent.prepared?.response.imageUploadRequired as boolean | undefined)) {
        this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "FAILED", imageStep.errorCode ?? "IMAGE_UPLOAD_FAILED", "图片未取得真实编辑器 DOM 上传证据，已停止最终提交", imageStep.verificationSignal);
        return this.finish(run.testRunId);
      }
      const required = ["EDITOR_OPEN", "TITLE_FILL", "BODY_FILL"].map((key) => preparedRun.steps.find((item) => item.stepKey === key)?.result);
      if (!required.every((result) => result === "PASSED")) {
        const editor = preparedRun.steps.find((item) => item.stepKey === "EDITOR_OPEN");
        this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "FAILED", editor?.result === "PARTIAL_PASSED" ? "EDITOR_NOT_FOUND" : "CONTENT_NOT_VERIFIED", "编辑器或标题/正文实际填充证据不足，已停止最终提交");
        return this.finish(run.testRunId);
      }
    }
    if (VIDEO_PLATFORMS.has(run.platformKey) && !testVideoPath?.trim()) {
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "WAITING_FOR_USER", "MEDIA_REQUIRED", "请选择一个本地测试视频；系统不会自动上传随机文件");
      return this.finish(run.testRunId);
    }
    if (VIDEO_PLATFORMS.has(run.platformKey)) {
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "WAITING_FOR_USER", "VIDEO_SELF_TEST_JOB_REQUIRED", "视频平台需要先在视频素材中心导入用户指定的测试视频并创建持久化任务");
      return this.finish(run.testRunId);
    }
    const content = preparedContent.input;
    const requiredUserFields = preparedContent.prepared && Array.isArray(preparedContent.prepared.response.requiredUserFields)
      ? preparedContent.prepared.response.requiredUserFields.filter((field): field is string => typeof field === "string" && field.trim().length > 0)
      : [];
    const allowDeferredRequiredFields = ["lieju", "sohu_media"].includes(run.platformKey) && isAutomationAdapter(adapter) && typeof adapter.finalSubmit === "function";
    if (requiredUserFields.length > 0 && !allowDeferredRequiredFields) {
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "WAITING_FOR_USER", "REQUIRED_FIELD_MISSING", `平台仍要求用户确认必填字段：${requiredUserFields.join("、")}`, `required_fields:${requiredUserFields.join(",")}`);
      return this.finish(run.testRunId);
    }
    if (isAutomationAdapter(adapter) && typeof adapter.finalSubmit !== "function") {
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "FAILED", "FINAL_SUBMIT_NOT_IMPLEMENTED", "当前 Browser Adapter 没有经过审阅的最终提交实现，未创建发布 Job、未点击发布按钮");
      return this.finish(run.testRunId);
    }
    const job = this.options.repository.createPlatformSelfTestPublishJob({ testRunId: run.testRunId, title: content.title, body: content.body, dryRun: false, selectedImageAssetId: preparedContent.imageAssetId });
    if (preparedContent.prepared && isAutomationAdapter(adapter)) {
      this.options.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: account.platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: null, success: false, response: preparedContent.prepared.response, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: adapter.automationType, browserSessionIdHash: preparedContent.prepared.sessionIdHash ?? account.browserSessionId, operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: preparedContent.prepared.editorOpenedAt ?? null, titleFilled: preparedContent.prepared.titleFilled ?? false, bodyFilled: preparedContent.prepared.bodyFilled ?? false, selectedImageAssetId: preparedContent.imageAssetId, imageSelectionMode: preparedContent.imageAssetId ? "manual" : "none" });
    }
    this.options.repository.confirmJob(job.id, false);
    const action: UserInitiatedAction = { userActionId: run.testRunId, triggerSource: "RUN_SELF_TEST" };
    const execution = await this.options.publisher.executeJob(job.id, action, "VISIBLE");
    const completedJob = this.options.repository.getJob(job.id);
    const record = this.options.repository.getPublishRecordByJob(job.id);
    if (!record || !completedJob || !["Success", "Publishing", "Published"].includes(completedJob.status)) {
      const waiting = completedJob?.status === "NeedsUserAction" || /user|确认|官方页面/iu.test(execution.message);
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", waiting ? "WAITING_FOR_USER" : "FAILED", completedJob?.lastErrorCode ?? (waiting ? "USER_ACTION_REQUIRED" : "UNKNOWN"), execution.message, `job:${job.id}`);
      return this.finish(run.testRunId);
    }
    run = this.options.repository.linkPlatformSelfTestPublishEvidence(run.testRunId, record.id);
    this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "PASSED", null, "平台已接受真实测试发布", `publish_record:${record.id}`, record.publishedExternalId, record.publishedUrl);
    if (!record.publishedExternalId || !record.publishedUrl) {
      this.step(run, "L5_PUBLISH", "EXTERNAL_EVIDENCE", "PARTIAL_PASSED", "EXTERNAL_EVIDENCE_INCOMPLETE", "真实发布响应缺少 External ID 或 URL，未声明完整通过", null, record.publishedExternalId, record.publishedUrl);
      this.step(run, "L5_PUBLISH", "STATUS_RECONCILIATION", "NOT_TESTED", "EXTERNAL_ID_REQUIRED", "缺少完整外部证据，未执行状态回查");
      return this.finish(run.testRunId);
    }
    this.step(run, "L5_PUBLISH", "EXTERNAL_EVIDENCE", "PASSED", null, "已保存真实 External ID 与 URL", null, record.publishedExternalId, record.publishedUrl);
    await this.reconcile(run, account, adapter, record.publishedExternalId);
    return this.finish(run.testRunId);
  }

  private async continueExistingPublishJob(testRunId: string, publishJobId: string): Promise<PlatformSelfTestRun> {
    let run = this.mustRun(testRunId, "L5_PUBLISH");
    const account = this.account(run);
    const adapter = this.options.registry.getForContent(run.platformKey, selfTestContentKind(run.platformKey));
    const execution = await this.options.publisher.executeJob(publishJobId, { userActionId: testRunId, triggerSource: "CONTINUE_PENDING_ACTION" }, "VISIBLE");
    const completedJob = this.options.repository.getJob(publishJobId);
    const record = this.options.repository.getPublishRecordByJob(publishJobId);
    if (!record || !completedJob || !["Success", "Publishing", "Published"].includes(completedJob.status)) {
      const waiting = completedJob?.status === "NeedsUserAction" || /user|确认|官方页面|验证码|安全验证/iu.test(execution.message);
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", waiting ? "WAITING_FOR_USER" : "FAILED", completedJob?.lastErrorCode ?? (waiting ? "USER_ACTION_REQUIRED" : completedJob?.status === "NeedsReconciliation" ? "NEEDS_RECONCILIATION" : "UNKNOWN"), execution.message, `job:${publishJobId}`);
      return this.finish(run.testRunId);
    }
    run = this.options.repository.linkPlatformSelfTestPublishEvidence(run.testRunId, record.id);
    this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "PASSED", null, "平台已接受真实测试发布", `publish_record:${record.id}`, record.publishedExternalId, record.publishedUrl);
    if (!record.publishedExternalId || !record.publishedUrl) {
      this.step(run, "L5_PUBLISH", "EXTERNAL_EVIDENCE", "PARTIAL_PASSED", "EXTERNAL_EVIDENCE_INCOMPLETE", "真实发布响应缺少 External ID 或 URL，未声明完整通过", null, record.publishedExternalId, record.publishedUrl);
      this.step(run, "L5_PUBLISH", "STATUS_RECONCILIATION", "NOT_TESTED", "EXTERNAL_ID_REQUIRED", "缺少完整外部证据，未执行状态回查");
      if (isAutomationAdapter(adapter)) await this.closeAutomationSessions(adapter);
      return this.finish(run.testRunId);
    }
    this.step(run, "L5_PUBLISH", "EXTERNAL_EVIDENCE", "PASSED", null, "已保存真实 External ID 与 URL", null, record.publishedExternalId, record.publishedUrl);
    await this.reconcile(run, account, adapter, record.publishedExternalId);
    if (isAutomationAdapter(adapter)) await this.closeAutomationSessions(adapter);
    return this.finish(run.testRunId);
  }

  async confirmDelete(testRunId: string): Promise<PlatformSelfTestRun> {
    let run = this.options.repository.confirmPlatformSelfTestDelete(testRunId);
    const adapter = this.options.registry.getForContent(run.platformKey, selfTestContentKind(run.platformKey));
    if (!adapter.deleteContent || !run.externalId) {
      this.step(run, "L5_PUBLISH", "DELETE_TEST_CONTENT", "NOT_SUPPORTED", "DELETE_NOT_SUPPORTED", "当前 Adapter 没有经过审阅的可靠删除能力；请使用 External URL 手工处理");
      return this.options.repository.markPlatformSelfTestCleaned(testRunId, "FAILED");
    }
    try {
      const result = await adapter.deleteContent(this.context(this.account(run), run, "VISIBLE"), run.externalId);
      this.step(run, "L5_PUBLISH", "DELETE_TEST_CONTENT", result.deleted ? "PASSED" : "FAILED", result.deleted ? null : "DELETE_NOT_CONFIRMED", result.deleted ? "测试内容删除已由平台确认" : "平台未确认删除", "platform_delete_response");
      run = this.options.repository.markPlatformSelfTestCleaned(testRunId, result.deleted ? "CLEANED" : "FAILED");
      return run;
    } catch (error) {
      const failure = selfTestError(error);
      this.step(run, "L5_PUBLISH", "DELETE_TEST_CONTENT", failure.result, failure.errorCode, failure.message);
      return this.options.repository.markPlatformSelfTestCleaned(testRunId, "FAILED");
    }
  }

  private async runLogin(run: PlatformSelfTestRun, account: Account, adapter: PlatformAdapter, executionMode: BrowserSelfTestMode): Promise<boolean> {
    const startedAt = new Date().toISOString();
    try {
      const login = await adapter.checkLogin(this.context(account, run, executionMode));
      if (login !== "logged_in") {
        const result: PlatformSelfTestResult = ["needs_user_action", "expired", "logged_out"].includes(login) ? "WAITING_FOR_USER" : "FAILED";
        const code = login === "expired" || login === "logged_out" ? "LOGIN_EXPIRED" : login === "needs_user_action" ? "USER_ACTION_REQUIRED" : "LOGIN_STATUS_UNKNOWN";
        this.step(run, "L1_LOGIN", "ACCOUNT_CONNECTION", result, code, `账号连接检查结果：${login}`, null, null, null, startedAt);
        this.step(run, "L1_LOGIN", "SESSION_OR_OAUTH", result, code, "Session / OAuth 未通过当前验证", null, null, null, startedAt);
        this.options.repository.updateAccount(account.id, { loginStatus: login, pausedReason: result === "WAITING_FOR_USER" ? "平台自测等待用户完成正常验证" : "平台自测登录检查未通过" });
        return false;
      }
      this.step(run, "L1_LOGIN", "ACCOUNT_CONNECTION", "PASSED", null, "账号连接状态已由当前 Adapter 实时确认", `adapter:${adapter.platformKey}:checkLogin`, null, null, startedAt);
      let signal = adapter.manifest.integrationMode === "BrowserAutomation" ? "browser_session_authenticated_navigation" : "credential_token_profile_verified";
      if (adapter.getAccountProfile) {
        const profile = await adapter.getAccountProfile(this.context(account, run, executionMode));
        signal = profile.authorizationStatus === "Authorized" ? `${signal}:authorized_profile` : `${signal}:${profile.authorizationStatus}`;
      }
      this.step(run, "L1_LOGIN", "SESSION_OR_OAUTH", "PASSED", null, adapter.manifest.integrationMode === "BrowserAutomation" ? "独立 Browser Session 已恢复并通过登录页判断" : "Credential / Token 已通过账号验证", signal, null, null, startedAt);
      this.options.repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in", pausedReason: null, failedCount: 0 });
      return true;
    } catch (error) {
      const failure = selfTestError(error);
      this.step(run, "L1_LOGIN", "ACCOUNT_CONNECTION", failure.result, failure.errorCode, failure.message, null, null, null, startedAt);
      this.step(run, "L1_LOGIN", "SESSION_OR_OAUTH", failure.result, failure.errorCode, "Session / OAuth 验证未完成", null, null, null, startedAt);
      return false;
    }
  }

  private async runEditorAndContent(run: PlatformSelfTestRun, account: Account, adapter: PlatformAdapter, executionMode: BrowserSelfTestMode): Promise<PreparedEditorRun> {
    const startedAt = new Date().toISOString();
    if (!isAutomationAdapter(adapter)) {
      this.step(run, "L2_EDITOR", "EDITOR_OPEN", "NOT_SUPPORTED", "API_NO_BROWSER_EDITOR", "官方 API / OAuth 平台没有需要打开的浏览器编辑器", "adapter_transport_api", null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "TITLE_FILL", "NOT_SUPPORTED", "API_PAYLOAD_ONLY", "API 平台不会在浏览器编辑器中填写标题", null, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "BODY_FILL", "NOT_SUPPORTED", "API_PAYLOAD_ONLY", "API 平台不会在浏览器编辑器中填写正文", null, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "IMAGE_FILL", "NOT_SUPPORTED", "API_PAYLOAD_ONLY", "图片能力需在 L4/L5 的真实草稿或发布响应中验证", null, null, null, startedAt);
      return { input: transparentSelfTestContent(run.platformKey, this.options.repository.listPlatforms().find((item) => item.platformKey === run.platformKey)?.displayName ?? run.platformKey), imageAssetId: null, prepared: null };
    }
    const platform = this.options.repository.listPlatforms().find((item) => item.platformKey === run.platformKey);
    const content = transparentSelfTestContent(run.platformKey, platform?.displayName ?? run.platformKey);
    // V1.1.8 Lieju acceptance starts without an image. The live adapter must
    // prove whether the platform actually requires one before submitting.
    const image = run.requestedLevel === "L5_PUBLISH" && run.platformKey === "lieju" ? null : this.findTestImage();
    const input: PublishArticleInput = { ...content, ...(image && adapter.getCapabilities().maxImageCount > 0 ? { images: [image.filePath] } : {}) };
    try {
      const prepared = await adapter.preparePublish(this.context(account, run, executionMode), input);
      const executionModeProved = prepared.response.browserExecutionMode === executionMode
        && prepared.response.headless === (executionMode === "BACKGROUND");
      this.step(run, "L2_EDITOR", "BROWSER_EXECUTION_MODE", executionModeProved ? "PASSED" : "FAILED", executionModeProved ? null : "BROWSER_EXECUTION_MODE_NOT_VERIFIED", executionModeProved ? `已由 Browser Session 回传${executionMode === "BACKGROUND" ? "后台" : "可见"}执行证据` : "Adapter 未返回实际 Browser Session 执行模式证据", `browser_execution_mode:${String(prepared.response.browserExecutionMode ?? "UNKNOWN")}:headless:${String(prepared.response.headless ?? "UNKNOWN")}`, null, null, startedAt);
      const editorProved = prepared.prepared && Boolean(prepared.editorOpenedAt || prepared.titleFilled || prepared.bodyFilled || prepared.response.stage === "editor_prepared" || prepared.response.stage === "form_prepared");
      const pageUrl = typeof prepared.response.pageUrl === "string" ? prepared.response.pageUrl : prepared.backendUrl;
      const domEvidence = typeof prepared.response.domEvidence === "string" ? prepared.response.domEvidence : "platform_selector_dom";
      this.step(run, "L2_EDITOR", "EDITOR_OPEN", editorProved ? "PASSED" : "PARTIAL_PASSED", editorProved ? null : "EDITOR_NOT_VERIFIED", editorProved ? "真实发布编辑器已打开" : "只确认后台打开，尚无真实编辑器证据", pageUrl ? `editor_url:${pageUrl}:dom:${domEvidence}` : `browser_backend_opened:dom:${domEvidence}`, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "TITLE_FILL", prepared.titleFilled === true ? "PASSED" : "NOT_SUPPORTED", prepared.titleFilled === true ? null : "TITLE_FILL_NOT_VERIFIED", prepared.titleFilled === true ? "标题已实际填入并回读一致" : "当前 Adapter 未返回标题实际填充证据", prepared.titleFilled === true ? "title_value_round_trip_match" : null, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "BODY_FILL", prepared.bodyFilled === true ? "PASSED" : "NOT_SUPPORTED", prepared.bodyFilled === true ? null : "BODY_FILL_NOT_VERIFIED", prepared.bodyFilled === true ? "正文已实际填入并回读一致" : "当前 Adapter 未返回正文实际填充证据", prepared.bodyFilled === true ? "body_value_round_trip_match" : null, null, null, startedAt);
      const responseEvents = Array.isArray(prepared.response.events)
        ? prepared.response.events.filter((event): event is string => typeof event === "string")
        : [];
      let imageEvidence = typeof prepared.response.imageUploadEvidence === "string" ? prepared.response.imageUploadEvidence.trim() : "";
      const coverUploadMethod = typeof prepared.response.coverUploadMethod === "string" ? prepared.response.coverUploadMethod.trim() : "";
      const coverUploaded = prepared.response.imageRequirement === "cover_uploaded"
        && prepared.response.coverInputVerified === true
        && coverUploadMethod.length > 0;
      const imageUploadStarted = responseEvents.includes("IMAGE_UPLOAD_STARTED");
      const genericImageUploaded = prepared.response.imageUploaded === true
        && imageUploadStarted
        && responseEvents.includes("IMAGE_UPLOAD_PASSED")
        && imageEvidence.length > 0;
      const imageUploaded = genericImageUploaded || coverUploaded;
      if (coverUploaded && imageEvidence.length === 0) imageEvidence = `cover_upload:${coverUploadMethod}`;
      const imageUploadOptional = prepared.response.imageUploadRequired === false;
      const imageResult: PlatformSelfTestResult = imageUploaded ? "PASSED" : imageUploadOptional ? "NOT_SUPPORTED" : "FAILED";
      const imageErrorCode = imageUploaded ? null : imageUploadOptional ? "IMAGE_OPTIONAL_SKIPPED" : "IMAGE_UPLOAD_FAILED";
      if (imageUploadOptional && !imageUploaded && image && (adapter.getCapabilities().imagePost || adapter.getCapabilities().coverImage)) {
        if (imageUploadStarted) this.step(run, "L3_CONTENT_FILL", "IMAGE_UPLOAD_STARTED", "PASSED", null, "Image upload control was attempted", `image_asset:${image.id}:upload_started`, null, null, startedAt);
        this.step(run, "L3_CONTENT_FILL", "IMAGE_FILL", imageResult, imageErrorCode, "Image is optional for this platform and does not block the article test", `image_asset:${image.id}:optional_or_no_dom_evidence`, null, null, startedAt);
        this.step(run, "L3_CONTENT_FILL", "IMAGE_UPLOAD_SKIPPED_OPTIONAL", imageResult, imageErrorCode, "Optional image upload was not required for this article test", null, null, null, startedAt);
        return { input, imageAssetId: imageUploaded ? image.id : null, prepared };
      }
      if (!adapter.getCapabilities().imagePost && !adapter.getCapabilities().coverImage) this.step(run, "L3_CONTENT_FILL", "IMAGE_FILL", "NOT_SUPPORTED", "IMAGE_NOT_SUPPORTED", "平台未声明文章图片能力", null, null, null, startedAt);
      else if (!image) this.step(run, "L3_CONTENT_FILL", "IMAGE_FILL", "NOT_SUPPORTED", "SKIPPED_NO_TEST_IMAGE", "图片库没有标记为“测试/通用”的可用图片；不影响标题和正文结论", null, null, null, startedAt);
      else {
        if (imageUploadStarted) this.step(run, "L3_CONTENT_FILL", "IMAGE_UPLOAD_STARTED", "PASSED", null, "已调用平台网页的正常图片上传控件", `image_asset:${image.id}:upload_started`, null, null, startedAt);
        this.step(run, "L3_CONTENT_FILL", "IMAGE_FILL", imageUploaded ? "PASSED" : "FAILED", imageUploaded ? null : "IMAGE_UPLOAD_FAILED", imageUploaded ? "测试图片已实际上传并由编辑器 DOM 证据确认" : "图片没有取得编辑器 DOM 上传证据，未声明成功", imageUploaded ? `image_asset:${image.id}:${imageEvidence}` : `image_asset:${image.id}:no_dom_evidence`, null, null, startedAt);
        this.step(run, "L3_CONTENT_FILL", imageUploaded ? "IMAGE_UPLOAD_PASSED" : "IMAGE_UPLOAD_FAILED", imageUploaded ? "PASSED" : "FAILED", imageUploaded ? null : "IMAGE_UPLOAD_FAILED", imageUploaded ? "编辑器图片数量增加且远程图片已加载" : "图片上传失败或未取得编辑器 DOM 证据", imageUploaded ? `image_asset:${image.id}:${imageEvidence}` : null, null, null, startedAt);
      }
      return { input, imageAssetId: image?.id ?? null, prepared };
    } catch (error) {
      const failure = selfTestError(error);
      this.step(run, "L2_EDITOR", "EDITOR_OPEN", failure.result, failure.errorCode, failure.message, null, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "TITLE_FILL", failure.result, failure.errorCode, "编辑器未通过，标题未声明填充成功", null, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "BODY_FILL", failure.result, failure.errorCode, "编辑器未通过，正文未声明填充成功", null, null, null, startedAt);
      const imageUploadFailed = failure.errorCode === "UPLOAD_FAILED";
      this.step(run, "L3_CONTENT_FILL", "IMAGE_FILL", imageUploadFailed ? "FAILED" : "NOT_TESTED", imageUploadFailed ? "IMAGE_UPLOAD_FAILED" : failure.errorCode, imageUploadFailed ? "知乎图片上传失败或未取得编辑器 DOM 证据" : "编辑器未通过，图片步骤未执行", null, null, null, startedAt);
      if (imageUploadFailed) this.step(run, "L3_CONTENT_FILL", "IMAGE_UPLOAD_FAILED", "FAILED", "IMAGE_UPLOAD_FAILED", failure.message, null, null, null, startedAt);
      return { input, imageAssetId: image?.id ?? null, prepared: null };
    }
  }

  private async runDraft(run: PlatformSelfTestRun, account: Account, adapter: PlatformAdapter): Promise<void> {
    const startedAt = new Date().toISOString();
    if (!adapter.getCapabilities().draft || !adapter.createDraft) {
      this.step(run, "L4_DRAFT", "DRAFT_SAVE", "NOT_SUPPORTED", "DRAFT_NOT_SUPPORTED", "当前 Adapter 没有可验证的官方/网页草稿保存能力", null, null, null, startedAt);
      return;
    }
    const platform = this.options.repository.listPlatforms().find((item) => item.platformKey === run.platformKey);
    const content = transparentSelfTestContent(run.platformKey, platform?.displayName ?? run.platformKey);
    try {
      const job = this.options.repository.createPlatformSelfTestPublishJob({ testRunId: run.testRunId, title: content.title, body: content.body, dryRun: true });
      this.options.repository.confirmJob(job.id, true);
      const execution = await this.options.publisher.executeJob(job.id);
      const record = this.options.repository.getPublishRecordByJob(job.id);
      if (!record?.dryRun || !record.publishedExternalId) throw new Error(`真实草稿证据不完整：${execution.message}`);
      this.step(run, "L4_DRAFT", "DRAFT_SAVE", "PASSED", null, "平台返回了真实草稿 External ID", `publish_record:${record.id}`, record.publishedExternalId, record.publishedUrl, startedAt);
    } catch (error) {
      const failure = selfTestError(error);
      this.step(run, "L4_DRAFT", "DRAFT_SAVE", failure.result, failure.errorCode, failure.message, null, null, null, startedAt);
    }
  }

  private async reconcile(run: PlatformSelfTestRun, account: Account, adapter: PlatformAdapter, externalId: string): Promise<void> {
    const startedAt = new Date().toISOString();
    if (!adapter.getPublishStatus) {
      this.step(run, "L5_PUBLISH", "STATUS_RECONCILIATION", "NOT_SUPPORTED", "STATUS_QUERY_NOT_SUPPORTED", "当前 Adapter 没有经过审阅的状态回查能力", null, externalId, run.externalUrl, startedAt);
      return;
    }
    try {
      const status = await adapter.getPublishStatus(this.context(account, run, "VISIBLE"), externalId);
      const passed = status.status === "published";
      this.step(run, "L5_PUBLISH", "STATUS_RECONCILIATION", passed ? "PASSED" : status.status === "publishing" ? "PARTIAL_PASSED" : "FAILED", passed ? null : status.errorCode ?? (status.status === "publishing" ? "PROCESSING" : "UNKNOWN"), passed ? "平台状态回查确认内容已发布" : status.errorMessage ?? `平台状态：${status.status}`, `status:${status.status}`, status.externalId ?? externalId, status.publishedUrl ?? run.externalUrl, startedAt);
    } catch (error) {
      const failure = selfTestError(error);
      this.step(run, "L5_PUBLISH", "STATUS_RECONCILIATION", failure.result, failure.errorCode, failure.message, null, externalId, run.externalUrl, startedAt);
    }
  }

  private context(account: Account, run: PlatformSelfTestRun, executionMode: BrowserSelfTestMode): AccountContext {
    return {
      accountId: account.id,
      accountName: account.accountAlias || account.name,
      platformKey: account.platformKey,
      settings: { userActionId: run.testRunId, triggerSource: "RUN_SELF_TEST", browserExecutionMode: executionMode },
      secrets: this.options.resolveAccountSecrets(account.id, account.platformKey)
    };
  }

  private findTestImage() {
    return this.options.repository.listImageAssets(undefined, true).find((image) => image.universal || [...image.usage, ...image.tags].some((label) => /^(测试|通用)$/u.test(label.trim()))) ?? null;
  }

  private backgroundEvidence(run: PlatformSelfTestRun, adapter: PlatformAdapter): BackgroundEvidence {
    const stored = this.options.repository.getPlatformSelfTestRun(run.testRunId) as PlatformSelfTestRun;
    const capabilities = adapter.getCapabilities();
    const image = this.findTestImage();
    const imageRequired = run.platformKey === "zhihu" || ((capabilities.imagePost || capabilities.coverImage) && Boolean(image));
    const requiredKeys = ["ACCOUNT_CONNECTION", "SESSION_OR_OAUTH", "BROWSER_EXECUTION_MODE", "EDITOR_OPEN", "TITLE_FILL", "BODY_FILL", ...(imageRequired ? ["IMAGE_FILL"] : [])];
    const requiredSteps = requiredKeys.map((key) => stored.steps.find((step) => step.stepKey === key));
    const waitingStep = stored.steps.find((step) => step.result === "WAITING_FOR_USER" || SECURITY_OR_LOGIN_CODES.has(step.errorCode ?? ""));
    const missingRequiredImage = imageRequired && !image;
    const failedStep = requiredSteps.find((step) => step && step.result !== "PASSED");
    const missingStepKey = requiredKeys.find((key) => !stored.steps.some((step) => step.stepKey === key));
    const reason = missingRequiredImage
      ? "WAITING_FOR_TEST_IMAGE: 知乎后台模式缺少可用于真实上传验证的测试图片"
      : waitingStep
        ? `${waitingStep.errorCode ?? "USER_ACTION_REQUIRED"}: ${waitingStep.message ?? "需要用户处理"}`
        : failedStep
          ? `${failedStep.errorCode ?? "EVIDENCE_INCOMPLETE"}: ${failedStep.message ?? "后台自测证据不完整"}`
          : `${missingStepKey ? `MISSING_${missingStepKey}` : "BACKGROUND_EVIDENCE_INCOMPLETE"}: 后台自测证据不完整`;
    return {
      passed: !missingRequiredImage && requiredSteps.length === requiredKeys.length && requiredSteps.every((step) => step?.result === "PASSED"),
      waitingForUser: Boolean(waitingStep),
      missingRequiredImage,
      reason
    };
  }

  private persistBackgroundStatus(platformKey: string, status: BackgroundAutomationStatus, reason: string | null): void {
    this.options.repository.updatePlatformBackgroundAutomation(platformKey, status, reason);
    this.options.logger?.info("PLATFORM_SELF_TEST", "BACKGROUND_AUTOMATION_STATUS", "后台自动化状态已更新", { platformKey, status, reason });
  }

  private async closeAutomationSessions(adapter: AutomationAdapter): Promise<void> {
    const close = (adapter as AutomationAdapter & { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions;
    if (typeof close === "function") await close.call(adapter);
  }

  private account(run: PlatformSelfTestRun): Account {
    const account = this.options.repository.listAccounts().find((item) => (item.platformAccountId ?? item.id) === run.platformAccountId && item.platformKey === run.platformKey);
    if (!account) throw new Error("平台自测账号不存在");
    return account;
  }

  private mustRun(testRunId: string, level: PlatformSelfTestLevel): PlatformSelfTestRun {
    const run = this.options.repository.getPlatformSelfTestRun(testRunId);
    if (!run || run.requestedLevel !== level) throw new Error("平台自测运行不存在或等级不匹配");
    return run;
  }

  private step(run: PlatformSelfTestRun, testLevel: PlatformSelfTestLevel, stepKey: string, result: PlatformSelfTestResult, errorCode: string | null, message: string, verificationSignal?: string | null, externalId?: string | null, externalUrl?: string | null, startedAt = new Date().toISOString()): void {
    this.options.repository.recordPlatformSelfTestStep({ testRunId: run.testRunId, testLevel, stepKey, startedAt, result, errorCode, message, verificationSignal, externalId, externalUrl });
    this.options.logger?.info("PLATFORM_SELF_TEST", errorCode ?? stepKey, message, { testRunId: run.testRunId, platformKey: run.platformKey, platformAccountId: run.platformAccountId, testLevel, stepKey, result, verificationSignal, externalId, externalUrl });
  }

  private finish(testRunId: string): PlatformSelfTestRun {
    const run = this.options.repository.getPlatformSelfTestRun(testRunId);
    if (!run) throw new Error("平台自测运行不存在");
    return this.options.repository.finishPlatformSelfTestRun(testRunId, summarizeSelfTestResult(run));
  }

  private finishAs(testRunId: string, result: PlatformSelfTestResult): PlatformSelfTestRun {
    return this.options.repository.finishPlatformSelfTestRun(testRunId, result);
  }
}
