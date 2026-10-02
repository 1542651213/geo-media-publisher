import { shell } from "electron";
import { createServer, type Server } from "node:http";
import type { Account, AccountContext, AccountProfile, AuthStrategy, AuthorizationStatus, LoginSession, OAuthCallbackStrategy } from "@publisher/domain";
import type { AppRepository } from "@publisher/db";
import { assertExternalLaunchAllowed, isOAuthCredentialRejection, type AdapterRegistry, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";
import type { Logger } from "@publisher/logger";

interface PendingSession {
  state: string;
  callbackUrl?: string;
  startedAt: number;
  loopbackServer?: Server;
  timeout?: NodeJS.Timeout;
  request: OAuthRequestSnapshot;
  pendingCredentialSnapshot: string | null;
}

interface OAuthRequestSnapshot {
  accountId: string;
  platformKey: string;
  epoch: number;
  accountFingerprint: string;
  sessionFingerprint: string | null;
}

interface OAuthSessionRepository {
  getAccountById: AppRepository["getAccountById"];
  updateAccount(accountId: string, input: Parameters<AppRepository["updateAccount"]>[1]): unknown;
  upsertAccountAuthorization(input: Parameters<AppRepository["upsertAccountAuthorization"]>[0]): unknown;
}

export interface OAuthSessionManagerDependencies {
  repository: OAuthSessionRepository;
  registry: Pick<AdapterRegistry, "get">;
  credentials: CredentialStore;
  logger: Logger;
  accountContext(accountId: string, platformKey: string, action?: UserInitiatedAction): AccountContext;
  /** Main-owned, non-secret company/version/login-generation/identity fingerprint. Null means unavailable. */
  sessionFingerprint?(accountId: string, platformKey: string): string | null;
  /** Main may guard the shared encrypted CredentialStore with AsyncLocalStorage over this entire Adapter I/O chain. */
  runInAuthScope?<T>(isCurrent: () => boolean, operation: () => Promise<T>): Promise<T>;
}

export interface OAuthCompletionSummary {
  configured: boolean;
  accountStatus: "Connected";
  authorizationStatus: AuthorizationStatus;
  accountId: string | null;
  accountName: string | null;
  scopes: string[];
  expiresAt: string | null;
}

const OAUTH_STRATEGIES = new Set<AuthStrategy>(["OAuth2", "OAuth2PKCE"]);
const DISCONNECT_KEYS = ["accessToken", "oauthAccessToken", "refreshToken", "oauthRefreshToken"];

export class OAuthSessionManager {
  private readonly pending = new Map<string, PendingSession>();
  private readonly epochs = new Map<string, number>();

  constructor(private readonly deps: OAuthSessionManagerDependencies) {}

  async begin(accountId: string, platformKey: string, action?: UserInitiatedAction): Promise<LoginSession> {
    const adapter = this.adapter(platformKey);
    const manifest = adapter.manifest;
    const base: Pick<LoginSession, "authStrategy" | "callbackStrategy"> = { authStrategy: manifest.authStrategy, callbackStrategy: manifest.callbackStrategy };
    if (!OAUTH_STRATEGIES.has(manifest.authStrategy) || manifest.status === "Blocked" || manifest.status === "NotImplemented" || manifest.status === "ManualOnly") {
      return { sessionId: `login-info-${accountId}-${Date.now()}`, requiresUserAction: true, ...base, opened: false, message: manifest.blockingReason ?? "当前平台没有已验证的官方自动 OAuth 登录能力。" };
    }
    assertExternalLaunchAllowed(action ?? { userActionId: null, triggerSource: "APP_STARTUP" });
    this.invalidate(accountId, platformKey);
    const request = this.capture(accountId, platformKey);

    const baseContext = this.deps.accountContext(accountId, platformKey, action);
    const loopback = manifest.callbackStrategy === "LoopbackCallback" ? await this.startLoopbackServer(accountId, platformKey) : undefined;
    let session: LoginSession;
    try {
      this.assertCurrent(request);
      const context: AccountContext = loopback ? { ...baseContext, settings: { ...baseContext.settings, oauthRedirectUri: loopback.callbackUrl } } : baseContext;
      session = await this.perform(request, () => adapter.beginLogin(context));
      this.assertCurrent(request);
    } catch (error) {
      loopback?.server.close();
      throw error;
    }
    const result: LoginSession = { ...session, ...base, opened: false };
    if (!session.authorizationUrl) {
      loopback?.server.close();
      this.deps.repository.updateAccount(accountId, { loginStatus: "needs_user_action", pausedReason: session.message ?? "等待用户完成平台正常授权" });
      this.deps.logger.warn("OAUTH", "OAUTH_START_BLOCKED", session.message ?? "OAuth 授权未生成", { accountId, platformKey, authStrategy: manifest.authStrategy });
      return result;
    }

    let authorizationUrl: string;
    try { authorizationUrl = this.officialUrl(session.authorizationUrl); }
    catch (error) { loopback?.server.close(); throw error; }
    const state = new URL(authorizationUrl).searchParams.get("state");
    if (!state) { loopback?.server.close(); throw new Error("OAuth authorization URL 缺少 state"); }
    try { this.validateCallbackDeclaration(manifest.callbackStrategy, session.callbackUrl); }
    catch (error) { loopback?.server.close(); throw error; }
    const pending: PendingSession = { state, callbackUrl: session.callbackUrl, startedAt: Date.now(), request,
      pendingCredentialSnapshot: this.deps.credentials.get(`oauth:${platformKey}:${accountId}:pending`), ...(loopback ? { loopbackServer: loopback.server } : {}) };
    const timeout = setTimeout(() => {
      if (this.pending.get(this.key(accountId, platformKey)) !== pending) return;
      const current = this.isCurrent(request);
      this.finishPending(accountId, platformKey, pending);
      if (!current) return;
      this.deps.repository.updateAccount(accountId, { loginStatus: "needs_user_action", pausedReason: "OAuth 回调超时，请重新发起授权" });
      this.deps.logger.warn("OAUTH", "CALLBACK_TIMEOUT", "OAuth 回调等待超时", { accountId, platformKey });
    }, 10 * 60 * 1000);
    timeout.unref();
    pending.timeout = timeout;
    this.pending.set(this.key(accountId, platformKey), pending);
    this.deps.repository.updateAccount(accountId, { loginStatus: "needs_user_action", pausedReason: "等待用户完成官方 OAuth 授权" });
    this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: manifest.authStrategy, status: "NotAuthorized", scopes: [] });
    this.deps.logger.info("OAUTH", "OAUTH_STARTED", "已生成官方 OAuth 授权会话", { accountId, platformKey, authStrategy: manifest.authStrategy, callbackStrategy: manifest.callbackStrategy, authorizationHost: new URL(authorizationUrl).host });
    try {
      await shell.openExternal(authorizationUrl);
    } catch (error) {
      this.finishPending(accountId, platformKey, pending);
      throw error;
    }
    this.deps.logger.info("OAUTH", "BROWSER_OPENED", "已在系统浏览器打开官方 OAuth 页面", { accountId, platformKey, authorizationHost: new URL(authorizationUrl).host, userActionId: action?.userActionId, triggerSource: action?.triggerSource });
    return { ...result, opened: true };
  }

  async complete(accountId: string, platformKey: string, input: string): Promise<OAuthCompletionSummary> {
    const adapter = this.adapter(platformKey);
    const pending = this.pending.get(this.key(accountId, platformKey));
    if (!pending) throw new Error("当前 OAuth 授权会话不存在或已过期，请重新发起授权");
    this.assertCurrent(pending.request);
    const parsed = this.parseCallback(input, adapter.manifest.callbackStrategy, pending);
    this.deps.logger.info("OAUTH", "CALLBACK_RECEIVED", "收到 OAuth 回调输入", { accountId, platformKey, callbackStrategy: adapter.manifest.callbackStrategy, inputType: parsed.inputType });
    if (!adapter.completeLogin) throw new Error("该平台 Adapter 尚未实现 OAuth 回调交换");
    let profile: AccountProfile;
    try {
      profile = await this.perform(pending.request, async () => {
        await adapter.completeLogin!(this.deps.accountContext(accountId, platformKey), parsed.code, parsed.state);
        this.assertCurrent(pending.request);
        this.deps.logger.info("OAUTH", "STATE_VALIDATED", "OAuth state 校验通过", { accountId, platformKey });
        const result: AccountProfile = adapter.getAccountProfile ? await adapter.getAccountProfile(this.deps.accountContext(accountId, platformKey)) : {};
        this.assertCurrent(pending.request);
        return result;
      });
    } catch (error) {
      const current = this.isCurrent(pending.request);
      this.finishPending(accountId, platformKey, pending);
      if (!current) throw this.staleError(pending.request);
      throw error;
    }
    this.assertCurrent(pending.request);
    const authorizationStatus = profile.authorizationStatus ?? "Authorized";
    const summary: OAuthCompletionSummary = {
      configured: true,
      accountStatus: "Connected",
      authorizationStatus,
      accountId: profile.accountId ?? null,
      accountName: profile.accountName ?? null,
      scopes: profile.scopes ?? [],
      expiresAt: profile.expiresAt ?? null
    };
    this.deps.repository.updateAccount(accountId, { loginStatus: "logged_in", pausedReason: null, failedCount: 0 });
    this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: adapter.manifest.authStrategy, status: authorizationStatus, scopes: summary.scopes, expiresAt: summary.expiresAt, providerAccountId: summary.accountId, providerAccountName: summary.accountName });
    this.finishPending(accountId, platformKey, pending);
    this.deps.logger.info("OAUTH", "TOKEN_EXCHANGED", "OAuth authorization code 已由主进程交换", { accountId, platformKey });
    this.deps.logger.info("OAUTH", "PROFILE_FETCHED", "已读取脱敏账号信息", { accountId, platformKey, providerAccountId: summary.accountId, scopeCount: summary.scopes.length });
    this.deps.logger.info("OAUTH", "ACCOUNT_CONNECTED", "账号连接记录已完成", { accountId, platformKey, authorizationStatus, scopeCount: summary.scopes.length });
    return summary;
  }

  async refresh(accountId: string, platformKey: string): Promise<{ accountStatus: "Connected"; authorizationStatus: AuthorizationStatus; expiresAt: string | null }> {
    const adapter = this.adapter(platformKey);
    if (!adapter.refreshLogin) throw new Error("该平台没有已验证的 refresh token 能力");
    if (this.isPending(accountId, platformKey)) throw new Error("OAuth 授权正在进行，请先完成或重新发起当前授权");
    const key = this.key(accountId, platformKey);
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    const request = this.capture(accountId, platformKey);
    try {
      const profile = await this.perform(request, async () => {
        await adapter.refreshLogin!(this.deps.accountContext(accountId, platformKey));
        this.assertCurrent(request);
        const result: AccountProfile = adapter.getAccountProfile ? await adapter.getAccountProfile(this.deps.accountContext(accountId, platformKey)) : {};
        this.assertCurrent(request);
        return result;
      });
      this.assertCurrent(request);
      const authorizationStatus = profile.authorizationStatus ?? "Authorized";
      this.deps.repository.updateAccount(accountId, { loginStatus: "logged_in", pausedReason: null });
      this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: adapter.manifest.authStrategy, status: authorizationStatus, scopes: profile.scopes ?? [], expiresAt: profile.expiresAt ?? null, providerAccountId: profile.accountId ?? null, providerAccountName: profile.accountName ?? null });
      this.deps.logger.info("OAUTH", "TOKEN_REFRESHED", "OAuth Token 已由主进程刷新", { accountId, platformKey });
      return { accountStatus: "Connected", authorizationStatus, expiresAt: profile.expiresAt ?? null };
    } catch (error) {
      if (!this.isCurrent(request)) throw this.staleError(request);
      if (isOAuthCredentialRejection(error)) {
        this.deps.repository.updateAccount(accountId, { loginStatus: "expired", pausedReason: "平台明确拒绝当前授权，需要重新授权" });
        this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: adapter.manifest.authStrategy, status: "Revoked" });
        this.deps.logger.warn("OAUTH", "REAUTH_REQUIRED", "平台明确拒绝 OAuth 凭据，需要重新授权", { accountId, platformKey, errorType: error instanceof Error ? error.name : "UnknownError" });
      } else {
        this.deps.logger.warn("OAUTH", "REFRESH_UNVERIFIED", "OAuth 刷新或身份检查未能核验，保留现有授权状态", { accountId, platformKey, errorType: error instanceof Error ? error.name : "UnknownError" });
      }
      throw error;
    }
  }

  disconnect(accountId: string, platformKey: string): void {
    const adapter = this.adapter(platformKey);
    this.invalidate(accountId, platformKey);
    for (const key of [`oauth:${platformKey}:${accountId}:token`, `oauth:${platformKey}:${accountId}:pending`, `facebook:${accountId}:page-token`, ...DISCONNECT_KEYS.map((item) => `account:${accountId}:${platformKey}:${item}`)]) this.deps.credentials.delete(key);
    this.deps.repository.updateAccount(accountId, { loginStatus: "logged_out", pausedReason: null });
    this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: adapter.manifest.authStrategy, status: "NotAuthorized", scopes: [], expiresAt: null, providerAccountId: null, providerAccountName: null });
    this.deps.logger.info("OAUTH", "LOCAL_DISCONNECT", "已断开本地账号凭据；未宣称 Provider 端撤权", { accountId, platformKey });
  }

  isPending(accountId: string, platformKey: string): boolean { return this.pending.has(this.key(accountId, platformKey)); }

  /** Main calls this for disable/disconnect/reassignment/new credentials, including same-company reconfirmation. */
  invalidate(accountId: string, platformKey: string): void {
    const key = this.key(accountId, platformKey);
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    this.closePending(accountId, platformKey);
    // Clear only pending local authorization, never an access token. OAuthManager's pending CAS then rejects a late exchange.
    this.deps.credentials.delete(`oauth:${platformKey}:${accountId}:pending`);
  }

  private adapter(platformKey: string): PlatformAdapter { return this.deps.registry.get(platformKey); }

  private parseCallback(input: string, strategy: OAuthCallbackStrategy, pending: PendingSession | undefined): { code: string; state: string; inputType: "url" | "code" } {
    const value = input.trim();
    if (!value) throw new Error("OAuth 回调不能为空");
    try {
      const url = new URL(value);
      this.validateCallbackDeclaration(strategy, url.toString());
      const error = url.searchParams.get("error");
      if (error) throw new Error(`OAuth 授权失败：${error}`);
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      if (!code || !state) throw new Error("OAuth 回调缺少 code 或 state");
      if (pending && state !== pending.state) throw new Error("OAuth state 校验失败，请重新发起授权");
      return { code, state, inputType: "url" };
    } catch (error) {
      if (error instanceof Error && (/OAuth (?:授权失败|回调|state)/u.test(error.message) || value.includes("://"))) throw error;
      if (!pending) throw new Error("OAuth 回调 URL 无效；请粘贴完整 callback URL 或 authorization code");
      return { code: value, state: pending.state, inputType: "code" };
    }
  }

  private validateCallbackDeclaration(strategy: OAuthCallbackStrategy, callbackUrl?: string): void {
    if (!callbackUrl) return;
    let url: URL;
    try { url = new URL(callbackUrl); } catch { throw new Error("OAuth 回调地址无效"); }
    if (strategy === "HttpsCallback" && url.protocol !== "https:") throw new Error("该 Adapter 声明需要 HTTPS Callback");
    if (strategy === "LoopbackCallback" && (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("该 Adapter 声明需要 127.0.0.1 loopback Callback");
    if (strategy === "CustomProtocolCallback" && url.protocol !== "geomediapublisher:") throw new Error("该 Adapter 声明需要 geomediapublisher:// Callback");
  }

  private officialUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("OAuth 授权地址必须使用 HTTPS 官方页面");
    return url.toString();
  }

  private async startLoopbackServer(accountId: string, platformKey: string): Promise<{ server: Server; callbackUrl: string }> {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/oauth/callback") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }
      const callbackUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}${requestUrl.pathname}${requestUrl.search}`;
      void this.complete(accountId, platformKey, callbackUrl).then(() => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<p>授权已完成，可以返回 Geo Media Publisher。</p>");
      }).catch((error: unknown) => {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<p>授权未完成：${escapeHtml(error instanceof Error ? error.message : "未知错误")}。请返回应用重新发起授权。</p>`);
      }).finally(() => server.close());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); throw new Error("无法启动 OAuth loopback Callback"); }
    return { server, callbackUrl: `http://127.0.0.1:${address.port}/oauth/callback` };
  }

  private closePending(accountId: string, platformKey: string, expected?: PendingSession): boolean {
    const pending = this.pending.get(this.key(accountId, platformKey));
    if (expected && pending !== expected) return false;
    if (pending?.timeout) clearTimeout(pending.timeout);
    pending?.loopbackServer?.close();
    this.pending.delete(this.key(accountId, platformKey));
    return Boolean(pending);
  }

  private finishPending(accountId: string, platformKey: string, expected: PendingSession): void {
    if (!this.closePending(accountId, platformKey, expected)) return;
    const pendingKey = `oauth:${platformKey}:${accountId}:pending`;
    if (this.deps.credentials.get(pendingKey) === expected.pendingCredentialSnapshot) this.deps.credentials.delete(pendingKey);
    const key = this.key(accountId, platformKey);
    if (this.epochs.get(key) === expected.request.epoch) this.epochs.set(key, expected.request.epoch + 1);
  }

  private capture(accountId: string, platformKey: string): OAuthRequestSnapshot {
    const account = this.deps.repository.getAccountById(accountId, platformKey);
    if (!account) throw new Error("账号不存在或平台绑定已变化");
    if (!account.enabled || account.archivedAt) throw new Error("账号已停用或归档，请先由 Owner 核对");
    const sessionFingerprint = this.deps.sessionFingerprint?.(accountId, platformKey) ?? null;
    if (this.deps.sessionFingerprint && sessionFingerprint === null) throw new Error("账号的当前认证绑定不可用，请刷新后核对");
    return { accountId, platformKey, epoch: this.epochs.get(this.key(accountId, platformKey)) ?? 0,
      accountFingerprint: this.accountFingerprint(account), sessionFingerprint };
  }

  private accountFingerprint(account: Account): string {
    return JSON.stringify([account.id, account.platformKey, account.enabled, account.archivedAt ?? null, account.connectionMode ?? null,
      account.externalAccountId ?? null, account.browserSessionId ?? null]);
  }

  private isCurrent(request: OAuthRequestSnapshot): boolean {
    try {
      if ((this.epochs.get(this.key(request.accountId, request.platformKey)) ?? 0) !== request.epoch) return false;
      const account = this.deps.repository.getAccountById(request.accountId, request.platformKey);
      return Boolean(account && account.enabled && !account.archivedAt && this.accountFingerprint(account) === request.accountFingerprint
        && (this.deps.sessionFingerprint?.(request.accountId, request.platformKey) ?? null) === request.sessionFingerprint);
    } catch { return false; }
  }

  private assertCurrent(request: OAuthRequestSnapshot): void {
    if (!this.isCurrent(request)) throw this.staleError(request);
  }

  private staleError(request: OAuthRequestSnapshot): Error {
    this.deps.logger.warn("OAUTH", "OAUTH_REQUEST_SUPERSEDED", "账号或授权轮次已变化，迟到 OAuth 结果未回写账号", { accountId: request.accountId, platformKey: request.platformKey });
    return Object.assign(new Error("OAuth 请求已过期，账号或授权轮次已变化，请刷新后重新核对"), { code: "OAUTH_REQUEST_SUPERSEDED" });
  }

  private perform<T>(request: OAuthRequestSnapshot, operation: () => Promise<T>): Promise<T> {
    this.assertCurrent(request);
    return this.deps.runInAuthScope ? this.deps.runInAuthScope(() => this.isCurrent(request), operation) : operation();
  }

  private key(accountId: string, platformKey: string): string { return `${accountId}:${platformKey}`; }
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character); }
