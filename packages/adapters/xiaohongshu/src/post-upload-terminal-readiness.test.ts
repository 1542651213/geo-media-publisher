import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDiagnosticAction } from "../../../../apps/desktop/src/main/diagnostic-trigger";
import {
  classifyXiaohongshuPostUploadTerminalReadiness,
  type XiaohongshuPostUploadTerminalReadinessInput
} from "./post-upload-terminal-readiness";

function readyInput(overrides: Partial<XiaohongshuPostUploadTerminalReadinessInput> = {}): XiaohongshuPostUploadTerminalReadinessInput {
  return {
    originalPostUploadState: "AMBIGUOUS",
    editorScopedImageAssetCount: 1,
    imageCounterTextSafe: "1/18",
    titleControlPresent: true,
    bodyControlPresent: true,
    uploadErrorSignalPresent: false,
    busySignalPresent: false,
    ...overrides
  };
}

describe("Xiaohongshu post-upload terminal readiness", () => {
  it("promotes a completed image editor to EDITOR_READY without requiring final-submit evidence", () => {
    const result = classifyXiaohongshuPostUploadTerminalReadiness(readyInput());

    expect(result).toMatchObject({
      postUploadState: "EDITOR_READY",
      ready: true,
      imageCounterValid: true,
      blockerCodes: []
    });
  });

  it("reports every failed terminal gate and preserves the original state", () => {
    const result = classifyXiaohongshuPostUploadTerminalReadiness(readyInput({
      originalPostUploadState: "PROCESSING",
      editorScopedImageAssetCount: 0,
      imageCounterTextSafe: "0/18",
      titleControlPresent: false,
      bodyControlPresent: false,
      uploadErrorSignalPresent: true,
      busySignalPresent: true
    }));

    expect(result.ready).toBe(false);
    expect(result.postUploadState).toBe("PROCESSING");
    expect(result.blockerCodes).toEqual([
      "IMAGE_ASSET_MISSING",
      "IMAGE_COUNTER_INVALID",
      "TITLE_CONTROL_MISSING",
      "BODY_CONTROL_MISSING",
      "UPLOAD_ERROR_PRESENT",
      "BUSY_SIGNAL_PRESENT"
    ]);
  });

  it("accepts delayed title/body once all readonly terminal conditions are true", () => {
    const transitioning = classifyXiaohongshuPostUploadTerminalReadiness(readyInput({ titleControlPresent: false, bodyControlPresent: false }));
    const terminal = classifyXiaohongshuPostUploadTerminalReadiness(readyInput());

    expect(transitioning.ready).toBe(false);
    expect(terminal.postUploadState).toBe("EDITOR_READY");
    expect(terminal.ready).toBe(true);
  });

  it.each([
    ["asset missing", { editorScopedImageAssetCount: 0 }, "IMAGE_ASSET_MISSING"],
    ["invalid counter", { imageCounterTextSafe: "0/18" }, "IMAGE_COUNTER_INVALID"],
    ["upload error", { uploadErrorSignalPresent: true }, "UPLOAD_ERROR_PRESENT"],
    ["busy", { busySignalPresent: true }, "BUSY_SIGNAL_PRESENT"],
    ["title missing", { titleControlPresent: false }, "TITLE_CONTROL_MISSING"],
    ["body missing", { bodyControlPresent: false }, "BODY_CONTROL_MISSING"]
  ] as const)("blocks when %s", (_name, overrides, blocker) => {
    const result = classifyXiaohongshuPostUploadTerminalReadiness(readyInput(overrides));

    expect(result.ready).toBe(false);
    expect(result.postUploadState).toBe("AMBIGUOUS");
    expect(result.blockerCodes).toContain(blocker);
  });

  it("returns a readonly result without invoking page or mutation operations", () => {
    const input = Object.freeze(readyInput());

    const result = classifyXiaohongshuPostUploadTerminalReadiness(input);

    expect(result).toMatchObject({ ready: true, postUploadState: "EDITOR_READY" });
    expect(input).toMatchObject({ editorScopedImageAssetCount: 1, imageCounterTextSafe: "1/18" });
  });

  it("parses only the fixed readonly terminal-readiness action", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--xhs-task10s-post-upload-terminal-readiness"])).toBe("INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS");
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--xhs-task10s-post-upload-terminal-readiness", "selector"])).toBeNull();
  });

  it("wires a fixed current-page diagnostic without mutation or changing the fresh-flow runner", () => {
    const trigger = readFileSync("apps/desktop/src/main/diagnostic-trigger.ts", "utf8");
    const main = readFileSync("apps/desktop/src/main/main.ts", "utf8");
    const service = readFileSync("apps/desktop/src/main/xhs-identity.ts", "utf8");

    expect(trigger).toContain("INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS");
    expect(main).toContain("inspectCurrentXiaohongshuPostUploadTerminalReadiness");
    expect(service).toContain("inspectCurrentXiaohongshuPostUploadTerminalReadiness");
    const terminalActionBranch = trigger.slice(trigger.indexOf("if (action === INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS"));
    expect(terminalActionBranch).not.toContain("setInputFiles");
    expect(terminalActionBranch).not.toContain("mousePressed");
  });
});
