import type { Page } from "playwright-core";
import type { OneShotFinalSubmitPreflight, OneShotPublicationGuard } from "@publisher/adapters-core";
import type { Task10sFinalSurfaceResolution } from "./task10s-final-surface";

const XHS_PUBLISH_HOST = "XHS-PUBLISH-BTN" as const;
const XHS_PUBLISH_LABEL = "发布" as const;
const XHS_DRAFT_LABEL = "暂存离开" as const;
const MAX_SAFE_STRING_LENGTH = 120;
const MAX_CDP_TREE_NODES = 30_000;

export interface Task10sClosedShadowBoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Task10sClosedShadowHostSafe {
  tagName: typeof XHS_PUBLISH_HOST;
  isPublish: string | null;
  isSaveDraft: string | null;
  submitText: string | null;
  saveText: string | null;
  submitDisabled: string | null;
  submitLoading: string | null;
  connected: boolean;
  rendered: boolean;
  display: string;
  visibility: string;
  pointerEvents: string;
  boundingRect: Task10sClosedShadowBoundingRect | null;
}

export interface Task10sClosedShadowInnerButtonSafe {
  tagName: "BUTTON";
  type: string | null;
  classNameSafe: string;
  exactText: typeof XHS_PUBLISH_LABEL;
  ariaDisabled: string | null;
  ariaBusy: string | null;
  connected: boolean;
  rendered: boolean;
  display: string;
  visibility: string;
  pointerEvents: string;
  boundingRect: Task10sClosedShadowBoundingRect | null;
}

export interface Task10sClosedShadowHostSnapshot {
  host: Task10sClosedShadowHostSafe;
  innerPublishButtons: readonly Task10sClosedShadowInnerButtonSafe[];
  innerButtonMatchCount: number;
}

export interface Task10sClosedShadowDomSnapshot {
  inspectionStatus: "PASS" | "FAIL";
  failureCode: string | null;
  hostMatchCount: number;
  hosts: readonly Task10sClosedShadowHostSnapshot[];
}

export interface Task10sClosedShadowPublishSurfaceResolution extends Task10sFinalSurfaceResolution {
  host: Task10sClosedShadowHostSafe | null;
  innerButton: Task10sClosedShadowInnerButtonSafe | null;
  hostMatchCount: number;
  innerButtonMatchCount: number;
}

export interface Task10sClosedShadowPublishClickResult {
  status: "CLICK_DISPATCHED" | Task10sFinalSurfaceResolution["status"] | "FAILED";
  resolution: Task10sClosedShadowPublishSurfaceResolution;
  mousePressedCount: 0 | 1;
  mouseReleasedCount: 0 | 1;
  failureCode: string | null;
}

export interface Task10sClosedShadowPublishClickOptions {
  /** Invoked after fresh DOM resolution, scroll, and box-model validation,
   * immediately before the single CDP mousePressed dispatch. */
  beforeMousePress?: () => Promise<void>;
}

interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach?: () => Promise<void>;
}

interface CdpNode {
  nodeId: number;
  nodeName: string;
  nodeValue?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
}

interface InternalCandidate {
  host: Task10sClosedShadowHostSafe;
  innerButton: Task10sClosedShadowInnerButtonSafe;
  hostNodeId: number;
  innerButtonNodeId: number;
}

interface CdpTreeInspection {
  snapshot: Task10sClosedShadowDomSnapshot;
  candidate: InternalCandidate | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
  return normalized.length > MAX_SAFE_STRING_LENGTH ? normalized.slice(0, MAX_SAFE_STRING_LENGTH) : normalized;
}

function attributes(node: CdpNode): Map<string, string> {
  const values = new Map<string, string>();
  const raw = node.attributes ?? [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index];
    const value = raw[index + 1];
    if (name && value !== undefined) values.set(name.toLowerCase(), value);
  }
  return values;
}

function normalizedText(node: CdpNode, budget: { remaining: number }): string {
  if (budget.remaining <= 0) return "";
  budget.remaining -= 1;
  if (node.nodeName === "#text") return node.nodeValue ?? "";
  return [...(node.children ?? [])].map((child) => normalizedText(child, budget)).join("");
}

function exactText(node: CdpNode): string {
  return safeString(normalizedText(node, { remaining: 80 })) ?? "";
}

function rectFromQuad(quad: unknown): Task10sClosedShadowBoundingRect | null {
  if (!Array.isArray(quad) || quad.length < 8) return null;
  const values = quad.slice(0, 8).map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
  if (values.some((value) => value === null)) return null;
  const numbers = values as number[];
  const xs = [numbers[0], numbers[2], numbers[4], numbers[6]];
  const ys = [numbers[1], numbers[3], numbers[5], numbers[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function nodeFromGetDocument(value: unknown): CdpNode | null {
  const root = recordValue(value)?.root;
  if (!isRecord(root) || typeof root.nodeId !== "number" || typeof root.nodeName !== "string") return null;
  return root as unknown as CdpNode;
}

function styleMap(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  const styles = recordValue(value)?.computedStyle;
  if (!Array.isArray(styles)) return result;
  for (const item of styles) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.value !== "string") continue;
    result.set(item.name, item.value);
  }
  return result;
}

async function computedStyle(session: CdpSessionLike, nodeId: number): Promise<Map<string, string>> {
  try {
    return styleMap(await session.send("CSS.getComputedStyleForNode", { nodeId }));
  } catch {
    return new Map();
  }
}

async function boxModelRect(session: CdpSessionLike, nodeId: number): Promise<Task10sClosedShadowBoundingRect | null> {
  try {
    const payload = recordValue(await session.send("DOM.getBoxModel", { nodeId }));
    const model = recordValue(payload?.model);
    return rectFromQuad(model?.border ?? model?.content);
  } catch {
    return null;
  }
}

function rendered(rect: Task10sClosedShadowBoundingRect | null, display: string, visibility: string): boolean {
  return rect !== null && rect.width > 0 && rect.height > 0 && display !== "none" && visibility !== "hidden" && visibility !== "collapse";
}

async function safeHost(session: CdpSessionLike, node: CdpNode): Promise<Task10sClosedShadowHostSafe> {
  const attrs = attributes(node);
  const rect = await boxModelRect(session, node.nodeId);
  const styles = await computedStyle(session, node.nodeId);
  const display = styles.get("display") ?? "unknown";
  const visibility = styles.get("visibility") ?? "unknown";
  return {
    tagName: XHS_PUBLISH_HOST,
    isPublish: safeString(attrs.get("is-publish")),
    isSaveDraft: safeString(attrs.get("is-save-draft")),
    submitText: safeString(attrs.get("submit-text")),
    saveText: safeString(attrs.get("save-text")),
    submitDisabled: safeString(attrs.get("submit-disabled")),
    submitLoading: safeString(attrs.get("submit-loading")),
    connected: true,
    rendered: rendered(rect, display, visibility),
    display,
    visibility,
    pointerEvents: styles.get("pointer-events") ?? "unknown",
    boundingRect: rect
  };
}

async function safeInnerButton(session: CdpSessionLike, node: CdpNode): Promise<Task10sClosedShadowInnerButtonSafe> {
  const attrs = attributes(node);
  const rect = await boxModelRect(session, node.nodeId);
  const styles = await computedStyle(session, node.nodeId);
  const display = styles.get("display") ?? "unknown";
  const visibility = styles.get("visibility") ?? "unknown";
  return {
    tagName: "BUTTON",
    type: safeString(attrs.get("type")),
    classNameSafe: safeString(attrs.get("class")) ?? "",
    exactText: XHS_PUBLISH_LABEL,
    ariaDisabled: safeString(attrs.get("aria-disabled")),
    ariaBusy: safeString(attrs.get("aria-busy")),
    connected: true,
    rendered: rendered(rect, display, visibility),
    display,
    visibility,
    pointerEvents: styles.get("pointer-events") ?? "unknown",
    boundingRect: rect
  };
}

function walk(node: CdpNode, visitor: (node: CdpNode) => void, budget: { remaining: number }): void {
  if (budget.remaining <= 0) return;
  budget.remaining -= 1;
  visitor(node);
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(child, visitor, budget);
}

function descendantsOfShadowRoots(host: CdpNode): CdpNode[] {
  const result: CdpNode[] = [];
  const budget = { remaining: MAX_CDP_TREE_NODES };
  for (const root of host.shadowRoots ?? []) walk(root, (node) => result.push(node), budget);
  return result;
}

function safeFixedHost(host: Task10sClosedShadowHostSafe): boolean {
  return host.tagName === XHS_PUBLISH_HOST
    && host.isPublish === "true"
    && host.isSaveDraft === "true"
    && host.submitText === XHS_PUBLISH_LABEL
    && host.saveText === XHS_DRAFT_LABEL
    && host.submitDisabled !== null
    && host.submitLoading !== null;
}

function disabled(host: Task10sClosedShadowHostSafe, button: Task10sClosedShadowInnerButtonSafe): boolean {
  return host.submitDisabled?.toLowerCase() !== "false"
    || host.submitLoading?.toLowerCase() !== "false"
    || button.ariaDisabled?.toLowerCase() !== "false"
    || button.ariaBusy?.toLowerCase() !== "false"
    || button.pointerEvents.toLowerCase() === "none";
}

function resultBase(overrides: Partial<Task10sClosedShadowPublishSurfaceResolution> = {}): Task10sClosedShadowPublishSurfaceResolution {
  return {
    status: "NOT_FOUND",
    present: false,
    enabled: false,
    currentState: "NOT_PRESENT",
    candidate: null,
    failureCode: null,
    host: null,
    innerButton: null,
    hostMatchCount: 0,
    innerButtonMatchCount: 0,
    ...overrides
  };
}

export function resolveTask10sClosedShadowPublishSurface(snapshot: Task10sClosedShadowDomSnapshot): Task10sClosedShadowPublishSurfaceResolution {
  if (snapshot.inspectionStatus !== "PASS") return resultBase({ status: "NOT_FOUND", failureCode: snapshot.failureCode ?? "CLOSED_SHADOW_DIAGNOSTIC_FAILED" });
  if (snapshot.hostMatchCount === 0) return resultBase({ failureCode: "PUBLISH_HOST_NOT_FOUND" });
  if (snapshot.hostMatchCount !== 1 || snapshot.hosts.length !== 1) return resultBase({ status: "AMBIGUOUS", failureCode: "PUBLISH_HOST_NOT_UNIQUE", hostMatchCount: snapshot.hostMatchCount });
  const hostEntry = snapshot.hosts[0];
  if (!hostEntry) return resultBase({ failureCode: "PUBLISH_HOST_NOT_FOUND" });
  if (!safeFixedHost(hostEntry.host)) return resultBase({ failureCode: "PUBLISH_HOST_CONTRACT_INVALID", hostMatchCount: snapshot.hostMatchCount });
  if (hostEntry.innerButtonMatchCount === 0) return resultBase({ failureCode: "INNER_PUBLISH_BUTTON_NOT_FOUND", host: hostEntry.host, hostMatchCount: snapshot.hostMatchCount });
  if (hostEntry.innerButtonMatchCount !== 1 || hostEntry.innerPublishButtons.length !== 1) return resultBase({ status: "AMBIGUOUS", failureCode: "INNER_PUBLISH_BUTTON_NOT_UNIQUE", host: hostEntry.host, hostMatchCount: snapshot.hostMatchCount, innerButtonMatchCount: hostEntry.innerButtonMatchCount });
  const innerButton = hostEntry.innerPublishButtons[0];
  if (!innerButton) return resultBase({ failureCode: "INNER_PUBLISH_BUTTON_NOT_FOUND", host: hostEntry.host, hostMatchCount: snapshot.hostMatchCount });
  const base = { host: hostEntry.host, innerButton, hostMatchCount: snapshot.hostMatchCount, innerButtonMatchCount: hostEntry.innerButtonMatchCount };
  if (!hostEntry.host.connected || !hostEntry.host.rendered || !innerButton.connected || !innerButton.rendered) return resultBase({ status: "NOT_VISIBLE", failureCode: "CLOSED_SHADOW_PUBLISH_SURFACE_NOT_RENDERED", ...base });
  if (disabled(hostEntry.host, innerButton)) return resultBase({ status: "DISABLED", present: true, currentState: "PRESENT_DISABLED", failureCode: "CLOSED_SHADOW_PUBLISH_SURFACE_DISABLED", ...base });
  return resultBase({ status: "FOUND_UNIQUE", present: true, enabled: true, currentState: "PRESENT_ENABLED", ...base });
}

async function cdpSessionForPage(page: Page): Promise<CdpSessionLike> {
  const context = page.context() as unknown as { newCDPSession?: (targetPage: Page) => Promise<CdpSessionLike> };
  if (typeof context.newCDPSession !== "function") throw new Error("TASK10S_CDP_SESSION_UNAVAILABLE");
  return context.newCDPSession(page);
}

async function inspectWithSession(session: CdpSessionLike): Promise<CdpTreeInspection> {
  await session.send("DOM.enable");
  await session.send("CSS.enable").catch(() => undefined);
  const root = nodeFromGetDocument(await session.send("DOM.getDocument", { depth: -1, pierce: true }));
  if (!root) return { snapshot: { inspectionStatus: "FAIL", failureCode: "CDP_DOM_DOCUMENT_UNAVAILABLE", hostMatchCount: 0, hosts: [] }, candidate: null };
  const hostNodes: CdpNode[] = [];
  const budget = { remaining: MAX_CDP_TREE_NODES };
  walk(root, (node) => { if (node.nodeName.toUpperCase() === XHS_PUBLISH_HOST) hostNodes.push(node); }, budget);
  if (budget.remaining <= 0) return { snapshot: { inspectionStatus: "FAIL", failureCode: "CDP_DOM_TREE_TRUNCATED", hostMatchCount: hostNodes.length, hosts: [] }, candidate: null };
  const hosts: Task10sClosedShadowHostSnapshot[] = [];
  let candidate: InternalCandidate | null = null;
  for (const hostNode of hostNodes) {
    const hostSafe = await safeHost(session, hostNode);
    const exactButtons = descendantsOfShadowRoots(hostNode).filter((node) => node.nodeName.toUpperCase() === "BUTTON" && exactText(node) === XHS_PUBLISH_LABEL);
    const safeButtons = await Promise.all(exactButtons.map((node) => safeInnerButton(session, node)));
    hosts.push({ host: hostSafe, innerPublishButtons: safeButtons, innerButtonMatchCount: exactButtons.length });
    if (hostNodes.length === 1 && exactButtons.length === 1 && safeButtons[0]) candidate = { host: hostSafe, innerButton: safeButtons[0], hostNodeId: hostNode.nodeId, innerButtonNodeId: exactButtons[0]!.nodeId };
  }
  return { snapshot: { inspectionStatus: "PASS", failureCode: null, hostMatchCount: hostNodes.length, hosts }, candidate };
}

export async function inspectTask10sClosedShadowPublishSurface(page: Page): Promise<Task10sClosedShadowPublishSurfaceResolution> {
  let session: CdpSessionLike | null = null;
  try {
    session = await cdpSessionForPage(page);
    const inspection = await inspectWithSession(session);
    return resolveTask10sClosedShadowPublishSurface(inspection.snapshot);
  } catch (error) {
    return resultBase({ failureCode: error instanceof Error ? error.message : "TASK10S_CLOSED_SHADOW_DIAGNOSTIC_FAILED" });
  } finally {
    await session?.detach?.().catch(() => undefined);
  }
}

function center(rect: Task10sClosedShadowBoundingRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export async function clickTask10sClosedShadowPublishSurface(page: Page, options: Task10sClosedShadowPublishClickOptions = {}): Promise<Task10sClosedShadowPublishClickResult> {
  let session: CdpSessionLike | null = null;
  let pressed = false;
  try {
    session = await cdpSessionForPage(page);
    const inspection = await inspectWithSession(session);
    const resolution = resolveTask10sClosedShadowPublishSurface(inspection.snapshot);
    if (!resolution.present || !resolution.enabled || !inspection.candidate) return { status: resolution.status, resolution, mousePressedCount: 0, mouseReleasedCount: 0, failureCode: resolution.failureCode };
    await session.send("DOM.scrollIntoViewIfNeeded", { nodeId: inspection.candidate.innerButtonNodeId });
    const box = await boxModelRect(session, inspection.candidate.innerButtonNodeId);
    if (!box || box.width <= 0 || box.height <= 0) {
      const notVisible = { ...resolution, status: "NOT_VISIBLE" as const, present: false, enabled: false, currentState: "NOT_PRESENT" as const, failureCode: "CLOSED_SHADOW_PUBLISH_BUTTON_BOX_UNAVAILABLE" };
      return { status: "NOT_VISIBLE", resolution: notVisible, mousePressedCount: 0, mouseReleasedCount: 0, failureCode: notVisible.failureCode };
    }
    const point = center(box);
    await options.beforeMousePress?.();
    await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    pressed = true;
    await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    return { status: "CLICK_DISPATCHED", resolution, mousePressedCount: 1, mouseReleasedCount: 1, failureCode: null };
  } catch (error) {
    if (pressed) throw error;
    const failure = resultBase({ failureCode: error instanceof Error ? error.message : "TASK10S_CLOSED_SHADOW_CLICK_FAILED" });
    return { status: "FAILED", resolution: failure, mousePressedCount: 0, mouseReleasedCount: 0, failureCode: failure.failureCode };
  } finally {
    await session?.detach?.().catch(() => undefined);
  }
}

/**
 * Runs the retained-editor final-submit action with one explicit owner for the
 * durable mouse boundary. The guard is deliberately deferred until this
 * helper has resolved a fresh closed-shadow node and box model; once the
 * boundary is persisted, the click helper's next operation is mousePressed.
 */
export async function runTask10sClosedShadowFinalSubmit(
  page: Page,
  guard: OneShotPublicationGuard,
  preflight: OneShotFinalSubmitPreflight,
  markSubmissionSideEffect?: () => void
): Promise<Task10sClosedShadowPublishClickResult> {
  return guard.startFinalSubmit(preflight, async () => clickTask10sClosedShadowPublishSurface(page, {
    beforeMousePress: async () => {
      markSubmissionSideEffect?.();
      await guard.beginFinalMousePress();
    }
  }), { deferDispatchLock: true });
}
