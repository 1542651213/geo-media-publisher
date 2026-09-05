import type { Page } from "playwright-core";

export type XiaohongshuGlobalExactPublishUnique = "NO" | "YES" | "AMBIGUOUS";
export type XiaohongshuGlobalExactPublishClickableSignal =
  | "NATIVE_BUTTON"
  | "ROLE_BUTTON"
  | "TABINDEX_INTERACTIVE"
  | "CURSOR_POINTER"
  | "POINTER_EVENTS_ACTIVE"
  | "OTHER_SAFE_STRUCTURAL_SIGNAL"
  | "NONE";

export interface XiaohongshuGlobalExactPublishBoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XiaohongshuGlobalExactPublishAncestorSafe {
  depth: number;
  tagName: string;
  role: string | null;
  classNameSafe: string;
  tabIndex: number;
  ariaDisabled: string | null;
  disabled: boolean;
  pointerEvents: string;
  cursor: string;
  display: string;
  visibility: string;
  boundingRect: XiaohongshuGlobalExactPublishBoundingRect | null;
  connected: boolean;
  clickableSignals: readonly XiaohongshuGlobalExactPublishClickableSignal[];
}

export interface XiaohongshuGlobalExactPublishNodeSafe extends Omit<XiaohongshuGlobalExactPublishAncestorSafe, "depth"> {
  rendered: boolean;
  ancestors: readonly XiaohongshuGlobalExactPublishAncestorSafe[];
}

export interface XiaohongshuGlobalExactPublishDomSnapshot {
  origin: string;
  pathname: string;
  globalExactPublishTextMatchCount: number;
  globalExactPublishUnique: XiaohongshuGlobalExactPublishUnique;
  globalExactPublishNodesSafe: readonly XiaohongshuGlobalExactPublishNodeSafe[];
  maxAncestorDepth: 5;
  scanTruncated: boolean;
}

export type XiaohongshuGlobalExactPublishDiagnosticFailureCode =
  | "BROWSER_SESSION_UNAVAILABLE"
  | "BROWSER_SESSION_DISCONNECTED"
  | "CANONICAL_PAGE_UNAVAILABLE"
  | "CANONICAL_PAGE_CLOSED"
  | "CANONICAL_PAGE_OWNERSHIP_FAILURE"
  | "CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE"
  | "CANONICAL_PAGE_URL_UNAVAILABLE"
  | "PAGE_EVALUATION_FAILED";

export interface XiaohongshuGlobalExactPublishDomRuntimeDiagnostic extends Omit<XiaohongshuGlobalExactPublishDomSnapshot, "origin" | "pathname"> {
  inspectionStatus: "PASS" | "FAIL";
  failureCode: XiaohongshuGlobalExactPublishDiagnosticFailureCode | string | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  sessionExists: boolean;
  browserConnected: boolean;
  contextExists: boolean;
  pageExists: boolean;
  pageClosed: boolean;
  pageContextMatchesSession: boolean;
  origin: string | null;
  pathname: string | null;
  sanitizedUrl: string | null;
}

export function emptyXiaohongshuGlobalExactPublishDomRuntimeDiagnostic(
  accountId: string,
  overrides: Partial<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic> = {}
): XiaohongshuGlobalExactPublishDomRuntimeDiagnostic {
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
    sanitizedUrl: null,
    globalExactPublishTextMatchCount: 0,
    globalExactPublishUnique: "NO",
    globalExactPublishNodesSafe: [],
    maxAncestorDepth: 5,
    scanTruncated: false,
    ...overrides
  };
}

export async function inspectXiaohongshuGlobalExactPublishDom(page: Page): Promise<XiaohongshuGlobalExactPublishDomSnapshot> {
  return page.evaluate(() => {
    const maxAncestorDepth = 5;
    const maxScanElements = 5000;
    const maxMatches = 20;
    const targetLabel = "发布";
    const normalize = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
    const safeString = (value: string | null, limit = 120): string => (value ?? "").slice(0, limit);
    const safeAttribute = (element: Element, name: string): string | null => {
      const value = element.getAttribute(name);
      return value === null ? null : safeString(value);
    };
    const boundedNumber = (value: number): number => Math.round(Math.max(-100000, Math.min(100000, value)) * 100) / 100;
    const boundingRect = (element: Element): XiaohongshuGlobalExactPublishBoundingRect | null => {
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
    const disabled = (element: Element): boolean => {
      const disabledProperty = "disabled" in element && Boolean((element as HTMLButtonElement | HTMLInputElement).disabled);
      return disabledProperty || safeAttribute(element, "disabled") !== null || safeAttribute(element, "aria-disabled")?.toLowerCase() === "true";
    };
    const rendered = (element: Element, computed = style(element)): boolean => {
      const rect = boundingRect(element);
      return element.isConnected
        && computed.display !== "none"
        && computed.visibility !== "hidden"
        && computed.visibility !== "collapse"
        && computed.opacity !== "0"
        && rect !== null
        && rect.width > 0
        && rect.height > 0
        && safeAttribute(element, "aria-hidden")?.toLowerCase() !== "true";
    };
    const clickableSignals = (element: Element, computed = style(element)): readonly XiaohongshuGlobalExactPublishClickableSignal[] => {
      const signals: XiaohongshuGlobalExactPublishClickableSignal[] = [];
      const tagName = element.tagName.toUpperCase();
      const elementRole = role(element)?.toLowerCase();
      if (tagName === "BUTTON") signals.push("NATIVE_BUTTON");
      if (elementRole === "button") signals.push("ROLE_BUTTON");
      if (tabIndex(element) >= 0) signals.push("TABINDEX_INTERACTIVE");
      if (computed.cursor === "pointer") signals.push("CURSOR_POINTER");
      if (computed.pointerEvents !== "none") signals.push("POINTER_EVENTS_ACTIVE");
      if (tagName === "A" || elementRole === "link" || elementRole === "menuitem") signals.push("OTHER_SAFE_STRUCTURAL_SIGNAL");
      return signals.length > 0 ? signals : ["NONE"];
    };
    const safeElement = (element: Element, depth: number): XiaohongshuGlobalExactPublishAncestorSafe => {
      const computed = style(element);
      return {
        depth,
        tagName: element.tagName.toUpperCase(),
        role: role(element),
        classNameSafe: classNameSafe(element),
        tabIndex: tabIndex(element),
        ariaDisabled: safeAttribute(element, "aria-disabled"),
        disabled: disabled(element),
        pointerEvents: safeString(computed.pointerEvents, 40),
        cursor: safeString(computed.cursor, 40),
        display: safeString(computed.display, 40),
        visibility: safeString(computed.visibility, 40),
        boundingRect: boundingRect(element),
        connected: element.isConnected,
        clickableSignals: clickableSignals(element, computed)
      };
    };
    const ancestors = (element: Element): readonly XiaohongshuGlobalExactPublishAncestorSafe[] => {
      const result: XiaohongshuGlobalExactPublishAncestorSafe[] = [];
      let current = element.parentElement;
      let depth = 1;
      while (current && depth <= maxAncestorDepth) {
        result.push(safeElement(current, depth));
        current = current.parentElement;
        depth += 1;
      }
      return result;
    };
    const nodeSafe = (element: Element): XiaohongshuGlobalExactPublishNodeSafe => {
      const computed = style(element);
      return {
        ...safeElement(element, 0),
        rendered: rendered(element, computed),
        ancestors: ancestors(element)
      };
    };
    const root = document.body ?? document.documentElement;
    const walker = root ? document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT) : null;
    const rawMatches: Element[] = [];
    let scanned = 0;
    let current: Node | null = root;
    while (current && scanned < maxScanElements) {
      scanned += 1;
      if (current instanceof Element) {
        const tagName = current.tagName.toUpperCase();
        if (tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && normalize(current.textContent ?? "") === targetLabel) rawMatches.push(current);
      }
      current = walker?.nextNode() ?? null;
    }
    const exactMatches = rawMatches.filter((element) => !rawMatches.some((other) => other !== element && element.contains(other)));
    const globalExactPublishTextMatchCount = exactMatches.length;
    const globalExactPublishUnique: XiaohongshuGlobalExactPublishUnique = globalExactPublishTextMatchCount === 0
      ? "NO"
      : globalExactPublishTextMatchCount === 1 ? "YES" : "AMBIGUOUS";
    return {
      origin: window.location.origin,
      pathname: window.location.pathname,
      globalExactPublishTextMatchCount,
      globalExactPublishUnique,
      globalExactPublishNodesSafe: exactMatches.slice(0, maxMatches).map(nodeSafe),
      maxAncestorDepth: 5,
      scanTruncated: current !== null
    };
  });
}
