import type { Page } from "playwright-core";
import type { BrowserRuntimeAuthState, BrowserSessionContextPage, BrowserSessionContextPageLifecycleEvent } from "@publisher/adapters-core";
import type { ImageEditorContentType, ImageEditorPhase } from "./image-editor-discovery";

const MAX_SAFE_TITLE_LENGTH = 120;
const MAX_SAFE_LABEL_LENGTH = 80;
const XHS_CREATOR_ORIGIN = "https://creator.xiaohongshu.com";
const XHS_PUBLISH_PATH = "/publish/publish";

export type XiaohongshuDocumentReadyState = "loading" | "interactive" | "complete" | "unknown";
export type XiaohongshuVisibilityState = "visible" | "hidden" | "prerender" | "unloaded" | "unknown";

export interface XiaohongshuContextPageDomSnapshot {
  documentReadyState: XiaohongshuDocumentReadyState;
  titleSafe: string;
  visibilityState: XiaohongshuVisibilityState;
  openerPresent: boolean;
  editorShellPresent: boolean;
  uploadImageTabPresent: boolean;
  currentSelectedTab: "上传图文" | "上传视频" | "写长文" | "发播客" | null;
  imageUploadControlPresent: boolean;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  finalSubmitControlPresent: boolean;
  contentType: ImageEditorContentType;
  imageEditorPhase: ImageEditorPhase;
}

export interface XiaohongshuContextPageInventoryEntry {
  pageIndex: number;
  pageId: string;
  isCanonical: boolean;
  isClosed: boolean;
  urlOrigin: string | null;
  pathname: string | null;
  source: string | null;
  from: string | null;
  target: string | null;
  documentReadyState: XiaohongshuDocumentReadyState;
  titleSafe: string | null;
  openerPresent: boolean;
  openerPageIdIfSameContext: string | null;
  frameCount: number | null;
  visibilityState: XiaohongshuVisibilityState;
  editorShellPresent: boolean;
  uploadImageTabPresent: boolean;
  currentSelectedTab: XiaohongshuContextPageDomSnapshot["currentSelectedTab"];
  imageUploadControlPresent: boolean;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  finalSubmitControlPresent: boolean;
  contentType: ImageEditorContentType;
  imageEditorPhase: ImageEditorPhase;
}

export interface XiaohongshuContextPageInventory {
  platformKey: "xiaohongshu";
  accountId: string;
  inventoryStatus: "PASS" | "FAIL";
  failureCode: string | null;
  contextDebugId: string;
  runtimeAuthState: BrowserRuntimeAuthState;
  browserConnected: boolean;
  pageCount: number;
  canonicalPageId: string | null;
  pages: XiaohongshuContextPageInventoryEntry[];
  pageCreationEvents: BrowserSessionContextPageLifecycleEvent[];
}

interface SafeRoute {
  urlOrigin: string | null;
  pathname: string | null;
  source: string | null;
  from: string | null;
  target: string | null;
}

function safeRoute(url: string | null): SafeRoute {
  if (!url) return { urlOrigin: null, pathname: null, source: null, from: null, target: null };
  try {
    const parsed = new URL(url);
    const safeValue = (key: string): string | null => {
      const value = parsed.searchParams.get(key)?.trim() ?? "";
      return value.length > 0 ? value.slice(0, MAX_SAFE_LABEL_LENGTH) : null;
    };
    return {
      urlOrigin: parsed.origin,
      pathname: parsed.pathname,
      source: safeValue("source"),
      from: safeValue("from"),
      target: safeValue("target")
    };
  } catch {
    return { urlOrigin: null, pathname: null, source: null, from: null, target: null };
  }
}

function closedPage(page: Page): boolean {
  try { return page.isClosed(); } catch { return true; }
}

function unknownDomSnapshot(): XiaohongshuContextPageDomSnapshot {
  return {
    documentReadyState: "unknown",
    titleSafe: "",
    visibilityState: "unknown",
    openerPresent: false,
    editorShellPresent: false,
    uploadImageTabPresent: false,
    currentSelectedTab: null,
    imageUploadControlPresent: false,
    titleControlPresent: false,
    bodyControlPresent: false,
    finalSubmitControlPresent: false,
    contentType: "UNKNOWN",
    imageEditorPhase: "IMAGE_POST_UNKNOWN"
  };
}

/**
 * Reads a bounded, fixed DOM summary. The callback intentionally returns only
 * booleans and a small allow-listed tab label; it never serializes body text or
 * markup and never touches cookies, storage, headers, or network responses.
 */
export async function readXiaohongshuContextPageDomSnapshot(page: Page): Promise<XiaohongshuContextPageDomSnapshot> {
  try {
    return await page.evaluate((): XiaohongshuContextPageDomSnapshot => {
      type SelectedTab = XiaohongshuContextPageDomSnapshot["currentSelectedTab"];
      const maxSafeTitleLength = 120;
      const maxSafeLabelLength = 80;
      const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim().slice(0, maxSafeLabelLength);
      const labelOf = (element: Element): string => normalize(element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent ?? "");
      const isVisible = (element: Element): boolean => {
        if (element.getAttribute("aria-hidden") === "true") return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const allInteractive = Array.from(document.querySelectorAll("[role=tab], button, [role=button], a"));
      const selectedLabel = (element: Element): SelectedTab => {
        const label = labelOf(element);
        if (/上传图文|图文|image\s*post|image\s*text|note/iu.test(label)) return "上传图文";
        if (/上传视频|视频|video/iu.test(label)) return "上传视频";
        if (/写长文|长文|article/iu.test(label)) return "写长文";
        if (/发播客|播客|podcast/iu.test(label)) return "发播客";
        return null;
      };
      const selected = allInteractive.find((element) => {
        const selectedAttribute = element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-current") === "page" || element.getAttribute("data-state") === "active";
        return selectedAttribute && isVisible(element);
      });
      const selectedTab = selected ? selectedLabel(selected) : null;
      const imageTabPresent = allInteractive.some((element) => selectedLabel(element) === "上传图文" && isVisible(element));
      const videoTabPresent = allInteractive.some((element) => selectedLabel(element) === "上传视频" && isVisible(element));
      const imageUploadSemanticPresent = allInteractive.some((element) => {
        const label = labelOf(element);
        return isVisible(element) && /上传图片|添加图片|选择图片|image\s*upload|upload\s*image/iu.test(label);
      });
      const imageUploadControlPresent = document.querySelector('input[type="file"]') !== null || imageUploadSemanticPresent;
      const titleControlPresent = document.querySelector('input[placeholder*="标题"], input[aria-label*="标题"], input[name*="title" i], input[id*="title" i], textarea[placeholder*="标题"], textarea[aria-label*="标题"], textarea[name*="title" i], textarea[id*="title" i]') !== null;
      const bodyControlPresent = document.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea[aria-label*="正文"], textarea[name*="body" i], textarea[id*="body" i]') !== null;
      const finalSubmitControlPresent = allInteractive.some((element) => isVisible(element) && /发布(?:笔记|图文)?|提交|发表|publish|submit/iu.test(labelOf(element)));
      const shellRootPresent = Array.from(document.querySelectorAll("main, [role=main], [data-testid*='publish' i], [data-testid*='editor' i], [class*='publish' i], [class*='editor' i]")).some(isVisible);
      const editorShellPresent = shellRootPresent && (imageTabPresent || imageUploadControlPresent || titleControlPresent || bodyControlPresent || finalSubmitControlPresent);
      const contentType: ImageEditorContentType = (imageTabPresent || imageUploadControlPresent) && !videoTabPresent ? "IMAGE_POST" : videoTabPresent && !imageTabPresent ? "VIDEO" : "UNKNOWN";
      const imageEditorPhase: ImageEditorPhase = !editorShellPresent
        ? "IMAGE_POST_UNKNOWN"
        : contentType !== "IMAGE_POST"
          ? "IMAGE_POST_UNKNOWN"
          : document.readyState === "loading"
            ? "IMAGE_POST_TRANSITIONING"
            : imageUploadControlPresent && !titleControlPresent && !bodyControlPresent && !finalSubmitControlPresent
              ? "IMAGE_POST_PRE_UPLOAD"
              : titleControlPresent || bodyControlPresent || finalSubmitControlPresent
                ? "IMAGE_POST_POST_UPLOAD_EDITOR"
                : "IMAGE_POST_UNKNOWN";
      const documentReadyState: XiaohongshuDocumentReadyState = document.readyState === "loading" || document.readyState === "interactive" || document.readyState === "complete" ? document.readyState : "unknown";
      const visibilityState: XiaohongshuVisibilityState = document.visibilityState === "visible" || document.visibilityState === "hidden" || document.visibilityState === "prerender" || document.visibilityState === "unloaded" ? document.visibilityState : "unknown";
      return {
        documentReadyState,
        titleSafe: document.title.slice(0, maxSafeTitleLength),
        visibilityState,
        openerPresent: window.opener !== null,
        editorShellPresent,
        uploadImageTabPresent: imageTabPresent,
        currentSelectedTab: selectedTab,
        imageUploadControlPresent,
        titleControlPresent,
        bodyControlPresent,
        finalSubmitControlPresent,
        contentType,
        imageEditorPhase
      };
    });
  } catch {
    return unknownDomSnapshot();
  }
}

export async function inspectXiaohongshuContextPage(entry: BrowserSessionContextPage, allPages: readonly BrowserSessionContextPage[]): Promise<XiaohongshuContextPageInventoryEntry> {
  const isClosed = closedPage(entry.page);
  let rawUrl: string | null = null;
  try { rawUrl = entry.page.url(); } catch { rawUrl = null; }
  const route = safeRoute(rawUrl);
  if (isClosed) {
    return {
      pageIndex: entry.pageIndex,
      pageId: entry.pageDebugId,
      isCanonical: entry.isCanonical,
      isClosed: true,
      ...route,
      ...unknownDomSnapshot(),
      titleSafe: null,
      openerPageIdIfSameContext: null,
      frameCount: 0
    };
  }

  const dom = await readXiaohongshuContextPageDomSnapshot(entry.page);
  let frameCount: number | null = null;
  try { frameCount = entry.page.frames().length; } catch { frameCount = null; }
  let openerPage: Page | null = null;
  try { openerPage = await entry.page.opener(); } catch { openerPage = null; }
  const openerPageIdIfSameContext = openerPage ? allPages.find((candidate) => candidate.page === openerPage)?.pageDebugId ?? null : null;
  return {
    pageIndex: entry.pageIndex,
    pageId: entry.pageDebugId,
    isCanonical: entry.isCanonical,
    isClosed: false,
    ...route,
    ...dom,
    titleSafe: dom.titleSafe.slice(0, MAX_SAFE_TITLE_LENGTH),
    openerPresent: dom.openerPresent || openerPage !== null,
    openerPageIdIfSameContext,
    frameCount
  };
}

export function emptyXiaohongshuContextPageInventory(input: { accountId: string; contextDebugId?: string | null; runtimeAuthState?: BrowserRuntimeAuthState; browserConnected?: boolean }): XiaohongshuContextPageInventory {
  return {
    platformKey: "xiaohongshu",
    accountId: input.accountId,
    inventoryStatus: "FAIL",
    failureCode: "CONTEXT_PAGE_INVENTORY_UNAVAILABLE",
    contextDebugId: input.contextDebugId ?? "unknown-context",
    runtimeAuthState: input.runtimeAuthState ?? "UNVERIFIED",
    browserConnected: input.browserConnected ?? false,
    pageCount: 0,
    canonicalPageId: null,
    pages: [],
    pageCreationEvents: []
  };
}

export { XHS_CREATOR_ORIGIN, XHS_PUBLISH_PATH };
