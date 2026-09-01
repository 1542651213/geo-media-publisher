import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Task10R exploration wiring contract", () => {
  it("exposes one exact exploration mode through the typed renderer and IPC boundary", () => {
    const api = source("apps/desktop/src/shared/api.ts");
    const preload = source("apps/desktop/src/main/preload.ts");
    const ipc = source("apps/desktop/src/main/ipc.ts");
    expect(api).toContain("runPublishFlowExploration");
    expect(api).toContain('mode: "XHS_PUBLISH_FLOW_EXPLORATION"');
    expect(preload).toContain('invoke("platform-self-test:run-publish-flow-exploration", input)');
    expect(ipc).toContain('mode: z.literal("XHS_PUBLISH_FLOW_EXPLORATION")');
    expect(ipc).toContain("runPublishFlowExploration(input.platformAccountId, input.mode)");
  });

  it("keeps exploration account-scoped, safe-fixture-only, and outside publish-domain creation", () => {
    const service = source("apps/desktop/src/main/platform-self-test.ts");
    const start = service.indexOf("async runPublishFlowExploration(");
    const end = service.indexOf("\n  async continue(", start);
    const block = service.slice(start, end);
    expect(block).toContain('platformKey === "xiaohongshu"');
    expect(block).toContain("this.controlledOperations");
    expect(block).toContain("getPublishDomainCounts");
    expect(block).toContain('imageSource: "SAFE_TEST_FIXTURE"');
    expect(service).toContain("xiaohongshu-task10r-publish-flow-exploration.json");
    expect(block).toContain("finalSubmitCount: persistedResult.finalSubmitCount");
    expect(block).not.toContain("createPublishJob");
    expect(block).not.toContain("createSubmissionIntent");
    expect(block).not.toContain("createPublishRecord");
  });

  it("provides the exploration confirmation in both live account entry points", () => {
    const shared = source("apps/desktop/src/shared/controlled-self-test-entry.ts");
    const accountCenter = source("apps/desktop/src/renderer/V11Workspace.tsx");
    const selfTestCenter = source("apps/desktop/src/renderer/PlatformSelfTestCenter.tsx");
    expect(shared).toContain("PUBLISH_FLOW_EXPLORATION_CONFIRMATION");
    expect(shared).toContain("不会点击最终发布");
    expect(accountCenter).toContain("探索发布流程（不发布）");
    expect(accountCenter).toContain("platformSelfTest.runPublishFlowExploration(request)");
    expect(selfTestCenter).toContain("探索发布流程（不发布）");
    expect(selfTestCenter).toContain("platformSelfTest.runPublishFlowExploration(request)");
  });

  it("keeps final-submit discovery read-only", () => {
    const browser = source("packages/adapters/xiaohongshu/src/browser.ts");
    const start = browser.indexOf("private async inspectFinalSubmitForExploration");
    const end = browser.indexOf("\n  private async satisfyRequiredSettings", start);
    const block = browser.slice(start, end);
    expect(block).toContain("isVisible");
    expect(block).toContain("isEnabled");
    expect(block).toContain("locatorHitTestValid");
    expect(block).not.toMatch(/\.click\s*\(/u);
    expect(block).not.toMatch(/\.press\s*\(/u);
    expect(block).not.toMatch(/\.fill\s*\(/u);
    expect(block).not.toContain("form.submit");
  });
});
