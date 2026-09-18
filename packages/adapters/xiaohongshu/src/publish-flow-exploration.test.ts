import { describe, expect, it } from "vitest";
import type {
  PublishFlowExplorationBudgets,
  PublishFlowExplorationCounters,
  PublishFlowExplorationResult
} from "@publisher/adapters-core";
import {
  DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS,
  assertExplorationSafety,
  canSpendBudget,
  recordBudgetUse,
  selectSafeIntermediateAction,
  type XhsIntermediateActionCandidate
} from "./publish-flow-exploration";

const candidate = (overrides: Partial<XhsIntermediateActionCandidate> = {}): XhsIntermediateActionCandidate => ({
  candidateId: "next-1",
  tagName: "BUTTON",
  normalizedText: "下一步",
  role: "button",
  semanticSignal: "next",
  visible: true,
  enabled: true,
  boundingBox: { x: 10, y: 10, width: 80, height: 32 },
  nearestInteractiveAncestorTag: "BUTTON",
  nearestInteractiveAncestorRole: "button",
  pointerEvents: "auto",
  hitTestValid: true,
  ...overrides
});

const counters = (): PublishFlowExplorationCounters => ({
  navigationRestartCount: 0,
  refreshCount: 0,
  uploadAttempts: 0,
  uploadMutationCount: 0,
  uploadRetryCount: 0,
  intermediateActionClickCount: 0,
  titleMutationCount: 0,
  bodyMutationCount: 0,
  settingsMutationCount: 0,
  contentMutationCount: 0,
  finalSubmitCount: 0
});

const budgets = (overrides: Partial<PublishFlowExplorationBudgets> = {}): PublishFlowExplorationBudgets => ({
  ...DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS,
  ...overrides
});

function result(overrides: Partial<PublishFlowExplorationResult> = {}): PublishFlowExplorationResult {
  return {
    mode: "XHS_PUBLISH_FLOW_EXPLORATION",
    status: "BLOCKED",
    operationId: "op-1",
    platformKey: "xiaohongshu",
    accountId: "account-1",
    imageSource: "SAFE_TEST_FIXTURE",
    sameCanonicalPage: true,
    sameContext: true,
    timeline: [],
    states: [],
    actions: [],
    selectors: [],
    counters: counters(),
    uploadAttempts: 0,
    uploadMutationCount: 0,
    uploadRetryCount: 0,
    intermediateActionClickCount: 0,
    titleMutationCount: 0,
    bodyMutationCount: 0,
    settingsMutationCount: 0,
    contentMutationCount: 0,
    finalSubmitCount: 0,
    budgets: budgets(),
    title: { attempted: false, mutationCount: 0, strategyCount: 0, readbackVerified: false },
    titleReadbackVerified: false,
    body: { attempted: false, mutationCount: 0, strategyCount: 0, readbackVerified: false },
    bodyReadbackVerified: false,
    requiredSettings: { status: "NOT_REQUIRED", mutations: [] },
    finalSubmit: { status: "NOT_DISCOVERED", visible: false, enabled: false, hitTestValid: false },
    forbiddenMutationObserved: false,
    blocker: "UNKNOWN_UI_STATE",
    readyForFinalSubmit: false,
    evidence: {},
    ...overrides
  };
}

describe("Xiaohongshu publish-flow exploration safety policy", () => {
  it("selects one visible, enabled, hit-test-valid internal action", () => {
    const selected = selectSafeIntermediateAction([candidate()], "IMAGE_POST_MEDIA_PREVIEW");
    expect(selected).toMatchObject({ status: "FOUND_UNIQUE", candidateId: "next-1" });
  });

  it("rejects final-submit labels and unsafe candidates", () => {
    expect(selectSafeIntermediateAction([candidate({ normalizedText: "发布" })], "IMAGE_POST_POST_UPLOAD_EDITOR").status).toBe("NOT_FOUND");
    expect(selectSafeIntermediateAction([candidate({ normalizedText: "确认发布" })], "IMAGE_POST_MEDIA_PREVIEW").status).toBe("NOT_FOUND");
    expect(selectSafeIntermediateAction([candidate({ enabled: false })], "IMAGE_POST_MEDIA_PREVIEW").status).toBe("NOT_FOUND");
    expect(selectSafeIntermediateAction([candidate({ hitTestValid: false })], "IMAGE_POST_MEDIA_PREVIEW").status).toBe("NOT_FOUND");
  });

  it("blocks ambiguous internal actions instead of guessing", () => {
    const resolution = selectSafeIntermediateAction([candidate(), candidate({ candidateId: "next-2" })], "IMAGE_POST_MEDIA_PREVIEW");
    expect(resolution).toMatchObject({ status: "AMBIGUOUS" });
  });

  it("does not treat editor controls as an intermediate action before an intermediate phase", () => {
    const resolution = selectSafeIntermediateAction([candidate()], "IMAGE_POST_POST_UPLOAD_EDITOR");
    expect(resolution.status).toBe("NOT_FOUND");
  });

  it("enforces each exploration budget and derives retry count", () => {
    const initial = counters();
    expect(canSpendBudget(initial, budgets({ maxUploadAttempts: 1 }), "uploadAttempts")).toBe(true);
    const afterAttempt = recordBudgetUse(initial, "uploadAttempts");
    expect(afterAttempt.uploadAttempts).toBe(1);
    expect(afterAttempt.uploadRetryCount).toBe(0);
    expect(canSpendBudget(afterAttempt, budgets({ maxUploadAttempts: 1 }), "uploadAttempts")).toBe(false);
    const afterRetry = recordBudgetUse(afterAttempt, "uploadAttempts");
    expect(afterRetry.uploadRetryCount).toBe(1);
  });

  it("keeps title, body, settings, intermediate, navigation and refresh ceilings bounded", () => {
    const current = counters();
    expect(canSpendBudget(current, budgets({ maxTitleMutations: 0 }), "titleMutationCount")).toBe(false);
    expect(canSpendBudget(current, budgets({ maxBodyMutations: 0 }), "bodyMutationCount")).toBe(false);
    expect(canSpendBudget(current, budgets({ maxIntermediateActionClicks: 0 }), "intermediateActionClickCount")).toBe(false);
    expect(canSpendBudget(current, budgets({ maxNavigationRestarts: 0 }), "navigationRestartCount")).toBe(false);
    expect(canSpendBudget(current, budgets({ maxRefreshCount: 0 }), "refreshCount")).toBe(false);
  });

  it("rejects any final-submit click or forbidden mutation", () => {
    expect(() => assertExplorationSafety(result({ counters: { ...counters(), finalSubmitCount: 1 } }))).toThrow("FINAL_SUBMIT_COUNT");
    expect(() => assertExplorationSafety(result({ forbiddenMutationObserved: true }))).toThrow("SAFETY_BOUNDARY_VIOLATION");
  });

  it("accepts a ready result only when final submit remains untouched", () => {
    expect(() => assertExplorationSafety(result({
      status: "PASS_READY_FOR_FINAL_SUBMIT",
      readyForFinalSubmit: true,
      blocker: null,
      finalSubmit: { status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true }
    }))).not.toThrow();
  });
});
