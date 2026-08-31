export type EvidenceLogEvent = {
  timestamp: string;
  level?: string;
  module?: string;
  code: string;
  message?: string;
  context: Record<string, unknown>;
};

export type PublishDomainCounts = {
  publishJobs: number;
  submissionIntents: number;
  publishRecords: number;
};

export type EvidenceTimelineEntry = {
  timestamp: string;
  code: string;
  context: Record<string, unknown>;
};

export type EvidenceEntryStep = {
  timestamp: string;
  stepName: string | null;
  success: boolean | null;
  selectorSignal: string | null;
  sanitizedUrlBefore: string | null;
  sanitizedUrlAfter: string | null;
  navigationTrigger: string | null;
};

export type Task10AEvidenceSummary = {
  platformKey: string;
  accountId: string;
  evidenceAmbiguous: "YES" | "NO";
  gateOperationId: string | null;
  contextDebugId: string | null;
  pageDebugId: string | null;
  loginContextId: string | null;
  canonicalPageId: string | null;
  preGateHeartbeat: Record<string, unknown> | null;
  postGateHeartbeat: Record<string, unknown> | null;
  gatePageRole: string | null;
  gatePageSource: string | null;
  gateCreatedNewPage: boolean | null;
  gateContextMatch: boolean | null;
  inspectionStarted: boolean;
  navigationHelperInvocationStarted: boolean;
  editorEntryStarted: boolean;
  homeReadinessSamples: Record<string, unknown>[];
  creatorHomeShellReady: string | null;
  domTopologySummary: Record<string, unknown> | null;
  frameSummary: unknown[];
  shadowDomSummary: unknown[];
  publishSemanticTextSignalCount: number | null;
  publishSemanticNodes: unknown[];
  accessibilityPublishSignals: unknown[];
  discoveryDiagnosis: string | null;
  exactPublishTargets: unknown[];
  publishTargetAncestorChains: unknown[];
  eventListenerInspection: string | null;
  eventListenerDiagnostics: unknown[];
  hitTestDiagnostics: unknown[];
  publishNoteSurface: Record<string, unknown> | null;
  publishNoteSurfaceStatus: string | null;
  publishNotePreclickRevalidated: boolean | null;
  publishNoteNavigationClickCount: number | null;
  publishNoteUrlBefore: string | null;
  publishNoteUrlAfter: string | null;
  postPublishNoteState: string | null;
  imagePostSurfaceAfterPublishNote: Record<string, unknown> | null;
  navigationTransitionObserved: boolean | null;
  imagePostSurface: Record<string, unknown> | null;
  clickableSurfaceStatus: string | null;
  clickableSurfaceFailureCode: string | null;
  clickableSurfaceConfidence: string | null;
  diagnosticClickCount: number | null;
  mouseEventDispatchCount: number | null;
  keyboardEventCount: number | null;
  timeline: EvidenceTimelineEntry[];
  entrySteps: EvidenceEntryStep[];
  failureCode: string | null;
  failureStage: string | null;
  missingSignal: string | null;
  gateResult: string;
  editorEntryFailureCode: string | null;
  editorEntryFailureStage: string | null;
  editorEntryMissingSignal: string | null;
  editorEntryStartUrl: string | null;
  editorEntryFinalUrl: string | null;
  editorReached: boolean | null;
  authStillValid: boolean | null;
  contentType: string | null;
  contentTypeReady: boolean | null;
  titleEditorDetected: boolean | null;
  bodyEditorDetected: boolean | null;
  imageUploadControlDetected: boolean | null;
  publishSettingsAreaDetected: boolean | null;
  finalSubmitControlDetected: boolean | null;
  securityVerificationPresent: boolean | null;
  loginPagePresent: boolean | null;
  needsUserAction: boolean | null;
  imageEditorInspectionStarted: boolean;
  imageEditorReadinessSamples: Record<string, unknown>[];
  imageEditorShellResult: string | null;
  titleEditorCandidates: unknown[];
  titleEditorStatus: string | null;
  bodyEditorCandidates: unknown[];
  bodyEditorStatus: string | null;
  imageUploadCandidates: unknown[];
  imageUploadControlStatus: string | null;
  publishSettingsAreaStatus: string | null;
  finalSubmitCandidates: unknown[];
  finalSubmitControlStatus: string | null;
  editorDiscoveryFailureCode: string | null;
  editorDiscoveryFailureStage: string | null;
  editorDiscoveryMissingSignal: string | null;
  postGateSnapshot: Record<string, unknown> | null;
  publishDomainCounts: PublishDomainCounts;
  sideEffectSummary: {
    preparePublishCalled: "NO" | "YES";
    contentMutationCount: number;
    uploadCount: number;
    finalSubmitCount: number;
  };
};

export type AnalyzeTask10AEvidenceInput = {
  logText: string;
  platformKey: string;
  accountId: string;
  operationId?: string;
  from?: string;
  to?: string;
  publishDomainCounts?: PublishDomainCounts;
};

const GATE_START_CODES = new Set(["PRE_SUBMIT_GATE_INSPECTION_STARTED", "XHS_CANONICAL_PAGE_OPERATION_STARTED"]);
const HEARTBEAT_CODE = "CANONICAL_SESSION_HEARTBEAT";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function contextPageId(context: Record<string, unknown>): string | null {
  return stringValue(context.pageDebugId) ?? stringValue(context.canonicalPageDebugId);
}

function timestampValue(event: EvidenceLogEvent): number {
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inTimeWindow(event: EvidenceLogEvent, from?: string, to?: string): boolean {
  const time = timestampValue(event);
  if (from) {
    const lower = Date.parse(from);
    if (Number.isFinite(lower) && time < lower) return false;
  }
  if (to) {
    const upper = Date.parse(to);
    if (Number.isFinite(upper) && time > upper) return false;
  }
  return true;
}

export function parseTask10AEvidenceLog(logText: string): EvidenceLogEvent[] {
  const events: EvidenceLogEvent[] = [];
  for (const line of logText.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || typeof parsed.code !== "string" || typeof parsed.timestamp !== "string" || !isRecord(parsed.context)) continue;
      events.push({
        timestamp: parsed.timestamp,
        ...(typeof parsed.level === "string" ? { level: parsed.level } : {}),
        ...(typeof parsed.module === "string" ? { module: parsed.module } : {}),
        code: parsed.code,
        ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
        context: parsed.context
      });
    } catch {
      // A concurrently written or manually truncated line is ignored.
    }
  }
  return events.sort((left, right) => timestampValue(left) - timestampValue(right));
}

function emptySummary(input: AnalyzeTask10AEvidenceInput, gateResult: string): Task10AEvidenceSummary {
  return {
    platformKey: input.platformKey,
    accountId: input.accountId,
    evidenceAmbiguous: gateResult === "AMBIGUOUS" ? "YES" : "NO",
    gateOperationId: null,
    contextDebugId: null,
    pageDebugId: null,
    loginContextId: null,
    canonicalPageId: null,
    preGateHeartbeat: null,
    postGateHeartbeat: null,
    gatePageRole: null,
    gatePageSource: null,
    gateCreatedNewPage: null,
    gateContextMatch: null,
    inspectionStarted: false,
    navigationHelperInvocationStarted: false,
    editorEntryStarted: false,
    homeReadinessSamples: [],
    creatorHomeShellReady: null,
    domTopologySummary: null,
    frameSummary: [],
    shadowDomSummary: [],
    publishSemanticTextSignalCount: null,
    publishSemanticNodes: [],
    accessibilityPublishSignals: [],
    discoveryDiagnosis: null,
    exactPublishTargets: [],
    publishTargetAncestorChains: [],
    eventListenerInspection: null,
    eventListenerDiagnostics: [],
    hitTestDiagnostics: [],
    publishNoteSurface: null,
    publishNoteSurfaceStatus: null,
    publishNotePreclickRevalidated: null,
    publishNoteNavigationClickCount: null,
    publishNoteUrlBefore: null,
    publishNoteUrlAfter: null,
    postPublishNoteState: null,
    imagePostSurfaceAfterPublishNote: null,
    navigationTransitionObserved: null,
    imagePostSurface: null,
    clickableSurfaceStatus: null,
    clickableSurfaceFailureCode: null,
    clickableSurfaceConfidence: null,
    diagnosticClickCount: null,
    mouseEventDispatchCount: null,
    keyboardEventCount: null,
    timeline: [],
    entrySteps: [],
    failureCode: null,
    failureStage: null,
    missingSignal: null,
    gateResult,
    editorEntryFailureCode: null,
    editorEntryFailureStage: null,
    editorEntryMissingSignal: null,
    editorEntryStartUrl: null,
    editorEntryFinalUrl: null,
    editorReached: null,
    authStillValid: null,
    contentType: null,
    contentTypeReady: null,
    titleEditorDetected: null,
    bodyEditorDetected: null,
    imageUploadControlDetected: null,
    publishSettingsAreaDetected: null,
    finalSubmitControlDetected: null,
    securityVerificationPresent: null,
    loginPagePresent: null,
    needsUserAction: null,
    imageEditorInspectionStarted: false,
    imageEditorReadinessSamples: [],
    imageEditorShellResult: null,
    titleEditorCandidates: [],
    titleEditorStatus: null,
    bodyEditorCandidates: [],
    bodyEditorStatus: null,
    imageUploadCandidates: [],
    imageUploadControlStatus: null,
    publishSettingsAreaStatus: null,
    finalSubmitCandidates: [],
    finalSubmitControlStatus: null,
    editorDiscoveryFailureCode: null,
    editorDiscoveryFailureStage: null,
    editorDiscoveryMissingSignal: null,
    postGateSnapshot: null,
    publishDomainCounts: input.publishDomainCounts ?? { publishJobs: 0, submissionIntents: 0, publishRecords: 0 },
    sideEffectSummary: { preparePublishCalled: "NO", contentMutationCount: 0, uploadCount: 0, finalSubmitCount: 0 }
  };
}

function operationIdFor(event: EvidenceLogEvent): string | null {
  return stringValue(event.context.operationId);
}

function isGateStart(event: EvidenceLogEvent): boolean {
  if (!GATE_START_CODES.has(event.code)) return false;
  if (event.code === "PRE_SUBMIT_GATE_INSPECTION_STARTED") return true;
  return event.context.action === "PRE_SUBMIT_GATE";
}

function findHeartbeat(events: EvidenceLogEvent[], phase: string, boundary: number, direction: "before" | "after", operationId: string): EvidenceLogEvent | null {
  const candidates = events.filter((event) => event.code === HEARTBEAT_CODE && event.context.phase === phase && (direction === "before" ? timestampValue(event) <= boundary : timestampValue(event) >= boundary));
  const operationScoped = candidates.filter((event) => event.context.operationId === operationId);
  const matches = operationScoped.length > 0 ? operationScoped : candidates.filter((event) => !event.context.operationId);
  matches.sort((left, right) => direction === "before" ? timestampValue(right) - timestampValue(left) : timestampValue(left) - timestampValue(right));
  return matches[0] ?? null;
}

function countOccurrences(events: EvidenceLogEvent[], patterns: RegExp[]): number {
  return events.reduce((count, event) => {
    const haystack = `${event.code} ${event.message ?? ""}`;
    return count + (patterns.some((pattern) => pattern.test(haystack)) ? 1 : 0);
  }, 0);
}

const FINAL_SUBMIT_MARKERS = new Set(["FINAL_SUBMIT_ATTEMPTED", "FINAL_SUBMIT_CLICKED", "SUBMIT_COMMITTED"]);

function isFinalSubmitMarker(event: EvidenceLogEvent): boolean {
  if (FINAL_SUBMIT_MARKERS.has(event.code)) return true;
  const action = stringValue(event.context.action);
  return action !== null && FINAL_SUBMIT_MARKERS.has(action);
}

function countFinalSubmitEvidence(events: EvidenceLogEvent[]): number {
  return events.reduce((count, event) => count + (isFinalSubmitMarker(event) ? 1 : 0), 0);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function analyzeTask10AEvidence(input: AnalyzeTask10AEvidenceInput): Task10AEvidenceSummary {
  const parsed = parseTask10AEvidenceLog(input.logText);
  const scoped = parsed.filter((event) => event.context.platformKey === input.platformKey && event.context.accountId === input.accountId && inTimeWindow(event, input.from, input.to));
  const operationGroups = new Map<string, EvidenceLogEvent[]>();
  for (const event of scoped) {
    const operationId = operationIdFor(event);
    if (!operationId) continue;
    const group = operationGroups.get(operationId) ?? [];
    group.push(event);
    operationGroups.set(operationId, group);
  }
  let candidates = [...operationGroups.entries()]
    .map(([operationId, events]) => ({ operationId, events: events.sort((left, right) => timestampValue(left) - timestampValue(right)), start: events.find(isGateStart) }))
    .filter((candidate): candidate is { operationId: string; events: EvidenceLogEvent[]; start: EvidenceLogEvent } => Boolean(candidate.start));
  if (input.operationId) candidates = candidates.filter((candidate) => candidate.operationId === input.operationId);
  if (candidates.length === 0) return emptySummary(input, "NOT_FOUND");

  candidates.sort((left, right) => timestampValue(right.start) - timestampValue(left.start));
  if (candidates.length > 1 && timestampValue(candidates[0]!.start) === timestampValue(candidates[1]!.start)) return emptySummary(input, "AMBIGUOUS");
  const selected = candidates[0]!;
  const gateEvents = selected.events;
  const startTime = timestampValue(selected.start);
  const canonicalCompletion = [...gateEvents].reverse().find((event) => event.code === "XHS_CANONICAL_PAGE_OPERATION_COMPLETED");
  const navigationFailure = [...gateEvents].reverse().find((event) => event.code === "EDITOR_NAVIGATION_FAILED");
  const completion = canonicalCompletion ?? navigationFailure;
  const endTime = completion ? timestampValue(completion) : startTime;
  const preHeartbeat = findHeartbeat(scoped, "PRE_SUBMIT_GATE_PRECHECK", startTime, "before", selected.operationId);
  const postHeartbeat = completion ? findHeartbeat(scoped, "POST_SUBMIT_GATE", endTime, "after", selected.operationId) : null;
  const inspection = gateEvents.find((event) => event.code === "PRE_SUBMIT_GATE_INSPECTION_STARTED") ?? gateEvents.find((event) => event.code === "XHS_CANONICAL_PAGE_OPERATION_STARTED");
  const finalContext = completion?.context ?? gateEvents[gateEvents.length - 1]?.context ?? {};
  const gateResult = completion ? (stringValue(finalContext.finalStatus) ?? "COMPLETED") : "INCOMPLETE";
  const steps = gateEvents.filter((event) => event.code === "EDITOR_ENTRY_STEP").map((event) => ({
    timestamp: event.timestamp,
    stepName: stringValue(event.context.stepName),
    success: booleanValue(event.context.success),
    selectorSignal: stringValue(event.context.selectorSignal),
    sanitizedUrlBefore: stringValue(event.context.sanitizedUrlBefore),
    sanitizedUrlAfter: stringValue(event.context.sanitizedUrlAfter),
    navigationTrigger: stringValue(event.context.navigationTrigger)
  }));
  const failureEvent = [...gateEvents].reverse().find((event) => stringValue(event.context.failureCode) || event.code === "EDITOR_NAVIGATION_FAILED");
  const failureContext = failureEvent?.context ?? finalContext;
  const failureCode = stringValue(failureContext.failureCode);
  const failureStage = stringValue(failureContext.failureStage);
  const missingSignal = stringValue(failureContext.missingSignal);
  const startStep = gateEvents.find((event) => event.code === "EDITOR_ENTRY_STARTED");
  const readinessEvents = gateEvents.filter((event) => event.code === "CREATOR_HOME_READINESS_SAMPLE");
  const topologyEvent = [...gateEvents].reverse().find((event) => event.code === "CREATOR_HOME_TOPOLOGY_OBSERVED");
  const semanticEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_SEMANTIC_NODES_OBSERVED");
  const semanticContext = semanticEvent?.context ?? {};
  const topologyContext = topologyEvent?.context ?? {};
  const exactTargetsEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_EXACT_TARGETS_OBSERVED");
  const ancestorChainsEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_TARGET_ANCESTOR_CHAINS");
  const surfaceEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_CLICK_SURFACE_DIAGNOSTICS");
  const hitTestEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_HIT_TEST_OBSERVED");
  const eventListenerEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_EVENT_LISTENERS_OBSERVED");
  const surfaceResolvedEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_NOTE_SURFACE_RESOLVED");
  const preClickEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_NOTE_SURFACE_PRECLICK_REVALIDATED");
  const navigationClickEvent = [...gateEvents].reverse().find((event) => event.code === "PUBLISH_NOTE_NAVIGATION_CLICK_COMPLETED") ?? [...gateEvents].reverse().find((event) => event.code === "PUBLISH_NOTE_NAVIGATION_CLICK_STARTED");
  const postPublishNoteStateEvent = [...gateEvents].reverse().find((event) => event.code === "POST_PUBLISH_NOTE_STATE_OBSERVED");
  const exactTargetsContext = exactTargetsEvent?.context ?? {};
  const ancestorChainsContext = ancestorChainsEvent?.context ?? {};
  const surfaceContext = surfaceEvent?.context ?? {};
  const hitTestContext = hitTestEvent?.context ?? {};
  const eventListenerContext = eventListenerEvent?.context ?? {};
  const frameEvent = [...gateEvents].reverse().find((event) => event.code === "FRAME_TOPOLOGY_OBSERVED");
  const shadowEvent = [...gateEvents].reverse().find((event) => event.code === "SHADOW_TOPOLOGY_OBSERVED");
  const accessibilityEvent = [...gateEvents].reverse().find((event) => event.code === "ACCESSIBILITY_PUBLISH_SIGNALS_OBSERVED");
  const imageEditorInspectionStartedEvent = gateEvents.find((event) => event.code === "IMAGE_EDITOR_INSPECTION_STARTED");
  const imageEditorReadinessEvents = gateEvents.filter((event) => event.code === "IMAGE_EDITOR_READINESS_SAMPLE");
  const imageEditorShellEvent = [...gateEvents].reverse().find((event) => event.code === "IMAGE_EDITOR_SHELL_READY" || event.code === "IMAGE_EDITOR_SHELL_NOT_READY" || event.code === "IMAGE_EDITOR_SHELL_TIMEOUT");
  const imageEditorContentTypeEvent = [...gateEvents].reverse().find((event) => event.code === "IMAGE_EDITOR_CONTENT_TYPE_OBSERVED");
  const imageEditorControlsEvent = [...gateEvents].reverse().find((event) => event.code === "IMAGE_EDITOR_CONTROLS_DISCOVERED");
  const imageEditorFailureEvent = [...gateEvents].reverse().find((event) => event.code === "IMAGE_EDITOR_INSPECTION_FAILED");
  const imageEditorControlsContext = imageEditorControlsEvent?.context ?? {};
  const imageEditorControl = (field: string): Record<string, unknown> => isRecord(imageEditorControlsContext[field]) ? imageEditorControlsContext[field] : {};
  const imageEditorCandidates = (field: string): unknown[] => Array.isArray(imageEditorControl(field).candidates) ? imageEditorControl(field).candidates as unknown[] : [];
  const result: Task10AEvidenceSummary = {
    ...emptySummary(input, gateResult),
    evidenceAmbiguous: "NO",
    gateOperationId: selected.operationId,
    contextDebugId: stringValue(inspection?.context.contextDebugId) ?? stringValue(preHeartbeat?.context.contextDebugId),
    pageDebugId: contextPageId(inspection?.context ?? {}) ?? contextPageId(preHeartbeat?.context ?? {}),
    loginContextId: stringValue(preHeartbeat?.context.contextDebugId),
    canonicalPageId: stringValue(preHeartbeat?.context.canonicalPageDebugId) ?? contextPageId(preHeartbeat?.context ?? {}),
    preGateHeartbeat: preHeartbeat?.context ?? null,
    postGateHeartbeat: postHeartbeat?.context ?? null,
    gatePageRole: stringValue(inspection?.context.pageRole),
    gatePageSource: stringValue(inspection?.context.pageSource),
    gateCreatedNewPage: booleanValue(inspection?.context.createdNewPage),
    gateContextMatch: booleanValue(inspection?.context.pageContextMatchesSession),
    inspectionStarted: gateEvents.some((event) => event.code === "PRE_SUBMIT_GATE_INSPECTION_STARTED"),
    navigationHelperInvocationStarted: gateEvents.some((event) => event.code === "EDITOR_NAVIGATION_HELPER_INVOCATION_STARTED"),
    editorEntryStarted: gateEvents.some((event) => event.code === "EDITOR_ENTRY_STARTED"),
    homeReadinessSamples: readinessEvents.map((event) => event.context),
    creatorHomeShellReady: stringValue(readinessEvents[readinessEvents.length - 1]?.context.readinessResult),
    domTopologySummary: topologyEvent?.context ?? null,
    frameSummary: Array.isArray(frameEvent?.context.frameSummary) ? frameEvent.context.frameSummary : Array.isArray(topologyContext.frameSummary) ? topologyContext.frameSummary : [],
    shadowDomSummary: Array.isArray(shadowEvent?.context.shadowSummary) ? shadowEvent.context.shadowSummary : Array.isArray(topologyContext.shadowSummary) ? topologyContext.shadowSummary : [],
    publishSemanticTextSignalCount: typeof semanticContext.publishSemanticTextSignalCount === "number" ? semanticContext.publishSemanticTextSignalCount : typeof semanticContext.candidateCount === "number" ? semanticContext.candidateCount : null,
    publishSemanticNodes: Array.isArray(semanticContext.semanticNodes) ? semanticContext.semanticNodes : [],
    accessibilityPublishSignals: Array.isArray(accessibilityEvent?.context.accessibilityPublishSignals) ? accessibilityEvent.context.accessibilityPublishSignals : Array.isArray(semanticContext.accessibilityPublishSignals) ? semanticContext.accessibilityPublishSignals : [],
    discoveryDiagnosis: stringValue(semanticContext.discoveryDiagnosis),
    exactPublishTargets: Array.isArray(exactTargetsContext.exactPublishSemanticTargets) ? exactTargetsContext.exactPublishSemanticTargets : [],
    publishTargetAncestorChains: Array.isArray(ancestorChainsContext.ancestorChainDiagnostics) ? ancestorChainsContext.ancestorChainDiagnostics : Array.isArray(surfaceContext.ancestorChainDiagnostics) ? surfaceContext.ancestorChainDiagnostics : [],
    eventListenerInspection: stringValue(eventListenerContext.eventListenerInspection),
    eventListenerDiagnostics: Array.isArray(eventListenerContext.eventListenerDiagnostics) ? eventListenerContext.eventListenerDiagnostics : [],
    hitTestDiagnostics: Array.isArray(hitTestContext.hitTestDiagnostics) ? hitTestContext.hitTestDiagnostics : [],
    publishNoteSurface: isRecord(surfaceContext.publishNoteSurface) ? surfaceContext.publishNoteSurface : null,
    publishNoteSurfaceStatus: stringValue(surfaceResolvedEvent?.context.status) ?? stringValue(surfaceContext.publishNoteSurfaceStatus) ?? (isRecord(surfaceContext.publishNoteSurface) ? stringValue(surfaceContext.publishNoteSurface.status) : null),
    publishNotePreclickRevalidated: booleanValue(preClickEvent?.context.revalidated) ?? booleanValue(surfaceContext.publishNotePreclickRevalidated),
    publishNoteNavigationClickCount: numberValue(navigationClickEvent?.context.navigationClickCount) ?? numberValue(surfaceContext.publishNoteNavigationClickCount),
    publishNoteUrlBefore: stringValue(navigationClickEvent?.context.sanitizedUrlBefore) ?? stringValue(surfaceContext.publishNoteUrlBefore),
    publishNoteUrlAfter: stringValue(navigationClickEvent?.context.sanitizedUrlAfter) ?? stringValue(surfaceContext.publishNoteUrlAfter),
    postPublishNoteState: stringValue(postPublishNoteStateEvent?.context.state) ?? stringValue(postPublishNoteStateEvent?.context.postPublishNoteState),
    imagePostSurfaceAfterPublishNote: isRecord(postPublishNoteStateEvent?.context.imagePostSurfaceAfterPublishNote) ? postPublishNoteStateEvent.context.imagePostSurfaceAfterPublishNote : null,
    navigationTransitionObserved: booleanValue(navigationClickEvent?.context.navigationTransition) ?? booleanValue(surfaceContext.navigationTransitionObserved),
    imagePostSurface: isRecord(surfaceContext.imagePostSurface) ? surfaceContext.imagePostSurface : null,
    clickableSurfaceStatus: stringValue(surfaceContext.clickableSurfaceStatus),
    clickableSurfaceFailureCode: stringValue(surfaceContext.clickableSurfaceFailureCode),
    clickableSurfaceConfidence: stringValue(surfaceContext.clickableSurfaceConfidence),
    diagnosticClickCount: typeof surfaceContext.diagnosticClickCount === "number" ? surfaceContext.diagnosticClickCount : null,
    mouseEventDispatchCount: typeof surfaceContext.mouseEventDispatchCount === "number" ? surfaceContext.mouseEventDispatchCount : null,
    keyboardEventCount: typeof surfaceContext.keyboardEventCount === "number" ? surfaceContext.keyboardEventCount : null,
    timeline: [
      ...(preHeartbeat ? [{ timestamp: preHeartbeat.timestamp, code: preHeartbeat.code, context: preHeartbeat.context }] : []),
      ...gateEvents.map((event) => ({ timestamp: event.timestamp, code: event.code, context: event.context })),
      ...(postHeartbeat ? [{ timestamp: postHeartbeat.timestamp, code: postHeartbeat.code, context: postHeartbeat.context }] : [])
    ],
    entrySteps: steps,
    failureCode,
    failureStage,
    missingSignal,
    editorEntryFailureCode: failureCode,
    editorEntryFailureStage: failureStage,
    editorEntryMissingSignal: missingSignal,
    editorEntryStartUrl: stringValue(startStep?.context.startUrl) ?? stringValue(inspection?.context.startUrl),
    editorEntryFinalUrl: stringValue(finalContext.sanitizedFinalUrl) ?? stringValue(finalContext.sanitizedUrlAfter),
    editorReached: booleanValue(finalContext.editorReached),
    authStillValid: booleanValue(finalContext.authStillValid),
    contentType: stringValue(imageEditorContentTypeEvent?.context.contentType) ?? stringValue(finalContext.contentType),
    contentTypeReady: booleanValue(imageEditorContentTypeEvent?.context.contentTypeReady) ?? booleanValue(finalContext.contentTypeReady),
    titleEditorDetected: booleanValue(imageEditorControlsContext.titleEditor && isRecord(imageEditorControlsContext.titleEditor) ? imageEditorControlsContext.titleEditor.detected : undefined) ?? booleanValue(finalContext.titleEditorDetected),
    bodyEditorDetected: booleanValue(imageEditorControlsContext.bodyEditor && isRecord(imageEditorControlsContext.bodyEditor) ? imageEditorControlsContext.bodyEditor.detected : undefined) ?? booleanValue(finalContext.bodyEditorDetected),
    imageUploadControlDetected: booleanValue(imageEditorControlsContext.imageUploadControl && isRecord(imageEditorControlsContext.imageUploadControl) ? imageEditorControlsContext.imageUploadControl.detected : undefined) ?? booleanValue(finalContext.imageUploadControlDetected),
    publishSettingsAreaDetected: booleanValue(imageEditorControlsContext.publishSettingsArea && isRecord(imageEditorControlsContext.publishSettingsArea) ? imageEditorControlsContext.publishSettingsArea.detected : undefined) ?? booleanValue(finalContext.publishSettingsAreaDetected),
    finalSubmitControlDetected: booleanValue(imageEditorControlsContext.finalSubmitControl && isRecord(imageEditorControlsContext.finalSubmitControl) ? imageEditorControlsContext.finalSubmitControl.detected : undefined) ?? booleanValue(finalContext.finalSubmitControlDetected),
    securityVerificationPresent: booleanValue(finalContext.securityVerificationPresent),
    loginPagePresent: booleanValue(finalContext.loginPagePresent),
    needsUserAction: booleanValue(finalContext.needsUserAction),
    imageEditorInspectionStarted: Boolean(imageEditorInspectionStartedEvent),
    imageEditorReadinessSamples: imageEditorReadinessEvents.map((event) => event.context),
    imageEditorShellResult: stringValue(imageEditorShellEvent?.context.shellStatus) ?? imageEditorShellEvent?.code ?? null,
    titleEditorCandidates: imageEditorCandidates("titleEditor"),
    titleEditorStatus: stringValue(imageEditorControl("titleEditor").status),
    bodyEditorCandidates: imageEditorCandidates("bodyEditor"),
    bodyEditorStatus: stringValue(imageEditorControl("bodyEditor").status),
    imageUploadCandidates: imageEditorCandidates("imageUploadControl"),
    imageUploadControlStatus: stringValue(imageEditorControl("imageUploadControl").status),
    publishSettingsAreaStatus: stringValue(imageEditorControl("publishSettingsArea").status),
    finalSubmitCandidates: imageEditorCandidates("finalSubmitControl"),
    finalSubmitControlStatus: stringValue(imageEditorControl("finalSubmitControl").status),
    editorDiscoveryFailureCode: stringValue(imageEditorFailureEvent?.context.failureCode) ?? (failureStage === "EDITOR_DISCOVERY" ? failureCode : null),
    editorDiscoveryFailureStage: stringValue(imageEditorFailureEvent?.context.failureStage) ?? (failureStage === "EDITOR_DISCOVERY" ? failureStage : null),
    editorDiscoveryMissingSignal: stringValue(imageEditorFailureEvent?.context.missingSignal) ?? (failureStage === "EDITOR_DISCOVERY" ? missingSignal : null),
    postGateSnapshot: postHeartbeat?.context ?? null,
    sideEffectSummary: {
      preparePublishCalled: countOccurrences(gateEvents, [/preparePublish/iu]) > 0 ? "YES" : "NO",
      contentMutationCount: countOccurrences(gateEvents, [/setInputFiles|\.fill|\.type|insertText|keyboard/iu]),
      uploadCount: countOccurrences(gateEvents, [/upload/iu]),
      finalSubmitCount: countFinalSubmitEvidence(gateEvents)
    }
  };
  // Keep the result tied to the selected lifecycle even when the final event is a non-terminal diagnostic.
  if (!completion && !result.failureCode) {
    result.gateResult = "INCOMPLETE";
    result.needsUserAction = null;
  }
  return result;
}
