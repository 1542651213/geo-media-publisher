import { describe, expect, it } from "vitest";
import {
  parseTask10sCommand,
  RUN_XHS_TASK10S_ARM_RUN,
  RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW,
  XHS_TASK10S_ARM_RUN_FLAG,
  XHS_TASK10S_FRESH_RUN_FLAG
} from "../apps/desktop/src/main/diagnostic-trigger";

const RUN_ID = "4ce1c979-ebab-45fb-8726-786b972d815b";
const OTHER_RUN_ID = "c77c5a3c-ba67-4b07-bf82-000ceb7d8832";

describe("r53 Task10S command parser", () => {
  it("parses a run id immediately after the fresh flag", () => {
    expect(parseTask10sCommand(["electron.exe", XHS_TASK10S_FRESH_RUN_FLAG, RUN_ID])).toEqual({
      action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW,
      testRunId: RUN_ID,
      rejectionCode: null
    });
  });

  it("skips an Electron launcher option between the flag and run id", () => {
    expect(parseTask10sCommand(["electron.exe", XHS_TASK10S_FRESH_RUN_FLAG, "--allow-file-access-from-files", RUN_ID])).toMatchObject({
      action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW,
      testRunId: RUN_ID,
      rejectionCode: null
    });
  });

  it("skips multiple launcher options and keeps the UUID", () => {
    expect(parseTask10sCommand([
      "electron.exe",
      XHS_TASK10S_ARM_RUN_FLAG,
      "--allow-file-access-from-files",
      "--original-process-start-time=123",
      RUN_ID
    ])).toMatchObject({ action: RUN_XHS_TASK10S_ARM_RUN, testRunId: RUN_ID, rejectionCode: null });
  });

  it("ignores Electron arguments before the task flag", () => {
    expect(parseTask10sCommand([
      "electron.exe",
      "C:/publisher/app.asar",
      "--allow-file-access-from-files",
      XHS_TASK10S_ARM_RUN_FLAG,
      RUN_ID
    ])).toMatchObject({ action: RUN_XHS_TASK10S_ARM_RUN, testRunId: RUN_ID, rejectionCode: null });
  });

  it("finds the run id when it is the final argument", () => {
    expect(parseTask10sCommand(["electron.exe", XHS_TASK10S_FRESH_RUN_FLAG, "--allow-file-access-from-files", "--window-size=1,1", RUN_ID])).toMatchObject({
      action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW,
      testRunId: RUN_ID
    });
  });

  it("rejects a missing run id", () => {
    expect(parseTask10sCommand(["electron.exe", XHS_TASK10S_ARM_RUN_FLAG, "--allow-file-access-from-files"])).toMatchObject({
      action: null,
      testRunId: null,
      rejectionCode: "TASK10S_TEST_RUN_ID_REQUIRED"
    });
  });

  it("rejects a non UUID run id", () => {
    expect(parseTask10sCommand(["electron.exe", XHS_TASK10S_FRESH_RUN_FLAG, "run-a"])).toMatchObject({
      action: null,
      testRunId: null,
      rejectionCode: "TASK10S_INVALID_RUN_ID"
    });
  });

  it("rejects duplicate task actions", () => {
    expect(parseTask10sCommand(["electron.exe", XHS_TASK10S_ARM_RUN_FLAG, RUN_ID, XHS_TASK10S_ARM_RUN_FLAG, OTHER_RUN_ID])).toMatchObject({
      action: null,
      testRunId: null,
      rejectionCode: "TASK10S_MULTIPLE_ACTIONS"
    });
  });

  it("rejects mixed fresh and ARM actions", () => {
    expect(parseTask10sCommand(["electron.exe", XHS_TASK10S_FRESH_RUN_FLAG, RUN_ID, XHS_TASK10S_ARM_RUN_FLAG, OTHER_RUN_ID])).toMatchObject({
      action: null,
      testRunId: null,
      rejectionCode: "TASK10S_MULTIPLE_ACTIONS"
    });
  });

  it("reports no handling when no Task10S parameterized flag is present", () => {
    expect(parseTask10sCommand(["electron.exe", "--allow-file-access-from-files"])).toEqual({
      action: null,
      testRunId: null,
      rejectionCode: null
    });
  });
});
