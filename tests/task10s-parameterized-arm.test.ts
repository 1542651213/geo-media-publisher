import { describe, expect, it, vi } from "vitest";
import {
  createFixedDiagnosticRunner,
  parseDiagnosticAction,
  parseDiagnosticActionWithTrace,
  XHS_TASK10S_ARM_RUN_FLAG,
  RUN_XHS_TASK10S_ARM_RUN
} from "../apps/desktop/src/main/diagnostic-trigger";

const RUN_ID = "4ce1c979-ebab-45fb-8726-786b972d815b";

describe("r52 parameterized Task10S ARM routing", () => {
  it("accepts an explicit testRunId instead of silently selecting the historical run", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, RUN_ID])).toBe(RUN_XHS_TASK10S_ARM_RUN);
  });

  it("rejects the parameterized ARM flag when the run id is missing", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG])).toBeNull();
  });

  it("keeps the explicit id when trailing launcher tokens are present", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, RUN_ID, "extra"])).toBe(RUN_XHS_TASK10S_ARM_RUN);
    expect(parseDiagnosticActionWithTrace(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, RUN_ID]).testRunId).toBe(RUN_ID);
  });

  it("passes the explicit id to the ARM-only runner and never invokes completion", async () => {
    const arm = vi.fn(async (testRunId: string) => ({ action: RUN_XHS_TASK10S_ARM_RUN, status: "PASS" as const, failureCode: null, requestedTestRunId: testRunId, resolvedTestRunId: testRunId, accountId: "account", authorizationState: "AUTHORIZED_UNUSED" as const, preparedJobMediaGate: "PASS" as const, armOnly: "YES" as const, completionExecuted: "NO" as const, finalSubmitClickCount: 0 as const, mousePressedCount: 0 as const, publicationTransactionCount: 0 as const }));
    const completion = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn(), armTask10sRun: arm, writeTask10sArmRunEvidence: vi.fn(), runTask10sCompleteRetainedEditor: completion, writeTask10sCompleteRetainedEditorEvidence: vi.fn() });
    const action = parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, RUN_ID]);
    expect(await runner(action!, { testRunId: RUN_ID })).toBe(true);
    expect(arm).toHaveBeenCalledWith(RUN_ID);
    expect(completion).not.toHaveBeenCalled();
  });
});
