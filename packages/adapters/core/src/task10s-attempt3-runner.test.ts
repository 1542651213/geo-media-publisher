import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixedDiagnosticRunner, parseDiagnosticAction, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG } from "../../../../apps/desktop/src/main/diagnostic-trigger";
import { emptyTask10sControlledUploadAttempt3Result, reserveTask10sAttempt3, TASK10S_CANONICAL_AUTHORIZATION_ID } from "../../../../apps/desktop/src/main/task10s-attempt3";
import { PlatformSelfTestService } from "../../../../apps/desktop/src/main/platform-self-test";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Task10S Attempt 3 fixed runner guard", () => {
  it("accepts exactly the fixed second-instance flag and rejects parameters", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG])).toBe(RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, "extra"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--xhs-task10s-controlled-upload-attempt3=other"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe"], { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, imagePath: "arbitrary" })).toBeNull();
  });

  it("atomically reserves Attempt 3 once and rejects replay", () => {
    const directory = mkdtempSync(join(tmpdir(), "task10s-attempt3-test-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "attempt3.json");

    expect(reserveTask10sAttempt3(statePath, { accountId: "account-1", contextDebugId: "context-1", pageDebugId: "page-1" })).toMatchObject({ acquired: true, reason: "ACQUIRED" });
    expect(reserveTask10sAttempt3(statePath, { accountId: "account-1", contextDebugId: "context-1", pageDebugId: "page-1" })).toMatchObject({ acquired: false, reason: "ATTEMPT_3_ALREADY_USED" });
  });

  it("fails closed when the replay marker is malformed", () => {
    const directory = mkdtempSync(join(tmpdir(), "task10s-attempt3-test-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "attempt3.json");
    writeFileSync(statePath, "not-json", "utf8");

    expect(reserveTask10sAttempt3(statePath, { accountId: "account-1", contextDebugId: "context-1", pageDebugId: "page-1" })).toMatchObject({ acquired: false, reason: "ATTEMPT_3_ALREADY_USED" });
  });

  it("dispatches the fixed Attempt 3 command to Main-owned code only", async () => {
    const run = vi.fn(async () => emptyTask10sControlledUploadAttempt3Result("account-1"));
    const write = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn(), runTask10sControlledUploadAttempt3: run, writeTask10sControlledUploadAttempt3Evidence: write });

    await expect(runner(RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ finalSubmitClickCount: 0, titleFillCount: 0, bodyFillCount: 0, publicationTransactionCount: 0 }));
  });

  it("runs one fixed upload proof and never crosses the content or submit boundary", async () => {
    const accountId = "54b390ac-d81e-440a-baeb-d00f9f346cc3";
    const account = { id: accountId, platformAccountId: accountId, platformKey: "xiaohongshu", accountAlias: "XHS", accountName: "XHS", name: "XHS", enabled: true, archivedAt: null, externalAccountId: "960803317" };
    const runtime = {
      platformKey: "xiaohongshu", accountId, sessionExists: true, contextDebugId: "context-1", canonicalPageDebugId: "page-1", browserConnected: true, contextExists: true, contextPageCount: 1, canonicalPageExists: true, canonicalPageClosed: false, canonicalPageContextMatchesSession: true, runtimeAuthState: "AUTHENTICATED", contextLaunchCount: 1, canonicalPagePromotionCount: 1, activeOperation: null, mutexLocked: false, operationInProgress: false, lastDisconnectAt: null, lastDisconnectContextDebugId: null, lastDisconnectReason: null
    };
    const probe = {
      probeStatus: "PASS", failureStage: null, failureCode: null, failureErrorClass: null, canonicalContextId: "context-1", canonicalPageId: "page-1", probedContextId: "context-1", probedPageId: "page-1", pageContextMatchesSession: true, createdNewPage: false, browserConnected: true, pageClosed: false, runtimeAuthState: "AUTHENTICATED", playwrightPageUrl: "https://creator.xiaohongshu.com/new/home", domLocationHref: "https://creator.xiaohongshu.com/new/home", domLocationEvaluateStatus: "PASS", domLocationEvaluateErrorClass: null, pageUrlConsistency: "PASS", routeClass: "CREATOR_HOME", identityObservationStatus: "PASS", identitySourceCandidates: [{ stableIdentifierPresent: true }], identityDomDiagnosticMatchCount: 1, identityDomDiagnosticMatches: [], observedCreatorIdRaw: "960803317", observedCreatorIdNormalized: "960803317", observedDisplayName: "XHS", observedProfileUrl: null
    };
    const controlled = {
      mode: "POST_UPLOAD_DISCOVERY_ONLY", status: "PASS", operationId: "attempt3-operation", platformKey: "xiaohongshu", accountId, imageSource: "SAFE_TEST_FIXTURE", sanitizedUrlBefore: "https://creator.xiaohongshu.com/new/home", sanitizedUrlAfter: "https://creator.xiaohongshu.com/publish/publish", preUploadGateStatus: "PASS", preUploadMutationRevalidated: true, uploadMutationCount: 1, uploadCompletionObserved: true, postUploadPhase: "IMAGE_POST_POST_UPLOAD_EDITOR", postUploadPhaseConfidence: "HIGH", postUploadControlsStatus: "READY", titleEditorStatus: "FOUND_UNIQUE", bodyEditorStatus: "FOUND_UNIQUE", finalSubmitStatus: "FOUND_UNIQUE", contentMutationCount: 0, finalSubmitCount: 0, sameCanonicalPage: true, sameContext: true, failureCode: null, failureStage: null, missingSignal: null,
      evidence: {
        imageEvidence: { verified: true, fileInputImmediateReadback: { status: "PASS", expectedFixtureMatch: "YES", fingerprint: { tagName: "INPUT", type: "file", accept: "image/*", multiple: false, disabled: false, connected: true, classNameSafe: "upload" }, readback: { filesLength: 1, files: [{ name: "task10s-safe-test.png", size: 19226, type: "image/png", lastModified: 0 }] } } },
        postUploadInspection: { mediaPreviewDiagnostics: { previewCount: 1, previewVisible: true }, processingSignalPresent: false, explicitUploadErrorSignals: [], titleControlPresent: true, bodyControlPresent: true, finalSubmitVisibleCount: 1 }
      }
    };
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), getBrowserRuntimeSnapshot: vi.fn(() => runtime), inspectCanonicalPageRuntime: vi.fn(async () => probe), runControlledPostUploadDiscovery: vi.fn(async () => controlled) };
    const authorization = { authorization: "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH", state: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId, operationId: TASK10S_CANONICAL_AUTHORIZATION_ID, mode: "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE", publicationTransactionCount: 0, publicationCommitActionCount: 0, finalSubmitAttemptCount: 0, finalSubmitRetryCount: 0, finalSubmitActionStarted: false, finalSubmitActionCompleted: false };
    const repository = { listAccounts: () => [account], getAccountById: () => account, getPlatformAccountIdentityBinding: () => null, getOneShotPublicationAuthorization: () => authorization };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: { getForContent: vi.fn(() => adapter) } as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})), evidenceDirectory: mkdtempSync(join(tmpdir(), "task10s-attempt3-evidence-")) });
    temporaryDirectories.push((instance as unknown as { options: { evidenceDirectory: string } }).options.evidenceDirectory);

    await expect(instance.runTask10sControlledUploadAttempt3()).resolves.toMatchObject({ status: "PASS", uploadLayer1: "PASS", uploadLayer2: "PASS", uploadLayer4: "PASS", imageUpload: "PASS", controlledUploadAttempt3Count: 1, imageUploadAttemptCount: 3, titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, authorizedRunStateAfter: "AUTHORIZED_UNUSED" });
    expect(adapter.runControlledPostUploadDiscovery).toHaveBeenCalledWith(expect.objectContaining({ accountId }), { imagePath: expect.stringMatching(/task10s-safe-test\.png$/u), imageSource: "SAFE_TEST_FIXTURE" });
  });
});
