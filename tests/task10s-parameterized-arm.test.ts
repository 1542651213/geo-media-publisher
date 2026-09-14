import { describe, expect, it, vi } from "vitest";
import {
  createFixedDiagnosticRunner,
  parseDiagnosticAction,
  parseDiagnosticActionWithTrace,
  XHS_TASK10S_ARM_RUN_FLAG,
  RUN_XHS_TASK10S_ARM_RUN
} from "../apps/desktop/src/main/diagnostic-trigger";

describe("r52 parameterized Task10S ARM routing", () => {
  it("accepts an explicit testRunId instead of silently selecting the historical run", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, "run-a"])).toBe(RUN_XHS_TASK10S_ARM_RUN);
  });

  it("rejects the parameterized ARM flag when the run id is missing", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG])).toBeNull();
  });

  it("keeps the explicit id when trailing launcher tokens are present", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, "run-a", "extra"])).toBe(RUN_XHS_TASK10S_ARM_RUN);
    expect(parseDiagnosticActionWithTrace(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, "run-a"]).testRunId).toBe("run-a");
  });

  it("passes the explicit id to the ARM-only runner and never invokes completion", async () => {
    const arm = vi.fn(async (testRunId: string) => ({ action: RUN_XHS_TASK10S_ARM_RUN, status: "PASS" as const, failureCode: null, requestedTestRunId: testRunId, resolvedTestRunId: testRunId, accountId: "account", authorizationState: "AUTHORIZED_UNUSED" as const, preparedJobMediaGate: "PASS" as const, armOnly: "YES" as const, completionExecuted: "NO" as const, finalSubmitClickCount: 0 as const, mousePressedCount: 0 as const, publicationTransactionCount: 0 as const }));
    const completion = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn(), armTask10sRun: arm, writeTask10sArmRunEvidence: vi.fn(), runTask10sCompleteRetainedEditor: completion, writeTask10sCompleteRetainedEditorEvidence: vi.fn() });
    const action = parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ARM_RUN_FLAG, "run-a"]);
    expect(await runner(action!, { testRunId: "run-a" })).toBe(true);
    expect(arm).toHaveBeenCalledWith("run-a");
    expect(completion).not.toHaveBeenCalled();
  });
});
