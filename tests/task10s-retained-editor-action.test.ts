import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createFixedDiagnosticRunner,
  parseDiagnosticAction,
  RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR,
  XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG
} from "../apps/desktop/src/main/diagnostic-trigger";

describe("Task10S retained-editor completion action", () => {
  it("accepts only the fixed no-argument second-instance action", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG])).toBe(RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG, "title"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG, "body"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe"], { action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR })).toBe(RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe"], { action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, pageId: "caller-page" })).toBeNull();
  });

  it("dispatches only the fixed retained-editor callback and preserves zero upload calls", async () => {
    const run = vi.fn(async () => ({
      action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR,
      status: "PASS" as const,
      failureCode: null,
      uploadCallCount: 0 as const,
      finalSubmitClickCount: 0 as const
    }));
    const write = vi.fn();
    const runner = createFixedDiagnosticRunner({
      probe: vi.fn(),
      writeEvidence: vi.fn(),
      runTask10sCompleteRetainedEditor: run,
      writeTask10sCompleteRetainedEditorEvidence: write
    });

    await expect(runner(RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    await expect(run.mock.results[0]?.value).resolves.toMatchObject({ uploadCallCount: 0, finalSubmitClickCount: 0 });
  });

  it("keeps the completion action Main-side and upload-free", () => {
    const source = readFileSync("apps/desktop/src/main/platform-self-test.ts", "utf8");
    const start = source.indexOf("async runTask10sCompleteRetainedEditor()");
    const end = source.indexOf("private async runTask10sControlledUploadAttempt(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const actionBody = source.slice(start, end);
    expect(actionBody).toContain("executeTask10sRetainedEditor");
    expect(actionBody).toContain("getPlatformSelfTestRun(TASK10S_CANONICAL_AUTHORIZATION_ID)");
    expect(actionBody).not.toContain("uploadImages");
    expect(actionBody).not.toContain("setInputFiles");
    expect(readFileSync("packages/adapters/xiaohongshu/src/browser.ts", "utf8")).toContain("const XIAOHONGSHU_FINAL_SUBMIT_SELECTOR = 'button, [role=\"button\"]';");
  });
});
