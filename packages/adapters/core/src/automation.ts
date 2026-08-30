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
import type { BrowserSessionRuntimeSnapshot, BrowserSessionRuntimeState } from "./browser";
import type { PlatformAdapter } from "./index";

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

export type PreSubmitGateStatus = "ready" | "needs_user_action" | "auth_expired" | "editor_not_found" | "security_verification_required";

export type PreSubmitGateFailureCode =
  | "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND"
  | "PUBLISH_ENTRY_NOT_FOUND"
  | "PUBLISH_ENTRY_CLICK_FAILED"
  | "CONTENT_TYPE_ENTRY_NOT_FOUND"
  | "CONTENT_TYPE_SELECTION_FAILED"
  | "EDITOR_NAVIGATION_TIMEOUT"
  | "EDITOR_ROUTE_NOT_REACHED"
  | "EDITOR_SELECTOR_DRIFT"
  | "AUTH_REDIRECTED_TO_LOGIN"
  | "SECURITY_VERIFICATION_REQUIRED"
  | "UNKNOWN_UI_STATE";

export type PreSubmitGateFailureStage =
  | "AUTHENTICATION"
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
  preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult>;
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
