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

export interface AutomationAdapter extends PlatformAdapter {
  readonly automationType: PlatformCapability;
  connectAccount(ctx: AccountContext): Promise<LoginSession>;
  isConnectionPending(ctx: AccountContext): boolean;
  completeConnection(ctx: AccountContext): Promise<LoginStatus>;
  cancelConnection?(ctx: AccountContext): Promise<void>;
  checkSession(ctx: AccountContext): Promise<LoginStatus>;
  openBackend(ctx: AccountContext): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string }>;
  preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult>;
  verifyPublish(ctx: AccountContext, externalId?: string): Promise<PublishStatusResult>;
  logout(ctx: AccountContext): Promise<void>;
  /** Releases the account/job session after a BACKGROUND operation; VISIBLE sessions remain available for user handling. */
  releaseOperationSession?(ctx: AccountContext): Promise<void>;
  /** Releases the visible login-only session after account identity has been persisted. */
  releaseConnectionSession?(ctx: AccountContext): Promise<void>;
  /** Persists a deferred visible login Session after same-Page identity readback. */
  persistConnectionSession?(ctx: AccountContext): Promise<void>;
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
