import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDiagnosticAction } from "../apps/desktop/src/main/diagnostic-trigger";

const read = (path: string): string => readFileSync(path, "utf8");

describe("Task10S closed-shadow final-submit diagnostic", () => {
  it("accepts only the fixed no-argument action", () => {
    expect(parseDiagnosticAction(["publisher.exe", "--xhs-task10s-closed-shadow-final-submit-diagnostic"])).toBe("INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT");
    expect(parseDiagnosticAction(["publisher.exe", "--xhs-task10s-closed-shadow-final-submit-diagnostic", "selector"])).toBeNull();
  });

  it("routes the selected Main action to the existing closed-shadow resolver", () => {
    const main = read("apps/desktop/src/main/main.ts");
    const service = read("apps/desktop/src/main/platform-self-test.ts");
    const identity = read("apps/desktop/src/main/xhs-identity.ts");
    const browser = read("packages/adapters/xiaohongshu/src/browser.ts");

    expect(main).toContain("platformSelfTests.inspectCurrentXiaohongshuClosedShadowFinalSubmit(resolveXhsAccountId())");
    expect(service).toContain("inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId?: string): Promise<");
    expect(identity).toContain("inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId: string)");
    expect(browser).toContain("inspectTask10sClosedShadowPublishSurface(canonical.page)");
  });

  it("keeps the new adapter method readonly and route-gated", () => {
    const source = read("packages/adapters/xiaohongshu/src/browser.ts");
    const start = source.indexOf("inspectCurrentXiaohongshuClosedShadowFinalSubmit");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start, source.indexOf("\n  async ", start + 10));
    expect(body).toContain("/publish/publish");
    expect(body).toContain("https://creator.xiaohongshu.com");
    expect(body).toContain("inspectTask10sClosedShadowPublishSurface");
    expect(body).not.toMatch(/\.click\s*\(|mousePressed|mouseReleased|setInputFiles|\.fill\s*\(|\.goto\s*\(|\.reload\s*\(/u);
  });

  it("records structured evidence without exposing the page or caller selector", () => {
    const trigger = read("apps/desktop/src/main/diagnostic-trigger.ts");
    const main = read("apps/desktop/src/main/main.ts");
    expect(trigger).toContain("XHS_CLOSED_SHADOW_FINAL_SUBMIT_DIAGNOSTIC_FLAG");
    expect(main).toContain("CLOSED_SHADOW_FINAL_SUBMIT_SURFACE");
    expect(main).not.toContain("async (_event, payload) => platformSelfTests.inspectCurrentXiaohongshuClosedShadowFinalSubmit");
  });
});
