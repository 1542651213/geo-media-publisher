import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { transparentSelfTestContent } from "../apps/desktop/src/main/platform-self-test";
import { isAutomationAdapter, type AutomationAdapter, type BrowserPublishAttemptContext } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";
import type { AccountContext, PlatformSelfTestRun, PublishArticleInput, PublishJob, PublishResult } from "@publisher/domain";
import type { Page } from "playwright-core";

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const dataDirectory = join(userDataPath, "production-data");
const accountId = "3ffa4368-e8cd-4725-8658-846ad35b1980";
const platformKey = "toutiao";
const sourcePreSubmitRunId = "69fe2493-631d-4ede-a659-dc381a97229e";
const sourceEvidencePath = join(process.cwd(), "output", "v131-toutiao-pre-submit-evidence.json");
const outputPath = join(process.cwd(), "output", "v132-toutiao-real-publish.json");
const beforeScreenshotPath = join(process.cwd(), "output", "v132-toutiao-before-final-submit.png");
const afterScreenshotPath = join(process.cwd(), "output", "v132-toutiao-after-final-submit.png");
const toutiaoArticleEditorUrl = "https://mp.toutiao.com/profile_v4/graphic/publish";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function recordValue(value: unknown, key: string): unknown { return isRecord(value) ? value[key] : undefined; }
function recordAt(value: unknown, key: string): JsonRecord | null { const result = recordValue(value, key); return isRecord(result) ? result : null; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function redacted(value: string): string { return value.replace(/(cookie|token|secret|authorization|access[_-]?key|refresh[_-]?token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]").slice(0, 8_000); }

function activePage(adapter: AutomationAdapter, targetAccountId: string): Page | null {
  const internals = adapter as unknown as { activeSessions?: Map<string, { page: Page }> };
  return internals.activeSessions?.get(`${platformKey}:${targetAccountId}`)?.page ?? null;
}

async function pageSnapshot(page: Page, screenshotPath: string): Promise<JsonRecord> {
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
  const controls: JsonRecord[] = [];
  const candidates = page.locator("button, [role=button], a");
  const count = await candidates.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 160); index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const text = (await candidate.innerText().catch(() => "")).replace(/\s+/gu, " ").trim();
    const ariaLabel = (await candidate.getAttribute("aria-label").catch(() => null))?.trim() ?? "";
    const title = (await candidate.getAttribute("title").catch(() => null))?.trim() ?? "";
    const href = (await candidate.getAttribute("href").catch(() => null))?.trim() ?? "";
    if (!text && !ariaLabel && !title && !href) continue;
    controls.push({ label: [text, ariaLabel, title].filter(Boolean).join(" "), href, enabled: await candidate.isEnabled().catch(() => false) });
  }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return { url: page.url(), title: await page.title().catch(() => ""), frameUrls: page.frames().map((frame) => frame.url()).slice(0, 40), bodyTextExcerpt: redacted(bodyText), controls, screenshotPath };
}

function rows(db: Database.Database, sql: string, ...values: Array<string | number | null>): JsonRecord[] {
  return (db.prepare(sql).all(...values) as unknown[]).filter(isRecord);
}

function one(db: Database.Database, sql: string, ...values: Array<string | number | null>): JsonRecord | null {
  const value = db.prepare(sql).get(...values) as unknown;
  return isRecord(value) ? value : null;
}

function databaseSnapshot(db: Database.Database, targetAccountId: string, jobId?: string): JsonRecord {
  const snapshot: JsonRecord = {
    counts: {
      publish_jobs: one(db, "SELECT COUNT(*) AS count FROM publish_jobs")?.count ?? null,
      submission_intents: one(db, "SELECT COUNT(*) AS count FROM submission_intents")?.count ?? null,
      publish_records: one(db, "SELECT COUNT(*) AS count FROM publish_records")?.count ?? null
    },
    toutiaoJobs: rows(db, "SELECT id,status,content_kind,account_id,platform_account_id,platform_key,article_id,submission_intent_id,publish_record_id,external_id,attempt_count,final_publish_mode,manual_confirmation_required,created_at,started_at,finished_at,last_error_code,last_error_message FROM publish_jobs WHERE platform_key=? OR account_id=? ORDER BY created_at", platformKey, targetAccountId),
    toutiaoIntents: rows(db, "SELECT id,job_id,account_id,platform_key,state,attempt,final_submit_count,external_id,error_code,created_at,updated_at FROM submission_intents WHERE platform_key=? OR account_id=? ORDER BY created_at", platformKey, targetAccountId),
    toutiaoRecords: rows(db, "SELECT id,job_id,account_id,platform_account_id,platform_key,article_id,published_url,published_external_id,success,response_json,published_at,dry_run,status,publish_mode,automation_type,browser_session_id_hash,verification_status,editor_opened_at,title_filled,body_filled,selected_image_asset_id,image_selection_mode FROM publish_records WHERE platform_key=? OR account_id=? ORDER BY published_at", platformKey, targetAccountId),
    selfTestRun: one(db, "SELECT test_run_id,platform_key,platform_account_id,requested_level,overall_result,publish_confirmed_at,test_article_id,publish_job_id,publish_record_id,external_id,external_url,cleanup_status,updated_at FROM platform_self_test_runs WHERE test_run_id=?", sourcePreSubmitRunId)
  };
  if (jobId) {
    snapshot.job = one(db, "SELECT id,status,content_kind,account_id,platform_account_id,platform_key,article_id,submission_intent_id,publish_record_id,external_id,attempt_count,max_attempts,final_publish_mode,manual_confirmation_required,created_at,started_at,finished_at,last_error_code,last_error_message FROM publish_jobs WHERE id=?", jobId);
    snapshot.intent = one(db, "SELECT id,job_id,account_id,platform_key,state,attempt,final_submit_count,external_id,error_code,created_at,updated_at FROM submission_intents WHERE job_id=? ORDER BY created_at DESC LIMIT 1", jobId);
    snapshot.record = one(db, "SELECT id,job_id,account_id,platform_account_id,platform_key,article_id,published_url,published_external_id,success,response_json,published_at,dry_run,status,publish_mode,automation_type,browser_session_id_hash,verification_status,editor_opened_at,title_filled,body_filled,selected_image_asset_id,image_selection_mode FROM publish_records WHERE job_id=? ORDER BY published_at DESC LIMIT 1", jobId);
  }
  return snapshot;
}

function preSubmitTimestamp(evidence: JsonRecord): string | null {
  const page = recordAt(evidence, "page");
  const frames = recordValue(page, "frames");
  const text = Array.isArray(frames) ? frames.map((frame) => stringValue(recordValue(frame, "bodyTextExcerpt"))).join("\n") : "";
  return text.match(/测试时间：([0-9T:.+\-Z]+)/u)?.[1] ?? null;
}

function jsonValue(value: unknown): string { return JSON.stringify(value, null, 2); }

async function main(): Promise<void> {
  app.setName("codex-media-publisher");
  app.setPath("userData", userDataPath);
  await app.whenReady();
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const evidence: JsonRecord = {
    startedAt: new Date().toISOString(),
    platformKey,
    contentKind: "article",
    accountId,
    sourcePreSubmitRunId,
    sourceEvidencePath,
    browserExecutionMode: "VISIBLE",
    finalSubmitMax: 1,
    finalSubmitClickCount: 0,
    finalSubmitAction: "NOT_STARTED",
    reconciliation: "NOT_NEEDED"
  };
  let opened: { db: Database.Database; repository: import("@publisher/db").AppRepository } | null = null;
  let registry: import("@publisher/adapters-core").AdapterRegistry | null = null;
  let adapter: AutomationAdapter | null = null;
  let jobId: string | null = null;
  let finalSubmitClickCount = 0;
  const writeEvidence = (): void => writeFileSync(outputPath, `${jsonValue({ ...evidence, finalSubmitClickCount, updatedAt: new Date().toISOString() })}\n`, "utf8");

  try {
    if (!["1", "true", "yes"].includes((process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED ?? "").trim().toLowerCase())) throw new Error("REAL_PUBLISH_TEST_BATCH_CONFIRMED is required for this one-account SELF_TEST");
    const priorEvidence = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) as unknown : null;
    const priorResult = stringValue(recordValue(priorEvidence, "result"));
    const priorClickCount = recordValue(priorEvidence, "finalSubmitClickCount");
    let priorPublishRunId = stringValue(recordValue(priorEvidence, "publishRunId"));
    let priorJobId = stringValue(recordValue(recordValue(priorEvidence, "jobCreated"), "id"));
    const priorAfterPage = recordAt(priorEvidence, "afterFinalSubmitPage");
    const priorAfterText = stringValue(recordValue(priorAfterPage, "bodyTextExcerpt"));
    const priorPreviewOnly = priorResult === "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION" && priorClickCount === 1 && stringValue(recordValue(priorAfterPage, "url")) === toutiaoArticleEditorUrl && priorAfterText.includes("预览确认发布") && priorAfterText.includes("保存失败");
    const sourceEvidence = JSON.parse(readFileSync(sourceEvidencePath, "utf8")) as unknown;
    if (!isRecord(sourceEvidence) || sourceEvidence.result !== "PREPARED" || sourceEvidence.finalSubmitClickCount !== 0 || sourceEvidence.finalSubmitAction !== "FORBIDDEN") throw new Error("v131 pre-submit evidence is not the expected zero-click PREPARED run");
    opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
    registry = createRuntimeAdapterRegistry(credentials, false, logger);
    const repository = opened.repository;
    const account = repository.listAccounts().find((item) => item.id === accountId && item.platformKey === platformKey);
    const articlePlatform = repository.listPlatforms().find((item) => item.platformKey === platformKey);
    const sourceRun = repository.getPlatformSelfTestRun(sourcePreSubmitRunId);
    if (!account || !articlePlatform || !sourceRun) throw new Error("Toutiao account, platform or confirmed pre-submit Run is missing");
    if (sourceRun.platformKey !== platformKey || sourceRun.overallResult !== "PASSED" || sourceRun.publishJobId || sourceRun.publishRecordId) throw new Error(`Source pre-submit Run is not reusable: ${jsonValue(sourceRun)}`);
    const selectedAdapter = registry.getForContent(platformKey, "article");
    if (!isAutomationAdapter(selectedAdapter) || selectedAdapter.constructor.name !== "ToutiaoArticleBrowserAdapter") throw new Error(`Unexpected Toutiao article adapter: ${selectedAdapter.constructor.name}`);
    adapter = selectedAdapter;
    const videoAdapter = registry.getForContent(platformKey, "video");
    const image = repository.listImageAssets(undefined, true).find((item) => (item.universal || [...item.usage, ...item.tags].some((label) => /^(测试|通用)$/u.test(label.trim()))) && existsSync(item.filePath));
    if (!image) throw new Error("No existing local test image is available; stopped before Job creation");
    const timestamp = preSubmitTimestamp(sourceEvidence);
    if (!timestamp) throw new Error("Could not recover the exact v131 test timestamp from pre-submit evidence; stopped before Job creation");
    const frameEvidence = recordValue(recordAt(sourceEvidence, "page"), "frames");
    const frameText = Array.isArray(frameEvidence) ? frameEvidence.map((frame) => stringValue(recordValue(frame, "bodyTextExcerpt"))).join("\n") : "";
    const platformName = frameText.match(/平台：([^\n\r]+)/u)?.[1]?.trim() || articlePlatform.displayName;
    const content: PublishArticleInput = { ...transparentSelfTestContent(platformKey, platformName, new Date(timestamp)), images: [image.filePath] };
    if (!frameText.includes(`测试时间：${timestamp}`)) throw new Error("Recovered article content does not match the v131 page evidence");

    let recoverablePriorAttempt = (priorResult === "TOUTIAO_REAL_PUBLISH_FAILED_BEFORE_SUBMISSION" && priorClickCount === 0 || priorPreviewOnly) && Boolean(priorPublishRunId && priorJobId);
    if (!recoverablePriorAttempt && (priorResult === "TOUTIAO_REAL_PUBLISH_FAILED_BEFORE_SUBMISSION" || priorPreviewOnly) && (priorClickCount === 0 || priorPreviewOnly)) {
      const candidates = repository.listPlatformSelfTestRuns(account.platformAccountId ?? account.id).flatMap((run) => {
        if (run.platformKey !== platformKey || run.requestedLevel !== "L5_PUBLISH" || !run.publishConfirmedAt || !run.publishJobId || !["TESTING", "FAILED", "WAITING_FOR_USER"].includes(run.overallResult)) return [];
        const candidateJob = repository.getJob(run.publishJobId);
        const candidateArticle = candidateJob ? repository.getArticle(candidateJob.articleId) : null;
        const candidateRecord = candidateJob ? repository.getPublishRecordByJob(candidateJob.id) : null;
        const candidateIntent = candidateJob ? repository.getSubmissionIntentByJob(candidateJob.id) : null;
        const recoverableGuardIntent = candidateIntent?.state === "Unknown" && candidateIntent.finalSubmitCount === 1 && candidateIntent.errorCode === "FINAL_SUBMIT_ALREADY_USED";
        if (!candidateJob || !candidateArticle || !candidateRecord || (candidateIntent && !recoverableGuardIntent) || candidateRecord.status !== "Prepared" || candidateJob.accountId !== account.id || candidateJob.platformKey !== platformKey || candidateJob.contentKind !== "article" || !["AwaitingConfirmation", "Scheduled", "NeedsUserAction", "Retry", "Failed", "NeedsReconciliation"].includes(candidateJob.status) || candidateJob.selectedImageAssetId !== image.id || candidateArticle.title !== content.title || candidateArticle.body !== content.body) return [];
        return [{ runId: run.testRunId, jobId: candidateJob.id }];
      });
      if (candidates.length > 1) throw new Error("Multiple zero-click Toutiao SELF_TEST candidates matched; stopped before submission");
      const candidate = candidates[0];
      if (candidate) {
        priorPublishRunId = candidate.runId;
        priorJobId = candidate.jobId;
        recoverablePriorAttempt = true;
        evidence.recoveryCandidate = { ...candidate, reason: "database_match_after_prior_runner_evidence_was_overwritten" };
      }
    }
    const initialJobs = repository.listJobs().filter((item) => item.platformKey === platformKey && item.accountId === accountId && item.id !== (recoverablePriorAttempt ? priorJobId : "") && !["Failed", "Cancelled", "ReconciledNotPublished"].includes(item.status));
    if (initialJobs.length > 0) throw new Error(`Toutiao has unfinished Jobs; refusing to create another: ${initialJobs.map((item) => `${item.id}:${item.status}`).join(",")}`);

    const context: AccountContext = { accountId: account.id, accountName: account.accountAlias || account.name, platformKey, settings: { triggerSource: "RUN_SELF_TEST", userActionId: sourcePreSubmitRunId, browserExecutionMode: "VISIBLE" }, secrets: {} };
    const before = databaseSnapshot(opened.db, account.id);
    evidence.before = before;
    evidence.preflight = {
      sourceEvidenceResult: sourceEvidence.result,
      sourceFinalSubmitClickCount: sourceEvidence.finalSubmitClickCount,
      route: { platformKey, contentKind: "article", adapterClass: adapter.constructor.name, videoAdapterClass: videoAdapter.constructor.name, videoAdapterStillOfficialApi: videoAdapter.constructor.name === "ToutiaoAdapter" },
      account: { id: account.id, platformAccountId: account.platformAccountId, platformKey: account.platformKey, enabled: account.enabled, loginStatus: account.loginStatus, authorizationStatus: account.authorizationStatus, connectionMode: account.connectionMode, browserSessionIdPresent: Boolean(account.browserSessionId) },
      article: { title: content.title, body: content.body, titleMatchesPreSubmitContract: content.title === "Geo Media Publisher 发布链路测试", bodyTimestamp: timestamp, selectedImageAssetId: image.id, selectedImagePathPresent: existsSync(image.filePath) },
      preSubmitGates: { runtimeRouting: true, accountEnabled: account.enabled, loginStatusSnapshot: account.loginStatus === "logged_in", authorization: account.authorizationStatus === "Authorized", connectionMode: account.connectionMode === "BrowserAutomation", browserSessionId: Boolean(account.browserSessionId), sourcePreSubmitPassed: true }
    };
    writeEvidence();
    const login = await adapter.checkLogin(context);
    evidence.login = { status: login, passed: login === "logged_in" };
    if (login !== "logged_in") throw Object.assign(new Error(`Toutiao final test login gate failed: ${login}`), { code: "LOGIN_EXPIRED" });
    repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in", pausedReason: null, failedCount: 0 });
    evidence.accountAfterLogin = repository.listAccounts().find((item) => item.id === account.id) ?? null;

    let publishRun: PlatformSelfTestRun;
    let job: PublishJob;
    if (recoverablePriorAttempt) {
      const recoveredRun = repository.getPlatformSelfTestRun(priorPublishRunId);
      let recoveredJob = repository.getJob(priorJobId);
      const recoveredArticle = recoveredJob ? repository.getArticle(recoveredJob.articleId) : null;
      const recoveredRecord = recoveredJob ? repository.getPublishRecordByJob(recoveredJob.id) : null;
      const recoveredIntent = recoveredJob ? repository.getSubmissionIntentByJob(recoveredJob.id) : null;
      const safeIntentReset = recoveredIntent?.state === "Unknown" && recoveredIntent.finalSubmitCount === 1 && ((recoveredIntent.errorCode === "FINAL_SUBMIT_ALREADY_USED" && priorClickCount === 0) || (recoveredIntent.errorCode === "SUBMISSION_UNCERTAIN" && priorPreviewOnly));
      if (safeIntentReset) {
        if (priorPreviewOnly) repository.resetSubmissionIntentAfterPreviewOnly(recoveredIntent.id, "PREVIEW_NAVIGATION_ONLY");
        else repository.resetSubmissionIntentForUserAction(recoveredIntent.id, "FINAL_SUBMIT_PRECHECK_FAILED");
        recoveredJob = repository.getJob(priorJobId);
        evidence.recoveredIntentReset = { intentId: recoveredIntent.id, reason: priorPreviewOnly ? "preview_navigation_observed_without_final_confirmation_side_effect" : "final_submit_guard_rejected_before_side_effect" };
      }
      const intentAfterReset = recoveredJob ? repository.getSubmissionIntentByJob(recoveredJob.id) : null;
      if (!recoveredRun || !recoveredJob || !recoveredArticle || recoveredRun.testRunId !== priorPublishRunId || recoveredRun.publishJobId !== recoveredJob.id || recoveredRun.requestedLevel !== "L5_PUBLISH" || !recoveredRun.publishConfirmedAt || recoveredJob.platformKey !== platformKey || recoveredJob.accountId !== account.id || recoveredJob.contentKind !== "article" || !["AwaitingConfirmation", "Scheduled", "NeedsUserAction", "Retry", "Failed"].includes(recoveredJob.status) || recoveredJob.selectedImageAssetId !== image.id || recoveredArticle.title !== content.title || recoveredArticle.body !== content.body || (intentAfterReset && !(intentAfterReset.state === "Prepared" && intentAfterReset.finalSubmitCount === 0)) || (recoveredJob.status === "Failed" && recoveredRecord?.status !== "Prepared")) {
        throw new Error("Prior zero-click Toutiao SELF_TEST Job/Run is not safely reusable; stopped before submission");
      }
      if (recoveredJob.status === "Failed") repository.markJobReconciledNotSubmitted(recoveredJob.id);
      publishRun = recoveredRun;
      job = repository.getJob(recoveredJob.id) as PublishJob;
      evidence.recoveredPriorAttempt = { publishRunId: publishRun.testRunId, jobId: job.id, reason: "reused_existing_zero_click_job_after_preparation_gate_failure" };
    } else {
      publishRun = repository.createPlatformSelfTestRun({ platformAccountId: account.platformAccountId ?? account.id, requestedLevel: "L5_PUBLISH" });
      publishRun = repository.confirmPlatformSelfTestPublish(publishRun.testRunId);
      evidence.publishRunId = publishRun.testRunId;
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_CONFIRMATION", startedAt: publishRun.publishConfirmedAt ?? new Date().toISOString(), result: "PASSED", message: "本轮已获账号所有者明确授权，仅执行一次 Toutiao Article SELF_TEST 最终提交", verificationSignal: "REAL_PUBLISH_TEST_BATCH_CONFIRMED:self_test_l5_only" });
      job = repository.createPlatformSelfTestPublishJob({ testRunId: publishRun.testRunId, title: content.title, body: content.body, dryRun: false, selectedImageAssetId: image.id });
    }
    evidence.publishRunId = publishRun.testRunId;
    jobId = job.id;
    evidence.jobCreated = { id: job.id, status: job.status, contentKind: job.contentKind, accountId: job.accountId, platformKey: job.platformKey, articleId: job.articleId };
    writeEvidence();

    const publisher = new PublisherService(repository, registry, logger, { resolveSecrets: () => ({}) });
    const action = { userActionId: publishRun.testRunId, triggerSource: "RUN_SELF_TEST" as const };
    const publishContext: AccountContext = { ...context, settings: { ...context.settings, userActionId: publishRun.testRunId } };
    const validation = await adapter.validateArticle(content);
    if (!validation.valid) throw Object.assign(new Error(validation.errors.join("；")), { code: "CONTENT_REJECTED" });
    const prepared = await adapter.preparePublish(publishContext, content);
    const imageVerified = prepared.response.imageUploaded === true || (prepared.response.imageRequirement === "cover_uploaded" && prepared.response.coverInputVerified === true && typeof prepared.response.coverUploadMethod === "string");
    if (image && !imageVerified) throw Object.assign(new Error("平台编辑器未返回图片上传完成证据，不能声明图片已插入"), { code: "UPLOAD_FAILED" });
    const preparedResponse = { ...prepared.response, selectedImageAssetId: image.id, imageSelectionMode: "manual", imageInsertion: "uploaded_verified" };
    const existingPreparedRecord = repository.getPublishRecordByJob(job.id);
    const preparedRecord = existingPreparedRecord
      ? repository.updatePublishRecord(existingPreparedRecord.id, { status: "Prepared", success: false, response: preparedResponse, verificationStatus: "WaitingUser" })
      : repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: job.platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: null, success: false, response: preparedResponse, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: adapter.automationType, browserSessionIdHash: prepared.sessionIdHash ?? account.browserSessionId, operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: prepared.editorOpenedAt ?? null, titleFilled: prepared.titleFilled ?? false, bodyFilled: prepared.bodyFilled ?? false, selectedImageAssetId: image.id, imageSelectionMode: "manual" });
    evidence.prepared = { message: prepared.message, job: repository.getJob(job.id), record: preparedRecord };
    const preparedPage = activePage(adapter, account.id);
    if (preparedPage) evidence.beforeFinalSubmitPage = await pageSnapshot(preparedPage, beforeScreenshotPath);
    if (!preparedRecord || preparedRecord.status !== "Prepared" || !["AwaitingConfirmation", "Scheduled", "NeedsUserAction", "Retry"].includes(repository.getJob(job.id)?.status ?? "")) throw new Error("Formal self-test preparation did not leave Prepared record and a retryable confirmation Job");
    repository.confirmJob(job.id, false);
    evidence.confirmedJob = repository.getJob(job.id);
    evidence.before = databaseSnapshot(opened.db, account.id);
    writeEvidence();

    const originalPrepareFinalSubmit = adapter.prepareFinalSubmit?.bind(adapter);
    if (!originalPrepareFinalSubmit) throw new Error("Toutiao article adapter has no final-submit preflight contract");
    adapter.prepareFinalSubmit = async (ctx, input) => {
      const result = await originalPrepareFinalSubmit(ctx, input);
      evidence.finalGate = { ...result.response, platformKey, contentKind: "article", adapterClass: adapter?.constructor.name ?? "" };
      writeEvidence();
      return result;
    };
    const originalFinalSubmit = adapter.finalSubmit?.bind(adapter);
    if (!originalFinalSubmit) throw new Error("Toutiao article adapter has no final-submit implementation");
    adapter.finalSubmit = async (ctx, input, attempt: BrowserPublishAttemptContext): Promise<PublishResult> => {
      const persistedIntent = repository.getSubmissionIntentByJob(attempt.jobId);
      evidence.intentBeforeFinalClick = persistedIntent;
      if (!persistedIntent || persistedIntent.state !== "Submitting" || persistedIntent.finalSubmitCount !== 1) throw new Error(`SubmissionIntent was not persisted and claimed before final click: ${jsonValue(persistedIntent)}`);
      const originalMark = attempt.markSubmissionSideEffect;
      const wrappedAttempt: BrowserPublishAttemptContext = { ...attempt, markSubmissionSideEffect: () => { finalSubmitClickCount += 1; evidence.finalSubmitAction = "CLICKED_ONCE"; evidence.intentAtSideEffect = repository.getSubmissionIntentByJob(attempt.jobId); writeEvidence(); originalMark?.(); } };
      return originalFinalSubmit(ctx, input, wrappedAttempt);
    };

    const execution = await publisher.executeJob(job.id, action, "VISIBLE");
    evidence.execution = { message: execution.message, job: execution.job, record: repository.getPublishRecordByJob(job.id), intent: repository.getSubmissionIntentByJob(job.id) };
    if (execution.job.status === "NeedsReconciliation") {
      evidence.reconciliation = "ATTEMPTED_READ_ONLY";
      const reconciliation = await publisher.reconcileBrowserJob(job.id, action);
      evidence.reconciliationResult = reconciliation;
    }
    const finalPage = activePage(adapter, account.id);
    if (finalPage) evidence.afterFinalSubmitPage = await pageSnapshot(finalPage, afterScreenshotPath);
    const finalJob = repository.getJob(job.id);
    const finalRecord = repository.getPublishRecordByJob(job.id);
    const finalIntent = repository.getSubmissionIntentByJob(job.id);
    if (finalRecord?.success && finalRecord.publishedExternalId && finalRecord.publishedUrl && finalRecord.status === "Published" && finalJob?.status === "Success" && finalIntent?.finalSubmitCount === 1) {
      repository.linkPlatformSelfTestPublishEvidence(publishRun.testRunId, finalRecord.id);
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_SUBMIT", startedAt: finalRecord.publishedAt, result: "PASSED", message: "Toutiao 接受了一次真实文章最终提交", verificationSignal: "final_submit_click_count:1", externalId: finalRecord.publishedExternalId, externalUrl: finalRecord.publishedUrl });
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "EXTERNAL_EVIDENCE", startedAt: finalRecord.publishedAt, result: "PASSED", message: "已保存真实 External ID 与 External URL", verificationSignal: "publisher_verifyPublished:Verified", externalId: finalRecord.publishedExternalId, externalUrl: finalRecord.publishedUrl });
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "STATUS_RECONCILIATION", startedAt: finalRecord.publishedAt, result: "PASSED", message: "公开文章页只读回查通过标题、正文和稳定 URL 校验", verificationSignal: "title_body_url_readback:passed", externalId: finalRecord.publishedExternalId, externalUrl: finalRecord.publishedUrl });
      repository.finishPlatformSelfTestRun(publishRun.testRunId, "PASSED");
      evidence.result = "TOUTIAO_REAL_PUBLISH_PASS";
      evidence.publishPassed = "PASS";
    } else if (finalSubmitClickCount === 1) {
      evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
      evidence.publishPassed = "NOT_PASS";
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_SUBMIT", startedAt: new Date().toISOString(), result: "PARTIAL_PASSED", errorCode: "RESULT_UNKNOWN", message: "最终提交动作已发生，但未取得完整可验证 External ID/URL；保持 NeedsReconciliation，禁止重试", verificationSignal: "final_submit_click_count:1" });
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "EXTERNAL_EVIDENCE", startedAt: new Date().toISOString(), result: "PARTIAL_PASSED", errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", message: "未取得完整外部证据", verificationSignal: "external_evidence:incomplete" });
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "STATUS_RECONCILIATION", startedAt: new Date().toISOString(), result: "WAITING_FOR_USER", errorCode: "RESULT_UNKNOWN", message: "仅完成只读回查尝试，结果仍需人工确认", verificationSignal: "reconciliation:needs_user" });
      repository.finishPlatformSelfTestRun(publishRun.testRunId, "WAITING_FOR_USER");
    } else {
      evidence.result = "TOUTIAO_REAL_PUBLISH_FAILED_BEFORE_SUBMISSION";
      evidence.publishPassed = "NOT_PASS";
      repository.finishPlatformSelfTestRun(publishRun.testRunId, "FAILED");
    }
    evidence.final = { run: repository.getPlatformSelfTestRun(publishRun.testRunId), job: finalJob, record: finalRecord, intent: finalIntent, finalSubmitClickCount, publishPassed: evidence.publishPassed ?? "NOT_PASS" };
    evidence.after = databaseSnapshot(opened.db, account.id, job.id);
    evidence.platformResponse = recordAt(recordAt(evidence, "execution"), "record") ?? finalRecord;
    evidence.finishedAt = new Date().toISOString();
    writeEvidence();
    console.log(`V132_FINAL=${JSON.stringify({ outputPath, result: evidence.result, publishRunId: publishRun.testRunId, jobId: job.id, publishRecordId: finalRecord?.id ?? null, submissionIntentId: finalIntent?.id ?? null, externalId: finalRecord?.publishedExternalId ?? null, externalUrl: finalRecord?.publishedUrl ?? null, jobStatus: finalJob?.status ?? null, finalSubmitClickCount })}`);
  } catch (error) {
    evidence.result = finalSubmitClickCount === 1 ? "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION" : "TOUTIAO_REAL_PUBLISH_FAILED_BEFORE_SUBMISSION";
    evidence.publishPassed = "NOT_PASS";
    evidence.error = { name: error instanceof Error ? error.name : "UnknownError", code: isRecord(error) ? error.code ?? null : null, message: error instanceof Error ? error.message : String(error) };
    if (opened && jobId) evidence.after = databaseSnapshot(opened.db, accountId, jobId);
    evidence.finishedAt = new Date().toISOString();
    writeEvidence();
    console.error(`V132_ERROR=${JSON.stringify({ outputPath, result: evidence.result, jobId, finalSubmitClickCount, error: evidence.error })}`);
  } finally {
    if (registry) await Promise.allSettled(registry.listAll().map((item) => (item as typeof item & { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.()).filter((promise): promise is Promise<void> => Boolean(promise)));
    opened?.db.close();
    evidence.finishedAt ??= new Date().toISOString();
    writeEvidence();
    app.quit();
  }
}

void main().catch((error) => {
  console.error(`V132_FATAL=${error instanceof Error ? error.message : String(error)}`);
  app.quit();
});
