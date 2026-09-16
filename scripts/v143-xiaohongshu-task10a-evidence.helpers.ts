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
  imageEditorPhase: string | null;
  imageEditorPhaseConfidence: string | null;
  imageEditorPhaseReason: string | null;
  preSubmitGatePhase: string | null;
  preUploadGateStatus: string | null;
  preUploadGateFailureCode: string | null;
  postUploadControlsStatus: string | null;
  preSubmitGatePassMeaning: string | null;
  postUploadReadinessDurationMs: number | null;
  postUploadReadinessSampleCount: number | null;
  postUploadTerminalStateReached: boolean | null;
  postUploadIntermediateState: string | null;
  postUploadPhase: string | null;
  postUploadPhaseConfidence: string | null;
  postUploadPhaseReason: string | null;
  postUploadSemanticNodes: unknown[];
  postUploadInteractiveTopology: Record<string, unknown> | null;
  postUploadMediaPreviewDiagnostics: Record<string, unknown> | null;
  postUploadModalState: Record<string, unknown> | null;
  intermediateActionCandidates: unknown[];
  preUploadSemanticNodes: unknown[];
  uploadControlRelationships: unknown[];
  uploadCapabilityStatus: string | null;
  uploadCapabilityPresent: boolean | null;
  uploadCapabilityUnique: boolean | null;
  imageEditorPhaseTopology: Record<string, unknown> | null;
  titleEditorCandidates: unknown[];
  titleEditorStatus: string | null;
  bodyEditorCandidates: unknown[];
  bodyEditorStatus: string | null;
  imageUploadCandidates: unknown[];
  imageUploadControlStatus: string | null;
  publishSettingsAreaStatus: string | null;
  finalSubmitCandidates: unknown[];
  finalSubmitControlStatus: string | null;
  productionSchemaVersion: string | null;
  task10sAuthTablePresent: boolean | null;
  expectedCreatorIdentity: unknown;
  observedCreatorIdentity: unknown;
  accountIdentityVerified: boolean | null;
  accountIdentityMismatch: boolean | null;
  activeUnusedAuthorizationCount: number | null;
  reusableOneShotOperationId: string | null;
  supersededUnusedAuthorizationCount: number | null;
  confirmIpcAttemptCount: number;
  confirmDuplicateSuppressedCount: number;
  confirmTransactionStatus: "NOT_STARTED" | "STARTED" | "COMMITTED" | "ROLLED_BACK" | "DUPLICATE_SUPPRESSED";
  authorizationCreated: "YES" | "NO" | "UNKNOWN";
  operationCreated: "YES" | "NO" | "UNKNOWN";
  publicationTransactionCount: number;
  partialConfirmationStateDetected: boolean;
  partialConfirmReconciliationStarted: boolean;
  partialConfirmReconciliationCommitted: boolean;
  partialConfirmReconciliationRolledBack: boolean;
  partialConfirmReconciliationResult: string | null;
  oneShotConfirmRetryEligible: boolean | null;
  reconciliationMutationCount: number;
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

const GATE_START_CODES = new Set(["PRE_SUBMIT_GATE_INSPECTION_STARTED", "XHS_CANONICAL_PAGE_OPERATION_STARTED", "PARTIAL_CONFIRMATION_STATE_DETECTED", "XHS_CREATOR_IDENTITY_PROOF"]);
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
    imageEditorPhase: null,
    imageEditorPhaseConfidence: null,
    imageEditorPhaseReason: null,
    preSubmitGatePhase: null,
    preUploadGateStatus: null,
    preUploadGateFailureCode: null,
    postUploadControlsStatus: null,
    preSubmitGatePassMeaning: null,
    postUploadReadinessDurationMs: null,
    postUploadReadinessSampleCount: null,
    postUploadTerminalStateReached: null,
    postUploadIntermediateState: null,
    postUploadPhase: null,
    postUploadPhaseConfidence: null,
    postUploadPhaseReason: null,
    postUploadSemanticNodes: [],
    postUploadInteractiveTopology: null,
    postUploadMediaPreviewDiagnostics: null,
    postUploadModalState: null,
    intermediateActionCandidates: [],
    preUploadSemanticNodes: [],
    uploadControlRelationships: [],
    uploadCapabilityStatus: null,
    uploadCapabilityPresent: null,
    uploadCapabilityUnique: null,
    imageEditorPhaseTopology: null,
    titleEditorCandidates: [],
    titleEditorStatus: null,
    bodyEditorCandidates: [],
    bodyEditorStatus: null,
    imageUploadCandidates: [],
    imageUploadControlStatus: null,
    publishSettingsAreaStatus: null,
    finalSubmitCandidates: [],
    finalSubmitControlStatus: null,
    productionSchemaVersion: null,
    task10sAuthTablePresent: null,
    expectedCreatorIdentity: null,
    observedCreatorIdentity: null,
    accountIdentityVerified: null,
    accountIdentityMismatch: null,
    activeUnusedAuthorizationCount: null,
    reusableOneShotOperationId: null,
    supersededUnusedAuthorizationCount: null,
    confirmIpcAttemptCount: 0,
    confirmDuplicateSuppressedCount: 0,
    confirmTransactionStatus: "NOT_STARTED",
    authorizationCreated: "UNKNOWN",
    operationCreated: "UNKNOWN",
    publicationTransactionCount: 0,
    partialConfirmationStateDetected: false,
    partialConfirmReconciliationStarted: false,
    partialConfirmReconciliationCommitted: false,
    partialConfirmReconciliationRolledBack: false,
    partialConfirmReconciliationResult: null,
    oneShotConfirmRetryEligible: null,
    reconciliationMutationCount: 0,
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
  if (event.code === "PARTIAL_CONFIRMATION_STATE_DETECTED") return true;
  if (event.code === "PRE_SUBMIT_GATE_INSPECTION_STARTED") return true;
  if (event.code === "XHS_CREATOR_IDENTITY_PROOF") return true;
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
const PREPARE_PUBLISH_MARKERS = new Set(["PREPARE_PUBLISH_STARTED"]);
const UPLOAD_MUTATION_MARKERS = new Set(["IMAGE_UPLOAD_STARTED", "SET_INPUT_FILES_CALLED", "UPLOAD_MUTATION_EXECUTED"]);
const CONFIRM_IPC_ATTEMPT_MARKERS = new Set(["CONFIRM_IPC_ATTEMPT", "CONFIRM_IPC_REQUEST_STARTED"]);
const CONFIRM_DUPLICATE_MARKER = "ONE_SHOT_CONFIRM_DUPLICATE_SUPPRESSED";
const PARTIAL_CONFIRMATION_MARKERS = new Set([
  "PARTIAL_CONFIRMATION_STATE_DETECTED",
  "PARTIAL_CONFIRM_RECONCILIATION_STARTED",
  "PARTIAL_CONFIRM_RECONCILIATION_COMMITTED",
  "PARTIAL_CONFIRM_RECONCILIATION_ROLLED_BACK",
  "PARTIAL_CONFIRM_RECONCILIATION_RESULT"
]);

function isFinalSubmitMarker(event: EvidenceLogEvent): boolean {
  if (FINAL_SUBMIT_MARKERS.has(event.code)) return true;
  const action = stringValue(event.context.action);
  return action !== null && FINAL_SUBMIT_MARKERS.has(action);
}

function countFinalSubmitEvidence(events: EvidenceLogEvent[]): number {
  return events.reduce((count, event) => count + (isFinalSubmitMarker(event) ? 1 : 0), 0);
}

function isPreparePublishMarker(event: EvidenceLogEvent): boolean {
  if (PREPARE_PUBLISH_MARKERS.has(event.code)) return true;
  const action = stringValue(event.context.action);
  return action !== null && PREPARE_PUBLISH_MARKERS.has(action);
}

function isUploadMutationMarker(event: EvidenceLogEvent): boolean {
  if (UPLOAD_MUTATION_MARKERS.has(event.code)) return true;
  const action = stringValue(event.context.action);
  return action !== null && UPLOAD_MUTATION_MARKERS.has(action);
}

function countUploadMutations(events: EvidenceLogEvent[]): number {
  return events.reduce((count, event) => count + (isUploadMutationMarker(event) ? 1 : 0), 0);
}

function isConfirmIpcAttempt(event: EvidenceLogEvent): boolean {
  if (CONFIRM_IPC_ATTEMPT_MARKERS.has(event.code)) return true;
  return event.code === "IPC_HANDLER_ERROR" && event.context.channel === "platform-self-test:confirm-one-shot-publish";
}

function latestBoolean(events: EvidenceLogEvent[], key: string): boolean | null {
  for (const event of [...events].reverse()) {
    const value = booleanValue(event.context[key]);
    if (value !== null) return value;
  }
  return null;
}

function confirmationStatus(events: EvidenceLogEvent[]): Task10AEvidenceSummary["confirmTransactionStatus"] {
  if (events.some((event) => event.code === "ONE_SHOT_CONFIRM_ROLLED_BACK")) return "ROLLED_BACK";
  if (events.some((event) => event.code === "ONE_SHOT_CONFIRM_COMMITTED")) return "COMMITTED";
  if (events.some((event) => event.code === "ONE_SHOT_CONFIRM_STARTED")) return "STARTED";
  if (events.some((event) => event.code === CONFIRM_DUPLICATE_MARKER)) return "DUPLICATE_SUPPRESSED";
  return "NOT_STARTED";
}

function authorizationCreated(events: EvidenceLogEvent[], status: Task10AEvidenceSummary["confirmTransactionStatus"]): Task10AEvidenceSummary["authorizationCreated"] {
  const explicit = latestBoolean(events, "authorizationCreated");
  if (explicit !== null) return explicit ? "YES" : "NO";
  if (status === "COMMITTED" || status === "DUPLICATE_SUPPRESSED") return "YES";
  if (status === "ROLLED_BACK") return "NO";
  return "UNKNOWN";
}

function operationCreated(events: EvidenceLogEvent[], status: Task10AEvidenceSummary["confirmTransactionStatus"]): Task10AEvidenceSummary["operationCreated"] {
  const explicit = latestBoolean(events, "operationCreated");
  if (explicit !== null) return explicit ? "YES" : "NO";
  if (events.some((event) => event.code === "XHS_ONE_SHOT_OPERATION_CREATED")) return "YES";
  if (status === "ROLLED_BACK" || status === "COMMITTED" || status === "DUPLICATE_SUPPRESSED") return "NO";
  return "UNKNOWN";
}

function publicationTransactionCount(events: EvidenceLogEvent[]): number {
  let count = 0;
  for (const event of events) {
    const value = numberValue(event.context.publicationTransactionCount);
    if (value !== null) count = Math.max(count, value);
    if (event.code === "PUBLICATION_TRANSACTION_STARTED" && value === null) count = Math.max(count, 1);
  }
  return count;
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
  const imageEditorControlsEvent = [...gateEvents].reverse().find((event) => event.code === "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED") ?? [...gateEvents].reverse().find((event) => event.code === "IMAGE_EDITOR_CONTROLS_DISCOVERED");
  const imageEditorPhaseEvent = [...gateEvents].reverse().find((event) => event.code === "IMAGE_EDITOR_PHASE_OBSERVED");
  const preUploadGateResultEvent = [...gateEvents].reverse().find((event) => event.code === "PRE_UPLOAD_GATE_RESULT");
  const imageEditorFailureEvent = [...gateEvents].reverse().find((event) => event.code === "IMAGE_EDITOR_INSPECTION_FAILED");
  const postUploadReadinessEvents = gateEvents.filter((event) => event.code === "POST_UPLOAD_EDITOR_READINESS_SAMPLE");
  const postUploadPhaseEvent = [...gateEvents].reverse().find((event) => event.code === "POST_UPLOAD_EDITOR_PHASE_OBSERVED");
  const postUploadSemanticEvent = [...gateEvents].reverse().find((event) => event.code === "POST_UPLOAD_EDITOR_SEMANTIC_INVENTORY_OBSERVED");
  const postUploadInteractiveEvent = [...gateEvents].reverse().find((event) => event.code === "POST_UPLOAD_EDITOR_INTERACTIVE_TOPOLOGY_OBSERVED");
  const postUploadMediaPreviewEvent = [...gateEvents].reverse().find((event) => event.code === "POST_UPLOAD_EDITOR_MEDIA_PREVIEW_OBSERVED");
  const postUploadModalEvent = [...gateEvents].reverse().find((event) => event.code === "POST_UPLOAD_EDITOR_MODAL_STATE_OBSERVED");
  const postUploadPhaseContext = postUploadPhaseEvent?.context ?? {};
  const imageEditorControlsContext = imageEditorControlsEvent?.context ?? {};
  const imageEditorPhaseContext = imageEditorPhaseEvent?.context ?? {};
  const preUploadGateContext = preUploadGateResultEvent?.context ?? {};
  const postUploadPhase = stringValue(postUploadPhaseContext.phase) ?? stringValue(postUploadPhaseContext.observedPhase);
  const postUploadPhaseConfidence = stringValue(postUploadPhaseContext.phaseConfidence);
  const postUploadPhaseReason = stringValue(postUploadPhaseContext.phaseReason);
  const postUploadIntermediateState = stringValue(postUploadPhaseContext.postUploadIntermediateState);
  const postUploadTerminalStateReached = booleanValue(postUploadPhaseContext.postUploadTerminalStateReached)
    ?? (postUploadPhase ? postUploadPhase === "IMAGE_POST_POST_UPLOAD_EDITOR" && stringValue(postUploadPhaseContext.postUploadControlsStatus) === "READY" : null);
  const postUploadReadinessLastContext = postUploadReadinessEvents[postUploadReadinessEvents.length - 1]?.context ?? {};
  const postUploadReadinessDurationMs = numberValue(postUploadPhaseContext.postUploadReadinessDurationMs)
    ?? numberValue(postUploadReadinessLastContext.elapsedMs);
  const postUploadReadinessSampleCount = numberValue(postUploadPhaseContext.postUploadReadinessSampleCount)
    ?? (postUploadReadinessEvents.length > 0 ? postUploadReadinessEvents.length : null);
  const postUploadIsTerminal = postUploadTerminalStateReached === true || postUploadPhase === "IMAGE_POST_POST_UPLOAD_EDITOR" && stringValue(postUploadPhaseContext.postUploadControlsStatus) === "READY";
  const postUploadHasPhaseObservation = Boolean(postUploadPhaseEvent || postUploadReadinessEvents.length > 0);
  const postUploadIntermediateActionCandidates = Array.isArray((postUploadModalEvent?.context ?? {}).intermediateActionCandidates)
    ? (postUploadModalEvent?.context.intermediateActionCandidates as unknown[])
    : Array.isArray(postUploadPhaseContext.intermediateActionCandidates) ? postUploadPhaseContext.intermediateActionCandidates as unknown[] : [];
  const postUploadPhaseFailureCode = postUploadHasPhaseObservation && !postUploadIsTerminal && postUploadPhase !== "LOGIN" && postUploadPhase !== "SECURITY_VERIFICATION"
    ? postUploadPhaseContext.failureCode === "POST_UPLOAD_EDITOR_TIMEOUT" || postUploadPhaseContext.failureCode === "POST_UPLOAD_INTERMEDIATE_STATE" || postUploadPhaseContext.failureCode === "POST_UPLOAD_INTERMEDIATE_ACTION_REQUIRED"
      ? postUploadPhaseContext.failureCode as string
      : postUploadIntermediateState
        ? (postUploadIntermediateActionCandidates.length > 0 ? "POST_UPLOAD_INTERMEDIATE_ACTION_REQUIRED" : "POST_UPLOAD_INTERMEDIATE_STATE")
        : "POST_UPLOAD_EDITOR_NOT_READY"
    : null;
  const effectiveFailureCode = postUploadPhaseFailureCode ?? failureCode;
  const effectiveFailureStage = postUploadPhaseFailureCode ? "EDITOR_DISCOVERY" : failureStage;
  const effectiveMissingSignal = postUploadPhaseFailureCode
    ? (postUploadIntermediateState ? "post-upload-intermediate-state" : "post-upload-terminal-phase")
    : missingSignal;
  const imageEditorControl = (field: string): Record<string, unknown> => isRecord(imageEditorControlsContext[field]) ? imageEditorControlsContext[field] : {};
  const imageEditorCandidates = (field: string): unknown[] => Array.isArray(imageEditorControl(field).candidates) ? imageEditorControl(field).candidates as unknown[] : [];
  const schemaReadyEvent = [...gateEvents].reverse().find((event) => event.code === "TASK10S_SCHEMA_READY");
  const schemaVersionEvent = [...gateEvents].reverse().find((event) => event.code === "MIGRATION_DISCOVERY" || event.code === "MIGRATION_APPLY_COMPLETED");
  const productionSchemaVersion = stringValue(schemaReadyEvent?.context.productionSchemaVersion)
    ?? stringValue(schemaReadyEvent?.context.schemaVersion)
    ?? (schemaReadyEvent ? "0023" : null)
    ?? stringValue(schemaVersionEvent?.context.productionSchemaVersion)
    ?? stringValue(schemaVersionEvent?.context.schemaVersion);
  const task10sAuthTablePresent = booleanValue(schemaReadyEvent?.context.authTablePresent) ?? (schemaReadyEvent ? true : null);
  const identityProofEvent = [...gateEvents].reverse().find((event) => event.code === "XHS_CREATOR_IDENTITY_PROOF");
  const identityConvergenceEvent = [...gateEvents].reverse().find((event) => event.code === "XHS_IDENTITY_AUTHORIZATION_CONVERGED");
  const confirmEvents = gateEvents.filter((event) => event.code === "CONFIRM_IPC_ATTEMPT" || event.code === "CONFIRM_IPC_REQUEST_STARTED" || event.code === "IPC_HANDLER_ERROR" || event.code === "ONE_SHOT_CONFIRM_STARTED" || event.code === "ONE_SHOT_CONFIRM_COMMITTED" || event.code === "ONE_SHOT_CONFIRM_ROLLED_BACK" || event.code === CONFIRM_DUPLICATE_MARKER);
  const reconciliationEvents = gateEvents.filter((event) => PARTIAL_CONFIRMATION_MARKERS.has(event.code));
  const reconciliationResultEvent = [...reconciliationEvents].reverse().find((event) => event.code === "PARTIAL_CONFIRM_RECONCILIATION_RESULT");
  const reconciliationMutationCount = reconciliationEvents.reduce((count, event) => Math.max(count, numberValue(event.context.mutationCount) ?? numberValue(event.context.reconciliationMutationCount) ?? 0), 0);
  const confirmStatus = confirmationStatus(confirmEvents);
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
    failureCode: effectiveFailureCode,
    failureStage: effectiveFailureStage,
    missingSignal: effectiveMissingSignal,
    editorEntryFailureCode: effectiveFailureCode,
    editorEntryFailureStage: effectiveFailureStage,
    editorEntryMissingSignal: effectiveMissingSignal,
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
    imageEditorPhase: stringValue(preUploadGateContext.imageEditorPhase) ?? stringValue(preUploadGateContext.phase) ?? stringValue(imageEditorPhaseContext.phase),
    imageEditorPhaseConfidence: stringValue(preUploadGateContext.imageEditorPhaseConfidence) ?? stringValue(preUploadGateContext.phaseConfidence) ?? stringValue(imageEditorPhaseContext.phaseConfidence),
    imageEditorPhaseReason: stringValue(preUploadGateContext.phaseReason) ?? stringValue(imageEditorPhaseContext.phaseReason),
    preSubmitGatePhase: stringValue(preUploadGateContext.preSubmitGatePhase),
    preUploadGateStatus: stringValue(preUploadGateContext.preUploadGateStatus),
    preUploadGateFailureCode: stringValue(preUploadGateContext.preUploadGateFailureCode),
    postUploadControlsStatus: stringValue(postUploadPhaseContext.postUploadControlsStatus) ?? stringValue(preUploadGateContext.postUploadControlsStatus),
    preSubmitGatePassMeaning: stringValue(preUploadGateContext.preSubmitGatePassMeaning),
    postUploadReadinessDurationMs,
    postUploadReadinessSampleCount,
    postUploadTerminalStateReached,
    postUploadIntermediateState,
    postUploadPhase,
    postUploadPhaseConfidence,
    postUploadPhaseReason,
    postUploadSemanticNodes: Array.isArray(postUploadSemanticEvent?.context.postUploadSemanticNodes) ? postUploadSemanticEvent.context.postUploadSemanticNodes : [],
    postUploadInteractiveTopology: isRecord(postUploadInteractiveEvent?.context.interactiveTopology) ? postUploadInteractiveEvent.context.interactiveTopology : null,
    postUploadMediaPreviewDiagnostics: isRecord(postUploadMediaPreviewEvent?.context.mediaPreviewDiagnostics) ? postUploadMediaPreviewEvent.context.mediaPreviewDiagnostics : null,
    postUploadModalState: isRecord(postUploadModalEvent?.context.modalDiagnostics) ? postUploadModalEvent.context.modalDiagnostics : null,
    intermediateActionCandidates: postUploadIntermediateActionCandidates,
    preUploadSemanticNodes: Array.isArray(imageEditorPhaseContext.preUploadSemanticNodes) ? imageEditorPhaseContext.preUploadSemanticNodes : [],
    uploadControlRelationships: Array.isArray(imageEditorPhaseContext.uploadControlRelationships) ? imageEditorPhaseContext.uploadControlRelationships : [],
    uploadCapabilityStatus: stringValue(imageEditorPhaseContext.uploadCapabilityStatus),
    uploadCapabilityPresent: booleanValue(preUploadGateContext.uploadCapabilityPresent) ?? booleanValue(imageEditorPhaseContext.uploadCapabilityPresent),
    uploadCapabilityUnique: booleanValue(preUploadGateContext.uploadCapabilityUnique) ?? booleanValue(imageEditorPhaseContext.uploadCapabilityUnique),
    imageEditorPhaseTopology: isRecord(imageEditorPhaseContext.phaseTopology) ? imageEditorPhaseContext.phaseTopology : null,
    titleEditorCandidates: imageEditorCandidates("titleEditor"),
    titleEditorStatus: stringValue(imageEditorControl("titleEditor").status),
    bodyEditorCandidates: imageEditorCandidates("bodyEditor"),
    bodyEditorStatus: stringValue(imageEditorControl("bodyEditor").status),
    imageUploadCandidates: imageEditorCandidates("imageUploadControl"),
    imageUploadControlStatus: stringValue(imageEditorControl("imageUploadControl").status),
    publishSettingsAreaStatus: stringValue(imageEditorControl("publishSettingsArea").status),
    finalSubmitCandidates: imageEditorCandidates("finalSubmitControl"),
    finalSubmitControlStatus: stringValue(imageEditorControl("finalSubmitControl").status),
    productionSchemaVersion,
    task10sAuthTablePresent,
    expectedCreatorIdentity: identityProofEvent?.context.EXPECTED_CREATOR_IDENTITY ?? null,
    observedCreatorIdentity: identityProofEvent?.context.OBSERVED_CREATOR_IDENTITY ?? null,
    accountIdentityVerified: booleanValue(identityConvergenceEvent?.context.ACCOUNT_IDENTITY_VERIFIED) ?? booleanValue(identityProofEvent?.context.ACCOUNT_IDENTITY_VERIFIED),
    accountIdentityMismatch: booleanValue(identityProofEvent?.context.ACCOUNT_IDENTITY_MISMATCH),
    activeUnusedAuthorizationCount: numberValue(identityConvergenceEvent?.context.ACTIVE_UNUSED_AUTHORIZATION_COUNT),
    reusableOneShotOperationId: stringValue(identityConvergenceEvent?.context.REUSABLE_ONE_SHOT_OPERATION_ID),
    supersededUnusedAuthorizationCount: numberValue(identityConvergenceEvent?.context.SUPERSEDED_UNUSED_AUTHORIZATION_COUNT),
    confirmIpcAttemptCount: confirmEvents.filter(isConfirmIpcAttempt).length,
    confirmDuplicateSuppressedCount: confirmEvents.filter((event) => event.code === CONFIRM_DUPLICATE_MARKER).length,
    confirmTransactionStatus: confirmStatus,
    authorizationCreated: authorizationCreated(confirmEvents, confirmStatus),
    operationCreated: operationCreated(confirmEvents, confirmStatus),
    publicationTransactionCount: publicationTransactionCount(gateEvents),
    partialConfirmationStateDetected: reconciliationEvents.some((event) => event.code === "PARTIAL_CONFIRMATION_STATE_DETECTED"),
    partialConfirmReconciliationStarted: reconciliationEvents.some((event) => event.code === "PARTIAL_CONFIRM_RECONCILIATION_STARTED"),
    partialConfirmReconciliationCommitted: reconciliationEvents.some((event) => event.code === "PARTIAL_CONFIRM_RECONCILIATION_COMMITTED"),
    partialConfirmReconciliationRolledBack: reconciliationEvents.some((event) => event.code === "PARTIAL_CONFIRM_RECONCILIATION_ROLLED_BACK"),
    partialConfirmReconciliationResult: stringValue(reconciliationResultEvent?.context.status) ?? stringValue(reconciliationResultEvent?.context.result),
    oneShotConfirmRetryEligible: latestBoolean(reconciliationEvents, "retryEligible") ?? latestBoolean(reconciliationEvents, "oneShotConfirmRetryEligible"),
    reconciliationMutationCount,
    editorDiscoveryFailureCode: postUploadPhaseFailureCode ?? stringValue(imageEditorFailureEvent?.context.failureCode) ?? (effectiveFailureStage === "EDITOR_DISCOVERY" ? effectiveFailureCode : null),
    editorDiscoveryFailureStage: postUploadPhaseFailureCode ? "EDITOR_DISCOVERY" : stringValue(imageEditorFailureEvent?.context.failureStage) ?? (effectiveFailureStage === "EDITOR_DISCOVERY" ? effectiveFailureStage : null),
    editorDiscoveryMissingSignal: postUploadPhaseFailureCode ? effectiveMissingSignal : stringValue(imageEditorFailureEvent?.context.missingSignal) ?? (effectiveFailureStage === "EDITOR_DISCOVERY" ? effectiveMissingSignal : null),
    postGateSnapshot: postHeartbeat?.context ?? null,
    sideEffectSummary: {
      preparePublishCalled: gateEvents.some(isPreparePublishMarker) ? "YES" : "NO",
      contentMutationCount: countOccurrences(gateEvents, [/setInputFiles|\.fill|\.type|insertText|keyboard/iu]),
      // Upload count is a mutation-attempt count. Diagnostic names such as
      // PRE_UPLOAD_* and POST_UPLOAD_* are deliberately not evidence of an upload.
      uploadCount: countUploadMutations(gateEvents),
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
