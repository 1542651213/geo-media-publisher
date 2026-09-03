import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import { collectPublishEntryDomDiagnostics } from "./publish-clickable-surface";

const chromeExecutable = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

describe("Xiaohongshu bounded publish-entry DOM diagnostic", () => {
  it.skipIf(!existsSync(chromeExecutable))("reports exact image-card and legacy publish-note metadata without clicking", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      await page.setContent(`
        <main>
          <div id="legacy" class="legacy-shell">
            <div class="legacy-composite" role="button" tabindex="0">
              <span>发布笔记</span><span class="arrow">⌄</span>
            </div>
          </div>
          <a id="image-card" class="image-card" href="/publish/publish?from=menu&target=image">
            <div class="card-body"><span>发布图文笔记</span><p>支持图片格式 png、jpg、jpeg</p></div>
          </a>
        </main>
      `);

      const result = await collectPublishEntryDomDiagnostics(page);

      expect(result.publishNote.matchCount).toBe(1);
      expect(result.imagePost.matchCount).toBe(1);
      expect(result.imagePost.clickableAncestorCount).toBe(1);
      expect(result.imagePost.uniqueClickableAncestor).toMatchObject({ tagName: "A", classNameSafe: "image-card", textContentSafe: expect.stringContaining("发布图文笔记") });
      expect(result.imagePost.target).toMatchObject({ tagName: "SPAN", textContentSafe: "发布图文笔记", visible: true, enabled: true });
      expect(result.publishNote.ancestors[0]).toMatchObject({ tagName: "DIV", role: "button", tabIndex: 0, classNameSafe: "legacy-composite", clickableContainer: true });
      expect(result.diagnosticClickCount).toBe(0);
      expect(result.navigationCount).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it("fails closed for zero or multiple exact image-card matches", async () => {
    const page = {
      evaluate: async () => ({
        publishNote: { matchCount: 0, matches: [], clickableAncestorCount: 0, ancestors: [], uniqueClickableAncestor: null, target: null },
        imagePost: { matchCount: 2, matches: [], clickableAncestorCount: 2, ancestors: [], uniqueClickableAncestor: null, target: null },
        uploadImage: { matchCount: 0, matches: [], clickableAncestorCount: 0, ancestors: [], uniqueClickableAncestor: null, target: null },
        pageOrigin: "https://creator.xiaohongshu.com",
        pathname: "/new/home",
        diagnosticClickCount: 0,
        navigationCount: 0
      })
    } as never;

    const result = await collectPublishEntryDomDiagnostics(page);

    expect(result.imagePost.matchCount).toBe(2);
    expect(result.imagePost.uniqueClickableAncestor).toBeNull();
    expect(result.diagnosticClickCount).toBe(0);
    expect(result.navigationCount).toBe(0);
  });
});
