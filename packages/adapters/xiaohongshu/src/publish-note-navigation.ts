import type { ElementHandle, Page } from "playwright-core";
import {
  collectExactImagePostMenuItems,
  collectPublishClickableSurfaceDiagnostics,
  resolveExactImagePostMenuItem,
  type XiaohongshuPublishDropdownTriggerDiagnostic,
  type XiaohongshuImagePostMenuItemDiagnostic,
  type XiaohongshuPublishDropdownTriggerResolution,
  XIAOHONGSHU_PUBLISH_NOTE_TEXT,
  type XiaohongshuClickableSurfaceDiagnostics,
  type XiaohongshuClickableSurfaceFailureCode,
  type XiaohongshuClickableSurfaceResolution,
  type XiaohongshuClickableSurfaceStatus,
  type XiaohongshuExactPublishSemanticTarget
} from "./publish-clickable-surface";

export type PublishNoteNavigationFailureCode =
  | XiaohongshuClickableSurfaceFailureCode
  | "PUBLISH_SURFACE_DETACHED"
  | "PUBLISH_SURFACE_DOM_CHANGED_BEFORE_CLICK"
  | "PUBLISH_SURFACE_PAGE_IDENTITY_CHANGED"
  | "PUBLISH_SURFACE_CONTEXT_IDENTITY_CHANGED"
  | "PUBLISH_SURFACE_OPERATION_ID_CHANGED"
  | "PUBLISH_SURFACE_AUTH_STATE_CHANGED"
  | "PUBLISH_SURFACE_POINTER_EVENTS_NONE"
  | "PUBLISH_SURFACE_GEOMETRY_INVALID"
  | "PUBLISH_SURFACE_REVALIDATION_FAILED"
  | "PUBLISH_NAVIGATION_CLICK_ALREADY_USED"
  | "PUBLISH_ENTRY_CLICK_FAILED"
  | "PUBLISH_ENTRY_CLICK_NO_TRANSITION";

export type PublishNotePostClickState = "IMAGE_POST_SELECTION_PAGE" | "IMAGE_EDITOR" | "VIDEO_EDITOR" | "CREATOR_HOME" | "LOGIN" | "SECURITY_VERIFICATION" | "UNKNOWN";

export interface PublishNoteNavigationLifecycle {
  operationId: string;
  platformKey: "xiaohongshu";
  accountId: string;
  contextDebugId: string;
  pageDebugId: string;
  page: object;
  context: object;
  authState: string;
}

export interface PublishNoteSurfaceRuntimeState {
  targetAttached: boolean;
  surfaceAttached: boolean;
  exactSemanticText: string;
  targetWithinSurface: boolean;
  visible: boolean;
  pointerEventsActive: boolean;
  geometryValid: boolean;
  hitTestConsistent: boolean;
}

export interface PublishNoteNavigationSurfaceHandle {
  inspect(): Promise<PublishNoteSurfaceRuntimeState>;
  click(): Promise<void>;
}

export interface PublishNoteDropdownTriggerRuntimeState {
  triggerAttached: boolean;
  relatedTargetAttached: boolean;
  visible: boolean;
  enabled: boolean;
  pointerEventsActive: boolean;
  geometryValid: boolean;
  hitTestConsistent: boolean;
  dropdownSemanticsActive: boolean;
}

export interface PublishNoteDropdownTriggerHandle {
  inspect(): Promise<PublishNoteDropdownTriggerRuntimeState>;
  click(): Promise<void>;
}

export interface PublishNoteImageMenuItemRuntimeState {
  itemAttached: boolean;
  visible: boolean;
  enabled: boolean;
  pointerEventsActive: boolean;
  geometryValid: boolean;
  hitTestConsistent: boolean;
  exactText: string;
}

export interface PublishNoteImageMenuItemHandle {
  inspect(): Promise<PublishNoteImageMenuItemRuntimeState>;
  click(): Promise<void>;
}

export interface PublishNoteNavigationEvidence {
  exactSemanticText: string;
  visible: boolean;
  pointerEventsActive: boolean;
  geometryValid: boolean;
  hitTestConsistent: boolean;
  uniqueSurface: boolean;
  strongClickabilitySignal: boolean;
  eventListenerSignal: string | null;
}

export interface PublishNoteNavigationSurfaceResolution {
  status: XiaohongshuClickableSurfaceStatus;
  target: XiaohongshuExactPublishSemanticTarget | null;
  surface: XiaohongshuClickableSurfaceResolution["surface"];
  evidence: PublishNoteNavigationEvidence;
  diagnostics: XiaohongshuClickableSurfaceDiagnostics | null;
  dropdownTrigger: XiaohongshuPublishDropdownTriggerDiagnostic | null;
  failureCode?: PublishNoteNavigationFailureCode;
  surfaceHandle: PublishNoteNavigationSurfaceHandle | null;
  dropdownTriggerHandle: PublishNoteDropdownTriggerHandle | null;
  imagePostMenuItemHandle?: PublishNoteImageMenuItemHandle | null;
  lifecycle: PublishNoteNavigationLifecycle;
}

export interface PublishNoteNavigationRevalidation {
  revalidated: boolean;
  failureCode?: PublishNoteNavigationFailureCode;
  runtimeState?: PublishNoteSurfaceRuntimeState;
}

export interface PublishNoteNavigationClickResult {
  status: "NAVIGATION_CLICK_COMPLETED" | "NAVIGATION_CLICK_REJECTED";
  action: "PUBLISH_NOTE_NAVIGATION_CLICK";
  preClickRevalidated: boolean;
  navigationClickCount: number;
  finalSubmitCount: 0;
  navigationTransition: boolean;
  sanitizedUrlBefore: string;
  sanitizedUrlAfter: string;
  publishNoteDropdownClickCount: 0 | 1;
  imagePostMenuItemClickCount: 0 | 1;
  uploadVideoMenuItemClickCount: 0;
  failureCode?: PublishNoteNavigationFailureCode;
}

type ElementHandleLike = Pick<ElementHandle<Element>, "click" | "evaluate">;

type EvaluateHandleResult = {
  asElement(): ElementHandleLike | null;
  dispose(): Promise<void>;
};

type EvaluateHandlePage = {
  evaluateHandle?: (pageFunction: (input: HandleLookupInput) => Element | null, arg: HandleLookupInput) => Promise<EvaluateHandleResult>;
};

type HandleLookupInput = { targetIndex: number; ancestorDepth?: number; surfaceId?: string; dropdownTriggerId?: string; menuItemId?: string };

function pageContext(page: Page): object {
  try {
    return page.context() as unknown as object;
  } catch {
    return page;
  }
}

function targetIndex(targetId: string): number | null {
  const match = targetId.match(/-(\d+)$/u);
  if (!match) return null;
  const index = Number.parseInt(match[1]!, 10);
  return Number.isInteger(index) && index >= 0 && index < 20 ? index : null;
}

function lookupExactTarget(input: HandleLookupInput): Element | null {
  const exactTexts = new Set(["发布笔记", "发布图文笔记"]);
  const nodes = Array.from(document.querySelectorAll("*")).filter((element) => {
    const tagName = element.tagName.toUpperCase();
    return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && exactTexts.has((element.textContent ?? "").normalize("NFKC").replace(/[\s]+/gu, " ").trim());
  });
  let current: Element | null = nodes[input.targetIndex] ?? null;
  for (let depth = 0; depth < (input.ancestorDepth ?? 0) && current; depth += 1) current = current.parentElement;
  if (!current || input.surfaceId === undefined) return current;
  const all = Array.from(document.querySelectorAll("*")).slice(0, 2000);
  const identity = `xhs-publish-surface-${Math.max(0, all.indexOf(current))}`;
  return identity === input.surfaceId ? current : null;
}

function lookupPublishNoteDropdownTrigger(input: HandleLookupInput): Element | null {
  const compact = (value: string, limit = 120): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, limit);
  const exactTargets = Array.from(document.querySelectorAll("*")).filter((element) => {
    const tagName = element.tagName.toUpperCase();
    return tagName !== "HTML" && tagName !== "BODY" && tagName !== "SCRIPT" && tagName !== "STYLE" && compact(element.textContent ?? "") === "发布笔记";
  });
  const target = exactTargets[input.targetIndex];
  if (!target || !input.dropdownTriggerId) return null;
  const allElements = Array.from(document.querySelectorAll("*")).slice(0, 2000);
  const trigger = allElements.find((element) => `xhs-publish-dropdown-trigger-${allElements.indexOf(element)}` === input.dropdownTriggerId) ?? null;
  if (!trigger) return null;
  const role = compact(trigger.getAttribute("role") ?? "", 40).toLowerCase();
  const isButtonSemantics = trigger.tagName.toLowerCase() === "button" || role === "button";
  if (!isButtonSemantics) return null;
  const hasPopup = compact(trigger.getAttribute("aria-haspopup") ?? "", 40).toLowerCase();
  const expanded = trigger.getAttribute("aria-expanded");
  const accessibleLabel = compact(`${trigger.getAttribute("aria-label") ?? ""} ${trigger.getAttribute("title") ?? ""}`);
  const hasDropdownSemantics = Boolean(hasPopup && ["true", "menu", "listbox", "tree", "grid", "dialog"].includes(hasPopup)) || expanded !== null || /下拉|更多|发布类型|dropdown|menu/iu.test(accessibleLabel);
  if (!hasDropdownSemantics || trigger === target || trigger.contains(target)) return null;
  let container: Element | null = target.parentElement;
  for (let depth = 1; container && depth <= 8; depth += 1, container = container.parentElement) {
    if (container.contains(trigger)) return trigger;
  }
  return null;
}

function lookupExactImagePostMenuItem(input: HandleLookupInput): Element | null {
  if (!input.menuItemId) return null;
  const allElements = Array.from(document.querySelectorAll("*")).slice(0, 2000);
  const compact = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim().slice(0, 120);
  const interactive = (element: Element): boolean => ["button", "a"].includes(element.tagName.toLowerCase()) || ["button", "menuitem"].includes((element.getAttribute("role") ?? "").trim().toLowerCase());
  const targets = allElements.filter((element) => compact(element.textContent ?? "") === "上传图文");
  for (const target of targets) {
    let action: Element | null = interactive(target) ? target : target.parentElement;
    for (let depth = 1; action && depth <= 8 && !interactive(action); depth += 1) action = action.parentElement;
    if (!action || !interactive(action)) continue;
    const index = allElements.indexOf(action);
    if (`xhs-publish-menu-item-${index}` === input.menuItemId) return action;
  }
  return null;
}

function readSurfaceRuntimeState(surface: unknown, target: unknown): PublishNoteSurfaceRuntimeState {
  const surfaceElement = surface as Element;
  const targetElement = target as Element;
  const surfaceNode = surfaceElement as HTMLElement;
  const targetNode = targetElement as HTMLElement;
  const surfaceStyle = window.getComputedStyle(surfaceNode);
  const targetStyle = window.getComputedStyle(targetNode);
  const surfaceRect = surfaceElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const visible = (element: Element, style: CSSStyleDeclaration, rect: DOMRect): boolean => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  const surfaceVisible = visible(surfaceElement, surfaceStyle, surfaceRect);
  const targetVisible = visible(targetElement, targetStyle, targetRect);
  const geometryValid = Number.isFinite(surfaceRect.x) && Number.isFinite(surfaceRect.y) && surfaceRect.width > 0 && surfaceRect.height > 0 && targetRect.width > 0 && targetRect.height > 0;
  const centerX = surfaceRect.x + surfaceRect.width / 2;
  const centerY = surfaceRect.y + surfaceRect.height / 2;
  const hitElements = geometryValid ? document.elementsFromPoint(centerX, centerY).slice(0, 8) : [];
  const hitTestConsistent = hitElements.some((element) => element === surfaceElement || surfaceElement.contains(element));
  return {
    targetAttached: targetElement.isConnected,
    surfaceAttached: surfaceElement.isConnected,
    exactSemanticText: (targetElement.textContent ?? "").normalize("NFKC").replace(/[\s]+/gu, " ").trim(),
    targetWithinSurface: surfaceElement === targetElement || surfaceElement.contains(targetElement),
    visible: surfaceVisible && targetVisible,
    pointerEventsActive: surfaceStyle.pointerEvents !== "none",
    geometryValid,
    hitTestConsistent
  };
}

function readDropdownTriggerRuntimeState(trigger: unknown, target: unknown): PublishNoteDropdownTriggerRuntimeState {
  const triggerElement = trigger as Element;
  const targetElement = target as Element;
  const node = triggerElement as HTMLElement;
  const style = window.getComputedStyle(node);
  const rect = triggerElement.getBoundingClientRect();
  const visible = !triggerElement.hasAttribute("hidden") && triggerElement.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  const enabled = !triggerElement.hasAttribute("disabled") && triggerElement.getAttribute("aria-disabled") !== "true";
  const geometryValid = Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0;
  const hitElements = geometryValid ? document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 8) : [];
  const hitTestConsistent = hitElements.some((element) => element === triggerElement || triggerElement.contains(element));
  const role = (triggerElement.getAttribute("role") ?? "").trim().toLowerCase();
  const hasPopup = (triggerElement.getAttribute("aria-haspopup") ?? "").trim().toLowerCase();
  const expanded = triggerElement.getAttribute("aria-expanded");
  const accessibleLabel = `${triggerElement.getAttribute("aria-label") ?? ""} ${triggerElement.getAttribute("title") ?? ""}`.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
  const dropdownSemanticsActive = (triggerElement.tagName.toLowerCase() === "button" || role === "button") && (Boolean(hasPopup && ["true", "menu", "listbox", "tree", "grid", "dialog"].includes(hasPopup)) || expanded !== null || /下拉|更多|发布类型|dropdown|menu/iu.test(accessibleLabel));
  let relatedTargetAttached = false;
  let container: Element | null = targetElement.parentElement;
  for (let depth = 1; container && depth <= 8; depth += 1, container = container.parentElement) {
    if (container.contains(triggerElement)) { relatedTargetAttached = true; break; }
  }
  return { triggerAttached: triggerElement.isConnected, relatedTargetAttached: targetElement.isConnected && relatedTargetAttached, visible, enabled, pointerEventsActive: style.pointerEvents !== "none", geometryValid, hitTestConsistent, dropdownSemanticsActive };
}

function readImagePostMenuItemRuntimeState(item: unknown): PublishNoteImageMenuItemRuntimeState {
  const element = item as Element;
  const node = element as HTMLElement;
  const style = window.getComputedStyle(node);
  const rect = element.getBoundingClientRect();
  const visible = !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  const enabled = !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  const geometryValid = Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0;
  const hitElements = geometryValid ? document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 8) : [];
  const hitTestConsistent = hitElements.some((entry) => entry === element || element.contains(entry));
  return { itemAttached: element.isConnected, visible, enabled, pointerEventsActive: style.pointerEvents !== "none", geometryValid, hitTestConsistent, exactText: (element.textContent ?? "").normalize("NFKC").replace(/[\s]+/gu, " ").trim() };
}

function handleFromElement(element: ElementHandleLike, target: ElementHandleLike): PublishNoteNavigationSurfaceHandle {
  const evaluator = element as unknown as {
    evaluate: <Result, Argument>(pageFunction: (current: unknown, argument: Argument) => Result, argument: Argument) => Promise<Result>;
  };
  return {
    click: () => element.click(),
    inspect: () => evaluator.evaluate(readSurfaceRuntimeState, target)
  };
}

function handleFromDropdownTrigger(element: ElementHandleLike, target: ElementHandleLike): PublishNoteDropdownTriggerHandle {
  const evaluator = element as unknown as {
    evaluate: <Result, Argument>(pageFunction: (current: unknown, argument: Argument) => Result, argument: Argument) => Promise<Result>;
  };
  return {
    click: () => element.click(),
    inspect: () => evaluator.evaluate(readDropdownTriggerRuntimeState, target)
  };
}

function handleFromImagePostMenuItem(element: ElementHandleLike): PublishNoteImageMenuItemHandle {
  const evaluator = element as unknown as {
    evaluate: <Result, Argument>(pageFunction: (current: unknown, argument: Argument) => Result, argument?: Argument) => Promise<Result>;
  };
  return {
    click: () => element.click(),
    inspect: () => evaluator.evaluate(readImagePostMenuItemRuntimeState)
  };
}

async function resolveSurfaceHandle(page: Page, targetId: string, surface: NonNullable<XiaohongshuClickableSurfaceResolution["surface"]>): Promise<PublishNoteNavigationSurfaceHandle | null> {
  const index = targetIndex(targetId);
  const candidate = page as unknown as EvaluateHandlePage;
  if (index === null || typeof candidate.evaluateHandle !== "function") return null;
  let targetRemote: EvaluateHandleResult | null = null;
  let surfaceRemote: EvaluateHandleResult | null = null;
  try {
    targetRemote = await candidate.evaluateHandle(lookupExactTarget, { targetIndex: index });
    surfaceRemote = await candidate.evaluateHandle(lookupExactTarget, { targetIndex: index, ancestorDepth: surface.ancestorDepth, surfaceId: surface.surfaceId });
    const targetElement = targetRemote.asElement();
    const surfaceElement = surfaceRemote.asElement();
    if (!targetElement || !surfaceElement) return null;
    return handleFromElement(surfaceElement, targetElement);
  } catch {
    return null;
  } finally {
    if (!targetRemote?.asElement()) await targetRemote?.dispose();
    if (!surfaceRemote?.asElement()) await surfaceRemote?.dispose();
  }
}

async function resolveDropdownTriggerHandle(page: Page, targetId: string, trigger: XiaohongshuPublishDropdownTriggerDiagnostic): Promise<PublishNoteDropdownTriggerHandle | null> {
  const index = targetIndex(targetId);
  const candidate = page as unknown as EvaluateHandlePage;
  if (index === null || typeof candidate.evaluateHandle !== "function") return null;
  let targetRemote: EvaluateHandleResult | null = null;
  let triggerRemote: EvaluateHandleResult | null = null;
  try {
    targetRemote = await candidate.evaluateHandle(lookupExactTarget, { targetIndex: index });
    triggerRemote = await candidate.evaluateHandle(lookupPublishNoteDropdownTrigger, { targetIndex: index, dropdownTriggerId: trigger.triggerId });
    const targetElement = targetRemote.asElement();
    const triggerElement = triggerRemote.asElement();
    if (!targetElement || !triggerElement) return null;
    return handleFromDropdownTrigger(triggerElement, targetElement);
  } catch {
    return null;
  } finally {
    if (!targetRemote?.asElement()) await targetRemote?.dispose();
    if (!triggerRemote?.asElement()) await triggerRemote?.dispose();
  }
}

async function resolveImagePostMenuItemHandle(page: Page, item: XiaohongshuImagePostMenuItemDiagnostic): Promise<PublishNoteImageMenuItemHandle | null> {
  const candidate = page as unknown as EvaluateHandlePage;
  if (typeof candidate.evaluateHandle !== "function") return null;
  let remote: EvaluateHandleResult | null = null;
  try {
    remote = await candidate.evaluateHandle(lookupExactImagePostMenuItem, { targetIndex: 0, menuItemId: item.itemId });
    const element = remote.asElement();
    return element ? handleFromImagePostMenuItem(element) : null;
  } catch {
    return null;
  } finally {
    if (!remote?.asElement()) await remote?.dispose();
  }
}

async function findImagePostMenuItemHandle(page: Page): Promise<PublishNoteImageMenuItemHandle | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const items = await collectExactImagePostMenuItems(page);
    const result = resolveExactImagePostMenuItem({ items });
    if (result.status === "PROVEN_UNIQUE" && result.item) return resolveImagePostMenuItemHandle(page, result.item);
    if (result.status === "AMBIGUOUS") return null;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function navigationEvidence(diagnostics: XiaohongshuClickableSurfaceDiagnostics, target: XiaohongshuExactPublishSemanticTarget | null, surface: NonNullable<XiaohongshuClickableSurfaceResolution["surface"]> | null): PublishNoteNavigationEvidence {
  const ancestor = target && surface ? diagnostics.ancestorChainDiagnostics.find((entry) => entry.targetId === target.targetId && entry.surfaceId === surface.surfaceId && entry.depth === surface.ancestorDepth) : undefined;
  const hitTest = target ? diagnostics.hitTestDiagnostics.find((entry) => entry.targetId === target.targetId) : undefined;
  const eventListenerSignal = surface?.strongSignals.find((signal) => signal.startsWith("event:")) ?? null;
  return {
    exactSemanticText: target?.exactText ?? XIAOHONGSHU_PUBLISH_NOTE_TEXT,
    visible: Boolean(target?.visible && ancestor?.visible),
    pointerEventsActive: Boolean(ancestor && ancestor.pointerEvents !== "none"),
    geometryValid: Boolean(target?.boundingBox && surface?.boundingBox && ancestor?.boundingBox),
    hitTestConsistent: Boolean(hitTest?.center && surface && hitTest.elements.some((entry) => entry.surfaceId === surface.surfaceId && entry.ancestorRelation !== "UNRELATED")),
    uniqueSurface: diagnostics.publishNoteSurface.status === "PROVEN_UNIQUE",
    strongClickabilitySignal: Boolean(surface && surface.strongSignals.length > 0),
    eventListenerSignal
  };
}

/** Resolves a live ElementHandle from the current proof lifecycle; it never hardcodes a surface id. */
export async function resolvePublishNoteNavigationSurface(page: Page, input: Omit<PublishNoteNavigationLifecycle, "page" | "context"> & { context?: object } = { operationId: "unknown-operation", platformKey: "xiaohongshu", accountId: "unknown-account", contextDebugId: "unknown-context", pageDebugId: "unknown-page", authState: "AUTHENTICATED" }): Promise<PublishNoteNavigationSurfaceResolution> {
  const lifecycle: PublishNoteNavigationLifecycle = { ...input, page, context: input.context ?? pageContext(page) };
  const diagnostics = await collectPublishClickableSurfaceDiagnostics(page);
  const proof = diagnostics.publishNoteSurface;
  const dropdownProof: XiaohongshuPublishDropdownTriggerResolution = diagnostics.publishNoteDropdownTrigger;
  const target = diagnostics.exactPublishSemanticTargets.find((entry) => entry.targetId === proof.surface?.targetId && entry.exactText === XIAOHONGSHU_PUBLISH_NOTE_TEXT) ?? diagnostics.exactPublishSemanticTargets.find((entry) => entry.exactText === XIAOHONGSHU_PUBLISH_NOTE_TEXT) ?? null;
  const evidence = navigationEvidence(diagnostics, target, proof.surface);
  if (proof.status !== "PROVEN_UNIQUE" || !proof.surface || !target) {
    return { status: proof.status, target, surface: proof.surface, evidence, diagnostics, dropdownTrigger: dropdownProof.trigger, ...(proof.failureCode ? { failureCode: proof.failureCode } : {}), surfaceHandle: null, dropdownTriggerHandle: null, lifecycle };
  }
  if (dropdownProof.status !== "PROVEN_UNIQUE" || !dropdownProof.trigger) {
    return { status: "NO_CLICK_SURFACE_FOUND", target, surface: proof.surface, evidence: { ...evidence, uniqueSurface: false }, diagnostics, dropdownTrigger: dropdownProof.trigger, failureCode: "PUBLISH_CLICK_SURFACE_NOT_FOUND", surfaceHandle: null, dropdownTriggerHandle: null, lifecycle };
  }
  const surfaceHandle = await resolveSurfaceHandle(page, target.targetId, proof.surface);
  if (!surfaceHandle) {
    return { status: "NO_CLICK_SURFACE_FOUND", target, surface: proof.surface, evidence: { ...evidence, uniqueSurface: false }, diagnostics, dropdownTrigger: dropdownProof.trigger, failureCode: "PUBLISH_SURFACE_DOM_CHANGED_BEFORE_CLICK", surfaceHandle: null, dropdownTriggerHandle: null, lifecycle };
  }
  const dropdownTriggerHandle = await resolveDropdownTriggerHandle(page, target.targetId, dropdownProof.trigger);
  if (!dropdownTriggerHandle) {
    return { status: "NO_CLICK_SURFACE_FOUND", target, surface: proof.surface, evidence: { ...evidence, uniqueSurface: false }, diagnostics, dropdownTrigger: dropdownProof.trigger, failureCode: "PUBLISH_CLICK_SURFACE_NOT_FOUND", surfaceHandle: null, dropdownTriggerHandle: null, lifecycle };
  }
  return { status: proof.status, target, surface: proof.surface, evidence, diagnostics, dropdownTrigger: dropdownProof.trigger, surfaceHandle, dropdownTriggerHandle, lifecycle };
}

export async function revalidatePublishNoteNavigationSurface(resolution: PublishNoteNavigationSurfaceResolution, current: PublishNoteNavigationLifecycle): Promise<PublishNoteNavigationRevalidation> {
  const captured = resolution.lifecycle;
  if (current.page !== captured.page) return { revalidated: false, failureCode: "PUBLISH_SURFACE_PAGE_IDENTITY_CHANGED" };
  if (current.context !== captured.context) return { revalidated: false, failureCode: "PUBLISH_SURFACE_CONTEXT_IDENTITY_CHANGED" };
  if (current.operationId !== captured.operationId) return { revalidated: false, failureCode: "PUBLISH_SURFACE_OPERATION_ID_CHANGED" };
  if (current.authState !== captured.authState) return { revalidated: false, failureCode: "PUBLISH_SURFACE_AUTH_STATE_CHANGED" };
  if (resolution.status !== "PROVEN_UNIQUE" || !resolution.surfaceHandle || !resolution.target || !resolution.surface) return { revalidated: false, failureCode: resolution.failureCode ?? "PUBLISH_CLICK_SURFACE_NOT_FOUND" };
  if (resolution.dropdownTriggerHandle) {
    let triggerState: PublishNoteDropdownTriggerRuntimeState;
    try {
      triggerState = await resolution.dropdownTriggerHandle.inspect();
    } catch {
      return { revalidated: false, failureCode: "PUBLISH_SURFACE_REVALIDATION_FAILED" };
    }
    if (!triggerState.triggerAttached || !triggerState.relatedTargetAttached) return { revalidated: false, failureCode: "PUBLISH_SURFACE_DETACHED", runtimeState: { targetAttached: triggerState.relatedTargetAttached, surfaceAttached: triggerState.triggerAttached, exactSemanticText: XIAOHONGSHU_PUBLISH_NOTE_TEXT, targetWithinSurface: triggerState.relatedTargetAttached, visible: triggerState.visible, pointerEventsActive: triggerState.pointerEventsActive, geometryValid: triggerState.geometryValid, hitTestConsistent: triggerState.hitTestConsistent } };
    if (!triggerState.visible || !triggerState.enabled) return { revalidated: false, failureCode: "PUBLISH_CLICK_SURFACE_NOT_VISIBLE", runtimeState: { targetAttached: triggerState.relatedTargetAttached, surfaceAttached: triggerState.triggerAttached, exactSemanticText: XIAOHONGSHU_PUBLISH_NOTE_TEXT, targetWithinSurface: triggerState.relatedTargetAttached, visible: triggerState.visible, pointerEventsActive: triggerState.pointerEventsActive, geometryValid: triggerState.geometryValid, hitTestConsistent: triggerState.hitTestConsistent } };
    if (!triggerState.pointerEventsActive) return { revalidated: false, failureCode: "PUBLISH_SURFACE_POINTER_EVENTS_NONE" };
    if (!triggerState.geometryValid) return { revalidated: false, failureCode: "PUBLISH_SURFACE_GEOMETRY_INVALID" };
    if (!triggerState.hitTestConsistent || !triggerState.dropdownSemanticsActive) return { revalidated: false, failureCode: "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED" };
    return { revalidated: true };
  }
  let state: PublishNoteSurfaceRuntimeState;
  try {
    state = await resolution.surfaceHandle.inspect();
  } catch {
    return { revalidated: false, failureCode: "PUBLISH_SURFACE_REVALIDATION_FAILED" };
  }
  if (!state.targetAttached || !state.surfaceAttached) return { revalidated: false, failureCode: "PUBLISH_SURFACE_DETACHED", runtimeState: state };
  if (state.exactSemanticText !== XIAOHONGSHU_PUBLISH_NOTE_TEXT || !state.targetWithinSurface) return { revalidated: false, failureCode: "PUBLISH_SURFACE_DOM_CHANGED_BEFORE_CLICK", runtimeState: state };
  if (!state.visible) return { revalidated: false, failureCode: "PUBLISH_CLICK_SURFACE_NOT_VISIBLE", runtimeState: state };
  if (!state.pointerEventsActive) return { revalidated: false, failureCode: "PUBLISH_SURFACE_POINTER_EVENTS_NONE", runtimeState: state };
  if (!state.geometryValid) return { revalidated: false, failureCode: "PUBLISH_SURFACE_GEOMETRY_INVALID", runtimeState: state };
  if (!state.hitTestConsistent) return { revalidated: false, failureCode: "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED", runtimeState: state };
  if (!resolution.evidence.strongClickabilitySignal || !resolution.evidence.uniqueSurface) return { revalidated: false, failureCode: "PUBLISH_CLICK_SURFACE_NOT_FOUND", runtimeState: state };
  return { revalidated: true, runtimeState: state };
}

export async function clickPublishNoteNavigationSurface(input: {
  resolution: PublishNoteNavigationSurfaceResolution;
  current: PublishNoteNavigationLifecycle;
  navigationClickCount: number;
  sanitizedUrlBefore: string;
  readSanitizedUrl: () => string;
  waitForTransition?: () => Promise<void>;
  preClickRevalidation?: PublishNoteNavigationRevalidation;
}): Promise<PublishNoteNavigationClickResult> {
  const rejected = (failureCode: PublishNoteNavigationFailureCode, count = input.navigationClickCount, preClickRevalidated = false, after = input.sanitizedUrlBefore, publishNoteDropdownClickCount: 0 | 1 = 0, imagePostMenuItemClickCount: 0 | 1 = 0): PublishNoteNavigationClickResult => ({ status: "NAVIGATION_CLICK_REJECTED", action: "PUBLISH_NOTE_NAVIGATION_CLICK", preClickRevalidated, navigationClickCount: count, finalSubmitCount: 0, navigationTransition: false, sanitizedUrlBefore: input.sanitizedUrlBefore, sanitizedUrlAfter: after, publishNoteDropdownClickCount, imagePostMenuItemClickCount, uploadVideoMenuItemClickCount: 0, failureCode });
  if (input.navigationClickCount >= 1) return rejected("PUBLISH_NAVIGATION_CLICK_ALREADY_USED");
  const revalidation = input.preClickRevalidation ?? await revalidatePublishNoteNavigationSurface(input.resolution, input.current);
  if (!revalidation.revalidated) return rejected(revalidation.failureCode ?? "PUBLISH_SURFACE_REVALIDATION_FAILED", input.navigationClickCount, false);
  let imagePostMenuItemHandle: PublishNoteImageMenuItemHandle | null = null;
  try {
    await (input.resolution.dropdownTriggerHandle ?? input.resolution.surfaceHandle)!.click();
  } catch {
    return rejected("PUBLISH_ENTRY_CLICK_FAILED", 1, true, input.readSanitizedUrl(), input.resolution.dropdownTriggerHandle ? 1 : 0);
  }
  if (input.resolution.dropdownTriggerHandle) {
    imagePostMenuItemHandle = input.resolution.imagePostMenuItemHandle ?? await findImagePostMenuItemHandle(input.resolution.lifecycle.page as Page);
    if (!imagePostMenuItemHandle) return rejected("PUBLISH_CLICK_SURFACE_NOT_FOUND", 1, true, input.readSanitizedUrl(), 1);
    let menuItemState: PublishNoteImageMenuItemRuntimeState;
    try {
      menuItemState = await imagePostMenuItemHandle.inspect();
    } catch {
      return rejected("PUBLISH_SURFACE_REVALIDATION_FAILED", 1, true, input.readSanitizedUrl(), 1);
    }
    if (!menuItemState.itemAttached || !menuItemState.visible || !menuItemState.enabled || !menuItemState.pointerEventsActive || !menuItemState.geometryValid || !menuItemState.hitTestConsistent || menuItemState.exactText !== "上传图文") return rejected("PUBLISH_CLICK_SURFACE_NOT_FOUND", 1, true, input.readSanitizedUrl(), 1);
    try {
      await imagePostMenuItemHandle.click();
    } catch {
      return rejected("PUBLISH_ENTRY_CLICK_FAILED", 1, true, input.readSanitizedUrl(), 1, 1);
    }
  }
  try {
    await input.waitForTransition?.();
  } catch {
    return rejected("PUBLISH_ENTRY_CLICK_FAILED", 1, true, input.readSanitizedUrl(), input.resolution.dropdownTriggerHandle ? 1 : 0, input.resolution.dropdownTriggerHandle ? 1 : 0);
  }
  let after: string;
  try {
    after = input.readSanitizedUrl();
  } catch {
    return rejected("PUBLISH_ENTRY_CLICK_FAILED", 1, true, input.sanitizedUrlBefore, input.resolution.dropdownTriggerHandle ? 1 : 0, input.resolution.dropdownTriggerHandle ? 1 : 0);
  }
  const transition = after !== input.sanitizedUrlBefore;
  return {
    status: transition ? "NAVIGATION_CLICK_COMPLETED" : "NAVIGATION_CLICK_REJECTED",
    action: "PUBLISH_NOTE_NAVIGATION_CLICK",
    preClickRevalidated: true,
    navigationClickCount: 1,
    finalSubmitCount: 0,
    navigationTransition: transition,
    sanitizedUrlBefore: input.sanitizedUrlBefore,
    sanitizedUrlAfter: after,
    publishNoteDropdownClickCount: input.resolution.dropdownTriggerHandle ? 1 : 0,
    imagePostMenuItemClickCount: input.resolution.dropdownTriggerHandle ? 1 : 0,
    uploadVideoMenuItemClickCount: 0,
    ...(transition ? {} : { failureCode: "PUBLISH_ENTRY_CLICK_NO_TRANSITION" as const })
  };
}

export function classifyPublishNotePostClickState(input: { url: string; bodyText: string; loginPagePresent?: boolean; securityVerificationPresent?: boolean }): PublishNotePostClickState {
  if (input.securityVerificationPresent || /\/captcha(?:[/?#]|$)|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(input.url)) return "SECURITY_VERIFICATION";
  if (input.loginPagePresent || /\/(?:login|signin|auth|passport)(?:[/?#]|$)/iu.test(input.url)) return "LOGIN";
  if (/\/publish\/publish(?:[/?#]|$)/iu.test(input.url)) {
    try {
      if (new URL(input.url).searchParams.get("target")?.toLowerCase() === "video") return "VIDEO_EDITOR";
    } catch {
      // The route regex above still provides the bounded fallback classification.
    }
    return "IMAGE_EDITOR";
  }
  if (/发布图文笔记[\s\S]{0,160}发布视频笔记|发布视频笔记[\s\S]{0,160}发布图文笔记/u.test(input.bodyText)) return "IMAGE_POST_SELECTION_PAGE";
  if (/^https:\/\/creator\.xiaohongshu\.com\/(?:new\/home)?(?:[?#].*)?$/iu.test(input.url)) return "CREATOR_HOME";
  return "UNKNOWN";
}
