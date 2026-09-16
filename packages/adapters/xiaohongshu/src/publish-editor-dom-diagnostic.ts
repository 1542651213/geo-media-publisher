import type { Page } from "playwright-core";

export type XiaohongshuPublishEditorDomSelectedSignal =
  | "ARIA_SELECTED"
  | "ARIA_CURRENT"
  | "ARIA_PRESSED"
  | "SELF_CLASS"
  | "PARENT_CLASS"
  | "ANCESTOR_CLASS"
  | "OTHER_SAFE_SIGNAL"
  | "NOT_PROVEN";

export interface XiaohongshuPublishEditorDomBoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XiaohongshuPublishEditorDomAncestorSafe {
  tagName: string;
  role: string | null;
  tabIndex: number;
  classNameSafe: string;
  ariaSelected: string | null;
  ariaCurrent: string | null;
  pointerEvents: string;
  cursor: string;
}

export interface XiaohongshuPublishEditorDomNodeSafe extends XiaohongshuPublishEditorDomAncestorSafe {
  ariaPressed: string | null;
  display: string;
  visibility: string;
  boundingRect: XiaohongshuPublishEditorDomBoundingRect | null;
  connected: boolean;
  visible: boolean;
  enabled: boolean;
  parent: XiaohongshuPublishEditorDomAncestorSafe | null;
  ancestors: readonly XiaohongshuPublishEditorDomAncestorSafe[];
}

export interface XiaohongshuPublishEditorDomLabelSafe {
  label: string;
  exactTextMatchCount: number;
  nodes: readonly XiaohongshuPublishEditorDomNodeSafe[];
}

export interface XiaohongshuPublishEditorDomFileInputSafe {
  type: string;
  accept: string | null;
  multiple: boolean;
  disabled: boolean;
  classNameSafe: string;
}

export interface XiaohongshuPublishEditorDomSnapshot {
  origin: string;
  pathname: string;
  labels: readonly XiaohongshuPublishEditorDomLabelSafe[];
  actualSelectedTabSignal: XiaohongshuPublishEditorDomSelectedSignal;
  fileInputs: readonly XiaohongshuPublishEditorDomFileInputSafe[];
}

export type XiaohongshuPublishEditorDomRuntimeFailureCode =
  | "BROWSER_SESSION_UNAVAILABLE"
  | "BROWSER_SESSION_DISCONNECTED"
  | "CANONICAL_PAGE_UNAVAILABLE"
  | "CANONICAL_PAGE_CLOSED"
  | "CANONICAL_PAGE_OWNERSHIP_FAILURE"
  | "CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE"
  | "CANONICAL_PAGE_URL_UNAVAILABLE"
  | "PAGE_EVALUATION_FAILED";

export interface XiaohongshuPublishEditorDomRuntimeDiagnostic extends Omit<XiaohongshuPublishEditorDomSnapshot, "origin" | "pathname"> {
  origin: string | null;
  pathname: string | null;
  inspectionStatus: "PASS" | "FAIL";
  failureCode: XiaohongshuPublishEditorDomRuntimeFailureCode | string | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  sessionExists: boolean;
  browserConnected: boolean;
  contextExists: boolean;
  pageExists: boolean;
  pageClosed: boolean;
  pageContextMatchesSession: boolean;
  source: string | null;
  from: string | null;
  target: string | null;
  sanitizedUrl: string | null;
}

export function emptyXiaohongshuPublishEditorDomRuntimeDiagnostic(
  accountId: string,
  overrides: Partial<XiaohongshuPublishEditorDomRuntimeDiagnostic> = {}
): XiaohongshuPublishEditorDomRuntimeDiagnostic {
  return {
    inspectionStatus: "FAIL",
    failureCode: "BROWSER_SESSION_UNAVAILABLE",
    accountId,
    contextDebugId: null,
    pageId: null,
    sessionExists: false,
    browserConnected: false,
    contextExists: false,
    pageExists: false,
    pageClosed: true,
    pageContextMatchesSession: false,
    origin: null,
    pathname: null,
    source: null,
    from: null,
    target: null,
    sanitizedUrl: null,
    labels: EMPTY_LABELS.map((label) => ({ label, exactTextMatchCount: 0, nodes: [] })),
    actualSelectedTabSignal: "NOT_PROVEN",
    fileInputs: [],
    ...overrides
  };
}

const EMPTY_LABELS = ["上传视频", "上传图文", "写长文", "发播客", "上传图片", "文字配图"] as const;

export function emptyXiaohongshuPublishEditorDomSnapshot(origin = "", pathname = ""): XiaohongshuPublishEditorDomSnapshot {
  return {
    origin,
    pathname,
    labels: EMPTY_LABELS.map((label) => ({ label, exactTextMatchCount: 0, nodes: [] })),
    actualSelectedTabSignal: "NOT_PROVEN",
    fileInputs: []
  };
}

/**
 * Executes one self-contained, read-only DOM inspection in the page context.
 * Fixed labels intentionally live inside the evaluate callback so the browser
 * never depends on a Main-process closure or caller-provided selector.
 */
export async function inspectXiaohongshuPublishEditorDom(page: Page): Promise<XiaohongshuPublishEditorDomSnapshot> {
  return page.evaluate(() => {
    const labels = ["上传视频", "上传图文", "写长文", "发播客", "上传图片", "文字配图"] as const;
    const maxStringLength = 160;
    const maxAncestors = 5;
    const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
    const safeString = (value: string | null, limit = maxStringLength): string => (value ?? "").slice(0, limit);
    const safeAttribute = (element: Element, name: string): string | null => {
      const value = element.getAttribute(name);
      return value === null ? null : safeString(value, 120);
    };
    const boundedNumber = (value: number): number => Math.round(Math.max(-100000, Math.min(100000, value)) * 100) / 100;
    const boundingRect = (element: Element): { x: number; y: number; width: number; height: number } | null => {
      const rect = element.getBoundingClientRect();
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
      return { x: boundedNumber(rect.x), y: boundedNumber(rect.y), width: boundedNumber(rect.width), height: boundedNumber(rect.height) };
    };
    const classNameSafe = (element: Element): string => safeString(element.getAttribute("class"));
    const role = (element: Element): string | null => safeAttribute(element, "role");
    const tabIndex = (element: Element): number => {
      const value = (element as HTMLElement).tabIndex;
      return Number.isFinite(value) ? Math.max(-1, Math.min(1000, Math.trunc(value))) : -1;
    };
    const style = (element: Element): CSSStyleDeclaration => window.getComputedStyle(element);
    const isVisible = (element: Element, computed = style(element)): boolean => {
      const rect = boundingRect(element);
      return element.isConnected && computed.display !== "none" && computed.visibility !== "hidden" && computed.visibility !== "collapse" && rect !== null && rect.width > 0 && rect.height > 0;
    };
    const isEnabled = (element: Element): boolean => {
      const disabledProperty = "disabled" in element && Boolean((element as HTMLInputElement | HTMLButtonElement).disabled);
      return !disabledProperty && safeAttribute(element, "disabled") === null && safeAttribute(element, "aria-disabled")?.toLowerCase() !== "true";
    };
    const isPositiveState = (value: string | null): boolean => value !== null && value.toLowerCase() !== "false" && value !== "0";
    const ancestorSafe = (element: Element): XiaohongshuPublishEditorDomAncestorSafe => {
      const computed = style(element);
      return {
        tagName: element.tagName.toUpperCase(),
        role: role(element),
        tabIndex: tabIndex(element),
        classNameSafe: classNameSafe(element),
        ariaSelected: safeAttribute(element, "aria-selected"),
        ariaCurrent: safeAttribute(element, "aria-current"),
        pointerEvents: safeString(computed.pointerEvents, 40),
        cursor: safeString(computed.cursor, 40)
      };
    };
    const ancestorsSafe = (element: Element): readonly XiaohongshuPublishEditorDomAncestorSafe[] => {
      const ancestors: XiaohongshuPublishEditorDomAncestorSafe[] = [];
      let current = element.parentElement;
      while (current && ancestors.length < maxAncestors) {
        ancestors.push(ancestorSafe(current));
        current = current.parentElement;
      }
      return ancestors;
    };
    const nodeSafe = (element: Element): XiaohongshuPublishEditorDomNodeSafe => {
      const computed = style(element);
      const ancestors = ancestorsSafe(element);
      return {
        ...ancestorSafe(element),
        ariaPressed: safeAttribute(element, "aria-pressed"),
        display: safeString(computed.display, 40),
        visibility: safeString(computed.visibility, 40),
        boundingRect: boundingRect(element),
        connected: element.isConnected,
        visible: isVisible(element, computed),
        enabled: isEnabled(element),
        parent: element.parentElement ? ancestorSafe(element.parentElement) : null,
        ancestors
      };
    };
    const exactElements = (label: string): Element[] => {
      const raw = Array.from(document.querySelectorAll("*"))
        .filter((element) => normalize(element.textContent ?? "") === label);
      return raw.filter((element) => !raw.some((other) => other !== element && element.contains(other)));
    };
    const diagnostics = labels.map((label): XiaohongshuPublishEditorDomLabelSafe => {
      const elements = exactElements(label);
      return { label, exactTextMatchCount: elements.length, nodes: elements.slice(0, 20).map(nodeSafe) };
    });
    const imageTab = diagnostics.find((item) => item.label === "上传图文");
    const imageTabElement = exactElements("上传图文").length === 1 ? exactElements("上传图文")[0] ?? null : null;
    let actualSelectedTabSignal: XiaohongshuPublishEditorDomSelectedSignal = "NOT_PROVEN";
    if (imageTab && imageTab.exactTextMatchCount === 1 && imageTab.nodes[0]?.visible && imageTabElement) {
      const selected = safeAttribute(imageTabElement, "aria-selected");
      const current = safeAttribute(imageTabElement, "aria-current");
      const pressed = safeAttribute(imageTabElement, "aria-pressed");
      if (isPositiveState(selected)) actualSelectedTabSignal = "ARIA_SELECTED";
      else if (isPositiveState(current)) actualSelectedTabSignal = "ARIA_CURRENT";
      else if (isPositiveState(pressed)) actualSelectedTabSignal = "ARIA_PRESSED";
      else if (/(?:^|[\s_-])(?:active|selected|current)(?:$|[\s_-])/iu.test(classNameSafe(imageTabElement))) actualSelectedTabSignal = "SELF_CLASS";
      else if (imageTabElement.parentElement && /(?:^|[\s_-])(?:active|selected|current)(?:$|[\s_-])/iu.test(classNameSafe(imageTabElement.parentElement))) actualSelectedTabSignal = "PARENT_CLASS";
      else {
        let ancestor = imageTabElement.parentElement;
        let depth = 0;
        while (ancestor && depth < maxAncestors) {
          if (/(?:^|[\s_-])(?:active|selected|current)(?:$|[\s_-])/iu.test(classNameSafe(ancestor))) {
            actualSelectedTabSignal = "ANCESTOR_CLASS";
            break;
          }
          ancestor = ancestor.parentElement;
          depth += 1;
        }
      }
    }
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).slice(0, 20).map((element) => {
      const input = element as HTMLInputElement;
      return { type: safeString(input.getAttribute("type") ?? "file", 40).toLowerCase(), accept: safeAttribute(input, "accept"), multiple: input.multiple, disabled: input.disabled || safeAttribute(input, "disabled") !== null || safeAttribute(input, "aria-disabled")?.toLowerCase() === "true", classNameSafe: classNameSafe(input) };
    });
    return { origin: window.location.origin, pathname: window.location.pathname, labels: diagnostics, actualSelectedTabSignal, fileInputs };
  });
}
