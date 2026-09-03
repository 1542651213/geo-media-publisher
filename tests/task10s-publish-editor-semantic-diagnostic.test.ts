import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("Task10S publish-editor semantic candidate diagnostic contract", () => {
  it("exposes one fixed no-argument Main/IPC/preload path", () => {
    const browser = read("packages/adapters/xiaohongshu/src/browser.ts");
    const identity = read("apps/desktop/src/main/xhs-identity.ts");
    const service = read("apps/desktop/src/main/platform-self-test.ts");
    const ipc = read("apps/desktop/src/main/ipc.ts");
    const preload = read("apps/desktop/src/main/preload.ts");
    const api = read("apps/desktop/src/shared/api.ts");

    expect(browser).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(ctx: AccountContext)");
    expect(identity).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(accountId: string)");
    expect(service).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>");
    expect(ipc).toContain('register("platform-self-test:inspect-current-xhs-publish-editor-semantic-candidates", async () =>');
    expect(preload).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates: () => invoke(\"platform-self-test:inspect-current-xhs-publish-editor-semantic-candidates\")");
    expect(api).toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates(): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>");
    expect(preload).not.toContain("inspectCurrentXiaohongshuPublishEditorSemanticCandidates: (input");
    expect(ipc).not.toContain("inspect-current-xhs-publish-editor-semantic-candidates\", async (_event, payload)");
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
});
