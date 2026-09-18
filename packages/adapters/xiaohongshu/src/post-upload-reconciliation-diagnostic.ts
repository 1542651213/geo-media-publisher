import type { Page } from "playwright-core";

export type XiaohongshuPostUploadReconciliationState = "EDITOR_READY" | "PROCESSING" | "REJECTED" | "AMBIGUOUS";
export type XiaohongshuImageUploadReconciliation = "PASS" | "PENDING" | "FAIL" | "NOT_VERIFIED";
export type XiaohongshuPostUploadFinalSubmitProof = "PASS" | "NOT_PROVEN" | "NOT_VISIBLE" | "DISABLED" | "AMBIGUOUS";

export interface XiaohongshuPostUploadBoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XiaohongshuPostUploadImageItemSafe {
  tagName: string;
  classNameSafe: string;
  boundingRect: XiaohongshuPostUploadBoundingRect | null;
  display: string;
  visibility: string;
  pointerEvents: string;
  imgPresent: boolean;
  imgNaturalWidth: number | null;
  imgNaturalHeight: number | null;
  complete: boolean | null;
  blobUrlPresent: boolean;
  dataUrlPresent: boolean;
  backgroundImagePresent: boolean;
  connected: boolean;
  visible: boolean;
}

export interface XiaohongshuPostUploadReconciliationDomSnapshot {
  origin: string;
  pathname: string;
  readyState: string;
  editorRegionPresent: boolean;
  imageItems: readonly XiaohongshuPostUploadImageItemSafe[];
  visibleImageItemCount: number;
  imageCounterTextSafe: string | null;
  addImageControlPresent: boolean;
  deleteImageControlCount: number;
  titleControlMatchCount: number;
  titleControlVisible: boolean;
  bodyControlMatchCount: number;
  bodyControlVisible: boolean;
  finalSubmitCandidateCount: number;
  finalSubmitVisibleCount: number;
  finalSubmitProof: XiaohongshuPostUploadFinalSubmitProof;
  explicitUploadErrorSignals: readonly string[];
  processingSignalPresent: boolean;
}

export interface XiaohongshuPostUploadReconciliationResult extends XiaohongshuPostUploadReconciliationDomSnapshot {
  imageUploadReconciliation: XiaohongshuImageUploadReconciliation;
  postUploadState: XiaohongshuPostUploadReconciliationState;
  imageAssetRenderedCount: number;
  postUploadImageEditorPresent: boolean;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  noExplicitUploadError: boolean;
}

/** Validate only the bounded current/total image counter used by the retained
 * draft gate. Ordinary page text, missing counters, and zero-based counters
 * are intentionally rejected. */
export function parseXiaohongshuImageCounterText(value: string | null): { current: number; total: number } | null {
  if (typeof value !== "string") return null;
  const match = /^([1-9]\d{0,2})\s*\/\s*([1-9]\d{0,2})$/u.exec(value.trim());
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current < 1 || current > total || total > 100) return null;
  return { current, total };
}

const EMPTY_SNAPSHOT: XiaohongshuPostUploadReconciliationDomSnapshot = {
  origin: "",
  pathname: "",
  readyState: "",
  editorRegionPresent: false,
  imageItems: [],
  visibleImageItemCount: 0,
  imageCounterTextSafe: null,
  addImageControlPresent: false,
  deleteImageControlCount: 0,
  titleControlMatchCount: 0,
  titleControlVisible: false,
  bodyControlMatchCount: 0,
  bodyControlVisible: false,
  finalSubmitCandidateCount: 0,
  finalSubmitVisibleCount: 0,
  finalSubmitProof: "NOT_PROVEN",
  explicitUploadErrorSignals: [],
  processingSignalPresent: false
};

export function emptyXiaohongshuPostUploadReconciliationDomSnapshot(overrides: Partial<XiaohongshuPostUploadReconciliationDomSnapshot> = {}): XiaohongshuPostUploadReconciliationDomSnapshot {
  return { ...EMPTY_SNAPSHOT, ...overrides };
}

export function reconcileXiaohongshuPostUploadSnapshot(snapshot: XiaohongshuPostUploadReconciliationDomSnapshot): XiaohongshuPostUploadReconciliationResult {
  const noExplicitUploadError = snapshot.explicitUploadErrorSignals.length === 0;
  const imageAssetRenderedCount = Math.max(0, Math.min(snapshot.imageItems.length, snapshot.visibleImageItemCount));
  const imageProof = snapshot.editorRegionPresent
    && imageAssetRenderedCount >= 1
    && snapshot.titleControlVisible
    && snapshot.bodyControlVisible
    && noExplicitUploadError;
  const rejected = !noExplicitUploadError;
  const processing = !imageProof && !rejected && snapshot.processingSignalPresent;
  return {
    ...snapshot,
    imageUploadReconciliation: imageProof ? "PASS" : rejected ? "FAIL" : processing ? "PENDING" : "NOT_VERIFIED",
    postUploadState: imageProof ? "EDITOR_READY" : rejected ? "REJECTED" : processing ? "PROCESSING" : "AMBIGUOUS",
    imageAssetRenderedCount,
    postUploadImageEditorPresent: snapshot.editorRegionPresent,
    titleControlPresent: snapshot.titleControlVisible,
    bodyControlPresent: snapshot.bodyControlVisible,
    noExplicitUploadError
  };
}

/**
 * Read-only, fixed-scope DOM evidence for an already-uploaded XHS image-post
 * editor. The callback is intentionally self-contained: it has no access to
 * Main closures and accepts no caller-provided selector or text.
 */
export async function inspectXiaohongshuPostUploadReconciliationDom(page: Page): Promise<XiaohongshuPostUploadReconciliationDomSnapshot> {
  return page.evaluate(() => {
    const maxStringLength = 160;
    const maxItems = 20;
    const normalize = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
    const safeString = (value: string | null, limit = maxStringLength): string => (value ?? "").slice(0, limit);
    const safeAttribute = (element: Element, name: string): string | null => {
      const value = element.getAttribute(name);
      return value === null ? null : safeString(value, 120);
    };
    const classNameSafe = (element: Element): string => safeString(safeAttribute(element, "class"));
    const style = (element: Element): CSSStyleDeclaration => window.getComputedStyle(element);
    const boundingRect = (element: Element): { x: number; y: number; width: number; height: number } | null => {
      const rect = element.getBoundingClientRect();
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
      return { x: Math.round(rect.x * 100) / 100, y: Math.round(rect.y * 100) / 100, width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 };
    };
    const visible = (element: Element): boolean => {
      const computed = style(element);
      const rect = boundingRect(element);
      return element.isConnected
        && !element.hasAttribute("hidden")
        && safeAttribute(element, "aria-hidden") !== "true"
        && computed.display !== "none"
        && computed.visibility !== "hidden"
        && computed.visibility !== "collapse"
        && computed.opacity !== "0"
        && rect !== null
        && rect.width > 0
        && rect.height > 0;
    };
    const enabled = (element: Element): boolean => {
      const disabledProperty = "disabled" in element && Boolean((element as HTMLButtonElement | HTMLInputElement).disabled);
      return !disabledProperty && safeAttribute(element, "disabled") === null && safeAttribute(element, "aria-disabled")?.toLowerCase() !== "true";
    };
    const label = (element: Element): string => normalize(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`).slice(0, maxStringLength);
    const exactTextElements = (value: string): Element[] => Array.from(document.querySelectorAll("*"))
      .filter((element) => normalize(element.textContent ?? "") === value)
      .filter((element, _index, all) => !all.some((other) => other !== element && element.contains(other)));
    const fixedEditorRoots = Array.from(document.querySelectorAll('main, [role="main"], [data-testid*="editor" i], [class*="editor" i], [class*="publish" i]'));
    const inEditor = (element: Element): boolean => fixedEditorRoots.length === 0 || fixedEditorRoots.some((root) => root.contains(element));
    const titleElements = Array.from(document.querySelectorAll('input[placeholder*="标题"], input[aria-label*="标题"], input[name*="title" i], input[id*="title" i], textarea[placeholder*="标题"], textarea[aria-label*="标题"]')).filter(inEditor);
    const bodyElements = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea[aria-label*="正文"], textarea[name*="body" i], textarea[id*="body" i]')).filter(inEditor);
    const imageCandidateElements = Array.from(document.querySelectorAll('img[class*="preview" i], img[src^="blob:" i], img[src^="data:image" i], [data-testid*="upload-result" i], [data-testid*="preview" i], [class*="preview" i], [class*="uploaded" i], [class*="image-item" i], [class*="media-item" i]'))
      .filter(inEditor)
      .filter((element, _index, all) => !all.some((other) => other !== element && element.contains(other)))
      .slice(0, maxItems);
    const imageItems = imageCandidateElements.map((element) => {
      const computed = style(element);
      const image = element.tagName.toUpperCase() === "IMG" ? element as HTMLImageElement : element.querySelector("img");
      const src = image?.getAttribute("src") ?? "";
      const backgroundImage = computed.backgroundImage;
      return {
        tagName: element.tagName.toUpperCase(),
        classNameSafe: classNameSafe(element),
        boundingRect: boundingRect(element),
        display: safeString(computed.display, 40),
        visibility: safeString(computed.visibility, 40),
        pointerEvents: safeString(computed.pointerEvents, 40),
        imgPresent: image !== null,
        imgNaturalWidth: image ? Number.isFinite(image.naturalWidth) ? image.naturalWidth : null : null,
        imgNaturalHeight: image ? Number.isFinite(image.naturalHeight) ? image.naturalHeight : null : null,
        complete: image ? image.complete : null,
        blobUrlPresent: /^blob:/iu.test(src),
        dataUrlPresent: /^data:image\//iu.test(src),
        backgroundImagePresent: backgroundImage !== "none" && backgroundImage.trim().length > 0,
        connected: element.isConnected,
        visible: visible(element)
      };
    });
    const visibleImageItemCount = imageItems.filter((item) => item.visible).length;
    const editorCounterCandidates = fixedEditorRoots.flatMap((root) => [root, ...Array.from(root.querySelectorAll("*"))]);
    const counterTextSafe = Array.from(new Set(editorCounterCandidates))
      .filter((element) => visible(element) && (element.children.length === 0 || !Array.from(element.children).some((child) => normalize(child.textContent ?? "") === normalize(element.textContent ?? ""))))
      .map((element) => normalize(element.textContent ?? ""))
      .find((text) => /^\d{1,3}\s*\/\s*\d{1,3}$/u.test(text)) ?? null;
    const actionElements = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title]')).filter(inEditor);
    const addImageControlPresent = actionElements.some((element) => visible(element) && enabled(element) && /^(?:\+|新增图片|添加图片|上传图片)$/u.test(label(element)));
    const deleteImageControlCount = actionElements.filter((element) => visible(element) && /^(?:删除|移除|delete|remove)$/iu.test(label(element))).length;
    const finalSubmitElements = actionElements.filter((element) => /^(?:发布|发表|提交)$/iu.test(label(element)));
    const finalSubmitVisibleCount = finalSubmitElements.filter((element) => visible(element)).length;
    const finalSubmitProof = finalSubmitElements.length === 0
      ? "NOT_PROVEN"
      : finalSubmitElements.length > 1
        ? "AMBIGUOUS"
        : !visible(finalSubmitElements[0]!)
          ? "NOT_VISIBLE"
          : !enabled(finalSubmitElements[0]!)
            ? "DISABLED"
            : "PASS";
    const signalElements = Array.from(document.querySelectorAll('[role="alert"], [aria-live], [class*="error" i], [class*="toast" i], [class*="message" i]'));
    const explicitUploadErrorSignals = Array.from(new Set(signalElements.map(label).filter((text) => /上传失败|图片上传失败|图片格式错误|图片大小错误|图片不可用|upload failed|invalid image|file too large/iu.test(text)))).slice(0, 8);
    const processingSignalPresent = Array.from(document.querySelectorAll('[aria-busy="true"], progress, [class*="loading" i], [class*="uploading" i], [class*="processing" i]')).some(visible)
      || actionElements.some((element) => visible(element) && /^(?:上传中|处理中|processing|uploading)$/iu.test(label(element)));
    const imageEditorLabelPresent = exactTextElements("图片编辑").some((element) => visible(element) && inEditor(element));
    const editorRegionPresent = fixedEditorRoots.some(visible) && (imageEditorLabelPresent || imageItems.length > 0 || (titleElements.length > 0 && bodyElements.length > 0));
    return {
      origin: window.location.origin,
      pathname: window.location.pathname,
      readyState: document.readyState,
      editorRegionPresent,
      imageItems,
      visibleImageItemCount,
      imageCounterTextSafe: counterTextSafe ? safeString(counterTextSafe, 40) : null,
      addImageControlPresent,
      deleteImageControlCount,
      titleControlMatchCount: titleElements.length,
      titleControlVisible: titleElements.some(visible),
      bodyControlMatchCount: bodyElements.length,
      bodyControlVisible: bodyElements.some(visible),
      finalSubmitCandidateCount: finalSubmitElements.length,
      finalSubmitVisibleCount,
      finalSubmitProof,
      explicitUploadErrorSignals,
      processingSignalPresent
    };
  });
}
