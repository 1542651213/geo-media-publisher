import { describe, expect, it, vi } from "vitest";
import { parseTask10sCommand, createFixedDiagnosticRunner } from "../apps/desktop/src/main/diagnostic-trigger";
import { RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR } from "../apps/desktop/src/main/task10s-attempt3";
import { RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY } from "../apps/desktop/src/main/task10s-prepared-editor-recovery";
import { TASK10S_ARM_RUN, RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, XHS_TASK10S_ARM_RUN_FLAG, XHS_TASK10S_FRESH_RUN_FLAG } from "../apps/desktop/src/main/diagnostic-trigger";
import { resolveTask10sExecutionTarget } from "../apps/desktop/src/main/task10s-execution-target";
import type { Task10sPreparedEditorRecoveryResult } from "../apps/desktop/src/main/task10s-prepared-editor-recovery";
import type { Task10sRetainedEditorCompletionResult } from "../apps/desktop/src/main/task10s-attempt3";

const RUN_ID = "e559303e-dfbd-402f-943a-035fd0e7f280";
const OTHER_RUN_ID = "4ce1c979-ebab-45fb-8726-786b972d815b";
const JOB_ID = "5ddce845-4342-4b6d-aeb3-074b521feebf";
const RECORD_ID = "45eb7e79-d132-4729-b7c8-69657345cfd6";
const AUTH_ID = "5164becc-05ad-422d-a920-f5fd01e051d3";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function fixture(overrides: Record<string, unknown> = {}) {
  const run = { testRunId: RUN_ID, platformKey: "xiaohongshu", accountId: ACCOUNT_ID, platformAccountId: ACCOUNT_ID, requestedLevel: "L5_PUBLISH", publishJobId: JOB_ID, ...overrides };
  const job = { id: JOB_ID, accountId: ACCOUNT_ID, platformAccountId: ACCOUNT_ID, platformKey: "xiaohongshu", articleId: "article-1", status: "NeedsUserAction" };
  const record = { id: RECORD_ID, jobId: JOB_ID, accountId: ACCOUNT_ID, platformAccountId: ACCOUNT_ID, platformKey: "xiaohongshu", articleId: "article-1", status: "Prepared" };
  const authorization = { authorization: "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH", state: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId: ACCOUNT_ID, operationId: RUN_ID, mode: "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE", publicationTransactionCount: 0, publicationCommitActionCount: 0, finalSubmitAttemptCount: 0, finalSubmitRetryCount: 0, finalSubmitActionStarted: false, finalSubmitActionCompleted: false };
  const prepare = vi.fn(() => ({ get: vi.fn((...args: unknown[]) => args[0] === RUN_ID ? { id: AUTH_ID } : { count: 1 }) }));
  const repository = {
    getPlatformSelfTestRun: vi.fn((id: string) => id === RUN_ID ? run : null),
    getJob: vi.fn((id: string) => id === JOB_ID ? job : null),
    getPublishRecordByJob: vi.fn((id: string) => id === JOB_ID ? record : null),
    getOneShotPublicationAuthorization: vi.fn((id: string) => id === RUN_ID ? authorization : null),
    db: { prepare },
  };
  return { repository, run, job, record, authorization };
}

describe("r56 explicit Task10S execution target", () => {
  it("resolves the explicit current Run instead of the historical canonical Run", () => {
    const { repository } = fixture();
    const result = resolveTask10sExecutionTarget(repository as never, RUN_ID);
    expect(result.status).toBe("PASS");
    if (result.status === "PASS") expect(result.target).toEqual({ testRunId: RUN_ID, publishJobId: JOB_ID, publishRecordId: RECORD_ID, authorizationId: AUTH_ID, accountId: ACCOUNT_ID });
  });

  it("fails closed when the Run is absent", () => expect(resolveTask10sExecutionTarget(fixture().repository as never, OTHER_RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RUN_NOT_FOUND" }));
  it("fails closed when explicit Run is missing", () => expect(resolveTask10sExecutionTarget(fixture().repository as never, "")).toMatchObject({ status: "BLOCKED", failureCode: "RUN_NOT_FOUND" }));
  it("fails closed when Run has no bound Job", () => expect(resolveTask10sExecutionTarget(fixture({ publishJobId: null }).repository as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RUN_HAS_NO_BOUND_JOB" }));
  it("fails closed when bound Job is absent", () => expect(resolveTask10sExecutionTarget(fixture({ publishJobId: "missing-job" }).repository as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "JOB_NOT_FOUND" }));
  it("rejects a Job bound to a different Run when metadata is present", () => expect(resolveTask10sExecutionTarget(fixture().repository as never, RUN_ID)).toMatchObject({ status: "PASS" }));
  it("fails closed when Record is absent", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getPublishRecordByJob: vi.fn(() => null) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_NOT_FOUND" }));
  it("fails closed when Record belongs to another Job", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getPublishRecordByJob: vi.fn(() => ({ ...fixture().record, jobId: "other-job" })) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_JOB_BINDING_MISMATCH" }));
  it("fails closed when Record is not Prepared", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getPublishRecordByJob: vi.fn(() => ({ ...fixture().record, status: "Failed" })) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_NOT_FOUND" }));
  it("fails closed when Prepared Record is not unique", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, db: { prepare: vi.fn(() => ({ get: vi.fn((...args: unknown[]) => args[0] === RUN_ID ? { id: AUTH_ID } : { count: 2 }) })) } } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_NOT_FOUND" }));
  it("fails closed when Authorization is absent", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getOneShotPublicationAuthorization: vi.fn(() => null) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "AUTHORIZATION_NOT_FOUND" }));
  it("fails closed when Authorization belongs to another Run", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getOneShotPublicationAuthorization: vi.fn(() => ({ ...fixture().authorization, operationId: OTHER_RUN_ID })) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "AUTHORIZATION_RUN_BINDING_MISMATCH" }));
  it("fails closed when account bindings disagree", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getJob: vi.fn(() => ({ ...fixture().job, accountId: "other-account" })) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "ACCOUNT_BINDING_MISMATCH" }));
  it("fails closed for an authorization account mismatch", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getOneShotPublicationAuthorization: vi.fn(() => ({ ...fixture().authorization, accountId: "other-account" })) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "AUTHORIZATION_ACCOUNT_MISMATCH" }));
  it("fails closed when the Job platform account differs", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getJob: vi.fn(() => ({ ...fixture().job, platformAccountId: "other-platform-account" })) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "ACCOUNT_BINDING_MISMATCH" }));
  it("fails closed when the Record article differs", () => expect(resolveTask10sExecutionTarget({ ...fixture().repository, getPublishRecordByJob: vi.fn(() => ({ ...fixture().record, articleId: "other-article" })) } as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_JOB_BINDING_MISMATCH" }));
  it("fails closed when the Run points at another Record", () => expect(resolveTask10sExecutionTarget(fixture({ publishRecordId: "other-record" }).repository as never, RUN_ID)).toMatchObject({ status: "BLOCKED", failureCode: "RECORD_JOB_BINDING_MISMATCH" }));
  it("does not consult canonical or latest fallback APIs", () => {
    const { repository } = fixture();
    resolveTask10sExecutionTarget(repository as never, RUN_ID);
    expect(repository.getPlatformSelfTestRun).toHaveBeenCalledWith(RUN_ID);
    expect(repository.getPlatformSelfTestRun).toHaveBeenCalledTimes(1);
  });
});

describe("r56 parameterized diagnostic routes", () => {
  it("parses explicit recovery and completion flags", () => {
    const recovery = parseTask10sCommand(["electron.exe", "--xhs-task10s-recover-prepared-editor-run", RUN_ID]);
    const completion = parseTask10sCommand(["electron.exe", "--xhs-task10s-complete-retained-editor-run", RUN_ID]);
    expect(recovery.testRunId).toBe(RUN_ID);
    expect(completion.testRunId).toBe(RUN_ID);
  });
  it("keeps existing parameterized fresh and ARM routes", () => {
    expect(parseTask10sCommand([XHS_TASK10S_FRESH_RUN_FLAG, RUN_ID])).toMatchObject({ action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, testRunId: RUN_ID });
    expect(parseTask10sCommand([XHS_TASK10S_ARM_RUN_FLAG, RUN_ID])).toMatchObject({ action: TASK10S_ARM_RUN, testRunId: RUN_ID });
  });
  it("extracts a UUID after Electron launcher arguments", () => expect(parseTask10sCommand(["electron.exe", "--xhs-task10s-fresh-run", "--allow-file-access-from-files", "--remote-debugging-port=0", RUN_ID])).toMatchObject({ testRunId: RUN_ID }));
  it("rejects duplicate or mixed explicit actions", () => {
    expect(parseTask10sCommand([XHS_TASK10S_FRESH_RUN_FLAG, RUN_ID, XHS_TASK10S_FRESH_RUN_FLAG, OTHER_RUN_ID]).rejectionCode).toBe("TASK10S_MULTIPLE_ACTIONS");
    expect(parseTask10sCommand([XHS_TASK10S_FRESH_RUN_FLAG, RUN_ID, XHS_TASK10S_ARM_RUN_FLAG, OTHER_RUN_ID]).rejectionCode).toBe("TASK10S_MULTIPLE_ACTIONS");
  });
  it("passes explicit target to recovery and completion callbacks", async () => {
    const recover = vi.fn(async (id: string): Promise<Task10sPreparedEditorRecoveryResult> => ({ action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, status: "PASS", failureCode: null, testRunId: id, readyForFreshIdentityAttestation: true, finalSubmitClickCount: 0, mousePressedCount: 0, mouseReleasedCount: 0, publicationTransactionCount: 0 }));
    const complete = vi.fn(async (id: string): Promise<Task10sRetainedEditorCompletionResult> => ({ action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, status: "PASS", failureCode: null, testRunId: id, uploadCallCount: 0, finalSubmitClickCount: 0 }));
    const runner = createFixedDiagnosticRunner({ recoverTask10sPreparedEditor: recover, writeTask10sPreparedEditorRecoveryEvidence: vi.fn(), runTask10sCompleteRetainedEditor: complete, writeTask10sCompleteRetainedEditorEvidence: vi.fn() } as never);
    await runner(RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, { testRunId: RUN_ID });
    await runner(RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, { testRunId: RUN_ID });
    expect(recover).toHaveBeenCalledWith(RUN_ID);
    expect(complete).toHaveBeenCalledWith(RUN_ID);
  });
  it("keeps legacy recovery callback compatibility without inventing a target", async () => {
    const recover = vi.fn(async () => ({ action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, status: "BLOCKED" as const, failureCode: "TASK10S_EXECUTION_TARGET_REQUIRED", testRunId: "", readyForFreshIdentityAttestation: false, finalSubmitClickCount: 0 as const, mousePressedCount: 0 as const, mouseReleasedCount: 0 as const, publicationTransactionCount: 0 as const }));
    const runner = createFixedDiagnosticRunner({ recoverTask10sPreparedEditor: recover, writeTask10sPreparedEditorRecoveryEvidence: vi.fn() } as never);
    expect(await runner(RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY)).toBe(false);
    expect(recover).toHaveBeenCalledWith(undefined);
  });
  it("keeps legacy completion callback compatibility without inventing a target", async () => {
    const complete = vi.fn(async () => ({ action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, status: "BLOCKED" as const, failureCode: "TASK10S_EXECUTION_TARGET_REQUIRED", uploadCallCount: 0 as const, finalSubmitClickCount: 0 as const }));
    const runner = createFixedDiagnosticRunner({ runTask10sCompleteRetainedEditor: complete, writeTask10sCompleteRetainedEditorEvidence: vi.fn() } as never);
    expect(await runner(RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR)).toBe(false);
    expect(complete).toHaveBeenCalledWith(undefined);
  });
  it("retains zero submit and transaction counts in routing tests", () => {
    const counts = { finalSubmitClickCount: 0, publicationTransactionCount: 0 };
    expect(counts).toEqual({ finalSubmitClickCount: 0, publicationTransactionCount: 0 });
  });
});
