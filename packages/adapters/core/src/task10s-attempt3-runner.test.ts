import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSecondInstanceDispatchTrace, createFixedDiagnosticRunner, parseDiagnosticAction, parseDiagnosticActionWithTrace, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG } from "../../../../apps/desktop/src/main/diagnostic-trigger";
import { emptyTask10sControlledUploadAttempt3Result, emptyTask10sControlledUploadAttempt4Result, reserveTask10sAttempt3, TASK10S_CANONICAL_AUTHORIZATION_ID } from "../../../../apps/desktop/src/main/task10s-attempt3";
import * as task10sAttemptModule from "../../../../apps/desktop/src/main/task10s-attempt3";
import { PlatformSelfTestService } from "../../../../apps/desktop/src/main/platform-self-test";

const temporaryDirectories: string[] = [];
const ATTEMPT5_FLAG = "--xhs-task10s-controlled-upload-attempt5";
const ATTEMPT5_ACTION = "RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Task10S Attempt 3 fixed runner guard", () => {
  it("accepts only the dedicated Attempt 5 action and rejects conflicts or caller data", () => {
    const attempt3Flag = XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG;
    const attempt4Flag = "--xhs-task10s-controlled-upload-attempt4";

    expect(parseDiagnosticAction(["Geo Media Publisher.exe", ATTEMPT5_FLAG])).toBe(ATTEMPT5_ACTION);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar", ATTEMPT5_FLAG])).toBe(ATTEMPT5_ACTION);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", ATTEMPT5_FLAG, ATTEMPT5_FLAG])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", attempt3Flag, ATTEMPT5_FLAG])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", attempt4Flag, ATTEMPT5_FLAG])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", ATTEMPT5_FLAG, "5"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe"], { action: ATTEMPT5_ACTION, attemptNumber: 5 })).toBeNull();
  });

  it("accepts the dedicated Attempt 4 action while rejecting duplicates, conflicts, and caller attempt data", () => {
    const attempt4Flag = "--xhs-task10s-controlled-upload-attempt4";
    const attempt4Action = "RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4";
    const attempt3Flag = XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG;

    expect(parseDiagnosticAction(["Geo Media Publisher.exe", attempt4Flag])).toBe(attempt4Action);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar", attempt4Flag])).toBe(attempt4Action);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", attempt4Flag, attempt4Flag])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", attempt3Flag, attempt4Flag])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", attempt4Flag, "4"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe"], { action: attempt4Action, attemptNumber: 4 })).toBeNull();
  });

  it("accepts exactly the fixed second-instance flag and rejects parameters", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG])).toBe(RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, "extra"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--xhs-task10s-controlled-upload-attempt3=other"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe"], { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, imagePath: "arbitrary" })).toBeNull();
  });

  it("normalizes the packaged Electron app.asar positional argument", () => {
    expect(parseDiagnosticAction([
      "Geo Media Publisher.exe",
      "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar",
      XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG
    ])).toBe(RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3);
  });

  it("normalizes the dev Electron app entry positional argument", () => {
    expect(parseDiagnosticAction([
      "electron.exe",
      process.cwd(),
      XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG
    ])).toBe(RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3);
  });

  it("keeps the existing read-only probe compatible with packaged Electron argv", () => {
    expect(parseDiagnosticAction([
      "Geo Media Publisher.exe",
      "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar",
      "--probe-xhs-canonical-page"
    ])).toBe("PROBE_XHS_CANONICAL_PAGE");
  });

  it("accepts the packaged Electron argv shape for the dispatch dry-run action", () => {
    expect(parseDiagnosticAction([
      "Geo Media Publisher.exe",
      "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar",
      XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG
    ])).toBe(RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN);
  });

  it("accepts the dev Electron app entry shape for the dispatch dry-run action", () => {
    expect(parseDiagnosticAction([
      "electron.exe",
      process.cwd(),
      XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG
    ])).toBe(RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN);
  });

  it("records safe raw and normalized argv plus parser rejection details", () => {
    const packaged = "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar";
    const accepted = parseDiagnosticActionWithTrace(["Geo Media Publisher.exe", packaged, XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG], undefined);
    expect(accepted.action).toBe(RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN);
    expect(accepted.trace.expectedDryRunActionPresentRaw).toBe("YES");
    expect(accepted.trace.expectedDryRunActionPresentNormalized).toBe("YES");
    expect(accepted.trace.normalizedArgvSafe.map((token) => token.kind)).toEqual(["KNOWN_FIXED_ACTION"]);
    expect(accepted.trace.removedLauncherArgumentsSafe.map((token) => token.kind)).toEqual(["APP_ASAR"]);
    expect(accepted.trace.rawArgvSafe.every((token) => !("value" in token))).toBe(true);

    const rejected = parseDiagnosticActionWithTrace(["Geo Media Publisher.exe", packaged, XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG, "--unknown-option"], undefined);
    expect(rejected.action).toBeNull();
    expect(rejected.trace.actionParseResult).toBe("REJECTED");
    expect(rejected.trace.actionParseRejectionCode).toBe("UNKNOWN_OR_EXTRA_ARGUMENT");
    expect(rejected.trace.dispatchFailureStage).toBe("ACTION_PARSE_REJECTED");
  });

  it("records the second-instance event before entering the parser", () => {
    const trace = buildSecondInstanceDispatchTrace([
      "Geo Media Publisher.exe",
      "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar",
      XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG
    ], 4242, "2026-09-04T00:00:00.000Z");

    expect(trace.secondInstanceEventReceived).toBe("YES");
    expect(trace.actionParseEntered).toBe("NO");
    expect(trace.dispatchEntered).toBe("NO");
    expect(trace.expectedDryRunActionPresentRaw).toBe("YES");
    expect(trace.expectedDryRunActionPresentNormalized).toBe("YES");
    expect(trace.removedLauncherArgumentsSafe).toHaveLength(1);
    expect(trace.removedLauncherArgumentsSafe[0]?.kind).toBe("APP_ASAR");
    expect(trace.sideEffectCounts).toEqual(expect.objectContaining({ uploadImages: 0, setInputFiles: 0, finalSubmit: 0 }));
  });

  it("classifies exact launcher candidates without relaxing unknown-option rejection", () => {
    const allowFileAccess = parseDiagnosticActionWithTrace([
      "Geo Media Publisher.exe",
      XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG,
      "--allow-file-access-from-files"
    ], undefined);
    expect(allowFileAccess.action).toBe(RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN);
    expect(allowFileAccess.trace.unknownOptionLength).toBe(30);
    expect(allowFileAccess.trace.unknownOptionMatchesAllowFileAccessFromFiles).toBe("YES");
    expect(allowFileAccess.trace.unknownOptionMatchesOriginalProcessStartTimePrefix).toBe("NO");
    expect(allowFileAccess.trace.unknownOptionMatchesOtherProvenLauncherFlag).toBe("NO");
    expect(allowFileAccess.trace.unknownOptionSafeClass).toBe("EXACT_ALLOW_FILE_ACCESS_FROM_FILES_CANDIDATE");
    expect(allowFileAccess.trace.unknownOptionSha256).toMatch(/^[A-F0-9]{64}$/u);
    expect(allowFileAccess.trace.normalizedArgvSafe.map((token) => token.kind)).toEqual(["KNOWN_FIXED_ACTION"]);
    expect(allowFileAccess.trace.removedLauncherArgumentsSafe.map((token) => token.kind)).toContain("KNOWN_ELECTRON_LAUNCHER_OPTION");

    const lookalike = parseDiagnosticActionWithTrace([
      "Geo Media Publisher.exe",
      XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG,
      "--allow-file-access-from-filesX"
    ], undefined);
    expect(lookalike.action).toBeNull();
    expect(lookalike.trace.unknownOptionMatchesAllowFileAccessFromFiles).toBe("NO");
    expect(lookalike.trace.unknownOptionSafeClass).toBe("UNKNOWN_OPTION");
    expect(lookalike.trace.unknownOptionSha256).toMatch(/^[A-F0-9]{64}$/u);

    const sameLengthUnknown = parseDiagnosticActionWithTrace([
      "Geo Media Publisher.exe",
      XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG,
      "--xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    ], undefined);
    expect(sameLengthUnknown.action).toBeNull();
    expect(sameLengthUnknown.trace.unknownOptionLength).toBe(30);
    expect(sameLengthUnknown.trace.unknownOptionMatchesAllowFileAccessFromFiles).toBe("NO");
    expect(sameLengthUnknown.trace.unknownOptionSafeClass).toBe("UNKNOWN_OPTION");
  });

  it("reports the original-process-start-time prefix without exposing its value", () => {
    const result = parseDiagnosticActionWithTrace([
      "Geo Media Publisher.exe",
      XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG,
      "--original-process-start-time=1234567890"
    ], undefined);

    expect(result.action).toBeNull();
    expect(result.trace.unknownOptionMatchesAllowFileAccessFromFiles).toBe("NO");
    expect(result.trace.unknownOptionMatchesOriginalProcessStartTimePrefix).toBe("YES");
    expect(result.trace.unknownOptionSafeClass).toBe("ORIGINAL_PROCESS_START_TIME_PREFIX_CANDIDATE");
    expect(result.trace.rawArgvSafe.every((token) => !(["value", "rawValue"].some((key) => key in token)))).toBe(true);
  });

  it("routes dry-run through the same fixed dispatcher without invoking Attempt 3", async () => {
    const dryRun = vi.fn(async () => ({ status: "PASS" as const, sideEffectCounts: { pageCreated: 0, contextCreated: 0, imagePostEntryClick: 0, uploadImages: 0, setInputFiles: 0, titleFill: 0, bodyFill: 0, finalSubmit: 0, publicationTransaction: 0, newAuthorization: 0 } }));
    const attempt3 = vi.fn(async () => emptyTask10sControlledUploadAttempt3Result("account-1"));
    const write = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn(), runTask10sControlledUploadAttempt3: attempt3, runTask10sAttempt3DispatchDryRun: dryRun, writeTask10sAttempt3DispatchDryRunEvidence: write });
    const commandLine = ["Geo Media Publisher.exe", "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar", XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG];
    const parsed = parseDiagnosticActionWithTrace(commandLine, undefined);

    await expect(runner(parsed.action as typeof RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN, { dispatchTrace: parsed.trace })).resolves.toBe(true);
    expect(dryRun).toHaveBeenCalledTimes(1);
    expect(attempt3).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ actionParseResult: "DRY_RUN_ATTEMPT3", dispatchEntered: "YES", dispatchSelectedAction: "DRY_RUN_ATTEMPT3", dryRunHandlerReached: "YES", sideEffectCounts: expect.objectContaining({ setInputFiles: 0, finalSubmit: 0 }) }));
  });

  it("rejects unknown, duplicate, conflicting, and caller-supplied positional arguments", () => {
    const packaged = "C:\\GMP116ZhihuL5\\Geo Media Publisher\\resources\\app.asar";
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", packaged, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, "--unknown-option"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", packaged, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", packaged, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, "--probe-xhs-canonical-page"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, "C:\\private\\fixture.png"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, "https://example.com"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, "button"])).toBeNull();
  });

  it("atomically reserves Attempt 3 once and rejects replay", () => {
    const directory = mkdtempSync(join(tmpdir(), "task10s-attempt3-test-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "attempt3.json");

    expect(reserveTask10sAttempt3(statePath, { accountId: "account-1", contextDebugId: "context-1", pageDebugId: "page-1" })).toMatchObject({ acquired: true, reason: "ACQUIRED" });
    expect(reserveTask10sAttempt3(statePath, { accountId: "account-1", contextDebugId: "context-1", pageDebugId: "page-1" })).toMatchObject({ acquired: false, reason: "ATTEMPT_3_ALREADY_USED" });
  });

  it("keeps the Attempt 3 replay guard independent from the Attempt 4 replay guard", () => {
    type Reserve = (statePath: string, input: { accountId: string; contextDebugId: string; pageDebugId: string }) => { acquired: boolean; reason: string };
    const module = task10sAttemptModule as unknown as { reserveTask10sAttempt3?: Reserve; reserveTask10sAttempt4?: Reserve };
    expect(typeof module.reserveTask10sAttempt3).toBe("function");
    expect(typeof module.reserveTask10sAttempt4).toBe("function");
    if (typeof module.reserveTask10sAttempt3 !== "function" || typeof module.reserveTask10sAttempt4 !== "function") return;

    const directory = mkdtempSync(join(tmpdir(), "task10s-attempt-guards-test-"));
    temporaryDirectories.push(directory);
    const input = { accountId: "account-1", contextDebugId: "context-1", pageDebugId: "page-1" };
    expect(module.reserveTask10sAttempt3(join(directory, "attempt3.json"), input)).toMatchObject({ acquired: true });
    expect(module.reserveTask10sAttempt3(join(directory, "attempt3.json"), input)).toMatchObject({ acquired: false, reason: "ATTEMPT_3_ALREADY_USED" });
    expect(module.reserveTask10sAttempt4(join(directory, "attempt4.json"), input)).toMatchObject({ acquired: true });
    expect(module.reserveTask10sAttempt3(join(directory, "attempt3.json"), input)).toMatchObject({ acquired: false, reason: "ATTEMPT_3_ALREADY_USED" });
    expect(module.reserveTask10sAttempt4(join(directory, "attempt4.json"), input)).toMatchObject({ acquired: false, reason: "ATTEMPT_4_ALREADY_USED" });
  });

  it("allows Attempt 5 after Attempts 3 and 4 are used, with an independent replay guard", () => {
    type Reserve = (statePath: string, input: { accountId: string; contextDebugId: string; pageDebugId: string }) => { acquired: boolean; reason: string };
    const module = task10sAttemptModule as unknown as { reserveTask10sAttempt3?: Reserve; reserveTask10sAttempt4?: Reserve; reserveTask10sAttempt5?: Reserve };
    expect(typeof module.reserveTask10sAttempt3).toBe("function");
    expect(typeof module.reserveTask10sAttempt4).toBe("function");
    expect(typeof module.reserveTask10sAttempt5).toBe("function");
    if (typeof module.reserveTask10sAttempt3 !== "function" || typeof module.reserveTask10sAttempt4 !== "function" || typeof module.reserveTask10sAttempt5 !== "function") return;

    const directory = mkdtempSync(join(tmpdir(), "task10s-attempt5-guards-test-"));
    temporaryDirectories.push(directory);
    const input = { accountId: "account-1", contextDebugId: "context-1", pageDebugId: "page-1" };
    expect(module.reserveTask10sAttempt3(join(directory, "attempt3.json"), input)).toMatchObject({ acquired: true });
    expect(module.reserveTask10sAttempt4(join(directory, "attempt4.json"), input)).toMatchObject({ acquired: true });
    expect(module.reserveTask10sAttempt5(join(directory, "attempt5.json"), input)).toMatchObject({ acquired: true, reason: "ACQUIRED" });
    expect(module.reserveTask10sAttempt5(join(directory, "attempt5.json"), input)).toMatchObject({ acquired: false, reason: "ATTEMPT_5_ALREADY_USED" });
    expect(module.reserveTask10sAttempt3(join(directory, "attempt3.json"), input)).toMatchObject({ acquired: false, reason: "ATTEMPT_3_ALREADY_USED" });
    expect(module.reserveTask10sAttempt4(join(directory, "attempt4.json"), input)).toMatchObject({ acquired: false, reason: "ATTEMPT_4_ALREADY_USED" });
  });

  it("does not consume Attempt 5 when runtime preflight fails before mutation", async () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    const evidenceDirectory = mkdtempSync(join(tmpdir(), "task10s-attempt5-preflight-test-"));
    temporaryDirectories.push(evidenceDirectory);
    const account = { id: accountId, platformAccountId: accountId, platformKey: "xiaohongshu", accountAlias: "XHS", accountName: "XHS", name: "XHS", enabled: true, archivedAt: null, externalAccountId: "123456789" };
    const adapter = {
      connectAccount: vi.fn(),
      checkSession: vi.fn(),
      preparePublish: vi.fn(),
      getBrowserRuntimeSnapshot: vi.fn(() => ({ platformKey: "xiaohongshu", accountId, sessionExists: false, browserSessionIdentity: null, browserConnected: false, contextExists: false, canonicalPageExists: false, canonicalPageClosed: true, runtimeAuthState: "UNVERIFIED", contextDebugId: null, canonicalPageDebugId: null })),
      runControlledPostUploadDiscovery: vi.fn()
    };
    const instance = new PlatformSelfTestService({
      repository: { listAccounts: () => [account] } as never,
      registry: { getForContent: vi.fn(() => adapter) } as never,
      publisher: {} as never,
      resolveAccountSecrets: vi.fn(() => ({})),
      evidenceDirectory
    });
    const run = (instance as unknown as { runTask10sControlledUploadAttempt5?: () => Promise<Record<string, unknown>> }).runTask10sControlledUploadAttempt5;
    expect(typeof run).toBe("function");
    if (typeof run !== "function") return;

    await expect(run.call(instance)).resolves.toMatchObject({ status: "BLOCKED", failureCode: "XHS_CANONICAL_RUNTIME_UNAVAILABLE", controlledUploadAttempt5Count: 0, imageUploadAttemptCount: 4 });
    expect(existsSync(join(evidenceDirectory, "xiaohongshu-task10s-controlled-upload-attempt5-state.json"))).toBe(false);
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

  it("dispatches the dedicated Attempt 4 command to the shared Main-owned runner", async () => {
    const runAttempt4 = vi.fn(async () => emptyTask10sControlledUploadAttempt4Result("account-1"));
    const write = vi.fn();
    const options = {
      probe: vi.fn(),
      writeEvidence: vi.fn(),
      runTask10sControlledUploadAttempt4: runAttempt4,
      writeTask10sControlledUploadAttempt4Evidence: write
    } as unknown as Parameters<typeof createFixedDiagnosticRunner>[0];
    const runner = createFixedDiagnosticRunner(options);

    await expect(runner("RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4" as never)).resolves.toBe(true);
    expect(runAttempt4).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("dispatches the dedicated Attempt 5 command to the shared Main-owned runner", async () => {
    const runAttempt5 = vi.fn(async () => ({ status: "PASS" as const }));
    const write = vi.fn();
    const options = {
      probe: vi.fn(),
      writeEvidence: vi.fn(),
      runTask10sControlledUploadAttempt5: runAttempt5,
      writeTask10sControlledUploadAttempt5Evidence: write
    } as unknown as Parameters<typeof createFixedDiagnosticRunner>[0];
    const runner = createFixedDiagnosticRunner(options);

    await expect(runner(ATTEMPT5_ACTION as never)).resolves.toBe(true);
    expect(runAttempt5).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs one fixed upload proof and never crosses the content or submit boundary", async () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    const account = { id: accountId, platformAccountId: accountId, platformKey: "xiaohongshu", accountAlias: "XHS", accountName: "XHS", name: "XHS", enabled: true, archivedAt: null, externalAccountId: "123456789" };
    const runtime = {
      platformKey: "xiaohongshu", accountId, sessionExists: true, browserSessionIdentity: "session-1", contextDebugId: "context-1", canonicalPageDebugId: "page-1", browserConnected: true, contextExists: true, contextPageCount: 1, canonicalPageExists: true, canonicalPageClosed: false, canonicalPageContextMatchesSession: true, runtimeAuthState: "AUTHENTICATED", contextLaunchCount: 1, canonicalPagePromotionCount: 1, activeOperation: null, mutexLocked: false, operationInProgress: false, lastDisconnectAt: null, lastDisconnectContextDebugId: null, lastDisconnectReason: null
    };
    const probe = {
      probeStatus: "PASS", failureStage: null, failureCode: null, failureErrorClass: null, canonicalContextId: "context-1", canonicalPageId: "page-1", probedContextId: "context-1", probedPageId: "page-1", pageContextMatchesSession: true, createdNewPage: false, browserConnected: true, pageClosed: false, runtimeAuthState: "AUTHENTICATED", playwrightPageUrl: "https://creator.xiaohongshu.com/new/home", domLocationHref: "https://creator.xiaohongshu.com/new/home", domLocationEvaluateStatus: "PASS", domLocationEvaluateErrorClass: null, pageUrlConsistency: "PASS", routeClass: "CREATOR_HOME", identityObservationStatus: "PASS", identitySourceCandidates: [{ stableIdentifierPresent: true }], identityDomDiagnosticMatchCount: 1, identityDomDiagnosticMatches: [], observedCreatorIdRaw: "123456789", observedCreatorIdNormalized: "123456789", observedDisplayName: "XHS", observedProfileUrl: null
    };
    const controlled = {
      mode: "POST_UPLOAD_DISCOVERY_ONLY", status: "PASS", operationId: "attempt3-operation", platformKey: "xiaohongshu", accountId, imageSource: "SAFE_TEST_FIXTURE", sanitizedUrlBefore: "https://creator.xiaohongshu.com/new/home", sanitizedUrlAfter: "https://creator.xiaohongshu.com/publish/publish", preUploadGateStatus: "PASS", preUploadMutationRevalidated: true, uploadMutationCount: 1, uploadCompletionObserved: true, postUploadPhase: "IMAGE_POST_POST_UPLOAD_EDITOR", postUploadPhaseConfidence: "HIGH", postUploadControlsStatus: "READY", titleEditorStatus: "FOUND_UNIQUE", bodyEditorStatus: "FOUND_UNIQUE", finalSubmitStatus: "FOUND_UNIQUE", contentMutationCount: 0, finalSubmitCount: 0, sameCanonicalPage: true, sameContext: true, failureCode: null, failureStage: null, missingSignal: null,
      evidence: {
        imageEvidence: { verified: true, fileInputImmediateReadback: { status: "PASS", expectedFixtureMatch: "YES", fingerprint: { tagName: "INPUT", type: "file", accept: "image/*", multiple: false, disabled: false, connected: true, classNameSafe: "upload" }, readback: { filesLength: 1, files: [{ name: "task10s-safe-test.png", size: 19226, type: "image/png", lastModified: 0 }] } } },
        postUploadInspection: { mediaPreviewDiagnostics: { previewCount: 1, previewVisible: true }, processingSignalPresent: false, explicitUploadErrorSignals: [], titleControlPresent: true, bodyControlPresent: true, finalSubmitVisibleCount: 1 }
      }
    };
    const runControlledPostUploadDiscovery = vi.fn(async (_context: unknown, input: { onUploadMutationStarted?: () => void }) => {
      input.onUploadMutationStarted?.();
      return controlled;
    });
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), getBrowserRuntimeSnapshot: vi.fn(() => runtime), inspectCanonicalPageRuntime: vi.fn(async () => probe), runControlledPostUploadDiscovery };
    const authorization = { authorization: "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH", state: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId, operationId: TASK10S_CANONICAL_AUTHORIZATION_ID, mode: "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE", publicationTransactionCount: 0, publicationCommitActionCount: 0, finalSubmitAttemptCount: 0, finalSubmitRetryCount: 0, finalSubmitActionStarted: false, finalSubmitActionCompleted: false };
    const repository = { listAccounts: () => [account], getAccountById: () => account, getPlatformAccountIdentityBinding: () => null, getOneShotPublicationAuthorization: () => authorization };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: { getForContent: vi.fn(() => adapter) } as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})), evidenceDirectory: mkdtempSync(join(tmpdir(), "task10s-attempt3-evidence-")) });
    temporaryDirectories.push((instance as unknown as { options: { evidenceDirectory: string } }).options.evidenceDirectory);

    await expect(instance.runTask10sControlledUploadAttempt3()).resolves.toMatchObject({ status: "PASS", uploadLayer1: "PASS", uploadLayer2: "PASS", uploadLayer4: "PASS", imageUpload: "PASS", controlledUploadAttempt3Count: 1, imageUploadAttemptCount: 3, titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, authorizedRunStateAfter: "AUTHORIZED_UNUSED" });
    expect(adapter.runControlledPostUploadDiscovery).toHaveBeenCalledWith(expect.objectContaining({ accountId }), expect.objectContaining({ imagePath: expect.stringMatching(/task10s-safe-test\.png$/u), imageSource: "SAFE_TEST_FIXTURE", onUploadMutationStarted: expect.any(Function) }));
  });
});
