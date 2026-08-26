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
import { BrowserSessionManager, browserExecutionModeFromSettings, browserSessionIdHash, PlatformAdapterError, userInitiatedActionFromSettings, type BrowserExecutionMode, type BrowserRuntimeEvent, type BrowserSession } from "@publisher/adapters-core";
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
  private readonly activeSessions = new Map<string, BrowserSession>();
  private readonly pendingConnections = new Set<string>();

  constructor(definition: BrowserPlatformDefinition, options: BrowserAutomationAdapterOptions = {}) {
    this.definition = definition;
    this.platformKey = definition.platformKey;
    const sessionManager = options.sessionManager ?? (options.credentialStore ? new BrowserSessionManager(options.credentialStore, { timeoutMs: options.timeoutMs ?? 30_000, onRuntimeEvent: options.onBrowserRuntimeEvent }) : undefined);
    if (!sessionManager) throw new Error("BrowserAutomationAdapter requires a safe CredentialStore or BrowserSessionManager");
    this.sessionManager = sessionManager;
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
    await this.closeActive(identity);
    const session = await this.sessionManager.open(identity, userInitiatedActionFromSettings(ctx.settings), "VISIBLE");
    this.activeSessions.set(this.key(ctx), session);
    this.pendingConnections.add(this.key(ctx));
    const page = await this.page(session);
    await this.navigate(page, this.definition.loginUrl ?? this.definition.backendUrl);
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
    const key = this.key(ctx);
    const session = this.pendingConnections.has(key) ? this.activeSessions.get(key) : undefined;
    if (!session) return "needs_user_action";
    const page = await this.page(session);
    await this.navigate(page, this.definition.backendUrl);
    if (this.isLoginPage(page.url()) || this.isVerificationUrl(page.url())) return "needs_user_action";
    try {
      await this.sessionManager.save(identity, session.context);
    } catch (error) {
      try { await this.closeActive(identity); } catch { /* preserve the save failure */ }
      this.pendingConnections.delete(key);
      throw error;
    }
    this.pendingConnections.delete(key);
    try { await this.closeActive(identity); } catch { /* the Session is already persisted */ }
    return "logged_in";
  }

  async cancelConnection(ctx: AccountContext): Promise<void> {
    try { await this.closeActive(this.identity(ctx)); }
    finally { this.pendingConnections.delete(this.key(ctx)); }
  }

  isConnectionPending(ctx: AccountContext): boolean { return this.pendingConnections.has(this.key(ctx)); }

  async checkSession(ctx: AccountContext): Promise<LoginStatus> {
    const key = this.key(ctx);
    if (this.pendingConnections.has(key)) return "needs_user_action";
    const identity = this.identity(ctx);
    const executionMode = browserExecutionModeFromSettings(ctx.settings);
    let hasStored = false;
    try {
      hasStored = this.sessionManager.hasStoredSession(identity);
    } catch {
      return "needs_user_action";
    }
    const active = this.activeSessions.get(key);
    let session: BrowserSession;
    try {
      session = active ?? await this.sessionManager.open(identity, userInitiatedActionFromSettings(ctx.settings), executionMode);
    } catch (error) {
      if (this.isVerificationMessage(error instanceof Error ? error.message : "") || (error instanceof Error && /credential|decrypt|safe.?storage/iu.test(error.name + error.message))) return "needs_user_action";
      throw error;
    }
    const ownsActiveSession = Boolean(active);
    if (!active) this.activeSessions.set(key, session);
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
        await this.closeActive(identity).catch(() => undefined);
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

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    try {
      const prepared = await this.preparePublish(ctx, article);
      if (ctx.settings.dryRun === true) return { success: true, dryRun: true, prepared: true, response: { ...prepared.response, browserSessionIdHash: prepared.sessionIdHash, backendUrl: prepared.backendUrl, verificationStatus: "WaitingUser" } };
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${this.definition.displayName}首阶段只生成任务并打开后台；最终发布必须由用户在官方页面确认`);
    } finally {
      if (browserExecutionModeFromSettings(ctx.settings) === "BACKGROUND") await this.closeActive(this.identity(ctx)).catch(() => undefined);
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
      if (browserExecutionModeFromSettings(ctx.settings) === "BACKGROUND") await this.closeActive(this.identity(ctx)).catch(() => undefined);
    }
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> { return this.verifyPublish(ctx, externalId); }

  async verifyPublish(_ctx: AccountContext, _externalId?: string): Promise<PublishStatusResult> {
    throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${this.definition.displayName}首阶段没有已审阅的公开状态回查契约，请用户在官方后台确认结果`);
  }

  async logout(ctx: AccountContext): Promise<void> {
    const key = this.key(ctx);
    try { await this.closeActive(this.identity(ctx)); }
    finally {
      this.pendingConnections.delete(key);
      this.sessionManager.clear(this.identity(ctx));
    }
  }

  async releaseOperationSession(ctx: AccountContext): Promise<void> {
    if (browserExecutionModeFromSettings(ctx.settings) === "BACKGROUND") await this.closeActive(this.identity(ctx));
  }

  async closeOwnedSessions(): Promise<void> {
    try { await this.sessionManager.closeAll(); }
    finally {
      this.activeSessions.clear();
      this.pendingConnections.clear();
    }
  }

  protected sessionHash(ctx: AccountContext): string { return browserSessionIdHash(this.identity(ctx)); }

  protected async openBackendPage(ctx: AccountContext, url = this.definition.backendUrl): Promise<{ page: Awaited<ReturnType<BrowserSession["context"]["newPage"]>>; session: BrowserSession; backendUrl: string }> {
    const session = await this.getOrOpen(ctx);
    if (!session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${this.definition.displayName}尚未连接账号，请先完成官方登录`);
    const page = await this.page(session);
    await this.navigate(page, url);
    if (this.isLoginPage(page.url())) throw new BrowserAutomationError("LOGIN_EXPIRED", `${this.definition.displayName} Session 已过期，请重新登录`);
    return { page, session, backendUrl: page.url() };
  }

  /** Returns the already prepared visible session without navigating it. Platform L5 code may use this lifecycle hook, but selectors and submit actions stay platform-specific. */
  protected async activeBackendPage(ctx: AccountContext): Promise<{ page: Awaited<ReturnType<BrowserSession["context"]["newPage"]>>; session: BrowserSession } | null> {
    const session = this.activeSessions.get(this.key(ctx));
    if (!session || session.executionMode !== browserExecutionModeFromSettings(ctx.settings)) return null;
    return { page: await this.page(session), session };
  }

  protected async getOrOpen(ctx: AccountContext): Promise<BrowserSession | null> {
    const executionMode = browserExecutionModeFromSettings(ctx.settings);
    const active = this.activeSessions.get(this.key(ctx));
    if (active?.executionMode === executionMode) return active;
    if (active) await this.closeActive(this.identity(ctx));
    if (!this.sessionManager.hasStoredSession(this.identity(ctx))) return null;
    const session = await this.sessionManager.open(this.identity(ctx), userInitiatedActionFromSettings(ctx.settings), executionMode);
    this.activeSessions.set(this.key(ctx), session);
    return session;
  }

  protected async page(session: BrowserSession) {
    // Production sessions always create this page in BrowserSessionManager.open.
    // The fallback keeps lightweight adapter test doubles compatible without
    // weakening the owned Page invariant in the real harness.
    return session.page ?? session.context.pages()[0] ?? session.context.newPage();
  }

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
  private isVerificationUrl(url: string): boolean { return /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url); }
  private isVerificationMessage(value: string): boolean { return /captcha|human|security|验证码|短信|安全验证|人机/iu.test(value); }
  private identity(ctx: AccountContext): { platformKey: string; accountId: string } { return { platformKey: this.platformKey, accountId: ctx.accountId }; }
  private key(ctx: AccountContext): string { return `${this.platformKey}:${ctx.accountId}`; }
  private async closeActive(identity: { platformKey: string; accountId: string }): Promise<void> {
    const key = `${identity.platformKey}:${identity.accountId}`;
    const active = this.activeSessions.get(key);
    try { if (active) await this.sessionManager.close(active); }
    finally { this.activeSessions.delete(key); }
  }
}
