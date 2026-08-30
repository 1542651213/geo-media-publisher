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
});
