import type { Page } from "playwright-core";

export const XIAOHONGSHU_PUBLISH_EDITOR_TAB_LABELS = ["上传视频", "上传图文", "写长文", "发播客"] as const;
export type XiaohongshuPublishEditorTabLabel = typeof XIAOHONGSHU_PUBLISH_EDITOR_TAB_LABELS[number];
export type XiaohongshuPublishEditorSemanticProof = "PASS" | "FAIL";
export type XiaohongshuPublishEditorSelectedSignal =
  | "ARIA_SELECTED"
  | "ARIA_CURRENT"
  | "ARIA_PRESSED"
  | "SELF_CLASS"
  | "PARENT_CLASS"
  | "ANCESTOR_CLASS"
  | "NOT_PROVEN";

export interface XiaohongshuPublishEditorSemanticBoundingRect {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface XiaohongshuPublishEditorSemanticElementSafe {
  tagName: string;
  role: string | null;
  tabIndex: number;
  classNameSafe: string;
  ariaSelected: string | null;
  ariaCurrent: string | null;
  ariaPressed: string | null;
  ariaHidden: string | null;
  pointerEvents: string;
  cursor: string;
  boundingRect: XiaohongshuPublishEditorSemanticBoundingRect | null;
  connected: boolean;
  rendered: boolean;
  intersectsViewport: boolean;
  enabled: boolean;
  active: boolean;
  activeSignal: XiaohongshuPublishEditorSelectedSignal;
}

export interface XiaohongshuPublishEditorSemanticTabNodeSafe extends XiaohongshuPublishEditorSemanticElementSafe {
  nodeIndex: number;
  label: XiaohongshuPublishEditorTabLabel;
  display: string;
  visibility: string;
  opacity: string;
  enabled: boolean;
  parent: XiaohongshuPublishEditorSemanticElementSafe | null;
  ancestors: readonly XiaohongshuPublishEditorSemanticElementSafe[];
  nearestCreatorTabAncestor: XiaohongshuPublishEditorSemanticElementSafe | null;
}

export interface XiaohongshuPublishEditorSemanticTabDiagnostic {
  label: XiaohongshuPublishEditorTabLabel;
  exactTextMatchCount: number;
  nodes: readonly XiaohongshuPublishEditorSemanticTabNodeSafe[];
}

export interface XiaohongshuPublishEditorSemanticUploadImageNodeSafe {
  nodeIndex: number;
  tagName: string;
  classNameSafe: string;
  pointerEvents: string;
  cursor: string;
  ariaHidden: string | null;
  display: string;
  visibility: string;
  opacity: string;
  boundingRect: XiaohongshuPublishEditorSemanticBoundingRect | null;
  connected: boolean;
  rendered: boolean;
  intersectsViewport: boolean;
  enabled: boolean;
  parent: XiaohongshuPublishEditorSemanticElementSafe | null;
  ancestors: readonly XiaohongshuPublishEditorSemanticElementSafe[];
  nearestUploadButton: XiaohongshuPublishEditorSemanticElementSafe | null;
}

export interface XiaohongshuPublishEditorSemanticFileInputSafe {
  type: string;
  accept: string | null;
  multiple: boolean;
  disabled: boolean;
  classNameSafe: string;
}

export interface XiaohongshuPublishEditorSemanticFinalPublishNodeSafe extends XiaohongshuPublishEditorSemanticElementSafe {
  nodeIndex: number;
  normalizedText: string;
  disabled: boolean;
  ariaDisabled: string | null;
  display: string;
  visibility: string;
  parent: XiaohongshuPublishEditorSemanticElementSafe | null;
  ancestors: readonly XiaohongshuPublishEditorSemanticElementSafe[];
}

export interface XiaohongshuPublishEditorSemanticFinalPublishContainerSafe {
  tagName: string;
  role: string | null;
  classNameSafe: string;
  position: string;
  disabled: boolean;
  ariaDisabled: string | null;
  pointerEvents: string;
  cursor: string;
  boundingRect: XiaohongshuPublishEditorSemanticBoundingRect | null;
}

export type XiaohongshuPublishControlPresence = "YES" | "NO" | "AMBIGUOUS";
export type XiaohongshuPublishControlEnabled = "YES" | "NO" | "NOT_PROVEN";

export interface XiaohongshuPublishEditorFinalSubmitControlState {
  present: XiaohongshuPublishControlPresence;
  enabled: XiaohongshuPublishControlEnabled;
}

export function resolveXiaohongshuFinalSubmitControlState(
  candidates: ReadonlyArray<Pick<XiaohongshuPublishEditorSemanticFinalPublishNodeSafe, "connected" | "rendered" | "boundingRect" | "pointerEvents" | "enabled">>
): XiaohongshuPublishEditorFinalSubmitControlState {
  const valid = candidates.filter((candidate) => candidate.connected
    && candidate.rendered
    && candidate.boundingRect !== null
    && candidate.pointerEvents !== "none");
  if (valid.length > 1) return { present: "AMBIGUOUS", enabled: "NOT_PROVEN" };
  if (valid.length === 0) return { present: "NO", enabled: "NOT_PROVEN" };
  return { present: "YES", enabled: valid[0]?.enabled === true ? "YES" : "NO" };
}

export interface XiaohongshuPublishEditorSemanticCandidateSnapshot {
  origin: string;
  pathname: string;
  windowInnerWidth: number;
  windowInnerHeight: number;
  source: string | null;
  from: string | null;
  target: string | null;
  tabs: readonly XiaohongshuPublishEditorSemanticTabDiagnostic[];
  uploadImageTabTextMatchCount: number;
  uploadImageTabRenderedCandidateCount: number;
  viewportIntersectingUploadImageCandidateCount: number;
  uploadImageTabNodesSafe: readonly XiaohongshuPublishEditorSemanticTabNodeSafe[];
  uploadImageButtonTextMatchCount: number;
  uploadImageButtonRenderedCandidateCount: number;
  uploadImageButtonNodesSafe: readonly XiaohongshuPublishEditorSemanticUploadImageNodeSafe[];
  finalPublishExactTextMatchCount: number;
  finalPublishNativeButtonMatchCount: number;
  finalPublishRoleButtonMatchCount: number;
  finalPublishCandidatesSafe: readonly XiaohongshuPublishEditorSemanticFinalPublishNodeSafe[];
  finalPublishContainerSafe: XiaohongshuPublishEditorSemanticFinalPublishContainerSafe | null;
  finalSubmitControlPresent: XiaohongshuPublishControlPresence;
  finalSubmitControlEnabled: XiaohongshuPublishControlEnabled;
  visibleCreatorTabCount: number;
  renderedCreatorTabCount: number;
  viewportIntersectingCreatorTabCount: number;
  activeCreatorTabCount: number;
  viewportIntersectingActiveCreatorTabCount: number;
  activeCreatorTabLabel: XiaohongshuPublishEditorTabLabel | null;
  viewportIntersectingActiveCreatorTabLabel: XiaohongshuPublishEditorTabLabel | null;
  actualSelectedTabSignal: XiaohongshuPublishEditorSelectedSignal;
  selectedImageTabProof: XiaohongshuPublishEditorSemanticProof;
  imageUploadSurfaceProof: XiaohongshuPublishEditorSemanticProof;
  fileInputs: readonly XiaohongshuPublishEditorSemanticFileInputSafe[];
  acceptableImageFileInputCount: number;
  imagePostSemanticProof: XiaohongshuPublishEditorSemanticProof;
}

export type XiaohongshuPublishEditorSemanticRuntimeFailureCode =
  | "BROWSER_SESSION_UNAVAILABLE"
  | "BROWSER_SESSION_DISCONNECTED"
  | "CANONICAL_PAGE_UNAVAILABLE"
  | "CANONICAL_PAGE_CLOSED"
  | "CANONICAL_PAGE_OWNERSHIP_FAILURE"
  | "CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE"
  | "CANONICAL_PAGE_URL_UNAVAILABLE"
  | "PAGE_EVALUATION_FAILED";

export interface XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic extends Omit<XiaohongshuPublishEditorSemanticCandidateSnapshot, "origin" | "pathname"> {
  origin: string | null;
  pathname: string | null;
  inspectionStatus: "PASS" | "FAIL";
  failureCode: XiaohongshuPublishEditorSemanticRuntimeFailureCode | string | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  sessionExists: boolean;
  browserConnected: boolean;
  contextExists: boolean;
  pageExists: boolean;
  pageClosed: boolean;
  pageContextMatchesSession: boolean;
  sanitizedUrl: string | null;
}

const EMPTY_TABS: readonly XiaohongshuPublishEditorSemanticTabDiagnostic[] = XIAOHONGSHU_PUBLISH_EDITOR_TAB_LABELS.map((label) => ({ label, exactTextMatchCount: 0, nodes: [] }));

export function emptyXiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic(
  accountId: string,
  overrides: Partial<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic> = {}
): XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic {
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
    windowInnerWidth: 0,
    windowInnerHeight: 0,
    source: null,
    from: null,
    target: null,
    sanitizedUrl: null,
    tabs: EMPTY_TABS,
    uploadImageTabTextMatchCount: 0,
    uploadImageTabRenderedCandidateCount: 0,
    viewportIntersectingUploadImageCandidateCount: 0,
    uploadImageTabNodesSafe: [],
    uploadImageButtonTextMatchCount: 0,
    uploadImageButtonRenderedCandidateCount: 0,
    uploadImageButtonNodesSafe: [],
    finalPublishExactTextMatchCount: 0,
    finalPublishNativeButtonMatchCount: 0,
    finalPublishRoleButtonMatchCount: 0,
    finalPublishCandidatesSafe: [],
    finalPublishContainerSafe: null,
    finalSubmitControlPresent: "NO",
    finalSubmitControlEnabled: "NOT_PROVEN",
    visibleCreatorTabCount: 0,
    renderedCreatorTabCount: 0,
    viewportIntersectingCreatorTabCount: 0,
    activeCreatorTabCount: 0,
    viewportIntersectingActiveCreatorTabCount: 0,
    activeCreatorTabLabel: null,
    viewportIntersectingActiveCreatorTabLabel: null,
    actualSelectedTabSignal: "NOT_PROVEN",
    selectedImageTabProof: "FAIL",
    imageUploadSurfaceProof: "FAIL",
    fileInputs: [],
    acceptableImageFileInputCount: 0,
    imagePostSemanticProof: "FAIL",
    ...overrides
  };
}

export async function inspectXiaohongshuPublishEditorSemanticCandidates(page: Page): Promise<XiaohongshuPublishEditorSemanticCandidateSnapshot> {
  const snapshot = await page.evaluate(() => {
    const tabLabels = ["上传视频", "上传图文", "写长文", "发播客"] as const;
    const uploadImageLabel = "上传图片";
    const maxStringLength = 160;
    const maxAncestors = 5;
    const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
    const safeString = (value: string | null, limit = maxStringLength): string => (value ?? "").slice(0, limit);
    const safeAttribute = (element: Element, name: string): string | null => {
      const value = element.getAttribute(name);
      return value === null ? null : safeString(value, 120);
    };
    const boundedNumber = (value: number): number => Math.round(Math.max(-100000, Math.min(100000, value)) * 100) / 100;
    const getBoundingRect = (element: Element): { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number } | null => {
      const rect = element.getBoundingClientRect();
      if (![rect.x, rect.y, rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite)) return null;
      return { x: boundedNumber(rect.x), y: boundedNumber(rect.y), left: boundedNumber(rect.left), top: boundedNumber(rect.top), right: boundedNumber(rect.right), bottom: boundedNumber(rect.bottom), width: boundedNumber(rect.width), height: boundedNumber(rect.height) };
    };
    const classNameSafe = (element: Element): string => safeString(element.getAttribute("class"));
    const role = (element: Element): string | null => safeAttribute(element, "role");
    const tabIndex = (element: Element): number => {
      const value = (element as HTMLElement).tabIndex;
      return Number.isFinite(value) ? Math.max(-1, Math.min(1000, Math.trunc(value))) : -1;
    };
    const style = (element: Element): CSSStyleDeclaration => window.getComputedStyle(element);
    const viewportWidth = Math.max(0, Number.isFinite(window.innerWidth) ? window.innerWidth : 0);
    const viewportHeight = Math.max(0, Number.isFinite(window.innerHeight) ? window.innerHeight : 0);
    const intersectsViewport = (rect: ReturnType<typeof getBoundingRect>): boolean => rect !== null
      && rect.right > 0
      && rect.bottom > 0
      && rect.left < viewportWidth
      && rect.top < viewportHeight
      && rect.width > 0
      && rect.height > 0;
    const isPositiveState = (value: string | null): boolean => value !== null && value.toLowerCase() !== "false" && value !== "0";
    const hasClassToken = (element: Element, token: string): boolean => new RegExp(`(?:^|[\\s_-])${token}(?:$|[\\s_-])`, "iu").test(classNameSafe(element));
    const isEnabled = (element: Element): boolean => {
      const disabledProperty = "disabled" in element && Boolean((element as HTMLInputElement | HTMLButtonElement).disabled);
      return !disabledProperty && safeAttribute(element, "disabled") === null && safeAttribute(element, "aria-disabled")?.toLowerCase() !== "true";
    };
    const isRendered = (element: Element, computed = style(element)): boolean => {
      const rect = getBoundingRect(element);
      return element.isConnected
        && computed.display !== "none"
        && computed.visibility !== "hidden"
        && computed.visibility !== "collapse"
        && rect !== null
        && rect.width > 0
        && rect.height > 0
        && safeAttribute(element, "aria-hidden")?.toLowerCase() !== "true";
    };
    const activeSignal = (element: Element): "ARIA_SELECTED" | "ARIA_CURRENT" | "ARIA_PRESSED" | "SELF_CLASS" | "NOT_PROVEN" => {
      if (isPositiveState(safeAttribute(element, "aria-selected"))) return "ARIA_SELECTED";
      if (isPositiveState(safeAttribute(element, "aria-current"))) return "ARIA_CURRENT";
      if (isPositiveState(safeAttribute(element, "aria-pressed"))) return "ARIA_PRESSED";
      if (hasClassToken(element, "active") || hasClassToken(element, "selected") || hasClassToken(element, "current")) return "SELF_CLASS";
      return "NOT_PROVEN";
    };
    const ancestorActiveSignal = (element: Element): "ARIA_SELECTED" | "ARIA_CURRENT" | "ARIA_PRESSED" | "SELF_CLASS" | "PARENT_CLASS" | "ANCESTOR_CLASS" | "NOT_PROVEN" => {
      const own = activeSignal(element);
      if (own !== "NOT_PROVEN") return own;
      let current = element.parentElement;
      let depth = 0;
      while (current && depth < maxAncestors) {
        const signal = activeSignal(current);
        if (signal !== "NOT_PROVEN") return depth === 0 ? "PARENT_CLASS" : "ANCESTOR_CLASS";
        current = current.parentElement;
        depth += 1;
      }
      return "NOT_PROVEN";
    };
    const safeElement = (element: Element, active: boolean, signal: "ARIA_SELECTED" | "ARIA_CURRENT" | "ARIA_PRESSED" | "SELF_CLASS" | "PARENT_CLASS" | "ANCESTOR_CLASS" | "NOT_PROVEN"): {
      tagName: string;
      role: string | null;
      tabIndex: number;
      classNameSafe: string;
      ariaSelected: string | null;
      ariaCurrent: string | null;
      ariaPressed: string | null;
      ariaHidden: string | null;
      pointerEvents: string;
      cursor: string;
      boundingRect: { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
      connected: boolean;
      rendered: boolean;
      intersectsViewport: boolean;
      enabled: boolean;
      active: boolean;
      activeSignal: typeof signal;
    } => {
      const computed = style(element);
      const rect = getBoundingRect(element);
      return {
        tagName: element.tagName.toUpperCase(),
        role: role(element),
        tabIndex: tabIndex(element),
        classNameSafe: classNameSafe(element),
        ariaSelected: safeAttribute(element, "aria-selected"),
        ariaCurrent: safeAttribute(element, "aria-current"),
        ariaPressed: safeAttribute(element, "aria-pressed"),
        ariaHidden: safeAttribute(element, "aria-hidden"),
        pointerEvents: safeString(computed.pointerEvents, 40),
        cursor: safeString(computed.cursor, 40),
        boundingRect: rect,
        connected: element.isConnected,
        rendered: isRendered(element, computed),
        intersectsViewport: intersectsViewport(rect),
        enabled: isEnabled(element),
        active,
        activeSignal: signal
      };
    };
    const ancestorsOf = (element: Element): Element[] => {
      const result: Element[] = [];
      let current = element.parentElement;
      while (current && result.length < maxAncestors) {
        result.push(current);
        current = current.parentElement;
      }
      return result;
    };
    const creatorTabAncestor = (element: Element): Element | null => {
      for (const ancestor of ancestorsOf(element)) {
        if (hasClassToken(ancestor, "creator-tab")) return ancestor;
      }
      return null;
    };
    const uploadButtonAncestor = (element: Element): Element | null => {
      for (const ancestor of ancestorsOf(element)) {
        if (ancestor.tagName.toUpperCase() === "BUTTON" && hasClassToken(ancestor, "upload-button")) return ancestor;
      }
      return null;
    };
    const exactElements = (label: string): Element[] => {
      const raw = Array.from(document.querySelectorAll("*")).filter((element) => normalize(element.textContent ?? "") === label);
      return raw.filter((element) => !raw.some((other) => other !== element && element.contains(other))).slice(0, 20);
    };
    const tabNode = (label: typeof tabLabels[number], element: Element, nodeIndex: number): {
      nodeIndex: number;
      label: typeof tabLabels[number];
      tagName: string;
      role: string | null;
      tabIndex: number;
      classNameSafe: string;
      ariaSelected: string | null;
      ariaCurrent: string | null;
      ariaPressed: string | null;
      ariaHidden: string | null;
      pointerEvents: string;
      cursor: string;
      boundingRect: { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
      connected: boolean;
      rendered: boolean;
      intersectsViewport: boolean;
      active: boolean;
      activeSignal: ReturnType<typeof ancestorActiveSignal>;
      display: string;
      visibility: string;
      opacity: string;
      enabled: boolean;
      parent: ReturnType<typeof safeElement> | null;
      ancestors: readonly ReturnType<typeof safeElement>[];
      nearestCreatorTabAncestor: ReturnType<typeof safeElement> | null;
    } => {
      const computed = style(element);
      const signal = ancestorActiveSignal(element);
      const nearest = creatorTabAncestor(element);
      const safeAncestors = ancestorsOf(element).map((ancestor) => safeElement(ancestor, ancestorActiveSignal(ancestor) !== "NOT_PROVEN", ancestorActiveSignal(ancestor)));
      return {
        nodeIndex,
        label,
        ...safeElement(element, signal !== "NOT_PROVEN", signal),
        display: safeString(computed.display, 40),
        visibility: safeString(computed.visibility, 40),
        opacity: safeString(computed.opacity, 40),
        enabled: isEnabled(element),
        parent: element.parentElement ? safeElement(element.parentElement, ancestorActiveSignal(element.parentElement) !== "NOT_PROVEN", ancestorActiveSignal(element.parentElement)) : null,
        ancestors: safeAncestors,
        nearestCreatorTabAncestor: nearest ? safeElement(nearest, ancestorActiveSignal(nearest) !== "NOT_PROVEN", ancestorActiveSignal(nearest)) : null
      };
    };
    const uploadNode = (element: Element, nodeIndex: number): {
      nodeIndex: number;
      tagName: string;
      classNameSafe: string;
      pointerEvents: string;
      cursor: string;
      ariaHidden: string | null;
      display: string;
      visibility: string;
      opacity: string;
      boundingRect: { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
      connected: boolean;
      rendered: boolean;
      intersectsViewport: boolean;
      enabled: boolean;
      parent: ReturnType<typeof safeElement> | null;
      ancestors: readonly ReturnType<typeof safeElement>[];
      nearestUploadButton: ReturnType<typeof safeElement> | null;
    } => {
      const computed = style(element);
      const button = uploadButtonAncestor(element);
      const rect = getBoundingRect(element);
      return {
        nodeIndex,
        tagName: element.tagName.toUpperCase(),
        classNameSafe: classNameSafe(element),
        pointerEvents: safeString(computed.pointerEvents, 40),
        cursor: safeString(computed.cursor, 40),
        ariaHidden: safeAttribute(element, "aria-hidden"),
        display: safeString(computed.display, 40),
        visibility: safeString(computed.visibility, 40),
        opacity: safeString(computed.opacity, 40),
        boundingRect: rect,
        connected: element.isConnected,
        rendered: isRendered(element, computed),
        intersectsViewport: intersectsViewport(rect),
        enabled: isEnabled(element),
        parent: element.parentElement ? safeElement(element.parentElement, false, "NOT_PROVEN") : null,
        ancestors: ancestorsOf(element).map((ancestor) => safeElement(ancestor, false, "NOT_PROVEN")),
        nearestUploadButton: button ? safeElement(button, false, "NOT_PROVEN") : null
      };
    };

    const finalPublishLabels = ["发布", "发布笔记", "发表", "提交", "立即发布", "publish", "submit"] as const;
    const finalPublishLabel = (element: Element): string => {
      const textLabel = normalize(element.textContent ?? "");
      if (textLabel.length > 0) return textLabel;
      const ariaLabel = normalize(element.getAttribute("aria-label") ?? "");
      if (ariaLabel.length > 0) return ariaLabel;
      return normalize(element.getAttribute("title") ?? "");
    };
    const finalPublishElements = Array.from(document.querySelectorAll('button, [role="button"]')).filter((element) => {
      const label = finalPublishLabel(element);
      return finalPublishLabels.some((allowedLabel) => label.toLowerCase() === allowedLabel.toLowerCase()) && !/视频|video/iu.test(label);
    });
    const finalPublishNode = (element: Element, nodeIndex: number): {
      nodeIndex: number;
      normalizedText: string;
      tagName: string;
      role: string | null;
      tabIndex: number;
      classNameSafe: string;
      ariaSelected: string | null;
      ariaCurrent: string | null;
      ariaPressed: string | null;
      ariaHidden: string | null;
      ariaDisabled: string | null;
      pointerEvents: string;
      cursor: string;
      boundingRect: { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
      connected: boolean;
      rendered: boolean;
      intersectsViewport: boolean;
      enabled: boolean;
      disabled: boolean;
      active: boolean;
      activeSignal: ReturnType<typeof ancestorActiveSignal>;
      display: string;
      visibility: string;
      parent: ReturnType<typeof safeElement> | null;
      ancestors: readonly ReturnType<typeof safeElement>[];
    } => {
      const computed = style(element);
      const signal = ancestorActiveSignal(element);
      const disabledProperty = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
      return {
        nodeIndex,
        normalizedText: finalPublishLabel(element),
        ...safeElement(element, signal !== "NOT_PROVEN", signal),
        ariaDisabled: safeAttribute(element, "aria-disabled"),
        disabled: disabledProperty || safeAttribute(element, "disabled") !== null,
        display: safeString(computed.display, 40),
        visibility: safeString(computed.visibility, 40),
        parent: element.parentElement ? safeElement(element.parentElement, false, "NOT_PROVEN") : null,
        ancestors: ancestorsOf(element).map((ancestor) => safeElement(ancestor, false, "NOT_PROVEN"))
      };
    };
    const finalPublishContainer = (element: Element | null): {
      tagName: string;
      role: string | null;
      classNameSafe: string;
      position: string;
      disabled: boolean;
      ariaDisabled: string | null;
      pointerEvents: string;
      cursor: string;
      boundingRect: { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
    } | null => {
      if (!element) return null;
      const computed = style(element);
      const disabledProperty = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
      return {
        tagName: element.tagName.toUpperCase(),
        role: role(element),
        classNameSafe: classNameSafe(element),
        position: safeString(computed.position, 40),
        disabled: disabledProperty || safeAttribute(element, "disabled") !== null,
        ariaDisabled: safeAttribute(element, "aria-disabled"),
        pointerEvents: safeString(computed.pointerEvents, 40),
        cursor: safeString(computed.cursor, 40),
        boundingRect: getBoundingRect(element)
      };
    };

    const tabDiagnostics = tabLabels.map((label) => {
      const elements = exactElements(label);
      return { label, exactTextMatchCount: elements.length, nodes: elements.map((element, index) => tabNode(label, element, index)) };
    });
    const imageTab = tabDiagnostics.find((diagnostic) => diagnostic.label === "上传图文");
    const uploadImageElements = exactElements(uploadImageLabel);
    const uploadImageNodes = uploadImageElements.map(uploadNode);
    const creatorTabs: Element[] = [];
    const creatorTabLabels = new Map<Element, typeof tabLabels[number]>();
    for (const diagnostic of tabDiagnostics) {
      const elements = exactElements(diagnostic.label);
      for (const element of elements) {
        const creatorTab = creatorTabAncestor(element);
        if (!creatorTab) continue;
        if (!creatorTabs.includes(creatorTab)) creatorTabs.push(creatorTab);
        if (!creatorTabLabels.has(creatorTab)) creatorTabLabels.set(creatorTab, diagnostic.label);
      }
    }
    const visibleCreatorTabs = creatorTabs.filter((element) => isRendered(element));
    const viewportIntersectingCreatorTabs = visibleCreatorTabs.filter((element) => intersectsViewport(getBoundingRect(element)));
    const activeCreatorTabs = visibleCreatorTabs.filter((element) => ancestorActiveSignal(element) !== "NOT_PROVEN");
    const viewportIntersectingActiveCreatorTabs = viewportIntersectingCreatorTabs.filter((element) => ancestorActiveSignal(element) !== "NOT_PROVEN");
    const imageTabRenderedCount = imageTab?.nodes.filter((node) => node.rendered && node.enabled && node.pointerEvents !== "none").length ?? 0;
    const viewportIntersectingImageTabCount = imageTab?.nodes.filter((node) => node.rendered
      && node.enabled
      && node.pointerEvents !== "none"
      && node.intersectsViewport
      && node.nearestCreatorTabAncestor?.rendered
      && node.nearestCreatorTabAncestor.intersectsViewport).length ?? 0;
    const uploadButtonCandidateCount = uploadImageNodes.filter((node) => node.rendered
      && node.enabled
      && node.pointerEvents !== "none"
      && node.nearestUploadButton?.tagName === "BUTTON"
      && node.nearestUploadButton.rendered
      && node.nearestUploadButton.enabled
      && node.nearestUploadButton.pointerEvents !== "none").length;
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).slice(0, 20).map((element) => {
      const input = element as HTMLInputElement;
      return {
        type: safeString(input.getAttribute("type") ?? "file", 40).toLowerCase(),
        accept: safeAttribute(input, "accept"),
        multiple: input.multiple,
        disabled: input.disabled || safeAttribute(input, "disabled") !== null || safeAttribute(input, "aria-disabled")?.toLowerCase() === "true",
        classNameSafe: classNameSafe(input)
      };
    });
    const isAcceptableImageInput = (input: typeof fileInputs[number]): boolean => input.type === "file" && !input.disabled && Boolean(input.accept && /(?:^|[,\s])(?:image[/]\*|image|\.(?:jpe?g|png|webp|gif|bmp|avif))(?:$|[,\s])/iu.test(input.accept));
    const acceptableImageFileInputCount = fileInputs.filter(isAcceptableImageInput).length;
    const selectedViewportTabSignal = viewportIntersectingActiveCreatorTabs.length === 1 ? ancestorActiveSignal(viewportIntersectingActiveCreatorTabs[0] as Element) : "NOT_PROVEN";
    const selectedImageTabProof = viewportIntersectingImageTabCount === 1
      && viewportIntersectingActiveCreatorTabs.length === 1
      && creatorTabLabels.get(viewportIntersectingActiveCreatorTabs[0] as Element) === "上传图文"
      ? "PASS"
      : "FAIL";
    const imageUploadSurfaceProof = uploadButtonCandidateCount === 1 && acceptableImageFileInputCount === 1 ? "PASS" : "FAIL";
    const imagePostSemanticProof = window.location.origin === "https://creator.xiaohongshu.com"
      && window.location.pathname === "/publish/publish"
      && new URLSearchParams(window.location.search).get("target") === "image"
      && selectedImageTabProof === "PASS"
      && imageUploadSurfaceProof === "PASS"
      ? "PASS"
      : "FAIL";
    const selectedLabel = activeCreatorTabs.length === 1 ? creatorTabLabels.get(activeCreatorTabs[0] as Element) ?? null : null;
    const viewportSelectedLabel = viewportIntersectingActiveCreatorTabs.length === 1 ? creatorTabLabels.get(viewportIntersectingActiveCreatorTabs[0] as Element) ?? null : null;
    const selectedSignal = viewportIntersectingActiveCreatorTabs.length === 1 ? selectedViewportTabSignal : "NOT_PROVEN";
    const finalPublishCandidatesSafe = finalPublishElements.map(finalPublishNode);
    const finalPublishRenderedCandidates = finalPublishCandidatesSafe.filter((node) => node.connected && node.rendered && node.boundingRect !== null && node.pointerEvents !== "none");
    const finalSubmitControlPresent = finalPublishRenderedCandidates.length > 1 ? "AMBIGUOUS" : finalPublishRenderedCandidates.length === 1 ? "YES" : "NO";
    const finalSubmitControlEnabled = finalPublishRenderedCandidates.length === 1 ? finalPublishRenderedCandidates[0]?.enabled === true ? "YES" : "NO" : "NOT_PROVEN";
    return {
      origin: window.location.origin,
      pathname: window.location.pathname,
      windowInnerWidth: viewportWidth,
      windowInnerHeight: viewportHeight,
      source: new URLSearchParams(window.location.search).get("source"),
      from: new URLSearchParams(window.location.search).get("from"),
      target: new URLSearchParams(window.location.search).get("target"),
      tabs: tabDiagnostics,
      uploadImageTabTextMatchCount: imageTab?.exactTextMatchCount ?? 0,
      uploadImageTabRenderedCandidateCount: imageTabRenderedCount,
      viewportIntersectingUploadImageCandidateCount: viewportIntersectingImageTabCount,
      uploadImageTabNodesSafe: imageTab?.nodes ?? [],
      uploadImageButtonTextMatchCount: uploadImageElements.length,
      uploadImageButtonRenderedCandidateCount: uploadButtonCandidateCount,
      uploadImageButtonNodesSafe: uploadImageNodes,
      finalPublishExactTextMatchCount: finalPublishElements.length,
      finalPublishNativeButtonMatchCount: finalPublishElements.filter((element) => element.tagName.toUpperCase() === "BUTTON").length,
      finalPublishRoleButtonMatchCount: finalPublishElements.filter((element) => element.getAttribute("role") === "button").length,
      finalPublishCandidatesSafe,
      finalPublishContainerSafe: finalPublishRenderedCandidates.length === 1 ? finalPublishContainer(finalPublishElements[finalPublishCandidatesSafe.findIndex((node) => node.connected && node.rendered && node.boundingRect !== null && node.pointerEvents !== "none")]?.parentElement ?? null) : null,
      finalSubmitControlPresent,
      finalSubmitControlEnabled,
      visibleCreatorTabCount: visibleCreatorTabs.length,
      renderedCreatorTabCount: visibleCreatorTabs.length,
      viewportIntersectingCreatorTabCount: viewportIntersectingCreatorTabs.length,
      activeCreatorTabCount: activeCreatorTabs.length,
      viewportIntersectingActiveCreatorTabCount: viewportIntersectingActiveCreatorTabs.length,
      activeCreatorTabLabel: selectedLabel,
      viewportIntersectingActiveCreatorTabLabel: viewportSelectedLabel,
      actualSelectedTabSignal: selectedSignal,
      selectedImageTabProof,
      imageUploadSurfaceProof,
      fileInputs,
      acceptableImageFileInputCount,
      imagePostSemanticProof
    } as const;
  });
  const finalPublishCandidatesSafe = snapshot.finalPublishCandidatesSafe ?? [];
  const finalSubmitControlState = resolveXiaohongshuFinalSubmitControlState(finalPublishCandidatesSafe);
  return {
    ...snapshot,
    finalPublishExactTextMatchCount: snapshot.finalPublishExactTextMatchCount ?? 0,
    finalPublishNativeButtonMatchCount: snapshot.finalPublishNativeButtonMatchCount ?? 0,
    finalPublishRoleButtonMatchCount: snapshot.finalPublishRoleButtonMatchCount ?? 0,
    finalPublishCandidatesSafe,
    finalPublishContainerSafe: snapshot.finalPublishContainerSafe ?? null,
    finalSubmitControlPresent: finalSubmitControlState.present,
    finalSubmitControlEnabled: finalSubmitControlState.enabled
  };
}
