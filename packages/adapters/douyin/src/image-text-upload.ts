import { createHash } from "node:crypto";
import type { BrowserContext, Locator, Page } from "playwright-core";
import { verifyDouyinUploadEvidence } from "./image-text-evidence";

export interface DouyinImageSelectionInput {
  fileName: string;
  mimeType: "image/png" | "image/jpeg";
  bytes: Buffer;
  imageSha256: string;
  expectedContext: BrowserContext;
  preUploadImageCount: number;
  previewSelector: string;
  timeoutMs?: number;
  /** A durable, exact-Job claim must finish before the browser receives the file choice. */
  claimSelection?: () => Promise<void>;
  onSelectionReturned?: () => void;
  onSelectionThrew?: () => void;
}

export interface DouyinImageTransitionResult {
  imageCount: 1;
  inputDetached: boolean;
  previewDigest: string;
}

const editorPath = "/creator-micro/content/post/image";
const creatorOrigin = "https://creator.douyin.com";

function isEditor(page: Page): boolean {
  if (page.isClosed()) return false;
  const url = new URL(page.url());
  return url.origin === creatorOrigin && url.pathname === editorPath;
}

/** Observe the current owned editor without selecting another file. */
export async function observeDouyinImageEditor(page: Page, input: Pick<DouyinImageSelectionInput,
  "expectedContext" | "preUploadImageCount" | "previewSelector" | "fileName" | "timeoutMs"> &
  { inputFileName: string | null; inputDetached: boolean }): Promise<DouyinImageTransitionResult> {
  if (page.isClosed() || page.context() !== input.expectedContext) throw new Error("CONTEXT_MISMATCH");
  if (!isEditor(page)) throw new Error("DOUYIN_EDITOR_NOT_READY_AFTER_SELECTION");
  const images = page.locator(input.previewSelector);
  await images.first().waitFor({ state: "visible", timeout: input.timeoutMs ?? 15_000 });
  await page.waitForFunction((selector) => {
    const images = [...document.querySelectorAll<HTMLImageElement>(selector)];
    const text = document.body.innerText;
    return images.length === 1 && images[0]!.complete && images[0]!.naturalWidth > 0
      && document.querySelectorAll('input[placeholder="添加作品标题"]').length === 1
      && document.querySelectorAll('[contenteditable="true"]').length === 1
      && text.includes("已添加1张图片") && !/上传中|处理中|正在处理/u.test(text);
  }, input.previewSelector, { timeout: input.timeoutMs ?? 15_000 }).catch(async () => {
    const text = await page.locator("body").innerText().catch(() => "");
    if (/上传中|处理中|正在处理|上传失败|图片处理失败/u.test(text)) throw new Error("PROCESSING_INCOMPLETE");
    throw new Error("DOUYIN_EDITOR_NOT_READY_AFTER_SELECTION");
  });
  const imageCount = await images.count();
  const imageVisible = imageCount === 1 && await images.first().isVisible();
  const imageData = imageCount === 1 ? await images.first().evaluate((image) => image instanceof HTMLImageElement
    ? { loaded: image.complete && image.naturalWidth > 0, src: image.currentSrc || image.src } : { loaded: false, src: "" })
    : { loaded: false, src: "" };
  const editorText = await page.locator("body").innerText();
  verifyDouyinUploadEvidence({ preUploadImageCount: input.preUploadImageCount, postUploadImageCount: imageCount,
    selectedFileName: input.fileName, inputSelectionCompleted: true,
    uploadInputFileName: input.inputDetached ? null : input.inputFileName,
    imageVisible, imageLoaded: imageData.loaded,
    processing: /上传中|处理中|正在处理/u.test(editorText), error: /上传失败|图片处理失败/u.test(editorText),
    currentEditorRoute: isEditor(page), contextOwned: page.context() === input.expectedContext });
  if (!imageData.src) throw new Error("DOUYIN_IMAGE_PREVIEW_SOURCE_MISSING");
  return { imageCount: 1, inputDetached: input.inputDetached,
    previewDigest: createHash("sha256").update(imageData.src).digest("hex") };
}

/** Exactly one file choice. A thrown choice remains uncertain even if a new preview appears. */
export async function selectAndObserveDouyinImage(page: Page, upload: Locator,
  input: DouyinImageSelectionInput): Promise<DouyinImageTransitionResult> {
  if (page.isClosed() || page.context() !== input.expectedContext) throw new Error("CONTEXT_MISMATCH");
  if (input.preUploadImageCount !== 0 || await page.locator(input.previewSelector).count() !== 0)
    throw new Error("IMAGE_COUNT_MISMATCH");
  if (createHash("sha256").update(input.bytes).digest("hex") !== input.imageSha256)
    throw new Error("DOUYIN_IMAGE_HASH_MISMATCH");
  if (!input.fileName.trim() || !input.bytes.length) throw new Error("DOUYIN_IMAGE_SELECTION_SOURCE_INVALID");
  await input.claimSelection?.();
  let selectionThrew = false;
  try {
    await upload.setInputFiles({ name: input.fileName, mimeType: input.mimeType, buffer: input.bytes });
    input.onSelectionReturned?.();
  } catch {
    selectionThrew = true;
    input.onSelectionThrew?.();
  }
  await page.waitForURL((url) => url.origin === creatorOrigin && url.pathname === editorPath,
    { timeout: selectionThrew ? Math.min(input.timeoutMs ?? 5_000, 5_000) : input.timeoutMs ?? 30_000 }).catch(() => undefined);
  if (!isEditor(page)) throw new Error(selectionThrew
    ? "DOUYIN_FILE_SELECTION_RESULT_UNKNOWN_NO_EDITOR" : "DOUYIN_EDITOR_NOT_READY_AFTER_SELECTION");
  const inputCount = await upload.count().catch(() => 0);
  const inputFileName = inputCount === 1 ? await upload.evaluate((element) => element instanceof HTMLInputElement
    ? element.files?.[0]?.name ?? null : null).catch(() => null) : null;
  let observed: DouyinImageTransitionResult | null = null;
  try { observed = await observeDouyinImageEditor(page, { ...input, inputFileName, inputDetached: inputCount === 0 }); }
  catch (error) {
    if (!selectionThrew) throw error;
  }
  if (selectionThrew) throw new Error(observed
    ? "DOUYIN_FILE_SELECTION_RESULT_UNKNOWN_EDITOR_PRESENT" : "DOUYIN_FILE_SELECTION_RESULT_UNKNOWN_EDITOR_INCOMPLETE");
  if (!observed) throw new Error("DOUYIN_EDITOR_NOT_READY_AFTER_SELECTION");
  return observed;
}
