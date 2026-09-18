import type {
  XiaohongshuGlobalExactPublishAncestorSafe,
  XiaohongshuGlobalExactPublishDomSnapshot,
  XiaohongshuGlobalExactPublishDomRuntimeDiagnostic,
  XiaohongshuGlobalExactPublishNodeSafe
} from "./global-exact-publish-diagnostic";

export type Task10sFinalSurfaceResolutionStatus =
  | "FOUND_UNIQUE"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "NOT_VISIBLE"
  | "NO_CLICKABLE_SURFACE"
  | "DISABLED";

export type Task10sFinalSurfaceState = "NOT_PRESENT" | "PRESENT_ENABLED" | "PRESENT_DISABLED";

export type Task10sFinalSurfaceCandidate = XiaohongshuGlobalExactPublishNodeSafe | XiaohongshuGlobalExactPublishAncestorSafe;

export interface Task10sFinalSurfaceResolution {
  status: Task10sFinalSurfaceResolutionStatus;
  present: boolean;
  enabled: boolean;
  currentState: Task10sFinalSurfaceState;
  candidate: Task10sFinalSurfaceCandidate | null;
  failureCode: string | null;
}

export type Task10sFinalSurfaceDiagnostic = XiaohongshuGlobalExactPublishDomSnapshot | XiaohongshuGlobalExactPublishDomRuntimeDiagnostic;

function renderedNode(node: XiaohongshuGlobalExactPublishNodeSafe): boolean {
  const rect = node.boundingRect;
  return node.connected
    && node.rendered
    && node.display !== "none"
    && node.visibility !== "hidden"
    && node.visibility !== "collapse"
    && rect !== null
    && rect.width > 0
    && rect.height > 0;
}

function renderedSurface(node: Task10sFinalSurfaceCandidate): boolean {
  const rect = node.boundingRect;
  return node.connected
    && node.display !== "none"
    && node.visibility !== "hidden"
    && node.visibility !== "collapse"
    && rect !== null
    && rect.width > 0
    && rect.height > 0;
}

function pointerEventsActive(node: Task10sFinalSurfaceCandidate): boolean {
  return node.pointerEvents.trim().toLowerCase() !== "none"
    && node.clickableSignals.includes("POINTER_EVENTS_ACTIVE");
}

function isBoundedClickableSurface(node: Task10sFinalSurfaceCandidate): boolean {
  if (!pointerEventsActive(node)) return false;
  const signals = new Set(node.clickableSignals);
  if (signals.has("NATIVE_BUTTON") || signals.has("ROLE_BUTTON") || signals.has("TABINDEX_INTERACTIVE")) return true;
  return signals.has("CURSOR_POINTER");
}

function disabled(node: Task10sFinalSurfaceCandidate): boolean {
  return node.disabled || node.ariaDisabled?.trim().toLowerCase() === "true";
}

function resolved(status: Task10sFinalSurfaceResolutionStatus, candidate: Task10sFinalSurfaceCandidate | null, failureCode: string | null = null): Task10sFinalSurfaceResolution {
  const present = candidate !== null && ["FOUND_UNIQUE", "DISABLED"].includes(status);
  const enabled = present && status === "FOUND_UNIQUE";
  return {
    status,
    present,
    enabled,
    currentState: !present ? "NOT_PRESENT" : enabled ? "PRESENT_ENABLED" : "PRESENT_DISABLED",
    candidate,
    failureCode
  };
}

export function resolveTask10sExactPublishSurface(diagnostic: Task10sFinalSurfaceDiagnostic): Task10sFinalSurfaceResolution {
  if ("inspectionStatus" in diagnostic && diagnostic.inspectionStatus !== "PASS") return resolved("NOT_FOUND", null, diagnostic.failureCode ?? "GLOBAL_EXACT_DIAGNOSTIC_FAILED");
  if (diagnostic.globalExactPublishTextMatchCount === 0) return resolved("NOT_FOUND", null, "EXACT_PUBLISH_TEXT_NOT_FOUND");
  if (diagnostic.globalExactPublishTextMatchCount !== 1 || diagnostic.globalExactPublishUnique !== "YES" || diagnostic.globalExactPublishNodesSafe.length !== 1) {
    return resolved("AMBIGUOUS", null, "EXACT_PUBLISH_TEXT_NOT_UNIQUE");
  }

  const exactNode = diagnostic.globalExactPublishNodesSafe[0];
  if (!exactNode || !renderedNode(exactNode)) return resolved("NOT_VISIBLE", null, "EXACT_PUBLISH_NODE_NOT_RENDERED");

  const candidates: Task10sFinalSurfaceCandidate[] = [exactNode, ...exactNode.ancestors.filter((item) => item.depth >= 1 && item.depth <= 5)];
  const boundedCandidates = candidates.filter((candidate) => renderedSurface(candidate) && isBoundedClickableSurface(candidate));
  if (boundedCandidates.length === 0) return resolved("NO_CLICKABLE_SURFACE", null, "NO_UNIQUE_BOUNDED_CLICKABLE_SURFACE");
  if (boundedCandidates.length !== 1) return resolved("AMBIGUOUS", null, "MULTIPLE_BOUNDED_CLICKABLE_SURFACES");

  const candidate = boundedCandidates[0];
  if (!candidate) return resolved("NO_CLICKABLE_SURFACE", null, "NO_UNIQUE_BOUNDED_CLICKABLE_SURFACE");
  return disabled(candidate) ? resolved("DISABLED", candidate, "FINAL_SURFACE_DISABLED") : resolved("FOUND_UNIQUE", candidate);
}
