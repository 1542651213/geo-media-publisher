import { describe, expect, it } from "vitest";
import {
  parseDiagnosticActionWithTrace,
  RUN_XHS_TASK10S_ARM_RUN,
  RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW,
  XHS_TASK10S_ARM_RUN_FLAG,
  XHS_TASK10S_FRESH_RUN_FLAG
} from "../apps/desktop/src/main/diagnostic-trigger";

const RUN_ID = "4ce1c979-ebab-45fb-8726-786b972d815b";

describe("r52 parameterized Task10S routing", () => {
  it("scans the full second-instance argv for ARM and binds the following run id", () => {
    const parsed = parseDiagnosticActionWithTrace([
      "electron.exe",
      "C:/publisher/app.asar",
      "launcher-extra",
      "--allow-file-access-from-files",
      XHS_TASK10S_ARM_RUN_FLAG,
      RUN_ID
    ]);

    expect(parsed.action).toBe(RUN_XHS_TASK10S_ARM_RUN);
    expect(parsed.testRunId).toBe(RUN_ID);
  });

  it("keeps the explicit ARM run id when trailing launcher arguments are present", () => {
    const parsed = parseDiagnosticActionWithTrace([
      "electron.exe",
      "launcher-extra",
      XHS_TASK10S_ARM_RUN_FLAG,
      RUN_ID,
      "--original-process-start-time=123",
      "trailing-launcher-argument"
    ]);

    expect(parsed.action).toBe(RUN_XHS_TASK10S_ARM_RUN);
    expect(parsed.testRunId).toBe(RUN_ID);
  });

  it("returns the required-id rejection when a parameterized flag has no run id", () => {
    const parsed = parseDiagnosticActionWithTrace([
      "electron.exe",
      "launcher-extra",
      XHS_TASK10S_ARM_RUN_FLAG,
      "--allow-file-access-from-files"
    ]);

    expect(parsed.action).toBeNull();
    expect(parsed.testRunId).toBeNull();
    expect(parsed.trace.actionParseRejectionCode).toBe("TASK10S_TEST_RUN_ID_REQUIRED");
  });

  it("parses an explicit fresh-flow run id from the new flag", () => {
    const parsed = parseDiagnosticActionWithTrace([
      "electron.exe",
      "app-path",
      XHS_TASK10S_FRESH_RUN_FLAG,
      RUN_ID,
      "launcher-extra"
    ]);

    expect(parsed.action).toBe(RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW);
    expect(parsed.testRunId).toBe(RUN_ID);
  });

  it("does not fall back when the fresh-flow run id is missing", () => {
    const parsed = parseDiagnosticActionWithTrace(["electron.exe", XHS_TASK10S_FRESH_RUN_FLAG]);

    expect(parsed.action).toBeNull();
    expect(parsed.testRunId).toBeNull();
    expect(parsed.trace.actionParseRejectionCode).toBe("TASK10S_TEST_RUN_ID_REQUIRED");
  });

  it("lets an explicit parameterized command win over stale Electron additionalData", () => {
    const parsed = parseDiagnosticActionWithTrace(
      ["electron.exe", "launcher-extra", XHS_TASK10S_ARM_RUN_FLAG, RUN_ID],
      { action: "RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR" }
    );

    expect(parsed.action).toBe(RUN_XHS_TASK10S_ARM_RUN);
    expect(parsed.testRunId).toBe(RUN_ID);
  });
});
