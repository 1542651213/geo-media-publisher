import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Task10S canonical publish-editor DOM diagnostic contract", () => {
  it("exposes one account-bound typed Main boundary", () => {
    const api = read("apps/desktop/src/shared/api.ts");
    const preload = read("apps/desktop/src/main/preload.ts");
    const ipc = read("apps/desktop/src/main/ipc.ts");
    const selfTest = read("apps/desktop/src/main/platform-self-test.ts");
    const identity = read("apps/desktop/src/main/xhs-identity.ts");

    expect(api).toContain("inspectCurrentXiaohongshuPublishEditorDom(accountId: string): Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic>");
    expect(preload).toContain("inspectCurrentXiaohongshuPublishEditorDom: (accountId) => invoke(\"platform-self-test:inspect-current-xhs-publish-editor-dom\", { accountId })");
    expect(ipc).toContain('register("platform-self-test:inspect-current-xhs-publish-editor-dom", async (_event, payload) =>');
    expect(selfTest).toContain("inspectCurrentXiaohongshuPublishEditorDom(accountId?: string): Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic>");
    expect(identity).toContain("inspectCurrentXiaohongshuPublishEditorDom");
  });

  it("keeps the page-context evaluator bounded and side-effect free", () => {
    const source = read("packages/adapters/xiaohongshu/src/publish-editor-dom-diagnostic.ts");

    expect(source).toContain("return page.evaluate(() => {");
    expect(source).toContain("const labels = [\"上传视频\", \"上传图文\", \"写长文\", \"发播客\", \"上传图片\", \"文字配图\"]");
    expect(source).toContain("const maxAncestors = 5");
    expect(source).toMatch(/input\[type=['"]file['"]\]/u);
    expect(source).not.toContain("outerHTML");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("setInputFiles");
    expect(source).not.toContain("page.goto");
    expect(source).not.toContain("selector:");
    expect(source).not.toContain("text:");
  });
});
