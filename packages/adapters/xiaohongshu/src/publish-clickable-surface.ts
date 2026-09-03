import type { CDPSession, Page } from "playwright-core";

const MAX_EXACT_TARGETS = 20;
const MAX_ANCESTOR_DEPTH = 8;
const MAX_HIT_TEST_ELEMENTS = 8;
const MAX_CLASS_TOKENS = 8;
const MAX_STABLE_DATA_ATTRIBUTES = 5;
const MAX_STRING_LENGTH = 120;
const MAX_ENTRY_DOM_MATCHES = 20;
const MAX_ENTRY_DOM_ANCESTORS = 4;
const MAX_IMAGE_POST_ENTRY_ANCESTORS = 8;
const MAX_IMAGE_POST_ENTRY_SCAN_ELEMENTS = 2000;

export const XIAOHONGSHU_PUBLISH_NOTE_TEXT = "发布笔记";
export const XIAOHONGSHU_IMAGE_POST_TEXT = "发布图文笔记";
export const XIAOHONGSHU_IMAGE_POST_MENU_TEXT = "上传图文";
export const XIAOHONGSHU_PUBLISH_INTERACTION_EVENTS = [
  "click",
  "pointerup",
  "pointerdown",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend"
] as const;

export type XiaohongshuPublishInteractionEvent = typeof XIAOHONGSHU_PUBLISH_INTERACTION_EVENTS[number];
export type XiaohongshuPublishEntryDomLabel = typeof XIAOHONGSHU_PUBLISH_NOTE_TEXT | typeof XIAOHONGSHU_IMAGE_POST_TEXT | typeof XIAOHONGSHU_IMAGE_POST_MENU_TEXT;
export type XiaohongshuClickableSurfaceStatus = "PROVEN_UNIQUE" | "AMBIGUOUS" | "NO_CLICK_SURFACE_FOUND" | "EVENT_LISTENER_INSPECTION_UNAVAILABLE";
export type XiaohongshuClickableSurfaceFailureCode =
  | "PUBLISH_SEMANTIC_TARGET_NOT_FOUND"
  | "PUBLISH_SEMANTIC_TARGET_AMBIGUOUS"
  | "PUBLISH_CLICK_SURFACE_NOT_FOUND"
  | "PUBLISH_CLICK_SURFACE_AMBIGUOUS"
  | "PUBLISH_CLICK_SURFACE_NOT_VISIBLE"
  | "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED"
  | "PUBLISH_CLICK_SURFACE_DIAGNOSTIC_FAILED";

export interface XiaohongshuPublishBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XiaohongshuExactPublishSemanticTarget {
  targetId: string;
  tagName: string;
  exactText: typeof XIAOHONGSHU_PUBLISH_NOTE_TEXT | typeof XIAOHONGSHU_IMAGE_POST_TEXT;
  visible: boolean;
  boundingBox: XiaohongshuPublishBoundingBox | null;
  parentTag: string | null;
  depth: number;
}

export interface XiaohongshuPublishDropdownTriggerDiagnostic {
  triggerId: string;
  targetId: string;
  tagName: string;
  role: string | null;
  ariaHasPopup: string | null;
  ariaExpanded: string | null;
  ariaLabel: string | null;
  title: string | null;
  visible: boolean;
  enabled: boolean;
  boundingBox: XiaohongshuPublishBoundingBox | null;
}

export interface XiaohongshuPublishDropdownTriggerResolution {
  status: "PROVEN_UNIQUE" | "AMBIGUOUS" | "NOT_FOUND";
  trigger: XiaohongshuPublishDropdownTriggerDiagnostic | null;
  failureCode?: "PUBLISH_NOTE_DROPDOWN_TRIGGER_NOT_FOUND" | "PUBLISH_NOTE_DROPDOWN_TRIGGER_AMBIGUOUS";
}

export interface XiaohongshuImagePostMenuItemDiagnostic {
  itemId: string;
  tagName: string;
  role: string | null;
  exactText: "上传图文";
  visible: boolean;
  enabled: boolean;
  boundingBox: XiaohongshuPublishBoundingBox | null;
}

export interface XiaohongshuImagePostMenuItemResolution {
  status: "PROVEN_UNIQUE" | "AMBIGUOUS" | "NOT_FOUND";
  item: XiaohongshuImagePostMenuItemDiagnostic | null;
  failureCode?: "XIAOHONGSHU_IMAGE_POST_MENU_ITEM_NOT_FOUND" | "XIAOHONGSHU_IMAGE_POST_MENU_ITEM_AMBIGUOUS";
}

export interface XiaohongshuPublishAncestorDiagnostic {
  targetId: string;
  surfaceId: string;
  depth: number;
  tagName: string;
  role: string | null;
  tabIndex: number;
  ariaLabel: string | null;
  title: string | null;
  stableDataAttributes: Record<string, string>;
  classTokens: string[];
  cursor: string;
  pointerEvents: string;
  display: string;
  visibility: string;
  visible: boolean;
  boundingBox: XiaohongshuPublishBoundingBox | null;
  onclickAttributePresent: boolean;
}

export interface XiaohongshuPublishEventListenerEntry {
  eventType: XiaohongshuPublishInteractionEvent;
  listenerCount: number;
  ancestorDepth: number;
  surfaceId: string | null;
}

export interface XiaohongshuPublishEventListenerTarget {
  targetId: string;
  listeners: readonly XiaohongshuPublishEventListenerEntry[];
}

export interface XiaohongshuPublishEventListenerInspection {
  status: "AVAILABLE" | "UNAVAILABLE";
  targets: readonly XiaohongshuPublishEventListenerTarget[];
}

export type XiaohongshuPublishHitTestAncestorRelation = "TARGET" | "ANCESTOR" | "DESCENDANT" | "UNRELATED";

export interface XiaohongshuPublishHitTestElement {
  surfaceId: string | null;
  tagName: string;
  role: string | null;
  exactSemanticText: string | null;
  ancestorRelation: XiaohongshuPublishHitTestAncestorRelation;
}

export interface XiaohongshuPublishHitTestDiagnostic {
  targetId: string;
  center: { x: number; y: number } | null;
  elements: readonly XiaohongshuPublishHitTestElement[];
}

export interface XiaohongshuClickableSurfaceResolution {
  exactText: typeof XIAOHONGSHU_PUBLISH_NOTE_TEXT | typeof XIAOHONGSHU_IMAGE_POST_TEXT;
  status: XiaohongshuClickableSurfaceStatus;
  confidence: "HIGH" | "NONE";
  surface: {
    surfaceId: string;
    targetId: string;
    ancestorDepth: number;
    tagName: string;
    boundingBox: XiaohongshuPublishBoundingBox;
    strongSignals: string[];
  } | null;
  failureCode?: XiaohongshuClickableSurfaceFailureCode;
}

export interface XiaohongshuClickableSurfaceDiagnostics {
  exactPublishSemanticTargets: readonly XiaohongshuExactPublishSemanticTarget[];
  ancestorChainDiagnostics: readonly XiaohongshuPublishAncestorDiagnostic[];
  eventListenerInspection: XiaohongshuPublishEventListenerInspection;
  eventListenerDiagnostics: readonly XiaohongshuPublishEventListenerTarget[];
  hitTestDiagnostics: readonly XiaohongshuPublishHitTestDiagnostic[];
  publishNoteSurface: XiaohongshuClickableSurfaceResolution;
  imagePostSurface: XiaohongshuClickableSurfaceResolution;
  publishNoteDropdownTrigger: XiaohongshuPublishDropdownTriggerResolution;
  clickableSurfaceStatus: XiaohongshuClickableSurfaceStatus;
  clickableSurfaceFailureCode: XiaohongshuClickableSurfaceFailureCode | null;
  clickableSurfaceConfidence: "HIGH" | "NONE";
  diagnosticClickCount: 0;
  mouseEventDispatchCount: 0;
  keyboardEventCount: 0;
  gateSideEffects: {
    preparePublish: "NO";
    contentMutationCount: 0;
    uploadCount: 0;
    finalSubmitCount: 0;
  };
}

export interface XiaohongshuPublishEntryDomElementDiagnostic {
  elementId: string;
  tagName: string;
  role: string | null;
  ariaHasPopup: string | null;
  ariaExpanded: string | null;
  tabIndex: number;
  disabled: boolean;
  classNameSafe: string;
  textContentSafe: string;
  childElementCount: number;
  visible: boolean;
  enabled: boolean;
  isButton: boolean;
  isAnchor: boolean;
  isRoleButton: boolean;
  clickableContainer: boolean;
  ancestorDepth: number;
}

export interface XiaohongshuPublishEntryDomMatchDiagnostic {
  target: XiaohongshuPublishEntryDomElementDiagnostic;
  ancestors: readonly XiaohongshuPublishEntryDomElementDiagnostic[];
  clickableAncestorCount: number;
  uniqueClickableAncestor: XiaohongshuPublishEntryDomElementDiagnostic | null;
}

export interface XiaohongshuPublishEntryDomLabelDiagnostic {
  label: XiaohongshuPublishEntryDomLabel;
  matchCount: number;
  matches: readonly XiaohongshuPublishEntryDomMatchDiagnostic[];
  clickableAncestorCount: number;
  target: XiaohongshuPublishEntryDomElementDiagnostic | null;
  ancestors: readonly XiaohongshuPublishEntryDomElementDiagnostic[];
  uniqueClickableAncestor: XiaohongshuPublishEntryDomElementDiagnostic | null;
}

export interface XiaohongshuPublishEntryDomDiagnostics {
  pageOrigin: string;
  pathname: string;
  publishNote: XiaohongshuPublishEntryDomLabelDiagnostic;
  imagePost: XiaohongshuPublishEntryDomLabelDiagnostic;
  uploadImage: XiaohongshuPublishEntryDomLabelDiagnostic;
  diagnosticClickCount: 0;
  navigationCount: 0;
  pageCapabilities?: XiaohongshuPageCapabilitiesSafe;
}

export interface XiaohongshuPublishEntryDomRuntimeDiagnostic extends XiaohongshuPublishEntryDomDiagnostics {
  inspectionStatus: "PASS" | "FAIL";
  failureCode: "CANONICAL_PAGE_UNAVAILABLE" | "CANONICAL_PAGE_OWNERSHIP_FAILURE" | "BROWSER_SESSION_DISCONNECTED" | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  pageContextMatchesSession: boolean;
  browserConnected: boolean;
  pageClosed: boolean;
}

export interface XiaohongshuImagePostEntryBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XiaohongshuImagePostEntryStyleDiagnostic {
  display: string;
  visibility: string;
  pointerEvents: string;
  cursor: string;
  userSelect: string;
}

export interface XiaohongshuImagePostEntryAncestorDiagnostic {
  tagName: string;
  role: string | null;
  tabIndex: number;
  hrefPresent: boolean;
  onclickPropertyPresent: boolean;
  cursor: string;
  pointerEvents: string;
}

export interface XiaohongshuImagePostEntryTargetDiagnostic {
  tagName: string;
  role: string | null;
  tabIndex: number;
  visible: boolean;
  enabled: boolean;
  disabled: boolean;
  connected: boolean;
  boundingBox: XiaohongshuImagePostEntryBoundingBox | null;
  style: XiaohongshuImagePostEntryStyleDiagnostic;
  ancestorChain: readonly XiaohongshuImagePostEntryAncestorDiagnostic[];
}

export interface XiaohongshuImagePostEntryInspectionPayload {
  pageOrigin: string;
  pathname: string;
  exactTextMatchCount: number;
  target: XiaohongshuImagePostEntryTargetDiagnostic | null;
}

export interface XiaohongshuPageCapabilitiesSafe {
  typeofPage: string;
  exists: boolean;
  constructorName: string;
  hasUrl: boolean;
  hasIsClosed: boolean;
  hasEvaluate: boolean;
}

export type XiaohongshuPageEvaluationFailureReason = "EVALUATE_METHOD_MISSING" | "EVALUATE_CALL_FAILED";

export type XiaohongshuImagePostEntryFailureCode =
  | "PAGE_EVALUATION_UNAVAILABLE"
  | "NOT_CREATOR_HOME"
  | "EXACT_TEXT_NOT_UNIQUE"
  | "TARGET_NOT_FOUND"
  | "TARGET_NOT_VISIBLE"
  | "TARGET_DISABLED"
  | "TARGET_DETACHED"
  | "TARGET_ZERO_SIZE"
  | "TARGET_DISPLAY_NONE"
  | "TARGET_VISIBILITY_HIDDEN"
  | "TARGET_POINTER_EVENTS_NONE"
  | "LOCATOR_NOT_UNIQUE"
  | "LOCATOR_NOT_ACTIVATABLE"
  | "CLICK_FAILED"
  | "CLICK_ALREADY_USED"
  | "NO_ROUTE_TRANSITION"
  | "WRONG_TARGET"
  | "WRONG_EDITOR_ROUTE";

export interface XiaohongshuImagePostEntryInspection extends XiaohongshuImagePostEntryInspectionPayload {
  inspectionStatus: "PASS" | "FAIL";
  safeToTestClick: boolean;
  failureCode: XiaohongshuImagePostEntryFailureCode | null;
  pageCapabilities?: XiaohongshuPageCapabilitiesSafe;
  evaluationFailureReason?: XiaohongshuPageEvaluationFailureReason;
}

export interface XiaohongshuImagePostEntryActivationResult {
  status: "ACTIVATED" | "REJECTED" | "NO_EFFECT";
  clickCount: number;
  routeReadback: "PASS" | "FAIL";
  observedTarget: "image" | "video" | null;
  pathname: string;
  from: string | null;
  target: string | null;
  sanitizedUrlBefore: string;
  sanitizedUrlAfter: string;
  inspection: XiaohongshuImagePostEntryInspection;
  failureCode?: XiaohongshuImagePostEntryFailureCode;
}

interface PageEvaluateLike {
  url?: unknown;
  isClosed?: unknown;
  evaluate?: <T>(pageFunction: (...args: never[]) => T, arg?: unknown) => Promise<T>;
}

function pageCapabilitiesSafe(page: Page): XiaohongshuPageCapabilitiesSafe {
  const exists = page !== null && page !== undefined;
  const candidate = page as unknown as PageEvaluateLike;
  let constructorName = "";
  try {
    const constructorCandidate = page as unknown as { constructor?: { name?: unknown } };
    constructorName = typeof constructorCandidate.constructor?.name === "string" ? constructorCandidate.constructor.name.slice(0, MAX_STRING_LENGTH) : "";
  } catch {
    constructorName = "";
  }
  return {
    typeofPage: typeof page,
    exists,
    constructorName,
    hasUrl: typeof candidate.url === "function",
    hasIsClosed: typeof candidate.isClosed === "function",
    hasEvaluate: typeof candidate.evaluate === "function"
  };
}

function safePageUrl(page: Page): string {
  const candidate = page as unknown as PageEvaluateLike;
  if (typeof candidate.url !== "function") return "";
  try {
    const value = candidate.url();
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

interface RawChain {
  targetId?: unknown;
  ancestors?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function boundedString(value: unknown, fallback = ""): string {
  return stringValue(value, fallback).normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, MAX_STRING_LENGTH);
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  return Math.max(0, numberValue(value, fallback));
}

function boundedDepth(value: unknown): number {
  return Math.min(MAX_ANCESTOR_DEPTH, Math.max(0, Math.trunc(nonNegativeNumber(value))));
}

function boundedBox(value: unknown): XiaohongshuPublishBoundingBox | null {
  if (!isRecord(value)) return null;
  const x = numberValue(value.x, Number.NaN);
  const y = numberValue(value.y, Number.NaN);
  const width = nonNegativeNumber(value.width, Number.NaN);
  const height = nonNegativeNumber(value.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function normalizedRole(value: unknown): string | null {
  const role = boundedString(value).toLowerCase();
  return role || null;
}

function normalizedTagName(value: unknown, fallback = "UNKNOWN"): string {
  return boundedString(value, fallback).toUpperCase() || fallback;
}

function normalizedNullable(value: unknown): string | null {
  const result = boundedString(value);
  return result || null;
}

function normalizeStableDataAttributes(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, MAX_STABLE_DATA_ATTRIBUTES).map(([key, item]) => [boundedString(key, "data-attribute"), boundedString(item)]).filter(([key, item]) => key && item));
}

function normalizeClassTokens(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedString(item)).filter(Boolean).slice(0, MAX_CLASS_TOKENS);
}

function exactPublishText(value: unknown): XiaohongshuExactPublishSemanticTarget["exactText"] | null {
  const text = boundedString(value);
  return text === XIAOHONGSHU_PUBLISH_NOTE_TEXT || text === XIAOHONGSHU_IMAGE_POST_TEXT ? text : null;
}

function targetIndex(targetId: string): number | null {
  const match = targetId.match(/-(\d+)$/u);
  if (!match) return null;
  const index = Number.parseInt(match[1]!, 10);
  return Number.isInteger(index) && index >= 0 && index < MAX_EXACT_TARGETS ? index : null;
}

function normalizeExactTarget(value: unknown, index: number): XiaohongshuExactPublishSemanticTarget | null {
  if (!isRecord(value)) return null;
  const exactText = exactPublishText(value.exactText);
  if (!exactText) return null;
  return {
    targetId: boundedString(value.targetId, `xhs-publish-target-${index}`),
    tagName: normalizedTagName(value.tagName),
    exactText,
    visible: booleanValue(value.visible),
    boundingBox: boundedBox(value.boundingBox),
    parentTag: normalizedNullable(value.parentTag)?.toUpperCase() ?? null,
    depth: Math.min(64, Math.max(0, Math.trunc(nonNegativeNumber(value.depth))))
  };
}

function normalizeDropdownTrigger(value: unknown, index: number): XiaohongshuPublishDropdownTriggerDiagnostic | null {
  if (!isRecord(value)) return null;
  const triggerId = boundedString(value.triggerId, `xhs-publish-dropdown-trigger-${index}`);
  const targetId = boundedString(value.targetId);
  if (!triggerId || !targetId) return null;
  return {
    triggerId,
    targetId,
    tagName: normalizedTagName(value.tagName),
    role: normalizedRole(value.role),
    ariaHasPopup: normalizedNullable(value.ariaHasPopup),
    ariaExpanded: normalizedNullable(value.ariaExpanded),
    ariaLabel: normalizedNullable(value.ariaLabel),
    title: normalizedNullable(value.title),
    visible: booleanValue(value.visible),
    enabled: booleanValue(value.enabled),
    boundingBox: boundedBox(value.boundingBox)
  };
}

function normalizeImagePostMenuItem(value: unknown, index: number): XiaohongshuImagePostMenuItemDiagnostic | null {
  if (!isRecord(value)) return null;
  const itemId = boundedString(value.itemId, `xhs-publish-menu-item-${index}`);
  if (!itemId || boundedString(value.exactText) !== "上传图文") return null;
  return {
    itemId,
    tagName: normalizedTagName(value.tagName),
    role: normalizedRole(value.role),
    exactText: "上传图文",
    visible: booleanValue(value.visible),
    enabled: booleanValue(value.enabled),
    boundingBox: boundedBox(value.boundingBox)
  };
}

function normalizeEntryDomElement(value: unknown, index: number, fallbackDepth = 0): XiaohongshuPublishEntryDomElementDiagnostic | null {
  if (!isRecord(value)) return null;
  const elementId = boundedString(value.elementId, `xhs-publish-entry-dom-${index}`);
  if (!elementId) return null;
  return {
    elementId,
    tagName: normalizedTagName(value.tagName),
    role: normalizedRole(value.role),
    ariaHasPopup: normalizedNullable(value.ariaHasPopup),
    ariaExpanded: normalizedNullable(value.ariaExpanded),
    tabIndex: Math.trunc(numberValue(value.tabIndex, -1)),
    disabled: booleanValue(value.disabled),
    classNameSafe: boundedString(value.classNameSafe),
    textContentSafe: boundedString(value.textContentSafe),
    childElementCount: Math.min(2000, Math.max(0, Math.trunc(nonNegativeNumber(value.childElementCount)))),
    visible: booleanValue(value.visible),
    enabled: booleanValue(value.enabled),
    isButton: booleanValue(value.isButton),
    isAnchor: booleanValue(value.isAnchor),
    isRoleButton: booleanValue(value.isRoleButton),
    clickableContainer: booleanValue(value.clickableContainer),
    ancestorDepth: Math.min(MAX_ENTRY_DOM_ANCESTORS, Math.max(0, Math.trunc(nonNegativeNumber(value.ancestorDepth, fallbackDepth))))
  };
}

function normalizeEntryDomMatch(value: unknown, index: number): XiaohongshuPublishEntryDomMatchDiagnostic | null {
  if (!isRecord(value)) return null;
  const target = normalizeEntryDomElement(value.target, index);
  if (!target) return null;
  const ancestors = Array.isArray(value.ancestors)
    ? value.ancestors.map((ancestorValue, ancestorIndex) => normalizeEntryDomElement(ancestorValue, ancestorIndex, ancestorIndex + 1)).filter((entry): entry is XiaohongshuPublishEntryDomElementDiagnostic => Boolean(entry)).slice(0, MAX_ENTRY_DOM_ANCESTORS)
    : [];
  const clickableAncestorCount = Math.min(MAX_ENTRY_DOM_ANCESTORS, Math.max(0, Math.trunc(nonNegativeNumber(value.clickableAncestorCount))));
  const uniqueClickableAncestor = normalizeEntryDomElement(value.uniqueClickableAncestor, index + MAX_ENTRY_DOM_MATCHES) ?? null;
  return { target, ancestors, clickableAncestorCount, uniqueClickableAncestor };
}

function normalizeEntryDomLabel(value: unknown, label: XiaohongshuPublishEntryDomLabel): XiaohongshuPublishEntryDomLabelDiagnostic {
  const record = isRecord(value) ? value : {};
  const matches = Array.isArray(record.matches)
    ? record.matches.map((match, index) => normalizeEntryDomMatch(match, index)).filter((entry): entry is XiaohongshuPublishEntryDomMatchDiagnostic => Boolean(entry)).slice(0, MAX_ENTRY_DOM_MATCHES)
    : [];
  const matchCount = Math.min(MAX_ENTRY_DOM_MATCHES, Math.max(0, Math.trunc(nonNegativeNumber(record.matchCount, matches.length))));
  const selectedMatch = matches.length === 1 && matchCount === 1 ? matches[0] : null;
  return {
    label,
    matchCount,
    matches,
    clickableAncestorCount: Math.min(MAX_ENTRY_DOM_MATCHES * MAX_ENTRY_DOM_ANCESTORS, Math.max(0, Math.trunc(nonNegativeNumber(record.clickableAncestorCount, matches.reduce((total, match) => total + match.clickableAncestorCount, 0))))),
    target: normalizeEntryDomElement(record.target, 0) ?? selectedMatch?.target ?? null,
    ancestors: Array.isArray(record.ancestors)
      ? record.ancestors.map((ancestorValue, index) => normalizeEntryDomElement(ancestorValue, index, index + 1)).filter((entry): entry is XiaohongshuPublishEntryDomElementDiagnostic => Boolean(entry)).slice(0, MAX_ENTRY_DOM_ANCESTORS)
      : selectedMatch?.ancestors ?? [],
    uniqueClickableAncestor: normalizeEntryDomElement(record.uniqueClickableAncestor, MAX_ENTRY_DOM_MATCHES) ?? selectedMatch?.uniqueClickableAncestor ?? null
  };
}

/** Collects exact visible publish labels and at most four ancestor levels. It never clicks or navigates. */
export async function collectPublishEntryDomDiagnostics(page: Page): Promise<XiaohongshuPublishEntryDomDiagnostics> {
  const capabilities = pageCapabilitiesSafe(page);
  const candidate = page as unknown as PageEvaluateLike;
  const emptyLabel = (label: XiaohongshuPublishEntryDomLabel): XiaohongshuPublishEntryDomLabelDiagnostic => ({ label, matchCount: 0, matches: [], clickableAncestorCount: 0, target: null, ancestors: [], uniqueClickableAncestor: null });
  if (typeof candidate.evaluate !== "function") return { pageOrigin: "", pathname: "", publishNote: emptyLabel(XIAOHONGSHU_PUBLISH_NOTE_TEXT), imagePost: emptyLabel(XIAOHONGSHU_IMAGE_POST_TEXT), uploadImage: emptyLabel(XIAOHONGSHU_IMAGE_POST_MENU_TEXT), diagnosticClickCount: 0, navigationCount: 0, pageCapabilities: capabilities };
  try {
    const payload = await candidate.evaluate(readPublishEntryDomDiagnostics);
    const record = isRecord(payload) ? payload : {};
    return {
      pageOrigin: boundedString(record.pageOrigin),
      pathname: boundedString(record.pathname),
      publishNote: normalizeEntryDomLabel(record.publishNote, XIAOHONGSHU_PUBLISH_NOTE_TEXT),
      imagePost: normalizeEntryDomLabel(record.imagePost, XIAOHONGSHU_IMAGE_POST_TEXT),
      uploadImage: normalizeEntryDomLabel(record.uploadImage, XIAOHONGSHU_IMAGE_POST_MENU_TEXT),
      diagnosticClickCount: 0,
      navigationCount: 0,
      pageCapabilities: capabilities
    };
  } catch {
    return { pageOrigin: "", pathname: "", publishNote: emptyLabel(XIAOHONGSHU_PUBLISH_NOTE_TEXT), imagePost: emptyLabel(XIAOHONGSHU_IMAGE_POST_TEXT), uploadImage: emptyLabel(XIAOHONGSHU_IMAGE_POST_MENU_TEXT), diagnosticClickCount: 0, navigationCount: 0, pageCapabilities: capabilities };
  }
}

function normalizeImagePostEntryBox(value: unknown): XiaohongshuImagePostEntryBoundingBox | null {
  if (!isRecord(value)) return null;
  const x = numberValue(value.x, Number.NaN);
  const y = numberValue(value.y, Number.NaN);
  const width = numberValue(value.width, Number.NaN);
  const height = numberValue(value.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
  return { x, y, width, height };
}

function normalizeImagePostEntryStyle(value: unknown): XiaohongshuImagePostEntryStyleDiagnostic {
  const record = isRecord(value) ? value : {};
  return {
    display: boundedString(record.display),
    visibility: boundedString(record.visibility),
    pointerEvents: boundedString(record.pointerEvents),
    cursor: boundedString(record.cursor),
    userSelect: boundedString(record.userSelect)
  };
}

function normalizeImagePostEntryAncestor(value: unknown): XiaohongshuImagePostEntryAncestorDiagnostic | null {
  if (!isRecord(value)) return null;
  return {
    tagName: normalizedTagName(value.tagName),
    role: normalizedRole(value.role),
    tabIndex: Math.trunc(numberValue(value.tabIndex, -1)),
    hrefPresent: booleanValue(value.hrefPresent),
    onclickPropertyPresent: booleanValue(value.onclickPropertyPresent),
    cursor: boundedString(value.cursor),
    pointerEvents: boundedString(value.pointerEvents)
  };
}

function normalizeImagePostEntryTarget(value: unknown): XiaohongshuImagePostEntryTargetDiagnostic | null {
  if (!isRecord(value)) return null;
  const ancestorChain = Array.isArray(value.ancestorChain)
    ? value.ancestorChain.map(normalizeImagePostEntryAncestor).filter((entry): entry is XiaohongshuImagePostEntryAncestorDiagnostic => Boolean(entry)).slice(0, MAX_IMAGE_POST_ENTRY_ANCESTORS)
    : [];
  return {
    tagName: normalizedTagName(value.tagName),
    role: normalizedRole(value.role),
    tabIndex: Math.trunc(numberValue(value.tabIndex, -1)),
    visible: booleanValue(value.visible),
    enabled: booleanValue(value.enabled),
    disabled: booleanValue(value.disabled),
    connected: booleanValue(value.connected),
    boundingBox: normalizeImagePostEntryBox(value.boundingBox),
    style: normalizeImagePostEntryStyle(value.style),
    ancestorChain
  };
}

function normalizeImagePostEntryPayload(value: unknown): XiaohongshuImagePostEntryInspectionPayload {
  const record = isRecord(value) ? value : {};
  return {
    pageOrigin: boundedString(record.pageOrigin),
    pathname: boundedString(record.pathname),
    exactTextMatchCount: Math.min(MAX_IMAGE_POST_ENTRY_SCAN_ELEMENTS, Math.max(0, Math.trunc(nonNegativeNumber(record.exactTextMatchCount)))),
    target: normalizeImagePostEntryTarget(record.target)
  };
}

function creatorHomeRouteMatches(pageOrigin: string, pathname: string): boolean {
  return pageOrigin.toLowerCase() === "https://creator.xiaohongshu.com" && pathname === "/new/home";
}

function pageRouteParts(url: string): { origin: string; pathname: string } | null {
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, pathname: parsed.pathname };
  } catch {
    return null;
  }
}

function routeUrlSafe(url: string): string {
  try {
    const parsed = new URL(url);
    const query = new URLSearchParams();
    for (const key of ["source", "from", "target"] as const) {
      const value = parsed.searchParams.get(key);
      if (value !== null) query.set(key, value.slice(0, MAX_STRING_LENGTH));
    }
    const suffix = query.toString();
    return `${parsed.origin}${parsed.pathname}${suffix ? `?${suffix}` : ""}`;
  } catch {
    return "";
  }
}

function readXiaohongshuImagePostEntryPayload(): Record<string, unknown> {
  const maxStringLength = 120;
  const maxAncestorDepth = 8;
  const maxScanElements = 2000;
  const compact = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, maxStringLength);
  const allElements = Array.from(document.querySelectorAll("*")).slice(0, maxScanElements);
  const label = "发布图文笔记";
  const boxOf = (element: Element): Record<string, number> | null => {
    const rect = element.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  };
  const visible = (element: Element): boolean => {
    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const disabled = (element: Element): boolean => element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  const roleOf = (element: Element): string | null => compact(element.getAttribute("role") ?? "").toLowerCase() || null;
  const ancestorChainOf = (element: Element): Array<Record<string, unknown>> => {
    const chain: Array<Record<string, unknown>> = [];
    let current = element.parentElement;
    while (current && chain.length < maxAncestorDepth) {
      const node = current as HTMLElement;
      const style = window.getComputedStyle(node);
      chain.push({
        tagName: current.tagName.toUpperCase(),
        role: roleOf(current),
        tabIndex: typeof node.tabIndex === "number" ? node.tabIndex : -1,
        hrefPresent: current.hasAttribute("href"),
        onclickPropertyPresent: "onclick" in node && typeof node.onclick === "function",
        cursor: compact(style.cursor),
        pointerEvents: compact(style.pointerEvents)
      });
      current = current.parentElement;
    }
    return chain;
  };
  const targets = allElements.filter((element) => {
    const tagName = element.tagName.toUpperCase();
    return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && compact(element.textContent ?? "") === label;
  });
  const target = targets.length === 1 ? targets[0] : undefined;
  const targetRecord = target ? (() => {
    const node = target as HTMLElement;
    const style = window.getComputedStyle(node);
    return {
      tagName: target.tagName.toUpperCase(),
      role: roleOf(target),
      tabIndex: typeof node.tabIndex === "number" ? node.tabIndex : -1,
      visible: visible(target),
      enabled: !disabled(target),
      disabled: disabled(target),
      connected: target.isConnected,
      boundingBox: boxOf(target),
      style: {
        display: compact(style.display),
        visibility: compact(style.visibility),
        pointerEvents: compact(style.pointerEvents),
        cursor: compact(style.cursor),
        userSelect: compact(style.userSelect)
      },
      ancestorChain: ancestorChainOf(target)
    };
  })() : null;
  return { pageOrigin: compact(window.location.origin), pathname: compact(window.location.pathname), exactTextMatchCount: targets.length, target: targetRecord };
}

function inspectionFailure(payload: XiaohongshuImagePostEntryInspectionPayload, failureCode: XiaohongshuImagePostEntryFailureCode): XiaohongshuImagePostEntryInspection {
  return { ...payload, inspectionStatus: "FAIL", safeToTestClick: false, failureCode };
}

function evaluateImagePostEntrySafety(payload: XiaohongshuImagePostEntryInspectionPayload, currentRoute: { origin: string; pathname: string } | null): XiaohongshuImagePostEntryInspection {
  if (!currentRoute || !creatorHomeRouteMatches(currentRoute.origin, currentRoute.pathname) || !creatorHomeRouteMatches(payload.pageOrigin, payload.pathname)) return inspectionFailure(payload, "NOT_CREATOR_HOME");
  if (payload.exactTextMatchCount !== 1) return inspectionFailure(payload, "EXACT_TEXT_NOT_UNIQUE");
  const target = payload.target;
  if (!target) return inspectionFailure(payload, "TARGET_NOT_FOUND");
  if (!target.connected) return inspectionFailure(payload, "TARGET_DETACHED");
  if (target.disabled || !target.enabled) return inspectionFailure(payload, "TARGET_DISABLED");
  if (!target.visible) return inspectionFailure(payload, "TARGET_NOT_VISIBLE");
  if (!target.boundingBox || target.boundingBox.width <= 0 || target.boundingBox.height <= 0) return inspectionFailure(payload, "TARGET_ZERO_SIZE");
  if (target.style.display === "none") return inspectionFailure(payload, "TARGET_DISPLAY_NONE");
  if (target.style.visibility === "hidden" || target.style.visibility === "collapse") return inspectionFailure(payload, "TARGET_VISIBILITY_HIDDEN");
  if (target.style.pointerEvents === "none") return inspectionFailure(payload, "TARGET_POINTER_EVENTS_NONE");
  return { ...payload, inspectionStatus: "PASS", safeToTestClick: true, failureCode: null };
}

/** Evaluates the unique official image-post card without requiring native button/ARIA semantics. It never clicks. */
export async function inspectXiaohongshuImagePostEntry(page: Page): Promise<XiaohongshuImagePostEntryInspection> {
  const capabilities = pageCapabilitiesSafe(page);
  const currentRoute = pageRouteParts(safePageUrl(page));
  const candidate = page as unknown as PageEvaluateLike;
  const emptyPayload = { pageOrigin: currentRoute?.origin ?? "", pathname: currentRoute?.pathname ?? "", exactTextMatchCount: 0, target: null } as const;
  if (typeof candidate.evaluate !== "function") return { ...inspectionFailure(emptyPayload, "PAGE_EVALUATION_UNAVAILABLE"), pageCapabilities: capabilities, evaluationFailureReason: "EVALUATE_METHOD_MISSING" };
  try {
    const payload = normalizeImagePostEntryPayload(await candidate.evaluate(readXiaohongshuImagePostEntryPayload));
    return { ...evaluateImagePostEntrySafety(payload, currentRoute), pageCapabilities: capabilities };
  } catch {
    return { ...inspectionFailure(emptyPayload, "PAGE_EVALUATION_UNAVAILABLE"), pageCapabilities: capabilities, evaluationFailureReason: "EVALUATE_CALL_FAILED" };
  }
}

/** Clicks the fixed exact card at most once, then requires the platform image-post route. */
export async function activateXiaohongshuImagePostEntry(page: Page, input: { navigationClickCount: number }): Promise<XiaohongshuImagePostEntryActivationResult> {
  const inspection = await inspectXiaohongshuImagePostEntry(page);
  const before = routeUrlSafe(safePageUrl(page));
  const rejected = (status: "REJECTED" | "NO_EFFECT", clickCount: number, failureCode: XiaohongshuImagePostEntryFailureCode, after = before, pathname = "", from: string | null = null, target: string | null = null, observedTarget: "image" | "video" | null = target === "image" || target === "video" ? target : null): XiaohongshuImagePostEntryActivationResult => ({ status, clickCount, routeReadback: "FAIL", observedTarget, pathname, from, target, sanitizedUrlBefore: before, sanitizedUrlAfter: after, inspection, failureCode });
  if (input.navigationClickCount >= 1) return rejected("REJECTED", input.navigationClickCount, "CLICK_ALREADY_USED");
  if (!inspection.safeToTestClick) return rejected("REJECTED", 0, inspection.failureCode ?? "TARGET_NOT_FOUND");

  let locator: ReturnType<Page["getByText"]> | null = null;
  try {
    locator = page.getByText(XIAOHONGSHU_IMAGE_POST_TEXT, { exact: true });
    if (await locator.count() !== 1 || !(await locator.isVisible()) || !(await locator.isEnabled())) return rejected("REJECTED", 0, "LOCATOR_NOT_ACTIVATABLE");
    const box = await locator.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) return rejected("REJECTED", 0, "TARGET_ZERO_SIZE");
  } catch {
    return rejected("REJECTED", 0, "LOCATOR_NOT_ACTIVATABLE");
  }
  if (!locator) return rejected("REJECTED", 0, "LOCATOR_NOT_ACTIVATABLE");

  try {
    await locator.click({ timeout: 3000 });
  } catch {
    return rejected("REJECTED", 1, "CLICK_FAILED", routeUrlSafe(safePageUrl(page)));
  }

  let after = routeUrlSafe(safePageUrl(page));
  for (let attempt = 0; attempt < 8 && after === before; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    after = routeUrlSafe(safePageUrl(page));
  }
  const route = pageRouteParts(safePageUrl(page));
  let from: string | null = null;
  let target: string | null = null;
  if (route) {
    try {
      const parsed = new URL(safePageUrl(page));
      from = parsed.searchParams.get("from");
      target = parsed.searchParams.get("target");
    } catch {
      // pageRouteParts already rejects malformed URLs.
    }
  }
  const observedTarget = target === "image" || target === "video" ? target : null;
  if (after === before) return rejected("NO_EFFECT", 1, "NO_ROUTE_TRANSITION", after, route?.pathname ?? "", from, target, observedTarget);
  if (!route || route.pathname !== "/publish/publish" || target !== "image") return rejected("REJECTED", 1, target === "video" ? "WRONG_TARGET" : "WRONG_EDITOR_ROUTE", after, route?.pathname ?? "", from, target, observedTarget);
  return { status: "ACTIVATED", clickCount: 1, routeReadback: "PASS", observedTarget: "image", pathname: route.pathname, from, target, sanitizedUrlBefore: before, sanitizedUrlAfter: after, inspection };
}

function normalizeAncestor(value: unknown, fallbackTargetId: string, fallbackDepth: number): XiaohongshuPublishAncestorDiagnostic | null {
  if (!isRecord(value)) return null;
  const targetId = boundedString(value.targetId, fallbackTargetId);
  const surfaceId = boundedString(value.surfaceId);
  if (!surfaceId) return null;
  return {
    targetId,
    surfaceId,
    depth: boundedDepth(value.depth ?? fallbackDepth),
    tagName: normalizedTagName(value.tagName),
    role: normalizedRole(value.role),
    tabIndex: Math.trunc(numberValue(value.tabIndex, -1)),
    ariaLabel: normalizedNullable(value.ariaLabel),
    title: normalizedNullable(value.title),
    stableDataAttributes: normalizeStableDataAttributes(value.stableDataAttributes),
    classTokens: normalizeClassTokens(value.classTokens),
    cursor: boundedString(value.cursor),
    pointerEvents: boundedString(value.pointerEvents),
    display: boundedString(value.display),
    visibility: boundedString(value.visibility),
    visible: booleanValue(value.visible),
    boundingBox: boundedBox(value.boundingBox),
    onclickAttributePresent: booleanValue(value.onclickAttributePresent)
  };
}

function normalizeHitTestElement(value: unknown): XiaohongshuPublishHitTestElement | null {
  if (!isRecord(value)) return null;
  const relation = boundedString(value.ancestorRelation);
  if (relation !== "TARGET" && relation !== "ANCESTOR" && relation !== "DESCENDANT" && relation !== "UNRELATED") return null;
  return {
    surfaceId: normalizedNullable(value.surfaceId),
    tagName: normalizedTagName(value.tagName),
    role: normalizedRole(value.role),
    exactSemanticText: exactPublishText(value.exactSemanticText),
    ancestorRelation: relation
  };
}

function normalizeHitTest(value: unknown): XiaohongshuPublishHitTestDiagnostic | null {
  if (!isRecord(value)) return null;
  const targetId = boundedString(value.targetId);
  if (!targetId) return null;
  const center = isRecord(value.center) && Number.isFinite(value.center.x) && Number.isFinite(value.center.y)
    ? { x: numberValue(value.center.x), y: numberValue(value.center.y) }
    : null;
  const elements = Array.isArray(value.elements)
    ? value.elements.map(normalizeHitTestElement).filter((entry): entry is XiaohongshuPublishHitTestElement => Boolean(entry)).slice(0, MAX_HIT_TEST_ELEMENTS)
    : [];
  return { targetId, center, elements };
}

function rawTargets(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  return Array.isArray(payload.targets) ? payload.targets : [];
}

/** Collects only bounded exact semantic targets. It never clicks or dispatches events. */
export async function collectExactPublishSemanticTargets(page: Page): Promise<readonly XiaohongshuExactPublishSemanticTarget[]> {
  const candidate = page as unknown as PageEvaluateLike;
  if (typeof candidate.evaluate !== "function") return [];
  try {
    const payload = await candidate.evaluate(readExactPublishSemanticTargets);
    return rawTargets(payload).slice(0, MAX_EXACT_TARGETS).map((value, index) => normalizeExactTarget(value, index)).filter((target): target is XiaohongshuExactPublishSemanticTarget => Boolean(target));
  } catch {
    return [];
  }
}

/** Collects only a bounded, semantically identified dropdown trigger related to 发布笔记. */
export async function collectPublishNoteDropdownTriggerDiagnostics(page: Page, targets: readonly XiaohongshuExactPublishSemanticTarget[]): Promise<readonly XiaohongshuPublishDropdownTriggerDiagnostic[]> {
  const candidate = page as unknown as PageEvaluateLike;
  if (typeof candidate.evaluate !== "function" || targets.length === 0) return [];
  try {
    const payload = await candidate.evaluate(readPublishDropdownTriggers as unknown as (...args: never[]) => unknown, targets.filter((target) => target.exactText === XIAOHONGSHU_PUBLISH_NOTE_TEXT).map(({ targetId }) => ({ targetId })));
    const values = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.triggers) ? payload.triggers : [];
    return values.slice(0, MAX_EXACT_TARGETS).map((value, index) => normalizeDropdownTrigger(value, index)).filter((entry): entry is XiaohongshuPublishDropdownTriggerDiagnostic => Boolean(entry));
  } catch {
    return [];
  }
}

/** Collects exact visible menu actions after the dropdown has been opened; it never clicks. */
export async function collectExactImagePostMenuItems(page: Page): Promise<readonly XiaohongshuImagePostMenuItemDiagnostic[]> {
  const candidate = page as unknown as PageEvaluateLike;
  if (typeof candidate.evaluate !== "function") return [];
  try {
    const payload = await candidate.evaluate(readExactImagePostMenuItems);
    const values = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
    return values.slice(0, MAX_EXACT_TARGETS).map((value, index) => normalizeImagePostMenuItem(value, index)).filter((entry): entry is XiaohongshuImagePostMenuItemDiagnostic => Boolean(entry));
  } catch {
    return [];
  }
}

function readExactImagePostMenuItems(): { items: Array<Record<string, unknown>> } {
  const maxScanElements = 2000;
  const compact = (value: string, limit = 120): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, limit);
  const allElements = Array.from(document.querySelectorAll("*")).slice(0, maxScanElements);
  const exactTargets = allElements.filter((element) => {
    const tagName = element.tagName.toUpperCase();
    return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && compact(element.textContent ?? "") === "上传图文";
  });
  const visible = (element: Element): boolean => {
    const node = element as HTMLElement;
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const enabled = (element: Element): boolean => !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  const roleOf = (element: Element): string | null => compact(element.getAttribute("role") ?? "", 40).toLowerCase() || null;
  const interactive = (element: Element): boolean => ["button", "a"].includes(element.tagName.toLowerCase()) || ["button", "menuitem"].includes(roleOf(element) ?? "");
  const boxOf = (element: Element): Record<string, number> | null => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  };
  const items: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const target of exactTargets) {
    let action: Element | null = interactive(target) ? target : target.parentElement;
    for (let depth = 1; action && depth <= 8 && !interactive(action); depth += 1) action = action.parentElement;
    if (!action || !interactive(action) || !visible(target) || !visible(action) || !enabled(action)) continue;
    const index = allElements.indexOf(action);
    if (index < 0) continue;
    const itemId = `xhs-publish-menu-item-${index}`;
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    items.push({ itemId, tagName: action.tagName.toUpperCase(), role: roleOf(action), exactText: "上传图文", visible: visible(action), enabled: enabled(action), boundingBox: boxOf(action) });
  }
  return { items };
}

function readPublishEntryDomDiagnostics(): Record<string, unknown> {
  const maxMatches = 20;
  const maxAncestors = 4;
  const maxScanElements = 2000;
  const labels = ["发布笔记", "发布图文笔记", "上传图文"] as const;
  const compact = (value: string, limit = 120): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, limit);
  const allElements = Array.from(document.querySelectorAll("*")).slice(0, maxScanElements);
  const visible = (element: Element): boolean => {
    const node = element as HTMLElement;
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const disabled = (element: Element): boolean => element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  const roleOf = (element: Element): string | null => compact(element.getAttribute("role") ?? "", 40).toLowerCase() || null;
  const metadata = (element: Element, ancestorDepth: number): Record<string, unknown> => {
    const tagName = element.tagName.toUpperCase();
    const role = roleOf(element);
    const node = element as HTMLElement;
    const tabIndex = typeof node.tabIndex === "number" ? node.tabIndex : -1;
    const style = window.getComputedStyle(node);
    const isButton = tagName === "BUTTON";
    const isAnchor = tagName === "A";
    const isRoleButton = role === "button";
    const clickableContainer = isButton || isAnchor || isRoleButton || role === "link" || role === "menuitem" || element.hasAttribute("onclick") || (tabIndex >= 0 && style.cursor === "pointer");
    const index = allElements.indexOf(element);
    return {
      elementId: `xhs-publish-entry-dom-${index >= 0 ? index : ancestorDepth}`,
      tagName,
      role,
      ariaHasPopup: compact(element.getAttribute("aria-haspopup") ?? "", 40) || null,
      ariaExpanded: compact(element.getAttribute("aria-expanded") ?? "", 40) || null,
      tabIndex,
      disabled: disabled(element),
      classNameSafe: compact(typeof element.className === "string" ? element.className : element.getAttribute("class") ?? "", 160),
      textContentSafe: compact(element.textContent ?? "", 160),
      childElementCount: Math.min(2000, Math.max(0, element.children.length)),
      visible: visible(element),
      enabled: !disabled(element),
      isButton,
      isAnchor,
      isRoleButton,
      clickableContainer,
      ancestorDepth
    };
  };
  const diagnosticFor = (label: string): Record<string, unknown> => {
    const targets = allElements.filter((element) => element.tagName.toUpperCase() !== "HTML" && element.tagName.toUpperCase() !== "BODY" && element.tagName.toUpperCase() !== "SCRIPT" && element.tagName.toUpperCase() !== "STYLE" && compact(element.textContent ?? "") === label && visible(element)).slice(0, maxMatches);
    const matches = targets.map((target) => {
      const ancestors: Array<Record<string, unknown>> = [];
      let current = target.parentElement;
      for (let depth = 1; current && depth <= maxAncestors; depth += 1) {
        ancestors.push(metadata(current, depth));
        current = current.parentElement;
      }
      const clickableAncestors = ancestors.filter((ancestor) => ancestor.clickableContainer === true && ancestor.visible === true && ancestor.enabled === true);
      return {
        target: metadata(target, 0),
        ancestors,
        clickableAncestorCount: clickableAncestors.length,
        uniqueClickableAncestor: clickableAncestors.length === 1 ? clickableAncestors[0] : null
      };
    });
    const selected = matches.length === 1 ? matches[0] : null;
    return {
      label,
      matchCount: targets.length,
      matches,
      clickableAncestorCount: matches.reduce((total, match) => total + Number(match.clickableAncestorCount ?? 0), 0),
      target: selected?.target ?? null,
      ancestors: selected?.ancestors ?? [],
      uniqueClickableAncestor: selected?.uniqueClickableAncestor ?? null
    };
  };
  return {
    pageOrigin: compact(window.location.origin, 200),
    pathname: compact(window.location.pathname, 200),
    publishNote: diagnosticFor(labels[0]),
    imagePost: diagnosticFor(labels[1]),
    uploadImage: diagnosticFor(labels[2])
  };
}

function readPublishDropdownTriggers(input: readonly { targetId: string }[]): { triggers: Array<Record<string, unknown>> } {
  const maxAncestorDepth = 8;
  const maxScanElements = 2000;
  const compact = (value: string, limit = 120): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, limit);
  const exactTargets = Array.from(document.querySelectorAll("*")).filter((element) => {
    const tagName = element.tagName.toUpperCase();
    return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && compact(element.textContent ?? "") === "发布笔记";
  });
  const allElements = Array.from(document.querySelectorAll("*")).slice(0, maxScanElements);
  const visible = (element: Element): boolean => {
    const node = element as HTMLElement;
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const enabled = (element: Element): boolean => !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  const roleOf = (element: Element): string | null => compact(element.getAttribute("role") ?? "", 40).toLowerCase() || null;
  const isButtonSemantics = (element: Element): boolean => element.tagName.toLowerCase() === "button" || roleOf(element) === "button";
  const hasDropdownSemantics = (element: Element): boolean => {
    if (!isButtonSemantics(element)) return false;
    const hasPopup = compact(element.getAttribute("aria-haspopup") ?? "", 40).toLowerCase();
    const expanded = element.getAttribute("aria-expanded");
    const accessibleLabel = compact(`${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`);
    return Boolean(hasPopup && ["true", "menu", "listbox", "tree", "grid", "dialog"].includes(hasPopup)) || expanded !== null || /下拉|更多|发布类型|dropdown|menu/iu.test(accessibleLabel);
  };
  const boxOf = (element: Element): Record<string, number> | null => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  };
  const triggers: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const item of input.slice(0, 20)) {
    const targetIndex = Number.parseInt(item.targetId.match(/-(\d+)$/u)?.[1] ?? "-1", 10);
    const target = Number.isInteger(targetIndex) ? exactTargets[targetIndex] : undefined;
    if (!target) continue;
    let container: Element | null = target.parentElement;
    let depth = 1;
    while (container && depth <= maxAncestorDepth) {
      const candidates = [container, ...Array.from(container.querySelectorAll("button, [role='button']"))].filter((element, index, all) => all.indexOf(element) === index);
      const matches = candidates.filter((element) => {
        if (element === target || element.contains(target) || !hasDropdownSemantics(element) || !visible(element) || !enabled(element)) return false;
        return container?.contains(element) ?? false;
      });
      if (matches.length > 0) {
        for (const trigger of matches) {
          const index = allElements.indexOf(trigger);
          if (index < 0) continue;
          const triggerId = `xhs-publish-dropdown-trigger-${index}`;
          if (seen.has(triggerId)) continue;
          seen.add(triggerId);
          triggers.push({
            triggerId,
            targetId: item.targetId,
            tagName: trigger.tagName.toUpperCase(),
            role: roleOf(trigger),
            ariaHasPopup: compact(trigger.getAttribute("aria-haspopup") ?? "", 40) || null,
            ariaExpanded: compact(trigger.getAttribute("aria-expanded") ?? "", 40) || null,
            ariaLabel: compact(trigger.getAttribute("aria-label") ?? "") || null,
            title: compact(trigger.getAttribute("title") ?? "") || null,
            visible: visible(trigger),
            enabled: enabled(trigger),
            boundingBox: boxOf(trigger)
          });
        }
        break;
      }
      container = container.parentElement;
      depth += 1;
    }
  }
  return { triggers };
}

function readExactPublishSemanticTargets(): { targets: Array<Record<string, unknown>>; truncated: boolean } {
  const maxExactTargets = 20;
  const maxScanElements = 2000;
  const maxStringLength = 120;
  const exactTextInPage = (value: string): boolean => value === "发布笔记" || value === "发布图文笔记";
  const compact = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
  const visible = (element: Element): boolean => {
    const node = element as HTMLElement;
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const boxOf = (element: Element): { x: number; y: number; width: number; height: number } | null => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  };
  const depthOf = (element: Element): number => {
    let depth = 0;
    let current: Element | null = element;
    while (current?.parentElement && depth < 64) { depth += 1; current = current.parentElement; }
    return depth;
  };
  const targets: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let candidateCount = 0;
  for (const element of Array.from(document.querySelectorAll("*"))) {
    if (scanned >= maxScanElements) break;
    scanned += 1;
    const tagName = element.tagName.toUpperCase();
    if (tagName === "HTML" || tagName === "BODY" || tagName === "SCRIPT" || tagName === "STYLE") continue;
    const exactText = compact((element.textContent ?? "").slice(0, maxStringLength));
    if (!exactTextInPage(exactText)) continue;
    candidateCount += 1;
    if (targets.length >= maxExactTargets) continue;
    targets.push({
      targetId: `xhs-publish-target-${targets.length}`,
      tagName,
      exactText,
      visible: visible(element),
      boundingBox: boxOf(element),
      parentTag: element.parentElement?.tagName.toUpperCase() ?? null,
      depth: depthOf(element)
    });
  }
  return { targets, truncated: candidateCount > maxExactTargets };
}

/** Collects at most eight ancestors per exact target and only safe presentation metadata. */
export async function collectPublishAncestorChainDiagnostics(page: Page, targets: readonly XiaohongshuExactPublishSemanticTarget[]): Promise<readonly XiaohongshuPublishAncestorDiagnostic[]> {
  const candidate = page as unknown as PageEvaluateLike;
  if (typeof candidate.evaluate !== "function" || targets.length === 0) return [];
  try {
    const payload: unknown = await candidate.evaluate(readPublishAncestorChains as unknown as (...args: never[]) => unknown, targets.map(({ targetId, exactText }) => ({ targetId, exactText })));
    const chains: RawChain[] = Array.isArray(payload)
      ? [{ targetId: targets[0]?.targetId, ancestors: payload }]
      : isRecord(payload) && Array.isArray(payload.chains)
        ? payload.chains.filter((value): value is RawChain => isRecord(value))
        : isRecord(payload) && Array.isArray(payload.ancestors)
          ? [{ targetId: payload.targetId, ancestors: payload.ancestors }]
          : [];
    return chains.flatMap((chain) => {
      const targetId = boundedString(chain.targetId);
      const ancestors = Array.isArray(chain.ancestors) ? chain.ancestors.slice(0, MAX_ANCESTOR_DEPTH) : [];
      return ancestors.map((value, index) => normalizeAncestor(value, targetId, index)).filter((entry): entry is XiaohongshuPublishAncestorDiagnostic => Boolean(entry));
    });
  } catch {
    return [];
  }
}

function readPublishAncestorChains(input: readonly { targetId: string; exactText: string }[]): { chains: Array<{ targetId: string; ancestors: Array<Record<string, unknown>> }> } {
  const maxExactTargets = 20;
  const maxScanElements = 2000;
  const maxAncestorDepth = 8;
  const maxStringLength = 120;
  const maxClassTokens = 8;
  const compact = (value: string, limit = maxStringLength): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, limit);
  const exactTexts = new Set(["发布笔记", "发布图文笔记"]);
  const exactTargets = Array.from(document.querySelectorAll("*")).filter((element) => {
    const tagName = element.tagName.toUpperCase();
    return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && exactTexts.has(compact(element.textContent ?? ""));
  });
  const elements = Array.from(document.querySelectorAll("*")).slice(0, maxScanElements);
  const surfaceIdOf = (element: Element): string => `xhs-publish-surface-${Math.max(0, elements.indexOf(element))}`;
  const boxOf = (element: Element): Record<string, number> | null => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  };
  const visible = (element: Element): boolean => {
    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const roleOf = (element: Element): string | null => compact(element.getAttribute("role") ?? "", 40).toLowerCase() || null;
  const dataAttributesOf = (element: Element): Record<string, string> => Object.fromEntries(["data-testid", "data-test", "data-action", "data-qa", "data-cy"].map((name) => [name, compact(element.getAttribute(name) ?? "", 80)]).filter(([, value]) => value));
  const classTokensOf = (element: Element): string[] => compact(element.getAttribute("class") ?? "", 320).split(/\s+/u).filter(Boolean).slice(0, maxClassTokens);
  const chains: Array<{ targetId: string; ancestors: Array<Record<string, unknown>> }> = [];
  for (const item of input.slice(0, maxExactTargets)) {
    const targetIndex = Number.parseInt(item.targetId.match(/-(\d+)$/u)?.[1] ?? "-1", 10);
    const target = Number.isInteger(targetIndex) ? exactTargets[targetIndex] : undefined;
    if (!target) continue;
    const ancestors: Array<Record<string, unknown>> = [];
    let current: Element | null = target;
    for (let depth = 0; depth < maxAncestorDepth && current; depth += 1, current = current.parentElement) {
      const node = current as HTMLElement;
      const style = window.getComputedStyle(node);
      ancestors.push({
        targetId: item.targetId,
        surfaceId: surfaceIdOf(current),
        depth,
        tagName: current.tagName.toUpperCase(),
        role: roleOf(current),
        tabIndex: node.tabIndex,
        ariaLabel: compact(current.getAttribute("aria-label") ?? "") || null,
        title: compact(current.getAttribute("title") ?? "") || null,
        stableDataAttributes: dataAttributesOf(current),
        classTokens: classTokensOf(current),
        cursor: style.cursor,
        pointerEvents: style.pointerEvents,
        display: style.display,
        visibility: style.visibility,
        visible: visible(current),
        boundingBox: boxOf(current),
        onclickAttributePresent: current.hasAttribute("onclick")
      });
    }
    chains.push({ targetId: item.targetId, ancestors });
  }
  return { chains };
}

/** Performs a read-only elementsFromPoint() probe at each exact target's center. */
export async function collectPublishHitTestDiagnostics(page: Page, targets: readonly XiaohongshuExactPublishSemanticTarget[]): Promise<readonly XiaohongshuPublishHitTestDiagnostic[]> {
  const candidate = page as unknown as PageEvaluateLike;
  if (typeof candidate.evaluate !== "function" || targets.length === 0) return [];
  try {
    const payload = await candidate.evaluate(readPublishHitTests, targets.map(({ targetId, exactText }) => ({ targetId, exactText })));
    const values = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.hitTests) ? payload.hitTests : [];
    return values.slice(0, MAX_EXACT_TARGETS).map(normalizeHitTest).filter((entry): entry is XiaohongshuPublishHitTestDiagnostic => Boolean(entry));
  } catch {
    return [];
  }
}

function readPublishHitTests(input: readonly { targetId: string; exactText: string }[]): { hitTests: Array<Record<string, unknown>> } {
  const maxExactTargets = 20;
  const maxScanElements = 2000;
  const maxHitTestElements = 8;
  const maxStringLength = 120;
  const compact = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, maxStringLength);
  const exactTexts = new Set(["发布笔记", "发布图文笔记"]);
  const exactTargets = Array.from(document.querySelectorAll("*")).filter((element) => {
    const tagName = element.tagName.toUpperCase();
    return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && exactTexts.has(compact(element.textContent ?? ""));
  });
  const allElements = Array.from(document.querySelectorAll("*")).slice(0, maxScanElements);
  const surfaceIdOf = (element: Element): string => `xhs-publish-surface-${Math.max(0, allElements.indexOf(element))}`;
  const roleOf = (element: Element): string | null => compact(element.getAttribute("role") ?? "").toLowerCase() || null;
  const hitTests: Array<Record<string, unknown>> = [];
  for (const item of input.slice(0, maxExactTargets)) {
    const targetIndex = Number.parseInt(item.targetId.match(/-(\d+)$/u)?.[1] ?? "-1", 10);
    const target = Number.isInteger(targetIndex) ? exactTargets[targetIndex] : undefined;
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { hitTests.push({ targetId: item.targetId, center: null, elements: [] }); continue; }
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const elements = document.elementsFromPoint(center.x, center.y).slice(0, maxHitTestElements).map((element) => ({
      surfaceId: surfaceIdOf(element),
      tagName: element.tagName.toUpperCase(),
      role: roleOf(element),
      exactSemanticText: exactTexts.has(compact(element.textContent ?? "")) ? compact(element.textContent ?? "") : null,
      ancestorRelation: element === target ? "TARGET" : element.contains(target) ? "ANCESTOR" : target.contains(element) ? "DESCENDANT" : "UNRELATED"
    }));
    hitTests.push({ targetId: item.targetId, center, elements });
  }
  return { hitTests };
}

interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach?: () => Promise<void>;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function remoteObjectId(value: unknown): string | null {
  const root = recordValue(value);
  const result = recordValue(root?.result);
  return typeof result?.objectId === "string" ? result.objectId : null;
}

function listenerTypeCounts(value: unknown): Map<XiaohongshuPublishInteractionEvent, number> {
  const root = recordValue(value);
  const listeners = Array.isArray(root?.listeners) ? root.listeners : [];
  const counts = new Map<XiaohongshuPublishInteractionEvent, number>();
  for (const listener of listeners) {
    if (!isRecord(listener)) continue;
    const type = boundedString(listener.type) as XiaohongshuPublishInteractionEvent;
    if (!XIAOHONGSHU_PUBLISH_INTERACTION_EVENTS.includes(type)) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

async function cdpSessionForPage(page: Page): Promise<CdpSessionLike | null> {
  try {
    const context = page.context() as unknown as { newCDPSession?: (targetPage: Page) => Promise<CDPSession> };
    if (typeof context.newCDPSession !== "function") return null;
    return await context.newCDPSession(page);
  } catch {
    return null;
  }
}

function eventTargetExpression(targetIndex: number, depth: number): string {
  return `(() => { const exact = new Set(["${XIAOHONGSHU_PUBLISH_NOTE_TEXT}", "${XIAOHONGSHU_IMAGE_POST_TEXT}"]); const nodes = Array.from(document.querySelectorAll("*")).filter((element) => { const tagName = element.tagName.toUpperCase(); return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && exact.has((element.textContent || "").normalize("NFKC").replace(/[\\s]+/gu, " ").trim()); }); let current = nodes[${targetIndex}] || null; for (let i = 0; i < ${depth} && current; i += 1) current = current.parentElement; return current; })()`;
}

/** Uses only Runtime.evaluate + DOMDebugger.getEventListeners and never serializes listener source or closures. */
export async function collectPublishEventListenerDiagnostics(page: Page, targets: readonly XiaohongshuExactPublishSemanticTarget[], options: { cdpSession?: CDPSession } = {}): Promise<XiaohongshuPublishEventListenerInspection> {
  if (targets.length === 0) return { status: "AVAILABLE", targets: [] };
  const session = (options.cdpSession as unknown as CdpSessionLike | undefined) ?? await cdpSessionForPage(page);
  if (!session) return { status: "UNAVAILABLE", targets: [] };
  const diagnostics: XiaohongshuPublishEventListenerTarget[] = [];
  try {
    for (const target of targets.slice(0, MAX_EXACT_TARGETS)) {
      const index = targetIndex(target.targetId);
      if (index === null) continue;
      const listeners: XiaohongshuPublishEventListenerEntry[] = [];
      for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        const evaluated = await session.send("Runtime.evaluate", { expression: eventTargetExpression(index, depth), returnByValue: false, objectGroup: "xhs-publish-clickable-surface" });
        const objectId = remoteObjectId(evaluated);
        if (!objectId) continue;
        const eventPayload = await session.send("DOMDebugger.getEventListeners", { objectId });
        const counts = listenerTypeCounts(eventPayload);
        let surfaceId: string | null = null;
        try {
          const surfacePayload = await session.send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: "function () { const all = Array.from(document.querySelectorAll('*')); return 'xhs-publish-surface-' + Math.max(0, all.indexOf(this)); }",
            returnByValue: true
          });
          const result = recordValue(recordValue(surfacePayload)?.result);
          surfaceId = typeof result?.value === "string" ? result.value : null;
        } catch {
          surfaceId = null;
        }
        for (const eventType of XIAOHONGSHU_PUBLISH_INTERACTION_EVENTS) listeners.push({ eventType, listenerCount: counts.get(eventType) ?? 0, ancestorDepth: depth, surfaceId });
      }
      diagnostics.push({ targetId: target.targetId, listeners });
    }
    return { status: "AVAILABLE", targets: diagnostics };
  } catch {
    return { status: "UNAVAILABLE", targets: [] };
  }
}

function hitTestContainsSurface(hitTest: XiaohongshuPublishHitTestDiagnostic | undefined, surfaceId: string): boolean {
  return Boolean(hitTest?.center && hitTest.elements.some((element) => element.surfaceId === surfaceId && element.ancestorRelation !== "UNRELATED"));
}

function resolutionForExactText(
  exactText: XiaohongshuClickableSurfaceResolution["exactText"],
  targets: readonly XiaohongshuExactPublishSemanticTarget[],
  ancestors: readonly XiaohongshuPublishAncestorDiagnostic[],
  eventListeners: XiaohongshuPublishEventListenerInspection,
  hitTests: readonly XiaohongshuPublishHitTestDiagnostic[]
): XiaohongshuClickableSurfaceResolution {
  const exactTargets = targets.filter((target) => target.exactText === exactText);
  if (exactTargets.length === 0) return { exactText, status: "NO_CLICK_SURFACE_FOUND", confidence: "NONE", surface: null, failureCode: "PUBLISH_SEMANTIC_TARGET_NOT_FOUND" };
  if (new Set(exactTargets.map((target) => target.targetId)).size !== exactTargets.length) return { exactText, status: "AMBIGUOUS", confidence: "NONE", surface: null, failureCode: "PUBLISH_SEMANTIC_TARGET_AMBIGUOUS" };

  const visibleTargets = exactTargets.filter((target) => target.visible);
  if (visibleTargets.length === 0) return { exactText, status: "NO_CLICK_SURFACE_FOUND", confidence: "NONE", surface: null, failureCode: "PUBLISH_CLICK_SURFACE_NOT_VISIBLE" };

  const eventByTarget = new Map(eventListeners.targets.map((entry) => [entry.targetId, entry.listeners]));
  const hitByTarget = new Map(hitTests.map((entry) => [entry.targetId, entry]));
  const candidates = new Map<string, XiaohongshuClickableSurfaceResolution["surface"]>();
  let invisibleSurface = false;
  let hitTestFailure = false;
  let relationFailure = false;
  for (const target of visibleTargets) {
    const chain = ancestors.filter((ancestor) => ancestor.targetId === target.targetId && ancestor.depth < MAX_ANCESTOR_DEPTH);
    const listenerEntries = eventByTarget.get(target.targetId) ?? [];
    const strongByDepth = new Map<number, string[]>();
    for (const listener of listenerEntries) {
      if (listener.listenerCount <= 0) continue;
      const signals = strongByDepth.get(listener.ancestorDepth) ?? [];
      signals.push(`event:${listener.eventType}`);
      strongByDepth.set(listener.ancestorDepth, signals);
    }
    for (const surface of chain) {
      const strongSignals = [...(strongByDepth.get(surface.depth) ?? [])];
      if (surface.onclickAttributePresent) strongSignals.push("onclick-attribute");
      if (strongSignals.length === 0) continue;
      if (!surface.visible || surface.display === "none" || surface.visibility === "hidden" || surface.visibility === "collapse" || surface.boundingBox === null) { invisibleSurface = true; continue; }
      if (surface.pointerEvents === "none") { hitTestFailure = true; continue; }
      if (!hitTestContainsSurface(hitByTarget.get(target.targetId), surface.surfaceId)) { hitTestFailure = true; continue; }
      if (!candidates.has(surface.surfaceId)) candidates.set(surface.surfaceId, { surfaceId: surface.surfaceId, targetId: target.targetId, ancestorDepth: surface.depth, tagName: surface.tagName, boundingBox: surface.boundingBox!, strongSignals: [...new Set(strongSignals)] });
    }
    if (chain.length === 0) relationFailure = true;
  }
  if (candidates.size > 1) return { exactText, status: "AMBIGUOUS", confidence: "NONE", surface: null, failureCode: "PUBLISH_CLICK_SURFACE_AMBIGUOUS" };
  if (candidates.size === 1) return { exactText, status: "PROVEN_UNIQUE", confidence: "HIGH", surface: candidates.values().next().value!, };
  if (invisibleSurface) return { exactText, status: "NO_CLICK_SURFACE_FOUND", confidence: "NONE", surface: null, failureCode: "PUBLISH_CLICK_SURFACE_NOT_VISIBLE" };
  if (hitTestFailure || relationFailure) return { exactText, status: "NO_CLICK_SURFACE_FOUND", confidence: "NONE", surface: null, failureCode: "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED" };
  if (eventListeners.status === "UNAVAILABLE") return { exactText, status: "EVENT_LISTENER_INSPECTION_UNAVAILABLE", confidence: "NONE", surface: null, failureCode: "PUBLISH_CLICK_SURFACE_DIAGNOSTIC_FAILED" };
  return { exactText, status: "NO_CLICK_SURFACE_FOUND", confidence: "NONE", surface: null, failureCode: "PUBLISH_CLICK_SURFACE_NOT_FOUND" };
}

function overallStatus(resolutions: readonly XiaohongshuClickableSurfaceResolution[]): XiaohongshuClickableSurfaceStatus {
  if (resolutions.some((resolution) => resolution.status === "AMBIGUOUS")) return "AMBIGUOUS";
  if (resolutions.some((resolution) => resolution.status === "EVENT_LISTENER_INSPECTION_UNAVAILABLE")) return "EVENT_LISTENER_INSPECTION_UNAVAILABLE";
  if (resolutions.some((resolution) => resolution.status === "NO_CLICK_SURFACE_FOUND")) return "NO_CLICK_SURFACE_FOUND";
  return "PROVEN_UNIQUE";
}

export function resolvePublishNoteDropdownTrigger(input: {
  exactTargets: readonly XiaohongshuExactPublishSemanticTarget[];
  dropdownTriggers: readonly XiaohongshuPublishDropdownTriggerDiagnostic[];
}): XiaohongshuPublishDropdownTriggerResolution {
  const publishTargetIds = new Set(input.exactTargets.filter((target) => target.exactText === XIAOHONGSHU_PUBLISH_NOTE_TEXT).map((target) => target.targetId));
  const candidates = input.dropdownTriggers.filter((trigger) => publishTargetIds.has(trigger.targetId) && trigger.visible && trigger.enabled && Boolean(trigger.boundingBox));
  const unique = [...new Map(candidates.map((trigger) => [trigger.triggerId, trigger])).values()];
  if (unique.length === 1) return { status: "PROVEN_UNIQUE", trigger: unique[0]! };
  if (unique.length > 1) return { status: "AMBIGUOUS", trigger: null, failureCode: "PUBLISH_NOTE_DROPDOWN_TRIGGER_AMBIGUOUS" };
  return { status: "NOT_FOUND", trigger: null, failureCode: "PUBLISH_NOTE_DROPDOWN_TRIGGER_NOT_FOUND" };
}

export function resolveExactImagePostMenuItem(input: {
  items: readonly XiaohongshuImagePostMenuItemDiagnostic[];
}): XiaohongshuImagePostMenuItemResolution {
  const candidates = input.items.filter((item) => item.exactText === "上传图文" && item.visible && item.enabled && Boolean(item.boundingBox));
  const unique = [...new Map(candidates.map((item) => [item.itemId, item])).values()];
  if (unique.length === 1) return { status: "PROVEN_UNIQUE", item: unique[0]! };
  if (unique.length > 1) return { status: "AMBIGUOUS", item: null, failureCode: "XIAOHONGSHU_IMAGE_POST_MENU_ITEM_AMBIGUOUS" };
  return { status: "NOT_FOUND", item: null, failureCode: "XIAOHONGSHU_IMAGE_POST_MENU_ITEM_NOT_FOUND" };
}

/** Resolves only from read-only diagnostic evidence; it never receives or clicks a Locator. */
export function resolvePublishClickableSurfaces(input: {
  exactTargets: readonly XiaohongshuExactPublishSemanticTarget[];
  ancestorChains: readonly XiaohongshuPublishAncestorDiagnostic[];
  eventListeners: XiaohongshuPublishEventListenerInspection;
  hitTests: readonly XiaohongshuPublishHitTestDiagnostic[];
  dropdownTriggers?: readonly XiaohongshuPublishDropdownTriggerDiagnostic[];
}): XiaohongshuClickableSurfaceDiagnostics {
  const publishNoteSurface = resolutionForExactText(XIAOHONGSHU_PUBLISH_NOTE_TEXT, input.exactTargets, input.ancestorChains, input.eventListeners, input.hitTests);
  const imagePostSurface = resolutionForExactText(XIAOHONGSHU_IMAGE_POST_TEXT, input.exactTargets, input.ancestorChains, input.eventListeners, input.hitTests);
  const publishNoteDropdownTrigger = resolvePublishNoteDropdownTrigger({ exactTargets: input.exactTargets, dropdownTriggers: input.dropdownTriggers ?? [] });
  const status = overallStatus([publishNoteSurface, imagePostSurface]);
  const clickableSurfaceFailureCode = publishNoteSurface.failureCode ?? imagePostSurface.failureCode ?? null;
  return {
    exactPublishSemanticTargets: input.exactTargets.slice(0, MAX_EXACT_TARGETS),
    ancestorChainDiagnostics: input.ancestorChains.slice(0, MAX_EXACT_TARGETS * MAX_ANCESTOR_DEPTH),
    eventListenerInspection: input.eventListeners,
    eventListenerDiagnostics: input.eventListeners.targets.slice(0, MAX_EXACT_TARGETS),
    hitTestDiagnostics: input.hitTests.slice(0, MAX_EXACT_TARGETS),
    publishNoteSurface,
    imagePostSurface,
    publishNoteDropdownTrigger,
    clickableSurfaceStatus: status,
    clickableSurfaceFailureCode,
    clickableSurfaceConfidence: status === "PROVEN_UNIQUE" ? "HIGH" : "NONE",
    diagnosticClickCount: 0,
    mouseEventDispatchCount: 0,
    keyboardEventCount: 0,
    gateSideEffects: { preparePublish: "NO", contentMutationCount: 0, uploadCount: 0, finalSubmitCount: 0 }
  };
}

export async function collectPublishClickableSurfaceDiagnostics(page: Page): Promise<XiaohongshuClickableSurfaceDiagnostics> {
  const exactTargets = await collectExactPublishSemanticTargets(page);
  const [ancestorChainDiagnostics, hitTestDiagnostics, eventListeners, dropdownTriggers] = await Promise.all([
    collectPublishAncestorChainDiagnostics(page, exactTargets),
    collectPublishHitTestDiagnostics(page, exactTargets),
    collectPublishEventListenerDiagnostics(page, exactTargets),
    collectPublishNoteDropdownTriggerDiagnostics(page, exactTargets)
  ]);
  return resolvePublishClickableSurfaces({ exactTargets, ancestorChains: ancestorChainDiagnostics, eventListeners, hitTests: hitTestDiagnostics, dropdownTriggers });
}

export { MAX_ANCESTOR_DEPTH, MAX_EXACT_TARGETS };
