import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("side-effect-free Xiaohongshu pre-submit gate contract", () => {
  it("exposes a distinct adapter gate contract and IPC entry", () => {
    const core = read("packages/adapters/core/src/automation.ts");
    const xhs = read("packages/adapters/xiaohongshu/src/browser.ts");
    const api = read("apps/desktop/src/shared/api.ts");
    const preload = read("apps/desktop/src/main/preload.ts");
    const ipc = read("apps/desktop/src/main/ipc.ts");

    expect(core).toContain("PreSubmitGateResult");
    expect(core).toContain("inspectPublishEditor");
    expect(xhs).toContain("inspectPublishEditor");
    expect(xhs).toContain('"PRE_SUBMIT_GATE"');
    expect(api).toContain("inspectPublishEditor");
    expect(preload).toContain("accounts:pre-submit-gate");
    expect(ipc).toContain('register("accounts:pre-submit-gate"');
  });

  it("keeps editor gate mutation-free by contract", () => {
    const xhs = read("packages/adapters/xiaohongshu/src/browser.ts");
    const gateStart = xhs.indexOf("inspectPublishEditor");
    const gateEnd = gateStart >= 0 ? xhs.indexOf("preparePublish", gateStart) : -1;
    const gateMethod = gateStart >= 0 ? xhs.slice(gateStart, gateEnd >= 0 ? gateEnd : xhs.length) : "";

    expect(gateMethod).toContain("activeCanonicalPage");
    expect(gateMethod).toContain("PRE_SUBMIT_GATE");
    expect(gateMethod).not.toContain("preparePublish(");
    expect(gateMethod).not.toContain("setInputFiles(");
    expect(gateMethod).not.toContain(".fill(");
    expect(gateMethod).not.toContain(".type(");
    expect(gateMethod).not.toContain("keyboard.press(");
  });

  it("separates editor shell readiness from post-route control discovery", () => {
    const xhs = read("packages/adapters/xiaohongshu/src/browser.ts");
    const discovery = read("packages/adapters/xiaohongshu/src/image-editor-discovery.ts");
    expect(xhs).toContain("inspectImagePostEditor");
    expect(xhs).toContain("preSubmitGateResultFromEditorInspection");
    expect(xhs).toContain('"EDITOR_DISCOVERY"');
    expect(discovery).toContain('"IMAGE_EDITOR_SHELL_READY"');
    expect(discovery).toContain('"IMAGE_EDITOR_READINESS_SAMPLE"');
    expect(discovery).toContain('"TITLE_EDITOR_NOT_FOUND"');
    expect(discovery).toContain('"BODY_EDITOR_NOT_FOUND"');
    expect(discovery).toContain('"IMAGE_UPLOAD_CONTROL_NOT_FOUND"');
    expect(discovery).toContain('"FINAL_SUBMIT_CONTROL_NOT_FOUND"');
  });

  it("keeps publish settings observable without making them a required Gate control", () => {
    const xhs = read("packages/adapters/xiaohongshu/src/browser.ts");
    const discovery = read("packages/adapters/xiaohongshu/src/image-editor-discovery.ts");
    expect(discovery).toContain('"NOT_APPLICABLE"');
    expect(xhs).toContain("publishSettingsAreaDetected");
  });
});
