import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import { createOwnerAuthorizedOneShotPublication, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type AdapterRegistry, type PublishFlowExplorationResult } from "@publisher/adapters-core";
import type { XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
const XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID = "historical-test-account";
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

function setup(config: { withAuthorization?: boolean; requestedRunId?: string } = {}) {
  const requestedRunId = config.requestedRunId ?? runId;
  const dir = mkdtempSync(join(tmpdir(), "task10s-r41-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const fixtureBytes = Buffer.from("offline fixture");
  const fixturePath = join(dir, "task10s-safe-test.png");
  writeFileSync(fixturePath, fixtureBytes);
  const fixtureSha = createHash("sha256").update(fixtureBytes).digest("hex").toUpperCase();
  const database = openDatabase(join(dir, "test.db"), join(process.cwd(), "packages/db/migrations"));
  cleanup.push(() => database.db.close());
  const repo = database.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = repo.createAccount({ platformKey: "xiaohongshu", name: "offline test" });
  repo.db.prepare("UPDATE accounts SET id=? WHERE id=?").run(accountId, account.id);
  repo.updateAccount(accountId, { enabled: true, loginStatus: "logged_in" });
  repo.db.prepare("UPDATE accounts SET external_account_id=? WHERE id=?").run("960803317", accountId);
  repo.bindPlatformAccountIdentity({ platformKey: "xiaohongshu", accountId, externalCreatorId: "960803317", bindingSource: "OWNER_APPROVED_CREATOR_IDENTITY_BINDING" });
  const run = repo.createPlatformSelfTestRun({ platformAccountId: accountId, requestedLevel: "L5_PUBLISH" });
  repo.db.prepare("UPDATE platform_self_test_runs SET test_run_id=? WHERE test_run_id=?").run(requestedRunId, run.testRunId);
  if (config.withAuthorization === true) repo.confirmPlatformSelfTestOneShotAtomically(requestedRunId, createOwnerAuthorizedOneShotPublication({ accountId, platformKey: "xiaohongshu", operationId: requestedRunId, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }));
  const proof = exploration();
  const runtime = { platformKey: "xiaohongshu", accountId, sessionExists: true, browserConnected: true, contextExists: true, canonicalPageExists: true, canonicalPageClosed: false, runtimeAuthState: "AUTHENTICATED", browserSessionIdentity: "session", contextDebugId: "context", canonicalPageDebugId: "page" };
  const forbidden = vi.fn(() => { throw new Error("OFFLINE_PUBLICATION_BOUNDARY"); });
  let recoveredEditor = false;
  const contextPages = () => ({ platformKey: "xiaohongshu" as const, accountId, inventoryStatus: "PASS" as const, failureCode: null, contextDebugId: "context", runtimeAuthState: "AUTHENTICATED" as const, browserConnected: true, pageCount: recoveredEditor ? 1 : 0, canonicalPageId: "page", pages: recoveredEditor ? [{ pageIndex: 0, pageId: "page", isCanonical: true, isClosed: false, urlOrigin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", source: null, from: null, target: null, documentReadyState: "complete" as const, titleSafe: "发布", openerPresent: false, openerPageIdIfSameContext: null, frameCount: 0, visibilityState: "visible" as const, editorShellPresent: true, uploadImageTabPresent: true, currentSelectedTab: "上传图文" as const, imageUploadControlPresent: true, titleControlPresent: true, bodyControlPresent: true, finalSubmitControlPresent: true, contentType: "IMAGE_POST" as const, imageEditorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR" as const }] : [], pageCreationEvents: [] });
  const postUpload = { inspectionStatus: "PASS", failureCode: null, accountId, contextDebugId: "context", pageId: "page", sessionExists: true, browserConnected: true, contextExists: true, pageExists: true, pageClosed: false, pageContextMatchesSession: true, origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", readyState: "complete", editorRegionPresent: true, imageItems: [{}], visibleImageItemCount: 1, imageCounterTextSafe: "1/18", addImageControlPresent: true, deleteImageControlCount: 1, titleControlMatchCount: 1, titleControlVisible: true, bodyControlMatchCount: 1, bodyControlVisible: true, finalSubmitCandidateCount: 1, finalSubmitVisibleCount: 1, finalSubmitProof: "PASS", explicitUploadErrorSignals: [], processingSignalPresent: false, imageUploadReconciliation: "PASS", postUploadState: "EDITOR_READY", imageAssetRenderedCount: 1, postUploadImageEditorPresent: true, titleControlPresent: true, bodyControlPresent: true, noExplicitUploadError: true, source: null, from: null, target: null, sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish" } as const;
  const adapter = { connectAccount: forbidden, checkSession: forbidden, preparePublish: forbidden, finalSubmit: forbidden, automationType: "BrowserAutomation", getBrowserRuntimeSnapshot: () => runtime, getBrowserSessionEvidence: async () => ({ pageUrl: "https://creator.xiaohongshu.com/new/home" }), inspectCurrentXiaohongshuClosedShadowFinalSubmit: async () => closedShadowPass(), inspectXhsContextPages: async () => contextPages(), inspectCurrentXiaohongshuPostUploadReconciliation: async () => postUpload, recoverPreparedEditor: vi.fn(async (_context: unknown, input: { operationId: string }) => { recoveredEditor = true; return { ...proof, operationId: input.operationId }; }), runPublishFlowExploration: async (_context: unknown, input: { operationId: string }) => ({ ...proof, operationId: input.operationId }) };
  const registry = { getForContent: () => adapter } as unknown as AdapterRegistry;
  const publisher = { executeJob: forbidden, executeTask10sRetainedEditor: forbidden } as unknown as PublisherService;
  const serviceOptions = { repository: repo, registry, publisher, resolveAccountSecrets: () => ({}) };
  const service = new PlatformSelfTestService(serviceOptions);
  vi.spyOn(attempt, "validateTask10sSafeFixture").mockReturnValue({
    path: fixturePath,
    exists: true,
    fileName: "task10s-safe-test.png",
    sizeBytes: fixtureBytes.length,
    sha256: fixtureSha,
    expectedName: "task10s-safe-test.png",
    expectedSizeBytes: fixtureBytes.length,
    expectedSha256: fixtureSha,
    valid: true,
    failureCode: null,
  } as ReturnType<typeof attempt.validateTask10sSafeFixture>);
  vi.spyOn(XhsIdentityService.prototype, "establishContextIdentityAttestation").mockResolvedValue({ status: "PASS", attestation: { observedExternalCreatorId: "960803317", browserContextIdentity: "context" } } as Awaited<ReturnType<XhsIdentityService["establishContextIdentityAttestation"]>>);
  vi.spyOn(XhsIdentityService.prototype, "ensureCurrentContextIdentityPage").mockResolvedValue({ status: "PASS", attestation: { observedExternalCreatorId: "960803317", browserContextIdentity: "context", sourcePageIdentity: "page" } } as Awaited<ReturnType<XhsIdentityService["ensureCurrentContextIdentityPage"]>>);
  vi.spyOn(XhsIdentityService.prototype, "validateContextIdentityAttestation").mockResolvedValue({ valid: true } as Awaited<ReturnType<XhsIdentityService["validateContextIdentityAttestation"]>>);
  vi.spyOn(XhsIdentityService.prototype, "getContextIdentityAttestation").mockReturnValue({ observedExternalCreatorId: "960803317", browserContextIdentity: "context", sourcePageIdentity: "page" } as ReturnType<XhsIdentityService["getContextIdentityAttestation"]>);
  vi.spyOn(XhsIdentityService.prototype, "verifyCreatorIdentity").mockResolvedValue({ expectedExternalCreatorId: "960803317", observed: { externalCreatorId: "960803317", displayName: null, profileUrl: null, source: "CREATOR_ACCOUNT_SURFACE", stable: true }, verified: true, mismatch: false, canonicalContextId: "context", canonicalPageId: "page", canonicalPageUrl: "https://creator.xiaohongshu.com/new/home", domLocationHref: "https://creator.xiaohongshu.com/new/home", pageUrlConsistency: "PASS", routeClass: "CREATOR_HOME" } as Awaited<ReturnType<XhsIdentityService["verifyCreatorIdentity"]>>);
  // Check the missing API with an assertion in RED, rather than a TypeError.
  const arm = async () => {
    await service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    return service.armTask10sRun(requestedRunId);
  };
  return { repo, service, proof, runtime, forbidden, arm, options: serviceOptions, adapter, contextPages, postUpload, fixturePath, fixtureSha, requestedRunId };
}

function createHistoricalRun(f: ReturnType<typeof setup>, testRunId: string): string {
  const run = f.repo.createPlatformSelfTestRun({ platformAccountId: accountId, requestedLevel: "L5_PUBLISH" });
  f.repo.db.prepare("UPDATE platform_self_test_runs SET test_run_id=? WHERE test_run_id=?").run(testRunId, run.testRunId);
  return testRunId;
}

function createAuthorization(f: ReturnType<typeof setup>, operationId: string, state: "AUTHORIZED_UNUSED" | "SUPERSEDED_UNUSED" = "AUTHORIZED_UNUSED") {
  return f.repo.createOneShotPublicationAuthorization({
    ...createOwnerAuthorizedOneShotPublication({ accountId, platformKey: "xiaohongshu", operationId, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }),
    state
  });
}

describe("r41 fresh prepared job transition (offline)", () => {
  it("r42 accepts the scoped generic resolver false negative when closed-shadow proof passes", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
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
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("rejects a closed-shadow diagnostic that is not PASS", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    f.adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit = async () => ({ ...closedShadowPass(), inspectionStatus: "FAIL", failureCode: "CDP_DOM_DOCUMENT_UNAVAILABLE" });
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" });
  });
  it("rejects any generic resolver failure outside the scoped NOT_FOUND false negative", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_AMBIGUOUS";
    f.proof.finalSubmit = { status: "AMBIGUOUS", visible: true, enabled: true, hitTestValid: true, label: "发布" };
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" });
  });
  it("requires closed-shadow evidence from the same context and page", async () => {
    const f = setup();
    f.proof.status = "BLOCKED";
    f.proof.readyForFinalSubmit = false;
    f.proof.failureCode = "FINAL_SUBMIT_CONTROL_NOT_FOUND";
    f.proof.finalSubmit = { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    f.adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit = async () => ({ ...closedShadowPass(), contextDebugId: "other-context" });
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" });
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
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("keeps the missing prepared job guard after successful fresh content evidence", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    expect(await f.service.runTask10sCompleteRetainedEditor()).toMatchObject({ failureCode: "TASK10S_RETAINED_EDITOR_PREPARED_JOB_MISSING" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("arms exactly one durable Prepared job with fresh content and leaves authorization unused", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    expect(await f.arm()).toMatchObject({ status: "PASS", finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 });
    const jobs = f.repo.listJobs(); expect(jobs).toHaveLength(1);
    expect(f.repo.getPlatformSelfTestRun(runId)?.publishJobId).toBe(jobs[0]!.id);
    expect(f.repo.getPublishRecords()).toHaveLength(1);
    expect(f.repo.getPublishRecordByJob(jobs[0]!.id)?.status).toBe("Prepared");
    expect(jobs[0]!.selectedImageAssetId, "Task10S ARM must persist its Job-bound ImageAsset").toBeTruthy();
    expect(f.repo.getPublishRecordByJob(jobs[0]!.id)?.selectedImageAssetId).toBe(jobs[0]!.selectedImageAssetId);
    expect(f.repo.getArticle(jobs[0]!.articleId)).toMatchObject({ title: "自动化发布测试1｜请忽略", body: "GEO Media Publisher 自动发布链路测试。" });
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED");
    expect(f.forbidden).not.toHaveBeenCalled();
    f.runtime.browserConnected = false;
    expect(await f.service.runTask10sCompleteRetainedEditor()).toMatchObject({ failureCode: "TASK10S_RETAINED_EDITOR_RUNTIME_UNAVAILABLE" });
  });
  it("recovers the existing Prepared Job editor without creating rows or publishing", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); await f.arm();
    const before = f.repo.getPublishDomainCounts();
    const result = await f.service.recoverTask10sPreparedEditor();
    expect(result).toMatchObject({ status: "PASS", readyForFreshIdentityAttestation: true, finalSubmitClickCount: 0, mousePressedCount: 0, mouseReleasedCount: 0, publicationTransactionCount: 0 });
    expect(f.adapter.recoverPreparedEditor).toHaveBeenCalledTimes(1);
    expect(f.repo.getPublishDomainCounts()).toEqual(before);
    expect(f.repo.listJobs()).toHaveLength(1);
    expect(f.repo.getPublishRecords()).toHaveLength(1);
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED");
  });
  it("blocks ARM when the verified fixture hash does not match the file", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    vi.spyOn(attempt, "validateTask10sSafeFixture").mockReturnValue({
      path: f.fixturePath,
      exists: true,
      fileName: "task10s-safe-test.png",
      sizeBytes: 15,
      sha256: f.fixtureSha,
      expectedName: "task10s-safe-test.png",
      expectedSizeBytes: 15,
      expectedSha256: "00".repeat(32),
      valid: true,
      failureCode: null,
    } as unknown as ReturnType<typeof attempt.validateTask10sSafeFixture>);
    expect(await f.arm()).toMatchObject({ status: "BLOCKED", failureCode: "IMAGE_ASSET_HASH_MISMATCH", preparedJobMediaGate: "BLOCKED" });
    expect(f.repo.listJobs()).toHaveLength(0);
    expect(f.repo.getPublishRecords()).toHaveLength(0);
  });
  it.each(["null-binding", "missing-file", "hash-mismatch"])("fails closed during recovery for a Job media binding: %s", async (kind) => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); await f.arm();
    const job = f.repo.listJobs()[0]!;
    if (kind === "null-binding") f.repo.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=NULL WHERE id=?").run(job.id);
    if (kind === "missing-file") rmSync(f.fixturePath, { force: true });
    if (kind === "hash-mismatch") writeFileSync(f.fixturePath, Buffer.alloc(15, 3));
    const before = f.repo.getPublishDomainCounts();
    const result = await f.service.recoverTask10sPreparedEditor();
    expect(result.status).toBe("BLOCKED");
    expect(result.failureCode).toBe(kind === "null-binding" ? "JOB_IMAGE_ASSET_MISSING" : kind === "missing-file" ? "IMAGE_ASSET_FILE_MISSING" : "IMAGE_ASSET_HASH_MISMATCH");
    expect(f.repo.getPublishDomainCounts()).toEqual(before);
    expect(f.adapter.recoverPreparedEditor).toHaveBeenCalledTimes(0);
  });
  it("does not revive or retry a terminal Failed Job", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); await f.arm();
    const job = f.repo.listJobs()[0]!;
    f.repo.db.prepare("UPDATE publish_jobs SET status='Failed',last_error_code='CONTENT_REJECTED' WHERE id=?").run(job.id);
    const before = f.repo.getJob(job.id);
    expect(await f.arm()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_JOB_ALREADY_EXISTS" });
    expect(f.repo.getJob(job.id)).toMatchObject({ status: "Failed", lastErrorCode: "CONTENT_REJECTED", selectedImageAssetId: before?.selectedImageAssetId });
    expect(await f.service.recoverTask10sPreparedEditor()).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_JOB_STATUS_NOT_ELIGIBLE" });
    expect(f.adapter.recoverPreparedEditor).toHaveBeenCalledTimes(0);
  });
  it("resolves retained-editor content from the current Prepared Job Article", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); await f.arm();
    const result = await f.service.runTask10sCompleteRetainedEditor();
    expect(result.failureCode).not.toBe("TASK10S_RETAINED_EDITOR_FIXED_CONTENT_MISMATCH");
    expect(f.forbidden).toHaveBeenCalledTimes(1);
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED");
  });
  it.each(["missing-id", "missing-article"]) ("fails closed when the Prepared Job Article is %s", async (kind) => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); await f.arm();
    const job = f.repo.listJobs()[0]!;
    f.repo.db.pragma("foreign_keys = OFF");
    f.repo.db.prepare("UPDATE publish_jobs SET article_id=? WHERE id=?").run(kind === "missing-id" ? "" : "article-does-not-exist", job.id);
    f.repo.db.pragma("foreign_keys = ON");
    const result = await f.service.runTask10sCompleteRetainedEditor();
    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_RETAINED_EDITOR_ARTICLE_BINDING_INVALID" });
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it("fails closed when the Prepared PublishRecord is bound to a different Article", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); await f.arm();
    const job = f.repo.listJobs()[0]!;
    f.repo.db.pragma("foreign_keys = OFF");
    f.repo.db.prepare("UPDATE publish_records SET article_id=? WHERE job_id=?").run("article-does-not-exist", job.id);
    f.repo.db.pragma("foreign_keys = ON");
    const result = await f.service.runTask10sCompleteRetainedEditor();
    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_RETAINED_EDITOR_ARTICLE_BINDING_INVALID" });
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it.each(["used", "account", "platform", "operation", "counter", "run-account"])("fails closed for authorization/run binding: %s", async (kind) => {
    const f = setup({ withAuthorization: true }); await f.service.runTask10sFreshPublishFlow(accountId, runId);
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
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" }); expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("rejects an existing unrelated job and repeated ARM without duplicate rows", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.arm(); const counts = f.repo.getPublishDomainCounts();
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" });
    expect(f.repo.getPublishDomainCounts()).toEqual(counts);
  });
  it("never reuses a historical article/job already linked to the run", async () => {
    const f = setup({ withAuthorization: true }); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    const job = f.repo.createPlatformSelfTestPublishJob({ testRunId: runId, title: "old", body: "old", dryRun: false });
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" });
    expect(f.repo.listJobs()).toHaveLength(1); expect(f.repo.getArticle(job.articleId)?.title).toBe("old");
    expect(f.repo.getPublishRecords()).toHaveLength(0);
  });
  it("rolls back article, job and run linkage when Prepared persistence fails", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    const before = f.repo.listArticles().length;
    vi.spyOn(f.repo, "insertPublishRecord").mockImplementation(() => { throw new Error("offline disk failure"); });
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" });
    expect(f.repo.listJobs()).toHaveLength(0); expect(f.repo.listArticles()).toHaveLength(before);
    expect(f.repo.getPlatformSelfTestRun(runId)?.publishJobId).toBeNull();
  });
  it("rejects runtime replacement after evidence collection", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); f.runtime.canonicalPageDebugId = "replacement";
    expect(await f.arm()).toMatchObject({ status: "BLOCKED" }); expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("rejects missing evidence after a Main restart without creating another authorization", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    const restarted = new PlatformSelfTestService(f.options);
    const authorization = f.repo.getOneShotPublicationAuthorization(runId);
    expect(await restarted.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_SAME_RUN_EVIDENCE_MISMATCH" });
    expect(f.repo.listJobs()).toHaveLength(0);
    expect(f.repo.getOneShotPublicationAuthorization(runId)).toEqual(authorization);
  });
  it("persists prepared linkage across a new service instance and still blocks repeat ARM", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); await f.arm();
    const restarted = new PlatformSelfTestService(f.options);
    expect(await restarted.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_JOB_ALREADY_EXISTS" });
    expect(f.repo.listJobs()).toHaveLength(1); expect(f.repo.getPublishRecords()).toHaveLength(1);
  });
  it("invalidates previous ready evidence when a subsequent fresh flow fails", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    f.runtime.browserConnected = false;
    await f.service.runTask10sFreshPublishFlow(accountId, runId);
    f.runtime.browserConnected = true;
    expect(await f.arm()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_SAME_RUN_EVIDENCE_MISMATCH" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });
  it("dispatches ARM to persistence and stops without calling completion", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    const completion = vi.spyOn(f.service, "runTask10sCompleteRetainedEditor");
    const write = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn(), armTask10sRun: (testRunId) => f.service.armTask10sRun(testRunId), writeTask10sArmRunEvidence: write, runTask10sCompleteRetainedEditor: () => f.service.runTask10sCompleteRetainedEditor(), writeTask10sCompleteRetainedEditorEvidence: vi.fn() });
    const action = parseDiagnosticAction(["app.exe", "--xhs-task10s-arm-run", runId]);
    expect(action).not.toBeNull();
    expect(await runner(action!, { testRunId: runId })).toBe(true);
    expect(f.repo.getPublishRecords()[0]?.status).toBe("Prepared");
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ status: "PASS", finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 }));
    expect(completion).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it("accepts only the fixed no-argument ARM action", () => {
    expect(parseDiagnosticAction(["app.exe", "--xhs-task10s-arm-fresh-completion"])).toBe("TASK10S_FRESH_COMPLETION_ARM");
    expect(parseDiagnosticAction(["app.exe", "--xhs-task10s-arm-fresh-completion", "job-id"])).toBeNull();
  });
});

describe("r51 explicit ARM-only boundaries (offline)", () => {
  async function ready(f: ReturnType<typeof setup>): Promise<void> {
    await f.service.runTask10sFreshPublishFlow(accountId, f.requestedRunId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
  }

  it("resolves exactly the requested run and creates the first trusted authorization", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r51-run-1" }); await ready(f);
    const result = await f.service.armTask10sRun(f.requestedRunId);
    expect(result).toMatchObject({ status: "PASS", requestedTestRunId: f.requestedRunId, resolvedTestRunId: f.requestedRunId, authorizationState: "AUTHORIZED_UNUSED", armOnly: "YES", completionExecuted: "NO" });
  });
  it("requires an explicit testRunId", async () => { const f = setup({ withAuthorization: false }); expect(await f.service.armTask10sRun()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_TEST_RUN_ID_REQUIRED" }); });
  it("rejects an unknown testRunId without touching publish rows", async () => { const f = setup({ withAuthorization: false }); const before = f.repo.getPublishDomainCounts(); expect(await f.service.armTask10sRun("missing-run")).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_RUN_NOT_FOUND" }); expect(f.repo.getPublishDomainCounts()).toEqual(before); });
  it("rejects a run that already has a publish job", async () => { const f = setup({ withAuthorization: false }); f.repo.db.pragma("foreign_keys = OFF"); f.repo.db.prepare("UPDATE platform_self_test_runs SET publish_job_id=? WHERE test_run_id=?").run("existing-job", runId); f.repo.db.pragma("foreign_keys = ON"); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_JOB_ALREADY_EXISTS" }); });
  it("rejects a run bound to another account", async () => { const f = setup({ withAuthorization: false }); const other = f.repo.createAccount({ platformKey: "xiaohongshu", name: "other" }); f.repo.db.prepare("UPDATE platform_self_test_runs SET platform_account_id=? WHERE test_run_id=?").run(other.platformAccountId ?? other.id, runId); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED" }); });
  it("rejects a current runtime account mismatch", async () => { const f = setup({ withAuthorization: false }); await ready(f); f.runtime.accountId = "other-account"; expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_RUNTIME_BINDING_MISMATCH" }); });
  it("rejects a creator identity that no longer matches the account binding", async () => { const f = setup({ withAuthorization: false }); await ready(f); f.repo.db.prepare("UPDATE accounts SET external_account_id=? WHERE id=?").run("different-creator", accountId); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_ACCOUNT_IDENTITY_BINDING_MISMATCH" }); });
  it("rejects evidence collected for another run", async () => { const f = setup({ withAuthorization: false, requestedRunId: "r51-run-a" }); await ready(f); const other = f.repo.createPlatformSelfTestRun({ platformAccountId: accountId, requestedLevel: "L5_PUBLISH" }); f.repo.db.prepare("UPDATE platform_self_test_runs SET test_run_id=? WHERE test_run_id=?").run("r51-run-b", other.testRunId); expect(await f.service.armTask10sRun("r51-run-b")).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_SAME_RUN_EVIDENCE_MISMATCH" }); });
  it("rejects missing editor readiness evidence", async () => { const f = setup({ withAuthorization: false }); f.proof.states = []; await ready(f); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" }); });
  it("rejects upload retry evidence", async () => { const f = setup({ withAuthorization: false }); f.proof.uploadRetryCount = 1; await ready(f); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" }); });
  it("rejects title readback evidence", async () => { const f = setup({ withAuthorization: false }); f.proof.titleReadbackVerified = false; await ready(f); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" }); });
  it("rejects body readback evidence", async () => { const f = setup({ withAuthorization: false }); f.proof.bodyReadbackVerified = false; await ready(f); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" }); });
  it("rejects a failed closed-shadow surface", async () => { const f = setup({ withAuthorization: false }); await f.service.runTask10sFreshPublishFlow(accountId, runId); f.adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit = async () => ({ ...closedShadowPass(), inspectionStatus: "FAIL", failureCode: "CDP_DOM_DOCUMENT_UNAVAILABLE" }); await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_EVIDENCE_INCOMPLETE" }); });
  it("creates exactly one Article", async () => { const f = setup({ withAuthorization: false }); const before = f.repo.listArticles({ source: "test" }).length; await ready(f); expect((await f.service.armTask10sRun(runId)).status).toBe("PASS"); expect(f.repo.listArticles({ source: "test" })).toHaveLength(before + 1); });
  it("creates exactly one Job and links it to the run", async () => { const f = setup({ withAuthorization: false }); await ready(f); const result = await f.service.armTask10sRun(runId); expect(f.repo.listJobs()).toHaveLength(1); expect(f.repo.getPlatformSelfTestRun(runId)?.publishJobId).toBe(result.jobId); });
  it("creates exactly one Prepared PublishRecord", async () => { const f = setup({ withAuthorization: false }); await ready(f); const result = await f.service.armTask10sRun(runId); expect(f.repo.getPublishRecords()).toHaveLength(1); expect(f.repo.getPublishRecordByJob(result.jobId!)).toMatchObject({ status: "Prepared", selectedImageAssetId: expect.any(String) }); });
  it("persists the real r46 ImageAsset binding", async () => { const f = setup({ withAuthorization: false }); await ready(f); const result = await f.service.armTask10sRun(runId); const job = f.repo.getJob(result.jobId!); expect(job?.selectedImageAssetId).toBeTruthy(); expect(f.repo.getImageAsset(job!.selectedImageAssetId!)).toBeTruthy(); });
  it("keeps authorization unused after ARM", async () => { const f = setup({ withAuthorization: false }); await ready(f); await f.service.armTask10sRun(runId); expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED"); });
  it("does not execute completion or publisher code", async () => { const f = setup({ withAuthorization: false }); await ready(f); const completion = vi.spyOn(f.service, "runTask10sCompleteRetainedEditor"); await f.service.armTask10sRun(runId); expect(completion).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled(); });
  it("leaves all submit and publication counters at zero", async () => { const f = setup({ withAuthorization: false }); await ready(f); expect(await f.service.armTask10sRun(runId)).toMatchObject({ finalSubmitClickCount: 0, mousePressedCount: 0, publicationTransactionCount: 0 }); });
  it("rejects a second ARM for the same run without duplicate rows", async () => { const f = setup({ withAuthorization: false }); await ready(f); await f.service.armTask10sRun(runId); const counts = f.repo.getPublishDomainCounts(); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_JOB_ALREADY_EXISTS" }); expect(f.repo.getPublishDomainCounts()).toEqual(counts); });
  it("does not arm an alternate run when run A evidence is selected", async () => { const f = setup({ withAuthorization: false, requestedRunId: "r51-run-a" }); await ready(f); const other = f.repo.createPlatformSelfTestRun({ platformAccountId: accountId, requestedLevel: "L5_PUBLISH" }); f.repo.db.prepare("UPDATE platform_self_test_runs SET test_run_id=? WHERE test_run_id=?").run("r51-run-b", other.testRunId); expect(await f.service.armTask10sRun("r51-run-b")).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_SAME_RUN_EVIDENCE_MISMATCH" }); expect(f.repo.listJobs()).toHaveLength(0); });
  it("keeps the old no-argument action fail-closed", async () => { const f = setup({ withAuthorization: false }); expect(await f.service.armTask10sFreshCompletion()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_TEST_RUN_ID_REQUIRED" }); expect(f.repo.listJobs()).toHaveLength(0); });
  it("does not create an authorization when evidence validation fails", async () => { const f = setup({ withAuthorization: false }); f.proof.forbiddenMutationObserved = true; await ready(f); expect(await f.service.armTask10sRun(runId)).toMatchObject({ status: "BLOCKED" }); expect(f.repo.getOneShotPublicationAuthorization(runId)).toBeNull(); });
});

describe("r52 parameterized fresh-flow run routing", () => {
  it("binds fresh-flow evidence to the explicit requested run", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r52-run-a" });
    const result = await f.service.runTask10sFreshPublishFlow(accountId, f.requestedRunId);

    expect(result.testRunId).toBe(f.requestedRunId);
    expect(result.accountId).toBe(accountId);
  });

  it("fails before browser exploration when the requested run already has a Job", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r52-run-with-job" });
    f.repo.db.prepare("UPDATE platform_self_test_runs SET publish_confirmed_at=? WHERE test_run_id=?").run(new Date().toISOString(), f.requestedRunId);
    f.repo.createPlatformSelfTestPublishJob({ testRunId: f.requestedRunId, title: "existing", body: "existing", dryRun: false });
    const exploration = vi.spyOn(f.adapter, "runPublishFlowExploration");

    const result = await f.service.runTask10sFreshPublishFlow(accountId, f.requestedRunId);

    expect(result).toMatchObject({ status: "BLOCKED", testRunId: f.requestedRunId, failureCode: "TASK10S_FRESH_RUN_JOB_ALREADY_EXISTS" });
    expect(exploration).not.toHaveBeenCalled();
  });

  it("fails closed when the current BrowserSession belongs to another account", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r52-run-runtime-account" });
    f.runtime.accountId = "different-account";
    const exploration = vi.spyOn(f.adapter, "runPublishFlowExploration");

    const result = await f.service.runTask10sFreshPublishFlow(accountId, f.requestedRunId);

    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "XHS_FRESH_PUBLISH_FLOW_ACCOUNT_MISMATCH" });
    expect(exploration).not.toHaveBeenCalled();
  });

  it("fails closed when the attested Creator does not match the Run account binding", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r52-run-creator-mismatch" });
    f.repo.db.prepare("DELETE FROM platform_account_identity_bindings WHERE account_id=?").run(accountId);
    f.repo.db.prepare("UPDATE accounts SET external_account_id=? WHERE id=?").run("different-creator", accountId);
    const exploration = vi.spyOn(f.adapter, "runPublishFlowExploration");

    const result = await f.service.runTask10sFreshPublishFlow(accountId, f.requestedRunId);

    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FRESH_RUN_CREATOR_IDENTITY_MISMATCH" });
    expect(exploration).not.toHaveBeenCalled();
  });

  it("rejects an unknown requested Run without falling back to the canonical Run", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r52-run-known" });
    const exploration = vi.spyOn(f.adapter, "runPublishFlowExploration");

    const result = await f.service.runTask10sFreshPublishFlow(accountId, "r52-run-missing");

    expect(result).toMatchObject({ status: "BLOCKED", testRunId: "r52-run-missing", failureCode: "TASK10S_FRESH_RUN_UNAVAILABLE" });
    expect(exploration).not.toHaveBeenCalled();
  });
});

describe("r54 scoped authorization conflict policy", () => {
  async function ready(f: ReturnType<typeof setup>): Promise<void> {
    await f.service.runTask10sFreshPublishFlow(accountId, f.requestedRunId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
  }

  it("ignores a historical SUPERSEDED_UNUSED authorization", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r54-superseded-current" });
    createHistoricalRun(f, "r54-superseded-history");
    createAuthorization(f, "r54-superseded-history", "SUPERSEDED_UNUSED");
    await ready(f);
    expect(await f.service.armTask10sRun(f.requestedRunId)).toMatchObject({ status: "PASS" });
    expect(f.repo.listJobs()).toHaveLength(1);
  });

  it("ignores AUTHORIZED_UNUSED authorization attached to a Failed Job from another run", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r54-failed-current" });
    const historicalRun = createHistoricalRun(f, "r54-failed-history");
    f.repo.confirmPlatformSelfTestOneShotAtomically(historicalRun, createOwnerAuthorizedOneShotPublication({ accountId, platformKey: "xiaohongshu", operationId: historicalRun, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }));
    const job = f.repo.createPlatformSelfTestPublishJob({ testRunId: historicalRun, title: "failed historical", body: "failed historical", dryRun: false });
    f.repo.db.prepare("UPDATE publish_jobs SET status='Failed',last_error_code='HISTORICAL_FAILURE' WHERE id=?").run(job.id);
    await ready(f);
    expect(await f.service.armTask10sRun(f.requestedRunId)).toMatchObject({ status: "PASS" });
    expect(f.repo.listJobs()).toHaveLength(2);
  });

  it("does not allow a current Run AUTHORIZED_UNUSED authorization to be reused for ARM", async () => {
    const f = setup({ withAuthorization: true, requestedRunId: "r54-current-authorized" });
    await ready(f);
    expect(await f.service.armTask10sRun(f.requestedRunId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_AUTHORIZATION_NOT_UNUSED" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });

  it("blocks a different active Run AUTHORIZED_UNUSED authorization in the same account scope", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r54-active-current" });
    const activeRun = createHistoricalRun(f, "r54-active-other");
    createAuthorization(f, activeRun);
    await ready(f);
    expect(await f.service.armTask10sRun(f.requestedRunId)).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_AUTHORIZATION_NOT_UNUSED" });
    expect(f.repo.listJobs()).toHaveLength(0);
  });

  it("ignores a historical COMPLETION_FAILED authorization", async () => {
    const f = setup({ withAuthorization: false, requestedRunId: "r54-completion-failed-current" });
    const historicalRun = createHistoricalRun(f, "r54-completion-failed-history");
    createAuthorization(f, historicalRun);
    f.repo.db.prepare("UPDATE one_shot_publication_authorizations SET state='COMPLETION_FAILED' WHERE operation_id=?").run(historicalRun);
    await ready(f);
    expect(await f.service.armTask10sRun(f.requestedRunId)).toMatchObject({ status: "PASS" });
  });
});
