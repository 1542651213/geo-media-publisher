import type {
  AccountContext,
  AdapterManifest,
  CredentialField,
  LoginSession,
  LoginStatus,
  PlatformCapabilities,
  PublishArticleInput,
  PublishResult,
  PublishStatusResult,
  PublishVideoInput,
  ValidationResult
} from "@publisher/domain";
import { randomUUID } from "node:crypto";
import { assertBrowserSessionPageOwnership, BrowserSessionManager, browserExecutionModeFromSettings, browserSessionCredentialKey, browserSessionIdHash, PlatformAdapterError, userInitiatedActionFromSettings, type BrowserExecutionMode, type BrowserRuntimeEvent, type BrowserSession, type BrowserSessionCanonicalPage, type BrowserSessionCloseInfo, type BrowserSessionContextPage, type BrowserSessionContextPageLifecycleEvent, type BrowserSessionOperationOptions, type BrowserSessionRuntimeSnapshot, type BrowserSessionRuntimeState, type BrowserSessionStorageMode, type SystemBrowserChannel } from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";
import type { AutomationAdapter, AutomationPrepareResult } from "@publisher/adapters-core";

export interface BrowserPlatformDefinition {
  platformKey: string;
  displayName: string;
  category: string;
  officialWebsite: string;
  developerPortal?: string;
  backendUrl: string;
  /** Optional official login entry; backendUrl remains the authenticated home. */
  loginUrl?: string;
  officialSources: string[];
  capabilities: PlatformCapabilities;
  version: string;
  blockingReason: string;
  researchStatus: AdapterManifest["researchStatus"];
  loginUrlPattern?: RegExp;
}

export interface BrowserAutomationAdapterOptions {
  credentialStore?: CredentialStore;
  sessionManager?: BrowserSessionManager;
  timeoutMs?: number;
  onBrowserRuntimeEvent?: (event: BrowserRuntimeEvent) => void;
  onConnectionDiagnostic?: (diagnostic: BrowserConnectionDiagnostic) => void;
}

export type BrowserConnectionDiagnosticPhase = "BEGIN_LOGIN_PAGE" | "COMPLETE_LOGIN_PAGE" | "LOGIN_PAGE_RELEASED" | "CANONICAL_AUTHENTICATED_PAGE_PROMOTED";
export type BrowserConnectionPageReleaseMode = "CLOSED" | "RETAINED_ACCOUNT_PAGE";

export interface BrowserConnectionDiagnostic {
  phase: BrowserConnectionDiagnosticPhase;
  timestamp: string;
  platformKey: string;
  accountId: string;
  adapterDebugId: string;
  browserSessionManagerDebugId: string;
  sessionKey: string;
  activeSessionFound: boolean;
  pendingLogin: boolean;
  contextCount: number;
  pageCount: number;
  contextDebugId: string | null;
  pageDebugId: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  pageClosed: boolean | null;
  sessionRetainedAfterPageClose: boolean | null;
  pageReleaseMode: BrowserConnectionPageReleaseMode | null;
  storageMode: BrowserSessionStorageMode | null;
  profilePath: string | null;
}

export interface BrowserSessionScopeEvidence {
  platformKey: string;
  accountId: string;
  sessionKey: string;
  sessionIdHash: string;
  pageUrl: string;
  pageTitle: string;
  pageCount: number;
  ownerVisiblePage: boolean;
  adapterDebugId: string;
  browserSessionManagerDebugId: string;
  contextDebugId: string;
  pageDebugId: string;
  pageClosed: boolean;
  storageMode: BrowserSessionStorageMode;
  profilePath: string | null;
  browserChannel: SystemBrowserChannel | null;
  headless: boolean;
  credentialSnapshotInjected: boolean;
}

export class BrowserAutomationError extends PlatformAdapterError {
  constructor(code: ConstructorParameters<typeof PlatformAdapterError>[0], message: string) {
    super(code, message);
    this.name = "BrowserAutomationError";
  }
}

const browserCredential: CredentialField = {
  key: "browserLogin",
  label: "官方浏览器登录 Session",
  type: "browser_login",
  required: true,
  helpText: "点击连接账号后，在官方页面由账号所有者完成登录、验证码和安全验证。"
};

/**
 * Shared safe browser lifecycle. Platform-specific selectors are deliberately
 * not placed here; this first phase only opens the official backend, persists
 * the user-owned encrypted Session and prepares a queue task.
 */
export class BrowserAutomationAdapter implements AutomationAdapter {
  readonly platformKey: string;
  readonly manifest: AdapterManifest;
  readonly automationType = "BrowserAutomation" as const;
  protected readonly definition: BrowserPlatformDefinition;
  protected readonly sessionManager: BrowserSessionManager;
  private readonly fallbackActiveSessions = new Map<string, BrowserSession>();
  private readonly fallbackPendingConnections = new Set<string>();
  private readonly diagnosticColdOpenAllowances = new Set<string>();
  private readonly onConnectionDiagnostic?: (diagnostic: BrowserConnectionDiagnostic) => void;
  readonly adapterDebugId = randomUUID();

  constructor(definition: BrowserPlatformDefinition, options: BrowserAutomationAdapterOptions = {}) {
    this.definition = definition;
    this.platformKey = definition.platformKey;
    const sessionManager = options.sessionManager ?? (options.credentialStore ? new BrowserSessionManager(options.credentialStore, { timeoutMs: options.timeoutMs ?? 30_000, onRuntimeEvent: options.onBrowserRuntimeEvent }) : undefined);
    if (!sessionManager) throw new Error("BrowserAutomationAdapter requires a safe CredentialStore or BrowserSessionManager");
    this.sessionManager = sessionManager;
    this.onConnectionDiagnostic = options.onConnectionDiagnostic;
    this.manifest = {
      platformKey: definition.platformKey,
      displayName: definition.displayName,
      category: definition.category,
      version: definition.version,
      adapterStatus: "ready",
      authStrategy: "ManualSession",
      callbackStrategy: "ManualCodeCallback",
      status: "WaitingForUser",
      researchStatus: definition.researchStatus,
      transport: "browser",
      integrationMode: "BrowserAutomation",
      supportsArticle: definition.capabilities.article,
      supportsVideo: definition.capabilities.video,
      officialWebsite: definition.officialWebsite,
      ...(definition.developerPortal ? { developerPortal: definition.developerPortal } : {}),
      lastVerifiedAt: "2026-08-21",
      blockingReason: definition.blockingReason,
      credentialSchema: [browserCredential],
      officialSources: [...definition.officialSources]
    };
  }

  getCapabilities(): PlatformCapabilities { return { ...this.definition.capabilities }; }
  getCredentialSchema(): CredentialField[] { return [{ ...browserCredential }]; }

  async connectAccount(ctx: AccountContext): Promise<LoginSession> {
    const identity = this.identity(ctx);
    await this.closeActive(identity, { reason: "EXPLICIT_RECONNECT", callerOperation: "BrowserAutomationAdapter.connectAccount" });
    const session = await this.sessionManager.open(identity, userInitiatedActionFromSettings(ctx.settings), "VISIBLE");
    this.rememberActiveSession(identity, session);
    this.markConnectionPending(identity);
    const page = await this.page(session);
    await this.navigate(page, this.definition.loginUrl ?? this.definition.backendUrl);
    await this.emitConnectionDiagnostic("BEGIN_LOGIN_PAGE", ctx, session);
    return {
      sessionId: `browser-${this.platformKey}-${ctx.accountId}-${Date.now()}`,
      requiresUserAction: true,
      opened: true,
      authStrategy: "ManualSession",
      callbackStrategy: "ManualCodeCallback",
      message: `${this.definition.displayName}官方后台已打开。请由账号所有者完成登录、验证码/短信/安全验证，然后点击“已完成登录”；系统不会绕过任何验证。`
    };
  }

  async completeConnection(ctx: AccountContext): Promise<LoginStatus> {
    const identity = this.identity(ctx);
    const session = this.connectionPending(identity) ? this.activeSession(identity) : null;
    await this.emitConnectionDiagnostic("COMPLETE_LOGIN_PAGE", ctx, session);
    if (!session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `ACTIVE_LOGIN_SESSION_NOT_FOUND: accountId=${ctx.accountId} 的可见登录 Session 已丢失，请重新开始连接`);
    const page = await this.page(session);
    if (!this.keepConnectionPageForCompletion(ctx)) await this.navigate(page, this.definition.backendUrl);
    const pageStatus = await this.inspectConnectionPage(ctx, page);
    if (pageStatus !== "logged_in") return pageStatus;
    if (this.deferConnectionPersistence(ctx)) return "logged_in";
    try { await this.saveConnectionSession(ctx); }
    catch (error) {
      try { await this.closeActive(identity, { reason: "PERSISTENCE_FAILURE", callerOperation: "BrowserAutomationAdapter.completeConnection" }); } catch { /* preserve the save failure */ }
      this.finishConnection(identity);
      throw error;
    }
    this.finishConnection(identity);
    if (!this.keepConnectionSessionOpenAfterCompletion(ctx)) {
      try { await this.closeActive(identity, { reason: "LEGACY_RELEASE", callerOperation: "BrowserAutomationAdapter.completeConnection" }); } catch { /* the Session is already persisted */ }
    }
    return "logged_in";
  }

  async cancelConnection(ctx: AccountContext): Promise<void> {
    try { await this.closeActive(this.identity(ctx), { reason: "CONNECTION_CANCEL", callerOperation: "BrowserAutomationAdapter.cancelConnection" }); }
    finally { this.finishConnection(this.identity(ctx)); }
  }

  isConnectionPending(ctx: AccountContext): boolean { return this.connectionPending(this.identity(ctx)); }

  async checkSession(ctx: AccountContext): Promise<LoginStatus> {
    const identity = this.identity(ctx);
    if (this.connectionPending(identity)) return "needs_user_action";
    const executionMode = browserExecutionModeFromSettings(ctx.settings);
    let hasStored = false;
    try {
      hasStored = this.sessionManager.hasStoredSession(identity);
    } catch {
      return "needs_user_action";
    }
    const active = this.activeSession(identity);
    let session: BrowserSession;
    try {
      session = active ?? await this.sessionManager.open(identity, userInitiatedActionFromSettings(ctx.settings), executionMode);
    } catch (error) {
      if (this.isVerificationMessage(error instanceof Error ? error.message : "") || (error instanceof Error && /credential|decrypt|safe.?storage/iu.test(error.name + error.message))) return "needs_user_action";
      throw error;
    }
    const ownsActiveSession = Boolean(active);
    if (!active) this.rememberActiveSession(identity, session);
    try {
      const page = await this.page(session);
      await this.navigate(page, this.definition.backendUrl);
      const currentUrl = page.url();
      if (this.isVerificationUrl(currentUrl)) return "needs_user_action";
      if (this.isLoginPage(currentUrl)) return hasStored ? "expired" : "needs_user_action";
      const dom = await this.readDomEvidence(page);
      if (!dom.bodyPresent) return "unknown";
      if (!hasStored) await this.sessionManager.save(identity, session.context);
      return "logged_in";
    } catch (error) {
      if (this.isVerificationMessage(error instanceof Error ? error.message : "")) return "needs_user_action";
      return "unknown";
    } finally {
      if (!ownsActiveSession && executionMode === "BACKGROUND") {
        await this.closeActive(identity, { reason: "BACKGROUND_OPERATION_RELEASE", callerOperation: "BrowserAutomationAdapter.checkSession" }).catch(() => undefined);
      }
    }
  }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> { return this.checkSession(ctx); }
  async beginLogin(ctx: AccountContext): Promise<LoginSession> { return this.connectAccount(ctx); }

  async openBackend(ctx: AccountContext): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string; executionMode: BrowserExecutionMode; headless: boolean }> {
    const opened = await this.openBackendPage(ctx);
    return { opened: true, backendUrl: opened.backendUrl, sessionIdHash: opened.session.sessionIdHash, executionMode: opened.session.executionMode, headless: opened.session.headless };
  }

  async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("；"));
    const opened = await this.openBackendPage(ctx);
    const page = opened.page;
    const dom = await this.readDomEvidence(page);
    return {
      prepared: true,
      requiresUserAction: true,
      message: "官方后台已由应用自建 Playwright Page 打开并取得真实 DOM 证据；当前通用 Adapter 不猜测平台编辑器 selector，也不会自动点击最终发布。",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: opened.backendUrl,
      response: { adapter: this.platformKey, stage: "backend_opened", pageUrl: opened.backendUrl, domBodyPresent: dom.bodyPresent, domBodyTextLength: dom.bodyTextLength, domEvidence: dom.evidence, automationType: this.automationType, networkCalls: "browser-session-only", browserExecutionMode: opened.session.executionMode, headless: opened.session.headless, finalSubmit: "user_action_required" }
    };
  }

  async runWithBrowserSession<T>(ctx: AccountContext, callerOperation: string, task: () => Promise<T>, options?: BrowserSessionOperationOptions): Promise<T> {
    const identity = this.identity(ctx);
    const runOptions = options?.retainSession === true ? options : undefined;
    const scopedTask = async (session: BrowserSession) => {
      this.rememberActiveSession(identity, session);
      try {
        return await task();
      } finally {
        this.fallbackActiveSessions.delete(`${identity.platformKey}:${identity.accountId}`);
      }
    };
    if (runOptions) return this.sessionManager.runScopedOperation(
      identity,
      userInitiatedActionFromSettings(ctx.settings),
      browserExecutionModeFromSettings(ctx.settings),
      callerOperation,
      scopedTask,
      runOptions
    );
    return this.sessionManager.runScopedOperation(
      identity,
      userInitiatedActionFromSettings(ctx.settings),
      browserExecutionModeFromSettings(ctx.settings),
      callerOperation,
      scopedTask
    );
  }

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    try {
      const prepared = await this.preparePublish(ctx, article);
      if (ctx.settings.dryRun === true) return { success: true, dryRun: true, prepared: true, response: { ...prepared.response, browserSessionIdHash: prepared.sessionIdHash, backendUrl: prepared.backendUrl, verificationStatus: "WaitingUser" } };
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${this.definition.displayName}首阶段只生成任务并打开后台；最终发布必须由用户在官方页面确认`);
    } finally {
      if (browserExecutionModeFromSettings(ctx.settings) === "BACKGROUND") await this.closeActive(this.identity(ctx), { reason: "BACKGROUND_OPERATION_RELEASE", callerOperation: "BrowserAutomationAdapter.publishArticle" }).catch(() => undefined);
    }
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!article.title.trim()) errors.push(`${this.definition.displayName}标题不能为空`);
    if (!article.body.trim()) errors.push(`${this.definition.displayName}正文不能为空`);
    if (this.definition.capabilities.maxTitleLength > 0 && article.title.length > this.definition.capabilities.maxTitleLength) errors.push(`${this.definition.displayName}标题不能超过 ${this.definition.capabilities.maxTitleLength} 个字符`);
    if (!this.definition.capabilities.coverImage && article.coverPath) errors.push(`${this.definition.displayName}当前未声明封面上传能力`);
    if ((article.images?.length ?? 0) > this.definition.capabilities.maxImageCount) errors.push(`${this.definition.displayName}图片数量不能超过 ${this.definition.capabilities.maxImageCount}`);
    if (!this.definition.capabilities.tags && article.tags.length > 0) warnings.push(`${this.definition.displayName}当前未声明标签能力，标签只保留在任务中`);
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishVideo(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult> {
    if (!this.definition.capabilities.video) throw new BrowserAutomationError("PERMISSION_DENIED", `${this.definition.displayName}当前未声明视频发布能力`);
    if (!video.title.trim() || !video.videoPath.trim()) throw new BrowserAutomationError("CONTENT_REJECTED", `${this.definition.displayName}视频标题和文件不能为空`);
    try {
      if (ctx.settings.dryRun === true) {
        const opened = await this.openBackend(ctx);
        return { success: true, dryRun: true, prepared: true, response: { adapter: this.platformKey, stage: "prepared", browserSessionIdHash: opened.sessionIdHash, backendUrl: opened.backendUrl, browserExecutionMode: opened.executionMode, headless: opened.headless, verificationStatus: "WaitingUser" } };
      }
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${this.definition.displayName}视频最终提交需要用户在官方页面确认`);
    } finally {
      if (browserExecutionModeFromSettings(ctx.settings) === "BACKGROUND") await this.closeActive(this.identity(ctx), { reason: "BACKGROUND_OPERATION_RELEASE", callerOperation: "BrowserAutomationAdapter.publishVideo" }).catch(() => undefined);
    }
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> { return this.verifyPublish(ctx, externalId); }

  async verifyPublish(_ctx: AccountContext, _externalId?: string): Promise<PublishStatusResult> {
    throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${this.definition.displayName}首阶段没有已审阅的公开状态回查契约，请用户在官方后台确认结果`);
  }

  async logout(ctx: AccountContext): Promise<void> {
    const identity = this.identity(ctx);
    try { await this.closeActive(this.identity(ctx), { reason: "EXPLICIT_LOGOUT", callerOperation: "BrowserAutomationAdapter.logout" }); }
    finally {
      this.finishConnection(identity);
      this.sessionManager.clear(identity);
    }
  }

  async releaseOperationSession(ctx: AccountContext): Promise<void> {
    if (browserExecutionModeFromSettings(ctx.settings) === "BACKGROUND") await this.closeActive(this.identity(ctx), { reason: "BACKGROUND_OPERATION_RELEASE", callerOperation: "BrowserAutomationAdapter.releaseOperationSession" });
  }

  async releaseConnectionSession(ctx: AccountContext): Promise<void> {
    const identity = this.identity(ctx);
    const session = await this.getOrOpen(ctx);
    try { if (session) await this.closeActive(identity, { reason: "CONNECTION_RELEASE", callerOperation: "BrowserAutomationAdapter.releaseConnectionSession" }); }
    finally { this.finishConnection(identity); }
  }

  rebindAccountSession(from: AccountContext, to: AccountContext): void {
    const fromIdentity = this.identity(from);
    const toIdentity = this.identity(to);
    const manager = this.sessionManager as unknown as { rebind?: (source: { platformKey: string; accountId: string }, target: { platformKey: string; accountId: string }) => void };
    if (typeof manager.rebind !== "function") throw new Error("BrowserSessionManager 不支持安全 Session 重绑定");
    manager.rebind(fromIdentity, toIdentity);
    const fromKey = fromIdentity.platformKey + ":" + fromIdentity.accountId;
    const toKey = toIdentity.platformKey + ":" + toIdentity.accountId;
    const active = this.fallbackActiveSessions.get(fromKey);
    if (active) {
      this.fallbackActiveSessions.delete(fromKey);
      this.fallbackActiveSessions.set(toKey, active);
    }
    if (this.fallbackPendingConnections.delete(fromKey)) this.fallbackPendingConnections.add(toKey);
  }

  async getBrowserSessionEvidence(ctx: AccountContext): Promise<BrowserSessionScopeEvidence | null> {
    const session = this.activeSession(this.identity(ctx));
    if (!session) return null;
    const page = await this.page(session);
    const pages = session.context.pages();
    if (!pages.includes(page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `BrowserSession/Page mismatch：accountId=${ctx.accountId} 的 owner Page 不属于当前 Context`);
    const candidate = page as unknown as { title?: () => Promise<string> };
    const pageTitle = typeof candidate.title === "function" ? await candidate.title().catch(() => "") : "";
    return {
      platformKey: this.platformKey,
      accountId: ctx.accountId,
      sessionKey: browserSessionCredentialKey(this.identity(ctx)),
      sessionIdHash: session.sessionIdHash,
      pageUrl: page.url(),
      pageTitle,
      pageCount: pages.length,
      ownerVisiblePage: session.executionMode === "VISIBLE" && !session.headless,
      adapterDebugId: this.adapterDebugId,
      browserSessionManagerDebugId: this.sessionManager.debugId,
      contextDebugId: session.contextDebugId ?? objectDebugId(session.context, "context"),
      pageDebugId: session.pageDebugId ?? objectDebugId(page, "page"),
      pageClosed: this.isPageClosed(page),
      storageMode: session.storageMode,
      profilePath: session.profilePath,
      browserChannel: session.browserChannel ?? null,
      headless: session.headless,
      credentialSnapshotInjected: session.credentialSnapshotInjected ?? false
    };
  }

  async closeOwnedSessions(): Promise<void> {
    try { await this.sessionManager.closeAll({ reason: "APP_SHUTDOWN", callerOperation: "BrowserAutomationAdapter.closeOwnedSessions" }); }
    finally {
      this.fallbackActiveSessions.clear();
      this.fallbackPendingConnections.clear();
    }
  }

  getBrowserConnectionDebugIds(): { adapterDebugId: string; browserSessionManagerDebugId: string } {
    return { adapterDebugId: this.adapterDebugId, browserSessionManagerDebugId: this.sessionManager.debugId };
  }

  getBrowserRuntimeState(ctx: AccountContext): BrowserSessionRuntimeState {
    return this.runtimeAuthState(this.identity(ctx));
  }

  getBrowserRuntimeSnapshot(ctx: AccountContext): BrowserSessionRuntimeSnapshot {
    const identity = this.identity(ctx);
    const manager = this.sessionManager as unknown as { getSessionSnapshot?: (value: { platformKey: string; accountId: string }) => BrowserSessionRuntimeSnapshot };
    const snapshot = manager.getSessionSnapshot?.(identity);
    if (snapshot) return snapshot;
    const runtimeState = this.runtimeAuthState(identity);
    return {
      lifecycleState: "CLOSED",
      platformKey: identity.platformKey,
      accountId: identity.accountId,
      sessionExists: false,
      browserSessionIdentity: null,
      contextDebugId: runtimeState.contextDebugId,
      canonicalPageDebugId: null,
      browserConnected: null,
      contextExists: false,
      contextPageCount: null,
      canonicalPageExists: false,
      canonicalPageClosed: null,
      canonicalPageContextMatchesSession: null,
      runtimeAuthState: runtimeState.state,
      contextLaunchCount: 0,
      canonicalPagePromotionCount: 0,
      activeOperation: null,
      mutexLocked: false,
      operationInProgress: false,
      lastDisconnectAt: null,
      lastDisconnectContextDebugId: null,
      lastDisconnectReason: null
    };
  }

  getBrowserConnectionDebugState(ctx: AccountContext): {
    requestedAccountId: string;
    activeSessionKeys: string[];
    targetSessionFound: boolean;
    targetSessionState: "MISSING" | "OPEN_PENDING" | "OPEN_NOT_PENDING";
    adapterDebugId: string;
    browserSessionManagerDebugId: string;
    contextDebugId: string | null;
    pageDebugId: string | null;
  } {
    const identity = this.identity(ctx);
    const session = this.activeSession(identity);
    return {
      requestedAccountId: ctx.accountId,
      activeSessionKeys: this.activeSessionKeys(identity),
      targetSessionFound: Boolean(session),
      targetSessionState: !session ? "MISSING" : this.connectionPending(identity) ? "OPEN_PENDING" : "OPEN_NOT_PENDING",
      adapterDebugId: this.adapterDebugId,
      browserSessionManagerDebugId: this.sessionManager.debugId,
      contextDebugId: session?.contextDebugId ?? (session ? objectDebugId(session.context, "context") : null),
      pageDebugId: session?.pageDebugId ?? (session ? objectDebugId(session.page, "page") : null)
    };
  }

  protected sessionHash(ctx: AccountContext): string { return browserSessionIdHash(this.identity(ctx)); }

  protected async openBackendPage(ctx: AccountContext, url = this.definition.backendUrl): Promise<{ page: Awaited<ReturnType<BrowserSession["context"]["newPage"]>>; session: BrowserSession; backendUrl: string }> {
    const identity = this.identity(ctx);
    const session = await this.getOrOpen(ctx);
    if (!session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${this.definition.displayName}尚未连接账号，请先完成官方登录`);
    const page = this.requiresActiveContextForOperations(identity)
      ? (await this.sessionManager.openOperationPage(identity, userInitiatedActionFromSettings(ctx.settings), session.executionMode)).page
      : await this.page(session);
    await this.navigate(page, url);
    if (this.isLoginPage(page.url())) throw new BrowserAutomationError("LOGIN_EXPIRED", `${this.definition.displayName} Session 已过期，请重新登录`);
    return { page, session, backendUrl: page.url() };
  }

  /** Returns the already prepared visible session without navigating it. Platform L5 code may use this lifecycle hook, but selectors and submit actions stay platform-specific. */
  protected async activeBackendPage(ctx: AccountContext): Promise<{ page: Awaited<ReturnType<BrowserSession["context"]["newPage"]>>; session: BrowserSession } | null> {
    const session = this.activeSession(this.identity(ctx));
    if (!session || session.executionMode !== browserExecutionModeFromSettings(ctx.settings)) return null;
    return { page: await this.page(session), session };
  }

  /** Returns only the account-owned canonical Page; it never cold-opens or rotates a Page. */
  protected async activeCanonicalPage(ctx: AccountContext): Promise<BrowserSessionCanonicalPage | null> {
    const identity = this.identity(ctx);
    const session = this.activeSession(identity);
    if (!session || session.executionMode !== browserExecutionModeFromSettings(ctx.settings)) return null;
    const manager = this.sessionManager as unknown as { getCanonicalPage?: (value: { platformKey: string; accountId: string }) => BrowserSessionCanonicalPage | null };
    const canonical = manager.getCanonicalPage?.(identity);
    if (canonical) {
      if (canonical.session !== session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "BrowserSession/Page mismatch：canonical Page 不属于当前 account-scoped Session");
      return canonical;
    }
    if (this.isPageClosed(session.page)) return null;
    const page = session.page;
    const pages = typeof session.context.pages === "function" ? session.context.pages() : [];
    if (!pages.includes(page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `BrowserSession/Page mismatch：accountId=${ctx.accountId} 的 canonical Page 不属于当前 Context`);
    assertBrowserSessionPageOwnership(session, page);
    return { session, page, pageDebugId: session.pageDebugId ?? "unknown-page" };
  }

  /** Diagnostic-only enumeration of Pages already present in the owned Context. */
  protected activeContextPages(ctx: AccountContext): readonly BrowserSessionContextPage[] | null {
    const identity = this.identity(ctx);
    const session = this.activeSession(identity);
    if (!session || session.executionMode !== browserExecutionModeFromSettings(ctx.settings)) return null;
    const pages = this.sessionManager.getContextPages(identity);
    if (pages === null) return null;
    for (const item of pages) {
      if (item.session !== session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "BrowserSession/Page mismatch：Context inventory returned a foreign Session");
      assertBrowserSessionPageOwnership(session, item.page);
    }
    return pages;
  }

  /** Diagnostic-only creation events captured from the owned Context. */
  protected activeContextPageLifecycleEvents(ctx: AccountContext): readonly BrowserSessionContextPageLifecycleEvent[] | null {
    const identity = this.identity(ctx);
    const session = this.activeSession(identity);
    if (!session || session.executionMode !== browserExecutionModeFromSettings(ctx.settings)) return null;
    return this.sessionManager.getContextPageLifecycleEvents(identity);
  }

  /** Diagnostic-only access for a platform adapter that needs to snapshot its own live session before close. */
  protected activeBrowserSession(ctx: AccountContext): BrowserSession | null {
    return this.activeSession(this.identity(ctx));
  }

  /** Diagnostic-only access to the account-owned session without navigation. */
  protected diagnosticBrowserSession(ctx: AccountContext): BrowserSession | null {
    const identity = this.identity(ctx);
    const active = this.activeSession(identity);
    if (!active && this.requiresActiveContextForOperations(identity)) this.allowDiagnosticColdOpenOnce(identity);
    return active;
  }

  protected async getOrOpen(ctx: AccountContext): Promise<BrowserSession | null> {
    const executionMode = browserExecutionModeFromSettings(ctx.settings);
    const identity = this.identity(ctx);
    const diagnosticColdOpenAllowed = this.consumeDiagnosticColdOpenAllowance(identity);
    const active = this.activeSession(identity);
    if (active?.executionMode === executionMode) return active;
    if (this.requiresActiveContextForOperations(identity) && !diagnosticColdOpenAllowed) return null;
    if (active) await this.closeActive(identity, { reason: "EXECUTION_MODE_REPLACEMENT", callerOperation: "BrowserAutomationAdapter.getOrOpen" });
    if (!this.sessionManager.hasStoredSession(identity)) return null;
    const session = await this.sessionManager.open(identity, userInitiatedActionFromSettings(ctx.settings), executionMode);
    this.rememberActiveSession(identity, session);
    return session;
  }

  protected async page(session: BrowserSession) {
    const context = session.context as unknown as { pages?: () => Awaited<ReturnType<BrowserSession["context"]["pages"]>> } | undefined;
    const pages = typeof context?.pages === "function" ? context.pages() : undefined;
    const page = (!this.isPageClosed(session.page) ? session.page : undefined) ?? pages?.find((candidate) => !this.isPageClosed(candidate)) ?? pages?.[0];
    if (!page) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "BrowserSession/Page mismatch：当前 account-scoped Session 没有可验证的 owner Page");
    if (pages && !pages.includes(page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "BrowserSession/Page mismatch：当前 owner Page 不属于 account-scoped BrowserContext");
    assertBrowserSessionPageOwnership(session, page);
    return page;
  }

  protected async saveConnectionSession(ctx: AccountContext): Promise<void> {
    const identity = this.identity(ctx);
    const session = this.activeSession(identity);
    if (!session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `ACTIVE_LOGIN_SESSION_NOT_FOUND: accountId=${ctx.accountId} 的可见登录 Session 已丢失，请重新开始连接`);
    await this.sessionManager.save(identity, session.context);
  }

  protected markConnectionComplete(identity: { platformKey: string; accountId: string }): void { this.finishConnection(identity); }

  protected deferConnectionPersistence(_ctx: AccountContext): boolean { return false; }

  protected keepConnectionPageForCompletion(_ctx: AccountContext): boolean { return false; }

  protected async inspectConnectionPage(_ctx: AccountContext, page: Awaited<ReturnType<BrowserSession["context"]["newPage"]>>): Promise<LoginStatus> {
    return this.isLoginPage(page.url()) || this.isVerificationUrl(page.url()) ? "needs_user_action" : "logged_in";
  }

  protected keepConnectionSessionOpenAfterCompletion(_ctx: AccountContext): boolean { return false; }

  protected async navigate(page: Awaited<ReturnType<BrowserSession["context"]["newPage"]>>, url: string): Promise<void> {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (error) {
      throw new BrowserAutomationError("NETWORK_ERROR", error instanceof Error ? error.message : "官方后台打开失败");
    }
  }

  private async readDomEvidence(page: Awaited<ReturnType<BrowserSession["context"]["newPage"]>>): Promise<{ bodyPresent: boolean; bodyTextLength: number; evidence: string }> {
    const candidate = page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
    if (typeof candidate.evaluate !== "function") return { bodyPresent: true, bodyTextLength: 0, evidence: "test-double-page-url-only" };
    const dom = await candidate.evaluate(() => ({ bodyPresent: Boolean(document.body), bodyTextLength: document.body?.innerText.length ?? 0 }));
    return { bodyPresent: dom.bodyPresent, bodyTextLength: dom.bodyTextLength, evidence: "playwright:document.body" };
  }

  protected isLoginPage(url: string): boolean { return this.definition.loginUrlPattern?.test(url) ?? /\/login(?:[/?#]|$)|\/signin(?:[/?#]|$)|passport|auth/iu.test(url); }
  protected isVerificationUrl(url: string): boolean { return /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url); }
  private isVerificationMessage(value: string): boolean { return /captcha|human|security|验证码|短信|安全验证|人机/iu.test(value); }
  protected identity(ctx: AccountContext): { platformKey: string; accountId: string } { return { platformKey: this.platformKey, accountId: ctx.accountId }; }
  protected activeSession(identity: { platformKey: string; accountId: string }): BrowserSession | null {
    const manager = this.sessionManager as unknown as { getActiveSession?: (value: { platformKey: string; accountId: string }) => BrowserSession | null; clearActiveSession?: (value: { platformKey: string; accountId: string }) => void };
    const managed = manager.getActiveSession?.(identity) ?? null;
    const session = managed ?? this.fallbackActiveSessions.get(`${identity.platformKey}:${identity.accountId}`) ?? null;
    if (session && this.isPageClosed(session.page)) {
      if (this.retainsContextAfterPageClose(identity)) {
        try {
          session.context.pages();
          return session;
        } catch {
          // Fall through to clear the disconnected session.
        }
      }
      manager.clearActiveSession?.(identity);
      this.fallbackActiveSessions.delete(`${identity.platformKey}:${identity.accountId}`);
      return null;
    }
    return session;
  }

  private activeSessionKeys(identity: { platformKey: string; accountId: string }): string[] {
    const manager = this.sessionManager as unknown as { getActiveSessionKeys?: () => string[] };
    const managed = manager.getActiveSessionKeys?.();
    if (managed) return [...new Set(managed)];
    const active = this.fallbackActiveSessions.has(`${identity.platformKey}:${identity.accountId}`) ? [browserSessionCredentialKey(identity)] : [];
    return active;
  }

  protected rememberActiveSession(identity: { platformKey: string; accountId: string }, session: BrowserSession): void {
    const manager = this.sessionManager as unknown as { setActiveSession?: (value: { platformKey: string; accountId: string }, value2: BrowserSession) => void };
    manager.setActiveSession?.(identity, session);
    this.fallbackActiveSessions.set(`${identity.platformKey}:${identity.accountId}`, session);
  }

  private markConnectionPending(identity: { platformKey: string; accountId: string }): void {
    const manager = this.sessionManager as unknown as { markConnectionPending?: (value: { platformKey: string; accountId: string }) => void };
    manager.markConnectionPending?.(identity);
    this.fallbackPendingConnections.add(`${identity.platformKey}:${identity.accountId}`);
  }

  private connectionPending(identity: { platformKey: string; accountId: string }): boolean {
    const manager = this.sessionManager as unknown as { isConnectionPending?: (value: { platformKey: string; accountId: string }) => boolean };
    return Boolean(manager.isConnectionPending?.(identity)) || this.fallbackPendingConnections.has(`${identity.platformKey}:${identity.accountId}`);
  }

  private finishConnection(identity: { platformKey: string; accountId: string }): void {
    const manager = this.sessionManager as unknown as { clearConnectionPending?: (value: { platformKey: string; accountId: string }) => void };
    manager.clearConnectionPending?.(identity);
    this.fallbackPendingConnections.delete(`${identity.platformKey}:${identity.accountId}`);
  }

  private async closeActive(identity: { platformKey: string; accountId: string }, closeInfo?: BrowserSessionCloseInfo): Promise<void> {
    const key = `${identity.platformKey}:${identity.accountId}`;
    const active = this.activeSession(identity);
    try { if (active) await this.sessionManager.close(active, closeInfo); }
    finally {
      const manager = this.sessionManager as unknown as { clearActiveSession?: (value: { platformKey: string; accountId: string }, value2?: BrowserSession) => void };
      manager.clearActiveSession?.(identity, active ?? undefined);
      this.fallbackActiveSessions.delete(key);
    }
  }

  private isPageClosed(page: unknown): boolean {
    if (!page || typeof page !== "object") return false;
    const candidate = page as { isClosed?: () => boolean };
    return typeof candidate.isClosed === "function" && candidate.isClosed();
  }

  private requiresActiveContextForOperations(identity: { platformKey: string; accountId: string }): boolean {
    const manager = this.sessionManager as unknown as { requiresActiveContextForOperations?: (value: { platformKey: string; accountId: string }) => boolean };
    return Boolean(manager.requiresActiveContextForOperations?.(identity));
  }

  private retainsContextAfterPageClose(identity: { platformKey: string; accountId: string }): boolean {
    const manager = this.sessionManager as unknown as { retainsContextAfterPageClose?: (value: { platformKey: string; accountId: string }) => boolean };
    return Boolean(manager.retainsContextAfterPageClose?.(identity));
  }

  private runtimeAuthState(identity: { platformKey: string; accountId: string }): BrowserSessionRuntimeState {
    const manager = this.sessionManager as unknown as { getRuntimeAuthState?: (value: { platformKey: string; accountId: string }) => BrowserSessionRuntimeState };
    return manager.getRuntimeAuthState?.(identity) ?? {
      state: "UNVERIFIED",
      contextDebugId: null,
      updatedAt: new Date(0).toISOString(),
      reason: null
    };
  }

  private allowDiagnosticColdOpenOnce(identity: { platformKey: string; accountId: string }): void {
    const key = `${identity.platformKey}:${identity.accountId}`;
    this.diagnosticColdOpenAllowances.add(key);
    queueMicrotask(() => { this.diagnosticColdOpenAllowances.delete(key); });
  }

  private consumeDiagnosticColdOpenAllowance(identity: { platformKey: string; accountId: string }): boolean {
    const key = `${identity.platformKey}:${identity.accountId}`;
    const allowed = this.diagnosticColdOpenAllowances.has(key);
    if (allowed) this.diagnosticColdOpenAllowances.delete(key);
    return allowed;
  }

  protected async emitConnectionDiagnostic(phase: BrowserConnectionDiagnosticPhase, ctx: AccountContext, session: BrowserSession | null, sessionRetainedAfterPageClose: boolean | null = null, pageReleaseMode: BrowserConnectionPageReleaseMode | null = null): Promise<void> {
    if (!this.onConnectionDiagnostic) return;
    let contextCount = 0;
    let pageCount = 0;
    let contextDebugId: string | null = null;
    let pageDebugId: string | null = null;
    let pageUrl: string | null = null;
    let pageTitle: string | null = null;
    let pageClosed: boolean | null = null;
    let storageMode: BrowserSessionStorageMode | null = null;
    let profilePath: string | null = null;
    try {
      if (session) {
        contextCount = 1;
        storageMode = session.storageMode;
        profilePath = session.profilePath;
        contextDebugId = session.contextDebugId ?? objectDebugId(session.context, "context");
        const pages = typeof session.context.pages === "function" ? session.context.pages() : [];
        pageCount = pages.length;
        const page = session.page ?? pages[0];
        if (page) {
          pageDebugId = session.pageDebugId ?? objectDebugId(page, "page");
          pageClosed = this.isPageClosed(page);
          pageUrl = typeof page.url === "function" ? page.url() : null;
          const titled = page as unknown as { title?: () => Promise<string> };
          pageTitle = typeof titled.title === "function" ? await titled.title().catch(() => "") : null;
        }
        const browser = session.browser as unknown as { contexts?: () => unknown[] };
        if (typeof browser?.contexts === "function") contextCount = browser.contexts().length;
      }
    } catch {
      // Diagnostics must remain best-effort even when the owner closes a Page/Context.
    }
    try {
      this.onConnectionDiagnostic({
        phase,
        timestamp: new Date().toISOString(),
        platformKey: this.platformKey,
        accountId: ctx.accountId,
        adapterDebugId: this.adapterDebugId,
        browserSessionManagerDebugId: this.sessionManager.debugId,
        sessionKey: browserSessionCredentialKey(this.identity(ctx)),
        activeSessionFound: Boolean(session),
        pendingLogin: this.connectionPending(this.identity(ctx)),
        contextCount,
        pageCount,
        contextDebugId,
        pageDebugId,
        pageUrl,
        pageTitle,
        pageClosed,
        sessionRetainedAfterPageClose,
        pageReleaseMode,
        storageMode,
        profilePath
      });
    } catch {
      // Diagnostics must never change the login result.
    }
  }
}

const objectDebugIds = new WeakMap<object, string>();
function objectDebugId(value: object, kind: "context" | "page"): string {
  const existing = objectDebugIds.get(value);
  if (existing) return existing;
  const created = `${kind}-${randomUUID()}`;
  objectDebugIds.set(value, created);
  return created;
}
