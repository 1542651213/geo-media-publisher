import type {
  PublishFlowExplorationBudgets,
  PublishFlowExplorationCounters,
  PublishFlowExplorationResult
} from "@publisher/adapters-core";
import type { ImageEditorBoundingBox, ImageEditorPhase } from "./image-editor-discovery";

export const DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS: PublishFlowExplorationBudgets = {
  maxDurationMs: 15 * 60 * 1000,
  maxNavigationRestarts: 2,
  maxUploadAttempts: 3,
  maxIntermediateActionClicks: 12,
  maxRefreshCount: 1,
  maxTitleMutations: 3,
  maxBodyMutations: 3
};

export interface XhsIntermediateActionCandidate {
  candidateId: string;
  tagName: string;
  normalizedText: string;
  role: string | null;
  semanticSignal: string;
  visible: boolean;
  enabled: boolean;
  boundingBox: ImageEditorBoundingBox | null;
  nearestInteractiveAncestorTag: string | null;
  nearestInteractiveAncestorRole: string | null;
  pointerEvents: string;
  hitTestValid: boolean;
}

export type XhsIntermediateActionResolutionStatus = "FOUND_UNIQUE" | "NOT_FOUND" | "AMBIGUOUS";

export interface XhsIntermediateActionResolution {
  status: XhsIntermediateActionResolutionStatus;
  candidateId?: string;
  candidate?: XhsIntermediateActionCandidate;
  reason: string;
}

export type XhsExplorationBudgetResource =
  | "navigationRestartCount"
  | "refreshCount"
  | "uploadAttempts"
  | "intermediateActionClickCount"
  | "titleMutationCount"
  | "bodyMutationCount";

const budgetKey: Record<XhsExplorationBudgetResource, keyof PublishFlowExplorationBudgets> = {
  navigationRestartCount: "maxNavigationRestarts",
  refreshCount: "maxRefreshCount",
  uploadAttempts: "maxUploadAttempts",
  intermediateActionClickCount: "maxIntermediateActionClicks",
  titleMutationCount: "maxTitleMutations",
  bodyMutationCount: "maxBodyMutations"
};

const intermediatePhaseSet = new Set<ImageEditorPhase>([
  "IMAGE_POST_MEDIA_PREVIEW",
  "IMAGE_POST_MEDIA_EDITING",
  "IMAGE_POST_CONFIRMATION_REQUIRED",
  "IMAGE_POST_TRANSITIONING"
]);

const intermediateActionPattern = /完成|确认|下一步|继续|编辑图片|编辑照片|裁剪完成|返回编辑|done|confirm|next|continue|edit\s*(?:image|photo)|crop(?:ping)?\s*done|back\s*to\s*edit/iu;
const finalSubmitPattern = /发布|发表|提交|确认发布|立即发布|publish|submit/iu;

export function selectSafeIntermediateAction(
  candidates: readonly XhsIntermediateActionCandidate[],
  phase: ImageEditorPhase | string
): XhsIntermediateActionResolution {
  if (!intermediatePhaseSet.has(phase as ImageEditorPhase)) return { status: "NOT_FOUND", reason: "phase does not require an intermediate action" };
  const safe = candidates.filter((candidate) =>
    candidate.visible
    && candidate.enabled
    && candidate.boundingBox !== null
    && candidate.pointerEvents !== "none"
    && candidate.hitTestValid
    && !finalSubmitPattern.test(candidate.normalizedText)
    && intermediateActionPattern.test(candidate.normalizedText)
  );
  if (safe.length === 0) return { status: "NOT_FOUND", reason: "no unique visible enabled hit-test-valid internal action" };
  if (safe.length > 1) return { status: "AMBIGUOUS", reason: "multiple internal action candidates remain after safety filtering" };
  const selected = safe[0]!;
  return { status: "FOUND_UNIQUE", candidateId: selected.candidateId, candidate: selected, reason: "one safe internal publishing-flow action was proven" };
}

export function canSpendBudget(
  counters: PublishFlowExplorationCounters,
  budgets: PublishFlowExplorationBudgets,
  resource: XhsExplorationBudgetResource
): boolean {
  return counters[resource] < budgets[budgetKey[resource]];
}

export function recordBudgetUse(
  counters: PublishFlowExplorationCounters,
  resource: XhsExplorationBudgetResource
): PublishFlowExplorationCounters {
  const nextValue = counters[resource] + 1;
  return {
    ...counters,
    [resource]: nextValue,
    ...(resource === "uploadAttempts" ? { uploadRetryCount: Math.max(0, nextValue - 1) } : {})
  };
}

export function assertExplorationSafety(result: PublishFlowExplorationResult): void {
  if (result.counters.finalSubmitCount > 0) throw new Error("FINAL_SUBMIT_COUNT must remain 0");
  if (result.forbiddenMutationObserved) throw new Error("SAFETY_BOUNDARY_VIOLATION");
  for (const resource of Object.keys(budgetKey) as XhsExplorationBudgetResource[]) {
    if (!canSpendBudgetAtCompletion(result.counters, result.budgets, resource)) throw new Error("EXPLORATION_BUDGET_EXCEEDED:" + resource);
  }
}

function canSpendBudgetAtCompletion(
  counters: PublishFlowExplorationCounters,
  budgets: PublishFlowExplorationBudgets,
  resource: XhsExplorationBudgetResource
): boolean {
  return counters[resource] <= budgets[budgetKey[resource]];
}
