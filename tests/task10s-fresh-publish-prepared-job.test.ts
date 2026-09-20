import { createServer, request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { registerIpc } from "../apps/desktop/src/main/ipc";
import { PublisherService as RealPublisher, PersistentScheduler } from "@publisher/publisher";
import { createConsoleLogger } from "@publisher/logger";
import { AdapterRegistry as RuntimeRegistry, type PlatformAdapter, type BrowserPublishAttemptContext } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import type { AccountContext, PublishArticleInput, PublishResult, PlatformSelfTestRun, XhsContextIdentityAttestation } from "@publisher/domain";
import { readXiaohongshuUploadInputImmediately } from "../packages/adapters/xiaohongshu/src/upload-delivery-diagnostic";
const ipc = vi.hoisted(() => ({handlers:new Map<string,(event:unknown,payload:unknown)=>Promise<unknown>>()}));
vi.mock("electron",()=>({ipcMain:{removeHandler:(name:string)=>ipc.handlers.delete(name),handle:(name:string,fn:(event:unknown,payload:unknown)=>Promise<unknown>)=>ipc.handlers.set(name,fn)},app:{getPath:()=>{throw new Error("NO_PRODUCTION_PATHS");},getVersion:()=>"isolated"},dialog:{},shell:{openExternal:()=>{throw new Error("NO_EXTERNAL_LAUNCH");}}}));
vi.mock("../apps/desktop/src/main/ai-batch",async(original)=>({...await original<object>(),resumePersistentBatches:async()=>undefined}));
vi.mock("../apps/desktop/src/main/content-studio",async(original)=>({...await original<object>(),resumeContentStudioTasks:async()=>undefined}));
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import { createOwnerAuthorizedOneShotPublication, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type AdapterRegistry, type PublishFlowExplorationInput, type PublishFlowExplorationResult } from "@publisher/adapters-core";
import type { XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
const XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID = "historical-test-account";
import type { PublisherService } from "@publisher/publisher";
import { PlatformSelfTestService } from "../apps/desktop/src/main/platform-self-test";
import { XhsIdentityService } from "../apps/desktop/src/main/xhs-identity";
import * as attempt from "../apps/desktop/src/main/task10s-attempt3";
import { createFixedDiagnosticRunner, parseDiagnosticAction } from "../apps/desktop/src/main/diagnostic-trigger";

let runId = "";
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
  let requestedRunId = "";
  const dir = mkdtempSync(join(tmpdir(), "task10s-r41-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const fixtureBytes = Buffer.from("offline fixture");
  const fixturePath = join(dir, "task10s-safe-test.png");
  writeFileSync(fixturePath, fixtureBytes);
  const fixtureSha = createHash("sha256").update(fixtureBytes).digest("hex").toUpperCase();
  const database = openDatabase(join(dir, "test.db"), join(process.cwd(), "packages/db/migrations"));
  cleanup.push(() => { if (database.db.open) database.db.close(); });
  const repo = database.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = repo.createAccount({ platformKey: "xiaohongshu", name: "offline test" });
  repo.db.prepare("UPDATE accounts SET id=? WHERE id=?").run(accountId, account.id);
  repo.updateAccount(accountId, { enabled: true, loginStatus: "logged_in" });
  repo.db.prepare("UPDATE accounts SET external_account_id=? WHERE id=?").run("960803317", accountId);
  repo.bindPlatformAccountIdentity({ platformKey: "xiaohongshu", accountId, externalCreatorId: "960803317", bindingSource: "OWNER_APPROVED_CREATOR_IDENTITY_BINDING" });
  const proof = exploration();
  const runtime = { platformKey: "xiaohongshu", accountId, sessionExists: true, browserConnected: true, contextExists: true, canonicalPageExists: true, canonicalPageClosed: false, runtimeAuthState: "AUTHENTICATED", browserSessionIdentity: "session", contextDebugId: "context", canonicalPageDebugId: "page" };
  const forbidden = vi.fn(() => { throw new Error("OFFLINE_PUBLICATION_BOUNDARY"); });
  let recoveredEditor = false;
  const contextPages = () => ({ platformKey: "xiaohongshu" as const, accountId, inventoryStatus: "PASS" as const, failureCode: null, contextDebugId: "context", runtimeAuthState: "AUTHENTICATED" as const, browserConnected: true, pageCount: recoveredEditor ? 1 : 0, canonicalPageId: "page", pages: recoveredEditor ? [{ pageIndex: 0, pageId: "page", isCanonical: true, isClosed: false, urlOrigin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", source: null, from: null, target: null, documentReadyState: "complete" as const, titleSafe: "发布", openerPresent: false, openerPageIdIfSameContext: null, frameCount: 0, visibilityState: "visible" as const, editorShellPresent: true, uploadImageTabPresent: true, currentSelectedTab: "上传图文" as const, imageUploadControlPresent: true, titleControlPresent: true, bodyControlPresent: true, finalSubmitControlPresent: true, contentType: "IMAGE_POST" as const, imageEditorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR" as const }] : [], pageCreationEvents: [] });
  const postUpload = { inspectionStatus: "PASS", failureCode: null, accountId, contextDebugId: "context", pageId: "page", sessionExists: true, browserConnected: true, contextExists: true, pageExists: true, pageClosed: false, pageContextMatchesSession: true, origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", readyState: "complete", editorRegionPresent: true, imageItems: [{}], visibleImageItemCount: 1, imageCounterTextSafe: "1/18", addImageControlPresent: true, deleteImageControlCount: 1, titleControlMatchCount: 1, titleControlVisible: true, bodyControlMatchCount: 1, bodyControlVisible: true, finalSubmitCandidateCount: 1, finalSubmitVisibleCount: 1, finalSubmitProof: "PASS", explicitUploadErrorSignals: [], processingSignalPresent: false, imageUploadReconciliation: "PASS", postUploadState: "EDITOR_READY", imageAssetRenderedCount: 1, postUploadImageEditorPresent: true, titleControlPresent: true, bodyControlPresent: true, noExplicitUploadError: true, source: null, from: null, target: null, sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish" } as const;
  const observedUploads: string[] = [];
  const observe = async (input: PublishFlowExplorationInput) => {
    const bytes = input.boundImages?.[0]?.buffer;
    const actual = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
    if (actual) observedUploads.push(actual);
    return { ...proof, operationId: input.operationId ?? "", evidence: { ...proof.evidence, uploadedImageSha256: actual, titleReadbackValue: input.title, bodyReadbackValue: input.body } };
  };
  const adapter = { supportsBoundImageBuffers: true, getCapabilities: () => ({ ...new TestPlatformAdapter().getCapabilities(), maxImageCount: 1 }), connectAccount: forbidden, checkSession: forbidden, preparePublish: forbidden, finalSubmit: forbidden, automationType: "BrowserAutomation", getBrowserRuntimeSnapshot: () => runtime, getBrowserSessionEvidence: async () => ({ pageUrl: "https://creator.xiaohongshu.com/new/home" }), inspectCurrentXiaohongshuClosedShadowFinalSubmit: async () => closedShadowPass(), inspectXhsContextPages: async () => contextPages(), inspectCurrentXiaohongshuPostUploadReconciliation: async () => postUpload, recoverPreparedEditor: vi.fn(async (_context: unknown, input: PublishFlowExplorationInput) => { recoveredEditor = true; return observe(input); }), runPublishFlowExploration: async (_context: unknown, input: PublishFlowExplorationInput) => observe(input) };
  const registry = { getForContent: () => adapter } as unknown as AdapterRegistry;
  const publisher = { executeJob: forbidden, executeTask10sRetainedEditor: forbidden } as unknown as PublisherService;
  const serviceOptions = { repository: repo, registry, publisher, resolveAccountSecrets: () => ({}) };
  const service = new PlatformSelfTestService(serviceOptions);
  const image = repo.createImageAsset({ brandId: null, name: "explicit ARM image", filePath: fixturePath, originalFileName: "explicit.png", mimeType: "image/png", size: fixtureBytes.length });
  const request = service.requestOneShotPublish(accountId, { platformKey: "xiaohongshu", accountId, creatorId: "960803317", title: "Explicit ARM title", body: "Explicit ARM body", imageAssetId: image.id, imageSha256: fixtureSha });
  requestedRunId = request.testRunId;
  runId = requestedRunId;
  if (config.withAuthorization === true) repo.confirmPlatformSelfTestOneShotAtomically(requestedRunId, { ...createOwnerAuthorizedOneShotPublication({ accountId, platformKey: "xiaohongshu", operationId: requestedRunId, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }), contentBindingId: request.contentBindingId });

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
  return { repo, service, proof, runtime, forbidden, arm, options: serviceOptions, adapter, contextPages, postUpload, fixturePath, fixtureSha, requestedRunId, observedUploads, request, dir };
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
    expect(await f.service.runTask10sCompleteRetainedEditor(runId)).toMatchObject({ failureCode: "RUN_HAS_NO_BOUND_JOB" });
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
    expect(f.repo.getArticle(jobs[0]!.articleId)).toMatchObject({ title: "Explicit ARM title", body: "Explicit ARM body" });
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED");
    expect(f.forbidden).not.toHaveBeenCalled();
    f.runtime.browserConnected = false;
    expect(await f.service.runTask10sCompleteRetainedEditor(runId)).toMatchObject({ failureCode: "TASK10S_RETAINED_EDITOR_RUNTIME_UNAVAILABLE" });
  });
  it("recovers the existing Prepared Job editor without creating rows or publishing", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); expect(await f.arm()).toMatchObject({ status: "PASS" });
    const before = f.repo.getPublishDomainCounts();
    const result = await f.service.recoverTask10sPreparedEditor(runId);
    expect(result).toMatchObject({ status: "PASS", readyForFreshIdentityAttestation: true, finalSubmitClickCount: 0, mousePressedCount: 0, mouseReleasedCount: 0, publicationTransactionCount: 0 });
    expect(f.adapter.recoverPreparedEditor).toHaveBeenCalledTimes(1);
    expect(f.repo.getPublishDomainCounts()).toEqual(before);
    expect(f.repo.listJobs()).toHaveLength(1);
    expect(f.repo.getPublishRecords()).toHaveLength(1);
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED");
  });
  it("blocks ARM when the verified fixture hash does not match the file", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    writeFileSync(f.fixturePath, "replaced bytes after snapshot");
    expect(await f.arm()).toMatchObject({ status: "BLOCKED", failureCode: "CONTENT_SOURCE_BYTES_CHANGED", preparedJobMediaGate: "BLOCKED" });
    expect(f.repo.listJobs()).toHaveLength(0);
    expect(f.repo.getPublishRecords()).toHaveLength(0);
  });
  it.each(["null-binding", "missing-file", "hash-mismatch"])("fails closed during recovery for a Job media binding: %s", async (kind) => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); expect(await f.arm()).toMatchObject({ status: "PASS" });
    const job = f.repo.listJobs()[0]!;
    if (kind === "null-binding") f.repo.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=NULL WHERE id=?").run(job.id);
    if (kind === "missing-file") rmSync(f.fixturePath, { force: true });
    if (kind === "hash-mismatch") writeFileSync(f.fixturePath, Buffer.alloc(15, 3));
    const before = f.repo.getPublishDomainCounts();
    const result = await f.service.recoverTask10sPreparedEditor(runId);
    expect(result.status).toBe("BLOCKED");
    expect(result.failureCode).toBe(kind === "null-binding" ? "CONTENT_CHANGED_PREPARE_AGAIN" : kind === "missing-file" ? "CONTENT_ASSET_UNREADABLE_OR_NOT_ALLOWED" : "CONTENT_SOURCE_BYTES_CHANGED");
    expect(f.repo.getPublishDomainCounts()).toEqual(before);
    expect(f.adapter.recoverPreparedEditor).toHaveBeenCalledTimes(0);
  });
  it("does not revive or retry a terminal Failed Job", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); expect(await f.arm()).toMatchObject({ status: "PASS" });
    const job = f.repo.listJobs()[0]!;
    f.repo.db.prepare("UPDATE publish_jobs SET status='Failed',last_error_code='CONTENT_REJECTED' WHERE id=?").run(job.id);
    const before = f.repo.getJob(job.id);
    expect(await f.arm()).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_ARM_JOB_ALREADY_EXISTS" });
    expect(f.repo.getJob(job.id)).toMatchObject({ status: "Failed", lastErrorCode: "CONTENT_REJECTED", selectedImageAssetId: before?.selectedImageAssetId });
    expect(await f.service.recoverTask10sPreparedEditor(runId)).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_JOB_STATUS_NOT_ELIGIBLE" });
    expect(f.adapter.recoverPreparedEditor).toHaveBeenCalledTimes(0);
  });
  it("resolves retained-editor content from the current Prepared Job Article", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); expect(await f.arm()).toMatchObject({ status: "PASS" });
    const result = await f.service.runTask10sCompleteRetainedEditor(runId);
    expect(result.failureCode).not.toBe("TASK10S_RETAINED_EDITOR_FIXED_CONTENT_MISMATCH");
    expect(f.forbidden).toHaveBeenCalledTimes(1);
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.state).toBe("AUTHORIZED_UNUSED");
  });
  it.each(["missing-id", "missing-article"]) ("fails closed when the Prepared Job Article is %s", async (kind) => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); expect(await f.arm()).toMatchObject({ status: "PASS" });
    const job = f.repo.listJobs()[0]!;
    f.repo.db.pragma("foreign_keys = OFF");
    f.repo.db.prepare("UPDATE publish_jobs SET article_id=? WHERE id=?").run(kind === "missing-id" ? "" : "article-does-not-exist", job.id);
    f.repo.db.pragma("foreign_keys = ON");
    const result = await f.service.runTask10sCompleteRetainedEditor(runId);
    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_JOB_BINDING_MISMATCH" });
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it("fails closed when the Prepared PublishRecord is bound to a different Article", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); expect(await f.arm()).toMatchObject({ status: "PASS" });
    const job = f.repo.listJobs()[0]!;
    f.repo.db.pragma("foreign_keys = OFF");
    f.repo.db.prepare("UPDATE publish_records SET article_id=? WHERE job_id=?").run("article-does-not-exist", job.id);
    f.repo.db.pragma("foreign_keys = ON");
    const result = await f.service.runTask10sCompleteRetainedEditor(runId);
    expect(result).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_JOB_BINDING_MISMATCH" });
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
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId); expect(await f.arm()).toMatchObject({ status: "PASS" });
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
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn(), armTask10sRun: (testRunId) => f.service.armTask10sRun(testRunId), writeTask10sArmRunEvidence: write, runTask10sCompleteRetainedEditor: () => f.service.runTask10sCompleteRetainedEditor(runId), writeTask10sCompleteRetainedEditorEvidence: vi.fn() });
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


describe("F02 ARM immutable request contract", () => {
  it("uses request bytes and text for a new Run and leaves final dispatch at zero", async () => {
    const f = setup();
    expect(f.observedUploads).toHaveLength(0);
    const fresh = await f.service.runTask10sFreshPublishFlow(accountId, f.requestedRunId);
    expect(fresh.fixedContent).toEqual({ title: "Explicit ARM title", body: "Explicit ARM body" });
    expect(f.observedUploads).toEqual([f.fixtureSha.toLowerCase()]);
    expect(await f.arm()).toMatchObject({ status: "PASS" });
    expect(f.repo.listJobs()[0]?.contentBindingId).toBe(f.request.contentBindingId);
    expect(f.repo.getPublishRecords()[0]?.contentBindingId).toBe(f.request.contentBindingId);
    expect(f.repo.getOneShotPublicationAuthorization(f.requestedRunId)?.contentBindingId).toBe(f.request.contentBindingId);
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it("never retrofits an old unbound Run", async () => {
    const f = setup(); const old = createHistoricalRun(f, "legacy-unbound");
    const before = f.repo.getPublishDomainCounts();
    expect(await f.service.runTask10sFreshPublishFlow(accountId, old)).toMatchObject({ status: "BLOCKED", failureCode: "ONE_SHOT_CONTENT_PAYLOAD_REQUIRED" });
    expect(f.repo.getPlatformSelfTestRun(old)?.contentBindingId).toBeNull();
    expect(f.repo.getPublishDomainCounts()).toEqual(before);
    expect(f.observedUploads).toHaveLength(0);
  });
});


describe("ARM review boundaries", () => {
  it("keeps the explicit compatibility ARM wrapper usable for a new request", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    expect(await f.service.armTask10sFreshCompletion(runId)).toMatchObject({ status: "PASS" });
    expect(f.repo.getOneShotPublicationAuthorization(runId)?.finalSubmitAttemptCount).toBe(0);
  });
  it("does not authorize a request cancelled while ARM is waiting for identity", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    let release!: () => void;
    vi.spyOn(XhsIdentityService.prototype, "validateContextIdentityAttestation").mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; }); return { valid: true } as Awaited<ReturnType<XhsIdentityService["validateContextIdentityAttestation"]>>;
    });
    const pending = f.service.armTask10sRun(runId);
    f.service.cancelOneShotPublish(runId); release();
    expect(await pending).toMatchObject({ status: "BLOCKED", failureCode: "CONTENT_CONFIRMATION_REQUEST_REQUIRED" });
    expect(f.repo.listJobs()).toHaveLength(0);
    expect(f.repo.getOneShotPublicationAuthorization(runId)).toBeNull();
  });
  it("concurrent ARM produces only one durable Prepared relation", async () => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);
    await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    const results = await Promise.all([f.service.armTask10sRun(runId),f.service.armTask10sRun(runId)]);
    expect(results.filter((r) => r.status === "PASS")).toHaveLength(1);
    expect(f.repo.listJobs()).toHaveLength(1);expect(f.repo.getPublishRecords()).toHaveLength(1);
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it.each(["title", "body"])("old confirmed %s changes are refused and a fresh explicit request remains usable", async (field) => {
    const f = setup(); await f.service.runTask10sFreshPublishFlow(accountId, runId);expect(await f.arm()).toMatchObject({status:"PASS"});
    const job=f.repo.listJobs()[0]!;
    f.repo.db.prepare("UPDATE articles SET "+field+"=? WHERE id=?").run("Changed explicit content",job.articleId);
    expect(await f.service.runTask10sCompleteRetainedEditor(runId)).toMatchObject({status:"BLOCKED"});
    expect(f.forbidden).not.toHaveBeenCalled();
    const next=f.service.requestOneShotPublish(accountId,{platformKey:"xiaohongshu",accountId,creatorId:"960803317",title:field==="title"?"Changed explicit content":"Explicit ARM title",body:field==="body"?"Changed explicit content":"Explicit ARM body",imageAssetId:job.selectedImageAssetId!,imageSha256:f.fixtureSha});
    expect(next.contentBindingId).not.toBe(f.request.contentBindingId);
    await f.service.runTask10sFreshPublishFlow(accountId,next.testRunId);await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
    expect(await f.service.armTask10sRun(next.testRunId)).toMatchObject({status:"PASS"});
    expect(f.repo.getOneShotPublicationAuthorization(next.testRunId)?.finalSubmitAttemptCount).toBe(0);
  });
  it.each(["image-proof", "title-proof", "body-proof"])("refuses missing actual %s even when booleans claim success", async (fault) => {
    const f=setup(); const original=f.adapter.runPublishFlowExploration;
    f.adapter.runPublishFlowExploration=async (ctx,input) => {
      const result=await original(ctx,input);
      if(fault==="image-proof")result.evidence.uploadedImageSha256=null;
      if(fault==="title-proof")result.evidence.titleReadbackValue="";
      if(fault==="body-proof")result.evidence.bodyReadbackValue="";
      return result;
    };
    await f.service.runTask10sFreshPublishFlow(accountId,runId);
    expect(await f.arm()).toMatchObject({status:"BLOCKED",failureCode:"ARM_CONTENT_READBACK_MISMATCH"});
    expect(f.repo.listJobs()).toHaveLength(0);
  });
});

it("requires explicit Run for recovery and retained completion", async () => {
 const f=setup();
 expect(await f.service.recoverTask10sPreparedEditor()).toMatchObject({status:"BLOCKED",failureCode:"TASK10S_TEST_RUN_ID_REQUIRED"});
 expect(await f.service.runTask10sCompleteRetainedEditor()).toMatchObject({status:"BLOCKED",failureCode:"TASK10S_TEST_RUN_ID_REQUIRED"});
});


it.each(["accepted", "lost-receipt"] as const)("real request IPC, ARM and retained Publisher dispatch once from zero mock receipts: %s", async (mode) => {
 const f=setup();
 const receipts:unknown[]=[];let sends=0;let mouse=0;
 const server=createServer((req,res)=>{let body="";req.on("data",(b)=>{body+=String(b);});req.on("end",()=>{receipts.push(JSON.parse(body));res.end("accepted");});});
 await new Promise<void>((resolve)=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address || typeof address==="string")throw new Error("loopback unavailable");
 try {
 const subject:XhsContextIdentityAttestation={accountId,platformKey:"xiaohongshu",expectedExternalCreatorId:"960803317",observedExternalCreatorId:"960803317",externalAccountId:"960803317",browserSessionIdentity:"session",browserContextIdentity:"context",sourcePageIdentity:"page",sourceOrigin:"https://creator.xiaohongshu.com",sourcePathname:"/publish/publish",issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),verified:true};
 vi.spyOn(XhsIdentityService.prototype,"getContextIdentityAttestation").mockReturnValue(subject);
 const uploaded:string[]=[];
 const observe=async(input:PublishFlowExplorationInput)=>{
   let files:File[]=[];
   const node={tagName:"INPUT",type:"file",accept:"image/*",multiple:true,disabled:false,isConnected:true,className:"",get files(){return files;}};
   const handle={evaluate:async(fn:(element:typeof node,flag?:boolean)=>unknown,flag?:boolean)=>fn(node,flag),setInputFiles:async(items:Array<{name:string;mimeType:string;buffer:Buffer}>)=>{files=items.map((i)=>new File([Uint8Array.from(i.buffer)],i.name,{type:i.mimeType}));}};
   const proof=await readXiaohongshuUploadInputImmediately({elementHandle:async()=>handle} as unknown as Parameters<typeof readXiaohongshuUploadInputImmediately>[0],[input.imagePath],undefined,undefined,input.boundImages);
   expect(proof.status).toBe("PASS");uploaded.push(...proof.uploadedByteSha256!);
   return {...exploration(),operationId:input.operationId!,evidence:{uploadedImageSha256:proof.uploadedByteSha256![0],titleReadbackValue:input.title,bodyReadbackValue:input.body}};
 };
 const base=new TestPlatformAdapter();
 const adapter=Object.assign(base,f.adapter,{platformKey:"xiaohongshu",manifest:{...base.manifest,platformKey:"xiaohongshu",transport:"browser",integrationMode:"BrowserAutomation"},supportsBoundImageBuffers:true,
   getCapabilities:()=>({...new TestPlatformAdapter().getCapabilities(),imagePost:true,maxImageCount:1}),
   runPublishFlowExploration:async(_ctx:AccountContext,input:PublishFlowExplorationInput)=>observe(input),
   finalSubmit:async(ctx:AccountContext,input:PublishArticleInput,attempt:BrowserPublishAttemptContext):Promise<PublishResult>=>{
     const guard=attempt.oneShotPublicationGuard!;const a=guard.authorization;
     return guard.startFinalSubmit({authorization:a.authorization,authorizationState:"AUTHORIZED_UNUSED",platformKey:"xiaohongshu",accountId:a.accountId,operationId:a.operationId,mode:a.mode,authenticated:true,sameCanonicalContext:true,sameCanonicalPage:true,mutexOwned:true,editorPhase:"IMAGE_POST_POST_UPLOAD_EDITOR",safeFixtureUploaded:true,titleReadbackVerified:true,bodyReadbackVerified:true,requiredFieldsPass:true,loginPagePresent:false,securityVerificationPresent:false,finalSubmitControl:{status:"FOUND_UNIQUE",visible:true,enabled:true,hitTestValid:true}},async()=>{
       await guard.beginFinalMousePress();mouse++;sends++;
       expect(f.repo.getSubmissionIntentByJob(attempt.jobId)?.finalSubmitCount).toBe(1);
       const received = await new Promise<PublishResult>((resolve,reject)=>{const r=httpRequest({hostname:"127.0.0.1",port:address.port,method:"POST"},(res)=>{res.resume();res.on("end",()=>resolve({success:true,status:"published",externalId:"isolated-receipt",publishedUrl:"http://127.0.0.1/isolated",response:{imageUploaded:true}}));});r.on("error",reject);r.end(JSON.stringify({accountId:ctx.accountId,title:input.title,body:input.body,snapshot:input.contentSnapshotId}));});
       if(mode==="lost-receipt")throw new Error("MOCK_RECEIVED_RESPONSE_LOST");
       return received;
     },{deferDispatchLock:true});
   },
   verifyPublished:async(_ctx:AccountContext,_input:PublishArticleInput,result:PublishResult)=>({status:"published" as const,externalId:result.externalId,publishedUrl:result.publishedUrl,response:{mock:true}})
 });
 const registry=new RuntimeRegistry();registry.register(adapter as unknown as PlatformAdapter);
 const logger=createConsoleLogger();const publisher=new RealPublisher(f.repo,registry,logger,{resolveRuntimeIdentityAttestation:()=>subject});
 const credentials={get:()=>null,has:()=>false,set:()=>{throw new Error("NO_CREDENTIAL_WRITES");},delete:()=>{throw new Error("NO_CREDENTIAL_WRITES");}};
 const service=registerIpc({repository:f.repo,publisher,scheduler:new PersistentScheduler(f.repo,publisher,logger),registry,resolveAccountSecrets:()=>({}),dataDirectory:f.dir,coverDir:f.dir,logger,credentials,aiCredentials:credentials,appLogPath:join(f.dir,"mock.log"),databasePath:join(f.dir,"test.db")});
 const image=f.repo.getOneShotContentBinding(f.request.contentBindingId!)!;
 const run=await ipc.handlers.get("platform-self-test:request-one-shot-publish")!({},{platformAccountId:accountId,payload:{platformKey:"xiaohongshu",accountId,creatorId:"960803317",title:"IPC explicit title",body:"IPC explicit body",imageAssetId:image.imageAssetId,imageSha256:f.fixtureSha}}) as PlatformSelfTestRun;
 expect(receipts).toHaveLength(0);expect(sends).toBe(0);expect(mouse).toBe(0);expect(uploaded).toHaveLength(0);
 expect(await service.runTask10sFreshPublishFlow(accountId,run.testRunId)).toMatchObject({status:"PASS_READY_FOR_FINAL_SUBMIT"});
 expect(uploaded).toEqual([f.fixtureSha.toLowerCase()]);
 await service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
 const armed=await service.armTask10sRun(run.testRunId);expect(armed).toMatchObject({status:"PASS"});
 expect(receipts).toHaveLength(0);expect(sends).toBe(0);expect(mouse).toBe(0);
 expect(f.repo.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
 expect(f.repo.db.prepare("SELECT consumed FROM content_confirmations WHERE job_id=?").get(armed.jobId)).toEqual({consumed:0});
 const result=await service.runTask10sCompleteRetainedEditor(run.testRunId);
 expect(result).toMatchObject({status:mode==="accepted"?"PASS":"BLOCKED"});
 if(mode==="lost-receipt") {
   expect(f.repo.getJob(armed.jobId!)?.status).toBe("NeedsReconciliation");
   expect(f.repo.getSubmissionBarrier(armed.jobId!)).not.toBeNull();
   const oldClaim=f.repo.db.prepare("SELECT * FROM submission_dispatch_claims").all();
   const next=await ipc.handlers.get("platform-self-test:request-one-shot-publish")!({},{platformAccountId:accountId,payload:{platformKey:"xiaohongshu",accountId,creatorId:"960803317",title:"New explicit request",body:"Cannot bypass old unknown",imageAssetId:image.imageAssetId,imageSha256:f.fixtureSha}}) as PlatformSelfTestRun;
   expect(await service.runTask10sFreshPublishFlow(accountId,next.testRunId)).toMatchObject({status:"BLOCKED",failureCode:"SUBMISSION_RECONCILIATION_REQUIRED"});
   expect(await service.armTask10sRun(next.testRunId)).toMatchObject({status:"BLOCKED"});
   expect(f.repo.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toEqual(oldClaim);
 }
 expect(sends).toBe(1);expect(mouse).toBe(1);expect(receipts).toEqual([{accountId,title:"IPC explicit title",body:"IPC explicit body",snapshot:run.contentBindingId}]);
 expect(await service.runTask10sCompleteRetainedEditor(run.testRunId)).toMatchObject({status:"BLOCKED"});expect(receipts).toHaveLength(1);
 console.log("ARM_IPC_EVIDENCE",JSON.stringify({initial:{receipts:0,sends:0,mouse:0},afterArm:{receipts:0,sends:0,mouse:0},final:{receipts,sends,mouse},uploaded,run:f.repo.getPlatformSelfTestRun(run.testRunId),job:f.repo.getJob(armed.jobId!),record:f.repo.getPublishRecordByJob(armed.jobId!),auth:f.repo.getOneShotPublicationAuthorization(run.testRunId)}));
 f.repo.db.pragma("wal_checkpoint(TRUNCATE)");
 copyFileSync(join(f.dir,"test.db"),join(process.env.BATCH1_ISOLATION_ROOT!, "arm-ipc-"+randomUUID()+".db"));
 } finally {await new Promise<void>((resolve,reject)=>server.close((e)=>e?reject(e):resolve()));}
});

it("reopens Repository and Service and recovers the same durable snapshot relation",async()=>{
 const f=setup();await f.service.runTask10sFreshPublishFlow(accountId,runId);expect(await f.arm()).toMatchObject({status:"PASS"});
 const run=f.repo.getPlatformSelfTestRun(runId)!;const snapshot=f.repo.contentSnapshots.get(run.contentBindingId!);
 f.repo.db.close();
 const reopened=openDatabase(join(f.dir,"test.db"),join(process.cwd(),"packages/db/migrations"));cleanup.push(()=>reopened.db.close());
 const service=new PlatformSelfTestService({...f.options,repository:reopened.repository});
 expect(await service.recoverTask10sPreparedEditor(runId)).toMatchObject({status:"PASS",jobId:run.publishJobId,publishRecordId:run.publishRecordId});
 expect(reopened.repository.contentSnapshots.get(run.contentBindingId!)).toEqual(snapshot);
 expect(reopened.repository.getOneShotPublicationAuthorization(runId)?.finalSubmitAttemptCount).toBe(0);
 expect(f.forbidden).not.toHaveBeenCalled();
});

it("refuses cancelled request before any fresh upload",async()=>{
 const f=setup();f.service.cancelOneShotPublish(runId);
 expect(await f.service.runTask10sFreshPublishFlow(accountId,runId)).toMatchObject({status:"BLOCKED",failureCode:"CONTENT_CONFIRMATION_REQUEST_REQUIRED"});
 expect(f.observedUploads).toHaveLength(0);
});
it("refuses a request bound to an earlier creator before upload",async()=>{
 const f=setup();
 f.repo.db.prepare("UPDATE accounts SET external_account_id='new-creator' WHERE id=?").run(accountId);
 f.repo.db.prepare("UPDATE platform_account_identity_bindings SET external_creator_id='new-creator' WHERE account_id=?").run(accountId);
 vi.spyOn(XhsIdentityService.prototype,"establishContextIdentityAttestation").mockResolvedValue({status:"PASS",attestation:{observedExternalCreatorId:"new-creator",browserContextIdentity:"context"}} as Awaited<ReturnType<XhsIdentityService["establishContextIdentityAttestation"]>>);
 expect(await f.service.runTask10sFreshPublishFlow(accountId,runId)).toMatchObject({status:"BLOCKED",failureCode:"ONE_SHOT_CONTENT_SUBJECT_MISMATCH"});
 expect(f.observedUploads).toHaveLength(0);
});

it("refuses an adapter without bound byte capability before fresh upload",async()=>{
 const f=setup();f.adapter.supportsBoundImageBuffers=false;
 expect(await f.service.runTask10sFreshPublishFlow(accountId,runId)).toMatchObject({status:"BLOCKED",failureCode:"CONTENT_BOUND_IMAGE_UPLOAD_NOT_SUPPORTED"});
 expect(f.observedUploads).toHaveLength(0);
});

it.each(["articles","publish_jobs","publish_records","content_confirmations"])("ARM %s write failure rolls back the entire prepared business transaction",async(table)=>{
 const f=setup();await f.service.runTask10sFreshPublishFlow(accountId,runId);await f.service.inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId);
 const before=f.repo.getPublishDomainCounts();
 f.repo.db.exec("CREATE TRIGGER arm_fault BEFORE INSERT ON "+table+" BEGIN SELECT RAISE(ABORT,'ARM_ATOMIC_FAULT'); END");
 expect(await f.service.armTask10sRun(runId)).toMatchObject({status:"BLOCKED",failureCode:"ARM_ATOMIC_FAULT"});
 expect(f.repo.getPublishDomainCounts()).toEqual(before);expect(f.repo.getPlatformSelfTestRun(runId)?.publishConfirmedAt).toBeNull();expect(f.repo.getOneShotPublicationAuthorization(runId)).toBeNull();
 expect(f.forbidden).not.toHaveBeenCalled();
});
