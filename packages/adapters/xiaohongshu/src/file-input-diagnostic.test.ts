import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  containsExpectedXiaohongshuSafeFixture,
  inspectXiaohongshuFileInputState,
  type XiaohongshuFileInputDomSnapshot
} from "./file-input-diagnostic";

const expectedFile = {
  name: "task10s-safe-test.png",
  size: 19226,
  type: "image/png",
  lastModified: 1788393600000,
  expectedFixtureMatch: true
} as const;

function snapshot(overrides: Partial<XiaohongshuFileInputDomSnapshot> = {}): XiaohongshuFileInputDomSnapshot {
  return {
    origin: "https://creator.xiaohongshu.com",
    pathname: "/publish/publish",
    readyState: "complete",
    matchCount: 1,
    inputs: [{
      type: "file",
      accept: "image/*",
      multiple: false,
      disabled: false,
      connected: true,
      classNameSafe: "upload-input",
      ancestorFingerprint: [{ tagName: "DIV", classNameSafe: "upload-panel" }],
      filesLength: 1,
      files: [expectedFile]
    }],
    ...overrides
  };
}

describe("Xiaohongshu file-input diagnostic", () => {
  it("correlates the expected fixture using only safe File metadata", () => {
    expect(containsExpectedXiaohongshuSafeFixture(snapshot().inputs)).toBe("YES");
  });

  it("does not claim delivery when the current input is empty", () => {
    const current = snapshot({ inputs: [{ ...snapshot().inputs[0]!, filesLength: 0, files: [] }] });
    expect(containsExpectedXiaohongshuSafeFixture(current.inputs)).toBe("NO");
  });

  it("fails closed for multiple ambiguous inputs and mismatched files", () => {
    const current = snapshot({ inputs: [
      snapshot().inputs[0]!,
      { ...snapshot().inputs[0]!, files: [{ ...expectedFile }] }
    ] });
    expect(containsExpectedXiaohongshuSafeFixture(current.inputs)).toBe("NOT_PROVEN");
  });

  it("keeps the evaluator fixed, bounded, and read-only", async () => {
    const page = {
      evaluate: vi.fn(async (callback: () => unknown) => {
        const source = String(callback);
        expect(source).toContain('input[type="file"]');
        expect(source).not.toMatch(/FileReader|arrayBuffer|text\(|setInputFiles|filechooser|\.click\(|\.goto\(|reload/iu);
        return snapshot();
      })
    };

    await inspectXiaohongshuFileInputState(page as unknown as Page);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls[0]).toHaveLength(1);
  });

  it("does not expose arbitrary file names as a diagnostic contract", () => {
    const source = String(inspectXiaohongshuFileInputState);
    expect(source).not.toMatch(/\bfilePath\b|\bscript\b|\bxpath\b|\bcss\b/iu);
  });
});
