import { access, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { CredentialStore } from "@publisher/security";

// Prefer the independently updated Chrome channel. The target workstation can
// retain an old managed Edge build; Zhihu currently rejects that old client
// before the editor loads. Edge remains the supported fallback.
export const SYSTEM_BROWSER_CHANNELS = ["chrome", "msedge"] as const;
export type SystemBrowserChannel = (typeof SYSTEM_BROWSER_CHANNELS)[number];

export const EXTERNAL_LAUNCH_TRIGGER_SOURCES = [
  "APP_STARTUP",
  "CONNECT_ACCOUNT",
  "OPEN_BACKEND",
  "CHECK_LOGIN",
  "PRE_SUBMIT_GATE",
  "START_PUBLISH",
  "RUN_SELF_TEST",
  "CONTINUE_PENDING_ACTION"
] as const;
export type ExternalLaunchTriggerSource = (typeof EXTERNAL_LAUNCH_TRIGGER_SOURCES)[number];

export interface UserInitiatedAction {
  userActionId: string | null;
  triggerSource: ExternalLaunchTriggerSource;
}

export const BROWSER_EXECUTION_MODES = ["BACKGROUND", "VISIBLE"] as const;
export type BrowserExecutionMode = (typeof BROWSER_EXECUTION_MODES)[number];

const USER_INITIATED_TRIGGER_SOURCES = new Set<ExternalLaunchTriggerSource>(EXTERNAL_LAUNCH_TRIGGER_SOURCES.filter((source) => source !== "APP_STARTUP"));

export class ExternalLaunchBlockedError extends Error {
  readonly code = "USER_ACTION_REQUIRED" as const;
  readonly diagnostic: { errorCode: "EXTERNAL_LAUNCH_BLOCKED"; triggerSource: ExternalLaunchTriggerSource; userActionId: string | null };

  constructor(action: UserInitiatedAction) {
    super(action.triggerSource === "APP_STARTUP" ? "应用启动不会自动打开平台；请在应用内点击继续。" : "打开平台需要明确的用户操作。");
    this.name = "ExternalLaunchBlockedError";
    this.diagnostic = { errorCode: "EXTERNAL_LAUNCH_BLOCKED", triggerSource: action.triggerSource, userActionId: action.userActionId };
  }
}

export function userInitiatedActionFromSettings(settings: Record<string, string | number | boolean>): UserInitiatedAction {
  const rawSource = typeof settings.triggerSource === "string" ? settings.triggerSource : "APP_STARTUP";
  const triggerSource = EXTERNAL_LAUNCH_TRIGGER_SOURCES.includes(rawSource as ExternalLaunchTriggerSource) ? rawSource as ExternalLaunchTriggerSource : "APP_STARTUP";
  const userActionId = typeof settings.userActionId === "string" && settings.userActionId.trim() ? settings.userActionId.trim() : null;
  return { userActionId, triggerSource };
}

export function withUserInitiatedActionSettings(
  settings: Record<string, string | number | boolean>,
  action?: UserInitiatedAction
): Record<string, string | number | boolean> {
  return {
    ...settings,
    triggerSource: action?.triggerSource ?? "APP_STARTUP",
    ...(action?.userActionId ? { userActionId: action.userActionId } : {})
  };
}

export function browserExecutionModeFromSettings(settings: Record<string, string | number | boolean>): BrowserExecutionMode {
  return settings.browserExecutionMode === "BACKGROUND" ? "BACKGROUND" : "VISIBLE";
}

export function assertExternalLaunchAllowed(action: UserInitiatedAction): void {
  if (!USER_INITIATED_TRIGGER_SOURCES.has(action.triggerSource) || !action.userActionId?.trim()) throw new ExternalLaunchBlockedError(action);
}

export interface BrowserRuntimeDiagnostic {
  errorCode: "BROWSER_RUNTIME_NOT_FOUND" | "BROWSER_RUNTIME_LAUNCH_FAILED";
  module: "BrowserSessionManager" | "playwright-core";
  timestamp: string;
  attemptedChannels: SystemBrowserChannel[];
  selectedChannel?: SystemBrowserChannel;
}

export type BrowserRuntimeEvent =
  | { code: "BROWSER_RUNTIME_SELECTED"; channel: SystemBrowserChannel; headless: boolean }
  | { code: "BROWSER_RUNTIME_NOT_FOUND"; attemptedChannels: SystemBrowserChannel[] };

export const BROWSER_SESSION_STORAGE_MODES = ["EPHEMERAL_STORAGE_STATE", "PERSISTENT_PROFILE"] as const;
export type BrowserSessionStorageMode = (typeof BROWSER_SESSION_STORAGE_MODES)[number];

export class BrowserRuntimeError extends Error {
  constructor(readonly diagnostic: BrowserRuntimeDiagnostic) {
    super(diagnostic.errorCode === "BROWSER_RUNTIME_NOT_FOUND" ? "未检测到 Microsoft Edge 或 Google Chrome，请安装浏览器后重试。" : "浏览器组件启动失败，请稍后重试。");
    this.name = "BrowserRuntimeError";
  }
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  /** The first page owned by this session. It is created with the context so every
   * harness/adapter operation can use the same Page and prove page.url() directly. */
  page: Page;
  hasStoredSession: boolean;
  sessionIdHash: string;
  /** Process-memory-only identity for this live BrowserSession instance. */
  runtimeSessionIdentity: string;
  executionMode: BrowserExecutionMode;
  headless: boolean;
  storageMode: BrowserSessionStorageMode;
  profilePath: string | null;
  browserChannel?: SystemBrowserChannel;
  /** True only when a legacy encrypted credential snapshot was passed to the browser launcher. */
  credentialSnapshotInjected?: boolean;
  /** Process-memory-only identity used to prove Context/Page continuity. */
  contextDebugId?: string;
  pageDebugId?: string;
}

export type BrowserRuntimeAuthState = "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED";
export type BrowserSessionLifecycleState = "CLOSED" | "OPENING" | "READY" | "RUNNING" | "CLOSING";

/** Controls whether a successful scoped operation leaves its account session available for the next user-owned step. */
export interface BrowserSessionOperationOptions {
  retainSession?: boolean;
  preserveAccountSessionOnFailure?: boolean;
}

export interface BrowserSessionPlatformPolicy {
  retainContextAfterPageClose: boolean;
  requireActiveContextForOperations: boolean;
}

export interface BrowserSessionOperationPage {
  session: BrowserSession;
  page: Page;
  pageDebugId: string;
}

export class BrowserSessionPageOwnershipError extends Error {
  readonly code = "BROWSER_SESSION_PAGE_OWNERSHIP" as const;

  constructor(message = "BrowserSession/Page lifecycle ownership invariant failed") {
    super(message);
    this.name = "BrowserSessionPageOwnershipError";
  }
}

export interface BrowserSessionCanonicalPage {
  session: BrowserSession;
  page: Page;
  pageDebugId: string;
}

/**
 * A read-only view of a Page that already exists in an account-owned Context.
 * This identity is process-memory-only and is never supplied by the Renderer.
 */
export interface BrowserSessionContextPage {
  session: BrowserSession;
  page: Page;
  pageIndex: number;
  pageDebugId: string;
  isCanonical: boolean;
}

export interface BrowserSessionOperationPageLifecycleEvent {
  phase: "OPERATION_PAGE_OPENED" | "OPERATION_PAGE_CLOSE_STARTED" | "OPERATION_PAGE_CLOSE_COMPLETED";
  timestamp: string;
  platformKey: string;
  accountId: string;
  action: UserInitiatedAction | null;
  contextDebugId: string | null;
  pageDebugId: string | null;
  pageCountBefore: number | null;
  pageCountAfter: number | null;
  remainingPageCount: number | null;
  browserConnected: boolean | null;
  sanitizedUrl: string | null;
  contextMatch: boolean | null;
}

export interface BrowserSessionContextPageLifecycleEvent {
  phase: "CONTEXT_PAGE_CREATED";
  timestamp: string;
  platformKey: string;
  accountId: string;
  contextDebugId: string | null;
  pageDebugId: string;
  pageIndex: number | null;
  pageCount: number | null;
  canonicalPageId: string | null;
  pageUrlOrigin: string | null;
  pageUrlPathname: string | null;
}

/** Runtime object-identity check. Test doubles may omit Page.context(), but a real Playwright Page always exposes it. */
export function assertBrowserSessionPageOwnership(session: BrowserSession, page: Page): void {
  const candidate = page as unknown as { context?: () => BrowserContext };
  if (typeof candidate.context !== "function") return;
  let pageContext: BrowserContext;
  try {
    pageContext = candidate.context();
  } catch {
    throw new BrowserSessionPageOwnershipError("BrowserSession/Page lifecycle ownership invariant failed: Page context is unavailable");
  }
  if (pageContext !== session.context) throw new BrowserSessionPageOwnershipError("BrowserSession/Page lifecycle ownership invariant failed: Page belongs to a foreign BrowserContext");
}

export const BROWSER_SESSION_CLOSE_REASONS = [
  "ACCOUNT_REMOVE",
  "EXPLICIT_LOGOUT",
  "APP_SHUTDOWN",
  "CONTEXT_CRASH_CLEANUP",
  "LEGACY_RELEASE",
  "EXECUTION_MODE_REPLACEMENT",
  "EXPLICIT_RECONNECT",
  "CONNECTION_CANCEL",
  "BACKGROUND_OPERATION_RELEASE",
  "CONNECTION_RELEASE",
  "PERSISTENCE_FAILURE",
  "OPEN_FAILURE_CLEANUP",
  "TEST_CLEANUP"
] as const;
export type BrowserSessionCloseReason = (typeof BROWSER_SESSION_CLOSE_REASONS)[number];

export interface BrowserSessionCloseInfo {
  reason: BrowserSessionCloseReason;
  callerOperation: string;
}

export interface BrowserSessionRuntimeState {
  state: BrowserRuntimeAuthState;
  contextDebugId: string | null;
  updatedAt: string;
  reason: string | null;
}

export interface BrowserSessionRuntimeSnapshot {
  lifecycleState: BrowserSessionLifecycleState;
  platformKey: string;
  accountId: string;
  sessionExists: boolean;
  /** Process-memory-safe stable key for the active BrowserSession. */
  browserSessionIdentity?: string | null;
  contextDebugId: string | null;
  canonicalPageDebugId: string | null;
  browserConnected: boolean | null;
  contextExists: boolean;
  contextPageCount: number | null;
  canonicalPageExists: boolean;
  canonicalPageClosed: boolean | null;
  canonicalPageContextMatchesSession: boolean | null;
  runtimeAuthState: BrowserRuntimeAuthState;
  contextLaunchCount: number;
  canonicalPagePromotionCount: number;
  activeOperation: string | null;
  mutexLocked: boolean;
  operationInProgress: boolean;
  lastDisconnectAt: string | null;
  lastDisconnectContextDebugId: string | null;
  lastDisconnectReason: string | null;
}

export type BrowserSessionLifecyclePhase =
  | "OPEN_STARTED"
  | "OPEN_COMPLETED"
  | "CLOSE_STARTED"
  | "CONTEXT_DISCONNECTED"
  | "CONTEXT_CLOSE_COMPLETED"
  | "CLOSE_COMPLETED"
  | "CLOSE_FAILED";

export interface BrowserSessionLifecycleEvent {
  phase: BrowserSessionLifecyclePhase;
  timestamp: string;
  platformKey: string;
  accountId: string;
  storageMode: BrowserSessionStorageMode;
  profilePath: string | null;
  browserChannel: SystemBrowserChannel | null;
  contextDebugId: string | null;
  pageDebugId: string | null;
  pageCount: number | null;
  browserConnected: boolean | null;
  closeReason: BrowserSessionCloseReason | null;
  callerOperation: string | null;
  explicitCloseInProgress: boolean;
  lastExplicitCloseReason: BrowserSessionCloseReason | null;
  activePageCountBeforeDisconnect: number | null;
  browserConnectedBeforeEvent: boolean | null;
  contextLaunchCount: number;
  disconnectReason: "UNEXPECTED_BROWSER_DISCONNECT" | "EXPLICIT_CLOSE" | null;
}

export interface BrowserSessionManagerOptions {
  timeoutMs?: number;
  debugArtifactsDir?: string;
  onRuntimeEvent?: (event: BrowserRuntimeEvent) => void;
  launchBrowser?: (options: { channel: SystemBrowserChannel; headless: boolean }) => Promise<Browser>;
  /** Root directory for account-isolated Playwright persistent profiles. */
  browserProfileRootDir?: string;
  /** Only these platform keys may use persistent profiles. */
  persistentProfilePlatforms?: readonly string[];
  /** Explicit opt-in for legacy snapshot seeding. Persistent profiles are canonical by default. */
  persistentProfileCredentialSnapshotPlatforms?: readonly string[];
  launchPersistentContext?: (userDataDir: string, options: { channel: SystemBrowserChannel; headless: boolean; storageState?: StorageState }) => Promise<BrowserContext>;
  writeProfileInitializedMarker?: (markerPath: string) => Promise<void>;
  onSessionLifecycle?: (event: BrowserSessionLifecycleEvent) => void;
  onOperationPageLifecycle?: (event: BrowserSessionOperationPageLifecycleEvent) => void;
  onContextPageLifecycle?: (event: BrowserSessionContextPageLifecycleEvent) => void;
  platformPolicies?: Readonly<Record<string, Partial<BrowserSessionPlatformPolicy>>>;
}

export interface BrowserSessionIdentity {
  platformKey: string;
  accountId: string;
}

type StorageState = Exclude<NonNullable<Parameters<Browser["newContext"]>[0]>["storageState"], string>;

export function browserSessionCredentialKey(identity: BrowserSessionIdentity): string {
  return `session:${identity.platformKey}:${identity.accountId}`;
}

/** Stable non-secret audit identifier. It never contains cookies or tokens. */
export function browserSessionIdHash(identity: BrowserSessionIdentity): string {
  return createHash("sha256").update(browserSessionCredentialKey(identity)).digest("hex");
}

/**
 * Returns the deterministic, account-isolated profile path used by a persistent
 * browser session. Values are sanitized before joining so platform/account
 * identity can never escape the configured profile root.
 */
export function browserSessionProfilePath(rootDir: string, identity: BrowserSessionIdentity): string {
  return join(rootDir, safePathSegment(identity.platformKey), safePathSegment(identity.accountId));
}

/** Platform-neutral session storage. Platform adapters own navigation and selectors. */
export class PlaywrightSessionManager {
  private readonly ownedSessions = new Set<BrowserSession>();
  private readonly activeSessions = new Map<string, BrowserSession>();
  private readonly pendingOpenPromises = new Map<string, Promise<BrowserSession>>();
  private readonly pendingConnections = new Set<string>();
  private readonly runtimeStates = new Map<string, BrowserSessionRuntimeState>();
  private readonly lifecycleStates = new Map<string, BrowserSessionLifecycleState>();
  private readonly scopedOperations = new Map<string, string>();
  private readonly sessionIdentities = new WeakMap<BrowserSession, BrowserSessionIdentity>();
  private readonly operationPages = new WeakMap<BrowserSession, Set<Page>>();
  private readonly operationPageDebugIds = new WeakMap<Page, string>();
  private readonly pageDebugIds = new WeakMap<Page, string>();
  private readonly contextPageLifecycleEvents = new WeakMap<BrowserSession, BrowserSessionContextPageLifecycleEvent[]>();
  private readonly contextPageListenerCleanups = new WeakMap<BrowserSession, () => void>();
  private readonly disconnectListenerCleanups = new WeakMap<BrowserSession, () => void>();
  private readonly explicitCloseSessions = new Set<BrowserSession>();
  private readonly lastExplicitCloseInfo = new WeakMap<BrowserSession, BrowserSessionCloseInfo>();
  private readonly lastKnownBrowserConnected = new WeakMap<BrowserSession, boolean>();
  private readonly contextLaunchCounts = new Map<string, number>();
  private readonly canonicalPagePromotionCounts = new Map<string, number>();
  private readonly lastDisconnectEvidence = new Map<string, { timestamp: string; contextDebugId: string | null; reason: "UNEXPECTED_BROWSER_DISCONNECT" | "EXPLICIT_CLOSE" }>();
  private closeAllGeneration = 0;
  readonly debugId = randomUUID();

  constructor(private readonly credentials: CredentialStore, private readonly options: BrowserSessionManagerOptions = {}) {}

  async open(identity: BrowserSessionIdentity, action: UserInitiatedAction, executionMode: BrowserExecutionMode = "VISIBLE"): Promise<BrowserSession> {
    assertExternalLaunchAllowed(action);
    const key = browserSessionCredentialKey(identity);
    const existing = this.getActiveSession(identity);
    if (existing?.executionMode === executionMode) return existing;
    if (existing) await this.close(existing, { reason: "EXECUTION_MODE_REPLACEMENT", callerOperation: "PlaywrightSessionManager.open" });
    const pending = this.pendingOpenPromises.get(key);
    if (pending) return pending;
    this.lifecycleStates.set(key, "OPENING");
    const creation = this.openFresh(identity, executionMode, this.closeAllGeneration);
    this.pendingOpenPromises.set(key, creation);
    try {
      return await creation;
    } catch (error) {
      if (!this.activeSessions.has(key)) this.lifecycleStates.set(key, "CLOSED");
      throw error;
    } finally {
      if (this.pendingOpenPromises.get(key) === creation) this.pendingOpenPromises.delete(key);
    }
  }

  getLifecycleState(identity: BrowserSessionIdentity): BrowserSessionLifecycleState {
    return this.lifecycleStates.get(browserSessionCredentialKey(identity)) ?? "CLOSED";
  }

  /** Explicit task ownership; retained/manual callers continue to use open/close. */
  async runScopedOperation<T>(
    identity: BrowserSessionIdentity,
    action: UserInitiatedAction,
    executionMode: BrowserExecutionMode,
    callerOperation: string,
    task: (session: BrowserSession) => Promise<T>,
    options: BrowserSessionOperationOptions = {}
  ): Promise<T> {
    const key = browserSessionCredentialKey(identity);
    if (this.scopedOperations.has(key)) throw new Error("A scoped browser operation is already running for this account");
    this.scopedOperations.set(key, callerOperation);
    let session: BrowserSession | undefined;
    let taskFailed = false;
    let taskError: unknown;
    let result!: T;
    try {
      session = await this.open(identity, action, executionMode);
      // Opening yields to the event loop. A disconnect/close may have released
      // this session before the caller resumes, so never revive it as RUNNING.
      const activeSession = this.getActiveSession(identity);
      if (activeSession !== session || this.browserConnected(session.browser) !== true || this.safeContextPages(session.context) === null) {
        if (activeSession === session) this.handleBrowserDisconnected(identity, session);
        throw new Error("BROWSER_SESSION_UNAVAILABLE_BEFORE_OPERATION");
      }
      this.lifecycleStates.set(key, "RUNNING");
      result = await task(session);
    } catch (error) {
      taskFailed = true;
      taskError = error;
    }
    try {
      // Disconnect handling already releases crashed sessions. Never close a
      // replacement session or overwrite its authentication diagnostics.
      if (session && this.activeSessions.get(key) === session) {
        if (options.retainSession === true && (!taskFailed || options.preserveAccountSessionOnFailure === true)) {
          // A successful prepare must keep its account-owned Context/Page alive
          // so a later user confirmation can use the same identity and editor.
          this.lifecycleStates.set(key, "READY");
        } else {
          await this.close(session, { reason: "BACKGROUND_OPERATION_RELEASE", callerOperation });
        }
      } else if (session && !this.activeSessions.has(key) && this.browserConnected(session.browser) === true) {
        // An unexpectedly closed ephemeral Context can leave its Browser alive.
        await this.close(session, { reason: "CONTEXT_CRASH_CLEANUP", callerOperation });
      }
    } catch (error) {
      if (!taskFailed) {
        taskFailed = true;
        taskError = error;
      }
    } finally {
      this.scopedOperations.delete(key);
    }
    if (taskFailed) throw taskError;
    return result;
  }

  private async openFresh(identity: BrowserSessionIdentity, executionMode: BrowserExecutionMode, closeAllGeneration: number): Promise<BrowserSession> {
    const stored = this.credentials.get(browserSessionCredentialKey(identity));
    let storageState: StorageState | undefined;
    if (stored) {
      try { storageState = JSON.parse(stored) as StorageState; } catch { storageState = undefined; }
    }
    const headless = executionMode === "BACKGROUND";
    const persistentProfilePath = this.persistentProfilePath(identity);
    this.emitSessionLifecycle({ phase: "OPEN_STARTED", identity, storageMode: persistentProfilePath ? "PERSISTENT_PROFILE" : "EPHEMERAL_STORAGE_STATE", profilePath: persistentProfilePath, browserChannel: null, contextDebugId: null, pageDebugId: null, browserConnected: null });
    const profileInitialized = persistentProfilePath ? await pathExists(join(persistentProfilePath, ".gmp-profile-initialized")) : false;
    if (persistentProfilePath) await mkdir(persistentProfilePath, { recursive: true });
    if (persistentProfilePath) {
      const snapshotPlatforms = this.options.persistentProfileCredentialSnapshotPlatforms;
      const shouldInjectCredentialSnapshot = Boolean(!profileInitialized && storageState && (snapshotPlatforms === undefined || snapshotPlatforms.includes(identity.platformKey)));
      const persistentLaunch = await this.launchPersistentBrowser(persistentProfilePath, headless, shouldInjectCredentialSnapshot ? storageState : undefined);
      const context = persistentLaunch.context;
      const browser = context.browser();
      if (!browser) {
        await this.closeUnregisteredResources(identity, context, null, {
          storageMode: "PERSISTENT_PROFILE",
          profilePath: persistentProfilePath,
          browserChannel: persistentLaunch.channel,
          contextDebugId: null,
          pageDebugId: null
        }, { reason: "OPEN_FAILURE_CLEANUP", callerOperation: "PlaywrightSessionManager.openFresh" });
        throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
      }
      context.setDefaultTimeout(this.options.timeoutMs ?? 30_000);
      let page: Page;
      try {
        page = await context.newPage();
      } catch {
        await this.closeUnregisteredResources(identity, context, browser, {
          storageMode: "PERSISTENT_PROFILE",
          profilePath: persistentProfilePath,
          browserChannel: persistentLaunch.channel,
          contextDebugId: null,
          pageDebugId: null
        }, { reason: "OPEN_FAILURE_CLEANUP", callerOperation: "PlaywrightSessionManager.openFresh" });
        throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
      }
      const session = { browser, context, page, hasStoredSession: Boolean(storageState) || profileInitialized, sessionIdHash: browserSessionIdHash(identity), runtimeSessionIdentity: randomUUID(), executionMode, headless, storageMode: "PERSISTENT_PROFILE" as const, profilePath: persistentProfilePath, browserChannel: persistentLaunch.channel, credentialSnapshotInjected: shouldInjectCredentialSnapshot, contextDebugId: randomUUID(), pageDebugId: randomUUID() };
      if (closeAllGeneration !== this.closeAllGeneration) {
        await this.closeUnregisteredSession(identity, session, { reason: "APP_SHUTDOWN", callerOperation: "PlaywrightSessionManager.closeAll" });
        throw new Error("Browser session open was cancelled by closeAll");
      }
      await this.writeProfileInitializedMarker(join(persistentProfilePath, ".gmp-profile-initialized"));
      return this.registerOpenSession(identity, session, closeAllGeneration);
    }
    const browserLaunch = await this.launchSystemBrowser(headless);
    const browser = browserLaunch.browser;
    let context: BrowserContext;
    try {
      context = await browser.newContext(storageState ? { storageState } : {});
    } catch {
      await this.closeUnregisteredResources(identity, null, browser, {
        storageMode: "EPHEMERAL_STORAGE_STATE",
        profilePath: null,
        browserChannel: browserLaunch.channel,
        contextDebugId: null,
        pageDebugId: null
      }, { reason: "OPEN_FAILURE_CLEANUP", callerOperation: "PlaywrightSessionManager.openFresh" });
      throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
    }
    context.setDefaultTimeout(this.options.timeoutMs ?? 30_000);
    let page: Page;
    try {
      page = await context.newPage();
    } catch {
      await this.closeUnregisteredResources(identity, context, browser, {
        storageMode: "EPHEMERAL_STORAGE_STATE",
        profilePath: null,
        browserChannel: browserLaunch.channel,
        contextDebugId: null,
        pageDebugId: null
      }, { reason: "OPEN_FAILURE_CLEANUP", callerOperation: "PlaywrightSessionManager.openFresh" });
      throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
    }
    const session = { browser, context, page, hasStoredSession: Boolean(storageState), sessionIdHash: browserSessionIdHash(identity), runtimeSessionIdentity: randomUUID(), executionMode, headless, storageMode: "EPHEMERAL_STORAGE_STATE" as const, profilePath: null, browserChannel: browserLaunch.channel, credentialSnapshotInjected: Boolean(storageState), contextDebugId: randomUUID(), pageDebugId: randomUUID() };
    return this.registerOpenSession(identity, session, closeAllGeneration);
  }

  async save(identity: BrowserSessionIdentity, context: BrowserContext): Promise<void> {
    const state = this.persistentProfilePath(identity) ? await context.storageState({ indexedDB: true }) : await context.storageState();
    this.credentials.set(browserSessionCredentialKey(identity), JSON.stringify(state));
  }

  hasStoredSession(identity: BrowserSessionIdentity): boolean { return this.credentials.has(browserSessionCredentialKey(identity)); }

  clear(identity: BrowserSessionIdentity): void { this.credentials.delete(browserSessionCredentialKey(identity)); }

  rebind(from: BrowserSessionIdentity, to: BrowserSessionIdentity): void {
    const fromKey = browserSessionCredentialKey(from);
    const toKey = browserSessionCredentialKey(to);
    if (fromKey === toKey) return;
    if (this.activeSessions.has(toKey) || this.pendingConnections.has(toKey) || this.credentials.has(toKey)) throw new Error("目标账号已有 Session 或连接状态，拒绝重绑定");
    const active = this.activeSessions.get(fromKey);
    if (active) {
      this.activeSessions.delete(fromKey);
      this.activeSessions.set(toKey, active);
    }
    if (this.pendingConnections.delete(fromKey)) this.pendingConnections.add(toKey);
    const stored = this.credentials.get(fromKey);
    if (stored !== null) {
      this.credentials.set(toKey, stored);
      this.credentials.delete(fromKey);
    }
    const launchCount = this.contextLaunchCounts.get(fromKey);
    if (launchCount !== undefined) {
      this.contextLaunchCounts.set(toKey, launchCount);
      this.contextLaunchCounts.delete(fromKey);
    }
    const promotionCount = this.canonicalPagePromotionCounts.get(fromKey);
    if (promotionCount !== undefined) {
      this.canonicalPagePromotionCounts.set(toKey, promotionCount);
      this.canonicalPagePromotionCounts.delete(fromKey);
    }
    const disconnect = this.lastDisconnectEvidence.get(fromKey);
    if (disconnect) {
      this.lastDisconnectEvidence.set(toKey, disconnect);
      this.lastDisconnectEvidence.delete(fromKey);
    }
  }

  getActiveSession(identity: BrowserSessionIdentity): BrowserSession | null {
    const key = browserSessionCredentialKey(identity);
    const session = this.activeSessions.get(key);
    if (!session) return null;
    const liveness = this.getSessionLiveness(session);
    if (liveness === "DISCONNECTED") {
      this.handleBrowserDisconnected(identity, session);
      return null;
    }
    if (liveness === "CLOSED") {
      this.releaseSession(session, identity);
      return null;
    }
    return session;
  }

  async openOperationPage(identity: BrowserSessionIdentity, action: UserInitiatedAction, executionMode: BrowserExecutionMode = "VISIBLE"): Promise<BrowserSessionOperationPage> {
    const session = await this.open(identity, action, executionMode);
    const pageCountBefore = this.safePageCount(session.context);
    const page = await session.context.newPage();
    const pageDebugId = randomUUID();
    const contextMatch = this.pageContextMatches(session, page);
    this.emitOperationPageLifecycle({ phase: "OPERATION_PAGE_OPENED", identity, action, session, page, pageDebugId, pageCountBefore, pageCountAfter: this.safePageCount(session.context), contextMatch });
    if (!contextMatch) throw new BrowserSessionPageOwnershipError();
    const operationPages = this.operationPages.get(session) ?? new Set<Page>();
    operationPages.add(page);
    this.operationPages.set(session, operationPages);
    this.operationPageDebugIds.set(page, pageDebugId);
    this.pageDebugIds.set(page, pageDebugId);
    return { session, page, pageDebugId };
  }

  async closeOperationPage(identity: BrowserSessionIdentity, page: Page): Promise<void> {
    const session = this.getActiveSession(identity);
    const ownedOperationPage = Boolean(session && this.operationPages.get(session)?.has(page));
    const retainedCanonicalPage = Boolean(session && this.retainsContextAfterPageClose(identity) && session.page === page);
    if (!session || (!ownedOperationPage && !retainedCanonicalPage) || !this.contextContainsPage(session.context, page)) {
      throw new Error("Operation Page does not belong to the active session Context");
    }
    assertBrowserSessionPageOwnership(session, page);
    const pageDebugId = this.operationPageDebugIds.get(page) ?? (retainedCanonicalPage ? session.pageDebugId ?? null : null);
    this.emitOperationPageLifecycle({ phase: "OPERATION_PAGE_CLOSE_STARTED", identity, action: null, session, page, pageDebugId, pageCountBefore: this.safePageCount(session.context), pageCountAfter: null, contextMatch: true });
    await page.close();
    if (ownedOperationPage) this.operationPages.get(session)?.delete(page);
    this.operationPageDebugIds.delete(page);
    this.emitOperationPageLifecycle({ phase: "OPERATION_PAGE_CLOSE_COMPLETED", identity, action: null, session, page, pageDebugId, pageCountBefore: null, pageCountAfter: this.safePageCount(session.context), contextMatch: true });
  }

  getCanonicalPage(identity: BrowserSessionIdentity): BrowserSessionCanonicalPage | null {
    const session = this.getActiveSession(identity);
    if (!session || this.isPageClosed(session.page)) return null;
    assertBrowserSessionPageOwnership(session, session.page);
    if (!this.contextContainsPage(session.context, session.page)) throw new BrowserSessionPageOwnershipError("BrowserSession/Page lifecycle ownership invariant failed: canonical Page is not in its Context");
    return { session, page: session.page, pageDebugId: this.pageDebugIdForPage(session, session.page) };
  }

  /**
   * Enumerates only Pages already returned by the account-owned Context.
   * No Page, Context, navigation, or lifecycle mutation is performed here.
   */
  getContextPages(identity: BrowserSessionIdentity): BrowserSessionContextPage[] | null {
    const session = this.getActiveSession(identity);
    if (!session) return null;
    const pages = session.context.pages();
    return pages.map((page, pageIndex) => {
      assertBrowserSessionPageOwnership(session, page);
      return {
        session,
        page,
        pageIndex,
        pageDebugId: this.pageDebugIdForPage(session, page),
        isCanonical: page === session.page
      };
    });
  }

  getContextPageLifecycleEvents(identity: BrowserSessionIdentity): readonly BrowserSessionContextPageLifecycleEvent[] | null {
    const session = this.getActiveSession(identity);
    return session ? [...(this.contextPageLifecycleEvents.get(session) ?? [])] : null;
  }

  retainsContextAfterPageClose(identity: BrowserSessionIdentity): boolean {
    return this.policy(identity.platformKey).retainContextAfterPageClose;
  }

  requiresActiveContextForOperations(identity: BrowserSessionIdentity): boolean {
    return this.policy(identity.platformKey).requireActiveContextForOperations;
  }

  getActiveSessionKeys(): string[] { return [...this.activeSessions.keys()]; }

  setActiveSession(identity: BrowserSessionIdentity, session: BrowserSession): void {
    const key = browserSessionCredentialKey(identity);
    this.activeSessions.set(key, session);
    this.lifecycleStates.set(key, "READY");
  }

  clearActiveSession(identity: BrowserSessionIdentity, session?: BrowserSession): void {
    const key = browserSessionCredentialKey(identity);
    if (!session || this.activeSessions.get(key) === session) {
      this.activeSessions.delete(key);
      this.lifecycleStates.set(key, "CLOSED");
    }
  }

  markConnectionPending(identity: BrowserSessionIdentity): void { this.pendingConnections.add(browserSessionCredentialKey(identity)); }

  isConnectionPending(identity: BrowserSessionIdentity): boolean { return this.pendingConnections.has(browserSessionCredentialKey(identity)); }

  clearConnectionPending(identity: BrowserSessionIdentity): void { this.pendingConnections.delete(browserSessionCredentialKey(identity)); }

  setRuntimeAuthState(identity: BrowserSessionIdentity, state: BrowserRuntimeAuthState, reason: string | null): void {
    const key = browserSessionCredentialKey(identity);
    const session = this.activeSessions.get(key);
    this.updateRuntimeState(key, state, session?.contextDebugId ?? null, reason);
  }

  getRuntimeAuthState(identity: BrowserSessionIdentity): BrowserSessionRuntimeState {
    return this.runtimeStates.get(browserSessionCredentialKey(identity)) ?? {
      state: "UNVERIFIED",
      contextDebugId: null,
      updatedAt: new Date(0).toISOString(),
      reason: null
    };
  }

  getSessionSnapshot(identity: BrowserSessionIdentity): BrowserSessionRuntimeSnapshot {
    const key = browserSessionCredentialKey(identity);
    const session = this.activeSessions.get(key) ?? null;
    const runtimeState = this.getRuntimeAuthState(identity);
    const contextExists = Boolean(session?.context);
    const canonicalPageExists = Boolean(session?.page);
    const canonicalPageClosed = session?.page ? this.isPageClosed(session.page) : null;
    const canonicalPageContextMatchesSession = session?.page ? this.pageContextIdentityMatches(session, session.page) : null;
    const disconnect = this.lastDisconnectEvidence.get(key);
    return {
      lifecycleState: this.getLifecycleState(identity),
      platformKey: identity.platformKey,
      accountId: identity.accountId,
      sessionExists: session !== null,
      browserSessionIdentity: session?.runtimeSessionIdentity ?? null,
      contextDebugId: session?.contextDebugId ?? runtimeState.contextDebugId ?? null,
      canonicalPageDebugId: session?.pageDebugId ?? null,
      browserConnected: session ? this.browserConnected(session.browser) : null,
      contextExists,
      contextPageCount: contextExists && session ? this.safePageCount(session.context) : null,
      canonicalPageExists,
      canonicalPageClosed,
      canonicalPageContextMatchesSession,
      runtimeAuthState: runtimeState.state,
      contextLaunchCount: this.contextLaunchCounts.get(key) ?? 0,
      canonicalPagePromotionCount: this.canonicalPagePromotionCounts.get(key) ?? 0,
      activeOperation: this.scopedOperations.get(key) ?? null,
      mutexLocked: this.scopedOperations.has(key),
      operationInProgress: this.scopedOperations.has(key),
      lastDisconnectAt: disconnect?.timestamp ?? null,
      lastDisconnectContextDebugId: disconnect?.contextDebugId ?? null,
      lastDisconnectReason: disconnect?.reason ?? null
    };
  }

  recordCanonicalPagePromotion(identity: BrowserSessionIdentity, session: BrowserSession): void {
    const key = browserSessionCredentialKey(identity);
    if (this.activeSessions.get(key) !== session) throw new BrowserSessionPageOwnershipError("BrowserSession/Page lifecycle ownership invariant failed: canonical Page promotion session is not active");
    assertBrowserSessionPageOwnership(session, session.page);
    this.canonicalPagePromotionCounts.set(key, (this.canonicalPagePromotionCounts.get(key) ?? 0) + 1);
  }

  async screenshot(page: Page, outputPath: string): Promise<string> {
    await mkdir(dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: true });
    return outputPath;
  }

  async close(session: BrowserSession, closeInfo: BrowserSessionCloseInfo = { reason: "LEGACY_RELEASE", callerOperation: "PlaywrightSessionManager.close" }): Promise<void> {
    const identity = this.sessionIdentities.get(session);
    const key = identity ? browserSessionCredentialKey(identity) : null;
    if (key) {
      this.pendingOpenPromises.delete(key);
      if (this.activeSessions.get(key) === session) this.lifecycleStates.set(key, "CLOSING");
    }
    this.explicitCloseSessions.add(session);
    this.lastExplicitCloseInfo.set(session, closeInfo);
    this.detachBrowserDisconnectObserver(session);
    if (identity) this.emitSessionLifecycle({ phase: "CLOSE_STARTED", identity, session, browserConnected: this.browserConnected(session.browser), closeInfo });
    let firstError: unknown;
    try { await session.context.close(); } catch (error) { firstError = error; }
    if (!firstError && identity) this.emitSessionLifecycle({ phase: "CONTEXT_CLOSE_COMPLETED", identity, session, browserConnected: this.browserConnected(session.browser), closeInfo });
    if (session.storageMode !== "PERSISTENT_PROFILE") {
      try { await session.browser.close(); } catch (error) { firstError ??= error; }
    }
    if (identity) this.updateRuntimeState(browserSessionCredentialKey(identity), "UNVERIFIED", session.contextDebugId ?? null, null);
    this.releaseSession(session, identity);
    if (identity) this.emitSessionLifecycle({ phase: firstError ? "CLOSE_FAILED" : "CLOSE_COMPLETED", identity, session, browserConnected: this.browserConnected(session.browser), closeInfo });
    this.explicitCloseSessions.delete(session);
    if (firstError) throw firstError;
  }

  async closeAll(closeInfo: BrowserSessionCloseInfo = { reason: "APP_SHUTDOWN", callerOperation: "PlaywrightSessionManager.closeAll" }): Promise<void> {
    this.closeAllGeneration += 1;
    const affectedKeys = new Set<string>([
      ...this.activeSessions.keys(),
      ...this.pendingConnections.values(),
      ...this.pendingOpenPromises.keys()
    ]);
    const sessions = [...this.ownedSessions];
    const pendingOpens = [...this.pendingOpenPromises.values()];
    await Promise.allSettled([...sessions.map((session) => this.close(session, closeInfo)), ...pendingOpens]);
    for (const key of affectedKeys) {
      this.updateRuntimeState(key, "UNVERIFIED", this.runtimeStates.get(key)?.contextDebugId ?? null, null);
      this.lifecycleStates.set(key, "CLOSED");
    }
    this.activeSessions.clear();
    this.pendingOpenPromises.clear();
    this.pendingConnections.clear();
  }

  debugArtifactPath(identity: BrowserSessionIdentity, fileName: string): string | null {
    if (!this.options.debugArtifactsDir) return null;
    const safe = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/gu, "_");
    return join(this.options.debugArtifactsDir, safe(identity.platformKey), safe(identity.accountId), safe(fileName));
  }

  private policy(platformKey: string): BrowserSessionPlatformPolicy {
    return {
      retainContextAfterPageClose: this.options.platformPolicies?.[platformKey]?.retainContextAfterPageClose ?? false,
      requireActiveContextForOperations: this.options.platformPolicies?.[platformKey]?.requireActiveContextForOperations ?? false
    };
  }

  private async launchSystemBrowser(headless: boolean): Promise<{ browser: Browser; channel: SystemBrowserChannel }> {
    let launchBrowser = this.options.launchBrowser;
    if (!launchBrowser) {
      try {
        const { chromium } = await import("playwright-core");
        launchBrowser = ({ channel, headless: launchHeadless }) => chromium.launch({ channel, headless: launchHeadless });
      } catch {
        const diagnostic: BrowserRuntimeDiagnostic = { errorCode: "BROWSER_RUNTIME_NOT_FOUND", module: "playwright-core", timestamp: new Date().toISOString(), attemptedChannels: [] };
        this.options.onRuntimeEvent?.({ code: "BROWSER_RUNTIME_NOT_FOUND", attemptedChannels: [] });
        throw new BrowserRuntimeError(diagnostic);
      }
    }

    for (const channel of SYSTEM_BROWSER_CHANNELS) {
      try {
        const browser = await launchBrowser({ channel, headless });
        this.options.onRuntimeEvent?.({ code: "BROWSER_RUNTIME_SELECTED", channel, headless });
        return { browser, channel };
      } catch {
        // The next system browser is the supported fallback. Internal launch details stay out of the UI.
      }
    }

    const diagnostic: BrowserRuntimeDiagnostic = { errorCode: "BROWSER_RUNTIME_NOT_FOUND", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] };
    this.options.onRuntimeEvent?.({ code: "BROWSER_RUNTIME_NOT_FOUND", attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
    throw new BrowserRuntimeError(diagnostic);
  }

  private async launchPersistentBrowser(userDataDir: string, headless: boolean, storageState: StorageState | undefined): Promise<{ context: BrowserContext; channel: SystemBrowserChannel }> {
    let launchPersistentContext = this.options.launchPersistentContext;
    if (!launchPersistentContext) {
      try {
        const { chromium } = await import("playwright-core");
        launchPersistentContext = (profilePath, launchOptions) => chromium.launchPersistentContext(profilePath, { channel: launchOptions.channel, headless: launchOptions.headless, ...(launchOptions.storageState ? { storageState: launchOptions.storageState } : {}) });
      } catch {
        const diagnostic: BrowserRuntimeDiagnostic = { errorCode: "BROWSER_RUNTIME_NOT_FOUND", module: "playwright-core", timestamp: new Date().toISOString(), attemptedChannels: [] };
        this.options.onRuntimeEvent?.({ code: "BROWSER_RUNTIME_NOT_FOUND", attemptedChannels: [] });
        throw new BrowserRuntimeError(diagnostic);
      }
    }

    for (const channel of SYSTEM_BROWSER_CHANNELS) {
      try {
        const context = await launchPersistentContext(userDataDir, { channel, headless, ...(storageState ? { storageState } : {}) });
        this.options.onRuntimeEvent?.({ code: "BROWSER_RUNTIME_SELECTED", channel, headless });
        return { context, channel };
      } catch {
        // The next system browser is the supported fallback. Internal launch details stay out of the UI.
      }
    }

    const diagnostic: BrowserRuntimeDiagnostic = { errorCode: "BROWSER_RUNTIME_NOT_FOUND", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] };
    this.options.onRuntimeEvent?.({ code: "BROWSER_RUNTIME_NOT_FOUND", attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
    throw new BrowserRuntimeError(diagnostic);
  }

  private persistentProfilePath(identity: BrowserSessionIdentity): string | null {
    const rootDir = this.options.browserProfileRootDir?.trim();
    if (!rootDir || !this.options.persistentProfilePlatforms?.includes(identity.platformKey)) return null;
    return browserSessionProfilePath(rootDir, identity);
  }

  private getSessionLiveness(session: BrowserSession): "ACTIVE" | "CLOSED" | "DISCONNECTED" {
    if (this.browserConnected(session.browser) === false) return "DISCONNECTED";
    if (!session.page || typeof session.page !== "object") return "ACTIVE";
    const page = session.page as unknown as { isClosed?: () => boolean };
    if (typeof page.isClosed !== "function" || !page.isClosed()) return "ACTIVE";
    const identity = this.sessionIdentities.get(session);
    if (!identity || !this.policy(identity.platformKey).retainContextAfterPageClose) return "CLOSED";
    try {
      session.context.pages();
      return "ACTIVE";
    } catch {
      return "DISCONNECTED";
    }
  }

  private browserConnected(browser: Browser): boolean | null {
    const candidate = browser as unknown as { isConnected?: () => boolean };
    if (typeof candidate.isConnected !== "function") return null;
    try {
      return candidate.isConnected();
    } catch {
      return null;
    }
  }

  private emitSessionLifecycle(input: { phase: BrowserSessionLifecyclePhase; identity: BrowserSessionIdentity; session?: BrowserSession; storageMode?: BrowserSessionStorageMode; profilePath?: string | null; browserChannel?: SystemBrowserChannel | null; contextDebugId?: string | null; pageDebugId?: string | null; pageCount?: number | null; browserConnected?: boolean | null; closeInfo?: BrowserSessionCloseInfo }): void {
    const session = input.session;
    const browserConnected = input.browserConnected ?? (session ? this.browserConnected(session.browser) : null);
    const browserConnectedBeforeEvent = input.phase === "CONTEXT_DISCONNECTED" && session ? this.lastKnownBrowserConnected.get(session) ?? null : null;
    const pageCount = input.pageCount ?? (session ? this.safePageCount(session.context) : null);
    const activePageCountBeforeDisconnect = input.phase === "CONTEXT_DISCONNECTED" ? pageCount : null;
    const explicitCloseInProgress = input.phase === "CONTEXT_DISCONNECTED" ? Boolean(session && this.explicitCloseSessions.has(session)) : Boolean(input.closeInfo);
    const lastExplicitCloseReason = session ? this.lastExplicitCloseInfo.get(session)?.reason ?? null : input.closeInfo?.reason ?? null;
    const disconnectReason = input.phase === "CONTEXT_DISCONNECTED" ? (explicitCloseInProgress ? "EXPLICIT_CLOSE" : "UNEXPECTED_BROWSER_DISCONNECT") : null;
    const contextLaunchCount = this.contextLaunchCounts.get(browserSessionCredentialKey(input.identity)) ?? 0;
    if (session && browserConnected !== null) this.lastKnownBrowserConnected.set(session, browserConnected);
    if (!this.options.onSessionLifecycle) return;
    try {
      this.options.onSessionLifecycle({
        phase: input.phase,
        timestamp: new Date().toISOString(),
        platformKey: input.identity.platformKey,
        accountId: input.identity.accountId,
        storageMode: input.storageMode ?? session?.storageMode ?? "EPHEMERAL_STORAGE_STATE",
        profilePath: input.profilePath ?? session?.profilePath ?? null,
        browserChannel: input.browserChannel ?? session?.browserChannel ?? null,
        contextDebugId: input.contextDebugId ?? session?.contextDebugId ?? null,
        pageDebugId: input.pageDebugId ?? session?.pageDebugId ?? null,
        pageCount,
        browserConnected,
        closeReason: input.closeInfo?.reason ?? null,
        callerOperation: input.closeInfo?.callerOperation ?? null,
        explicitCloseInProgress,
        lastExplicitCloseReason,
        activePageCountBeforeDisconnect,
        browserConnectedBeforeEvent,
        contextLaunchCount,
        disconnectReason
      });
    } catch {
      // Diagnostics must never change the browser lifecycle result.
    }
  }

  private contextContainsPage(context: BrowserContext, page: Page): boolean {
    try {
      return context.pages().includes(page);
    } catch {
      return false;
    }
  }

  private pageDebugIdForPage(session: BrowserSession, page: Page): string {
    const existing = this.pageDebugIds.get(page);
    if (existing) return existing;
    if (page === session.page && session.pageDebugId) {
      this.pageDebugIds.set(page, session.pageDebugId);
      return session.pageDebugId;
    }
    const pageDebugId = randomUUID();
    this.pageDebugIds.set(page, pageDebugId);
    return pageDebugId;
  }

  private observeContextPages(identity: BrowserSessionIdentity, session: BrowserSession): void {
    const candidate = session.context as unknown as {
      on?: (event: string, listener: (page: Page) => void) => void;
      off?: (event: string, listener: (page: Page) => void) => void;
      removeListener?: (event: string, listener: (page: Page) => void) => void;
    };
    if (typeof candidate.on !== "function") return;
    const listener = (page: Page): void => {
      const pages = this.safeContextPages(session.context);
      const event: BrowserSessionContextPageLifecycleEvent = {
        phase: "CONTEXT_PAGE_CREATED",
        timestamp: new Date().toISOString(),
        platformKey: identity.platformKey,
        accountId: identity.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageDebugId: this.pageDebugIdForPage(session, page),
        pageIndex: pages ? pages.indexOf(page) : null,
        pageCount: pages?.length ?? null,
        canonicalPageId: this.pageDebugIdForPage(session, session.page),
        ...this.safeSanitizedPageUrl(page)
      };
      const events = this.contextPageLifecycleEvents.get(session) ?? [];
      events.push(event);
      this.contextPageLifecycleEvents.set(session, events);
      try { this.options.onContextPageLifecycle?.(event); } catch { /* diagnostics must not affect the Page lifecycle */ }
    };
    candidate.on("page", listener);
    this.contextPageListenerCleanups.set(session, () => {
      if (typeof candidate.off === "function") candidate.off("page", listener);
      else candidate.removeListener?.("page", listener);
    });
  }

  private safeContextPages(context: BrowserContext): Page[] | null {
    try { return context.pages(); } catch { return null; }
  }

  private safeSanitizedPageUrl(page: Page): { pageUrlOrigin: string | null; pageUrlPathname: string | null } {
    try {
      const parsed = new URL(page.url());
      return { pageUrlOrigin: parsed.origin, pageUrlPathname: parsed.pathname };
    } catch {
      return { pageUrlOrigin: null, pageUrlPathname: null };
    }
  }

  private pageContextMatches(session: BrowserSession, page: Page): boolean {
    try {
      assertBrowserSessionPageOwnership(session, page);
      return true;
    } catch (error) {
      if (error instanceof BrowserSessionPageOwnershipError) return false;
      throw error;
    }
  }

  private pageContextIdentityMatches(session: BrowserSession, page: Page): boolean {
    const candidate = page as unknown as { context?: () => BrowserContext };
    if (typeof candidate.context !== "function") return false;
    try { return candidate.context() === session.context; } catch { return false; }
  }

  private isPageClosed(page: Page): boolean {
    const candidate = page as unknown as { isClosed?: () => boolean };
    try { return typeof candidate.isClosed === "function" && candidate.isClosed(); } catch { return true; }
  }

  private emitOperationPageLifecycle(input: { phase: BrowserSessionOperationPageLifecycleEvent["phase"]; identity: BrowserSessionIdentity; action: UserInitiatedAction | null; session: BrowserSession; page: Page; pageDebugId: string | null; pageCountBefore: number | null; pageCountAfter: number | null; contextMatch: boolean | null }): void {
    if (!this.options.onOperationPageLifecycle) return;
    let sanitizedUrl: string | null = null;
    try {
      const raw = input.page.url();
      const parsed = new URL(raw);
      sanitizedUrl = `${parsed.origin}${parsed.pathname}`;
    } catch {
      sanitizedUrl = null;
    }
    try {
      this.options.onOperationPageLifecycle({
        phase: input.phase,
        timestamp: new Date().toISOString(),
        platformKey: input.identity.platformKey,
        accountId: input.identity.accountId,
        action: input.action,
        contextDebugId: input.session.contextDebugId ?? null,
        pageDebugId: input.pageDebugId,
        pageCountBefore: input.pageCountBefore,
        pageCountAfter: input.pageCountAfter,
        remainingPageCount: input.phase === "OPERATION_PAGE_CLOSE_COMPLETED" ? input.pageCountAfter : null,
        browserConnected: this.browserConnected(input.session.browser),
        sanitizedUrl,
        contextMatch: input.contextMatch
      });
    } catch {
      // Diagnostics must never change the browser lifecycle result.
    }
  }

  private updateRuntimeState(key: string, state: BrowserRuntimeAuthState, contextDebugId: string | null, reason: string | null): void {
    this.runtimeStates.set(key, {
      state,
      contextDebugId,
      updatedAt: new Date().toISOString(),
      reason
    });
  }

  private observeBrowserDisconnect(identity: BrowserSessionIdentity, session: BrowserSession): void {
    const candidate = session.browser as unknown as {
      on?: (event: string, listener: () => void) => void;
      off?: (event: string, listener: () => void) => void;
      removeListener?: (event: string, listener: () => void) => void;
    };
    if (typeof candidate.on !== "function") return;
    const listener = (): void => {
      const key = browserSessionCredentialKey(identity);
      const explicitCloseInProgress = this.explicitCloseSessions.has(session);
      this.lastDisconnectEvidence.set(key, {
        timestamp: new Date().toISOString(),
        contextDebugId: session.contextDebugId ?? null,
        reason: explicitCloseInProgress ? "EXPLICIT_CLOSE" : "UNEXPECTED_BROWSER_DISCONNECT"
      });
      this.emitSessionLifecycle({ phase: "CONTEXT_DISCONNECTED", identity, session, browserConnected: false });
      if (this.explicitCloseSessions.has(session)) return;
      this.handleBrowserDisconnected(identity, session);
    };
    candidate.on("disconnected", listener);
    const context = session.context as unknown as {
      on?: (event: string, listener: () => void) => void;
      off?: (event: string, listener: () => void) => void;
      removeListener?: (event: string, listener: () => void) => void;
    };
    const contextClosed = (): void => {
      if (this.explicitCloseSessions.has(session)) return;
      const key = browserSessionCredentialKey(identity);
      this.lastDisconnectEvidence.set(key, { timestamp: new Date().toISOString(), contextDebugId: session.contextDebugId ?? null, reason: "UNEXPECTED_BROWSER_DISCONNECT" });
      this.emitSessionLifecycle({ phase: "CONTEXT_DISCONNECTED", identity, session });
      this.handleBrowserDisconnected(identity, session);
    };
    context.on?.("close", contextClosed);
    this.disconnectListenerCleanups.set(session, () => {
      if (typeof context.off === "function") context.off("close", contextClosed);
      else context.removeListener?.("close", contextClosed);
      if (typeof candidate.off === "function") {
        candidate.off("disconnected", listener);
        return;
      }
      if (typeof candidate.removeListener === "function") candidate.removeListener("disconnected", listener);
    });
  }

  private detachBrowserDisconnectObserver(session: BrowserSession): void {
    this.disconnectListenerCleanups.get(session)?.();
    this.disconnectListenerCleanups.delete(session);
  }

  private handleBrowserDisconnected(identity: BrowserSessionIdentity, session: BrowserSession): void {
    const key = browserSessionCredentialKey(identity);
    if (this.activeSessions.get(key) !== session) {
      this.releaseSession(session);
      return;
    }
    this.pendingOpenPromises.delete(key);
    this.updateRuntimeState(key, "DISCONNECTED", session.contextDebugId ?? null, null);
    this.releaseSession(session, identity);
  }

  private safePageCount(context: BrowserContext): number | null {
    try { return context.pages().length; } catch { return null; }
  }

  private releaseSession(session: BrowserSession, identity?: BrowserSessionIdentity): void {
    this.detachBrowserDisconnectObserver(session);
    this.contextPageListenerCleanups.get(session)?.();
    this.contextPageListenerCleanups.delete(session);
    this.ownedSessions.delete(session);
    this.sessionIdentities.delete(session);
    this.operationPages.delete(session);
    if (identity) {
      this.clearActiveSession(identity, session);
      return;
    }
    for (const [key, active] of this.activeSessions) {
      if (active === session) {
        this.activeSessions.delete(key);
        this.lifecycleStates.set(key, "CLOSED");
      }
    }
  }

  private async closeUnregisteredSession(identity: BrowserSessionIdentity, session: BrowserSession, closeInfo: BrowserSessionCloseInfo): Promise<void> {
    await this.closeUnregisteredResources(identity, session.context, session.browser, {
      storageMode: session.storageMode,
      profilePath: session.profilePath,
      browserChannel: session.browserChannel ?? null,
      contextDebugId: session.contextDebugId ?? null,
      pageDebugId: session.pageDebugId ?? null
    }, closeInfo);
  }

  private async closeUnregisteredResources(
    identity: BrowserSessionIdentity,
    context: BrowserContext | null,
    browser: Browser | null,
    metadata: { storageMode: BrowserSessionStorageMode; profilePath: string | null; browserChannel: SystemBrowserChannel | null; contextDebugId: string | null; pageDebugId: string | null },
    closeInfo: BrowserSessionCloseInfo
  ): Promise<void> {
    const pageCount = context ? this.safePageCount(context) : null;
    const browserConnected = browser ? this.browserConnected(browser) : null;
    this.emitSessionLifecycle({ phase: "CLOSE_STARTED", identity, ...metadata, pageCount, browserConnected, closeInfo });
    let firstError: unknown;
    if (context) {
      try { await context.close(); } catch (error) { firstError = error; }
      if (!firstError) this.emitSessionLifecycle({ phase: "CONTEXT_CLOSE_COMPLETED", identity, ...metadata, pageCount: this.safePageCount(context), browserConnected: browser ? this.browserConnected(browser) : null, closeInfo });
    }
    if (browser && metadata.storageMode !== "PERSISTENT_PROFILE") {
      try { await browser.close(); } catch (error) { firstError ??= error; }
    }
    this.emitSessionLifecycle({ phase: firstError ? "CLOSE_FAILED" : "CLOSE_COMPLETED", identity, ...metadata, pageCount: context ? this.safePageCount(context) : null, browserConnected: browser ? this.browserConnected(browser) : null, closeInfo });
  }

  private async registerOpenSession(identity: BrowserSessionIdentity, session: BrowserSession, closeAllGeneration: number): Promise<BrowserSession> {
    if (closeAllGeneration !== this.closeAllGeneration) {
      await this.closeUnregisteredSession(identity, session, { reason: "APP_SHUTDOWN", callerOperation: "PlaywrightSessionManager.closeAll" });
      throw new Error("Browser session open was cancelled by closeAll");
    }
    this.ownedSessions.add(session);
    this.sessionIdentities.set(session, identity);
    this.pageDebugIds.set(session.page, session.pageDebugId ?? randomUUID());
    this.observeContextPages(identity, session);
    const key = browserSessionCredentialKey(identity);
    this.activeSessions.set(key, session);
    this.lifecycleStates.set(key, "READY");
    this.contextLaunchCounts.set(key, (this.contextLaunchCounts.get(key) ?? 0) + 1);
    this.observeBrowserDisconnect(identity, session);
    this.updateRuntimeState(key, "UNVERIFIED", session.contextDebugId ?? null, null);
    this.emitSessionLifecycle({ phase: "OPEN_COMPLETED", identity, session, browserConnected: this.browserConnected(session.browser) });
    return session;
  }

  private async writeProfileInitializedMarker(markerPath: string): Promise<void> {
    if (this.options.writeProfileInitializedMarker) {
      await this.options.writeProfileInitializedMarker(markerPath);
      return;
    }
    await writeFile(markerPath, "v1\n", { flag: "a" });
  }

}

const safePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/gu, "_") || "_";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class BrowserSessionManager extends PlaywrightSessionManager {}
