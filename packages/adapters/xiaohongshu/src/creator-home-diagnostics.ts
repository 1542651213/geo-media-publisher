import type { Page } from "playwright-core";

const MAX_DIAGNOSTIC_ITEMS = 20;
const DOM_DIAGNOSTIC_EVALUATE_TIMEOUT_MS = 750;
const CREATOR_HOME_URL = "https://creator.xiaohongshu.com/";

export type XiaohongshuHomeShellResult = "HOME_SHELL_READY" | "HOME_SHELL_NOT_READY" | "HOME_SHELL_TIMEOUT";

export type XiaohongshuPublishEntryLocation = "MAIN_DOCUMENT" | "SAME_ORIGIN_IFRAME" | "SHADOW_DOM";

export type XiaohongshuDiscoveryDiagnosis =
  | "CREATOR_HOME_SHELL_NOT_READY"
  | "CREATOR_HOME_SHELL_TIMEOUT"
  | "PUBLISH_ENTRY_TEXT_SIGNAL_NOT_FOUND"
  | "PUBLISH_ENTRY_TEXT_PRESENT_NO_INTERACTIVE_ANCESTOR"
  | "PUBLISH_ENTRY_OUTSIDE_LEGACY_ELEMENT_TYPES"
  | "PUBLISH_ENTRY_IN_SAME_ORIGIN_IFRAME"
  | "PUBLISH_ENTRY_IN_SHADOW_DOM"
  | "PUBLISH_ENTRY_TRULY_NOT_OBSERVED"
  | "PUBLISH_ENTRY_LEGACY_CANDIDATE_OBSERVED"
  | "PUBLISH_ENTRY_TEXT_SIGNAL_PRESENT";

export interface XiaohongshuHomeReadinessSnapshot {
  result: XiaohongshuHomeShellResult;
  documentReadyState: string;
  currentUrl: string;
  bodyExists: boolean;
  bodyChildCount: number;
  documentElementChildCount: number;
  anchorCount: number;
  buttonCount: number;
  roleButtonCount: number;
  tabbableCount: number;
  navigationElementCount: number;
  iframeCount: number;
  shadowHostCount: number;
  visibleInteractiveCount: number;
  creatorShellSignalCount: number;
  publishSemanticTextSignalCount: number;
  elapsedSinceNavigationMs: number;
}

export interface XiaohongshuHomeReadinessSample {
  sampleIndex: number;
  elapsedMs: number;
  readyState: string;
  bodyChildCount: number;
  interactiveCount: number;
  navigationCount: number;
  publishSemanticTextSignalCount: number;
}

export interface XiaohongshuHomeReadinessObservation {
  result: XiaohongshuHomeShellResult;
  samples: readonly XiaohongshuHomeReadinessSample[];
  finalSnapshot: XiaohongshuHomeReadinessSnapshot;
}

export interface XiaohongshuInteractiveElementTypeCounts {
  a: number;
  button: number;
  "role=button": number;
  "role=menuitem": number;
  "role=link": number;
  "role=tab": number;
  "[tabindex]": number;
  nav: number;
  aside: number;
}

export interface XiaohongshuFrameDiagnostic {
  index: number;
  sanitizedUrl: string;
  name: string;
  sameOrigin: boolean;
  crossOrigin: boolean;
  publishSemanticSignalPresent: boolean;
}

export interface XiaohongshuShadowDiagnostic {
  hostTag: string;
  role: string | null;
  stableDataAttributes: Record<string, string>;
  open: boolean;
  publishSemanticSignalPresent: boolean;
}

export interface XiaohongshuCreatorHomeTopology {
  topLevelElementCounts: Record<string, number>;
  interactiveElementTypeCounts: XiaohongshuInteractiveElementTypeCounts;
  frameCount: number;
  frameSummary: readonly XiaohongshuFrameDiagnostic[];
  shadowHostCount: number;
  shadowSummary: readonly XiaohongshuShadowDiagnostic[];
  publishEntryLocation: XiaohongshuPublishEntryLocation;
  publishSemanticSignalPresent: boolean;
}

export interface XiaohongshuPublishSemanticNode {
  index: number;
  tagName: string;
  role: string | null;
  normalizedVisibleText: string;
  ariaLabel: string | null;
  title: string | null;
  sanitizedHref: string | null;
  tabIndex: number;
  visible: boolean;
  enabled: boolean;
  parentTag: string | null;
  parentRole: string | null;
  nearestInteractiveAncestorTag: string | null;
  nearestInteractiveAncestorRole: string | null;
  nearestInteractiveAncestorHref: string | null;
  nearestInteractiveAncestorHasOnclick: boolean;
  stableDataAttributes: Record<string, string>;
}

export interface XiaohongshuAccessibilityPublishSignal {
  role: string | null;
  name: string;
}

export interface XiaohongshuPublishSemanticNodeCollection {
  textSignalPresent: boolean;
  candidateCount: number;
  truncated: boolean;
  nodes: readonly XiaohongshuPublishSemanticNode[];
  discoveryDiagnosis: XiaohongshuDiscoveryDiagnosis;
  accessibilityPublishSignals?: readonly XiaohongshuAccessibilityPublishSignal[];
}

interface RawDomDiagnostics {
  readiness?: Record<string, unknown>;
  topology?: Record<string, unknown>;
  semantic?: Record<string, unknown>;
  accessibilityPublishSignals?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizedPageUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname || "/"}`;
  } catch {
    return "about:blank";
  }
}

function emptyReadinessSnapshot(page: Page, elapsedSinceNavigationMs = 0): XiaohongshuHomeReadinessSnapshot {
  return {
    result: "HOME_SHELL_NOT_READY",
    documentReadyState: "unknown",
    currentUrl: sanitizedPageUrl(page.url()),
    bodyExists: false,
    bodyChildCount: 0,
    documentElementChildCount: 0,
    anchorCount: 0,
    buttonCount: 0,
    roleButtonCount: 0,
    tabbableCount: 0,
    navigationElementCount: 0,
    iframeCount: 0,
    shadowHostCount: 0,
    visibleInteractiveCount: 0,
    creatorShellSignalCount: 0,
    publishSemanticTextSignalCount: 0,
    elapsedSinceNavigationMs
  };
}

function shellIsPopulated(snapshot: XiaohongshuHomeReadinessSnapshot): boolean {
  return snapshot.bodyExists
    && snapshot.documentElementChildCount > 0
    && (snapshot.documentReadyState === "interactive" || snapshot.documentReadyState === "complete")
    && snapshot.bodyChildCount > 0
    && (snapshot.visibleInteractiveCount > 0 || snapshot.navigationElementCount > 0 || snapshot.creatorShellSignalCount > 0);
}

function snapshotFromPayload(page: Page, payload: unknown, elapsedSinceNavigationMs: number): { snapshot: XiaohongshuHomeReadinessSnapshot; supported: boolean } {
  const root = isRecord(payload) ? payload : {};
  const source = isRecord(root.readiness) ? root.readiness : root;
  const supported = typeof source.documentReadyState === "string" && typeof source.bodyExists === "boolean";
  if (!supported) return { snapshot: emptyReadinessSnapshot(page, elapsedSinceNavigationMs), supported: false };
  const snapshot: XiaohongshuHomeReadinessSnapshot = {
    result: "HOME_SHELL_NOT_READY",
    documentReadyState: stringValue(source.documentReadyState, "unknown"),
    currentUrl: sanitizedPageUrl(stringValue(source.currentUrl, page.url())),
    bodyExists: booleanValue(source.bodyExists),
    bodyChildCount: numberValue(source.bodyChildCount),
    documentElementChildCount: numberValue(source.documentElementChildCount),
    anchorCount: numberValue(source.anchorCount),
    buttonCount: numberValue(source.buttonCount),
    roleButtonCount: numberValue(source.roleButtonCount),
    tabbableCount: numberValue(source.tabbableCount),
    navigationElementCount: numberValue(source.navigationElementCount),
    iframeCount: numberValue(source.iframeCount),
    shadowHostCount: numberValue(source.shadowHostCount),
    visibleInteractiveCount: numberValue(source.visibleInteractiveCount),
    creatorShellSignalCount: numberValue(source.creatorShellSignalCount),
    publishSemanticTextSignalCount: numberValue(source.publishSemanticTextSignalCount),
    elapsedSinceNavigationMs: numberValue(source.elapsedSinceNavigationMs, elapsedSinceNavigationMs)
  };
  snapshot.result = shellIsPopulated(snapshot) ? "HOME_SHELL_READY" : "HOME_SHELL_NOT_READY";
  return { snapshot, supported: true };
}

function snapshotSignature(snapshot: XiaohongshuHomeReadinessSnapshot): string {
  return [snapshot.documentReadyState, snapshot.bodyExists, snapshot.bodyChildCount, snapshot.documentElementChildCount, snapshot.visibleInteractiveCount, snapshot.navigationElementCount, snapshot.creatorShellSignalCount, snapshot.publishSemanticTextSignalCount].join("|");
}

function normalizeInteractiveCounts(value: unknown): XiaohongshuInteractiveElementTypeCounts {
  const source = isRecord(value) ? value : {};
  return {
    a: numberValue(source.a),
    button: numberValue(source.button),
    "role=button": numberValue(source["role=button"]),
    "role=menuitem": numberValue(source["role=menuitem"]),
    "role=link": numberValue(source["role=link"]),
    "role=tab": numberValue(source["role=tab"]),
    "[tabindex]": numberValue(source["[tabindex]"]),
    nav: numberValue(source.nav),
    aside: numberValue(source.aside)
  };
}

function normalizeFrameSummary(value: unknown): XiaohongshuFrameDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_DIAGNOSTIC_ITEMS).filter(isRecord).map((frame, index) => ({
    index: numberValue(frame.index, index),
    sanitizedUrl: sanitizedPageUrl(stringValue(frame.sanitizedUrl, "about:blank")),
    name: stringValue(frame.name).slice(0, 80),
    sameOrigin: booleanValue(frame.sameOrigin),
    crossOrigin: booleanValue(frame.crossOrigin),
    publishSemanticSignalPresent: booleanValue(frame.publishSemanticSignalPresent)
  }));
}

function normalizeShadowSummary(value: unknown): XiaohongshuShadowDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_DIAGNOSTIC_ITEMS).filter(isRecord).map((shadow) => ({
    hostTag: stringValue(shadow.hostTag, "UNKNOWN").toUpperCase().slice(0, 40),
    role: stringValue(shadow.role) || null,
    stableDataAttributes: isRecord(shadow.stableDataAttributes)
      ? Object.fromEntries(Object.entries(shadow.stableDataAttributes).slice(0, 5).map(([key, item]) => [key, stringValue(item).slice(0, 80)]))
      : {},
    open: booleanValue(shadow.open),
    publishSemanticSignalPresent: booleanValue(shadow.publishSemanticSignalPresent)
  }));
}

function normalizeTopology(page: Page, payload: unknown): XiaohongshuCreatorHomeTopology {
  const root = isRecord(payload) ? payload : {};
  const source = isRecord(root.topology) ? root.topology : root;
  const topLevel = isRecord(source.topLevelElementCounts) ? Object.fromEntries(Object.entries(source.topLevelElementCounts).slice(0, 50).map(([key, count]) => [key.slice(0, 40), numberValue(count)])) : {};
  const frameSummary = normalizeFrameSummary(source.frameSummary);
  const shadowSummary = normalizeShadowSummary(source.shadowSummary);
  const publishEntryLocation = source.publishEntryLocation === "SAME_ORIGIN_IFRAME" || source.publishEntryLocation === "SHADOW_DOM" ? source.publishEntryLocation : "MAIN_DOCUMENT";
  return {
    topLevelElementCounts: topLevel,
    interactiveElementTypeCounts: normalizeInteractiveCounts(source.interactiveElementTypeCounts),
    frameCount: numberValue(source.frameCount, frameSummary.length),
    frameSummary,
    shadowHostCount: numberValue(source.shadowHostCount, shadowSummary.length),
    shadowSummary,
    publishEntryLocation,
    publishSemanticSignalPresent: booleanValue(source.publishSemanticSignalPresent)
  };
}

function normalizeSemanticNode(value: unknown, index: number): XiaohongshuPublishSemanticNode | null {
  if (!isRecord(value)) return null;
  const attributes = isRecord(value.stableDataAttributes) ? Object.fromEntries(Object.entries(value.stableDataAttributes).slice(0, 5).map(([key, item]) => [key, stringValue(item).slice(0, 80)])) : {};
  return {
    index: numberValue(value.index, index),
    tagName: stringValue(value.tagName, "UNKNOWN").toUpperCase().slice(0, 40),
    role: stringValue(value.role) || null,
    normalizedVisibleText: stringValue(value.normalizedVisibleText).slice(0, 120),
    ariaLabel: stringValue(value.ariaLabel).slice(0, 120) || null,
    title: stringValue(value.title).slice(0, 120) || null,
    sanitizedHref: value.sanitizedHref === null ? null : sanitizedPageUrl(stringValue(value.sanitizedHref)) === "about:blank" ? null : sanitizedPageUrl(stringValue(value.sanitizedHref)),
    tabIndex: typeof value.tabIndex === "number" && Number.isFinite(value.tabIndex) ? value.tabIndex : -1,
    visible: booleanValue(value.visible),
    enabled: booleanValue(value.enabled),
    parentTag: stringValue(value.parentTag).toUpperCase().slice(0, 40) || null,
    parentRole: stringValue(value.parentRole).slice(0, 40) || null,
    nearestInteractiveAncestorTag: stringValue(value.nearestInteractiveAncestorTag).toUpperCase().slice(0, 40) || null,
    nearestInteractiveAncestorRole: stringValue(value.nearestInteractiveAncestorRole).slice(0, 40) || null,
    nearestInteractiveAncestorHref: value.nearestInteractiveAncestorHref === null ? null : sanitizedPageUrl(stringValue(value.nearestInteractiveAncestorHref)) === "about:blank" ? null : sanitizedPageUrl(stringValue(value.nearestInteractiveAncestorHref)),
    nearestInteractiveAncestorHasOnclick: booleanValue(value.nearestInteractiveAncestorHasOnclick),
    stableDataAttributes: attributes
  };
}

function normalizeSemanticCollection(page: Page, payload: unknown): XiaohongshuPublishSemanticNodeCollection {
  const root = isRecord(payload) ? payload : {};
  const source = isRecord(root.semantic) ? root.semantic : root;
  const nodes = Array.isArray(source.nodes) ? source.nodes.slice(0, MAX_DIAGNOSTIC_ITEMS).map((node, index) => normalizeSemanticNode(node, index)).filter((node): node is XiaohongshuPublishSemanticNode => Boolean(node)) : [];
  const diagnosis = source.discoveryDiagnosis;
  const supportedDiagnosis: XiaohongshuDiscoveryDiagnosis = diagnosis === "CREATOR_HOME_SHELL_NOT_READY"
    || diagnosis === "CREATOR_HOME_SHELL_TIMEOUT"
    || diagnosis === "PUBLISH_ENTRY_TEXT_SIGNAL_NOT_FOUND"
    || diagnosis === "PUBLISH_ENTRY_TEXT_PRESENT_NO_INTERACTIVE_ANCESTOR"
    || diagnosis === "PUBLISH_ENTRY_OUTSIDE_LEGACY_ELEMENT_TYPES"
    || diagnosis === "PUBLISH_ENTRY_IN_SAME_ORIGIN_IFRAME"
    || diagnosis === "PUBLISH_ENTRY_IN_SHADOW_DOM"
    || diagnosis === "PUBLISH_ENTRY_TRULY_NOT_OBSERVED"
    || diagnosis === "PUBLISH_ENTRY_LEGACY_CANDIDATE_OBSERVED"
    || diagnosis === "PUBLISH_ENTRY_TEXT_SIGNAL_PRESENT"
    ? diagnosis
    : nodes.length === 0 ? "PUBLISH_ENTRY_TRULY_NOT_OBSERVED" : "PUBLISH_ENTRY_TEXT_SIGNAL_PRESENT";
  const accessibility = Array.isArray(source.accessibilityPublishSignals)
    ? source.accessibilityPublishSignals.slice(0, MAX_DIAGNOSTIC_ITEMS).filter(isRecord).map((signal) => ({ role: stringValue(signal.role) || null, name: stringValue(signal.name).slice(0, 120) })).filter((signal) => signal.name)
    : undefined;
  return {
    textSignalPresent: booleanValue(source.textSignalPresent, nodes.length > 0),
    candidateCount: numberValue(source.candidateCount, nodes.length),
    truncated: booleanValue(source.truncated),
    nodes,
    discoveryDiagnosis: supportedDiagnosis,
    ...(accessibility ? { accessibilityPublishSignals: accessibility } : {})
  };
}

async function evaluateDomDiagnostics(page: Page): Promise<unknown> {
  const candidate = page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
  if (typeof candidate.evaluate !== "function") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const evaluation = candidate.evaluate(readCreatorHomeDomDiagnostics);
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DOM_DIAGNOSTIC_EVALUATE_TIMEOUT_MS);
    });
    return await Promise.race([evaluation, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readCreatorHomeDomDiagnostics(): RawDomDiagnostics {
  const MAX_ITEMS = 20;
  const MAX_SCAN_ELEMENTS = 2000;
  const publishPattern = /发布笔记|发布图文|上传图文|上传笔记|发笔记|图文笔记|发布|图文|笔记|上传|publish|post|note/iu;
  const creatorShellPattern = /创作|作品|内容管理|笔记管理|创作服务|dashboard|creator/iu;
  const dataAttributeNames = ["data-testid", "data-test", "data-action", "data-qa", "data-cy"];
  const boundedElements = (root: Document | ShadowRoot): Element[] => {
    const elements: Element[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current && elements.length < MAX_SCAN_ELEMENTS) {
      if (current instanceof Element) elements.push(current);
      current = walker.nextNode();
    }
    return elements;
  };
  const compact = (value: string, limit = 120): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, limit);
  const safeUrl = (value: string): string | null => {
    if (!value) return null;
    try {
      const parsed = new URL(value, window.location.href);
      return `${parsed.origin}${parsed.pathname || "/"}`;
    } catch {
      return null;
    }
  };
  const visible = (element: Element): boolean => {
    const node = element as HTMLElement;
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (typeof node.getClientRects === "function" && node.getClientRects().length === 0) return false;
    return true;
  };
  const enabled = (element: Element): boolean => {
    return !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  };
  const explicitRole = (element: Element): string | null => compact(element.getAttribute("role") ?? "", 40).toLowerCase() || null;
  const implicitRole = (element: Element): string | null => {
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "aside") return "complementary";
    return null;
  };
  const roleOf = (element: Element | null): string | null => element ? explicitRole(element) ?? implicitRole(element) : null;
  const tabIndexOf = (element: Element): number => {
    const value = (element as HTMLElement).tabIndex;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const attribute = Number.parseInt(element.getAttribute("tabindex") ?? "", 10);
    return Number.isFinite(attribute) ? attribute : -1;
  };
  const dataAttributesOf = (element: Element): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const name of dataAttributeNames) {
      const value = compact(element.getAttribute(name) ?? "", 80);
      if (value) result[name] = value;
    }
    return result;
  };
  const interactive = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    const role = roleOf(element);
    return tag === "a" || tag === "button" || role === "button" || role === "link" || role === "menuitem" || role === "tab" || tabIndexOf(element) >= 0 || element.hasAttribute("onclick");
  };
  const semanticTextOf = (element: Element): { raw: string; text: string; ariaLabel: string; title: string } => {
    const raw = (element.textContent ?? "").normalize("NFKC").replace(/[\s]+/gu, " ").trim();
    return { raw, text: compact(raw), ariaLabel: compact(element.getAttribute("aria-label") ?? ""), title: compact(element.getAttribute("title") ?? "") };
  };
  const semanticPresentInDocument = (sourceDocument: Document | ShadowRoot): boolean => {
    const elements = boundedElements(sourceDocument);
    return elements.some((element) => {
      const data = semanticTextOf(element);
      const eligibleText = data.raw.length <= 240 ? data.raw : "";
      return publishPattern.test(`${eligibleText} ${data.ariaLabel} ${data.title}`);
    });
  };
  const semanticNodes: Array<Record<string, unknown>> = [];
  let semanticCandidateCount = 0;
  const documentElements = boundedElements(document);
  for (const element of documentElements) {
    const tagName = element.tagName.toUpperCase();
    if (tagName === "HTML" || tagName === "BODY" || tagName === "SCRIPT" || tagName === "STYLE") continue;
    const data = semanticTextOf(element);
    const eligibleText = data.raw.length <= 240 ? data.raw : "";
    if (!publishPattern.test(`${eligibleText} ${data.ariaLabel} ${data.title}`)) continue;
    semanticCandidateCount += 1;
    if (semanticNodes.length >= MAX_ITEMS) continue;
    let ancestor: Element | null = element;
    while (ancestor && !interactive(ancestor)) ancestor = ancestor.parentElement;
    const ancestorRole = roleOf(ancestor);
    semanticNodes.push({
      index: semanticNodes.length,
      tagName,
      role: roleOf(element),
      normalizedVisibleText: compact(data.raw),
      ariaLabel: data.ariaLabel || null,
      title: data.title || null,
      sanitizedHref: safeUrl(element.getAttribute("href") ?? ""),
      tabIndex: tabIndexOf(element),
      visible: visible(element),
      enabled: enabled(element),
      parentTag: element.parentElement?.tagName.toUpperCase() ?? null,
      parentRole: roleOf(element.parentElement),
      nearestInteractiveAncestorTag: ancestor?.tagName.toUpperCase() ?? null,
      nearestInteractiveAncestorRole: ancestorRole,
      nearestInteractiveAncestorHref: ancestor ? safeUrl(ancestor.getAttribute("href") ?? "") : null,
      nearestInteractiveAncestorHasOnclick: ancestor?.hasAttribute("onclick") ?? false,
      stableDataAttributes: dataAttributesOf(element)
    });
  }
  const frameElements = documentElements.filter((element) => element.tagName === "IFRAME" || element.tagName === "FRAME").slice(0, MAX_ITEMS);
  const frameSummary = frameElements.map((element, index) => {
    const rawUrl = element.getAttribute("src") ?? "";
    const sanitized = safeUrl(rawUrl) ?? "about:blank";
    let sameOrigin = false;
    try { sameOrigin = new URL(rawUrl || window.location.href, window.location.href).origin === window.location.origin; } catch { sameOrigin = false; }
    let frameSemantic = false;
    if (sameOrigin) {
      try { frameSemantic = Boolean(element instanceof HTMLIFrameElement && element.contentDocument && semanticPresentInDocument(element.contentDocument)); } catch { frameSemantic = false; }
    }
    return { index, sanitizedUrl: sanitized, name: compact(element.getAttribute("name") ?? "", 80), sameOrigin, crossOrigin: !sameOrigin, publishSemanticSignalPresent: frameSemantic };
  });
  const shadowElements = documentElements.filter((element) => Boolean(element.shadowRoot)).slice(0, MAX_ITEMS);
  const shadowSummary = shadowElements.map((host) => {
    let publishSemanticSignalPresent = false;
    try { publishSemanticSignalPresent = Boolean(host.shadowRoot && semanticPresentInDocument(host.shadowRoot)); } catch { publishSemanticSignalPresent = false; }
    return { hostTag: host.tagName.toUpperCase(), role: roleOf(host), stableDataAttributes: dataAttributesOf(host), open: true, publishSemanticSignalPresent };
  });
  const topLevelElementCounts: Record<string, number> = {};
  let topLevelChild = document.body?.firstElementChild ?? null;
  let topLevelScanned = 0;
  while (topLevelChild && topLevelScanned < MAX_SCAN_ELEMENTS) {
    topLevelElementCounts[topLevelChild.tagName.toUpperCase()] = (topLevelElementCounts[topLevelChild.tagName.toUpperCase()] ?? 0) + 1;
    topLevelChild = topLevelChild.nextElementSibling;
    topLevelScanned += 1;
  }
  const count = (selector: string): number => documentElements.filter((element) => {
    try { return element.matches(selector); } catch { return false; }
  }).length;
  const interactiveElements = documentElements.filter((element) => {
    try { return element.matches("a, button, [role], [tabindex]"); } catch { return false; }
  });
  const visibleInteractiveCount = interactiveElements.filter((element) => interactive(element) && visible(element)).length;
  const creatorShellSignalCount = documentElements.filter((element) => {
    try { return element.matches("nav, aside, main, [role='navigation'], [role='main'], [role='complementary']"); } catch { return false; }
  }).filter((element) => {
    const data = semanticTextOf(element);
    return creatorShellPattern.test(`${data.raw.slice(0, 240)} ${data.ariaLabel} ${data.title}`);
  }).length;
  const frameSignal = frameSummary.some((frame) => frame.sameOrigin && frame.publishSemanticSignalPresent);
  const shadowSignal = shadowSummary.some((shadow) => shadow.publishSemanticSignalPresent);
  const publishEntryLocation: XiaohongshuPublishEntryLocation = frameSignal ? "SAME_ORIGIN_IFRAME" : shadowSignal ? "SHADOW_DOM" : "MAIN_DOCUMENT";
  const accessibilityPublishSignals = semanticNodes.slice(0, MAX_ITEMS).map((node) => ({ role: typeof node.role === "string" ? node.role : null, name: typeof node.ariaLabel === "string" && node.ariaLabel ? node.ariaLabel : typeof node.normalizedVisibleText === "string" ? node.normalizedVisibleText : "" })).filter((signal) => signal.name);
  const hasSemanticSignal = semanticCandidateCount > 0 || frameSignal || shadowSignal;
  const hasNonLegacyInteractiveAncestor = semanticNodes.some((node) => typeof node.nearestInteractiveAncestorTag === "string" && node.nearestInteractiveAncestorTag !== "A" && node.nearestInteractiveAncestorTag !== "BUTTON");
  const hasMissingInteractiveAncestor = semanticNodes.some((node) => !node.nearestInteractiveAncestorTag);
  const discoveryDiagnosis: XiaohongshuDiscoveryDiagnosis = frameSignal
    ? "PUBLISH_ENTRY_IN_SAME_ORIGIN_IFRAME"
    : shadowSignal
      ? "PUBLISH_ENTRY_IN_SHADOW_DOM"
      : !hasSemanticSignal
        ? "PUBLISH_ENTRY_TRULY_NOT_OBSERVED"
        : hasMissingInteractiveAncestor
          ? "PUBLISH_ENTRY_TEXT_PRESENT_NO_INTERACTIVE_ANCESTOR"
          : hasNonLegacyInteractiveAncestor
            ? "PUBLISH_ENTRY_OUTSIDE_LEGACY_ELEMENT_TYPES"
            : semanticNodes.every((node) => node.tagName === "A" || node.tagName === "BUTTON")
              ? "PUBLISH_ENTRY_LEGACY_CANDIDATE_OBSERVED"
              : "PUBLISH_ENTRY_TEXT_SIGNAL_PRESENT";
  return {
    readiness: {
      documentReadyState: document.readyState,
      currentUrl: safeUrl(window.location.href) ?? "about:blank",
      bodyExists: Boolean(document.body),
      bodyChildCount: document.body?.children.length ?? 0,
      documentElementChildCount: document.documentElement?.children.length ?? 0,
      anchorCount: count("a"),
      buttonCount: count("button"),
      roleButtonCount: count('[role="button"]'),
      tabbableCount: count('[tabindex]:not([tabindex="-1"])'),
      navigationElementCount: count("nav, aside, main, [role='navigation'], [role='main'], [role='complementary']"),
      iframeCount: frameElements.length,
      shadowHostCount: shadowElements.length,
      visibleInteractiveCount,
      creatorShellSignalCount,
      publishSemanticTextSignalCount: semanticCandidateCount
    },
    topology: {
      topLevelElementCounts,
      interactiveElementTypeCounts: {
        a: count("a"), button: count("button"), "role=button": count('[role="button"]'), "role=menuitem": count('[role="menuitem"]'), "role=link": count('[role="link"]'), "role=tab": count('[role="tab"]'), "[tabindex]": count("[tabindex]"), nav: count("nav"), aside: count("aside")
      },
      frameCount: frameElements.length,
      frameSummary,
      shadowHostCount: shadowElements.length,
      shadowSummary,
      publishEntryLocation,
      publishSemanticSignalPresent: hasSemanticSignal
    },
    semantic: {
      textSignalPresent: semanticCandidateCount > 0,
      candidateCount: semanticCandidateCount,
      truncated: semanticCandidateCount > MAX_ITEMS,
      nodes: semanticNodes,
      discoveryDiagnosis,
      accessibilityPublishSignals
    },
    accessibilityPublishSignals
  };
}

export async function inspectCreatorHomeReadiness(page: Page): Promise<XiaohongshuHomeReadinessSnapshot> {
  const startedAt = Date.now();
  const payload = await evaluateDomDiagnostics(page);
  return snapshotFromPayload(page, payload, Math.max(0, Date.now() - startedAt)).snapshot;
}

export type XiaohongshuHomeReadinessOptions = {
  maxObservationMs?: number;
  sampleIntervalMs?: number;
  maxSamples?: number;
};

export async function observeCreatorHomeReadiness(page: Page, options: XiaohongshuHomeReadinessOptions = {}): Promise<XiaohongshuHomeReadinessObservation> {
  const startedAt = Date.now();
  const maxObservationMs = Math.max(0, Math.min(options.maxObservationMs ?? 2200, 3000));
  const sampleIntervalMs = Math.max(0, Math.min(options.sampleIntervalMs ?? 100, 500));
  const defaultMaxSamples = sampleIntervalMs > 0 ? Math.ceil(maxObservationMs / sampleIntervalMs) + 2 : 12;
  const requestedMaxSamples = options.maxSamples ?? defaultMaxSamples;
  const maxSamples = Math.min(32, Math.max(1, Number.isFinite(requestedMaxSamples) ? requestedMaxSamples : defaultMaxSamples));
  const samples: XiaohongshuHomeReadinessSample[] = [];
  let previousSignature: string | null = null;
  let finalSnapshot = emptyReadinessSnapshot(page);
  for (let sampleIndex = 0; sampleIndex < maxSamples; sampleIndex += 1) {
    const elapsedBefore = Math.max(0, Date.now() - startedAt);
    const payload = await evaluateDomDiagnostics(page);
    const normalized = snapshotFromPayload(page, payload, elapsedBefore);
    finalSnapshot = normalized.snapshot;
    samples.push({ sampleIndex, elapsedMs: Math.max(0, Date.now() - startedAt), readyState: finalSnapshot.documentReadyState, bodyChildCount: finalSnapshot.bodyChildCount, interactiveCount: finalSnapshot.visibleInteractiveCount, navigationCount: finalSnapshot.navigationElementCount, publishSemanticTextSignalCount: finalSnapshot.publishSemanticTextSignalCount });
    if (!normalized.supported) return { result: "HOME_SHELL_NOT_READY", samples, finalSnapshot };
    const signature = snapshotSignature(finalSnapshot);
    if (shellIsPopulated(finalSnapshot) && previousSignature === signature) {
      finalSnapshot.result = "HOME_SHELL_READY";
      return { result: "HOME_SHELL_READY", samples, finalSnapshot };
    }
    previousSignature = signature;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= maxObservationMs || sampleIndex + 1 >= maxSamples) break;
    if (sampleIntervalMs > 0) {
      const candidate = page as unknown as { waitForTimeout?: (milliseconds: number) => Promise<void> };
      if (typeof candidate.waitForTimeout === "function") await candidate.waitForTimeout(sampleIntervalMs);
      else await new Promise<void>((resolve) => setTimeout(resolve, sampleIntervalMs));
    } else {
      await Promise.resolve();
    }
  }
  finalSnapshot.result = "HOME_SHELL_TIMEOUT";
  return { result: "HOME_SHELL_TIMEOUT", samples, finalSnapshot };
}

export async function collectCreatorHomeTopology(page: Page): Promise<XiaohongshuCreatorHomeTopology> {
  return normalizeTopology(page, await evaluateDomDiagnostics(page));
}

export async function collectPublishSemanticNodes(page: Page): Promise<XiaohongshuPublishSemanticNodeCollection> {
  return normalizeSemanticCollection(page, await evaluateDomDiagnostics(page));
}

export { CREATOR_HOME_URL };
