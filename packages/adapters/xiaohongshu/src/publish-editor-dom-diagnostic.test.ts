import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import { inspectXiaohongshuPublishEditorDom } from "./publish-editor-dom-diagnostic";

const chromeExecutable = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

describe("Xiaohongshu bounded publish-editor DOM diagnostic", () => {
  it.skipIf(!existsSync(chromeExecutable))("returns exact fixed-label metadata without DOM side effects", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.setContent(`
        <main class="editor-shell">
          <nav class="tabs">
            <button>上传视频</button>
            <div class="tab active-parent"><span>上传图文</span></div>
            <button>写长文</button>
            <button>发播客</button>
          </nav>
          <section class="upload-panel">
            <div class="upload-image-surface" role="button" tabindex="-1">上传图片</div>
            <div class="text-to-image">文字配图</div>
            <input type="file" accept="image/*" multiple class="upload-input" />
          </section>
        </main>
        <script>
          for (const element of document.querySelectorAll("[role=button], button")) {
            element.addEventListener("click", () => { window.__diagnosticClickCount = (window.__diagnosticClickCount || 0) + 1; });
          }
        </script>
      `);

      const result = await inspectXiaohongshuPublishEditorDom(page);
      const label = (value: string) => result.labels.find((item) => item.label === value);
      const imageTab = label("上传图文");
      const uploadButton = label("上传图片");

      expect(label("上传视频")).toMatchObject({ exactTextMatchCount: 1 });
      expect(imageTab).toMatchObject({ exactTextMatchCount: 1, nodes: [{ visible: true, connected: true }] });
      expect(imageTab?.nodes[0]?.ancestors.length).toBeLessThanOrEqual(5);
      expect(result.actualSelectedTabSignal).toBe("PARENT_CLASS");
      expect(uploadButton).toMatchObject({ exactTextMatchCount: 1, nodes: [{ tagName: "DIV", role: "button", visible: true, pointerEvents: "auto" }] });
      expect(result.fileInputs).toEqual([{ type: "file", accept: "image/*", multiple: true, disabled: false, classNameSafe: "upload-input" }]);
      expect(JSON.stringify(result)).not.toMatch(/outerHTML|innerHTML|textContent|innerText|React|Vue/iu);
      expect(await page.evaluate(() => (window as unknown as { __diagnosticClickCount?: number }).__diagnosticClickCount ?? 0)).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it("keeps exact label resolution fail-closed for duplicate or absent labels", async () => {
    const page = {
      evaluate: async () => ({
        origin: "https://creator.xiaohongshu.com",
        pathname: "/publish/publish",
        labels: [
          { label: "上传视频", exactTextMatchCount: 0, nodes: [] },
          { label: "上传图文", exactTextMatchCount: 2, nodes: [] },
          { label: "写长文", exactTextMatchCount: 0, nodes: [] },
          { label: "发播客", exactTextMatchCount: 0, nodes: [] },
          { label: "上传图片", exactTextMatchCount: 0, nodes: [] },
          { label: "文字配图", exactTextMatchCount: 0, nodes: [] }
        ],
        actualSelectedTabSignal: "NOT_PROVEN",
        fileInputs: []
      })
    } as never;

    const result = await inspectXiaohongshuPublishEditorDom(page);

    expect(result.labels.find((item) => item.label === "上传图文")).toMatchObject({ exactTextMatchCount: 2, nodes: [] });
    expect(result.actualSelectedTabSignal).toBe("NOT_PROVEN");
  });
});
