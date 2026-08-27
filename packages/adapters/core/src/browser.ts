import { mkdir } from "node:fs/promises";
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
  /** Process-memory-only identity used to prove Context/Page continuity. */
  contextDebugId?: string;
  pageDebugId?: string;
}

export interface BrowserSessionManagerOptions {
  timeoutMs?: number;
  debugArtifactsDir?: string;
  onRuntimeEvent?: (event: BrowserRuntimeEvent) => void;
  launchBrowser?: (options: { channel: SystemBrowserChannel; headless: boolean }) => Promise<Browser>;
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

/** Platform-neutral session storage. Platform adapters own navigation and selectors. */
export class PlaywrightSessionManager {
  private readonly ownedSessions = new Set<BrowserSession>();
  private readonly activeSessions = new Map<string, BrowserSession>();
  private readonly pendingConnections = new Set<string>();
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
    const browser = await this.launchSystemBrowser(headless);
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
    const session = { browser, context, page, hasStoredSession: Boolean(storageState), sessionIdHash: browserSessionIdHash(identity), executionMode, headless, contextDebugId: randomUUID(), pageDebugId: randomUUID() };
    this.ownedSessions.add(session);
    this.activeSessions.set(browserSessionCredentialKey(identity), session);
    return session;
  }

  async save(identity: BrowserSessionIdentity, context: BrowserContext): Promise<void> {
    const state = await context.storageState();
    this.credentials.set(browserSessionCredentialKey(identity), JSON.stringify(state));
  }

  hasStoredSession(identity: BrowserSessionIdentity): boolean { return this.credentials.has(browserSessionCredentialKey(identity)); }

  clear(identity: BrowserSessionIdentity): void { this.credentials.delete(browserSessionCredentialKey(identity)); }

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
    let firstError: unknown;
    try { await session.context.close(); } catch (error) { firstError = error; }
    try { await session.browser.close(); } catch (error) { firstError ??= error; }
    this.ownedSessions.delete(session);
    for (const [key, active] of this.activeSessions) if (active === session) this.activeSessions.delete(key);
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

  private async launchSystemBrowser(headless: boolean): Promise<Browser> {
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
        return browser;
      } catch {
        // The next system browser is the supported fallback. Internal launch details stay out of the UI.
      }
    }

    const diagnostic: BrowserRuntimeDiagnostic = { errorCode: "BROWSER_RUNTIME_NOT_FOUND", module: "BrowserSessionManager", timestamp: new Date().toISOString(), attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] };
    this.options.onRuntimeEvent?.({ code: "BROWSER_RUNTIME_NOT_FOUND", attemptedChannels: [...SYSTEM_BROWSER_CHANNELS] });
    throw new BrowserRuntimeError(diagnostic);
  }

  private isSessionClosed(session: BrowserSession): boolean {
    if (!session.page || typeof session.page !== "object") return false;
    const page = session.page as unknown as { isClosed?: () => boolean };
    return typeof page.isClosed === "function" && page.isClosed();
  }

}

export class BrowserSessionManager extends PlaywrightSessionManager {}
