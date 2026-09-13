import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import { createOwnerAuthorizedOneShotPublication, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type AdapterRegistry, type PublishFlowExplorationResult } from "@publisher/adapters-core";
import type { XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID } from "@publisher/domain";
import type { PublisherService } from "@publisher/publisher";
import { PlatformSelfTestService } from "../apps/desktop/src/main/platform-self-test";
import { XhsIdentityService } from "../apps/desktop/src/main/xhs-identity";
import * as attempt from "../apps/desktop/src/main/task10s-attempt3";
import { createFixedDiagnosticRunner, parseDiagnosticAction } from "../apps/desktop/src/main/diagnostic-trigger";

const runId = attempt.TASK10S_CANONICAL_AUTHORIZATION_ID;
const accountId = XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID;
const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); cleanup.splice(0).reverse().forEach((close) => close()); });

function exploration(): PublishFlowExplorationResult {
  return {
    mode: "XHS_PUBLISH_FLOW_EXPLORATION", status: "PASS_READY_FOR_FINAL_SUBMIT", operationId: "", platformKey: "xiaohongshu", accountId,
    imageSource: "SAFE_TEST_FIXTURE", sameCanonicalPage: true, sameContext: true,
    timeline: [{ timestamp: new Date().toISOString(), url: "https://creator.xiaohongshu.com/publish/publish", phase: "IMAGE_POST_PRE_UPLOAD", action: "PUBLISH_NOTE_NAVIGATION", result: "PASS" }],
    states: [{ phase: "POST_UPLOAD_TERMINAL_READINESS", postUploadState: "EDITOR_READY", ready: true, imageCounterValid: true, editorScopedImageAssetCount: 1, uploadErrorSignalPresent: false, busySignalPresent: false }],
    actions: [], selectors: [], counters: { navigationRestartCount: 0, refreshCount: 0, uploadAttempts: 1, uploadMutationCount: 1, uploadRetryCount: 0, intermediateActionClickCount: 0, titleMutationCount: 1, bodyMutationCount: 1, settingsMutationCount: 0, contentMutationCount: 2, finalSubmitCount: 0 },
    uploadAttempts: 1, uploadMutationCount: 1, uploadRetryCount: 0, intermediateActionClickCount: 0, titleMutationCount: 1, bodyMutationCount: 1, settingsMutationCount: 0, contentMutationCount: 2, finalSubmitCount: 0,
    budgets: { maxDurationMs: 60000, maxNavigationRestarts: 0, maxUploadAttempts: 1, maxIntermediateActionClicks: 1, maxRefreshCount: 0, maxTitleMutations: 1, maxBodyMutations: 1 },
    title: { attempted: true, mutationCount: 1, strategyCount: 1, readbackVerified: true }, titleReadbackVerified: true,
    body: { attempted: true, mutationCount: 1, strategyCount: 1, readbackVerified: true }, bodyReadbackVerified: true,
    requiredSettings: { status: "KNOWN", mutations: [] }, finalSubmit: { status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true, label: "发布" },
    forbiddenMutationObserved: false, blocker: null, readyForFinalSubmit: true, evidence: {}
  };
}

function closedShadowPass(): XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic {
  return {
    inspectionStatus: "PASS", failureCode: null, accountId, contextDebugId: "context", pageId: "page",
    sessionExists: true, browserConnected: true, contextExists: true, pageExists: true, pageClosed: false, pageContextMatchesSession: true,
    origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish",
    cdpSessionCreated: "YES", cdpGetDocumentSuccess: "YES", cdpGetDocumentDepth: -1, cdpGetDocumentPierce: true,
    piercedXhsPublishBtnCount: 1, hostNodeName: "XHS-PUBLISH-BTN", hostAttributesSafe: { isPublish: "true", isSaveDraft: "false", submitText: "发布", saveText: "保存草稿", submitDisabled: "false", submitLoading: "false" },
    hostIsPublish: "true", hostSubmitText: "发布", hostSubmitDisabled: "false", hostSubmitLoading: "false", hostDescendantButtonCount: 1, exactPublishNativeButtonCount: 1,
    buttonNodeName: "BUTTON", buttonTextSafe: "发布", buttonType: "button", buttonClassSafe: "submit", buttonAriaDisabled: "false", buttonAriaBusy: "false", buttonBoxModelPresent: "YES", buttonCenterXSafe: 10, buttonCenterYSafe: 10,
    finalSubmitControlPresent: "YES", finalSubmitControlEnabled: "YES", closedShadowFinalSubmitSurface: "PASS", saveDraftSurfacePresent: "NOT_INSPECTED", finalResolverSelectedSaveDraft: "NO"
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "task10s-r41-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const database = openDatabase(join(dir, "test.db"), join(process.cwd(), "packages/db/migrations"));
  cleanup.push(() => database.db.close());
  const repo = database.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = repo.createAccount({ platformKey: "xiaohongshu", name: "offline test" });
  repo.db.prepare("UPDATE accounts SET id=? WHERE id=?").run(accountId, account.id);
  repo.updateAccount(accountId, { enabled: true, loginStatus: "logged_in" });
  const run = repo.createPlatformSelfTestRun({ platformAccountId: accountId, requestedLevel: "L5_PUBLISH" });
  repo.db.prepare("UPDATE platform_self_test_runs SET test_run_id=? WHERE test_run_id=?").run(runId, run.testRunId);
  repo.confirmPlatformSelfTestOneShotAtomically(runId, createOwnerAuthorizedOneShotPublication({ accountId, platformKey: "xiaohongshu", operationId: runId, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }));
  const proof = exploration();
  const runtime = { sessionExists: true, browserConnected: true, contextExists: true, canonicalPageExists: true, canonicalPageClosed: false, runtimeAuthState: "AUTHENTICATED", browserSessionIdentity: "session", contextDebugId: "context", canonicalPageDebugId: "page" };
  const forbidden = vi.fn(() => { throw new Error("OFFLINE_PUBLICATION_BOUNDARY"); });
  const adapter = { connectAccount: forbidden, checkSession: forbidden, preparePublish: forbidden, finalSubmit: forbidden, automationType: "BrowserAutomation", getBrowserRuntimeSnapshot: () => runtime, getBrowserSessionEvidence: async () => ({ pageUrl: "https://creator.xiaohongshu.com/new/home" }), inspectCurrentXiaohongshuClosedShadowFinalSubmit: async () => closedShadowPass(), runPublishFlowExploration: async (_context: unknown, input: { operationId: string }) => ({ ...proof, operationId: input.operationId }) };
  const registry = { getForContent: () => adapter } as unknown as AdapterRegistry;
  const publisher = { executeJob: forbidden, executeTask10sRetainedEditor: forbidden } as unknown as PublisherService;
  const options = { repository: repo, registry, publisher, resolveAccountSecrets: () => ({}) };
  const service = new PlatformSelfTestService(options);
  vi.spyOn(attempt, "validateTask10sSafeFixture").mockReturnValue({ path: "offline-fixture", valid: true, failureCode: null } as ReturnType<typeof attempt.validateTask10sSafeFixture>);
  vi.spyOn(XhsIdentityService.prototype, "establishContextIdentityAttestation").mockResolvedValue({ status: "PASS", attestation: { observedExternalCreatorId: "960803317", browserContextIdentity: "context" } } as Awaited<ReturnType<XhsIdentityService["establishContextIdentityAttestation"]>>);
  vi.spyOn(XhsIdentityService.prototype, "validateContextIdentityAttestation").mockResolvedValue({ valid: true } as Awaited<ReturnType<XhsIdentityService["validateContextIdentityAttestation"]>>);
  vi.spyOn(XhsIdentityService.prototype, "getContextIdentityAttestation").mockReturnValue({ observedExternalCreatorId: "960803317", browserContextIdentity: "context", sourcePageIdentity: "page" } as ReturnType<XhsIdentityService["getContextIdentityAttestation"]>);
  // Check the missing API with an assertion in RED, rather than a TypeError.
  const arm = async () => {
    await service.inspectCurrentXiaohongshuClosedShadowFinalSubmit();
    const method = (service as unknown as { armTask10sFreshCompletion?: () => Promise<{ status: string; failureCode: string | null; jobId?: string }> }).armTask10sFreshCompletion;
    expect(method, "Main trusted ARM transition must exist").toBeTypeOf("function");
    return method!.call(service);
  };
  return { repo, service, proof, runtime, forbidden, arm, options, adapter };
}

describe("r41 fresh prepared job transition (offline)", () => {
  it("r42 accepts the scoped generic resolver false negative when closed-shadow proof passes", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    await f.service.runTask10sFreshPublishFlow();
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit();
    expect(await f.arm()).toMatchObject({ status: "PASS", finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 });
    expect(f.repo.listJobs()).toHaveLength(1);
    expect(f.repo.getPublishRecords()).toHaveLength(1);
  });
  it("requires a closed-shadow PASS before substituting the generic resolver failure", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    await f.service.runTask10sFreshPublishFlow();
    expect(await f.service.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("rejects a closed-shadow diagnostic that is not PASS", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    f.adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit = async () => ({ ...closedShadowPass(), inspectionStatus: "FAIL", failureCode: "CDP_DOM_DOCUMENT_UNAVAILABLE" });
    await f.service.runTask10sFreshPublishFlow();
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit();
    expect(await f.service.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE" });
  });
  it("rejects any generic resolver failure outside the scoped NOT_FOUND false negative", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_AMBIGUOUS";
    f.proof.finalSubmit = { status: "AMBIGUOUS", visible: true, enabled: true, hitTestValid: true, label: "发布" };
    await f.service.runTask10sFreshPublishFlow();
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit();
    expect(await f.service.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE" });
  });
  it("requires closed-shadow evidence from the same context and page", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    f.adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit = async () => ({ ...closedShadowPass(), contextDebugId: "other-context" });
    await f.service.runTask10sFreshPublishFlow();
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit();
    expect(await f.service.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it.each(["host-count", "native-count", "host-role", "submit-text", "submit-disabled", "submit-loading", "aria-disabled", "aria-busy"])("rejects a closed-shadow proof with an invalid %s signal", async (signal) => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    const diagnostic = closedShadowPass();
    if (signal === "host-count") diagnostic.piercedXhsPublishBtnCount = 0;
    if (signal === "native-count") diagnostic.exactPublishNativeButtonCount = 0;
    if (signal === "host-role") diagnostic.hostIsPublish = "false";
    if (signal === "submit-text") diagnostic.hostSubmitText = "保存草稿";
    if (signal === "submit-disabled") diagnostic.hostSubmitDisabled = "true";
    if (signal === "submit-loading") diagnostic.hostSubmitLoading = "true";
    if (signal === "aria-disabled") diagnostic.buttonAriaDisabled = "true";
    if (signal === "aria-busy") diagnostic.buttonAriaBusy = "true";
    f.adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit = async () => diagnostic;
    await f.service.runTask10sFreshPublishFlow();
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit();
    expect(await f.service.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("keeps the missing prepared job guard after successful fresh content evidence", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    expect(await f.service.runTask10sCompleteRetainedEditor()).toMatchObject({ failureCode: "TASK10S_RETAINED_EDITOR_PREPARED_JOB_MISSING" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("arms exactly one durable Prepared job with fresh content and leaves authorization unused", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    const authorization = f.repo.getOneShotPublicationAuthorization(runId);
    expect(await f.arm()).toMatchObject({ status: "PASS", finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 });
    const jobs = f.repo.listJobs(); expect(jobs).toHaveLength(1);
    expect(f.repo.getPlatformSelfTestRun(runId)?.publishJobId).toBe(jobs[0]!.id);
    expect(f.repo.getPublishRecords()).toHaveLength(1);
    expect(f.repo.getPublishRecordByJob(jobs[0]!.id)?.status).toBe("Prepared");
    expect(f.repo.getArticle(jobs[0]!.articleId)).toMatchObject({ title: "自动化发布测试1｜请忽略", body: "GEO Media Publisher 自动发布链路测试。" });
    expect(f.repo.getOneShotPublicationAuthorization(runId)).toEqual(authorization);
    expect(f.forbidden).not.toHaveBeenCalled();
    f.runtime.browserConnected = false;
    expect(await f.service.runTask10sCompleteRetainedEditor()).toMatchObject({ failureCode: "TASK10S_RETAINED_EDITOR_RUNTIME_UNAVAILABLE" });
  });
  it("resolves retained-editor content from the current Prepared Job Article", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(); await f.arm();
    const result = await f.service.runTask10sCompleteRetainedEditor();
    expect(result.failureCode).not.toBe("TASK10S_RETAINED_EDITOR_FIXED_CONTENT_MISMATCH");
    expect(f.forbidden).toHaveBeenCalledTimes(1);
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED");
  });
  it.each(["missing-id", "missing-article"]) ("fails closed when the Prepared Job Article is %s", async (kind) => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(); await f.arm();
    const job = f.repo.listJobs()[0]!;
    f.repo.db.pragma("foreign_keys = OFF");
    f.repo.db.prepare("UPDATE publish_jobs SET article_id=? WHERE id=?").run(kind === "missing-id" ? "" : "article-does-not-exist", job.id);
    f.repo.db.pragma("foreign_keys = ON");
    const result = await f.service.runTask10sCompleteRetainedEditor();
    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_RETAINED_EDITOR_ARTICLE_BINDING_INVALID" });
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it("fails closed when the Prepared PublishRecord is bound to a different Article", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(); await f.arm();
    const job = f.repo.listJobs()[0]!;
    f.repo.db.pragma("foreign_keys = OFF");
    f.repo.db.prepare("UPDATE publish_records SET article_id=? WHERE job_id=?").run("article-does-not-exist", job.id);
    f.repo.db.pragma("foreign_keys = ON");
    const result = await f.service.runTask10sCompleteRetainedEditor();
    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_RETAINED_EDITOR_ARTICLE_BINDING_INVALID" });
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it.each(["missing", "used", "account", "platform", "operation", "counter", "run-account"])("fails closed for authorization/run binding: %s", async (kind) => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    if (kind === "missing") f.repo.db.prepare("DELETE FROM one_shot_publication_authorizations").run();
    else if (kind === "run-account") {
      const other = f.repo.createAccount({ platformKey: "xiaohongshu", name: "other" });
      f.repo.db.prepare("UPDATE platform_self_test_runs SET platform_account_id=?").run(other.platformAccountId ?? other.id);
    }
    else if (kind === "account") {
      const other = f.repo.createAccount({ platformKey: "xiaohongshu", name: "other" });
      f.repo.db.prepare("UPDATE one_shot_publication_authorizations SET account_id=?").run(other.id);
    }
    else {
      const assignments: Record<string, string> = { used: "state='CONSUMED'", account: "account_id='other'", platform: "platform_key='other'", operation: "operation_id='other'", counter: "final_submit_attempt_count=1" };
      f.repo.db.prepare(`UPDATE one_shot_publication_authorizations SET ${assignments[kind]}`).run();
    }
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" });
    expect(f.repo.listJobs()).toHaveLength(0); expect(f.repo.getPublishRecords()).toHaveLength(0);
  });
  it.each(["upload", "editor", "title", "body", "context", "safety"])("does not create a job for incomplete fresh evidence: %s", async (kind) => {
    const f = setup();
    if (kind === "upload") f.proof.uploadMutationCount = 0;
    if (kind === "editor") f.proof.states = [];
    if (kind === "title") f.proof.titleReadbackVerified = false;
    if (kind === "body") f.proof.bodyReadbackVerified = false;
    if (kind === "context") f.proof.sameContext = false;
    if (kind === "safety") f.proof.forbiddenMutationObserved = true;
    await f.service.runTask10sFreshPublishFlow();
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" }); expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("rejects an existing unrelated job and repeated ARM without duplicate rows", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    await f.arm(); const counts = f.repo.getPublishDomainCounts();
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" });
    expect(f.repo.getPublishDomainCounts()).toEqual(counts);
  });
  it("never reuses a historical article/job already linked to the run", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    const job = f.repo.createPlatformSelfTestPublishJob({ testRunId: runId, title: "old", body: "old", dryRun: false });
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" });
    expect(f.repo.listJobs()).toHaveLength(1); expect(f.repo.getArticle(job.articleId)?.title).toBe("old");
    expect(f.repo.getPublishRecords()).toHaveLength(0);
  });
  it("rolls back article, job and run linkage when Prepared persistence fails", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    const before = f.repo.listArticles().length;
    vi.spyOn(f.repo, "insertPublishRecord").mockImplementation(() => { throw new Error("offline disk failure"); });
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" });
    expect(f.repo.listJobs()).toHaveLength(0); expect(f.repo.listArticles()).toHaveLength(before);
    expect(f.repo.getPlatformSelfTestRun(runId)?.publishJobId).toBeNull();
  });
  it("rejects runtime replacement after evidence collection", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(); f.runtime.canonicalPageDebugId = "replacement";
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" }); expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("rejects missing evidence after a Main restart without creating another authorization", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    const restarted = new PlatformSelfTestService(f.options);
    const authorization = f.repo.getOneShotPublicationAuthorization(runId);
    expect(await restarted.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE" });
    expect(f.repo.listJobs()).toHaveLength(0);
    expect(f.repo.getOneShotPublicationAuthorization(runId)).toEqual(authorization);
  });
  it("persists prepared linkage across a new service instance and still blocks repeat ARM", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(); await f.arm();
    const restarted = new PlatformSelfTestService(f.options);
    expect(await restarted.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_JOB_ALREADY_EXISTS" });
    expect(f.repo.listJobs()).toHaveLength(1); expect(f.repo.getPublishRecords()).toHaveLength(1);
  });
  it("invalidates previous ready evidence when a subsequent fresh flow fails", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    f.runtime.browserConnected = false;
    await f.service.runTask10sFreshPublishFlow();
    f.runtime.browserConnected = true;
    expect(await f.arm()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_ARM_EVIDENCE_INCOMPLETE" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("dispatches ARM to persistence and stops without calling completion", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow();
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit();
    const completion = vi.spyOn(f.service, "runTask10sCompleteRetainedEditor");
    const write = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn(), armTask10sFreshCompletion: () => f.service.armTask10sFreshCompletion(), writeTask10sFreshCompletionArmEvidence: write, runTask10sCompleteRetainedEditor: () => f.service.runTask10sCompleteRetainedEditor(), writeTask10sCompleteRetainedEditorEvidence: vi.fn() });
    const action = parseDiagnosticAction(["app.exe", "--xhs-task10s-arm-fresh-completion"]);
    expect(action).not.toBeNull();
    expect(await runner(action!)).toBe(true);
    expect(f.repo.getPublishRecords()[0]?.status).toBe("Prepared");
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ status: "PASS", finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 }));
    expect(completion).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it("accepts only the fixed no-argument ARM action", () => {
    expect(parseDiagnosticAction(["app.exe", "--xhs-task10s-arm-fresh-completion"])).toBe("TASK10S_FRESH_COMPLETION_ARM");
    expect(parseDiagnosticAction(["app.exe", "--xhs-task10s-arm-fresh-completion", "job-id"])).toBeNull();
  });
});
