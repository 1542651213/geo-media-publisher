import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Locator } from "playwright-core";
import { selectAndObserveDouyinImage } from "./image-text-browser";

const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lH8AAAAASUVORK5CYII=";
const bytes = Buffer.from(pngBase64, "base64");
const imageSha256 = createHash("sha256").update(bytes).digest("hex");
const uploadUrl = "https://creator.douyin.com/creator-micro/content/upload";
const editorPath = "/creator-micro/content/post/image";
const previewSelector = "main img";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(options: { retainInput?: boolean; oldPreview?: boolean; error?: boolean; processing?: boolean } = {}) {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  browsers.push(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const initialImage = options.oldPreview ? `<main><img src="data:image/png;base64,${pngBase64}"></main>` : "<main></main>";
  const html = `<!doctype html><html><head><meta charset="UTF-8"></head><body>${initialImage}<label>上传图文<input type="file" accept="image/png,image/jpeg"></label>
    <script>document.querySelector('input').addEventListener('change', () => {
      history.pushState({}, '', '${editorPath}');
      document.querySelector('main').innerHTML = '<img src="data:image/png;base64,${pngBase64}">';
      ${options.retainInput ? "" : "document.querySelector('input').remove();"}
      ${options.error ? "document.body.insertAdjacentText('beforeend', '上传失败');" : ""}
      ${options.processing ? "document.body.insertAdjacentText('beforeend', '处理中');" : ""}
      document.body.insertAdjacentHTML('beforeend', '<input placeholder="添加作品标题"><div contenteditable="true"></div><span>已添加1张图片</span>');
    });</script></body></html>`;
  await page.route("https://creator.douyin.com/**", async (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  await page.goto(uploadUrl);
  return { context, page, upload: page.locator('input[type="file"][accept*="image/"]') };
}

function input(context: BrowserContext, preUploadImageCount = 0) {
  return { fileName: "owner.png", mimeType: "image/png" as const, bytes, imageSha256,
    expectedContext: context, preUploadImageCount, previewSelector, timeoutMs: 3_000 };
}

describe.skipIf(!existsSync(chrome))("Douyin local upload-to-editor fixture", () => {
  it("attributes one loaded preview when the selected image input detaches during navigation", async () => {
    const { context, page, upload } = await fixture();
    const result = await selectAndObserveDouyinImage(page, upload, input(context));
    expect(page.url()).toContain(editorPath);
    expect(result).toMatchObject({ imageCount: 1, inputDetached: true });
    expect(result.previewDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("also accepts a retained file input with the exact selected name", async () => {
    const { context, page, upload } = await fixture({ retainInput: true });
    expect(await selectAndObserveDouyinImage(page, upload, input(context))).toMatchObject({ imageCount: 1, inputDetached: false });
  });

  it("never selects a second time when selection throws after the new preview appears", async () => {
    const { context, page, upload } = await fixture();
    let calls = 0;
    const ambiguous = { setInputFiles: async (...args: Parameters<Locator["setInputFiles"]>) => {
      calls += 1;
      await upload.setInputFiles(...args);
      throw new Error("synthetic lost selection response");
    }, count: upload.count.bind(upload), evaluate: upload.evaluate.bind(upload) } as unknown as Locator;
    await expect(selectAndObserveDouyinImage(page, ambiguous, input(context))).rejects.toThrow("DOUYIN_FILE_SELECTION_RESULT_UNKNOWN_EDITOR_PRESENT");
    expect(calls).toBe(1);
    expect(page.url()).toContain(editorPath);
    expect(await page.locator(previewSelector).count()).toBe(1);
  });

  it("rejects an old preview, changed Context, changed bytes and processing errors before claiming success", async () => {
    const old = await fixture({ oldPreview: true });
    await expect(selectAndObserveDouyinImage(old.page, old.upload, input(old.context, 1))).rejects.toThrow("IMAGE_COUNT_MISMATCH");
    expect(old.page.url()).toBe(uploadUrl);
    const wrong = await fixture();
    await expect(selectAndObserveDouyinImage(wrong.page, wrong.upload, { ...input(wrong.context), expectedContext: {} as BrowserContext }))
      .rejects.toThrow("CONTEXT_MISMATCH");
    await expect(selectAndObserveDouyinImage(wrong.page, wrong.upload, { ...input(wrong.context), imageSha256: "0".repeat(64) }))
      .rejects.toThrow("DOUYIN_IMAGE_HASH_MISMATCH");
    expect(wrong.page.url()).toBe(uploadUrl);
    const failed = await fixture({ error: true });
    await expect(selectAndObserveDouyinImage(failed.page, failed.upload, input(failed.context))).rejects.toThrow("PROCESSING_INCOMPLETE");
    const processing = await fixture({ processing: true });
    await expect(selectAndObserveDouyinImage(processing.page, processing.upload, input(processing.context))).rejects.toThrow("PROCESSING_INCOMPLETE");
  }, 15_000);
});
