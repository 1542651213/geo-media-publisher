import type {
  AccountContext,
  LoginSession,
  LoginStatus,
  PlatformCapability,
  PublishArticleInput,
  PublishResult,
  PublishStatusResult,
  ValidationResult
} from "@publisher/domain";
import type { BrowserSessionOperationOptions, BrowserSessionRuntimeSnapshot, BrowserSessionRuntimeState } from "./browser";
import type { PlatformAdapter } from "./index";
import type { OneShotPublicationAuthorization, OneShotPublicationAuthorizationState, OneShotPublicationGuard } from "./one-shot-publication";
export type { OneShotPublicationAuthorization, OneShotPublicationGuard } from "./one-shot-publication";

export interface AutomationPrepareResult {
  prepared: boolean;
  requiresUserAction: boolean;
  message: string;
  sessionIdHash?: string;
  backendUrl?: string;
  editorOpenedAt?: string | null;
  titleFilled?: boolean;
  bodyFilled?: boolean;
  response: Record<string, unknown>;
}

export type ControlledSelfTestMode = "POST_UPLOAD_DISCOVERY_ONLY" | "XHS_PUBLISH_FLOW_EXPLORATION";

export interface PublishFlowExplorationInput {
  boundImages?: PublishArticleInput["boundImages"];
  imagePath: string;
  imageSource: "SAFE_TEST_FIXTURE";
  title: string;
  body: string;
  operationId?: string;
  postUploadReadinessStrategy?: "LEGACY" | "TERMINAL_CLASSIFIER";
  budgets?: Partial<PublishFlowExplorationBudgets>;
}

export interface OneShotRealPublishAcceptanceInput extends PublishFlowExplorationInput {
  authorization: OneShotPublicationAuthorization;
}

export interface OneShotRealPublishAcceptanceResult {
  operationId: string;
  status: "PUBLISHED_VERIFIED" | "NEEDS_RECONCILIATION" | "PLATFORM_REJECTED" | "BLOCKED";
  authorizationState: OneShotPublicationAuthorizationState;
  publicationTransactionCount: number;
  publicationCommitActionCount: number;
  finalSubmitAttemptCount: number;
  finalSubmitRetryCount: 0;
  finalSubmitActionStarted: boolean;
  finalSubmitActionCompleted: boolean;
  postSubmitObservation: Record<string, unknown>;
  publicationReconciled: boolean;
  externalId: string | null;
  externalUrl: string | null;
  publicPageVerified: boolean;
  response: Record<string, unknown>;
}

export interface PublishFlowExplorationBudgets {
  maxDurationMs: number;
  maxNavigationRestarts: number;
  maxUploadAttempts: number;
  maxIntermediateActionClicks: number;
  maxRefreshCount: number;
  maxTitleMutations: number;
  maxBodyMutations: number;
}

export interface PublishFlowExplorationCounters {
  navigationRestartCount: number;
  refreshCount: number;
  uploadAttempts: number;
  uploadMutationCount: number;
  uploadRetryCount: number;
  intermediateActionClickCount: number;
  titleMutationCount: number;
  bodyMutationCount: number;
  settingsMutationCount: number;
  contentMutationCount: number;
  finalSubmitCount: number;
}

export interface PublishFlowExplorationTimelineEntry {
  timestamp: string;
  url: string;
  phase: string;
  action: string;
  result: string;
}

export interface PublishFlowFieldEvidence {
  attempted: boolean;
  mutationCount: number;
  strategyCount: number;
  readbackVerified: boolean;
  readbackLength?: number;
  readbackValue?: string;
  readbackHash?: string;
}

export interface PublishFlowExplorationResult {
  mode: "XHS_PUBLISH_FLOW_EXPLORATION";
  status: "PASS_READY_FOR_FINAL_SUBMIT" | "BLOCKED" | "SAFETY_BOUNDARY_VIOLATION";
  operationId: string;
  platformKey: string;
  accountId: string;
  imageSource: "SAFE_TEST_FIXTURE";
  sameCanonicalPage: boolean;
  sameContext: boolean;
  timeline: readonly PublishFlowExplorationTimelineEntry[];
  states: readonly Record<string, unknown>[];
  actions: readonly Record<string, unknown>[];
  selectors: readonly Record<string, unknown>[];
  counters: PublishFlowExplorationCounters;
  /** Flattened safety counters are kept for audit consumers that do not unpack nested evidence. */
  uploadAttempts: number;
  uploadMutationCount: number;
  uploadRetryCount: number;
  intermediateActionClickCount: number;
  titleMutationCount: number;
  bodyMutationCount: number;
  settingsMutationCount: number;
  contentMutationCount: number;
  finalSubmitCount: 0;
  budgets: PublishFlowExplorationBudgets;
  title: PublishFlowFieldEvidence;
  titleReadbackVerified: boolean;
  body: PublishFlowFieldEvidence;
  bodyReadbackVerified: boolean;
  requiredSettings: { status: string; mutations: readonly Record<string, unknown>[] };
  finalSubmit: { status: string; visible: boolean; enabled: boolean; hitTestValid: boolean; label?: string };
  /** Read-only stabilization evidence collected after a native picker cancel. */
  afterPickerCancelUrl?: string;
  afterPickerCancelWaitMs?: number;
  finalControlDiscoveryRetryCount?: number;
  finalControlFoundAfterWait?: boolean;
  forbiddenMutationObserved: boolean;
  blocker: string | null;
  failureCode?: string | null;
  failureStage?: string | null;
  missingSignal?: string | null;
  readyForFinalSubmit: boolean;
  database?: { before: Record<string, number>; after: Record<string, number> };
  evidence: Record<string, unknown>;
}

export interface ControlledPostUploadDiscoveryResult {
  mode: "POST_UPLOAD_DISCOVERY_ONLY";
  status: "PASS" | "FAIL";
  operationId: string;
  platformKey: string;
  accountId: string;
  imageSource: "SAFE_TEST_FIXTURE";
  sanitizedUrlBefore: string | null;
  sanitizedUrlAfter: string | null;
  preUploadGateStatus: "PASS" | "FAIL";
  preUploadMutationRevalidated: boolean;
  uploadMutationCount: number;
  uploadCompletionObserved: boolean;
  postUploadPhase: string | null;
  postUploadPhaseConfidence: string | null;
  postUploadControlsStatus: "READY" | "FAIL";
  titleEditorStatus: string;
  bodyEditorStatus: string;
  finalSubmitStatus: string;
  contentMutationCount: number;
  finalSubmitCount: number;
  sameCanonicalPage: boolean;
  sameContext: boolean;
  failureCode: string | null;
  failureStage: string | null;
  missingSignal: string | null;
  evidence: Record<string, unknown>;
}

export type PreSubmitGateStatus = "ready" | "needs_user_action" | "auth_expired" | "editor_not_found" | "security_verification_required";

export type PreSubmitGateFailureCode =
  | "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND"
  | "CANONICAL_PAGE_UNAVAILABLE"
  | "CANONICAL_PAGE_OWNERSHIP_FAILURE"
  | "BROWSER_SESSION_DISCONNECTED"
  | "PUBLISH_ENTRY_NOT_FOUND"
  | "PUBLISH_ENTRY_AMBIGUOUS"
  | "PUBLISH_ENTRY_NOT_VISIBLE"
  | "PUBLISH_ENTRY_DISABLED"
  | "PUBLISH_ENTRY_DIAGNOSTIC_FAILED"
  | "PUBLISH_SEMANTIC_TARGET_NOT_FOUND"
  | "PUBLISH_SEMANTIC_TARGET_AMBIGUOUS"
  | "PUBLISH_CLICK_SURFACE_NOT_FOUND"
  | "PUBLISH_CLICK_SURFACE_AMBIGUOUS"
  | "PUBLISH_CLICK_SURFACE_NOT_VISIBLE"
  | "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED"
  | "PUBLISH_CLICK_SURFACE_DIAGNOSTIC_FAILED"
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
  | "PUBLISH_ENTRY_CLICK_NO_TRANSITION"
  | "PUBLISH_ENTRY_CLICK_FAILED"
  | "CONTENT_TYPE_ENTRY_NOT_FOUND"
  | "CONTENT_TYPE_SELECTION_FAILED"
  | "EDITOR_NAVIGATION_TIMEOUT"
  | "EDITOR_ROUTE_NOT_REACHED"
  | "EDITOR_SELECTOR_DRIFT"
  | "IMAGE_EDITOR_SHELL_TIMEOUT"
  | "PRE_UPLOAD_PHASE_NOT_READY"
  | "UPLOAD_CAPABILITY_NOT_VERIFIED"
  | "POST_UPLOAD_EDITOR_TIMEOUT"
  | "POST_UPLOAD_EDITOR_NOT_READY"
  | "POST_UPLOAD_INTERMEDIATE_STATE"
  | "POST_UPLOAD_INTERMEDIATE_ACTION_REQUIRED"
  | "POST_UPLOAD_PHASE_NOT_READY"
  | "CONTENT_TYPE_NOT_READY"
  | "TITLE_EDITOR_NOT_FOUND"
  | "TITLE_EDITOR_AMBIGUOUS"
  | "TITLE_EDITOR_NOT_VISIBLE"
  | "TITLE_EDITOR_DISABLED"
  | "BODY_EDITOR_NOT_FOUND"
  | "BODY_EDITOR_AMBIGUOUS"
  | "BODY_EDITOR_NOT_VISIBLE"
  | "BODY_EDITOR_DISABLED"
  | "IMAGE_UPLOAD_CONTROL_NOT_FOUND"
  | "IMAGE_UPLOAD_CONTROL_AMBIGUOUS"
  | "IMAGE_UPLOAD_CONTROL_NOT_VISIBLE"
  | "IMAGE_UPLOAD_CONTROL_DISABLED"
  | "FINAL_SUBMIT_CONTROL_NOT_FOUND"
  | "FINAL_SUBMIT_CONTROL_AMBIGUOUS"
  | "FINAL_SUBMIT_CONTROL_NOT_VISIBLE"
  | "FINAL_SUBMIT_CONTROL_DISABLED"
  | "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD"
  | "TITLE_EDITOR_AMBIGUOUS_POST_UPLOAD"
  | "TITLE_EDITOR_NOT_VISIBLE_POST_UPLOAD"
  | "TITLE_EDITOR_DISABLED_POST_UPLOAD"
  | "BODY_EDITOR_NOT_FOUND_POST_UPLOAD"
  | "BODY_EDITOR_AMBIGUOUS_POST_UPLOAD"
  | "BODY_EDITOR_NOT_VISIBLE_POST_UPLOAD"
  | "BODY_EDITOR_DISABLED_POST_UPLOAD"
  | "FINAL_SUBMIT_CONTROL_NOT_FOUND_POST_UPLOAD"
  | "FINAL_SUBMIT_CONTROL_AMBIGUOUS_POST_UPLOAD"
  | "FINAL_SUBMIT_CONTROL_NOT_VISIBLE_POST_UPLOAD"
  | "FINAL_SUBMIT_CONTROL_DISABLED_POST_UPLOAD"
  | "UPLOAD_COMPLETION_NOT_OBSERVED"
  | "EDITOR_CONTROL_AMBIGUOUS"
  | "AUTH_REDIRECTED_TO_LOGIN"
  | "SECURITY_VERIFICATION_REQUIRED"
  | "UNKNOWN_UI_STATE";

export type PreSubmitGateFailureStage =
  | "AUTHENTICATION"
  | "SESSION_PAGE_LIFECYCLE"
  | "CREATOR_HOME"
  | "PUBLISH_ENTRY_DISCOVERY"
  | "PUBLISH_ENTRY_CLICK"
  | "CONTENT_TYPE_SELECTION"
  | "EDITOR_NAVIGATION"
  | "EDITOR_ROUTE"
  | "EDITOR_DISCOVERY";

/** Read-only editor readiness evidence. It deliberately contains no Page/Locator or content values. */
export interface PreSubmitGateResult {
  status: PreSubmitGateStatus;
  editorReached: boolean;
  authStillValid: boolean;
  contentType: string | null;
  contentTypeReady: boolean;
  titleEditorDetected: boolean;
  bodyEditorDetected: boolean;
  imageUploadControlDetected: boolean;
  publishSettingsAreaDetected: boolean;
  finalSubmitControlDetected: boolean;
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  needsUserAction: boolean;
  sanitizedUrl: string | null;
  editorEntrySideEffectRisk?: "NONE_OBSERVED" | "UNKNOWN";
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string | null;
  preSubmitGatePhase?: "PRE_UPLOAD" | "POST_UPLOAD";
  preUploadGateStatus?: "PASS" | "FAIL";
  preUploadGateFailureCode?: PreSubmitGateFailureCode | null;
  imageEditorPhase?: string | null;
  imageEditorPhaseConfidence?: string | null;
  uploadCapabilityPresent?: boolean;
  postUploadControlsStatus?: "READY" | "NOT_APPLICABLE_BEFORE_UPLOAD" | "FAIL";
  preSubmitGatePassMeaning?: string | null;
}

export interface AutomationAdapter extends PlatformAdapter {
  readonly automationType: PlatformCapability;
  connectAccount(ctx: AccountContext): Promise<LoginSession>;
  isConnectionPending(ctx: AccountContext): boolean;
  completeConnection(ctx: AccountContext): Promise<LoginStatus>;
  cancelConnection?(ctx: AccountContext): Promise<void>;
  checkSession(ctx: AccountContext): Promise<LoginStatus>;
  openBackend(ctx: AccountContext): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string }>;
  /** Optional side-effect-free editor discovery. This must never call preparePublish or mutate content. */
  inspectPublishEditor?(ctx: AccountContext): Promise<PreSubmitGateResult>;
  /** Optional controlled upload-only self-test. It may upload exactly one approved fixture, then must stop before content mutation or final submit. */
  runControlledPostUploadDiscovery?(ctx: AccountContext, input: { imagePath: string; imageSource: "SAFE_TEST_FIXTURE"; onUploadMutationStarted?: () => void }): Promise<ControlledPostUploadDiscoveryResult>;
  /** Optional bounded XHS exploration. It must never activate final publication. */
  runPublishFlowExploration?(ctx: AccountContext, input: PublishFlowExplorationInput): Promise<PublishFlowExplorationResult>;
  /** Optional bounded recovery of an editor for an existing Prepared Job. It must never create persistence rows or submit. */
  recoverPreparedEditor?(ctx: AccountContext, input: PublishFlowExplorationInput): Promise<PublishFlowExplorationResult>;
  /** Explicit Task10S path. It must be XHS/account/operation scoped and use the supplied guard for the only real submit. */
  runOneShotRealPublishAcceptance?(ctx: AccountContext, input: OneShotRealPublishAcceptanceInput & { oneShotPublicationGuard: OneShotPublicationGuard }): Promise<OneShotRealPublishAcceptanceResult>;
  preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult>;
  /** Runs an ordinary task-owned operation in one account-scoped browser Session. Retained/manual flows must not use this hook. */
  runWithBrowserSession?<T>(ctx: AccountContext, callerOperation: string, task: () => Promise<T>, options?: BrowserSessionOperationOptions): Promise<T>;
  verifyPublish(ctx: AccountContext, externalId?: string): Promise<PublishStatusResult>;
  logout(ctx: AccountContext): Promise<void>;
  /** Releases the account/job session after a BACKGROUND operation; VISIBLE sessions remain available for user handling. */
  releaseOperationSession?(ctx: AccountContext): Promise<void>;
  /** Releases the visible login-only session after account identity has been persisted. */
  releaseConnectionSession?(ctx: AccountContext): Promise<void>;
  /** Releases only the visible connection Page while retaining the owned Context when supported. */
  releaseConnectionPage?(ctx: AccountContext): Promise<void>;
  /** Persists a deferred visible login Session after same-Page identity readback. */
  persistConnectionSession?(ctx: AccountContext): Promise<void>;
  /** Rebinds a just-connected account-scoped Session to a uniquely restored archived account. */
  rebindAccountSession?(from: AccountContext, to: AccountContext): void;
  /** Returns non-secret evidence proving which account-scoped browser Page is being used. */
  getBrowserSessionEvidence?(ctx: AccountContext): Promise<{
    platformKey: string;
    accountId: string;
    sessionKey: string;
    sessionIdHash: string;
    pageUrl: string;
    pageTitle: string;
    pageCount: number;
    ownerVisiblePage: boolean;
    storageMode?: "EPHEMERAL_STORAGE_STATE" | "PERSISTENT_PROFILE";
    profilePath?: string | null;
  } | null>;
  /** Returns process-memory-only adapter/runtime IDs for connection diagnostics. */
  getBrowserConnectionDebugIds?(): { adapterDebugId: string; browserSessionManagerDebugId: string };
  /** Returns process-memory-only account-scoped active-session state; never includes cookies or storageState. */
  getBrowserConnectionDebugState?(ctx: AccountContext): {
    requestedAccountId: string;
    activeSessionKeys: string[];
    targetSessionFound: boolean;
    targetSessionState: "MISSING" | "OPEN_PENDING" | "OPEN_NOT_PENDING";
    adapterDebugId: string;
    browserSessionManagerDebugId: string;
    contextDebugId: string | null;
    pageDebugId: string | null;
  };
  /** Returns the manager-authored runtime auth state for the account-scoped browser session. */
  getBrowserRuntimeState?(ctx: AccountContext): BrowserSessionRuntimeState;
  /** Returns a read-only in-process snapshot of the account-scoped BrowserSession. */
  getBrowserRuntimeSnapshot?(ctx: AccountContext): BrowserSessionRuntimeSnapshot;
  /** Releases only browser resources created and owned by this adapter. */
  closeOwnedSessions?(): Promise<void>;
  publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult>;
  validateArticle(article: PublishArticleInput): Promise<ValidationResult>;
}

export function isAutomationAdapter(adapter: PlatformAdapter): adapter is AutomationAdapter {
  return typeof (adapter as Partial<AutomationAdapter>).connectAccount === "function"
    && typeof (adapter as Partial<AutomationAdapter>).checkSession === "function"
    && typeof (adapter as Partial<AutomationAdapter>).preparePublish === "function";
}
