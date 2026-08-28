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
  executionMode: BrowserExecutionMode;
  headless: boolean;
  storageMode: BrowserSessionStorageMode;
  profilePath: string | null;
  browserChannel?: SystemBrowserChannel;
  /** Process-memory-only identity used to prove Context/Page continuity. */
  contextDebugId?: string;
  pageDebugId?: string;
}

export type BrowserSessionLifecyclePhase =
  | "OPEN_STARTED"
  | "OPEN_COMPLETED"
  | "CLOSE_STARTED"
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
  browserConnected: boolean | null;
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
  launchPersistentContext?: (userDataDir: string, options: { channel: SystemBrowserChannel; headless: boolean; storageState?: StorageState }) => Promise<BrowserContext>;
  onSessionLifecycle?: (event: BrowserSessionLifecycleEvent) => void;
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
  private readonly pendingConnections = new Set<string>();
  private readonly sessionIdentities = new WeakMap<BrowserSession, BrowserSessionIdentity>();
  readonly debugId = randomUUID();

  constructor(private readonly credentials: CredentialStore, private readonly options: BrowserSessionManagerOptions = {}) {}

  async open(identity: BrowserSessionIdentity, action: UserInitiatedAction, executionMode: BrowserExecutionMode = "VISIBLE"): Promise<BrowserSession> {
    assertExternalLaunchAllowed(action);
    const existing = this.getActiveSession(identity);
    if (existing?.executionMode === executionMode) return existing;
    if (existing) await this.close(existing);
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
      const persistentLaunch = await this.launchPersistentBrowser(persistentProfilePath, headless, profileInitialized ? undefined : storageState);
      const context = persistentLaunch.context;
      const browser = context.browser();
      if (!browser) {
        await context.close().catch(() => undefined);
        throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
      }
      context.setDefaultTimeout(this.options.timeoutMs ?? 30_000);
      let page: Page;
      try {
        page = await context.newPage();
      } catch {
        await context.close().catch(() => undefined);
        throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
      }
      await writeFile(join(persistentProfilePath, ".gmp-profile-initialized"), "v1\n", { flag: "a" });
      const session = { browser, context, page, hasStoredSession: Boolean(storageState) || profileInitialized, sessionIdHash: browserSessionIdHash(identity), executionMode, headless, storageMode: "PERSISTENT_PROFILE" as const, profilePath: persistentProfilePath, browserChannel: persistentLaunch.channel, contextDebugId: randomUUID(), pageDebugId: randomUUID() };
      this.ownedSessions.add(session);
      this.sessionIdentities.set(session, identity);
      this.activeSessions.set(browserSessionCredentialKey(identity), session);
      this.emitSessionLifecycle({ phase: "OPEN_COMPLETED", identity, session, browserConnected: this.browserConnected(session.browser) });
      return session;
    }
    const browserLaunch = await this.launchSystemBrowser(headless);
    const browser = browserLaunch.browser;
    let context: BrowserContext;
    try {
      context = await browser.newContext(storageState ? { storageState } : {});
    } catch {
      await browser.close().catch(() => undefined);
      throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
    }
    context.setDefaultTimeout(this.options.timeoutMs ?? 30_000);
    let page: Page;
    try {
      page = await context.newPage();
    } catch {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      throw new BrowserRuntimeError({ errorCode: "BROWSER_RUNTIME_LAUNCH_FAILED", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
    }
    const session = { browser, context, page, hasStoredSession: Boolean(storageState), sessionIdHash: browserSessionIdHash(identity), executionMode, headless, storageMode: "EPHEMERAL_STORAGE_STATE" as const, profilePath: null, browserChannel: browserLaunch.channel, contextDebugId: randomUUID(), pageDebugId: randomUUID() };
    this.ownedSessions.add(session);
    this.sessionIdentities.set(session, identity);
    this.activeSessions.set(browserSessionCredentialKey(identity), session);
    this.emitSessionLifecycle({ phase: "OPEN_COMPLETED", identity, session, browserConnected: this.browserConnected(session.browser) });
    return session;
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
  }

  getActiveSession(identity: BrowserSessionIdentity): BrowserSession | null {
    const key = browserSessionCredentialKey(identity);
    const session = this.activeSessions.get(key);
    if (!session) return null;
    if (this.isSessionClosed(session)) {
      this.activeSessions.delete(key);
      return null;
    }
    return session;
  }

  getActiveSessionKeys(): string[] { return [...this.activeSessions.keys()]; }

  setActiveSession(identity: BrowserSessionIdentity, session: BrowserSession): void {
    this.activeSessions.set(browserSessionCredentialKey(identity), session);
  }

  clearActiveSession(identity: BrowserSessionIdentity, session?: BrowserSession): void {
    const key = browserSessionCredentialKey(identity);
    if (!session || this.activeSessions.get(key) === session) this.activeSessions.delete(key);
  }

  markConnectionPending(identity: BrowserSessionIdentity): void { this.pendingConnections.add(browserSessionCredentialKey(identity)); }

  isConnectionPending(identity: BrowserSessionIdentity): boolean { return this.pendingConnections.has(browserSessionCredentialKey(identity)); }

  clearConnectionPending(identity: BrowserSessionIdentity): void { this.pendingConnections.delete(browserSessionCredentialKey(identity)); }

  async screenshot(page: Page, outputPath: string): Promise<string> {
    await mkdir(dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: true });
    return outputPath;
  }

  async close(session: BrowserSession): Promise<void> {
    const identity = this.sessionIdentities.get(session);
    if (identity) this.emitSessionLifecycle({ phase: "CLOSE_STARTED", identity, session, browserConnected: this.browserConnected(session.browser) });
    let firstError: unknown;
    try { await session.context.close(); } catch (error) { firstError = error; }
    if (!firstError && identity) this.emitSessionLifecycle({ phase: "CONTEXT_CLOSE_COMPLETED", identity, session, browserConnected: this.browserConnected(session.browser) });
    if (session.storageMode !== "PERSISTENT_PROFILE") {
      try { await session.browser.close(); } catch (error) { firstError ??= error; }
    }
    this.ownedSessions.delete(session);
    this.sessionIdentities.delete(session);
    for (const [key, active] of this.activeSessions) if (active === session) this.activeSessions.delete(key);
    if (identity) this.emitSessionLifecycle({ phase: firstError ? "CLOSE_FAILED" : "CLOSE_COMPLETED", identity, session, browserConnected: this.browserConnected(session.browser) });
    if (firstError) throw firstError;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.ownedSessions];
    await Promise.allSettled(sessions.map((session) => this.close(session)));
    this.activeSessions.clear();
    this.pendingConnections.clear();
  }

  debugArtifactPath(identity: BrowserSessionIdentity, fileName: string): string | null {
    if (!this.options.debugArtifactsDir) return null;
    const safe = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/gu, "_");
    return join(this.options.debugArtifactsDir, safe(identity.platformKey), safe(identity.accountId), safe(fileName));
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

  private isSessionClosed(session: BrowserSession): boolean {
    if (!session.page || typeof session.page !== "object") return false;
    const page = session.page as unknown as { isClosed?: () => boolean };
    return typeof page.isClosed === "function" && page.isClosed();
  }

  private browserConnected(browser: Browser): boolean | null {
    const candidate = browser as unknown as { isConnected?: () => boolean };
    return typeof candidate.isConnected === "function" ? candidate.isConnected() : null;
  }

  private emitSessionLifecycle(input: { phase: BrowserSessionLifecyclePhase; identity: BrowserSessionIdentity; session?: BrowserSession; storageMode?: BrowserSessionStorageMode; profilePath?: string | null; browserChannel?: SystemBrowserChannel | null; contextDebugId?: string | null; pageDebugId?: string | null; browserConnected?: boolean | null }): void {
    if (!this.options.onSessionLifecycle) return;
    const session = input.session;
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
        browserConnected: input.browserConnected ?? (session ? this.browserConnected(session.browser) : null)
      });
    } catch {
      // Diagnostics must never change the browser lifecycle result.
    }
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
