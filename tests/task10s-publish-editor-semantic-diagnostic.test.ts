import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import {
  inspectXiaohongshuPublishEditorSemanticCandidates,
  resolveXiaohongshuFinalSubmitControlState,
  type XiaohongshuPublishEditorSemanticFinalPublishNodeSafe
} from "../packages/adapters/xiaohongshu/src/publish-editor-semantic-diagnostic";

const read = (path: string): string => readFileSync(path, "utf8");

describe("Task10S publish-editor semantic candidate diagnostic contract", () => {
  it("exposes one account-bound Main/IPC/preload path", () => {
    const browser = read("packages/adapters/xiaohongshu/src/browser.ts");
    const identity = read("apps/desktop/src/main/xhs-identity.ts");
    const service = read("apps/desktop/src/main/platform-self-test.ts");
    const ipc = read("apps/desktop/src/main/ipc.ts");
    const preload = read("apps/desktop/src/main/preload.ts");
    const api = read("apps/desktop/src/shared/api.ts");

    expect(browser).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(ctx: AccountContext)");
    expect(identity).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(accountId: string)");
    expect(service).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(accountId?: string): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>");
    expect(ipc).toContain('register("platform-self-test:inspect-current-xhs-publish-editor-semantic-candidates", async (_event, payload) =>');
    expect(preload).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates: (accountId) => invoke(\"platform-self-test:inspect-current-xhs-publish-editor-semantic-candidates\", { accountId })");
    expect(api).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(accountId: string): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>");
    expect(preload).not.toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates: (input");
    expect(ipc).not.toContain("inspect-current-xhs-publish-editor-semantic-candidates\", async ()");
  });

  it("keeps the live diagnostic fixed-label, bounded, and read-only", () => {
    const source = read("packages/adapters/xiaohongshu/src/publish-editor-semantic-diagnostic.ts");
    for (const label of ["上传视频", "上传图文", "写长文", "发播客", "上传图片"]) expect(source).toContain(label);
    expect(source).toContain('querySelectorAll("*")');
    expect(source).toContain("maxAncestors = 5");
    expect(source).toContain('input[type="file"]');
    expect(source).not.toMatch(/setInputFiles|\.click\s*\(/u);
    expect(source).not.toMatch(/outerHTML|innerHTML|React|Vue|event\.listener/iu);
    expect(source).not.toMatch(/selector\??\s*:/u);
  });

  it("includes bounded final-submit PRESENT and ENABLED evidence in the reused inspector", () => {
    const source = read("packages/adapters/xiaohongshu/src/publish-editor-semantic-diagnostic.ts");
    expect(source).toContain("finalPublishExactTextMatchCount");
    expect(source).toContain("finalPublishNativeButtonMatchCount");
    expect(source).toContain("finalPublishRoleButtonMatchCount");
    expect(source).toContain("finalPublishCandidatesSafe");
    expect(source).toContain("finalPublishContainerSafe");
    expect(source).toContain("finalSubmitControlPresent");
    expect(source).toContain("finalSubmitControlEnabled");
  });

  it("separates final-submit presence from enabled state without guessing ambiguous controls", () => {
    const candidate = (overrides: Partial<Pick<XiaohongshuPublishEditorSemanticFinalPublishNodeSafe, "connected" | "rendered" | "boundingRect" | "pointerEvents" | "enabled">> = {}) => ({
      connected: true,
      rendered: true,
      boundingRect: { x: 0, y: 0, left: 0, top: 0, right: 80, bottom: 32, width: 80, height: 32 },
      pointerEvents: "auto",
      enabled: true,
      ...overrides
    });

    expect(resolveXiaohongshuFinalSubmitControlState([candidate()])).toEqual({ present: "YES", enabled: "YES" });
    expect(resolveXiaohongshuFinalSubmitControlState([candidate({ enabled: false })])).toEqual({ present: "YES", enabled: "NO" });
    expect(resolveXiaohongshuFinalSubmitControlState([candidate({ pointerEvents: "none" })])).toEqual({ present: "NO", enabled: "NOT_PROVEN" });
    expect(resolveXiaohongshuFinalSubmitControlState([candidate(), candidate({ enabled: false })])).toEqual({ present: "AMBIGUOUS", enabled: "NOT_PROVEN" });
  });

  it("accepts fixed final labels from text, aria-label, and title while keeping bounded ambiguity", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <button id="text" style="width:80px;height:32px">发布</button>
      `);
      const textResult = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(textResult.finalPublishExactTextMatchCount).toBe(1);
      expect(textResult.finalSubmitControlPresent).toBe("YES");
      expect(textResult.finalSubmitControlEnabled).toBe("YES");

      await page.setContent(`
        <button aria-label="发布" style="width:80px;height:32px"></button>
      `);
      const ariaResult = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(ariaResult.finalPublishExactTextMatchCount).toBe(1);
      expect(ariaResult.finalSubmitControlPresent).toBe("YES");

      await page.setContent(`
        <div role="button" title="发布" style="width:80px;height:32px"></div>
      `);
      const titleResult = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(titleResult.finalPublishExactTextMatchCount).toBe(1);
      expect(titleResult.finalSubmitControlPresent).toBe("YES");

      await page.setContent(`
        <button disabled style="width:80px;height:32px">发布</button>
        <button style="width:80px;height:32px">发布</button>
        <button style="display:none;width:80px;height:32px">发布</button>
        <button style="width:80px;height:32px">发布视频</button>
      `);
      const ambiguousResult = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(ambiguousResult.finalPublishExactTextMatchCount).toBe(3);
      expect(ambiguousResult.finalSubmitControlPresent).toBe("AMBIGUOUS");
      expect(ambiguousResult.finalSubmitControlEnabled).toBe("NOT_PROVEN");
    } finally {
      await browser.close();
    }
  });

  it("wires the fixed action to the existing account-bound semantic inspector", () => {
    const main = read("apps/desktop/src/main/main.ts");
    const runner = read("apps/desktop/src/main/diagnostic-trigger.ts");
    expect(runner).toContain("XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG");
    expect(runner).toContain("inspectFinalSubmitDom");
    expect(main).toContain("INSPECT_XHS_FINAL_SUBMIT_DOM");
    expect(main).toContain("platformSelfTests.inspectCurrentXiaohongshuPublishEditorSemanticCandidates(resolveXhsAccountId())");
  });
});
