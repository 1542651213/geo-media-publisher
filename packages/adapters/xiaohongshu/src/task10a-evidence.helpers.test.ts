import { describe, expect, it } from "vitest";
import {
  analyzeTask10AEvidence,
  parseTask10AEvidenceLog,
  type EvidenceLogEvent,
  type PublishDomainCounts
} from "../../../../scripts/v143-xiaohongshu-task10a-evidence.helpers";

const accountA = "account-a";
const accountB = "account-b";
const platformKey = "xiaohongshu";
const counts: PublishDomainCounts = { publishJobs: 15, submissionIntents: 12, publishRecords: 9 };

function event(timestamp: string, code: string, context: Record<string, unknown>, message = "diagnostic"): EvidenceLogEvent {
  return { timestamp, level: "info", module: "ACCOUNT", code, message, context };
}

function logText(events: EvidenceLogEvent[]): string {
  return events.map((entry) => JSON.stringify(entry)).join("\n");
}

function gateEvents(options: {
  accountId?: string;
  operationId?: string;
  contextDebugId?: string;
  pageDebugId?: string;
  result?: string;
  failureCode?: string;
  failureStage?: string;
  missingSignal?: string | null;
  finalUrl?: string;
  incomplete?: boolean;
  startTime?: string;
} = {}): EvidenceLogEvent[] {
  const accountId = options.accountId ?? accountA;
  const operationId = options.operationId ?? "gate-a";
  const contextDebugId = options.contextDebugId ?? "context-a";
  const pageDebugId = options.pageDebugId ?? "page-a";
  const startTime = options.startTime ?? "2026-08-30T08:00:00.000Z";
  const endTime = options.incomplete ? "2026-08-30T08:00:00.500Z" : "2026-08-30T08:00:01.000Z";
  const shared = { operationId, platformKey, accountId, contextDebugId, pageDebugId };
  const failure = options.failureCode ? { failureCode: options.failureCode, failureStage: options.failureStage, missingSignal: options.missingSignal ?? null } : {};
  const result = options.result ?? (options.failureCode ? "needs_user_action" : "ready");
  return [
    event("2026-08-30T07:59:59.900Z", "CANONICAL_SESSION_HEARTBEAT", {
      phase: "PRE_SUBMIT_GATE_PRECHECK", heartbeatSequence: "heartbeat-pre-a", ...shared,
      sessionExists: true, canonicalPageExists: true, canonicalPageClosed: false,
      canonicalPageContextMatchesSession: true, runtimeAuthState: "AUTHENTICATED"
    }),
    event(startTime, "PRE_SUBMIT_GATE_INSPECTION_STARTED", {
      ...shared, pageRole: "CANONICAL_AUTHENTICATED", pageSource: "EXISTING_CANONICAL_PAGE",
      createdNewPage: false, pageContextMatchesSession: true, startUrl: "https://creator.xiaohongshu.com/new/home"
    }),
    event("2026-08-30T08:00:00.010Z", "EDITOR_NAVIGATION_HELPER_INVOCATION_STARTED", { ...shared, helper: "navigateToImagePostEditor" }),
    event("2026-08-30T08:00:00.011Z", "EDITOR_ENTRY_STARTED", {
      ...shared, entryMethod: "CLICK_NAVIGATION", startUrl: "https://creator.xiaohongshu.com/new/home"
    }),
    event("2026-08-30T08:00:00.020Z", "EDITOR_ENTRY_STEP", {
      ...shared, stepName: "PUBLISH_ENTRY_FOUND", success: true, selectorSignal: "semantic:IMAGE_TEXT_PUBLISH_ENTRY"
    }),
    ...(options.incomplete ? [] : [event("2026-08-30T08:00:00.040Z", "EDITOR_ENTRY_STEP", {
      ...shared, stepName: "EDITOR_ROUTE_REACHED", success: true, selectorSignal: "url:/publish/publish"
    })]),
    ...(options.incomplete ? [] : [event(endTime, options.failureCode ? "EDITOR_NAVIGATION_FAILED" : "XHS_CANONICAL_PAGE_OPERATION_COMPLETED", {
      ...shared, phase: options.failureCode ? "FAILED" : "COMPLETED", finalStatus: result,
      sanitizedFinalUrl: options.finalUrl ?? "https://creator.xiaohongshu.com/publish/publish",
      editorReached: !options.failureCode, authStillValid: true,
      titleEditorDetected: !options.failureCode, bodyEditorDetected: !options.failureCode,
      imageUploadControlDetected: !options.failureCode, publishSettingsAreaDetected: !options.failureCode,
      finalSubmitControlDetected: !options.failureCode, contentType: !options.failureCode ? "IMAGE_TEXT" : null,
      contentTypeReady: !options.failureCode, securityVerificationPresent: false, loginPagePresent: false,
      needsUserAction: Boolean(options.failureCode), ...failure
    })]),
    ...(!options.incomplete ? [event("2026-08-30T08:00:01.010Z", "CANONICAL_SESSION_HEARTBEAT", {
      phase: "POST_SUBMIT_GATE", heartbeatSequence: "heartbeat-post-a", ...shared,
      sessionExists: true, canonicalPageExists: true, canonicalPageClosed: false,
      canonicalPageContextMatchesSession: true, runtimeAuthState: "AUTHENTICATED"
    })] : [])
  ];
}

describe("Task 10A evidence analyzer", () => {
  it("parses JSONL diagnostics and ignores malformed lines", () => {
    const parsed = parseTask10AEvidenceLog(`${logText([event("2026-08-30T08:00:00.000Z", "OTHER", { platformKey, accountId: accountA })])}\nnot-json`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ code: "OTHER", context: { platformKey, accountId: accountA } });
  });

  it("correlates a successful Gate with its operation, canonical IDs and surrounding heartbeats", () => {
    const result = analyzeTask10AEvidence({ logText: logText(gateEvents()), platformKey, accountId: accountA, publishDomainCounts: counts });
    expect(result).toMatchObject({
      evidenceAmbiguous: "NO", gateOperationId: "gate-a", contextDebugId: "context-a", pageDebugId: "page-a",
      loginContextId: "context-a", canonicalPageId: "page-a", gatePageRole: "CANONICAL_AUTHENTICATED",
      gatePageSource: "EXISTING_CANONICAL_PAGE", gateCreatedNewPage: false, gateContextMatch: true,
      editorReached: true, authStillValid: true, contentType: "IMAGE_TEXT", contentTypeReady: true,
      titleEditorDetected: true, bodyEditorDetected: true, imageUploadControlDetected: true,
      publishSettingsAreaDetected: true, finalSubmitControlDetected: true, securityVerificationPresent: false,
      loginPagePresent: false, needsUserAction: false, gateResult: "ready", failureCode: null,
      failureStage: null, missingSignal: null, publishDomainCounts: counts,
      sideEffectSummary: { preparePublishCalled: "NO", contentMutationCount: 0, uploadCount: 0, finalSubmitCount: 0 }
    });
    expect(result.preGateHeartbeat).toMatchObject({ heartbeatSequence: "heartbeat-pre-a", phase: "PRE_SUBMIT_GATE_PRECHECK" });
    expect(result.postGateHeartbeat).toMatchObject({ heartbeatSequence: "heartbeat-post-a", phase: "POST_SUBMIT_GATE" });
    expect(result.entrySteps.map((step) => step.stepName)).toEqual(["PUBLISH_ENTRY_FOUND", "EDITOR_ROUTE_REACHED"]);
    expect(result.timeline.map((entry) => entry.code)).toContain("PRE_SUBMIT_GATE_INSPECTION_STARTED");
  });

  it.each([
    ["AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND", "AUTHENTICATION", "creator-authenticated-positive-signal"],
    ["PUBLISH_ENTRY_NOT_FOUND", "PUBLISH_ENTRY_DISCOVERY", "image-post-entry"],
    ["EDITOR_ROUTE_NOT_REACHED", "EDITOR_ROUTE", "url:/publish/publish"],
    ["AUTH_REDIRECTED_TO_LOGIN", "AUTHENTICATION", "login-url"],
    ["SECURITY_VERIFICATION_REQUIRED", "AUTHENTICATION", "security-verification-signal"],
    ["UNKNOWN_UI_STATE", "EDITOR_NAVIGATION", null]
  ])("preserves structured failure fields for %s", (failureCode, failureStage, missingSignal) => {
    const result = analyzeTask10AEvidence({
      logText: logText(gateEvents({ failureCode, failureStage, missingSignal, result: "needs_user_action" })),
      platformKey,
      accountId: accountA,
      publishDomainCounts: counts
    });
    expect(result).toMatchObject({ gateOperationId: "gate-a", gateResult: "needs_user_action", failureCode, failureStage, missingSignal });
  });

  it("selects the newest complete operation for one account without mixing an older Context", () => {
    const old = gateEvents({ operationId: "old-gate", contextDebugId: "old-context", pageDebugId: "old-page", startTime: "2026-08-30T07:00:00.000Z" });
    const current = gateEvents({ operationId: "current-gate", contextDebugId: "current-context", pageDebugId: "current-page", startTime: "2026-08-30T08:00:00.000Z" });
    const result = analyzeTask10AEvidence({ logText: logText([...old, ...current]), platformKey, accountId: accountA, publishDomainCounts: counts });
    expect(result).toMatchObject({ gateOperationId: "current-gate", contextDebugId: "current-context", pageDebugId: "current-page" });
    expect(result.timeline.every((entry) => entry.context.operationId === "current-gate")).toBe(true);
  });

  it("does not cross-contaminate account A and account B logs", () => {
    const result = analyzeTask10AEvidence({
      logText: logText([...gateEvents({ accountId: accountB, operationId: "gate-b", contextDebugId: "context-b", pageDebugId: "page-b" }), ...gateEvents()]),
      platformKey,
      accountId: accountA,
      publishDomainCounts: counts
    });
    expect(result).toMatchObject({ gateOperationId: "gate-a", contextDebugId: "context-a", pageDebugId: "page-a" });
    expect(result.timeline.every((entry) => entry.context.accountId === accountA)).toBe(true);
  });

  it("reports an incomplete operation without borrowing a historical post-Gate heartbeat", () => {
    const result = analyzeTask10AEvidence({ logText: logText(gateEvents({ incomplete: true })), platformKey, accountId: accountA, publishDomainCounts: counts });
    expect(result).toMatchObject({ gateOperationId: "gate-a", gateResult: "INCOMPLETE", postGateHeartbeat: null, evidenceAmbiguous: "NO" });
  });

  it("reports ambiguity when operation selection cannot be unique", () => {
    const events = [
      ...gateEvents({ operationId: "gate-a", startTime: "2026-08-30T08:00:00.000Z" }),
      ...gateEvents({ operationId: "gate-b", startTime: "2026-08-30T08:00:00.000Z" })
    ];
    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });
    expect(result).toMatchObject({ evidenceAmbiguous: "YES", gateOperationId: null, gateResult: "AMBIGUOUS" });
  });

  it("reports no Gate found and never invokes a browser or IPC path", () => {
    const result = analyzeTask10AEvidence({ logText: logText([event("2026-08-30T08:00:00.000Z", "CANONICAL_SESSION_HEARTBEAT", { platformKey, accountId: accountA })]), platformKey, accountId: accountA, publishDomainCounts: counts });
    expect(result).toMatchObject({ evidenceAmbiguous: "NO", gateOperationId: null, gateResult: "NOT_FOUND" });
  });

  it("correlates Creator Home readiness, topology and semantic diagnostics to the selected Gate", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "CREATOR_HOME_READINESS_SAMPLE", { ...shared, readinessResult: "HOME_SHELL_READY", sampleIndex: 1, readyState: "complete", bodyChildCount: 3, visibleInteractiveCount: 4, navigationElementCount: 1, publishSemanticTextSignalCount: 1 }),
      event("2026-08-30T08:00:00.013Z", "CREATOR_HOME_TOPOLOGY_OBSERVED", { ...shared, topLevelElementCounts: { DIV: 2, NAV: 1 }, interactiveElementTypeCounts: { a: 0, button: 0, "role=button": 0, "role=menuitem": 1, "role=link": 0, "role=tab": 0, "[tabindex]": 1, nav: 1, aside: 0 }, frameCount: 0, frameSummary: [], shadowHostCount: 0, shadowSummary: [], publishEntryLocation: "MAIN_DOCUMENT", publishSemanticSignalPresent: true }),
      event("2026-08-30T08:00:00.014Z", "PUBLISH_SEMANTIC_NODES_OBSERVED", { ...shared, textSignalPresent: true, candidateCount: 1, publishSemanticTextSignalCount: 1, semanticNodes: [{ tagName: "SPAN", nearestInteractiveAncestorTag: "DIV", nearestInteractiveAncestorHasOnclick: true }], discoveryDiagnosis: "PUBLISH_ENTRY_OUTSIDE_LEGACY_ELEMENT_TYPES", accessibilityPublishSignals: [{ role: "button", name: "发布笔记" }] })
    ];
    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });
    expect(result).toMatchObject({
      creatorHomeShellReady: "HOME_SHELL_READY",
      publishSemanticTextSignalCount: 1,
      discoveryDiagnosis: "PUBLISH_ENTRY_OUTSIDE_LEGACY_ELEMENT_TYPES",
      domTopologySummary: { topLevelElementCounts: { DIV: 2, NAV: 1 } },
      publishSemanticNodes: [{ tagName: "SPAN" }],
      accessibilityPublishSignals: [{ role: "button", name: "发布笔记" }]
    });
    expect(result.homeReadinessSamples).toEqual([expect.objectContaining({ sampleIndex: 1, bodyChildCount: 3 })]);
  });

  it("prefers canonical completion finalStatus when navigation failure logging arrives later", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents({ failureCode: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: "publish-entry-semantic-candidate" }),
      event("2026-08-30T08:00:01.001Z", "XHS_CANONICAL_PAGE_OPERATION_COMPLETED", { ...shared, phase: "COMPLETED", finalStatus: "editor_not_found", sanitizedFinalUrl: "https://creator.xiaohongshu.com/new/home", failureCode: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: "publish-entry-semantic-candidate" })
    ];
    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });
    expect(result).toMatchObject({ gateResult: "editor_not_found", failureCode: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY" });
  });
});
