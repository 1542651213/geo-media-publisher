import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM, RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG, XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG } from "../apps/desktop/src/main/diagnostic-trigger";

describe("Task10S r31 offline release contract", () => {
  it("retains r30 global exact diagnostic and exposes the fixed completion action", () => {
    const triggerSource = readFileSync("apps/desktop/src/main/diagnostic-trigger.ts", "utf8");
    const mainSource = readFileSync("apps/desktop/src/main/main.ts", "utf8");
    expect(XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG).toBe("--xhs-task10s-global-exact-publish-dom-diagnostic");
    expect(INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM).toBe("INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM");
    expect(XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG).toBe("--xhs-task10s-complete-retained-editor");
    expect(RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR).toBe("RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR");
    expect(triggerSource).toContain("INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM");
    expect(triggerSource).toContain("RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR");
    expect(mainSource).toContain("runTask10sCompleteRetainedEditor");
  });

  it("keeps normal production final-submit resolution separate", () => {
    const browserSource = readFileSync("packages/adapters/xiaohongshu/src/browser.ts", "utf8");
    expect(browserSource).toContain("const XIAOHONGSHU_FINAL_SUBMIT_SELECTOR = 'button, [role=\"button\"]';");
    expect(browserSource).toContain("private async performOneShotFinalSubmit");
    expect(browserSource).toContain("task10sRetainedEditor");
  });

  it("keeps the fixed completion action upload-free and records picker provenance conservatively", () => {
    const selfTestSource = readFileSync("apps/desktop/src/main/platform-self-test.ts", "utf8");
    const mainSource = readFileSync("apps/desktop/src/main/main.ts", "utf8");
    const start = selfTestSource.indexOf("async runTask10sCompleteRetainedEditor()");
    const end = selfTestSource.indexOf("private async runTask10sControlledUploadAttempt(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const actionSource = selfTestSource.slice(start, end);
    expect(actionSource).not.toContain("uploadImages");
    expect(actionSource).not.toContain("setInputFiles");
    expect(actionSource).toContain("executeTask10sRetainedEditor");
    expect(mainSource).toContain('OPEN_FILE_PICKER_QUERY_SOURCE: "NOT_PROVEN"');
  });
});
