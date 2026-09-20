import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AppRepository } from "@publisher/db";
import { createOwnerAuthorizedOneShotPublication, isAutomationAdapter, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, type AdapterRegistry, type AutomationAdapter, type BrowserSessionRuntimeSnapshot, type ControlledSelfTestMode, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import type { AutomationPrepareResult, ControlledPostUploadDiscoveryResult, PublishFlowExplorationResult } from "@publisher/adapters-core";
import type { Logger } from "@publisher/logger";
import type { PublisherService } from "@publisher/publisher";
import type { Account, AccountContext, BackgroundAutomationStatus, CurrentRuntimeIdentityProof, PlatformSelfTestLevel, PlatformSelfTestResult, PlatformSelfTestRun, PublishArticleInput, Task10SPrepublishResult } from "@publisher/domain";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic, XiaohongshuContextPageInventory, XiaohongshuCurrentFileInputState, XiaohongshuCurrentImageEditorReadiness, XiaohongshuCurrentPostUploadReconciliation, XiaohongshuCurrentPostUploadTerminalReadiness, XiaohongshuGlobalExactPublishDomRuntimeDiagnostic, XiaohongshuPublishEditorDomRuntimeDiagnostic, XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import type { XhsIdentityPageEnsureServiceResult } from "./xhs-identity";
import { OneShotConfirmationCoordinator } from "./one-shot-confirmation";
import { OneShotConfirmationReconciliationService } from "./one-shot-reconciliation";
import { XhsIdentityService } from "./xhs-identity";
import type { CreatorIdentityVerificationResult, FailedOneShotConfirmationIdentity, OneShotConfirmationReconciliationResult, XhsIdentityAcceptance } from "@publisher/domain";
import { emptyTask10sControlledUploadAttemptResult, reserveTask10sAttempt, RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, TASK10S_ATTEMPT_3, TASK10S_ATTEMPT_4, TASK10S_ATTEMPT_5, TASK10S_CANONICAL_AUTHORIZATION_ID, TASK10S_SAFE_FIXTURE_NAME, TASK10S_SAFE_FIXTURE_SIZE, TASK10S_SAFE_FIXTURE_SHA256, validateTask10sSafeFixture, type Task10sAttempt3DispatchDryRunResult, type Task10sAttempt3FileInputReadback, type Task10sControlledUploadAttemptResult, type Task10sControlledUploadAttemptSpec, type Task10sRetainedEditorCompletionResult } from "./task10s-attempt3";
import { blockedTask10sFreshPublishFlowResult, buildTask10sFreshPublishFlowInput, isTask10sFreshPublishFlowReady, isTask10sFreshPublishStartPath, RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, type Task10sFreshPublishFlowResult } from "./task10s-fresh-publish-flow";
import { evaluatePreparedEditorRecoveryEvidence, validatePreparedEditorRecoveryTrustedState, RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, type PreparedEditorRecoveryEvidence, type Task10sPreparedEditorRecoveryResult } from "./task10s-prepared-editor-recovery";
import { resolveTask10sExecutionTarget } from "./task10s-execution-target";
import { buildOneShotContentBinding, validateOneShotContentPayload, verifyOneShotContentBinding, type OneShotContentPayload } from "./one-shot-content-binding";

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

function safeSelfTestImagePath(fileName = "task10n-safe-test.png"): string {
  const directory = join(tmpdir(), "geo-media-publisher-safe-fixtures");
  const imagePath = join(directory, fileName);
  mkdirSync(directory, { recursive: true });
  if (!existsSync(imagePath) || statSync(imagePath).size !== SAFE_TEST_IMAGE_BYTES.byteLength) writeFileSync(imagePath, SAFE_TEST_IMAGE_BYTES, { flag: "w" });
  return imagePath;
}

const XHS_EXPLORATION_TITLE = "小红书发布流程测试-请勿发布";
const XHS_EXPLORATION_BODY = "自动化发布流程验证，仅用于本地测试，不执行最终发布。";
const XHS_ONE_SHOT_CONFIRMATION = "本次会真实发布 1 条测试笔记，最多提交一次。";
export const TASK10S_FRESH_COMPLETION_ARM = "TASK10S_FRESH_COMPLETION_ARM" as const;
export interface Task10sFreshCompletionArmResult {
  action: typeof TASK10S_FRESH_COMPLETION_ARM;
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
  jobId?: string;
  freshOperationId?: string;
  testRunId: string;
  finalSubmitClickCount: 0;
  mousePressedCount: 0;
  publicationTransactionCount: 0;
  preparedJobMediaGate?: "PASS" | "BLOCKED";
  selectedImageAssetId?: string | null;
}
export const RUN_XHS_TASK10S_ARM_RUN = "RUN_XHS_TASK10S_ARM_RUN" as const;
export const TASK10S_ARM_RUN = RUN_XHS_TASK10S_ARM_RUN;
export interface Task10sArmRunResult {
  action: typeof TASK10S_ARM_RUN;
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
  requestedTestRunId: string | null;
  resolvedTestRunId: string | null;
  accountId: string | null;
  jobId?: string;
  articleId?: string;
  publishRecordId?: string;
  freshOperationId?: string;
  authorizationState: "AUTHORIZED_UNUSED" | "BLOCKED";
  preparedJobMediaGate: "PASS" | "BLOCKED";
  armOnly: "YES";
  completionExecuted: "NO";
  finalSubmitClickCount: 0;
  mousePressedCount: 0;
  publicationTransactionCount: 0;
}
const XHS_EXPLORATION_EVIDENCE_FILE = "xiaohongshu-task10r-publish-flow-exploration.json";
function publishDomainCountsEqual(left: { publishJobs: number; submissionIntents: number; publishRecords: number }, right: { publishJobs: number; submissionIntents: number; publishRecords: number }): boolean {
  return left.publishJobs === right.publishJobs && left.submissionIntents === right.submissionIntents && left.publishRecords === right.publishRecords;
}
function hasOneShotPrepublishState(run: PlatformSelfTestRun): boolean {
  return run.steps.some((item) => item.errorCode === "ONE_SHOT_PREPUBLISH_EVIDENCE_INCOMPLETE" || (item.stepKey === "PREPUBLISH_READY" && item.result === "PASSED"));
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

interface Task10sClosedShadowEvidence {
  result: XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic;
  accountId: string;
  operationId: string;
  sessionId: string | null;
  contextId: string | null;
  pageId: string | null;
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
  evidenceDirectory?: string;
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

function imageUploadEvidenceSummary(value: unknown): { verified: boolean; signal: string; previewCount: number | null } {
  if (typeof value === "string") {
    const signal = value.trim();
    return { verified: signal.length > 0, signal, previewCount: null };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { verified: false, signal: "", previewCount: null };
  const evidence = value as Record<string, unknown>;
  const verified = evidence.verified === true;
  const requestedCount = typeof evidence.requestedCount === "number" && Number.isInteger(evidence.requestedCount) ? evidence.requestedCount : null;
  const previewCount = typeof evidence.previewCount === "number" && Number.isInteger(evidence.previewCount) ? evidence.previewCount : null;
  const previewVisible = evidence.previewVisible === true;
  const uploadBusyCount = typeof evidence.uploadBusyCount === "number" && Number.isInteger(evidence.uploadBusyCount) ? evidence.uploadBusyCount : null;
  const sufficientPreview = requestedCount !== null && requestedCount > 0 && previewCount !== null && previewCount >= requestedCount && previewVisible && uploadBusyCount === 0;
  return {
    verified: verified && sufficientPreview,
    signal: verified && sufficientPreview ? `editor_dom_preview_count:${String(previewCount)}:requested:${String(requestedCount)}:busy:${String(uploadBusyCount)}` : "",
    previewCount
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function requiredFieldValues(value: unknown): Array<{ label: string; empty: boolean; visible: boolean; enabled: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.map(recordValue).filter((field): field is Record<string, unknown> => Boolean(field)).map((field) => ({
    label: stringValue(field.label) ?? "",
    empty: booleanValue(field.empty),
    visible: booleanValue(field.visible),
    enabled: booleanValue(field.enabled)
  }));
}

function publishSettingValues(value: unknown): Array<{ label: string; required: boolean; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.map(recordValue).filter((setting): setting is Record<string, unknown> => Boolean(setting)).map((setting) => ({
    label: stringValue(setting.label) ?? "",
    required: booleanValue(setting.required),
    value: stringValue(setting.value) ?? ""
  }));
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

function safeUrlPath(value: string | null): string | null {
  if (!value) return null;
  try { return new URL(value).pathname; } catch { return null; }
}

function safeUrlOrigin(value: string | null): string | null {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeBoolean(value: unknown): boolean { return value === true; }

function safeInteger(value: unknown): number | null { return typeof value === "number" && Number.isInteger(value) ? value : null; }

function safeText(value: unknown): string | null { return typeof value === "string" ? value.slice(0, 160) : null; }

function safeFingerprint(value: unknown): Record<string, unknown> | null {
  const record = safeRecord(value);
  if (!record) return null;
  return {
    tagName: safeText(record.tagName),
    type: safeText(record.type),
    accept: safeText(record.accept),
    multiple: safeBoolean(record.multiple),
    disabled: safeBoolean(record.disabled),
    connected: safeBoolean(record.connected),
    classNameSafe: safeText(record.classNameSafe)
  };
}

function safeImmediateReadback(value: unknown): Task10sAttempt3FileInputReadback {
  const record = safeRecord(value);
  const readback = safeRecord(record?.readback);
  const files = Array.isArray(readback?.files) ? readback.files : [];
  const first = safeRecord(files[0]);
  const filesLength = safeInteger(readback?.filesLength);
  const status = record?.status === "PASS" ? "PASS" : record?.status === "FAIL" ? "FAIL" : "NOT_OBSERVED";
  const expectedFixtureMatch = record?.expectedFixtureMatch === "YES" ? "YES" : record?.expectedFixtureMatch === "NO" ? "NO" : "NOT_OBSERVED";
  return {
    filesLength,
    fileName: safeText(first?.name),
    fileSize: safeInteger(first?.size),
    fileType: safeText(first?.type),
    fileLastModified: safeInteger(first?.lastModified),
    status,
    expectedFixtureMatch
  };
}

function safePostUploadEvidence(result: ControlledPostUploadDiscoveryResult): Record<string, unknown> | null {
  return safeRecord(result.evidence.postUploadInspection);
}

export class PlatformSelfTestService {
  // Browser evidence is valid only in this Main lifetime. Never restore it from
  // a diagnostic JSON file after restart, or accept it from a caller/renderer.
  private task10sFreshEvidence: { result: Task10sFreshPublishFlowResult; contentBindingId: string; sessionId: string | null; pageId: string | null } | null = null;
  // The closed-shadow proof is also process-memory-only and is bound to the
  // fresh-flow operation that was active when the read-only diagnostic ran.
  private task10sClosedShadowEvidence: Task10sClosedShadowEvidence | null = null;
  private readonly controlledOperations = new Set<string>();
  private readonly oneShotConfirmations = new OneShotConfirmationCoordinator();
  private readonly oneShotReconciliation: OneShotConfirmationReconciliationService;
  private readonly xhsIdentity: XhsIdentityService;

  constructor(private readonly options: PlatformSelfTestServiceOptions) {
    this.oneShotReconciliation = new OneShotConfirmationReconciliationService({ repository: options.repository, logger: options.logger });
    this.xhsIdentity = new XhsIdentityService({ repository: options.repository, registry: options.registry, logger: options.logger });
  }

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
  async runPostUploadDiscovery(platformAccountId: string, mode: ControlledSelfTestMode): Promise<ControlledPostUploadDiscoveryResult> {
    const account = this.options.repository.listAccounts().find((item) => (item.platformAccountId ?? item.id) === platformAccountId && item.platformKey === "xiaohongshu");
    if (!account || !account.enabled || account.archivedAt) throw new Error("小红书受控上传自测账号不可用");
    if (mode !== "POST_UPLOAD_DISCOVERY_ONLY") throw new Error("不支持的受控自测模式");
    if (this.controlledOperations.has(account.id)) throw new Error("CONTROLLED_SELF_TEST_ALREADY_RUNNING");
    const adapter = this.options.registry.getForContent("xiaohongshu", "article");
    if (!isAutomationAdapter(adapter) || typeof adapter.runControlledPostUploadDiscovery !== "function") throw new Error("当前小红书 Adapter 未提供受控上传后发现能力");
    const operationId = randomUUID();
    this.controlledOperations.add(account.id);
    try {
      const context: AccountContext = {
        accountId: account.id,
        accountName: account.accountAlias || account.name,
        platformKey: "xiaohongshu",
        settings: { userActionId: operationId, triggerSource: "CONTROLLED_SELF_TEST", controlledSelfTestMode: mode, browserExecutionMode: "VISIBLE" },
        secrets: this.options.resolveAccountSecrets(account.id, account.platformKey)
      };
      const imagePath = safeSelfTestImagePath();
      this.options.logger?.info("PLATFORM_SELF_TEST", "CONTROLLED_POST_UPLOAD_DISCOVERY_STARTED", "开始小红书受控首次上传后发现；仅使用安全测试夹具，不创建发布域记录", { platformKey: "xiaohongshu", platformAccountId, mode, imageSource: "SAFE_TEST_FIXTURE" });
      const result = await adapter.runControlledPostUploadDiscovery(context, { imagePath, imageSource: "SAFE_TEST_FIXTURE" });
      this.options.logger?.info("PLATFORM_SELF_TEST", "CONTROLLED_POST_UPLOAD_DISCOVERY_COMPLETED", "小红书受控首次上传后发现已停止在标题/正文/最终发布之前", { platformKey: "xiaohongshu", platformAccountId, mode: result.mode, status: result.status, operationId: result.operationId, uploadMutationCount: result.uploadMutationCount, contentMutationCount: result.contentMutationCount, finalSubmitCount: result.finalSubmitCount });
      return result;
    } finally {
      this.controlledOperations.delete(account.id);
    }
  }

  /**
   * Main-side dispatch-only proof. It does not need an XHS runtime and has no
   * browser or publication side effects.
   */
  async runTask10sAttempt3DispatchDryRun(): Promise<Task10sAttempt3DispatchDryRunResult> {
    return {
      status: "PASS",
      sideEffectCounts: { pageCreated: 0, contextCreated: 0, imagePostEntryClick: 0, uploadImages: 0, setInputFiles: 0, titleFill: 0, bodyFill: 0, finalSubmit: 0, publicationTransaction: 0, newAuthorization: 0 }
    };
  }

  /**
   * Main-side fixed Task10S Attempt 3 runner. It is intentionally not exposed
   * as a renderer or IPC method: the only caller is the exact second-instance
   * diagnostic action. It stops after upload delivery/post-upload evidence.
   */
  async runTask10sControlledUploadAttempt3(accountId?: string): Promise<Task10sControlledUploadAttemptResult> {
    return this.runTask10sControlledUploadAttempt(TASK10S_ATTEMPT_3, accountId);
  }

  /** Main-side fixed Attempt 4 action with its own replay guard. */
  async runTask10sControlledUploadAttempt4(accountId?: string): Promise<Task10sControlledUploadAttemptResult> {
    return this.runTask10sControlledUploadAttempt(TASK10S_ATTEMPT_4, accountId);
  }

  /** Main-side fixed Attempt 5 action with its own replay guard. */
  async runTask10sControlledUploadAttempt5(accountId?: string): Promise<Task10sControlledUploadAttemptResult> {
    return this.runTask10sControlledUploadAttempt(TASK10S_ATTEMPT_5, accountId);
  }

  /**
   * Main-side fixed completion action for the already-uploaded retained editor.
   * It deliberately resolves the account, authorization, run, job, and
   * prepared record from trusted Main state; no caller may supply a Page,
   * Context, selector, content, or file path.
   */
  async runTask10sCompleteRetainedEditor(): Promise<Task10sRetainedEditorCompletionResult>;
  async runTask10sCompleteRetainedEditor(requestedTestRunId: string): Promise<Task10sRetainedEditorCompletionResult>;
  async runTask10sCompleteRetainedEditor(requestedTestRunId?: string): Promise<Task10sRetainedEditorCompletionResult> {
    const blocked = (failureCode: string, overrides: Record<string, unknown> = {}): Task10sRetainedEditorCompletionResult => ({
      action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR,
      status: "BLOCKED",
      failureCode,
      uploadCallCount: 0,
      finalSubmitClickCount: 0,
      ...overrides
    });
    // Legacy diagnostics may still invoke the no-argument action; live routes
    // always provide an explicit target through the parameterized CLI flag.
    if (!requestedTestRunId?.trim()) return blocked("TASK10S_TEST_RUN_ID_REQUIRED");
    const effectiveTestRunId = requestedTestRunId;
    try {
      const resolved = resolveTask10sExecutionTarget(this.options.repository, effectiveTestRunId);
      // Legacy compatibility previously used getPlatformSelfTestRun(TASK10S_CANONICAL_AUTHORIZATION_ID); parameterized live routes never use that path.
      if (resolved.status !== "PASS") {
        const legacyFailure = !requestedTestRunId && resolved.failureCode === "RUN_HAS_NO_BOUND_JOB"
          ? "TASK10S_RETAINED_EDITOR_PREPARED_JOB_MISSING"
          : !requestedTestRunId && resolved.failureCode === "RECORD_JOB_BINDING_MISMATCH"
            ? "TASK10S_RETAINED_EDITOR_ARTICLE_BINDING_INVALID"
            : resolved.failureCode;
        return blocked(legacyFailure, { testRunId: effectiveTestRunId });
      }
      const target = resolved.target;
      const run = this.options.repository.getPlatformSelfTestRun(target.testRunId);
      const account = run ? this.account(run) : undefined;
      if (!account || !account.enabled || account.archivedAt) return blocked("XHS_ACCOUNT_UNAVAILABLE", { accountId: account?.id ?? null, testRunId: target.testRunId });
      const job = this.options.repository.getJob(target.publishJobId);
      const preparedRecord = this.options.repository.getPublishRecordByJob(target.publishJobId);
      const authorization = this.options.repository.getOneShotPublicationAuthorization(target.testRunId);
      if (!run || run.testRunId !== target.testRunId || !job || job.id !== target.publishJobId || !preparedRecord || preparedRecord.id !== target.publishRecordId) return blocked("TASK10S_EXECUTION_TARGET_INVALID", { accountId: account.id, testRunId: target.testRunId, jobId: target.publishJobId, publishRecordId: target.publishRecordId });
      if (run.requestedLevel !== "L5_PUBLISH" || !["Pending", "Scheduled", "Retry", "NeedsUserAction"].includes(job.status) || preparedRecord.status !== "Prepared") {
        return blocked("TASK10S_RETAINED_EDITOR_PREPARED_JOB_REQUIRED", { accountId: account.id, testRunId: run.testRunId, jobId: job.id, jobStatus: job.status, preparedRecordStatus: preparedRecord.status });
      }
      if (!authorization
        || authorization.authorization !== OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH
        || authorization.state !== "AUTHORIZED_UNUSED"
        || authorization.platformKey !== "xiaohongshu"
        || authorization.accountId !== account.id
        || authorization.operationId !== target.testRunId
        || authorization.mode !== ONE_SHOT_REAL_PUBLISH_ACCEPTANCE
        || authorization.publicationTransactionCount !== 0
        || authorization.publicationCommitActionCount !== 0
        || authorization.finalSubmitAttemptCount !== 0
        || authorization.finalSubmitRetryCount !== 0
        || authorization.finalSubmitActionStarted
        || authorization.finalSubmitActionCompleted) {
        return blocked("TASK10S_RETAINED_EDITOR_AUTHORIZATION_NOT_UNUSED", { accountId: account.id, testRunId: run.testRunId, jobId: job.id, authorizationState: authorization?.state ?? null });
      }
      if (this.controlledOperations.has(account.id)) return blocked("TASK10S_RETAINED_EDITOR_ALREADY_RUNNING", { accountId: account.id, testRunId: run.testRunId, jobId: job.id });
      const adapter = this.options.registry.getForContent("xiaohongshu", "article");
      if (!isAutomationAdapter(adapter) || typeof adapter.finalSubmit !== "function" || typeof adapter.getBrowserRuntimeSnapshot !== "function") return blocked("TASK10S_RETAINED_EDITOR_ADAPTER_UNAVAILABLE", { accountId: account.id, testRunId: run.testRunId, jobId: job.id });
      const context = this.context(account, run, "VISIBLE");
      const runtime = adapter.getBrowserRuntimeSnapshot(context);
      if (runtime.platformKey !== account.platformKey || runtime.accountId !== account.id) return blocked("TASK10S_RETAINED_EDITOR_RUNTIME_ACCOUNT_MISMATCH", { accountId: account.id, testRunId: run.testRunId, jobId: job.id, contextDebugId: runtime.contextDebugId, pageDebugId: runtime.canonicalPageDebugId });
      if (!runtime.sessionExists || runtime.browserConnected !== true || !runtime.contextExists || !runtime.canonicalPageExists || runtime.canonicalPageClosed === true || runtime.runtimeAuthState !== "AUTHENTICATED") {
        return blocked("TASK10S_RETAINED_EDITOR_RUNTIME_UNAVAILABLE", { accountId: account.id, testRunId: run.testRunId, jobId: job.id, contextDebugId: runtime.contextDebugId, pageDebugId: runtime.canonicalPageDebugId });
      }
      const identityRecovery = await this.xhsIdentity.ensureCurrentContextIdentityPage(account.id);
      if (identityRecovery.status !== "PASS") {
        return blocked("TASK10S_RETAINED_EDITOR_CONTEXT_IDENTITY_ATTESTATION_FAILED", { accountId: account.id, testRunId: run.testRunId, jobId: job.id, contextDebugId: runtime.contextDebugId, pageDebugId: runtime.canonicalPageDebugId, expectedCreatorId: this.expectedCreatorId(account), failureCode: identityRecovery.failureCode });
      }
      const identityAttestation = await this.xhsIdentity.validateContextIdentityAttestation(account.id);
      const identityAttestationPass = identityAttestation.valid;
      const attestation = this.xhsIdentity.getContextIdentityAttestation(account.id);
      if (!identityAttestationPass || !attestation) return blocked("TASK10S_RETAINED_EDITOR_CONTEXT_IDENTITY_ATTESTATION_FAILED", { accountId: account.id, testRunId: run.testRunId, jobId: job.id, contextDebugId: runtime.contextDebugId, pageDebugId: runtime.canonicalPageDebugId, expectedCreatorId: this.expectedCreatorId(account), failureCode: identityAttestation.failureCode });

      this.controlledOperations.add(account.id);
      try {
        const article = this.options.repository.getArticle(job.articleId);
        if (!article
          || !job.articleId
          || job.id !== run.publishJobId
          || article.id !== job.articleId
          || run.platformKey !== account.platformKey
          || run.platformAccountId !== (account.platformAccountId ?? account.id)
          || job.accountId !== account.id
          || job.platformAccountId !== (account.platformAccountId ?? account.id)
          || job.platformKey !== account.platformKey
          || preparedRecord.jobId !== job.id
          || preparedRecord.articleId !== article.id
          || preparedRecord.accountId !== account.id
          || preparedRecord.platformAccountId !== (account.platformAccountId ?? account.id)
          || preparedRecord.platformKey !== account.platformKey) {
          return blocked("TASK10S_RETAINED_EDITOR_ARTICLE_BINDING_INVALID", { accountId: account.id, testRunId: run.testRunId, jobId: job.id, contextDebugId: runtime.contextDebugId, pageDebugId: runtime.canonicalPageDebugId });
        }
        const binding = this.requireOneShotContentBinding(run);
        const snapshot = this.options.repository.contentSnapshots.assertCurrent(job.id);
        if (snapshot.id !== binding.contentBindingId || authorization.contentBindingId !== snapshot.id || preparedRecord.contentBindingId !== snapshot.id) throw new Error("CONTENT_RETAINED_RELATION_MISMATCH");
        this.options.logger?.info("PLATFORM_SELF_TEST", "TASK10S_COMPLETE_RETAINED_EDITOR_STARTED", "Task10S retained-editor fixed completion action 已通过 Main-side preflight；将复用已有图片编辑器，不执行上传", { action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, accountId: account.id, testRunId: run.testRunId, jobId: job.id, contextDebugId: runtime.contextDebugId, pageDebugId: runtime.canonicalPageDebugId, uploadCallCount: 0 });
        const execution = await this.options.publisher.executeTask10sRetainedEditor(job.id, { userActionId: run.testRunId, triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization);
        const after = this.options.repository.getOneShotPublicationAuthorization(target.testRunId);
        const reconciledRecord = this.options.repository.getPublishRecordByJob(target.publishJobId);
        if (!reconciledRecord || reconciledRecord.id !== target.publishRecordId) return blocked("TASK10S_RECONCILIATION_TARGET_MISMATCH", { accountId: account.id, testRunId: target.testRunId, jobId: target.publishJobId, publishRecordId: target.publishRecordId });
        const finalSubmitClickCount = after?.finalSubmitAttemptCount === 1 ? 1 as const : 0 as const;
        const passed = ["Success", "Published", "Publishing"].includes(execution.job.status) && finalSubmitClickCount === 1;
        return {
          action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR,
          status: passed ? "PASS" : "BLOCKED",
          failureCode: passed ? null : execution.job.lastErrorCode ?? "TASK10S_RETAINED_EDITOR_COMPLETION_NOT_VERIFIED",
          accountId: account.id,
          testRunId: run.testRunId,
          jobId: job.id,
          contextDebugId: runtime.contextDebugId,
          pageDebugId: runtime.canonicalPageDebugId,
          uploadCallCount: 0,
          titleFillCount: passed ? 1 : 0,
          bodyFillCount: passed ? 1 : 0,
          finalSubmitClickCount,
          publicationTransactionCount: after?.publicationTransactionCount === 1 ? 1 : 0,
          authorizationState: after?.state ?? "NOT_VERIFIED",
          reconciliationTargetJobId: target.publishJobId,
          reconciliationTargetRecordId: target.publishRecordId,
          reconciliationRecordStatus: reconciledRecord.status ?? null,
          message: execution.message,
          jobStatus: execution.job.status,
          evidence: { contextIdentityAttestationPass: identityAttestationPass, sameContext: true, sourcePageIdentity: attestation.sourcePageIdentity, currentPageIdentity: runtime.canonicalPageDebugId, trustedArticleId: article.id, trustedArticleTitle: article.title, trustedArticleBody: article.body }
        };
      } finally {
        this.controlledOperations.delete(account.id);
      }
    } catch (error) {
      const after = this.options.repository.getOneShotPublicationAuthorization(effectiveTestRunId);
      const finalSubmitStarted = after?.finalSubmitActionStarted === true;
      return blocked(error instanceof Error ? error.message : "TASK10S_RETAINED_EDITOR_COMPLETION_FAILED", {
        finalSubmitClickCount: finalSubmitStarted ? 1 : 0,
        publicationTransactionCount: after?.publicationTransactionCount === 1 ? 1 : 0,
        authorizationState: after?.state ?? "NOT_VERIFIED"
      });
    }
  }

  private async runTask10sControlledUploadAttempt(attempt: Task10sControlledUploadAttemptSpec, requestedAccountId?: string): Promise<Task10sControlledUploadAttemptResult> {
    let attemptConsumed = false;
    const counts = (): Pick<Task10sControlledUploadAttemptResult, "controlledUploadAttempt3Count" | "controlledUploadAttempt4Count" | "controlledUploadAttempt5Count" | "imageUploadAttemptCount"> => ({
      controlledUploadAttempt3Count: attemptConsumed && attempt.attemptId === "ATTEMPT_3" ? 1 : 0,
      controlledUploadAttempt4Count: attemptConsumed && attempt.attemptId === "ATTEMPT_4" ? 1 : 0,
      controlledUploadAttempt5Count: attemptConsumed && attempt.attemptId === "ATTEMPT_5" ? 1 : 0,
      imageUploadAttemptCount: attemptConsumed ? attempt.imageUploadAttemptCount : attempt.baseImageUploadAttemptCount
    });
    const blocked = (failureCode: string, overrides: Partial<Task10sControlledUploadAttemptResult> = {}): Task10sControlledUploadAttemptResult => ({
      ...emptyTask10sControlledUploadAttemptResult(attempt, requestedAccountId ?? "UNRESOLVED"),
      ...counts(),
      status: "BLOCKED",
      failureCode,
      ...overrides
    });
    try {
      const account = this.selectedXhsAccount(requestedAccountId);
      if (!account.enabled || account.archivedAt) return blocked("XHS_ACCOUNT_UNAVAILABLE", { accountId: account.id });
      const adapter = this.options.registry.getForContent("xiaohongshu", "article");
      if (!isAutomationAdapter(adapter) || typeof adapter.runControlledPostUploadDiscovery !== "function" || typeof adapter.getBrowserRuntimeSnapshot !== "function") return blocked(`${attempt.attemptId}_ADAPTER_CAPABILITY_UNAVAILABLE`);
      const context: AccountContext = {
        accountId: account.id,
        accountName: account.accountAlias || account.name,
        platformKey: "xiaohongshu",
        settings: { userActionId: `task10s-controlled-upload-${attempt.attemptId.toLowerCase()}`, triggerSource: "CONTROLLED_SELF_TEST", controlledSelfTestMode: "POST_UPLOAD_DISCOVERY_ONLY", browserExecutionMode: "VISIBLE" },
        secrets: this.options.resolveAccountSecrets(account.id, account.platformKey)
      };
      const runtimeBefore = adapter.getBrowserRuntimeSnapshot(context);
      if (runtimeBefore.platformKey !== account.platformKey || runtimeBefore.accountId !== account.id) return blocked("XHS_CANONICAL_RUNTIME_ACCOUNT_MISMATCH", { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId, authorizedRunStateAfter: "NOT_VERIFIED" });
      if (!runtimeBefore.sessionExists || runtimeBefore.browserConnected !== true || !runtimeBefore.contextExists || !runtimeBefore.canonicalPageExists || runtimeBefore.canonicalPageClosed === true || runtimeBefore.runtimeAuthState !== "AUTHENTICATED") {
        return blocked("XHS_CANONICAL_RUNTIME_UNAVAILABLE", { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId, authorizedRunStateAfter: "NOT_VERIFIED" });
      }
      const authorization = this.options.repository.getOneShotPublicationAuthorization(TASK10S_CANONICAL_AUTHORIZATION_ID);
      if (!authorization
        || authorization.authorization !== OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH
        || authorization.state !== "AUTHORIZED_UNUSED"
        || authorization.platformKey !== "xiaohongshu"
        || authorization.accountId !== account.id
        || authorization.operationId !== TASK10S_CANONICAL_AUTHORIZATION_ID
        || authorization.mode !== ONE_SHOT_REAL_PUBLISH_ACCEPTANCE
        || authorization.publicationTransactionCount !== 0
        || authorization.publicationCommitActionCount !== 0
        || authorization.finalSubmitAttemptCount !== 0
        || authorization.finalSubmitRetryCount !== 0
        || authorization.finalSubmitActionStarted
        || authorization.finalSubmitActionCompleted) {
        return blocked(`${attempt.attemptId}_AUTHORIZATION_NOT_AVAILABLE`, { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId });
      }
      if (this.controlledOperations.has(account.id)) return blocked("CONTROLLED_SELF_TEST_ALREADY_RUNNING", { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId });

      const identity = await this.xhsIdentity.verifyCreatorIdentity(account.id);
      const identityUrl = identity.canonicalPageUrl;
      const identityRouteValid = safeUrlOrigin(identityUrl) === "https://creator.xiaohongshu.com" && safeUrlPath(identityUrl) === "/new/home";
      const identityPassed = identity.verified
        && identity.expectedExternalCreatorId === this.expectedCreatorId(account)
        && identity.observed.externalCreatorId === this.expectedCreatorId(account)
        && identity.canonicalContextId === runtimeBefore.contextDebugId
        && identity.canonicalPageId === runtimeBefore.canonicalPageDebugId
        && identityRouteValid;
      if (!identityPassed) return blocked("CURRENT_RUNTIME_IDENTITY_REVALIDATION_FAILED", { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId, evidence: { expectedCreatorId: this.expectedCreatorId(account), observedCreatorId: identity.observed.externalCreatorId, identityVerified: identity.verified, canonicalRoute: identityRouteValid ? "/new/home" : safeUrlPath(identityUrl) } });

      const fixture = validateTask10sSafeFixture();
      if (!fixture.valid) return blocked(fixture.failureCode ?? "SAFE_FIXTURE_INVALID", { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId, evidence: { fixture: { path: fixture.path, exists: fixture.exists, fileName: fixture.fileName, sizeBytes: fixture.sizeBytes, sha256: fixture.sha256, expectedName: TASK10S_SAFE_FIXTURE_NAME, expectedSizeBytes: TASK10S_SAFE_FIXTURE_SIZE, expectedSha256: TASK10S_SAFE_FIXTURE_SHA256 } } });

      const guardPath = join(this.options.evidenceDirectory ?? join(process.cwd(), "output", "task10s-evidence"), attempt.stateFileName);
      const reserveAtMutationBoundary = (): void => {
        if (attemptConsumed) throw new Error("CONTROLLED_UPLOAD_ATTEMPT_ALREADY_RESERVED");
        const reservation = reserveTask10sAttempt(attempt, guardPath, { accountId: account.id, contextDebugId: runtimeBefore.contextDebugId ?? "unknown-context", pageDebugId: runtimeBefore.canonicalPageDebugId ?? "unknown-page" });
        if (!reservation.acquired) throw new Error(reservation.reason);
        attemptConsumed = true;
      };

      this.controlledOperations.add(account.id);
      try {
        this.options.logger?.info("PLATFORM_SELF_TEST", `TASK10S_CONTROLLED_UPLOAD_${attempt.attemptId}_STARTED`, `收到固定 Main-side Task10S ${attempt.attemptId}；即将只执行一次受控图片上传并停止在上传后证据`, { platformKey: "xiaohongshu", accountId: account.id, contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId, attemptId: attempt.attemptId, attemptCount: attemptConsumed ? 1 : 0 });
        const controlled = await adapter.runControlledPostUploadDiscovery(context, { imagePath: fixture.path, imageSource: "SAFE_TEST_FIXTURE", onUploadMutationStarted: reserveAtMutationBoundary });
        if (controlled.uploadMutationCount > 0 && !attemptConsumed) {
          return blocked(`${attempt.attemptId}_MUTATION_BOUNDARY_NOT_RESERVED`, { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId, authorizedRunStateAfter: "NOT_VERIFIED", evidence: { guardPath, controlled } });
        }
        const runtimeAfter = adapter.getBrowserRuntimeSnapshot(context);
        const authorizationAfter = this.options.repository.getOneShotPublicationAuthorization(TASK10S_CANONICAL_AUTHORIZATION_ID);
        const authorizedRunStateAfter = authorizationAfter?.state === "AUTHORIZED_UNUSED" && authorizationAfter.publicationTransactionCount === 0 && authorizationAfter.finalSubmitAttemptCount === 0 && authorizationAfter.finalSubmitActionStarted === false && authorizationAfter.finalSubmitActionCompleted === false ? "AUTHORIZED_UNUSED" : "NOT_VERIFIED";
        return this.summarizeTask10sAttemptResult(controlled, runtimeBefore, runtimeAfter, authorizedRunStateAfter, attempt, attemptConsumed);
      } catch (error) {
        return blocked(`${attempt.attemptId}_CONTROLLED_FLOW_FAILED`, { contextDebugId: runtimeBefore.contextDebugId, pageDebugId: runtimeBefore.canonicalPageDebugId, authorizedRunStateAfter: "NOT_VERIFIED", evidence: { errorType: error instanceof Error ? error.name : "UnknownError", errorCode: error instanceof Error ? error.message : null, guardPath } });
      } finally {
        this.controlledOperations.delete(account.id);
      }
    } catch (error) {
      return blocked(`${attempt.attemptId}_MAIN_GUARD_FAILED`, { evidence: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    }
  }

  /**
   * Runs the owner-authorized XHS flow exploration against the existing visible
   * account session. It is intentionally outside PlatformSelfTestRun and never
   * creates a Job, SubmissionIntent, or PublishRecord.
   */
  async runPublishFlowExploration(platformAccountId: string, mode: "XHS_PUBLISH_FLOW_EXPLORATION"): Promise<PublishFlowExplorationResult> {
    const account = this.options.repository.listAccounts().find((item) => (item.id === platformAccountId || (item.platformAccountId ?? item.id) === platformAccountId) && item.platformKey === "xiaohongshu");
    if (!account || !account.enabled || account.archivedAt) throw new Error("小红书发布流程探索账号不可用");
    if (mode !== "XHS_PUBLISH_FLOW_EXPLORATION") throw new Error("不支持的小红书发布流程探索模式");
    if (this.controlledOperations.has(account.id)) throw new Error("PUBLISH_FLOW_EXPLORATION_ALREADY_RUNNING");
    const adapter = this.options.registry.getForContent("xiaohongshu", "article");
    if (!isAutomationAdapter(adapter) || typeof adapter.runPublishFlowExploration !== "function") throw new Error("当前小红书 Adapter 未提供发布流程探索能力");
    const requestId = randomUUID();
    this.controlledOperations.add(account.id);
    const before = this.options.repository.getPublishDomainCounts();
    try {
      const context: AccountContext = {
        accountId: account.id,
        accountName: account.accountAlias || account.name,
        platformKey: "xiaohongshu",
        settings: { userActionId: requestId, triggerSource: "CONTROLLED_SELF_TEST", controlledSelfTestMode: mode, browserExecutionMode: "VISIBLE" },
        secrets: this.options.resolveAccountSecrets(account.id, account.platformKey)
      };
      const imagePath = safeSelfTestImagePath("task10r-safe-test.png");
      this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_FLOW_EXPLORATION_STARTED", "开始小红书端到端发布流程探索；最终发布按钮只读发现，不执行发布", { platformKey: "xiaohongshu", platformAccountId, mode: "XHS_PUBLISH_FLOW_EXPLORATION", imageSource: "SAFE_TEST_FIXTURE" });
      const result = await adapter.runPublishFlowExploration(context, { imagePath, imageSource: "SAFE_TEST_FIXTURE", title: XHS_EXPLORATION_TITLE, body: XHS_EXPLORATION_BODY });
      const after = this.options.repository.getPublishDomainCounts();
      const publishDomainUnchanged = publishDomainCountsEqual(before, after);
      const persistedResult: PublishFlowExplorationResult = publishDomainUnchanged
        ? result
        : { ...result, status: "SAFETY_BOUNDARY_VIOLATION", blocker: "TASK10R_DB_CHANGED", failureCode: "TASK10R_DB_CHANGED", readyForFinalSubmit: false };
      const persisted = {
        task: "TASK_10R" as const,
        operation: { operationId: persistedResult.operationId, platformKey: persistedResult.platformKey, accountId: persistedResult.accountId, mode: persistedResult.mode },
        canonical: { sameContext: persistedResult.sameContext, samePage: persistedResult.sameCanonicalPage, pageSurvivesUpload: Boolean(persistedResult.evidence.canonicalPageSurvivesUpload) },
        ...persistedResult,
        database: { before, after },
        evidence: { ...persistedResult.evidence, databaseBefore: before, databaseAfter: after, publishDomainUnchanged },
        safety: { finalSubmitCount: persistedResult.finalSubmitCount, uploadMutationCount: persistedResult.uploadMutationCount, uploadRetryCount: persistedResult.uploadRetryCount, intermediateActionClickCount: persistedResult.intermediateActionClickCount, titleMutationCount: persistedResult.titleMutationCount, bodyMutationCount: persistedResult.bodyMutationCount, settingsMutationCount: persistedResult.settingsMutationCount, contentMutationCount: persistedResult.contentMutationCount, jobCreated: false, intentCreated: false, publishRecordCreated: false }
      };
      const outputDirectory = join(process.cwd(), "output");
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(join(outputDirectory, XHS_EXPLORATION_EVIDENCE_FILE), JSON.stringify(persisted, null, 2), "utf8");
      this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_FLOW_EXPLORATION_COMPLETED", "小红书发布流程探索完成；未执行最终发布", { platformKey: "xiaohongshu", platformAccountId, operationId: persistedResult.operationId, status: persistedResult.status, readyForFinalSubmit: persistedResult.readyForFinalSubmit, finalSubmitCount: persistedResult.finalSubmitCount, output: XHS_EXPLORATION_EVIDENCE_FILE, publishDomainUnchanged });
      return persisted;
    } finally {
      this.controlledOperations.delete(account.id);
    }
  }

  /**
   * Runs the fixed fresh-publish diagnostic from Creator Home.  This is a
   * separate action from the historical retained-editor and controlled-upload
   * attempts: it rejects an existing editor route before it can reuse a draft,
   * uses the repository-owned safe fixture and fixed content, and never
   * invokes the final submit action.
   */
  async runTask10sFreshPublishFlow(requestedAccountId?: string, requestedTestRunId?: string): Promise<Task10sFreshPublishFlowResult> {
    this.task10sFreshEvidence = null;
    this.task10sClosedShadowEvidence = null;
    const operationId = randomUUID();
    const requested = requestedTestRunId?.trim() || null;
    if (!requested) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: null, accountId: requestedAccountId ?? null, failureCode: "TASK10S_FRESH_RUN_UNAVAILABLE" });
    const requestedRun = requested ? this.options.repository.getPlatformSelfTestRun(requested) : null;
    if (requested && (!requestedRun || requestedRun.testRunId !== requested || requestedRun.requestedLevel !== "L5_PUBLISH" || !requestedRun.accountId)) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: requestedAccountId ?? null, failureCode: "TASK10S_FRESH_RUN_UNAVAILABLE" });
    if (requestedRun?.publishJobId) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: requestedRun.accountId, failureCode: "TASK10S_FRESH_RUN_JOB_ALREADY_EXISTS" });
    const account = this.selectedXhsAccount(requestedAccountId ?? requestedRun?.accountId ?? undefined);
    if (!account || !account.enabled || account.archivedAt) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account?.id ?? null, failureCode: "XHS_ACCOUNT_UNAVAILABLE" });
    if (requestedRun && (requestedRun.accountId !== account.id || requestedRun.platformKey !== account.platformKey || requestedRun.platformAccountId !== (account.platformAccountId ?? account.id))) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "TASK10S_FRESH_RUN_ACCOUNT_MISMATCH" });

    const adapter = this.options.registry.getForContent("xiaohongshu", "article");
    if (!isAutomationAdapter(adapter) || typeof adapter.runPublishFlowExploration !== "function" || typeof adapter.getBrowserRuntimeSnapshot !== "function" || typeof adapter.getBrowserSessionEvidence !== "function") {
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "XHS_FRESH_PUBLISH_FLOW_ADAPTER_UNAVAILABLE" });
    }

    const context: AccountContext = {
      accountId: account.id,
      accountName: account.accountAlias || account.name,
      platformKey: "xiaohongshu",
      settings: { userActionId: operationId, triggerSource: "CONTROLLED_SELF_TEST", controlledSelfTestMode: "XHS_PUBLISH_FLOW_EXPLORATION", browserExecutionMode: "VISIBLE" },
      secrets: this.options.resolveAccountSecrets(account.id, account.platformKey)
    };
    const runtime = adapter.getBrowserRuntimeSnapshot(context);
    const sessionEvidence = await adapter.getBrowserSessionEvidence(context).catch(() => null);
    const pathname = safeUrlPath(sessionEvidence?.pageUrl ?? null);
    const origin = safeUrlOrigin(sessionEvidence?.pageUrl ?? null);
    if (runtime.platformKey !== account.platformKey || runtime.accountId !== account.id) {
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "XHS_FRESH_PUBLISH_FLOW_ACCOUNT_MISMATCH" });
    }
    if (!runtime.sessionExists || runtime.browserConnected !== true || !runtime.contextExists || !runtime.canonicalPageExists || runtime.canonicalPageClosed === true || runtime.runtimeAuthState !== "AUTHENTICATED") {
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "XHS_FRESH_PUBLISH_FLOW_RUNTIME_UNAVAILABLE" });
    }
    if (requestedRun && runtime.accountId !== requestedRun.accountId) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "TASK10S_FRESH_RUN_RUNTIME_ACCOUNT_MISMATCH" });
    if (origin !== "https://creator.xiaohongshu.com" || !isTask10sFreshPublishStartPath(pathname ?? "")) {
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "FRESH_PUBLISH_REQUIRES_CREATOR_HOME" });
    }

    const identity = await this.xhsIdentity.establishContextIdentityAttestation(account.id);
    if (identity.status !== "PASS") {
      const identityEvidence = { status: "BLOCKED" as const, creatorId: null, contextId: runtime.contextDebugId, failureCode: identity.failureCode };
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: identity.failureCode, identityAttestation: identityEvidence });
    }
    const attestation = identity.attestation;
    const identityEvidence = { status: "PASS" as const, creatorId: attestation.observedExternalCreatorId, contextId: attestation.browserContextIdentity, failureCode: null };
    const expectedCreatorId = this.expectedCreatorId(account);
    if (!expectedCreatorId || attestation.observedExternalCreatorId !== expectedCreatorId) {
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "TASK10S_FRESH_RUN_CREATOR_IDENTITY_MISMATCH", identityAttestation: identityEvidence });
    }

    let content: PublishArticleInput;
    let contentBindingId: string;
    try {
      const currentRun = this.options.repository.getPlatformSelfTestRun(requested)!;
      const binding = this.requireOneShotContentBinding(currentRun);
      if (currentRun.overallResult !== "WAITING_FOR_USER" || !currentRun.steps.some((step) => step.stepKey === "PUBLISH_CONFIRMATION" && step.result === "WAITING_FOR_USER" && step.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED")) throw new Error("CONTENT_CONFIRMATION_REQUEST_REQUIRED");
      if (binding.creatorId !== attestation.observedExternalCreatorId) throw new Error("ONE_SHOT_CONTENT_SUBJECT_MISMATCH");
      if (!adapter.supportsBoundImageBuffers || adapter.getCapabilities().maxImageCount < 1) throw new Error("CONTENT_BOUND_IMAGE_UPLOAD_NOT_SUPPORTED");
      contentBindingId = binding.contentBindingId;
      content = this.options.repository.contentSnapshots.input(this.options.repository.contentSnapshots.get(contentBindingId), requested);
    } catch (error) {
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: error instanceof Error ? error.message : "ONE_SHOT_CONTENT_PAYLOAD_REQUIRED" });
    }
    const image = content.boundImages?.[0];
    if (!image || content.boundImages?.length !== 1) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "CONTENT_IMAGE_COUNT_NOT_SUPPORTED" });
    const fixtureEvidence: Task10sFreshPublishFlowResult["fixture"] = { path: content.images![0]!, expectedName: image.name, expectedSizeBytes: image.buffer.length, expectedSha256: image.sha256, valid: true, failureCode: null };
    if (this.controlledOperations.has(account.id)) return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: "XHS_FRESH_PUBLISH_FLOW_ALREADY_RUNNING", fixture: fixtureEvidence, identityAttestation: identityEvidence });

    const before = this.options.repository.getPublishDomainCounts();
    this.controlledOperations.add(account.id);
    try {
      this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_TASK10S_FRESH_PUBLISH_FLOW_STARTED", "开始固定小红书 fresh publish flow diagnostic；从 Creator Home 进入并在最终发布前停止", { action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, accountId: account.id, operationId, pathname, contextDebugId: runtime.contextDebugId, imageSource: "SAFE_TEST_FIXTURE" });
      const exploration = await adapter.runPublishFlowExploration(context, { ...buildTask10sFreshPublishFlowInput(content.images![0]!, operationId), title: content.title, body: content.body, boundImages: content.boundImages });
      const after = this.options.repository.getPublishDomainCounts();
      const publishDomainUnchanged = publishDomainCountsEqual(before, after);
      const safetyViolation = !publishDomainUnchanged || exploration.finalSubmitCount !== 0 || exploration.counters.finalSubmitCount !== 0 || exploration.forbiddenMutationObserved;
      const persistedExploration = safetyViolation
        ? { ...exploration, status: "SAFETY_BOUNDARY_VIOLATION" as const, blocker: "TASK10S_FRESH_PUBLISH_FLOW_SAFETY_BOUNDARY", failureCode: "TASK10S_FRESH_PUBLISH_FLOW_SAFETY_BOUNDARY", readyForFinalSubmit: false }
        : exploration;
      const newPublishEntry = persistedExploration.timeline.some((item) => item.phase === "IMAGE_POST_PRE_UPLOAD" && item.action === "PUBLISH_NOTE_NAVIGATION" && item.result === "PASS") ? "PASS" as const : "FAIL" as const;
      const finalPublishButtonMatchCount = persistedExploration.finalSubmit.status === "FOUND_UNIQUE"
        ? 1
        : persistedExploration.finalSubmit.status === "AMBIGUOUS" ? 2 : 0;
      const readyForFinalSubmit = persistedExploration.status === "PASS_READY_FOR_FINAL_SUBMIT"
        && persistedExploration.readyForFinalSubmit
        && isTask10sFreshPublishFlowReady({
          identityVerified: true,
          newPublishEntryPass: newPublishEntry === "PASS",
          uploadProofPass: persistedExploration.uploadAttempts === 1 && persistedExploration.uploadMutationCount === 1,
          titleReadbackExact: persistedExploration.titleReadbackVerified,
          bodyReadbackExact: persistedExploration.bodyReadbackVerified,
          finalPublishButtonMatchCount,
          finalPublishEnabled: persistedExploration.finalSubmit.visible && persistedExploration.finalSubmit.enabled && persistedExploration.finalSubmit.hitTestValid,
          finalSubmitCount: persistedExploration.finalSubmitCount
        })
        && !safetyViolation;
      const result: Task10sFreshPublishFlowResult = {
        action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW,
        status: persistedExploration.status,
        operationId,
        testRunId: requested,
        accountId: account.id,
        newPublishEntry,
        identityAttestation: identityEvidence,
        fixture: fixtureEvidence,
        fixedContent: { title: content.title, body: content.body },
        exploration: persistedExploration,
        readyForFinalSubmit,
        safety: { uploadAttempts: persistedExploration.uploadAttempts, titleMutationCount: persistedExploration.titleMutationCount, bodyMutationCount: persistedExploration.bodyMutationCount, finalSubmitCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 },
        failureCode: safetyViolation ? "TASK10S_FRESH_PUBLISH_FLOW_SAFETY_BOUNDARY" : (persistedExploration.failureCode ?? null)
      };
      this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_TASK10S_FRESH_PUBLISH_FLOW_COMPLETED", "小红书 fresh publish flow diagnostic 已完成；未执行最终发布", { action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, accountId: account.id, operationId, status: result.status, readyForFinalSubmit, newPublishEntry, uploadAttempts: result.safety.uploadAttempts, titleMutationCount: result.safety.titleMutationCount, bodyMutationCount: result.safety.bodyMutationCount, finalSubmitCount: 0, publicationTransactionCount: 0, publishDomainUnchanged });
      if (!safetyViolation) this.task10sFreshEvidence = { result: structuredClone(result), contentBindingId, sessionId: runtime.browserSessionIdentity ?? null, pageId: runtime.canonicalPageDebugId };
      return result;
    } catch (error) {
      return blockedTask10sFreshPublishFlowResult({ operationId, testRunId: requested, accountId: account.id, failureCode: error instanceof Error ? error.message : "XHS_FRESH_PUBLISH_FLOW_FAILED", fixture: fixtureEvidence, identityAttestation: identityEvidence });
    } finally {
      this.controlledOperations.delete(account.id);
    }
  }

  /** Compatibility-shaped result for the old action. It is fail-closed unless an explicit run is supplied. */
  async armTask10sFreshCompletion(testRunId?: string): Promise<Task10sFreshCompletionArmResult> {
    const requested = testRunId?.trim() || null;
    if (!requested) return {
      action: TASK10S_FRESH_COMPLETION_ARM, status: "BLOCKED", failureCode: "TASK10S_ARM_TEST_RUN_ID_REQUIRED",
      testRunId: "", freshOperationId: this.task10sFreshEvidence?.result.operationId,
      finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0, preparedJobMediaGate: "BLOCKED"
    };
    const armed = await this.armTask10sRun(requested);
    const legacyFailureCode: Record<string, string> = {
      TASK10S_ARM_EVIDENCE_INCOMPLETE: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE",
      TASK10S_ARM_SAME_RUN_EVIDENCE_MISMATCH: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE",
      TASK10S_ARM_JOB_ALREADY_EXISTS: "TASK10S_FRESH_ARM_JOB_ALREADY_EXISTS",
      TASK10S_ARM_MEDIA_FIXTURE_INVALID: "TASK10S_FRESH_ARM_MEDIA_FIXTURE_INVALID",
      TASK10S_ARM_RUNTIME_BINDING_MISMATCH: "TASK10S_FRESH_ARM_RUNTIME_BINDING_MISMATCH"
    };
    return {
      action: TASK10S_FRESH_COMPLETION_ARM,
      status: armed.status,
      failureCode: armed.failureCode ? legacyFailureCode[armed.failureCode] ?? armed.failureCode : null,
      testRunId: armed.resolvedTestRunId ?? requested,
      jobId: armed.jobId,
      freshOperationId: armed.freshOperationId,
      finalSubmitClickCount: 0,
      mousePressedCount: 0,
      publicationTransactionCount: 0,
      preparedJobMediaGate: armed.preparedJobMediaGate,
      selectedImageAssetId: armed.jobId ? this.options.repository.getJob(armed.jobId)?.selectedImageAssetId : null
    };
  }

  /** r51 explicit ARM-only transition. It creates durable prepared state and never executes completion. */
  async armTask10sRun(requestedTestRunId?: string): Promise<Task10sArmRunResult> {
    const requested = requestedTestRunId?.trim() || null;
    const blocked = (failureCode: string, input: Partial<Task10sArmRunResult> = {}): Task10sArmRunResult => ({
      action: TASK10S_ARM_RUN, status: "BLOCKED", failureCode, requestedTestRunId: requested, resolvedTestRunId: input.resolvedTestRunId ?? null,
      accountId: input.accountId ?? null, authorizationState: "BLOCKED", preparedJobMediaGate: "BLOCKED", armOnly: "YES", completionExecuted: "NO",
      finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0, ...input
    });
    if (!requested) return blocked("TASK10S_ARM_TEST_RUN_ID_REQUIRED");
    const repository = this.options.repository;
    const initialRun = repository.getPlatformSelfTestRun(requested);
    if (!initialRun || initialRun.testRunId !== requested || initialRun.requestedLevel !== "L5_PUBLISH") return blocked("TASK10S_ARM_RUN_NOT_FOUND");
    const account = repository.getAccountById(initialRun.accountId ?? initialRun.platformAccountId, "xiaohongshu");
    if (!account || account.platformKey !== "xiaohongshu" || !account.enabled || Boolean(account.archivedAt)) return blocked("TASK10S_ARM_ACCOUNT_UNAVAILABLE", { resolvedTestRunId: requested });
    if (this.controlledOperations.has(account.id)) return blocked("TASK10S_ARM_ALREADY_RUNNING", { resolvedTestRunId: requested, accountId: account.id });
    this.controlledOperations.add(account.id);
    try {
      const accountExternalId = account.externalAccountId?.trim() || null;
      const binding = repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
      const bindingExternalId = binding?.externalCreatorId?.trim() || null;
      const expectedCreatorId = this.expectedCreatorId(account);
      if (!expectedCreatorId || !accountExternalId || !bindingExternalId || bindingExternalId !== accountExternalId) return blocked("TASK10S_ARM_ACCOUNT_IDENTITY_BINDING_MISMATCH", { resolvedTestRunId: requested, accountId: account.id });
      if (initialRun.platformKey !== "xiaohongshu" || initialRun.accountId !== account.id || initialRun.platformAccountId !== (account.platformAccountId ?? account.id)) return blocked("TASK10S_ARM_RUN_ACCOUNT_MISMATCH", { resolvedTestRunId: requested, accountId: account.id });
      if (initialRun.publishJobId) return blocked("TASK10S_ARM_JOB_ALREADY_EXISTS", { resolvedTestRunId: requested, accountId: account.id });
      const existingAuthorization = repository.getOneShotPublicationAuthorization(requested);
      const currentAuthorizationIdentityValid = existingAuthorization?.authorization === OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH
        && existingAuthorization.platformKey === account.platformKey
        && existingAuthorization.accountId === account.id
        && existingAuthorization.operationId === requested
        && existingAuthorization.mode === ONE_SHOT_REAL_PUBLISH_ACCEPTANCE;
      const currentAuthorizationUnused = currentAuthorizationIdentityValid
        && existingAuthorization?.state === "AUTHORIZED_UNUSED"
        && existingAuthorization.publicationTransactionCount === 0
        && existingAuthorization.publicationCommitActionCount === 0
        && existingAuthorization.finalSubmitAttemptCount === 0
        && existingAuthorization.finalSubmitRetryCount === 0
        && !existingAuthorization.finalSubmitActionStarted
        && !existingAuthorization.finalSubmitActionCompleted;
      const currentAuthorizationIgnored = existingAuthorization?.state === "SUPERSEDED_UNUSED" || (existingAuthorization?.state as string | undefined) === "COMPLETION_FAILED";
      if (existingAuthorization && !currentAuthorizationIgnored && (!currentAuthorizationIdentityValid || !currentAuthorizationUnused)) return blocked("TASK10S_ARM_AUTHORIZATION_NOT_UNUSED", { resolvedTestRunId: requested, accountId: account.id });
      if (existingAuthorization && currentAuthorizationUnused) return blocked("TASK10S_ARM_AUTHORIZATION_NOT_UNUSED", { resolvedTestRunId: requested, accountId: account.id });

      // Authorization conflicts are scoped to the same XHS one-shot operation
      // scope. Historical superseded, terminal, and failed-job authorizations
      // must not act as an account-global lock for a new Run.
      const activeAuthorizationConflict = repository.db.prepare(`SELECT auth.operation_id
        FROM one_shot_publication_authorizations auth
        LEFT JOIN platform_self_test_runs run ON run.test_run_id=auth.operation_id
        LEFT JOIN publish_jobs job ON job.id=run.publish_job_id
        WHERE auth.authorization=? AND auth.platform_key=? AND auth.account_id=? AND auth.mode=?
          AND auth.operation_id<>? AND auth.state='AUTHORIZED_UNUSED'
          AND auth.publication_transaction_count=0 AND auth.publication_commit_action_count=0
          AND auth.final_submit_attempt_count=0 AND auth.final_submit_retry_count=0
          AND auth.final_submit_action_started=0 AND auth.final_submit_action_completed=0
          AND (run.publish_job_id IS NULL OR job.status IS NULL OR job.status<>'Failed')
        LIMIT 1`).get(
        OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
        account.platformKey,
        account.id,
        ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
        requested
      ) as { operation_id?: string } | undefined;
      if (activeAuthorizationConflict) return blocked("TASK10S_ARM_AUTHORIZATION_NOT_UNUSED", { resolvedTestRunId: requested, accountId: account.id });

      const identity = await this.xhsIdentity.validateContextIdentityAttestation(account.id);
      const currentAttestation = this.xhsIdentity.getContextIdentityAttestation(account.id);
      if (!identity.valid || !currentAttestation || currentAttestation.observedExternalCreatorId !== expectedCreatorId) return blocked("TASK10S_ARM_IDENTITY_ATTESTATION_INVALID", { resolvedTestRunId: requested, accountId: account.id });
      const cached = this.task10sFreshEvidence;
      const fresh = cached?.result;
      const exploration = fresh?.exploration;
      if (!fresh || fresh.testRunId !== requested || fresh.accountId !== account.id || fresh.identityAttestation.creatorId !== expectedCreatorId) return blocked("TASK10S_ARM_SAME_RUN_EVIDENCE_MISMATCH", { resolvedTestRunId: requested, accountId: account.id, freshOperationId: fresh?.operationId });
      const closedShadow = this.task10sClosedShadowEvidence;
      const closedShadowResult = closedShadow?.result;
      const closedShadowBindingPass = Boolean(closedShadow && closedShadowResult && closedShadow.accountId === account.id && closedShadow.operationId === fresh.operationId && closedShadow.sessionId === cached.sessionId && closedShadow.contextId === fresh.identityAttestation.contextId && closedShadow.pageId === cached.pageId && closedShadowResult.accountId === account.id && closedShadowResult.contextDebugId === fresh.identityAttestation.contextId && closedShadowResult.pageId === cached.pageId);
      const closedShadowPass = closedShadowBindingPass && closedShadowResult?.inspectionStatus === "PASS" && closedShadowResult.failureCode === null && closedShadowResult.sessionExists && closedShadowResult.browserConnected && closedShadowResult.contextExists && closedShadowResult.pageExists && !closedShadowResult.pageClosed && closedShadowResult.pageContextMatchesSession && closedShadowResult.origin === "https://creator.xiaohongshu.com" && closedShadowResult.pathname === "/publish/publish" && closedShadowResult.cdpSessionCreated === "YES" && closedShadowResult.cdpGetDocumentSuccess === "YES" && closedShadowResult.cdpGetDocumentPierce === true && closedShadowResult.piercedXhsPublishBtnCount === 1 && closedShadowResult.exactPublishNativeButtonCount === 1 && closedShadowResult.hostNodeName === "XHS-PUBLISH-BTN" && closedShadowResult.hostIsPublish === "true" && closedShadowResult.hostSubmitText === "发布" && closedShadowResult.hostSubmitDisabled === "false" && closedShadowResult.hostSubmitLoading === "false" && closedShadowResult.hostDescendantButtonCount === 1 && closedShadowResult.buttonNodeName === "BUTTON" && closedShadowResult.buttonTextSafe === "发布" && closedShadowResult.buttonAriaDisabled === "false" && closedShadowResult.buttonAriaBusy === "false" && closedShadowResult.buttonBoxModelPresent === "YES" && closedShadowResult.finalSubmitControlPresent === "YES" && closedShadowResult.finalSubmitControlEnabled === "YES" && closedShadowResult.closedShadowFinalSubmitSurface === "PASS";
      const genericResolverPass = (exploration?.failureCode === null || exploration?.failureCode === undefined) && exploration?.finalSubmit.status === "FOUND_UNIQUE" && exploration.finalSubmit.visible && exploration.finalSubmit.enabled && exploration.finalSubmit.hitTestValid;
      const genericResolverFalseNegative = exploration?.failureCode === "FINAL_SUBMIT_CONTROL_NOT_FOUND" && exploration.finalSubmit.status === "NOT_FOUND";
      const finalSubmitEvidencePass = genericResolverPass || (genericResolverFalseNegative && closedShadowPass);
      const editorReady = Boolean(exploration?.states.some((state) => state.phase === "POST_UPLOAD_TERMINAL_READINESS" && state.postUploadState === "EDITOR_READY" && state.ready === true && state.imageCounterValid === true && typeof state.editorScopedImageAssetCount === "number" && state.editorScopedImageAssetCount > 0 && state.uploadErrorSignalPresent === false && state.busySignalPresent === false));
      if (!exploration || !closedShadowPass || (!genericResolverFalseNegative && fresh.status !== "PASS_READY_FOR_FINAL_SUBMIT") || (genericResolverFalseNegative && exploration.status !== "BLOCKED") || fresh.newPublishEntry !== "PASS" || !fresh.fixture.valid || fresh.identityAttestation.status !== "PASS" || exploration.accountId !== account.id || exploration.platformKey !== account.platformKey || exploration.operationId !== fresh.operationId || exploration.status === "SAFETY_BOUNDARY_VIOLATION" || exploration.forbiddenMutationObserved || !exploration.sameCanonicalPage || !exploration.sameContext || exploration.uploadAttempts !== 1 || exploration.uploadMutationCount !== 1 || exploration.uploadRetryCount !== 0 || exploration.counters.uploadAttempts !== 1 || exploration.counters.uploadMutationCount !== 1 || exploration.counters.uploadRetryCount !== 0 || exploration.titleMutationCount !== 1 || exploration.bodyMutationCount !== 1 || !exploration.titleReadbackVerified || !exploration.bodyReadbackVerified || !exploration.title.readbackVerified || !exploration.body.readbackVerified || exploration.title.mutationCount !== 1 || exploration.body.mutationCount !== 1 || !finalSubmitEvidencePass || exploration.finalSubmitCount !== 0 || exploration.counters.finalSubmitCount !== 0 || !editorReady) return blocked("TASK10S_ARM_EVIDENCE_INCOMPLETE", { resolvedTestRunId: requested, accountId: account.id, freshOperationId: fresh.operationId });

      const adapter = this.options.registry.getForContent(account.platformKey, "article");
      if (!isAutomationAdapter(adapter) || typeof adapter.getBrowserRuntimeSnapshot !== "function") return blocked("TASK10S_ARM_RUNTIME_UNAVAILABLE", { resolvedTestRunId: requested, accountId: account.id, freshOperationId: fresh.operationId });
      const runtime = adapter.getBrowserRuntimeSnapshot(this.context(account, initialRun, "VISIBLE"));
      if (!cached.sessionId || !cached.pageId || !fresh.identityAttestation.contextId || runtime.platformKey !== account.platformKey || runtime.accountId !== account.id || !runtime.sessionExists || runtime.browserConnected !== true || !runtime.contextExists || !runtime.canonicalPageExists || runtime.canonicalPageClosed === true || runtime.runtimeAuthState !== "AUTHENTICATED" || runtime.browserSessionIdentity !== cached.sessionId || runtime.contextDebugId !== fresh.identityAttestation.contextId || runtime.canonicalPageDebugId !== cached.pageId) return blocked("TASK10S_ARM_RUNTIME_BINDING_MISMATCH", { resolvedTestRunId: requested, accountId: account.id, freshOperationId: fresh.operationId });
      const contentBinding = this.requireOneShotContentBinding(initialRun);
      const snapshot = repository.contentSnapshots.get(contentBinding.contentBindingId);
      if (cached.contentBindingId !== snapshot.id || !initialRun.steps.some((step) => step.stepKey === "PUBLISH_CONFIRMATION" && step.result === "WAITING_FOR_USER" && step.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED")) throw new Error("CONTENT_CONFIRMATION_REQUEST_REQUIRED");
      const check = verifyOneShotContentBinding(contentBinding, { platformKey: account.platformKey, accountId: account.id, creatorId: expectedCreatorId, title: stringValue(exploration.evidence.titleReadbackValue) ?? "", body: stringValue(exploration.evidence.bodyReadbackValue) ?? "", imageAssetId: contentBinding.imageAssetId, imageSha256: stringValue(exploration.evidence.uploadedImageSha256) });
      if (check.status === "FAIL" || fresh.fixedContent.title !== snapshot.rawTitle || fresh.fixedContent.body !== snapshot.rawBody) throw new Error("ARM_CONTENT_READBACK_MISMATCH");
      const mediaAsset = repository.getImageAsset(contentBinding.imageAssetId);
      if (!mediaAsset) throw new Error("ONE_SHOT_CONTENT_IMAGE_BINDING_INVALID");

      const authorization = { ...createOwnerAuthorizedOneShotPublication({ operationId: requested, platformKey: account.platformKey, accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }), contentBindingId: snapshot.id };
      const outcome = repository.db.transaction((): Task10sArmRunResult => {
        const run = repository.getPlatformSelfTestRun(requested);
        if (!run || run.publishJobId) return blocked("TASK10S_ARM_JOB_ALREADY_EXISTS", { resolvedTestRunId: requested, accountId: account.id, freshOperationId: fresh.operationId });
        if (run.overallResult !== "WAITING_FOR_USER" || !run.steps.some((step) => step.stepKey === "PUBLISH_CONFIRMATION" && step.result === "WAITING_FOR_USER" && step.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED")) throw new Error("CONTENT_CONFIRMATION_REQUEST_REQUIRED");
        const currentAuthorization = repository.getOneShotPublicationAuthorization(requested);
        const persistedAuthorization = currentAuthorization
          ? { authorization: currentAuthorization, created: false }
          : repository.confirmPlatformSelfTestOneShotAtomically(requested, authorization);
        if (persistedAuthorization.authorization.state !== "AUTHORIZED_UNUSED") return blocked("TASK10S_ARM_AUTHORIZATION_NOT_UNUSED", { resolvedTestRunId: requested, accountId: account.id, freshOperationId: fresh.operationId });
        this.requireOneShotContentBinding(run);
        const job = repository.createPlatformSelfTestPublishJob({ testRunId: requested, title: fresh.fixedContent.title, body: fresh.fixedContent.body, dryRun: false, selectedImageAssetId: mediaAsset.id, contentBindingId: snapshot.id });
        const record = repository.insertPublishRecord({ contentBindingId: snapshot.id, jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: account.platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: null, success: false, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: adapter.automationType, browserSessionIdHash: account.browserSessionId, operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: null, titleFilled: true, bodyFilled: true, selectedImageAssetId: mediaAsset.id, imageSelectionMode: "manual", response: { action: TASK10S_ARM_RUN, requestedTestRunId: requested, freshOperationId: fresh.operationId, authorizationOperationId: persistedAuthorization.authorization.operationId, authorizationState: persistedAuthorization.authorization.state, freshFlowEvidence: fresh, imageSource: "SAFE_TEST_FIXTURE", preparedJobMediaGate: "PASS", selectedImageAssetId: mediaAsset.id, armOnly: "YES", completionExecuted: "NO", finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 } });
        repository.confirmJob(job.id, false);
        const finalRun = repository.getPlatformSelfTestRun(requested);
        if (finalRun?.publishJobId !== job.id || finalRun.publishRecordId !== record.id) throw new Error("TASK10S_ARM_RUN_JOB_LINK_MISSING");
        return { action: TASK10S_ARM_RUN, status: "PASS", failureCode: null, requestedTestRunId: requested, resolvedTestRunId: requested, accountId: account.id, jobId: job.id, articleId: job.articleId, publishRecordId: record.id, freshOperationId: fresh.operationId, authorizationState: "AUTHORIZED_UNUSED", preparedJobMediaGate: "PASS", armOnly: "YES", completionExecuted: "NO", finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 };
      }).immediate();
      this.options.logger?.info("PLATFORM_SELF_TEST", "TASK10S_ARM_RUN_STOPPED", "Parameterized Task10S ARM 已停止；未执行 completion 或发布", { ...outcome });
      return outcome;
    } catch (error) {
      this.options.logger?.warn("PLATFORM_SELF_TEST", "TASK10S_ARM_RUN_FAILED", "Parameterized Task10S ARM 失败；持久化事务已回滚", { errorType: error instanceof Error ? error.name : "UnknownError" });
      return blocked(error instanceof Error ? error.message : "TASK10S_ARM_FAILED", { resolvedTestRunId: requested, accountId: account.id, freshOperationId: this.task10sFreshEvidence?.result.operationId });
    } finally {
      this.controlledOperations.delete(account.id);
    }
  }

  /**
   * Rebinds a lost editor to the existing Task10S Prepared Job. This action is
   * intentionally browser-only after its read-only Main preflight: it never
   * creates or changes Jobs, Records, Articles, authorizations, or submit
   * state, and it stops after the editor and closed-shadow surfaces are ready.
   */
  async recoverTask10sPreparedEditor(): Promise<Task10sPreparedEditorRecoveryResult>;
  async recoverTask10sPreparedEditor(requestedTestRunId: string): Promise<Task10sPreparedEditorRecoveryResult>;
  async recoverTask10sPreparedEditor(requestedTestRunId?: string): Promise<Task10sPreparedEditorRecoveryResult> {
    const blocked = (failureCode: string, overrides: Partial<Task10sPreparedEditorRecoveryResult> = {}): Task10sPreparedEditorRecoveryResult => ({
      action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY,
      status: "BLOCKED",
      failureCode,
      testRunId: requestedTestRunId ?? "",
      readyForFreshIdentityAttestation: false,
      finalSubmitClickCount: 0,
      mousePressedCount: 0,
      mouseReleasedCount: 0,
      publicationTransactionCount: 0,
      ...overrides
    });
    if (!requestedTestRunId?.trim()) return blocked("TASK10S_TEST_RUN_ID_REQUIRED");
    const effectiveTestRunId = requestedTestRunId;
    const resolved = resolveTask10sExecutionTarget(this.options.repository, effectiveTestRunId);
    if (resolved.status !== "PASS") return blocked(resolved.failureCode);
    const target = resolved.target;
    const accountId = target.accountId;
    if (this.controlledOperations.has(accountId)) return blocked("TASK10S_PREPARED_EDITOR_RECOVERY_ALREADY_RUNNING");
    this.controlledOperations.add(accountId);
    try {
      const repository = this.options.repository;
      const account = repository.getAccountById(accountId, "xiaohongshu");
      if (!account || !account.enabled || account.archivedAt) return blocked("RECOVERY_ACCOUNT_UNAVAILABLE", { accountId: account?.id ?? null });
      const run = repository.getPlatformSelfTestRun(target.testRunId);
      if (!run || run.platformKey !== "xiaohongshu" || run.testRunId !== target.testRunId) return blocked("RECOVERY_RUN_UNAVAILABLE", { accountId: account.id });
      const platformAccountId = account.platformAccountId ?? account.id;
      const job = repository.getJob(target.publishJobId);
      const preparedRecord = repository.getPublishRecordByJob(target.publishJobId);
      const article = job ? repository.getArticle(job.articleId) : null;
      const authorization = repository.getOneShotPublicationAuthorization(target.testRunId);
      const countRows = (sql: string, ...args: unknown[]): number => Number((repository.db.prepare(sql).get(...args) as { count?: number } | undefined)?.count ?? 0);
      const publishJobCountForRun = run.publishJobId ? countRows("SELECT COUNT(*) AS count FROM publish_jobs WHERE id=?", run.publishJobId) : 0;
      const preparedRecordCountForJob = job ? countRows("SELECT COUNT(*) AS count FROM publish_records WHERE job_id=? AND status='Prepared'", job.id) : 0;
      if (!run.publishJobId) return blocked("RECOVERY_RUN_PUBLISH_JOB_MISSING", { accountId: account.id });
      if (!job) return blocked("RECOVERY_JOB_MISSING", { accountId: account.id });
      if (!["Pending", "Scheduled", "Retry", "NeedsUserAction"].includes(job.status)) return blocked("RECOVERY_JOB_STATUS_NOT_ELIGIBLE", { accountId: account.id, jobId: job.id, jobStatus: job.status });
      if (!preparedRecord) return blocked("RECOVERY_PREPARED_RECORD_MISSING", { accountId: account.id, jobId: job.id });
      if (preparedRecord.status !== "Prepared") return blocked("RECOVERY_RECORD_NOT_PREPARED", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id });
      if (!article) return blocked("RECOVERY_ARTICLE_MISSING", { accountId: account.id, jobId: job.id });
      if (!authorization) return blocked("RECOVERY_AUTHORIZATION_NOT_UNUSED", { accountId: account.id, jobId: job.id });
      const binding = this.requireOneShotContentBinding(run);
      const snapshot = repository.contentSnapshots.assertCurrent(job.id);
      if (binding.contentBindingId !== snapshot.id || authorization.contentBindingId !== snapshot.id || preparedRecord.contentBindingId !== snapshot.id || run.publishRecordId !== preparedRecord.id || run.testArticleId !== article.id) throw new Error("CONTENT_RECOVERY_RELATION_MISMATCH");
      const content = repository.contentSnapshots.input(snapshot, article.id);
      const jobImageAsset = job.selectedImageAssetId ? repository.getImageAsset(job.selectedImageAssetId) : null;
      if (!jobImageAsset || !content.boundImages?.[0]) throw new Error("CONTENT_IMAGE_SELECTION_CHANGED");
      const adapter = this.options.registry.getForContent("xiaohongshu", "article");
      if (!isAutomationAdapter(adapter) || typeof adapter.recoverPreparedEditor !== "function" || typeof adapter.getBrowserRuntimeSnapshot !== "function") return blocked("RECOVERY_ADAPTER_UNAVAILABLE", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id });
      if (!adapter.supportsBoundImageBuffers || adapter.getCapabilities().maxImageCount < 1) throw new Error("CONTENT_BOUND_IMAGE_UPLOAD_NOT_SUPPORTED");
      const context = this.context(account, run, "VISIBLE");
      const runtime = adapter.getBrowserRuntimeSnapshot(context);
      if (runtime.platformKey !== account.platformKey || runtime.accountId !== account.id) return blocked("RECOVERY_RUNTIME_ACCOUNT_MISMATCH", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id });
      if (!runtime.sessionExists || runtime.browserConnected !== true || !runtime.contextExists || !runtime.canonicalPageExists || runtime.canonicalPageClosed === true || runtime.runtimeAuthState !== "AUTHENTICATED") {
        return blocked("RECOVERY_RUNTIME_UNAVAILABLE", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id });
      }
      const identity = await this.xhsIdentity.verifyCreatorIdentity(account.id);
      const expectedCreatorId = this.expectedCreatorId(account);
      const identityPass = Boolean(expectedCreatorId) && identity.verified && identity.observed.externalCreatorId === expectedCreatorId && identity.expectedExternalCreatorId === expectedCreatorId;
      if (!identityPass) return blocked("RECOVERY_IDENTITY_MISMATCH", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id });
      const trustedState = validatePreparedEditorRecoveryTrustedState({
        expectedPlatformKey: "xiaohongshu",
        expectedAccountId: account.id,
        expectedPlatformAccountId: platformAccountId,
        expectedRunId: run.testRunId,
        expectedCreatorId: expectedCreatorId as string,
        account: { id: account.id, platformKey: account.platformKey, platformAccountId, externalAccountId: account.externalAccountId, enabled: account.enabled, archivedAt: account.archivedAt },
        run: { testRunId: run.testRunId, platformKey: run.platformKey, platformAccountId: run.platformAccountId, publishJobId: run.publishJobId },
        job: { id: job.id, accountId: job.accountId, platformAccountId: job.platformAccountId, platformKey: job.platformKey, articleId: job.articleId },
        preparedRecord: { id: preparedRecord.id, jobId: preparedRecord.jobId, accountId: preparedRecord.accountId, platformAccountId: preparedRecord.platformAccountId ?? platformAccountId, platformKey: preparedRecord.platformKey, articleId: preparedRecord.articleId, status: preparedRecord.status },
        article: { id: article.id, title: article.title, body: article.body },
        authorization: { state: authorization.state, platformKey: authorization.platformKey, accountId: authorization.accountId, operationId: authorization.operationId, mode: authorization.mode, publicationTransactionCount: authorization.publicationTransactionCount, finalSubmitAttemptCount: authorization.finalSubmitAttemptCount, finalSubmitRetryCount: authorization.finalSubmitRetryCount, finalSubmitActionStarted: authorization.finalSubmitActionStarted, finalSubmitActionCompleted: authorization.finalSubmitActionCompleted },
        publishJobCountForRun,
        preparedRecordCountForJob,
        identityVerified: identityPass,
        actualCreatorId: identity.observed.externalCreatorId
      });
      if (trustedState.status !== "PASS") return blocked(trustedState.failureCode ?? "RECOVERY_TRUSTED_STATE_INVALID", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id });
      const pagesBefore = await this.xhsIdentity.inspectXhsContextPages(account.id);
      const existingEditorCount = pagesBefore.inventoryStatus === "PASS" ? pagesBefore.pages.filter((page) => !page.isClosed && page.urlOrigin === "https://creator.xiaohongshu.com" && page.pathname === "/publish/publish").length : -1;
      if (existingEditorCount < 0) return blocked("RECOVERY_CONTEXT_PAGE_INVENTORY_UNAVAILABLE", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id });
      if (existingEditorCount > 0) return blocked("EDITOR_ALREADY_EXISTS", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id });
      const beforeCounts = repository.getPublishDomainCounts();
      const beforeAuthCount = countRows("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations WHERE operation_id=?", run.testRunId);
      const beforeArticle = { id: article.id, title: article.title, body: article.body, contentHash: article.contentHash };
      const operationId = randomUUID();
      this.options.logger?.info("PLATFORM_SELF_TEST", "TASK10S_PREPARED_EDITOR_RECOVERY_STARTED", "开始恢复已有 Prepared Job 对应的小红书编辑器；不会创建发布域记录或执行发布", { action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, accountId: account.id, testRunId: run.testRunId, jobId: job.id, articleId: article.id, operationId });
      const exploration = await adapter.recoverPreparedEditor(context, { imagePath: content.images![0]!, imageSource: "SAFE_TEST_FIXTURE", title: content.title, body: content.body, boundImages: content.boundImages, operationId });
      repository.contentSnapshots.assertCurrent(job.id);
      const contentCheck = verifyOneShotContentBinding(binding, { platformKey: "xiaohongshu", accountId: account.id, creatorId: snapshot.creatorId!, title: stringValue(exploration.evidence.titleReadbackValue) ?? "", body: stringValue(exploration.evidence.bodyReadbackValue) ?? "", imageAssetId: jobImageAsset.id, imageSha256: stringValue(exploration.evidence.uploadedImageSha256) });
      if (contentCheck.status === "FAIL") throw new Error("RECOVERY_CONTENT_READBACK_MISMATCH");
      const postUpload = await this.xhsIdentity.inspectCurrentXiaohongshuPostUploadReconciliation(account.id);
      const closedShadow = await this.xhsIdentity.inspectCurrentXiaohongshuClosedShadowFinalSubmit(account.id);
      const pagesAfter = await this.xhsIdentity.inspectXhsContextPages(account.id);
      const afterCounts = repository.getPublishDomainCounts();
      const afterAuthCount = countRows("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations WHERE operation_id=?", run.testRunId);
      const afterArticle = repository.getArticle(article.id);
      const genericResolverAllowed = exploration.status === "PASS_READY_FOR_FINAL_SUBMIT" || exploration.failureCode === "FINAL_SUBMIT_CONTROL_NOT_FOUND";
      const editorRecreated = pagesAfter.inventoryStatus === "PASS" && pagesAfter.pages.some((page) => !page.isClosed && page.urlOrigin === "https://creator.xiaohongshu.com" && page.pathname === "/publish/publish");
      const evidence: PreparedEditorRecoveryEvidence = {
        editorRecreated,
        recoveryUsesJobBoundImageAsset: snapshot.images[0]?.assetId === jobImageAsset.id && job.selectedImageAssetId === jobImageAsset.id,
        fixtureVerified: true,
        uploadAttempts: exploration.uploadAttempts,
        uploadMutationCount: exploration.uploadMutationCount,
        uploadRetryCount: exploration.uploadRetryCount,
        setInputFilesCount: exploration.uploadMutationCount,
        postUploadState: postUpload.postUploadState,
        imageAssetRenderedCount: postUpload.imageAssetRenderedCount,
        imageCounterValid: postUpload.imageCounterTextSafe === "1/18",
        imageCounterText: postUpload.imageCounterTextSafe,
        titleControlPresent: postUpload.titleControlPresent,
        bodyControlPresent: postUpload.bodyControlPresent,
        uploadErrorSignalPresent: !postUpload.noExplicitUploadError,
        busySignalPresent: postUpload.processingSignalPresent,
        trustedArticleTitle: article.title,
        trustedArticleBody: article.body,
        titleReadback: exploration.titleReadbackVerified ? article.title : null,
        bodyReadback: exploration.bodyReadbackVerified ? article.body : null,
        closedShadowFinalSubmitSurface: closedShadow.closedShadowFinalSubmitSurface,
        finalSubmitClickCount: exploration.finalSubmitCount,
        mousePressedCount: 0,
        mouseReleasedCount: 0,
        publicationTransactionCount: 0,
        runPublishJobIdUnchanged: repository.getPlatformSelfTestRun(run.testRunId)?.publishJobId === run.publishJobId,
        publishJobCountForRun: countRows("SELECT COUNT(*) AS count FROM publish_jobs WHERE id=?", run.publishJobId),
        preparedRecordCountForJob: countRows("SELECT COUNT(*) AS count FROM publish_records WHERE job_id=? AND status='Prepared'", job.id),
        authorizationState: repository.getOneShotPublicationAuthorization(run.testRunId)?.state ?? "NOT_VERIFIED",
        newJobCount: afterCounts.publishJobs - beforeCounts.publishJobs,
        newRecordCount: afterCounts.publishRecords - beforeCounts.publishRecords,
        newAuthorizationCount: afterAuthCount - beforeAuthCount,
        articleMutationCount: afterArticle && afterArticle.id === beforeArticle.id && afterArticle.title === beforeArticle.title && afterArticle.body === beforeArticle.body && afterArticle.contentHash === beforeArticle.contentHash ? 0 : 1,
        currentPageId: postUpload.pageId
      };
      const evaluated = genericResolverAllowed && !exploration.forbiddenMutationObserved ? evaluatePreparedEditorRecoveryEvidence(evidence) : { status: "BLOCKED" as const, failureCode: exploration.failureCode ?? "RECOVERY_EXPLORATION_BLOCKED" };
      if (evaluated.status !== "PASS") return blocked(evaluated.failureCode ?? "RECOVERY_EVIDENCE_INCOMPLETE", { accountId: account.id, jobId: job.id, publishRecordId: preparedRecord.id, articleId: article.id, operationId, evidence, exploration: exploration as unknown as Record<string, unknown> });
      const result: Task10sPreparedEditorRecoveryResult = {
        action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY,
        status: "PASS",
        failureCode: null,
        testRunId: run.testRunId,
        accountId: account.id,
        jobId: job.id,
        publishRecordId: preparedRecord.id,
        articleId: article.id,
        operationId,
        readyForFreshIdentityAttestation: true,
        evidence,
        exploration: exploration as unknown as Record<string, unknown>,
        finalSubmitClickCount: 0,
        mousePressedCount: 0,
        mouseReleasedCount: 0,
        publicationTransactionCount: 0
      };
      this.options.logger?.info("PLATFORM_SELF_TEST", "TASK10S_PREPARED_EDITOR_RECOVERY_STOPPED", "Prepared Job 编辑器恢复完成并停止；未执行 ARM、completion 或发布", { ...result, runtimeContextId: runtime.contextDebugId, runtimePageId: runtime.canonicalPageDebugId, genericResolverAllowed });
      return result;
    } catch (error) {
      return blocked(error instanceof Error ? error.message : "RECOVERY_FAILED", { accountId });
    } finally {
      this.controlledOperations.delete(accountId);
    }
  }

  async prepareOneShotPrepublish(testRunId: string): Promise<Task10SPrepublishResult> {
    const run = this.mustOneShotRun(testRunId);
    const account = this.account(run);
    const binding = this.requireOneShotContentBinding(run);
    const authorization = this.options.repository.getOneShotPublicationAuthorization(testRunId);
    if (!authorization || authorization.contentBindingId !== binding.contentBindingId || authorization.state !== "AUTHORIZED_UNUSED" || authorization.platformKey !== "xiaohongshu" || authorization.accountId !== account.id || authorization.mode !== ONE_SHOT_REAL_PUBLISH_ACCEPTANCE || authorization.publicationTransactionCount !== 0 || authorization.finalSubmitAttemptCount !== 0 || authorization.finalSubmitRetryCount !== 0 || authorization.finalSubmitActionStarted || authorization.finalSubmitActionCompleted) {
      throw new Error("ONE_SHOT_PREPUBLISH_AUTHORIZATION_NOT_AVAILABLE");
    }
    const adapter = this.options.registry.getForContent("xiaohongshu", "article");
    if (!isAutomationAdapter(adapter)) throw new Error("当前小红书 Adapter 未提供安全预发布准备能力");
    if (this.controlledOperations.has(account.id)) throw new Error("XHS_ONE_SHOT_OPERATION_ALREADY_RUNNING");
    const before = this.task10sDatabaseSnapshot();
    const fixture = this.options.repository.getImageAsset(binding.imageAssetId);
    if (!fixture || !fixture.enabled || !existsSync(fixture.filePath)) throw new Error("ONE_SHOT_CONTENT_IMAGE_BINDING_INVALID");
    const content = this.options.repository.contentSnapshots.input(this.options.repository.contentSnapshots.get(binding.contentBindingId), `task10s-${run.testRunId}`);
    const context = this.context(account, run, "VISIBLE");
    const runtimeBefore = adapter.getBrowserRuntimeSnapshot?.(context) ?? null;
    if (!runtimeBefore?.sessionExists || runtimeBefore.browserConnected !== true || !runtimeBefore.contextExists || !runtimeBefore.canonicalPageExists || runtimeBefore.canonicalPageClosed === true) throw new Error("XHS_CANONICAL_RUNTIME_UNAVAILABLE");
    if (!account.externalAccountId || !account.lastVerifiedAt) throw new Error("ACCOUNT_IDENTITY_UNVERIFIED");
    const identityVerification = await this.xhsIdentity.verifyCreatorIdentity(account.id);
    if (!identityVerification.verified || identityVerification.expectedExternalCreatorId !== account.externalAccountId || identityVerification.observed.externalCreatorId !== account.externalAccountId || identityVerification.canonicalContextId !== runtimeBefore.contextDebugId || identityVerification.canonicalPageId !== runtimeBefore.canonicalPageDebugId) {
      throw Object.assign(new Error("ACCOUNT_IDENTITY_UNVERIFIED: current runtime identity proof did not match the existing canonical account runtime"), { code: "ACCOUNT_IDENTITY_UNVERIFIED" });
    }
    const runtimeIdentityProof: CurrentRuntimeIdentityProof = {
      accountId: account.id,
      platformKey: "xiaohongshu",
      expectedExternalCreatorId: account.externalAccountId,
      observedExternalCreatorId: identityVerification.observed.externalCreatorId,
      canonicalContextId: identityVerification.canonicalContextId,
      canonicalPageId: identityVerification.canonicalPageId,
      verified: true
    };
    const preparedContext: AccountContext = { ...context, runtimeIdentityProof };
    this.controlledOperations.add(account.id);
    try {
      const preparedContent = await this.runEditorAndContent(run, account, adapter, "VISIBLE", content, preparedContext);
      const preparedRun = this.options.repository.getPlatformSelfTestRun(run.testRunId) as PlatformSelfTestRun;
      const preparedResponse = preparedContent.prepared?.response ?? null;
      const imageStep = preparedRun.steps.find((item) => item.stepKey === "IMAGE_FILL");
      const editorStep = preparedRun.steps.find((item) => item.stepKey === "EDITOR_OPEN");
      const titleStep = preparedRun.steps.find((item) => item.stepKey === "TITLE_FILL");
      const bodyStep = preparedRun.steps.find((item) => item.stepKey === "BODY_FILL");
      const imageSummary = imageUploadEvidenceSummary(preparedResponse?.imageUploadEvidence);
      const requiredFields = requiredFieldValues(preparedResponse?.requiredFields);
      const requiredMissing = requiredFields.filter((field) => field.empty).map((field) => field.label || "UNNAMED_REQUIRED_FIELD");
      const settings = publishSettingValues(preparedResponse?.publishSettings);
      const finalControl = recordValue(preparedResponse?.finalSubmitControl);
      const runtimeAfter = adapter.getBrowserRuntimeSnapshot?.(context) ?? null;
      const contextCorrelation = runtimeBefore.contextDebugId && runtimeAfter?.contextDebugId ? runtimeBefore.contextDebugId === runtimeAfter.contextDebugId ? "PASS" as const : "NOT_OBSERVED" as const : "NOT_OBSERVED" as const;
      const pageCorrelation = runtimeBefore.canonicalPageDebugId && runtimeAfter?.canonicalPageDebugId ? runtimeBefore.canonicalPageDebugId === runtimeAfter.canonicalPageDebugId ? "PASS" as const : "NOT_OBSERVED" as const : "NOT_OBSERVED" as const;
      const editorPageUrl = preparedContent.prepared?.backendUrl ?? stringValue(preparedResponse?.pageUrl);
      const editorPassed = editorStep?.result === "PASSED" && contextCorrelation === "PASS" && pageCorrelation === "PASS";
      const titleObserved = stringValue(preparedResponse?.titleReadbackValue);
      const bodyObserved = stringValue(preparedResponse?.bodyReadbackValue);
      const titleCheck = verifyOneShotContentBinding(binding, { platformKey: "xiaohongshu", accountId: account.id, creatorId: account.externalAccountId ?? binding.creatorId, title: titleObserved ?? "", body: binding.bodyCanonical, imageAssetId: preparedContent.imageAssetId ?? binding.imageAssetId, imageSha256: stringValue(preparedContent.prepared?.response?.uploadedImageSha256) });
      const bodyCheck = verifyOneShotContentBinding(binding, { platformKey: "xiaohongshu", accountId: account.id, creatorId: account.externalAccountId ?? binding.creatorId, title: binding.titleCanonical, body: bodyObserved ?? "", imageAssetId: preparedContent.imageAssetId ?? binding.imageAssetId, imageSha256: stringValue(preparedContent.prepared?.response?.uploadedImageSha256) });
      const titlePassed = titleStep?.result === "PASSED" && preparedContent.prepared?.titleFilled === true && titleCheck.status !== "FAIL";
      const bodyPassed = bodyStep?.result === "PASSED" && preparedContent.prepared?.bodyFilled === true && bodyCheck.status !== "FAIL";
      const imagePassed = imageStep?.result === "PASSED" && preparedContent.imageAssetId !== null && imageSummary.verified;
      const requiredPassed = preparedResponse?.requiredFieldsStatus === "KNOWN" && requiredMissing.length === 0;
      const settingsPassed = preparedResponse?.publishSettingsStatus === "KNOWN" && Array.isArray(preparedResponse?.publishSettings);
      const finalSubmitFound = finalControl?.verified === true && finalControl.unique === true;
      const finalSubmitEnabled = finalControl?.enabled === true;
      const finalSubmitVisible = finalControl?.visible === true;
      const finalSubmitClickCount = numberValue(preparedResponse?.finalSubmitClickCount);
      const finalSubmitPassed = finalSubmitFound && finalSubmitEnabled && finalSubmitVisible && finalSubmitClickCount === 0;
      const missing: string[] = [];
      if (!editorPassed) missing.push("EDITOR_OPEN");
      if (!titlePassed) missing.push("TITLE_FILL_READBACK");
      if (!bodyPassed) missing.push("BODY_FILL_READBACK");
      if (!imagePassed) missing.push("IMAGE_FILL_DOM_READBACK");
      if (!requiredPassed) missing.push("REQUIRED_FIELDS");
      if (!settingsPassed) missing.push("PUBLISH_SETTINGS_READ_ONLY");
      if (!finalSubmitPassed) missing.push("FINAL_SUBMIT_CONTROL_READ_ONLY");
      const ready = missing.length === 0 && preparedContent.prepared !== null && preparedContent.prepared.prepared === true;
      const evidenceMutationCount = 1;
      this.step(run, "L5_PUBLISH", "PREPUBLISH_EVIDENCE", ready ? "PASSED" : "FAILED", ready ? null : "ONE_SHOT_PREPUBLISH_EVIDENCE_INCOMPLETE", ready ? "Task10S safe prepublish evidence 已完成；最终发布控件只读发现完成，未点击。" : `Task10S safe prepublish evidence 不完整：${missing.join(",")}`, `prepublish_ready:${String(ready)}:final_submit_count:${String(finalSubmitClickCount ?? "UNKNOWN")}`);
      if (ready) {
        this.step(run, "L5_PUBLISH", "PREPUBLISH_READY", "PASSED", null, "Task10S 已准备完成；等待 Owner 后续最终提交确认，当前未执行发布。", `authorization_state:${authorization.state}:final_submit_count:${String(finalSubmitClickCount)}`);
        this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "WAITING_FOR_USER", "FINAL_SUBMIT_OWNER_ACTION_REQUIRED", "预发布证据已完成；最终发布按钮只读发现完成，未执行最终提交。", `authorization_state:${authorization.state}:final_submit_count:${String(finalSubmitClickCount)}`);
      }
      const after = this.task10sDatabaseSnapshot();
      const requiredPass = [editorPassed, titlePassed, bodyPassed, imagePassed, requiredPassed, settingsPassed, finalSubmitPassed];
      const result: Task10SPrepublishResult = {
        testRunId: run.testRunId,
        operationId: authorization.operationId,
        platformKey: "xiaohongshu",
        accountId: account.id,
        status: ready ? "READY_FOR_FINAL_SUBMIT" : "BLOCKED",
        authorizationState: "AUTHORIZED_UNUSED",
        canonicalAuthorizationId: authorization.operationId,
        accountIdentityVerified: identityVerification.verified,
        creatorId: account.externalAccountId ?? null,
        editor: {
          attemptCount: 1,
          result: editorPassed ? "PASSED" : "BLOCKED",
          pageUrl: editorPageUrl,
          routeClass: editorPageUrl?.includes("/publish/") ? "PUBLISH_EDITOR" : "UNKNOWN",
          contextId: runtimeAfter?.contextDebugId ?? null,
          pageId: runtimeAfter?.canonicalPageDebugId ?? null,
          contextCorrelation,
          pageCorrelation
        },
        safeFixture: { path: fixture.filePath, sha256: this.fileSha256(fixture.filePath), exists: existsSync(fixture.filePath), assetId: fixture.id },
        image: { attemptCount: imageSummary.verified ? 1 : 0, result: imagePassed ? "PASSED" : imageStep?.result ?? "NOT_TESTED", assetId: preparedContent.imageAssetId, domReadback: imageSummary.signal || null, previewCount: imageSummary.previewCount, error: imagePassed ? null : imageStep?.errorCode ?? "IMAGE_UPLOAD_NOT_VERIFIED" },
        title: { attemptCount: titlePassed ? 1 : 0, expected: binding.titleCanonical, observed: titleObserved, readbackMatch: titlePassed },
        body: { attemptCount: bodyPassed ? 1 : 0, expected: binding.bodyCanonical, observed: bodyObserved, readbackMatch: bodyPassed },
        requiredFields: { total: requiredFields.length, pass: requiredFields.length - requiredMissing.length, missing: requiredMissing, result: requiredPassed ? "PASS" : preparedResponse ? "BLOCKED" : "NOT_OBSERVED" },
        settings: { readOnlyCheck: settingsPassed ? "PASS" : preparedResponse ? "BLOCKED" : "NOT_OBSERVED", mutationCount: 0, values: settings },
        finalSubmit: { found: finalSubmitFound, enabled: finalSubmitEnabled, text: stringValue(finalControl?.label), count: finalSubmitFound ? 1 : 0, clickCount: finalSubmitClickCount },
        preparedContent: { prepared: preparedContent.prepared?.prepared === true, imageAssetId: preparedContent.imageAssetId, response: preparedResponse },
        prepublishEvidence: { total: requiredPass.length, pass: requiredPass.filter(Boolean).length, missing },
        readyToResumeExistingOneShot: ready,
        database: { before, after },
        safety: { authorizationMutationCount: 0, prepublishEvidenceMutationCount: evidenceMutationCount, jobMutationCount: 0, intentMutationCount: 0, publishRecordMutationCount: 0, uploadMutationCount: imageSummary.verified ? 1 : 0, titleMutationCount: titlePassed ? 1 : 0, bodyMutationCount: bodyPassed ? 1 : 0, settingsMutationCount: 0, publicationTransactionCount: 0, finalSubmitCount: finalSubmitClickCount },
        evidencePath: null,
        run: preparedRun
      };
      const finalRun = this.options.repository.finishPlatformSelfTestRun(run.testRunId, ready ? "WAITING_FOR_USER" : "FAILED");
      const evidencePath = this.writeTask10sEvidence(result, finalRun);
      return { ...result, evidencePath, run: finalRun };
    } finally {
      this.controlledOperations.delete(account.id);
    }
  }

  requestOneShotPublish(platformAccountId: string, payload: OneShotContentPayload): PlatformSelfTestRun {
    const account = this.options.repository.listAccounts().find((item) => (item.id === platformAccountId || (item.platformAccountId ?? item.id) === platformAccountId) && item.platformKey === "xiaohongshu");
    if (!account || !account.enabled || account.archivedAt) throw new Error("小红书一次性真实发布测试账号不可用或未绑定到授权账号");
    validateOneShotContentPayload(payload);
    if (payload.accountId !== account.id || payload.creatorId !== account.externalAccountId) throw new Error("ONE_SHOT_CONTENT_ACCOUNT_IDENTITY_MISMATCH");
    const image = this.options.repository.getImageAsset(payload.imageAssetId);
    if (!image || !image.enabled || !existsSync(image.filePath)) throw new Error("ONE_SHOT_CONTENT_IMAGE_BINDING_INVALID");
    const captured = this.options.repository.contentSnapshots.capture({ purpose: "ONE_SHOT_ACCEPTANCE", platformKey: "xiaohongshu", accountId: account.id, creatorId: payload.creatorId, title: payload.title, body: payload.body, summary: "自动化发布测试", tags: ["测试"], imageIds: [image.id], expectedImageSha256: payload.imageSha256 });
    const binding = buildOneShotContentBinding({ ...payload, imageSha256: captured.snapshot.images[0]!.sha256 });
    captured.snapshot.id = binding.contentBindingId;
    return this.options.repository.db.transaction(() => {
    const convergence = this.options.repository.convergeUnusedOneShotAuthorization({ platformKey: "xiaohongshu", accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
    if (convergence.reusableOperationId) {
      const existing = this.options.repository.getPlatformSelfTestRun(convergence.reusableOperationId);
      if (!existing) throw new Error("存在未关联自测运行的一次性授权；拒绝创建第三个授权");
      // A new explicitly bound acceptance must never inherit an older operation's
      // authorization. Retire only an untouched AUTHORIZED_UNUSED operation; any
      // consumed, active, or partially submitted operation remains fail-closed.
      const superseded = this.options.repository.supersedeUnusedOneShotAuthorization({ operationId: convergence.reusableOperationId, platformKey: "xiaohongshu", accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
      if (!superseded) throw new Error("ONE_SHOT_CONTENT_BINDING_CONFLICT");
      this.options.logger?.info("PLATFORM_SELF_TEST", "ONE_SHOT_STALE_AUTHORIZATION_SUPERSEDED", "显式内容绑定不复用历史一次性授权；已安全收敛未消费授权", { platformKey: account.platformKey, accountId: account.id, operationId: convergence.reusableOperationId });
      const remaining = this.options.repository.convergeUnusedOneShotAuthorization({ platformKey: "xiaohongshu", accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
      if (remaining.reusableOperationId) throw new Error("ONE_SHOT_AUTHORIZATION_SCOPE_CONFLICT");
    }
    this.options.repository.createOneShotContentBinding(binding);
    const run = this.options.repository.createPlatformSelfTestRun({ platformAccountId: account.platformAccountId ?? account.id, requestedLevel: "L5_PUBLISH", contentBindingId: binding.contentBindingId });
    captured.snapshot.operationId = run.testRunId;
    this.options.repository.contentSnapshots.save(captured);
    this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "WAITING_FOR_USER", "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED", XHS_ONE_SHOT_CONFIRMATION, `authorization:${OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH}:state:NOT_AUTHORIZED`);
    return this.options.repository.finishPlatformSelfTestRun(run.testRunId, "WAITING_FOR_USER");
    }).immediate();
  }

  cancelOneShotPublish(testRunId: string): PlatformSelfTestRun {
    const run = this.mustOneShotRun(testRunId);
    this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "NOT_TESTED", "ONE_SHOT_PUBLISH_CANCELLED", "用户取消了一次性真实发布测试，未生成授权、未创建发布任务");
    return this.options.repository.finishPlatformSelfTestRun(testRunId, "NOT_TESTED");
  }

  reconcileFailedOneShotConfirmation(identity: FailedOneShotConfirmationIdentity): OneShotConfirmationReconciliationResult {
    return this.oneShotReconciliation.reconcileFailedOneShotConfirmation(identity);
  }

  verifyAndConvergeXhsIdentity(accountId: string, ownerApproved = false): Promise<XhsIdentityAcceptance> {
    return this.xhsIdentity.verifyAndConverge(accountId, { ownerApproved });
  }

  verifyXhsCreatorIdentity(accountId: string): Promise<CreatorIdentityVerificationResult> {
    return this.xhsIdentity.verifyCreatorIdentity(accountId);
  }

  bootstrapXhsCreatorIdentity(accountId: string): Promise<CreatorIdentityVerificationResult> {
    return this.xhsIdentity.bootstrapCreatorIdentity(accountId);
  }

  observeXhsCreatorIdentityForLogin(accountId: string): Promise<CreatorIdentityVerificationResult> {
    return this.xhsIdentity.observeCreatorIdentityForLogin(accountId);
  }

  establishXhsContextIdentityAttestation(accountId?: string) {
    return this.xhsIdentity.establishContextIdentityAttestation(this.selectedXhsAccount(accountId).id);
  }

  ensureXhsIdentityPage(accountId?: string): Promise<XhsIdentityPageEnsureServiceResult> {
    return this.xhsIdentity.ensureIdentityPage(this.selectedXhsAccount(accountId).id);
  }

  invalidateXhsContextIdentityAttestation(accountId: string): void {
    this.xhsIdentity.invalidateContextIdentityAttestation(accountId);
  }

  getXhsContextIdentityAttestation(accountId: string) {
    return this.xhsIdentity.getContextIdentityAttestation(accountId);
  }

  inspectCanonicalXhsPageRuntime(accountId: string): Promise<XiaohongshuCanonicalPageRuntimeProbe> {
    return this.xhsIdentity.inspectCanonicalPageRuntime(accountId);
  }

  inspectXhsContextPages(accountId: string): Promise<XiaohongshuContextPageInventory> {
    return this.xhsIdentity.inspectXhsContextPages(accountId);
  }

  inspectCurrentXiaohongshuImageEditorReadiness(accountId?: string): Promise<XiaohongshuCurrentImageEditorReadiness> {
    return this.xhsIdentity.inspectCurrentXiaohongshuImageEditorReadiness(this.selectedXhsAccount(accountId).id);
  }

  inspectCurrentXiaohongshuPublishEditorDom(accountId?: string): Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic> {
    return this.xhsIdentity.inspectCurrentXiaohongshuPublishEditorDom(this.selectedXhsAccount(accountId).id);
  }

  inspectCurrentXiaohongshuPublishEditorSemanticCandidates(accountId?: string): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic> {
    return this.xhsIdentity.inspectCurrentXiaohongshuPublishEditorSemanticCandidates(this.selectedXhsAccount(accountId).id);
  }

  inspectCurrentXiaohongshuGlobalExactPublishDom(accountId?: string): Promise<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic> {
    return this.xhsIdentity.inspectCurrentXiaohongshuGlobalExactPublishDom(this.selectedXhsAccount(accountId).id);
  }

  inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId?: string): Promise<XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic> {
    const selectedAccountId = this.selectedXhsAccount(accountId).id;
    return this.xhsIdentity.inspectCurrentXiaohongshuClosedShadowFinalSubmit(selectedAccountId).then((diagnostic) => {
      const fresh = this.task10sFreshEvidence;
      this.task10sClosedShadowEvidence = fresh ? {
        result: structuredClone(diagnostic), accountId: selectedAccountId, operationId: fresh.result.operationId, sessionId: fresh.sessionId,
        contextId: diagnostic.contextDebugId, pageId: diagnostic.pageId
      } : null;
      return diagnostic;
    });
  }

  inspectCurrentXiaohongshuPostUploadReconciliation(accountId?: string): Promise<XiaohongshuCurrentPostUploadReconciliation> {
    return this.xhsIdentity.inspectCurrentXiaohongshuPostUploadReconciliation(this.selectedXhsAccount(accountId).id);
  }

  inspectCurrentXiaohongshuPostUploadTerminalReadiness(accountId?: string): Promise<XiaohongshuCurrentPostUploadTerminalReadiness> {
    return this.xhsIdentity.inspectCurrentXiaohongshuPostUploadTerminalReadiness(this.selectedXhsAccount(accountId).id);
  }

  inspectCurrentXiaohongshuFileInputState(accountId?: string): Promise<XiaohongshuCurrentFileInputState> {
    return this.xhsIdentity.inspectCurrentXiaohongshuFileInputState(this.selectedXhsAccount(accountId).id);
  }

  inspectXhsPublishEntryDom(accountId: string): Promise<XiaohongshuPublishEntryDomRuntimeDiagnostic> {
    return this.xhsIdentity.inspectXhsPublishEntryDom(accountId);
  }

  confirmOneShotPublish(testRunId: string): Promise<PlatformSelfTestRun> {
    if (this.oneShotConfirmations.has(testRunId)) this.options.logger?.info("PLATFORM_SELF_TEST", "ONE_SHOT_CONFIRM_DUPLICATE_SUPPRESSED", "同一一次性确认正在处理中；复用原确认请求", { testRunId });
    return this.oneShotConfirmations.run(testRunId, () => this.confirmOneShotPublishOnce(testRunId));
  }

  private async confirmOneShotPublishOnce(testRunId: string): Promise<PlatformSelfTestRun> {
    let run = this.mustOneShotRun(testRunId);
    if (run.publishJobId) throw new Error("ONE_SHOT_PUBLICATION_ALREADY_STARTED");
    const account = this.account(run);
    const binding = this.requireOneShotContentBinding(run);
    if (account.platformKey !== "xiaohongshu" || account.id !== run.accountId) throw new Error("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
    const adapter = this.options.registry.getForContent("xiaohongshu", "article");
    if (!isAutomationAdapter(adapter) || typeof adapter.finalSubmit !== "function") throw new Error("当前小红书 Adapter 未提供一次性真实发布能力");
    let existing: ReturnType<AppRepository["getOneShotPublicationAuthorization"]>;
    try { existing = this.options.repository.getOneShotPublicationAuthorization(run.testRunId); }
    catch (error) { throw this.oneShotConfirmationSetupError(error); }
    const existingMatches = existing
      && existing.authorization === OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH
      && existing.platformKey === account.platformKey
      && existing.accountId === account.id
      && existing.operationId === run.testRunId
      && existing.mode === ONE_SHOT_REAL_PUBLISH_ACCEPTANCE;
    const resumableExisting = Boolean(existingMatches
      && existing?.state === "AUTHORIZED_UNUSED"
      && existing.publicationTransactionCount === 0
      && existing.publicationCommitActionCount === 0
      && existing.finalSubmitAttemptCount === 0
      && existing.finalSubmitRetryCount === 0
      && !existing.finalSubmitActionStarted
      && !existing.finalSubmitActionCompleted
      && hasOneShotPrepublishState(run));
    if (existing && !existingMatches) throw new Error("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
    if (existing && !resumableExisting) {
      if (!run.publishConfirmedAt) throw new Error("ONE_SHOT_AUTHORIZATION_NOT_RESUMABLE");
      this.options.logger?.info("PLATFORM_SELF_TEST", "ONE_SHOT_CONFIRM_DUPLICATE_SUPPRESSED", "已存在同一一次性确认授权；不重复启动操作", { testRunId, operationId: existing.operationId, state: existing.state });
      return this.options.repository.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
    }
    if (!existing && run.publishConfirmedAt) throw Object.assign(new Error("一次性发布确认状态不完整，尚未进入发布流程；请先完成正式取证处理。"), { code: "ONE_SHOT_CONFIRMATION_PARTIAL_STATE" });
    if (this.controlledOperations.has(account.id)) throw new Error("XHS_ONE_SHOT_OPERATION_ALREADY_RUNNING");
    const operationId = testRunId;
    const authorization = { ...createOwnerAuthorizedOneShotPublication({ operationId, platformKey: account.platformKey, accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }), contentBindingId: binding.contentBindingId };
    let persisted: ReturnType<AppRepository["confirmPlatformSelfTestOneShotAtomically"]> | null = null;
    if (!existing) {
      this.options.logger?.info("PLATFORM_SELF_TEST", "ONE_SHOT_CONFIRM_STARTED", "开始原子创建一次性发布确认与授权", { testRunId, platformKey: account.platformKey, platformAccountId: run.platformAccountId, operationId });
      try {
        persisted = this.options.repository.confirmPlatformSelfTestOneShotAtomically(testRunId, authorization);
      } catch (error) {
        this.options.logger?.warn("PLATFORM_SELF_TEST", "ONE_SHOT_CONFIRM_ROLLED_BACK", "一次性发布确认未提交；授权和确认状态已回滚", { testRunId, operationId, errorType: error instanceof Error ? error.name : "UnknownError", failureMessage: error instanceof Error ? error.message : "unknown" });
        throw this.oneShotConfirmationSetupError(error);
      }
      run = this.options.repository.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
      if (!persisted.created) {
        this.options.logger?.info("PLATFORM_SELF_TEST", "ONE_SHOT_CONFIRM_DUPLICATE_SUPPRESSED", "同一一次性确认已存在；不创建第二授权或操作", { testRunId, operationId: persisted.authorization.operationId, state: persisted.authorization.state });
        return run;
      }
      this.options.logger?.info("PLATFORM_SELF_TEST", "ONE_SHOT_CONFIRM_COMMITTED", "一次性发布确认与未消费授权已原子提交", { testRunId, platformKey: account.platformKey, platformAccountId: run.platformAccountId, operationId, state: persisted.authorization.state });
      this.step(run, "L5_PUBLISH", "PUBLISH_CONFIRMATION", "PASSED", null, XHS_ONE_SHOT_CONFIRMATION, `authorization:${authorization.authorization}:state:${authorization.state}:operation:${authorization.operationId}`);
      this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_ONE_SHOT_AUTHORIZED", "Owner 已确认一次性真实发布；授权已绑定小红书测试账号并保持未消费", { platformKey: account.platformKey, accountId: account.id, operationId, mode: authorization.mode, maxPublicationTransactions: 1, maxFinalSubmitAttempts: 1, finalSubmitRetryCount: 0 });
    } else {
      run = this.options.repository.getPlatformSelfTestRun(testRunId) as PlatformSelfTestRun;
      this.options.logger?.info("PLATFORM_SELF_TEST", "ONE_SHOT_REUSABLE_AUTHORIZATION_RESUMED", "恢复既有一次性未消费授权的预发布流程；不创建新授权", { testRunId, operationId: existing.operationId, state: existing.state });
    }
    this.controlledOperations.add(account.id);
    try {
      if (!await this.runLogin(run, account, adapter, "VISIBLE")) return this.finish(run.testRunId);
      try {
        const identity = await this.xhsIdentity.verifyAndConverge(account.id);
        if (!identity.verification.verified) throw Object.assign(new Error("小红书 Creator 身份未验证；尚未进入上传流程"), { code: "ACCOUNT_IDENTITY_UNVERIFIED" });
      } catch (error) {
        const failure = selfTestError(error);
        this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", failure.result, failure.errorCode === "UNKNOWN" ? "ACCOUNT_IDENTITY_UNVERIFIED" : failure.errorCode, "小红书 Creator 账号身份未通过正向 external ID 证明；尚未上传或创建发布任务。", `identity_verification:FAILED:${failure.message}`);
        return this.finish(run.testRunId);
      }
      const safeImage = this.options.repository.getImageAsset(binding.imageAssetId);
      if (!safeImage || !safeImage.enabled || !existsSync(safeImage.filePath)) throw new Error("ONE_SHOT_CONTENT_IMAGE_BINDING_INVALID");
      const content = this.options.repository.contentSnapshots.input(this.options.repository.contentSnapshots.get(binding.contentBindingId), `task10s-${run.testRunId}`);
      const preparedContent = await this.runEditorAndContent(run, account, adapter, "VISIBLE", content);
      const preparedRun = this.options.repository.getPlatformSelfTestRun(run.testRunId) as PlatformSelfTestRun;
      const imageStep = preparedRun.steps.find((item) => item.stepKey === "IMAGE_FILL");
      if (!preparedContent.prepared || preparedContent.imageAssetId === null || imageStep?.result !== "PASSED") {
        this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "FAILED", "ONE_SHOT_PREPUBLISH_EVIDENCE_INCOMPLETE", "一次性真实发布要求 safe fixture 图片、编辑器、标题和正文都取得实际回读证据；未创建发布任务", "authorization_state:AUTHORIZED_UNUSED");
        return this.finish(run.testRunId);
      }
      const contentCheck = verifyOneShotContentBinding(binding, { platformKey: "xiaohongshu", accountId: account.id, creatorId: account.externalAccountId ?? binding.creatorId, title: stringValue(preparedContent.prepared.response?.titleReadbackValue) ?? "", body: stringValue(preparedContent.prepared.response?.bodyReadbackValue) ?? "", imageAssetId: preparedContent.imageAssetId, imageSha256: stringValue(preparedContent.prepared?.response?.uploadedImageSha256) });
      if (contentCheck.status === "FAIL") {
        this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "FAILED", "AUTHORIZATION_INVALID_FOR_CONTENT", "一次性内容绑定与编辑器回读不一致；未创建发布任务", `content_binding:${binding.contentBindingId}:reasons:${contentCheck.reasons.join(",")}`);
        return this.finish(run.testRunId);
      }
      const preparedResponse = {
        ...preparedContent.prepared.response,
        OWNER_FINAL_SUBMIT_AUTHORIZATION: authorization.authorization,
        FINAL_SUBMIT_AUTHORIZATION_STATE: authorization.state,
        FINAL_SUBMIT_PREFLIGHT: "PENDING",
        PUBLICATION_TRANSACTION_COUNT: authorization.publicationTransactionCount,
        PUBLICATION_COMMIT_ACTION_COUNT: authorization.publicationCommitActionCount,
        FINAL_SUBMIT_ATTEMPT_COUNT: authorization.finalSubmitAttemptCount,
        FINAL_SUBMIT_RETRY_COUNT: authorization.finalSubmitRetryCount,
        FINAL_SUBMIT_ACTION_STARTED: authorization.finalSubmitActionStarted,
        FINAL_SUBMIT_ACTION_COMPLETED: authorization.finalSubmitActionCompleted,
        POST_SUBMIT_OBSERVATION: "PENDING",
        PUBLICATION_RECONCILED: false,
        EXTERNAL_ID: null,
        EXTERNAL_URL: null,
        PUBLIC_PAGE_VERIFIED: false,
        imageSource: "SAFE_TEST_FIXTURE"
      };
      this.options.repository.contentSnapshots.assertAssets(this.options.repository.contentSnapshots.get(binding.contentBindingId));
      const verifiedPrepared = preparedContent.prepared;
      const job = this.options.repository.db.transaction(() => {
      const job = this.options.repository.createPlatformSelfTestPublishJob({ testRunId: run.testRunId, title: content.title, body: content.body, dryRun: false, selectedImageAssetId: preparedContent.imageAssetId, contentBindingId: binding.contentBindingId });
      this.options.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: account.platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: null, success: false, response: { ...preparedResponse, contentBindingId: binding.contentBindingId }, contentBindingId: binding.contentBindingId, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: adapter.automationType, browserSessionIdHash: verifiedPrepared.sessionIdHash ?? account.browserSessionId, operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: verifiedPrepared.editorOpenedAt ?? null, titleFilled: true, bodyFilled: true, selectedImageAssetId: preparedContent.imageAssetId, imageSelectionMode: "manual" });
      this.options.repository.confirmJob(job.id, false);
      return job;
      }).immediate();
      const execution = await this.options.publisher.executeJob(job.id, { userActionId: operationId, triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization);
      const completedJob = this.options.repository.getJob(job.id);
      const record = this.options.repository.getPublishRecordByJob(job.id);
      const currentAuthorization = this.options.repository.getOneShotPublicationAuthorization(operationId);
      const finalSubmitCount = currentAuthorization?.finalSubmitAttemptCount ?? 0;
      if (!record || !completedJob || !["Success", "Publishing", "Published"].includes(completedJob.status)) {
        const waiting = completedJob?.status === "NeedsUserAction" || completedJob?.status === "NeedsReconciliation" || /reconciliation|user|确认|官方页面/iu.test(execution.message);
        this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", waiting ? "WAITING_FOR_USER" : "FAILED", completedJob?.lastErrorCode ?? (waiting ? "NEEDS_RECONCILIATION" : "UNKNOWN"), execution.message, `authorization_state:${currentAuthorization?.state ?? "UNKNOWN"}:final_submit_count:${String(finalSubmitCount)}`);
        return this.finish(run.testRunId);
      }
      run = this.options.repository.linkPlatformSelfTestPublishEvidence(run.testRunId, record.id);
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", "PASSED", null, "一次性真实发布提交已通过统一 guard；未执行第二次提交", `authorization_state:${currentAuthorization?.state ?? "UNKNOWN"}:final_submit_count:${String(finalSubmitCount)}`, record.publishedExternalId, record.publishedUrl);
      this.step(run, "L5_PUBLISH", "EXTERNAL_EVIDENCE", record.publishedExternalId && record.publishedUrl ? "PASSED" : "PARTIAL_PASSED", record.publishedExternalId && record.publishedUrl ? null : "EXTERNAL_EVIDENCE_INCOMPLETE", record.publishedExternalId && record.publishedUrl ? "已保存 External ID 与 URL" : "提交完成但外部证据不完整；不得重试提交", `final_submit_count:${String(finalSubmitCount)}`, record.publishedExternalId, record.publishedUrl);
      if (record.publishedExternalId && record.publishedUrl) await this.reconcile(run, account, adapter, record.publishedExternalId);
      return this.finish(run.testRunId);
    } catch (error) {
      const failure = selfTestError(error);
      const currentAuthorization = this.options.repository.getOneShotPublicationAuthorization(operationId);
      this.step(run, "L5_PUBLISH", "PUBLISH_SUBMIT", failure.result, failure.errorCode, failure.message, `authorization_state:${currentAuthorization?.state ?? "UNKNOWN"}:final_submit_count:${String(currentAuthorization?.finalSubmitAttemptCount ?? 0)}`);
      return this.finish(run.testRunId);
    } finally {
      this.controlledOperations.delete(account.id);
    }
  }

  private oneShotConfirmationSetupError(error: unknown): Error {
    return Object.assign(new Error("一次性发布授权创建失败，尚未进入发布流程。"), { code: "ONE_SHOT_CONFIRMATION_SETUP_FAILED", cause: error });
  }

  async continue(testRunId: string): Promise<PlatformSelfTestRun> {
    const run = this.options.repository.getPlatformSelfTestRun(testRunId);
    if (!run || run.overallResult !== "WAITING_FOR_USER") throw new Error("只有等待用户处理的自测才能继续");
    if (run.platformKey === "xiaohongshu" && run.steps.some((item) => item.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED")) {
      if (run.publishJobId) throw new Error("ONE_SHOT_RECONCILIATION_REQUIRED");
      return this.confirmOneShotPublish(testRunId);
    }
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

  private async runEditorAndContent(run: PlatformSelfTestRun, account: Account, adapter: PlatformAdapter, executionMode: BrowserSelfTestMode, contentOverride?: PublishArticleInput, contextOverride?: AccountContext): Promise<PreparedEditorRun> {
    const startedAt = new Date().toISOString();
    if (!isAutomationAdapter(adapter)) {
      this.step(run, "L2_EDITOR", "EDITOR_OPEN", "NOT_SUPPORTED", "API_NO_BROWSER_EDITOR", "官方 API / OAuth 平台没有需要打开的浏览器编辑器", "adapter_transport_api", null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "TITLE_FILL", "NOT_SUPPORTED", "API_PAYLOAD_ONLY", "API 平台不会在浏览器编辑器中填写标题", null, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "BODY_FILL", "NOT_SUPPORTED", "API_PAYLOAD_ONLY", "API 平台不会在浏览器编辑器中填写正文", null, null, null, startedAt);
      this.step(run, "L3_CONTENT_FILL", "IMAGE_FILL", "NOT_SUPPORTED", "API_PAYLOAD_ONLY", "图片能力需在 L4/L5 的真实草稿或发布响应中验证", null, null, null, startedAt);
      return { input: contentOverride ?? transparentSelfTestContent(run.platformKey, this.options.repository.listPlatforms().find((item) => item.platformKey === run.platformKey)?.displayName ?? run.platformKey), imageAssetId: null, prepared: null };
    }
    const platform = this.options.repository.listPlatforms().find((item) => item.platformKey === run.platformKey);
    const content = contentOverride ?? transparentSelfTestContent(run.platformKey, platform?.displayName ?? run.platformKey);
    // V1.1.8 Lieju acceptance starts without an image. The live adapter must
    // prove whether the platform actually requires one before submitting.
    const suppliedImagePath = content.images?.[0]?.trim() || null;
    const image = run.requestedLevel === "L5_PUBLISH" && run.platformKey === "lieju"
      ? null
      : suppliedImagePath
        ? this.options.repository.listImageAssets(undefined, true).find((item) => item.filePath === suppliedImagePath) ?? null
        : this.findTestImage();
    const input: PublishArticleInput = suppliedImagePath
      ? content
      : { ...content, ...(image && adapter.getCapabilities().maxImageCount > 0 ? { images: [image.filePath] } : {}) };
    try {
      if (input.boundImages?.length && (!adapter.supportsBoundImageBuffers || input.boundImages.length > adapter.getCapabilities().maxImageCount)) throw new Error("CONTENT_BOUND_IMAGE_UPLOAD_NOT_SUPPORTED");
      if (run.contentBindingId) this.options.repository.contentSnapshots.assertAssets(this.options.repository.contentSnapshots.get(run.contentBindingId));
      const prepared = await adapter.preparePublish(contextOverride ?? this.context(account, run, executionMode), input);
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
      const imageEvidenceSummary = imageUploadEvidenceSummary(prepared.response.imageUploadEvidence);
      let imageEvidence = imageEvidenceSummary.signal;
      const coverUploadMethod = typeof prepared.response.coverUploadMethod === "string" ? prepared.response.coverUploadMethod.trim() : "";
      const coverUploaded = prepared.response.imageRequirement === "cover_uploaded"
        && prepared.response.coverInputVerified === true
        && coverUploadMethod.length > 0;
      const imageUploadStarted = responseEvents.includes("IMAGE_UPLOAD_STARTED");
      const genericImageUploaded = prepared.response.imageUploaded === true
        && imageUploadStarted
        && responseEvents.includes("IMAGE_UPLOAD_PASSED")
        && imageEvidenceSummary.verified;
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
      return { input, imageAssetId: imageUploaded ? image?.id ?? null : null, prepared };
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

  private summarizeTask10sAttemptResult(
    controlled: ControlledPostUploadDiscoveryResult,
    runtimeBefore: BrowserSessionRuntimeSnapshot,
    runtimeAfter: BrowserSessionRuntimeSnapshot,
    authorizedRunStateAfter: "AUTHORIZED_UNUSED" | "NOT_VERIFIED",
    attempt: Task10sControlledUploadAttemptSpec,
    attemptConsumed: boolean
  ): Task10sControlledUploadAttemptResult {
    const result = emptyTask10sControlledUploadAttemptResult(attempt, controlled.accountId);
    const imageEvidence = safeRecord(controlled.evidence.imageEvidence);
    const immediateReadback = safeImmediateReadback(imageEvidence?.fileInputImmediateReadback);
    const fingerprint = safeFingerprint(immediateReadback.status === "NOT_OBSERVED" ? null : imageEvidence?.fileInputImmediateReadback && safeRecord(imageEvidence.fileInputImmediateReadback)?.fingerprint);
    const postUpload = safePostUploadEvidence(controlled);
    const mediaPreview = safeRecord(postUpload?.mediaPreviewDiagnostics);
    const previewCount = safeInteger(postUpload?.visibleImageItemCount) ?? safeInteger(mediaPreview?.previewCount);
    const assetCount = safeInteger(postUpload?.imageAssetRenderedCount) ?? (mediaPreview?.previewVisible === true ? safeInteger(mediaPreview.previewCount) : null);
    const processingSignal = typeof postUpload?.processingSignalPresent === "boolean" ? postUpload.processingSignalPresent : null;
    const explicitErrorSignal = Array.isArray(postUpload?.explicitUploadErrorSignals) && postUpload.explicitUploadErrorSignals.length > 0;
    const titleControlPresent = safeBoolean(postUpload?.titleControlPresent) || controlled.titleEditorStatus === "FOUND_UNIQUE" || controlled.titleEditorStatus === "READY";
    const bodyControlPresent = safeBoolean(postUpload?.bodyControlPresent) || controlled.bodyEditorStatus === "FOUND_UNIQUE" || controlled.bodyEditorStatus === "READY";
    const finalSubmitControlPresent = safeInteger(postUpload?.finalSubmitVisibleCount) !== null && (safeInteger(postUpload?.finalSubmitVisibleCount) ?? 0) > 0
      || controlled.finalSubmitStatus === "FOUND_UNIQUE"
      || controlled.finalSubmitStatus === "READY";
    const layer1 = immediateReadback.status === "PASS" ? "PASS" : immediateReadback.status === "FAIL" ? "FAIL" : "NOT_RUN";
    const layer2 = immediateReadback.status === "PASS"
      && immediateReadback.filesLength === 1
      && immediateReadback.fileName === TASK10S_SAFE_FIXTURE_NAME
      && immediateReadback.fileSize === TASK10S_SAFE_FIXTURE_SIZE
      && immediateReadback.fileType === "image/png"
      && immediateReadback.expectedFixtureMatch === "YES"
      ? "PASS" : immediateReadback.status === "NOT_OBSERVED" ? "NOT_RUN" : "FAIL";
    const layer3 = explicitErrorSignal ? "FAIL" : postUpload ? "PASS" : "NOT_RUN";
    const layer4 = assetCount !== null && assetCount >= 1 ? "PASS" : postUpload ? "FAIL" : "NOT_RUN";
    const sameContext = controlled.sameContext && runtimeBefore.contextDebugId !== null && runtimeBefore.contextDebugId === runtimeAfter.contextDebugId ? "YES" : "NO";
    const sameCanonicalPage = controlled.sameCanonicalPage && runtimeBefore.canonicalPageDebugId !== null && runtimeBefore.canonicalPageDebugId === runtimeAfter.canonicalPageDebugId ? "YES" : "NO";
    const imageUpload = layer2 === "PASS" && layer4 === "PASS" && titleControlPresent && bodyControlPresent && finalSubmitControlPresent ? "PASS" : "NOT_VERIFIED";
    return {
      ...result,
      timestamp: new Date().toISOString(),
      status: imageUpload === "PASS" && controlled.status === "PASS" && sameContext === "YES" && sameCanonicalPage === "YES" ? "PASS" : "FAIL",
      failureCode: imageUpload === "PASS" && controlled.status === "PASS" ? null : controlled.failureCode ?? `${attempt.attemptId}_UPLOAD_PROOF_INCOMPLETE`,
      contextDebugId: runtimeBefore.contextDebugId,
      pageDebugId: runtimeBefore.canonicalPageDebugId,
      sameContext,
      sameCanonicalPage,
      imagePostEntry: controlled.preUploadGateStatus === "PASS" ? "PASS" : "FAIL",
      imagePostRouteReadback: safeUrlPath(controlled.sanitizedUrlAfter) === "/publish/publish" ? "PASS" : "FAIL",
      observedTarget: safeUrlPath(controlled.sanitizedUrlAfter) === "/publish/publish" && controlled.preUploadGateStatus === "PASS" ? "image" : null,
      preUploadPhaseResult: controlled.preUploadGateStatus === "PASS" ? "PASS" : "FAIL",
      uploadTargetFileInputFingerprint: fingerprint,
      fileInputImmediateReadback: immediateReadback,
      browserFileInputReceivedFixture: layer2 === "PASS" ? "YES" : layer2 === "NOT_RUN" ? "NOT_RUN" : "NO",
      uploadLayer1: layer1,
      uploadLayer2: layer2,
      uploadLayer3: layer3,
      uploadLayer4: layer4,
      uploadProcessingSignal: processingSignal,
      uploadErrorSignal: postUpload ? explicitErrorSignal : null,
      uploadRetrySignal: null,
      currentPreviewDetectionRule: postUpload ? "POST_UPLOAD_EDITOR_SCOPED_VISIBLE_IMAGE_ITEMS" : null,
      currentImageAssetDetectionRule: postUpload ? "EDITOR_SCOPED_IMAGE_ASSET_PROOF_EXCLUDING_GLOBAL_IMAGES" : null,
      editorScopedImagePreviewCount: previewCount,
      editorScopedImageAssetCount: assetCount,
      titleControlPresent,
      bodyControlPresent,
      finalSubmitControlPresent,
      imageUpload,
      controlledUploadAttempt3Count: attemptConsumed && attempt.attemptId === "ATTEMPT_3" ? 1 : 0,
      controlledUploadAttempt4Count: attemptConsumed && attempt.attemptId === "ATTEMPT_4" ? 1 : 0,
      controlledUploadAttempt5Count: attemptConsumed && attempt.attemptId === "ATTEMPT_5" ? 1 : 0,
      imageUploadAttemptCount: attemptConsumed ? attempt.imageUploadAttemptCount : attempt.baseImageUploadAttemptCount,
      authorizedRunStateAfter,
      evidence: { controlled, imageEvidence: imageEvidence ?? null, postUploadInspection: postUpload ?? null, runtimeBefore: { contextDebugId: runtimeBefore.contextDebugId, canonicalPageDebugId: runtimeBefore.canonicalPageDebugId }, runtimeAfter: { contextDebugId: runtimeAfter.contextDebugId, canonicalPageDebugId: runtimeAfter.canonicalPageDebugId } }
    };
  }

  private findTestImage() {
    return this.options.repository.listImageAssets(undefined, true).find((image) => image.universal || [...image.usage, ...image.tags].some((label) => /^(测试|通用)$/u.test(label.trim()))) ?? null;
  }

  private ensureSafeTestImage() {
    const existing = this.options.repository.listImageAssets(undefined, true).find((image) => /task10s-safe-test\.png$/iu.test(image.originalFileName) || /task10s-safe-test\.png$/iu.test(image.filePath));
    if (existing) return existing;
    const imagePath = safeSelfTestImagePath("task10s-safe-test.png");
    const brandId = this.options.repository.listBrands()[0]?.id ?? null;
    return this.options.repository.createImageAsset({ brandId, name: "Task10S SAFE_TEST_FIXTURE", filePath: imagePath, originalFileName: "task10s-safe-test.png", mimeType: "image/png", size: SAFE_TEST_IMAGE_BYTES.byteLength, tags: ["测试"], usage: ["测试"], platform: ["xiaohongshu"], universal: true });
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

  private task10sDatabaseSnapshot(): Record<string, number> {
    const count = (table: string): number => Number((this.options.repository.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    return {
      accounts: this.options.repository.listAccounts().length,
      oneShotAuthorizations: count("one_shot_publication_authorizations"),
      identityBindings: count("platform_account_identity_bindings"),
      publishJobs: count("publish_jobs"),
      submissionIntents: count("submission_intents"),
      publishRecords: count("publish_records"),
      mediaAssets: count("media_assets"),
      platformSelfTestSteps: count("platform_self_test_steps")
    };
  }

  private fileSha256(path: string): string | null {
    try { return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase(); } catch { return null; }
  }

  private writeTask10sEvidence(result: Task10SPrepublishResult, run: PlatformSelfTestRun): string | null {
    if (!this.options.evidenceDirectory) return null;
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const evidencePath = join(this.options.evidenceDirectory, `xiaohongshu-task10s-prepublish-${timestamp}-${result.testRunId.slice(0, 8)}.json`);
    mkdirSync(this.options.evidenceDirectory, { recursive: true });
    writeFileSync(evidencePath, JSON.stringify({ ...result, evidencePath, run }, null, 2), "utf8");
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_TASK10S_PREPUBLISH_EVIDENCE_WRITTEN", "小红书 Task10S 安全预发布证据已写入；未执行最终发布", { testRunId: result.testRunId, evidencePath, finalSubmitCount: result.safety.finalSubmitCount, authorizationState: result.authorizationState });
    return evidencePath;
  }

  private account(run: PlatformSelfTestRun): Account {
    const account = this.options.repository.getAccountById(run.accountId ?? run.platformAccountId, run.platformKey);
    if (!account || account.platformKey !== run.platformKey || (account.platformAccountId ?? account.id) !== run.platformAccountId || !account.enabled || Boolean(account.archivedAt)) throw new Error("平台自测账号绑定不可用");
    return account;
  }

  private requireOneShotContentBinding(run: PlatformSelfTestRun) {
    for (const historical of this.options.repository.listPlatformSelfTestRuns(run.platformAccountId)) {
      if (historical.platformKey === run.platformKey && historical.publishJobId && this.options.repository.getSubmissionBarrier(historical.publishJobId)) throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
    }
    if (!run.contentBindingId) throw new Error("ONE_SHOT_CONTENT_PAYLOAD_REQUIRED");
    const binding = this.options.repository.getOneShotContentBinding(run.contentBindingId);
    if (!binding || binding.platformKey !== "xiaohongshu" || binding.accountId !== run.accountId) throw new Error("ONE_SHOT_CONTENT_BINDING_MISSING");
    const snapshot = this.options.repository.contentSnapshots.get(binding.contentBindingId);
    if (snapshot.purpose !== "ONE_SHOT_ACCEPTANCE" || snapshot.operationId !== run.testRunId || snapshot.accountId !== run.accountId) throw new Error("CONTENT_PURPOSE_OR_RUN_MISMATCH");
    const account = this.account(run);
    if (snapshot.platformKey !== binding.platformKey || snapshot.creatorId !== binding.creatorId || binding.creatorId !== account.externalAccountId || binding.creatorId !== this.expectedCreatorId(account)) throw new Error("ONE_SHOT_CONTENT_SUBJECT_MISMATCH");
    this.options.repository.contentSnapshots.assertAssets(snapshot);
    return { ...binding, platformKey: "xiaohongshu" as const };
  }

  private selectedXhsAccount(accountId?: string): Account {
    const account = accountId
      ? this.options.repository.getAccountById(accountId, "xiaohongshu")
      : this.options.repository.listAccounts().filter((item) => item.platformKey === "xiaohongshu" && item.enabled && !item.archivedAt).length === 1
        ? this.options.repository.listAccounts().find((item) => item.platformKey === "xiaohongshu" && item.enabled && !item.archivedAt)
        : undefined;
    if (!account || account.platformKey !== "xiaohongshu" || !account.enabled || Boolean(account.archivedAt)) throw new Error("小红书账号不可用或选择不明确");
    return account;
  }

  private expectedCreatorId(account: Account): string | null {
    return this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id)?.externalCreatorId ?? account.externalAccountId ?? null;
  }

  private mustRun(testRunId: string, level: PlatformSelfTestLevel): PlatformSelfTestRun {
    const run = this.options.repository.getPlatformSelfTestRun(testRunId);
    if (!run || run.requestedLevel !== level) throw new Error("平台自测运行不存在或等级不匹配");
    return run;
  }

  private mustOneShotRun(testRunId: string): PlatformSelfTestRun {
    const run = this.mustRun(testRunId, "L5_PUBLISH");
    const confirmationRequired = run.steps.some((item) => item.stepKey === "PUBLISH_CONFIRMATION" && item.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED");
    const authorization = run.platformKey === "xiaohongshu" ? this.options.repository.getOneShotPublicationAuthorization(testRunId) : null;
    const resumable = Boolean(authorization
      && authorization.state === "AUTHORIZED_UNUSED"
      && authorization.platformKey === "xiaohongshu"
      && authorization.accountId === run.accountId
      && authorization.mode === ONE_SHOT_REAL_PUBLISH_ACCEPTANCE
      && authorization.publicationTransactionCount === 0
      && authorization.finalSubmitAttemptCount === 0
      && authorization.finalSubmitRetryCount === 0
      && hasOneShotPrepublishState(run));
    if (run.platformKey !== "xiaohongshu" || (!confirmationRequired && !resumable)) throw new Error("当前运行不是 Task10S 一次性真实发布测试");
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
