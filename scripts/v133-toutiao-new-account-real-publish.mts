import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { Page } from "playwright-core";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { isAutomationAdapter, type AutomationAdapter, type BrowserPublishAttemptContext } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";
import type { AccountContext, PublishArticleInput, PublishJob, PlatformSelfTestRun } from "@publisher/domain";
import { ToutiaoArticleBrowserAdapter } from "../packages/adapters/toutiao/src/browser";
import { isToutiaoReadyForFinalSubmit, type ToutiaoGateChecks } from "./toutiao-gate-only";

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const dataDirectory = join(userDataPath, "production-data");
const accountId = "3ffa4368-e8cd-4725-8658-846ad35b1980";
const platformKey = "toutiao";
const oldExternalAccountId = "578791878688868";
const oldJobId = "84aebddc-aa54-43cf-a4f8-2269c706a0d7";
const oldIntentId = "5c2200e7-0c22-4b4e-b52c-318a98a5897a";
const oldRecordId = "8776b6d2-be6f-4fee-84bf-aecdc15e700a";
const preflightOnly = ["1", "true", "yes"].includes((process.env.TOUTIAO_ACCOUNT_PREFLIGHT_ONLY ?? "").trim().toLowerCase());
const gateOnly = ["1", "true", "yes"].includes((process.env.TOUTIAO_ACCOUNT_GATE_ONLY ?? "").trim().toLowerCase());
const outputPath = join(process.cwd(), "output", preflightOnly ? "v134-toutiao-account-preflight.json" : gateOnly ? "v137-toutiao-account-gates.json" : "v138-toutiao-real-publish.json");
const beforeScreenshotPath = join(process.cwd(), "output", "v138-toutiao-before-final-submit.png");
const afterScreenshotPath = join(process.cwd(), "output", "v138-toutiao-after-final-submit.png");
const gateScreenshotPath = join(process.cwd(), "output", "v137-toutiao-account-gates.png");

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function json(value: unknown): string { return JSON.stringify(value, null, 2); }
function redact(value: string): string { return value.replace(/(cookie|token|secret|authorization|access[_-]?key|refresh[_-]?token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]").slice(0, 12_000); }
function activePage(adapter: AutomationAdapter, targetAccountId: string): Page | null {
  const internals = adapter as unknown as { activeSessions?: Map<string, { page: Page }> };
  return internals.activeSessions?.get(`${platformKey}:${targetAccountId}`)?.page ?? null;
}

async function pageEvidence(page: Page, screenshotPath: string): Promise<JsonRecord> {
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const anchors: JsonRecord[] = [];
  const locator = page.locator("a[href]");
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 220); index += 1) {
    const item = locator.nth(index);
    if (!await item.isVisible().catch(() => false)) continue;
    const href = (await item.getAttribute("href").catch(() => null))?.trim() ?? "";
    if (!href) continue;
    anchors.push({ href, text: (await item.innerText().catch(() => "")).replace(/\s+/gu, " ").trim() });
  }
  return { url: page.url(), title: await page.title().catch(() => ""), bodyTextExcerpt: redact(bodyText), anchors };
}

function databaseSnapshot(repository: import("@publisher/db").AppRepository, targetJobId?: string): JsonRecord {
  const jobs = repository.listJobs().filter((item) => item.platformKey === platformKey && item.accountId === accountId);
  const target = targetJobId ? repository.getJob(targetJobId) : null;
  return {
    counts: { toutiaoJobs: jobs.length, submissionIntents: jobs.filter((item) => Boolean(repository.getSubmissionIntentByJob(item.id))).length, publishRecords: jobs.filter((item) => Boolean(repository.getPublishRecordByJob(item.id))).length },
    jobs,
    old: { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) ?? (oldRecordId ? { id: oldRecordId } : null) },
    target: target ? { job: target, intent: repository.getSubmissionIntentByJob(target.id), record: repository.getPublishRecordByJob(target.id) } : null
  };
}

function timestampTitle(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "00";
  return `GMP 今日头条真实发布测试 ${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

async function main(): Promise<void> {
  app.setName("codex-media-publisher");
  app.setPath("userData", userDataPath);
  await app.whenReady();
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const evidence: JsonRecord = {
    startedAt: new Date().toISOString(), operation: preflightOnly ? "TOUTIAO_ACCOUNT_IDENTITY_PREFLIGHT_ONLY" : gateOnly ? "TOUTIAO_ACCOUNT_GATES_ONLY" : "TOUTIAO_NEW_ACCOUNT_REAL_ARTICLE_SELF_TEST", platformKey, accountId,
    oldExternalAccountId, oldJobId, oldIntentId, oldRecordId, browserExecutionMode: "VISIBLE", finalSubmitMax: 1,
    finalSubmitClickCount: 0, finalSubmitAction: "NOT_STARTED", newAccountRequired: true, oldArtifactsMustRemainUnchanged: true,
    result: "NOT_STARTED", publishPassed: "NOT_PASS"
  };
  let opened: { db: Database.Database; repository: import("@publisher/db").AppRepository } | null = null;
  let registry: import("@publisher/adapters-core").AdapterRegistry | null = null;
  let adapter: ToutiaoArticleBrowserAdapter | null = null;
  let job: PublishJob | null = null;
  let publishRun: PlatformSelfTestRun | null = null;
  let clickCount = 0;
  const writeEvidence = (): void => writeFileSync(outputPath, `${json({ ...evidence, finalSubmitClickCount: clickCount, updatedAt: new Date().toISOString() })}\n`, "utf8");
  try {
    if (!preflightOnly && !gateOnly && !["1", "true", "yes"].includes((process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED ?? "").trim().toLowerCase())) throw new Error("REAL_PUBLISH_TEST_BATCH_CONFIRMED is required for the one-account SELF_TEST");
    opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    const repository = opened.repository;
    const account = repository.listAccounts().find((item) => item.id === accountId && item.platformKey === platformKey);
    const platform = repository.listPlatforms().find((item) => item.platformKey === platformKey);
    if (!account || !platform) throw new Error("Toutiao account or platform is missing");
    evidence.before = databaseSnapshot(repository);
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
    registry = createRuntimeAdapterRegistry(credentials, false, logger);
    const selected = registry.getForContent(platformKey, "article");
    if (!isAutomationAdapter(selected) || !(selected instanceof ToutiaoArticleBrowserAdapter)) throw new Error(`Unexpected Toutiao article adapter: ${selected.constructor.name}`);
    adapter = selected;
    const context: AccountContext = { accountId: account.id, accountName: account.accountAlias || account.name, platformKey, settings: { triggerSource: "RUN_SELF_TEST", userActionId: `v133-${Date.now()}`, browserExecutionMode: "VISIBLE" }, secrets: {} };

    const preflight = await adapter.inspectAccountPreflight(context);
    evidence.accountPreflight = preflight;
    const preflightPage = activePage(adapter, account.id);
    if (preflightPage) evidence.accountPreflightPage = await pageEvidence(preflightPage, join(process.cwd(), "output", preflightOnly ? "v134-toutiao-account-preflight.png" : gateOnly ? gateScreenshotPath : "v138-toutiao-account-preflight.png"));
    if (preflightOnly || (gateOnly && !preflight.allowed)) {
      evidence.result = preflight.allowed ? "TOUTIAO_ACCOUNT_PREFLIGHT_PASS" : "TOUTIAO_ACCOUNT_PREFLIGHT_BLOCKED";
      evidence.publishPassed = "NOT_PASS";
      evidence.finalSubmitClickCount = 0;
      evidence.finalSubmitAction = "NOT_STARTED";
      evidence.after = databaseSnapshot(repository);
      evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) };
      if (!preflight.allowed) evidence.failureReason = { code: preflight.reasonCode, message: preflight.reason };
      writeEvidence();
      return;
    }
    const preflightIdentity = preflight.identity.externalAccountId;
    if (!preflight.allowed) {
      evidence.result = "TOUTIAO_ACCOUNT_PREFLIGHT_BLOCKED";
      evidence.failureReason = { code: preflight.reasonCode, message: preflight.reason };
      if (preflight.reasonCode === "ACCOUNT_MUTED") evidence.failureCode = "ACCOUNT_MUTED";
      else if (preflight.reasonCode === "PUBLISH_PERMISSION_DENIED") evidence.failureCode = "PUBLISH_PERMISSION_DENIED";
      else if (preflight.reasonCode === "SECURITY_VERIFICATION_REQUIRED") evidence.failureCode = "SECURITY_VERIFICATION_REQUIRED";
      evidence.after = databaseSnapshot(repository);
      evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) };
      writeEvidence();
      return;
    }
    if (!preflightIdentity || preflightIdentity === oldExternalAccountId) {
      evidence.result = "TOUTIAO_ACCOUNT_IDENTITY_UNCHANGED";
      evidence.failureCode = "ACCOUNT_IDENTITY_UNVERIFIED";
      evidence.failureReason = preflightIdentity ? `Current profile ${preflightIdentity} matches the muted old account` : "No unique Toutiao profile identity was observed";
      evidence.after = databaseSnapshot(repository);
      evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) };
      writeEvidence();
      return;
    }
    if (gateOnly) {
      const gates: ToutiaoGateChecks = {
        accountIdentity: Boolean(preflight.identity.externalAccountId && preflight.identity.externalAccountId !== oldExternalAccountId),
        login: false,
        publishPermission: preflight.articlePublishPermission,
        noSecurityVerification: preflight.reasonCode !== "SECURITY_VERIFICATION_REQUIRED"
          && preflight.reasonCode !== "REAL_NAME_VERIFICATION_REQUIRED",
        articleEditor: false,
        title: false,
        body: false,
        strictReadback: false,
        cover: false,
        requiredFields: false,
        finalSubmitControl: false
      };
      evidence.gates = gates;
      const login = await adapter.checkLogin(context);
      gates.login = login === "logged_in";
      evidence.login = { status: login, passed: gates.login };
      if (!gates.login) {
        evidence.result = "TOUTIAO_ACCOUNT_GATES_BLOCKED";
        evidence.failureCode = "LOGIN_EXPIRED";
        evidence.failureReason = "Toutiao Login gate did not return logged_in";
        evidence.after = databaseSnapshot(repository);
        evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) };
        writeEvidence();
        return;
      }
      const image = repository.listImageAssets(undefined, true).find((item) => existsSync(item.filePath));
      if (!image) {
        evidence.result = "TOUTIAO_ACCOUNT_GATES_BLOCKED";
        evidence.failureCode = "UPLOAD_FAILED";
        evidence.failureReason = "No existing local image asset is available for the read-only cover gate";
        evidence.after = databaseSnapshot(repository);
        evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) };
        writeEvidence();
        return;
      }
      const gateTitle = `GMP 今日头条门禁复核 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()).replaceAll("/", "-")}`;
      const gateBody = `这是 GMP 今日头条新账号发布前门禁复核内容，仅用于验证文章编辑器、严格回读、封面和最终提交控件；本轮禁止真实提交。复核时间：${new Date().toISOString()}。`;
      const content: PublishArticleInput = { articleId: randomUUID(), title: gateTitle, body: gateBody, summary: "GMP 今日头条发布前门禁复核", tags: ["SELF_TEST_GATE"], images: [image.filePath], coverPath: image.filePath };
      evidence.content = { title: gateTitle, body: gateBody, articleId: content.articleId, selectedImageAssetId: image.id, selectedImagePath: image.filePath, persisted: false };
      try {
        const validation = await adapter.validateArticle(content);
        if (!validation.valid) throw Object.assign(new Error(validation.errors.join("; ")), { code: "CONTENT_REJECTED" });
        const prepared = await adapter.preparePublish(context, content);
        const imageVerified = prepared.response.imageUploaded === true || (prepared.response.imageRequirement === "cover_uploaded" && prepared.response.coverInputVerified === true);
        gates.articleEditor = prepared.response.articleEntry === "verified";
        gates.title = prepared.response.titleReadback === true;
        gates.body = prepared.response.bodyReadback === true;
        gates.strictReadback = gates.title && gates.body;
        gates.cover = imageVerified;
        gates.requiredFields = prepared.response.requiredFieldsVerified === true;
        const finalPrepared = await adapter.prepareFinalSubmit(context, content);
        gates.finalSubmitControl = finalPrepared.response.finalSubmitControl !== undefined
          && isRecord(finalPrepared.response.finalSubmitControl)
          && finalPrepared.response.finalSubmitControl.verified === true
          && finalPrepared.response.finalSubmitControl.enabled === true;
        evidence.prepared = { message: prepared.message, response: prepared.response };
        evidence.finalSubmitPreflight = finalPrepared.response;
        evidence.gates = gates;
        evidence.readyForFinalSubmit = isToutiaoReadyForFinalSubmit(gates);
        evidence.result = evidence.readyForFinalSubmit ? "READY_FOR_FINAL_SUBMIT=YES" : "TOUTIAO_ACCOUNT_GATES_BLOCKED";
        evidence.publishPassed = "NOT_PASS";
        evidence.finalSubmitAction = "FORBIDDEN";
        const gatePage = activePage(adapter, account.id) ?? preflightPage;
        if (gatePage) evidence.afterGatePage = await pageEvidence(gatePage, gateScreenshotPath);
      } catch (error) {
        evidence.gates = gates;
        evidence.result = "TOUTIAO_ACCOUNT_GATES_BLOCKED";
        evidence.failureCode = isRecord(error) ? error.code ?? "GATE_FAILED" : "GATE_FAILED";
        evidence.failureReason = error instanceof Error ? error.message : String(error);
      }
      evidence.after = databaseSnapshot(repository);
      evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) };
      writeEvidence();
      return;
    }
    const login = await adapter.checkLogin(context);
    evidence.login = { status: login, passed: login === "logged_in" };
    if (login !== "logged_in") { evidence.result = "TOUTIAO_LOGIN_GATE_FAILED"; evidence.failureCode = "LOGIN_EXPIRED"; evidence.after = databaseSnapshot(repository); evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldRecordId) }; writeEvidence(); return; }
    const unfinished = repository.listJobs().filter((item) => item.platformKey === platformKey && item.accountId === account.id && !["Failed", "Cancelled", "ReconciledNotPublished", "NeedsReconciliation", "Success"].includes(item.status));
    if (unfinished.length > 0) throw new Error(`Toutiao has unfinished jobs; refusing another publish: ${unfinished.map((item) => `${item.id}:${item.status}`).join(",")}`);
    const image = repository.listImageAssets(undefined, true).find((item) => existsSync(item.filePath));
    if (!image) throw new Error("No existing local image asset is available; stopped before Job creation");
    const title = timestampTitle();
    const body = `这是 GMP 今日头条新账号真实发布 SELF_TEST，仅用于验证账号、编辑器、封面和一次性最终提交链路。测试时间：${new Date().toISOString()}。请勿重复发布。`;
    const contentDraft = { title, body, summary: "GMP 今日头条新账号真实发布安全测试", tags: ["SELF_TEST"], images: [image.filePath] };
    evidence.content = { title, body, selectedImageAssetId: image.id, selectedImagePath: image.filePath, titleIsNew: true, oldTitleNotReused: title !== "Geo Media Publisher 发布链路测试" };
    evidence.gates = { runtimeRouting: true, accountIdentityChanged: true, creatorCenterAccessible: preflight.creatorCenterAccessible, articlePublishPermission: preflight.articlePublishPermission, noSecurityBlocker: true };
    writeEvidence();

    publishRun = repository.createPlatformSelfTestRun({ platformAccountId: account.platformAccountId ?? account.id, requestedLevel: "L5_PUBLISH" });
    publishRun = repository.confirmPlatformSelfTestPublish(publishRun.testRunId);
    repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_CONFIRMATION", startedAt: publishRun.publishConfirmedAt ?? new Date().toISOString(), result: "PASSED", message: "新账号身份和文章发布权限已只读验证；仅执行一次真实文章 SELF_TEST", verificationSignal: "REAL_PUBLISH_TEST_BATCH_CONFIRMED:self_test_l5_only" });
    job = repository.createPlatformSelfTestPublishJob({ testRunId: publishRun.testRunId, title, body, dryRun: false, selectedImageAssetId: image.id });
    evidence.publishRunId = publishRun.testRunId;
    evidence.jobCreated = { id: job.id, status: job.status, articleId: job.articleId };
    writeEvidence();

    const content: PublishArticleInput = { ...contentDraft, articleId: job.articleId };
    const validation = await adapter.validateArticle(content);
    if (!validation.valid) throw Object.assign(new Error(validation.errors.join("; ")), { code: "CONTENT_REJECTED" });
    const prepared = await adapter.preparePublish(context, content);
    const imageVerified = prepared.response.imageUploaded === true || (prepared.response.imageRequirement === "cover_uploaded" && prepared.response.coverInputVerified === true);
    if (!imageVerified) throw Object.assign(new Error("Toutiao cover upload was not strictly verified"), { code: "UPLOAD_FAILED" });
    const existing = repository.getPublishRecordByJob(job.id);
    const record = existing
      ? repository.updatePublishRecord(existing.id, { status: "Prepared", success: false, response: prepared.response, verificationStatus: "WaitingUser" })
      : repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: null, success: false, response: prepared.response, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: adapter.automationType, browserSessionIdHash: prepared.sessionIdHash ?? account.browserSessionId, operator: process.env.USERNAME?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: prepared.editorOpenedAt ?? null, titleFilled: prepared.titleFilled ?? false, bodyFilled: prepared.bodyFilled ?? false, selectedImageAssetId: image.id, imageSelectionMode: "manual" });
    evidence.prepared = { message: prepared.message, response: prepared.response, record };
    const preparedPage = activePage(adapter, account.id);
    if (preparedPage) evidence.beforeFinalSubmitPage = await pageEvidence(preparedPage, beforeScreenshotPath);
    repository.confirmJob(job.id, false);
    evidence.confirmedJob = repository.getJob(job.id);
    writeEvidence();

    const publisher = new PublisherService(repository, registry, logger, { resolveSecrets: () => ({}) });
    const originalFinalSubmit = adapter.finalSubmit.bind(adapter);
    adapter.finalSubmit = async (ctx, input, attempt: BrowserPublishAttemptContext) => {
      const intent = repository.getSubmissionIntentByJob(attempt.jobId);
      evidence.intentBeforeFinalClick = intent;
      if (!intent || intent.state !== "Submitting" || intent.finalSubmitCount !== 1) throw new Error("SubmissionIntent was not persisted and claimed before final click");
      return originalFinalSubmit(ctx, input, { ...attempt, markSubmissionSideEffect: () => { clickCount += 1; evidence.finalSubmitAction = "CLICKED_ONCE"; writeEvidence(); attempt.markSubmissionSideEffect?.(); } });
    };
    const execution = await publisher.executeJob(job.id, { userActionId: publishRun.testRunId, triggerSource: "RUN_SELF_TEST" }, "VISIBLE");
    evidence.execution = { message: execution.message, job: execution.job, record: repository.getPublishRecordByJob(job.id), intent: repository.getSubmissionIntentByJob(job.id) };
    if (execution.job.status === "NeedsReconciliation") evidence.reconciliation = await publisher.reconcileBrowserJob(job.id, { userActionId: publishRun.testRunId, triggerSource: "CONTINUE_PENDING_ACTION" });
    const finalJob = repository.getJob(job.id);
    const finalRecord = repository.getPublishRecordByJob(job.id);
    const finalIntent = repository.getSubmissionIntentByJob(job.id);
    const finalPage = activePage(adapter, account.id);
    if (finalPage) evidence.afterFinalSubmitPage = await pageEvidence(finalPage, afterScreenshotPath);
    if (finalJob?.status === "Success" && finalRecord?.status === "Published" && finalRecord.success && finalRecord.publishedExternalId && finalRecord.publishedUrl && finalIntent?.finalSubmitCount === 1) {
      repository.linkPlatformSelfTestPublishEvidence(publishRun.testRunId, finalRecord.id);
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_SUBMIT", startedAt: finalRecord.publishedAt, result: "PASSED", message: "新账号一次真实文章最终提交已获得稳定外部证据", verificationSignal: "final_submit_click_count:1", externalId: finalRecord.publishedExternalId, externalUrl: finalRecord.publishedUrl });
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "EXTERNAL_EVIDENCE", startedAt: finalRecord.publishedAt, result: "PASSED", message: "公开文章只读验证通过", verificationSignal: "publisher_verifyPublished:Verified", externalId: finalRecord.publishedExternalId, externalUrl: finalRecord.publishedUrl });
      repository.finishPlatformSelfTestRun(publishRun.testRunId, "PASSED");
      evidence.result = "TOUTIAO_REAL_PUBLISH_PASS";
      evidence.publishPassed = "PASS";
    } else if (clickCount === 1) {
      repository.recordPlatformSelfTestStep({ testRunId: publishRun.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_SUBMIT", startedAt: new Date().toISOString(), result: "PARTIAL_PASSED", errorCode: "RESULT_UNKNOWN", message: "最终提交动作已发生但外部证据不完整，保持 NeedsReconciliation，禁止重试", verificationSignal: "final_submit_click_count:1" });
      repository.finishPlatformSelfTestRun(publishRun.testRunId, "WAITING_FOR_USER");
      evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
    } else {
      repository.finishPlatformSelfTestRun(publishRun.testRunId, "FAILED");
      evidence.result = "TOUTIAO_REAL_PUBLISH_FAILED_BEFORE_SUBMISSION";
    }
    evidence.publishPassed = evidence.result === "TOUTIAO_REAL_PUBLISH_PASS" ? "PASS" : "NOT_PASS";
    evidence.final = { run: repository.getPlatformSelfTestRun(publishRun.testRunId), job: finalJob, record: finalRecord, intent: finalIntent, externalId: finalRecord?.publishedExternalId ?? null, externalUrl: finalRecord?.publishedUrl ?? null };
    evidence.oldArtifactsAfter = { job: repository.getJob(oldJobId), intent: repository.getSubmissionIntentByJob(oldJobId), record: repository.getPublishRecordByJob(oldJobId) };
  } catch (error) {
    evidence.result = clickCount === 1 ? "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION" : (publishRun ? "TOUTIAO_REAL_PUBLISH_FAILED_BEFORE_SUBMISSION" : "TOUTIAO_PRE_SUBMIT_GATE_FAILED");
    evidence.publishPassed = "NOT_PASS";
    evidence.error = { name: error instanceof Error ? error.name : "UnknownError", code: isRecord(error) ? error.code ?? null : null, message: error instanceof Error ? error.message : String(error) };
    if (opened) evidence.after = databaseSnapshot(opened.repository, job?.id ?? undefined);
  } finally {
    evidence.finalSubmitClickCount = clickCount;
    evidence.finishedAt = new Date().toISOString();
    writeEvidence();
    if (registry) await Promise.allSettled(registry.listAll().map((item) => (item as typeof item & { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.()).filter((promise): promise is Promise<void> => Boolean(promise)));
    opened?.db.close();
    app.quit();
  }
}

void main().catch((error) => { console.error(`V133_FATAL=${error instanceof Error ? error.message : String(error)}`); app.quit(); });
