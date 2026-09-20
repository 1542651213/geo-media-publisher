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

  it("correlates exact publish targets, bounded surfaces, listener proof and hit-test evidence", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "PUBLISH_EXACT_TARGETS_OBSERVED", {
        ...shared,
        exactPublishSemanticTargets: [{ targetId: "target-0", tagName: "SPAN", exactText: "发布笔记", visible: true, boundingBox: { x: 1, y: 2, width: 3, height: 4 }, parentTag: "DIV", depth: 5 }]
      }),
      event("2026-08-30T08:00:00.013Z", "PUBLISH_TARGET_ANCESTOR_CHAINS", {
        ...shared,
        ancestorChainDiagnostics: [{ targetId: "target-0", surfaceId: "surface-0", depth: 1, tagName: "DIV", pointerEvents: "auto", visibility: "visible" }]
      }),
      event("2026-08-30T08:00:00.014Z", "PUBLISH_EVENT_LISTENERS_OBSERVED", {
        ...shared,
        eventListenerInspection: "AVAILABLE",
        eventListenerDiagnostics: [{ targetId: "target-0", listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 1, surfaceId: "surface-0" }] }]
      }),
      event("2026-08-30T08:00:00.015Z", "PUBLISH_HIT_TEST_OBSERVED", {
        ...shared,
        hitTestDiagnostics: [{ targetId: "target-0", center: { x: 2, y: 3 }, elements: [{ surfaceId: "surface-0", ancestorRelation: "ANCESTOR" }] }]
      }),
      event("2026-08-30T08:00:00.016Z", "PUBLISH_CLICK_SURFACE_DIAGNOSTICS", {
        ...shared,
        publishNoteSurface: { exactText: "发布笔记", status: "PROVEN_UNIQUE", confidence: "HIGH", surface: { surfaceId: "surface-0", ancestorDepth: 1 } },
        imagePostSurface: { exactText: "发布图文笔记", status: "NO_CLICK_SURFACE_FOUND", failureCode: "PUBLISH_SEMANTIC_TARGET_NOT_FOUND" },
        clickableSurfaceStatus: "NO_CLICK_SURFACE_FOUND",
        clickableSurfaceFailureCode: "PUBLISH_SEMANTIC_TARGET_NOT_FOUND",
        clickableSurfaceConfidence: "NONE",
        diagnosticClickCount: 0,
        mouseEventDispatchCount: 0,
        keyboardEventCount: 0
      })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      exactPublishTargets: [{ targetId: "target-0", exactText: "发布笔记" }],
      publishTargetAncestorChains: [{ targetId: "target-0", surfaceId: "surface-0", depth: 1 }],
      eventListenerInspection: "AVAILABLE",
      eventListenerDiagnostics: [{ targetId: "target-0" }],
      hitTestDiagnostics: [{ targetId: "target-0" }],
      publishNoteSurface: { status: "PROVEN_UNIQUE" },
      imagePostSurface: { status: "NO_CLICK_SURFACE_FOUND" },
      clickableSurfaceStatus: "NO_CLICK_SURFACE_FOUND",
      clickableSurfaceFailureCode: "PUBLISH_SEMANTIC_TARGET_NOT_FOUND",
      diagnosticClickCount: 0,
      mouseEventDispatchCount: 0,
      keyboardEventCount: 0
    });
  });

  it("does not count clickable-surface or navigation diagnostics as final submit", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "PUBLISH_CLICK_SURFACE_DIAGNOSTICS", { ...shared, clickableSurfaceStatus: "PROVEN_UNIQUE" }),
      event("2026-08-30T08:00:00.013Z", "PUBLISH_NOTE_NAVIGATION_CLICK", { ...shared, action: "PUBLISH_NOTE_NAVIGATION_CLICK", navigationClickCount: 1 }),
      event("2026-08-30T08:00:00.014Z", "FINAL_SUBMIT_CLICKED", { ...shared, action: "FINAL_SUBMIT_CLICKED" })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result.sideEffectSummary.finalSubmitCount).toBe(1);
  });

  it("maps structured Task10V identity proof and authorization convergence fields", () => {
    const shared = { operationId: "task10v-proof", platformKey, accountId: accountA, contextDebugId: "context-v", pageDebugId: "page-v" };
    const result = analyzeTask10AEvidence({
      logText: logText([
        event("2026-08-30T08:00:00.000Z", "XHS_CREATOR_IDENTITY_PROOF", {
          ...shared,
          EXPECTED_CREATOR_IDENTITY: "960803317",
          OBSERVED_CREATOR_IDENTITY: { externalCreatorId: "960803317", stable: true },
          ACCOUNT_IDENTITY_VERIFIED: true,
          ACCOUNT_IDENTITY_MISMATCH: false
        }),
        event("2026-08-30T08:00:00.001Z", "XHS_IDENTITY_AUTHORIZATION_CONVERGED", {
          ...shared,
          ACCOUNT_IDENTITY_VERIFIED: true,
          ACTIVE_UNUSED_AUTHORIZATION_COUNT: 1,
          REUSABLE_ONE_SHOT_OPERATION_ID: "run-newest",
          SUPERSEDED_UNUSED_AUTHORIZATION_COUNT: 1
        })
      ]),
      platformKey,
      accountId: accountA,
      operationId: "task10v-proof",
      publishDomainCounts: counts
    });

    expect(result).toMatchObject({
      expectedCreatorIdentity: "960803317",
      observedCreatorIdentity: { externalCreatorId: "960803317", stable: true },
      accountIdentityVerified: true,
      accountIdentityMismatch: false,
      activeUnusedAuthorizationCount: 1,
      reusableOneShotOperationId: "run-newest",
      supersededUnusedAuthorizationCount: 1
    });
  });

  it("keeps clickable-surface diagnostics at zero final submits without an explicit submit marker", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "PUBLISH_CLICK_SURFACE_DIAGNOSTICS", {
        ...shared,
        action: "PUBLISH_CLICK_SURFACE_DIAGNOSTICS",
        clickableSurfaceStatus: "PROVEN_UNIQUE",
        gateFinalSubmitCount: 0
      })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result.sideEffectSummary.finalSubmitCount).toBe(0);
  });

  it("extracts Task 10I note-navigation evidence from structured markers", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "PUBLISH_NOTE_SURFACE_RESOLVED", { ...shared, status: "PROVEN_UNIQUE" }),
      event("2026-08-30T08:00:00.013Z", "PUBLISH_NOTE_SURFACE_PRECLICK_REVALIDATED", { ...shared, revalidated: true }),
      event("2026-08-30T08:00:00.014Z", "PUBLISH_NOTE_NAVIGATION_CLICK_COMPLETED", { ...shared, action: "PUBLISH_NOTE_NAVIGATION_CLICK", navigationClickCount: 1, sanitizedUrlBefore: "https://creator.xiaohongshu.com/new/home", sanitizedUrlAfter: "https://creator.xiaohongshu.com/publish/publish", navigationTransition: true }),
      event("2026-08-30T08:00:00.015Z", "POST_PUBLISH_NOTE_STATE_OBSERVED", { ...shared, postPublishNoteState: "IMAGE_EDITOR", imagePostSurfaceAfterPublishNote: { status: "AMBIGUOUS" } })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      publishNoteSurfaceStatus: "PROVEN_UNIQUE",
      publishNotePreclickRevalidated: true,
      publishNoteNavigationClickCount: 1,
      publishNoteUrlBefore: "https://creator.xiaohongshu.com/new/home",
      publishNoteUrlAfter: "https://creator.xiaohongshu.com/publish/publish",
      postPublishNoteState: "IMAGE_EDITOR",
      imagePostSurfaceAfterPublishNote: { status: "AMBIGUOUS" },
      navigationTransitionObserved: true
    });
  });

  it("extracts structured image-editor discovery without counting discovery as final submit", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const controls = {
      kind: "TITLE_EDITOR",
      status: "FOUND_UNIQUE",
      detected: true,
      candidates: [{ candidateId: "title-0", tagName: "INPUT", role: null, semanticSignal: "title-editor", visible: true, enabled: true }]
    };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "IMAGE_EDITOR_INSPECTION_STARTED", { ...shared, sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish" }),
      event("2026-08-30T08:00:00.013Z", "IMAGE_EDITOR_READINESS_SAMPLE", { ...shared, sampleIndex: 0, elapsedMs: 12, readyState: "complete", currentUrl: "https://creator.xiaohongshu.com/publish/publish", titleCandidateCount: 1, bodyCandidateCount: 1, uploadCandidateCount: 1, finalSubmitCandidateCount: 1, securityVerificationPresent: false, loginPagePresent: false }),
      event("2026-08-30T08:00:00.014Z", "IMAGE_EDITOR_SHELL_READY", { ...shared, shellStatus: "IMAGE_EDITOR_SHELL_READY", sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish" }),
      event("2026-08-30T08:00:00.015Z", "IMAGE_EDITOR_CONTENT_TYPE_OBSERVED", { ...shared, contentType: "IMAGE_POST", contentTypeReady: true }),
      event("2026-08-30T08:00:00.016Z", "IMAGE_EDITOR_CONTROLS_DISCOVERED", {
        ...shared,
        contentType: "IMAGE_POST",
        contentTypeReady: true,
        titleEditor: controls,
        bodyEditor: { ...controls, kind: "BODY_EDITOR", candidates: [{ ...controls.candidates[0], candidateId: "body-0", tagName: "DIV", role: "textbox", semanticSignal: "body-editor" }] },
        imageUploadControl: { ...controls, kind: "IMAGE_UPLOAD_CONTROL", candidates: [{ ...controls.candidates[0], candidateId: "upload-0", semanticSignal: "image-upload-control" }] },
        publishSettingsArea: { status: "NOT_APPLICABLE", detected: false, candidates: [] },
        finalSubmitControl: { ...controls, kind: "FINAL_SUBMIT_CONTROL", candidates: [{ ...controls.candidates[0], candidateId: "submit-0", tagName: "BUTTON", semanticSignal: "final-submit" }] }
      }),
      event("2026-08-30T08:00:00.017Z", "FINAL_SUBMIT_CONTROL_DETECTED", { ...shared, detected: true }),
      event("2026-08-30T08:00:00.018Z", "PUBLISH_NOTE_NAVIGATION_CLICK", { ...shared, action: "PUBLISH_NOTE_NAVIGATION_CLICK", navigationClickCount: 1 }),
      event("2026-08-30T08:00:00.019Z", "FINAL_SUBMIT_CLICKED", { ...shared, action: "FINAL_SUBMIT_CLICKED" })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      imageEditorInspectionStarted: true,
      imageEditorReadinessSamples: [expect.objectContaining({ sampleIndex: 0, titleCandidateCount: 1 })],
      imageEditorShellResult: "IMAGE_EDITOR_SHELL_READY",
      contentType: "IMAGE_POST",
      contentTypeReady: true,
      titleEditorCandidates: [{ candidateId: "title-0" }],
      titleEditorStatus: "FOUND_UNIQUE",
      bodyEditorStatus: "FOUND_UNIQUE",
      imageUploadControlStatus: "FOUND_UNIQUE",
      publishSettingsAreaStatus: "NOT_APPLICABLE",
      finalSubmitControlStatus: "FOUND_UNIQUE",
      editorDiscoveryFailureCode: null,
      sideEffectSummary: { finalSubmitCount: 1 }
    });
  });

  it("does not count navigation or editor-control discovery markers as final submit", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "PUBLISH_NOTE_NAVIGATION_CLICK", { ...shared, action: "PUBLISH_NOTE_NAVIGATION_CLICK" }),
      event("2026-08-30T08:00:00.013Z", "IMAGE_EDITOR_CONTROLS_DISCOVERED", { ...shared, action: "IMAGE_EDITOR_CONTROLS_DISCOVERED" }),
      event("2026-08-30T08:00:00.014Z", "FINAL_SUBMIT_CONTROL_DETECTED", { ...shared, action: "FINAL_SUBMIT_CONTROL_DETECTED" })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result.sideEffectSummary.finalSubmitCount).toBe(0);
  });

  it("extracts staged image-editor phase evidence and keeps it read-only", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "IMAGE_EDITOR_PHASE_OBSERVED", {
        ...shared,
        phase: "IMAGE_POST_PRE_UPLOAD",
        phaseConfidence: "HIGH",
        phaseReason: "unique upload capability and pre-upload semantic signals are present",
        uploadCapabilityStatus: "PRESENT",
        uploadCapabilityPresent: true,
        uploadCapabilityUnique: true,
        preUploadSemanticNodes: [{ tagName: "DIV", normalizedText: "上传图片", visible: true }],
        uploadControlRelationships: [{ candidateId: "image-upload-control-0", visible: false, usableSurface: true }],
        phaseTopology: { titleCandidateCount: 0, bodyCandidateCount: 0, uploadCandidateCount: 1, finalSubmitCandidateCount: 0, stable: true }
      })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      imageEditorPhase: "IMAGE_POST_PRE_UPLOAD",
      imageEditorPhaseConfidence: "HIGH",
      uploadCapabilityStatus: "PRESENT",
      uploadCapabilityPresent: true,
      uploadCapabilityUnique: true,
      preUploadSemanticNodes: [{ tagName: "DIV" }],
      imageEditorPhaseTopology: { titleCandidateCount: 0, uploadCandidateCount: 1, stable: true },
      sideEffectSummary: { contentMutationCount: 0, uploadCount: 0, finalSubmitCount: 0 }
    });
  });

  it("extracts phase-aware PRE_UPLOAD Gate semantics without counting discovery as submit", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "PRE_UPLOAD_GATE_INSPECTION_STARTED", {
        ...shared,
        expectedPhase: "IMAGE_POST_PRE_UPLOAD",
        sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish"
      }),
      event("2026-08-30T08:00:00.013Z", "PRE_UPLOAD_GATE_RESULT", {
        ...shared,
        preSubmitGatePhase: "PRE_UPLOAD",
        preUploadGateStatus: "PASS",
        preUploadGateFailureCode: null,
        imageEditorPhase: "IMAGE_POST_PRE_UPLOAD",
        imageEditorPhaseConfidence: "HIGH",
        uploadCapabilityPresent: true,
        postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD",
        preSubmitGatePassMeaning: "SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE"
      }),
      event("2026-08-30T08:00:00.014Z", "IMAGE_EDITOR_CONTROLS_DISCOVERED", {
        ...shared,
        action: "IMAGE_EDITOR_CONTROLS_DISCOVERED"
      }),
      event("2026-08-30T08:00:00.015Z", "FINAL_SUBMIT_CONTROL_DETECTED", {
        ...shared,
        action: "FINAL_SUBMIT_CONTROL_DETECTED"
      })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: "PASS",
      preUploadGateFailureCode: null,
      imageEditorPhase: "IMAGE_POST_PRE_UPLOAD",
      imageEditorPhaseConfidence: "HIGH",
      uploadCapabilityPresent: true,
      postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD",
      preSubmitGatePassMeaning: "SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE",
      sideEffectSummary: { finalSubmitCount: 0 }
    });
  });

  it("does not count PRE_UPLOAD diagnostics as an upload mutation", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "PRE_UPLOAD_GATE_INSPECTION_STARTED", { ...shared, expectedPhase: "IMAGE_POST_PRE_UPLOAD" }),
      event("2026-08-30T08:00:00.013Z", "PRE_UPLOAD_GATE_RESULT", { ...shared, preUploadGateStatus: "PASS", uploadCapabilityPresent: true }),
      event("2026-08-30T08:00:00.014Z", "UPLOAD_CAPABILITY_PRESENT", { ...shared, uploadCapabilityPresent: true }),
      event("2026-08-30T08:00:00.015Z", "UPLOAD_CONTROL_RELATIONSHIP", { ...shared, usableSurface: true })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result.sideEffectSummary.uploadCount).toBe(0);
  });

  it("does not count POST_UPLOAD diagnostics as an upload mutation", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "POST_UPLOAD_EDITOR_READINESS_STARTED", { ...shared, expectedPhase: "IMAGE_POST_POST_UPLOAD_EDITOR" }),
      event("2026-08-30T08:00:00.013Z", "POST_UPLOAD_EDITOR_READINESS_SAMPLE", { ...shared, uploadBusy: false, previewReady: true }),
      event("2026-08-30T08:00:00.014Z", "POST_UPLOAD_EDITOR_PHASE_OBSERVED", { ...shared, phase: "IMAGE_POST_POST_UPLOAD_EDITOR" }),
      event("2026-08-30T08:00:00.015Z", "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED", { ...shared, postUploadControlsStatus: "READY" })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result.sideEffectSummary.uploadCount).toBe(0);
  });

  it("counts one upload mutation from an explicit upload-start marker only", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:00.012Z", "UPLOAD_CAPABILITY_PRESENT", { ...shared, uploadCapabilityPresent: true }),
      event("2026-08-30T08:00:00.013Z", "IMAGE_UPLOAD_STARTED", { ...shared, action: "IMAGE_UPLOAD_MUTATION", requestedCount: 1 }),
      event("2026-08-30T08:00:00.014Z", "IMAGE_UPLOAD_COMPLETED", { ...shared, action: "IMAGE_UPLOAD_COMPLETED", requestedCount: 1, previewCount: 1 })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result.sideEffectSummary.uploadCount).toBe(1);
  });

  it("prioritizes post-upload phase failure over a premature title failure", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents({ failureCode: "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD", failureStage: "EDITOR_DISCOVERY", missingSignal: "title-editor", result: "needs_user_action" }),
      event("2026-08-30T08:00:01.002Z", "POST_UPLOAD_EDITOR_READINESS_SAMPLE", {
        ...shared,
        sampleIndex: 0,
        elapsedMs: 13,
        observedPhase: "IMAGE_POST_TRANSITIONING",
        domStable: true,
        uploadBusy: false,
        previewReady: true,
        titleCandidateCount: 0,
        bodyCandidateCount: 0,
        finalSubmitCandidateCount: 0,
        securityVerificationPresent: false,
        loginPagePresent: false
      }),
      event("2026-08-30T08:00:01.003Z", "POST_UPLOAD_EDITOR_PHASE_OBSERVED", {
        ...shared,
        phase: "IMAGE_POST_UNKNOWN",
        phaseConfidence: "LOW",
        phaseReason: "post-upload terminal phase was not proven",
        postUploadTerminalStateReached: false,
        postUploadControlsStatus: "FAIL",
        postUploadReadinessDurationMs: 104,
        postUploadReadinessSampleCount: 2,
        failureCode: "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD",
        failureStage: "EDITOR_DISCOVERY",
        missingSignal: "title-editor"
      }),
      event("2026-08-30T08:00:01.004Z", "POST_UPLOAD_EDITOR_INSPECTION_FAILED", {
        ...shared,
        phase: "IMAGE_POST_UNKNOWN",
        failureCode: "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD",
        failureStage: "EDITOR_DISCOVERY",
        missingSignal: "title-editor"
      })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      postUploadPhase: "IMAGE_POST_UNKNOWN",
      postUploadPhaseConfidence: "LOW",
      postUploadTerminalStateReached: false,
      postUploadReadinessDurationMs: 104,
      postUploadReadinessSampleCount: 2,
      failureCode: "POST_UPLOAD_EDITOR_NOT_READY",
      failureStage: "EDITOR_DISCOVERY",
      missingSignal: "post-upload-terminal-phase",
      editorDiscoveryFailureCode: "POST_UPLOAD_EDITOR_NOT_READY",
      editorDiscoveryFailureStage: "EDITOR_DISCOVERY"
    });
  });

  it("retains precise post-upload control failure after a terminal editor phase", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents({ failureCode: "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD", failureStage: "EDITOR_DISCOVERY", missingSignal: "title-editor", result: "needs_user_action" }),
      event("2026-08-30T08:00:01.002Z", "POST_UPLOAD_EDITOR_PHASE_OBSERVED", {
        ...shared,
        phase: "IMAGE_POST_POST_UPLOAD_EDITOR",
        phaseConfidence: "HIGH",
        postUploadTerminalStateReached: true,
        postUploadControlsStatus: "FAIL"
      }),
      event("2026-08-30T08:00:01.003Z", "POST_UPLOAD_EDITOR_INSPECTION_FAILED", {
        ...shared,
        phase: "IMAGE_POST_POST_UPLOAD_EDITOR",
        failureCode: "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD",
        failureStage: "EDITOR_DISCOVERY",
        missingSignal: "title-editor"
      })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      postUploadPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
      postUploadTerminalStateReached: true,
      editorDiscoveryFailureCode: "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD",
      failureCode: "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD"
    });
  });

  it("reports Task10T confirmation lifecycle without treating IPC errors as final submits", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:01.020Z", "MIGRATION_DISCOVERY", { ...shared, latestMigrationId: "0023_v150_one_shot_publication_authorization.sql", maxDiscoveredVersion: "0023" }),
      event("2026-08-30T08:00:01.021Z", "TASK10S_SCHEMA_READY", { ...shared, productionSchemaVersion: "0023", authTablePresent: true }),
      event("2026-08-30T08:00:01.022Z", "CONFIRM_IPC_ATTEMPT", { ...shared, channel: "platform-self-test:confirm-one-shot-publish" }),
      event("2026-08-30T08:00:01.023Z", "CONFIRM_IPC_ATTEMPT", { ...shared, channel: "platform-self-test:confirm-one-shot-publish" }),
      event("2026-08-30T08:00:01.024Z", "IPC_HANDLER_ERROR", { ...shared, channel: "platform-self-test:confirm-one-shot-publish" }, "FINAL_SUBMIT failed while handling confirmation"),
      event("2026-08-30T08:00:01.025Z", "ONE_SHOT_CONFIRM_STARTED", { ...shared }),
      event("2026-08-30T08:00:01.026Z", "ONE_SHOT_CONFIRM_ROLLED_BACK", { ...shared, authorizationCreated: false, operationCreated: false }),
      event("2026-08-30T08:00:01.027Z", "ONE_SHOT_CONFIRM_DUPLICATE_SUPPRESSED", { ...shared })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      productionSchemaVersion: "0023",
      task10sAuthTablePresent: true,
      confirmIpcAttemptCount: 3,
      confirmDuplicateSuppressedCount: 1,
      confirmTransactionStatus: "ROLLED_BACK",
      authorizationCreated: "NO",
      operationCreated: "NO",
      publicationTransactionCount: 0,
      sideEffectSummary: { finalSubmitCount: 0 }
    });
  });

  it("reports Task10U reconciliation markers without counting them as publication activity", () => {
    const shared = { operationId: "gate-a", platformKey, accountId: accountA, contextDebugId: "context-a", pageDebugId: "page-a" };
    const events = [
      ...gateEvents(),
      event("2026-08-30T08:00:01.020Z", "PARTIAL_CONFIRMATION_STATE_DETECTED", { ...shared, testRunId: "orphan-1", authorizationCount: 0, operationCount: 0 }),
      event("2026-08-30T08:00:01.021Z", "PARTIAL_CONFIRM_RECONCILIATION_STARTED", { ...shared, testRunId: "orphan-1" }),
      event("2026-08-30T08:00:01.022Z", "PARTIAL_CONFIRM_RECONCILIATION_COMMITTED", { ...shared, testRunId: "orphan-1", mutationCount: 1, retryEligible: true, authorizationCreated: false, operationCreated: false, publicationTransactionCount: 0, finalSubmitCount: 0 }),
      event("2026-08-30T08:00:01.023Z", "PARTIAL_CONFIRM_RECONCILIATION_RESULT", { ...shared, testRunId: "orphan-1", status: "RECONCILED_RETRYABLE", mutationCount: 1, retryEligible: true })
    ];

    const result = analyzeTask10AEvidence({ logText: logText(events), platformKey, accountId: accountA, publishDomainCounts: counts });

    expect(result).toMatchObject({
      partialConfirmationStateDetected: true,
      partialConfirmReconciliationStarted: true,
      partialConfirmReconciliationCommitted: true,
      partialConfirmReconciliationRolledBack: false,
      partialConfirmReconciliationResult: "RECONCILED_RETRYABLE",
      oneShotConfirmRetryEligible: true,
      reconciliationMutationCount: 1,
      publicationTransactionCount: 0,
      sideEffectSummary: { uploadCount: 0, contentMutationCount: 0, finalSubmitCount: 0 }
    });
  });
});
