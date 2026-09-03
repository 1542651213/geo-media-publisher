import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chromium, type Page } from "playwright-core";
import { inspectXiaohongshuPublishEditorSemanticCandidates } from "./publish-editor-semantic-diagnostic";

const chromeExecutable = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function withFixture(body: string, callback: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto("https://creator.xiaohongshu.com/publish/publish?target=image", { waitUntil: "commit", timeout: 5000 }).catch(() => undefined);
    await page.setContent(`
      <style>
        .creator-tab { display: inline-block; width: 120px; height: 32px; margin: 4px; cursor: pointer; }
        .creator-tab.active { color: red; }
        .hidden { display: none; }
        .zero, .zero span { display: block; width: 0; height: 0; overflow: hidden; }
        .offscreen { position: absolute; left: -9710px; top: -9910px; }
        .partial { position: absolute; left: -20px; top: 20px; }
        .upload-button { display: inline-block; width: 100px; height: 48px; cursor: pointer; }
        .upload-button span { display: inline-block; width: 80px; height: 24px; pointer-events: auto; cursor: pointer; }
      </style>
      <main class="editor-shell"><nav class="creator-tabs">${body}</nav>
        <section><button class="upload-button"><span>上传图片</span></button><input type="file" accept=".jpg,.jpeg,.png,.webp" multiple></section>
      </main>
    `);
    await callback(page);
  } finally {
    await browser.close();
  }
}

function tabs(options: { imageCopies?: number; active?: "上传视频" | "上传图文" | "写长文" | "发播客"; hiddenImageCopies?: number; zeroImageCopies?: number } = {}): string {
  const imageCopies = options.imageCopies ?? 1;
  const hiddenImageCopies = options.hiddenImageCopies ?? 0;
  const zeroImageCopies = options.zeroImageCopies ?? 0;
  const labels = ["上传视频", "写长文", "发播客"];
  const ordinary = labels.map((label) => `<div class="creator-tab${options.active === label ? " active" : ""}"><span>${label}</span></div>`).join("");
  const images = Array.from({ length: imageCopies }, (_, index) => `<div class="creator-tab${options.active === "上传图文" && index === 0 ? " active" : ""}"><span>上传图文</span></div>`).join("");
  const hidden = Array.from({ length: hiddenImageCopies }, () => `<div class="creator-tab hidden"><span>上传图文</span></div>`).join("");
  const zero = Array.from({ length: zeroImageCopies }, () => `<div class="creator-tab zero"><span>上传图文</span></div>`).join("");
  return ordinary + images + hidden + zero;
}

describe("XHS publish-editor semantic candidate diagnostic", () => {
  it.skipIf(!existsSync(chromeExecutable))("proves one rendered active image tab among three exact text matches", async () => {
    await withFixture(tabs({ imageCopies: 1, active: "上传图文", hiddenImageCopies: 2 }), async (page) => {
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.uploadImageTabTextMatchCount).toBe(3);
      expect(result.uploadImageTabRenderedCandidateCount).toBe(1);
      expect(result.visibleCreatorTabCount).toBe(4);
      expect(result.activeCreatorTabCount).toBe(1);
      expect(result.activeCreatorTabLabel).toBe("上传图文");
      expect(result.actualSelectedTabSignal).toBe("SELF_CLASS");
      expect(result.selectedImageTabProof).toBe("PASS");
      expect(result.imageUploadSurfaceProof).toBe("PASS");
      expect(result.imagePostSemanticProof).toBe("PASS");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("fails closed when two rendered image-tab candidates remain", async () => {
    await withFixture(tabs({ imageCopies: 2 }), async (page) => {
      await page.evaluate(() => { history.replaceState({}, "", "/publish/publish?target=image"); });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.uploadImageTabTextMatchCount).toBe(2);
      expect(result.uploadImageTabRenderedCandidateCount).toBe(2);
      expect(result.selectedImageTabProof).toBe("FAIL");
      expect(result.imagePostSemanticProof).toBe("FAIL");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("rejects image proof when video is the only active creator tab", async () => {
    await withFixture(tabs({ active: "上传视频" }), async (page) => {
      await page.evaluate(() => { history.replaceState({}, "", "/publish/publish?target=image"); });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.activeCreatorTabCount).toBe(1);
      expect(result.activeCreatorTabLabel).toBe("上传视频");
      expect(result.selectedImageTabProof).toBe("FAIL");
      expect(result.imagePostSemanticProof).toBe("FAIL");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("rejects two active tabs and non-unique file inputs", async () => {
    await withFixture(tabs({ active: "上传图文" }), async (page) => {
      await page.evaluate(() => {
        history.replaceState({}, "", "/publish/publish?target=image");
        document.querySelector(".creator-tab")?.classList.add("active");
        const input = document.querySelector('input[type="file"]');
        input?.insertAdjacentHTML("afterend", '<input type="file" accept="image/*" multiple>');
      });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.activeCreatorTabCount).toBe(2);
      expect(result.selectedImageTabProof).toBe("FAIL");
      expect(result.acceptableImageFileInputCount).toBe(2);
      expect(result.imageUploadSurfaceProof).toBe("FAIL");
      expect(result.imagePostSemanticProof).toBe("FAIL");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("requires a unique enabled image file input and upload-button surface", async () => {
    await withFixture(tabs({ active: "上传图文" }), async (page) => {
      await page.evaluate(() => { history.replaceState({}, "", "/publish/publish?target=image"); });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.uploadImageButtonTextMatchCount).toBe(1);
      expect(result.uploadImageButtonRenderedCandidateCount).toBe(1);
      expect(result.fileInputs).toHaveLength(1);
      expect(result.acceptableImageFileInputCount).toBe(1);
      expect(result.imageUploadSurfaceProof).toBe("PASS");
      expect(result.imagePostSemanticProof).toBe("PASS");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("excludes an off-screen active clone and keeps one viewport-intersecting image tab", async () => {
    await withFixture(tabs({ imageCopies: 2, active: "上传图文" }), async (page) => {
      await page.evaluate(() => {
        const imageTabs = document.querySelectorAll(".creator-tab");
        imageTabs[3]?.classList.add("offscreen");
        imageTabs[4]?.classList.add("active");
      });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.uploadImageTabTextMatchCount).toBe(2);
      expect(result.uploadImageTabRenderedCandidateCount).toBe(2);
      expect(result.viewportIntersectingUploadImageCandidateCount).toBe(1);
      expect(result.renderedCreatorTabCount).toBe(5);
      expect(result.viewportIntersectingCreatorTabCount).toBe(4);
      expect(result.activeCreatorTabCount).toBe(2);
      expect(result.viewportIntersectingActiveCreatorTabCount).toBe(1);
      expect(result.viewportIntersectingActiveCreatorTabLabel).toBe("上传图文");
      expect(result.selectedImageTabProof).toBe("PASS");
      expect(result.imagePostSemanticProof).toBe("PASS");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("fails closed when two active creator tabs intersect the viewport", async () => {
    await withFixture(tabs({ active: "上传图文" }), async (page) => {
      await page.evaluate(() => {
        history.replaceState({}, "", "/publish/publish?target=image");
        document.querySelector(".creator-tab")?.classList.add("active");
      });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.viewportIntersectingActiveCreatorTabCount).toBe(2);
      expect(result.viewportIntersectingActiveCreatorTabLabel).toBeNull();
      expect(result.selectedImageTabProof).toBe("FAIL");
      expect(result.imagePostSemanticProof).toBe("FAIL");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("rejects a sole off-screen active image tab", async () => {
    await withFixture(tabs({ active: "上传图文" }), async (page) => {
      await page.evaluate(() => {
        history.replaceState({}, "", "/publish/publish?target=image");
        document.querySelector(".creator-tab:nth-of-type(4)")?.classList.add("offscreen");
      });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.viewportIntersectingActiveCreatorTabCount).toBe(0);
      expect(result.viewportIntersectingActiveCreatorTabLabel).toBeNull();
      expect(result.selectedImageTabProof).toBe("FAIL");
    });
  });

  it.skipIf(!existsSync(chromeExecutable))("keeps a partially out-of-bounds active image tab when it intersects the viewport", async () => {
    await withFixture(tabs({ active: "上传图文" }), async (page) => {
      await page.evaluate(() => {
        history.replaceState({}, "", "/publish/publish?target=image");
        document.querySelector(".creator-tab:nth-of-type(4)")?.classList.add("partial");
      });
      const result = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
      expect(result.viewportIntersectingActiveCreatorTabCount).toBe(1);
      expect(result.viewportIntersectingActiveCreatorTabLabel).toBe("上传图文");
      expect(result.selectedImageTabProof).toBe("PASS");
    });
  });

  it("uses one fixed evaluate call and contains no mutation capability", async () => {
    let evaluateCount = 0;
    const page = { evaluate: async () => { evaluateCount += 1; return { origin: "", pathname: "" }; } } as never;
    await inspectXiaohongshuPublishEditorSemanticCandidates(page);
    expect(evaluateCount).toBe(1);
    const source = readFileSync("packages/adapters/xiaohongshu/src/publish-editor-semantic-diagnostic.ts", "utf8");
    expect(source).not.toMatch(/setInputFiles|\.click\s*\(/u);
    expect(source).not.toMatch(/outerHTML|innerHTML|React|Vue|event\.listener/iu);
  });
});
