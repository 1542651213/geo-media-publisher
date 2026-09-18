import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildTask10sFreshPublishFlowInput,
  isTask10sFreshPublishFlowReady,
  isTask10sFreshPublishStartPath,
  XHS_TASK10S_FRESH_PUBLISH_FLOW_BODY,
  XHS_TASK10S_FRESH_PUBLISH_FLOW_TITLE
} from "../apps/desktop/src/main/task10s-fresh-publish-flow";
import { parseDiagnosticAction } from "../apps/desktop/src/main/diagnostic-trigger";

describe("Task10S fresh publish flow contract", () => {
  it("builds the fixed fresh-flow payload without accepting caller content", () => {
    const input = buildTask10sFreshPublishFlowInput("C:/controlled/task10s-safe-test.png", "operation-1");

    expect(input).toMatchObject({
      imagePath: "C:/controlled/task10s-safe-test.png",
      imageSource: "SAFE_TEST_FIXTURE",
      title: XHS_TASK10S_FRESH_PUBLISH_FLOW_TITLE,
      body: XHS_TASK10S_FRESH_PUBLISH_FLOW_BODY,
      operationId: "operation-1",
      budgets: {
        maxUploadAttempts: 1,
        maxTitleMutations: 1,
        maxBodyMutations: 1,
        maxNavigationRestarts: 0,
        maxRefreshCount: 0
      }
    });
  });

  it("accepts only Creator Home paths as the fresh-flow starting surface", () => {
    expect(isTask10sFreshPublishStartPath("/")).toBe(true);
    expect(isTask10sFreshPublishStartPath("/new/home")).toBe(true);
    expect(isTask10sFreshPublishStartPath("/publish/publish")).toBe(false);
    expect(isTask10sFreshPublishStartPath("/new/note-manager")).toBe(false);
  });

  it("requires every fresh-flow gate before reporting ready", () => {
    const ready = {
      identityVerified: true,
      newPublishEntryPass: true,
      uploadProofPass: true,
      titleReadbackExact: true,
      bodyReadbackExact: true,
      finalPublishButtonMatchCount: 1,
      finalPublishEnabled: true,
      finalSubmitCount: 0
    };

    expect(isTask10sFreshPublishFlowReady(ready)).toBe(true);
    expect(isTask10sFreshPublishFlowReady({ ...ready, identityVerified: false })).toBe(false);
    expect(isTask10sFreshPublishFlowReady({ ...ready, uploadProofPass: false })).toBe(false);
    expect(isTask10sFreshPublishFlowReady({ ...ready, finalPublishButtonMatchCount: 2 })).toBe(false);
  });

  it("parses only the fixed fresh-flow flag", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--xhs-task10s-fresh-publish-flow"])).toBe("RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW");
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--xhs-task10s-fresh-publish-flow", "caller-title"])).toBeNull();
  });

  it("exposes a fixed Main action without changing the existing exploration action", () => {
    const trigger = readFileSync("apps/desktop/src/main/diagnostic-trigger.ts", "utf8");
    const main = readFileSync("apps/desktop/src/main/main.ts", "utf8");
    const service = readFileSync("apps/desktop/src/main/platform-self-test.ts", "utf8");
    const flow = readFileSync("apps/desktop/src/main/task10s-fresh-publish-flow.ts", "utf8");

    expect(trigger).toContain("XHS_TASK10S_FRESH_PUBLISH_FLOW_FLAG");
    expect(trigger).toContain("RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW");
    expect(main).toContain("runTask10sFreshPublishFlow");
    expect(service).toContain("task10s-safe-test.png");
    expect(flow).toContain("自动化发布测试1｜请忽略");
    expect(flow).toContain("GEO Media Publisher 自动发布链路测试。");
    expect(service).toContain("XHS_FRESH_PUBLISH_FLOW");
    expect(service).toContain("async runPublishFlowExploration");
    expect(service).toContain("task10r-safe-test.png");
  });

  it("consumes the terminal readiness classifier before fresh-flow content fill", () => {
    const browser = readFileSync("packages/adapters/xiaohongshu/src/browser.ts", "utf8");
    const classifierUse = browser.indexOf("const terminalReadiness = classifyXiaohongshuPostUploadTerminalReadiness(");
    const titleFill = browser.indexOf("const title = await this.exploreEditorField");

    expect(classifierUse).toBeGreaterThan(-1);
    expect(titleFill).toBeGreaterThan(classifierUse);
    expect(browser.slice(classifierUse, titleFill)).toContain("terminalReadiness.ready");
    expect(browser.slice(classifierUse, titleFill)).toContain("return buildResult(\"BLOCKED\")");
  });

  it("marks the fixed Task10S input to use the existing classifier", () => {
    const service = readFileSync("apps/desktop/src/main/task10s-fresh-publish-flow.ts", "utf8");
    expect(service).toContain('postUploadReadinessStrategy: "TERMINAL_CLASSIFIER"');
  });
});
