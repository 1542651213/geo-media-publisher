import { shell } from "electron";
import { createServer, type Server } from "node:http";
import type { AccountContext, AuthStrategy, AuthorizationStatus, LoginSession, OAuthCallbackStrategy } from "@publisher/domain";
import type { AppRepository } from "@publisher/db";
import { assertExternalLaunchAllowed, type AdapterRegistry, type PlatformAdapter, type UserInitiatedAction } from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";
import type { Logger } from "@publisher/logger";

interface PendingSession {
  state: string;
  callbackUrl?: string;
  startedAt: number;
  loopbackServer?: Server;
  timeout?: NodeJS.Timeout;
}

export interface OAuthSessionManagerDependencies {
  repository: AppRepository;
  registry: AdapterRegistry;
  credentials: CredentialStore;
  logger: Logger;
  accountContext(accountId: string, platformKey: string, action?: UserInitiatedAction): AccountContext;
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

  constructor(private readonly deps: OAuthSessionManagerDependencies) {}

  async begin(accountId: string, platformKey: string, action?: UserInitiatedAction): Promise<LoginSession> {
    const adapter = this.adapter(platformKey);
    const manifest = adapter.manifest;
    const base: Pick<LoginSession, "authStrategy" | "callbackStrategy"> = { authStrategy: manifest.authStrategy, callbackStrategy: manifest.callbackStrategy };
    if (!OAUTH_STRATEGIES.has(manifest.authStrategy) || manifest.status === "Blocked" || manifest.status === "NotImplemented" || manifest.status === "ManualOnly") {
      return { sessionId: `login-info-${accountId}-${Date.now()}`, requiresUserAction: true, ...base, opened: false, message: manifest.blockingReason ?? "当前平台没有已验证的官方自动 OAuth 登录能力。" };
    }
    assertExternalLaunchAllowed(action ?? { userActionId: null, triggerSource: "APP_STARTUP" });

    const baseContext = this.deps.accountContext(accountId, platformKey, action);
    const loopback = manifest.callbackStrategy === "LoopbackCallback" ? await this.startLoopbackServer(accountId, platformKey) : undefined;
    let session: LoginSession;
    try {
      const context: AccountContext = loopback ? { ...baseContext, settings: { ...baseContext.settings, oauthRedirectUri: loopback.callbackUrl } } : baseContext;
      session = await adapter.beginLogin(context);
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

    const authorizationUrl = this.officialUrl(session.authorizationUrl);
    const state = new URL(authorizationUrl).searchParams.get("state");
    if (!state) { loopback?.server.close(); throw new Error("OAuth authorization URL 缺少 state"); }
    try { this.validateCallbackDeclaration(manifest.callbackStrategy, session.callbackUrl); }
    catch (error) { loopback?.server.close(); throw error; }
    const timeout = setTimeout(() => {
      if (this.pending.get(this.key(accountId, platformKey))?.state !== state) return;
      this.closePending(accountId, platformKey);
      this.deps.repository.updateAccount(accountId, { loginStatus: "needs_user_action", pausedReason: "OAuth 回调超时，请重新发起授权" });
      this.deps.logger.warn("OAUTH", "CALLBACK_TIMEOUT", "OAuth 回调等待超时", { accountId, platformKey });
    }, 10 * 60 * 1000);
    timeout.unref();
    const pending: PendingSession = { state, callbackUrl: session.callbackUrl, startedAt: Date.now(), timeout, ...(loopback ? { loopbackServer: loopback.server } : {}) };
    this.pending.set(this.key(accountId, platformKey), pending);
    this.deps.repository.updateAccount(accountId, { loginStatus: "needs_user_action", pausedReason: "等待用户完成官方 OAuth 授权" });
    this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: manifest.authStrategy, status: "NotAuthorized", scopes: [] });
    this.deps.logger.info("OAUTH", "OAUTH_STARTED", "已生成官方 OAuth 授权会话", { accountId, platformKey, authStrategy: manifest.authStrategy, callbackStrategy: manifest.callbackStrategy, authorizationHost: new URL(authorizationUrl).host });
    try {
      await shell.openExternal(authorizationUrl);
    } catch (error) {
      this.closePending(accountId, platformKey);
      throw error;
    }
    this.deps.logger.info("OAUTH", "BROWSER_OPENED", "已在系统浏览器打开官方 OAuth 页面", { accountId, platformKey, authorizationHost: new URL(authorizationUrl).host, userActionId: action?.userActionId, triggerSource: action?.triggerSource });
    return { ...result, opened: true };
  }

  async complete(accountId: string, platformKey: string, input: string): Promise<OAuthCompletionSummary> {
    const adapter = this.adapter(platformKey);
    const pending = this.pending.get(this.key(accountId, platformKey));
    const parsed = this.parseCallback(input, adapter.manifest.callbackStrategy, pending);
    this.deps.logger.info("OAUTH", "CALLBACK_RECEIVED", "收到 OAuth 回调输入", { accountId, platformKey, callbackStrategy: adapter.manifest.callbackStrategy, inputType: parsed.inputType });
    if (!adapter.completeLogin) throw new Error("该平台 Adapter 尚未实现 OAuth 回调交换");
    try {
      await adapter.completeLogin(this.deps.accountContext(accountId, platformKey), parsed.code, parsed.state);
    } catch (error) {
      this.closePending(accountId, platformKey);
      throw error;
    }
    this.deps.logger.info("OAUTH", "STATE_VALIDATED", "OAuth state 校验通过", { accountId, platformKey });
    const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(this.deps.accountContext(accountId, platformKey)) : {};
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
    this.closePending(accountId, platformKey);
    this.deps.logger.info("OAUTH", "TOKEN_EXCHANGED", "OAuth authorization code 已由主进程交换", { accountId, platformKey });
    this.deps.logger.info("OAUTH", "PROFILE_FETCHED", "已读取脱敏账号信息", { accountId, platformKey, providerAccountId: summary.accountId, scopeCount: summary.scopes.length });
    this.deps.logger.info("OAUTH", "ACCOUNT_CONNECTED", "账号连接记录已完成", { accountId, platformKey, authorizationStatus, scopeCount: summary.scopes.length });
    return summary;
  }

  async refresh(accountId: string, platformKey: string): Promise<{ accountStatus: "Connected"; authorizationStatus: AuthorizationStatus; expiresAt: string | null }> {
    const adapter = this.adapter(platformKey);
    if (!adapter.refreshLogin) throw new Error("该平台没有已验证的 refresh token 能力");
    try {
      await adapter.refreshLogin(this.deps.accountContext(accountId, platformKey));
      const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(this.deps.accountContext(accountId, platformKey)) : {};
      const authorizationStatus = profile.authorizationStatus ?? "Authorized";
      this.deps.repository.updateAccount(accountId, { loginStatus: "logged_in", pausedReason: null });
      this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: adapter.manifest.authStrategy, status: authorizationStatus, scopes: profile.scopes ?? [], expiresAt: profile.expiresAt ?? null, providerAccountId: profile.accountId ?? null, providerAccountName: profile.accountName ?? null });
      this.deps.logger.info("OAUTH", "TOKEN_REFRESHED", "OAuth Token 已由主进程刷新", { accountId, platformKey });
      return { accountStatus: "Connected", authorizationStatus, expiresAt: profile.expiresAt ?? null };
    } catch (error) {
      this.deps.repository.updateAccount(accountId, { loginStatus: "expired", pausedReason: "授权已过期，需要重新授权" });
      this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: adapter.manifest.authStrategy, status: "Revoked" });
      this.deps.logger.warn("OAUTH", "REAUTH_REQUIRED", "OAuth Token 刷新失败，需要重新授权", { accountId, platformKey, errorType: error instanceof Error ? error.name : "UnknownError" });
      throw error;
    }
  }

  disconnect(accountId: string, platformKey: string): void {
    const adapter = this.adapter(platformKey);
    for (const key of [`oauth:${platformKey}:${accountId}:token`, `oauth:${platformKey}:${accountId}:pending`, `facebook:${accountId}:page-token`, ...DISCONNECT_KEYS.map((item) => `account:${accountId}:${platformKey}:${item}`)]) this.deps.credentials.delete(key);
    this.closePending(accountId, platformKey);
    this.deps.repository.updateAccount(accountId, { loginStatus: "logged_out", pausedReason: null });
    this.deps.repository.upsertAccountAuthorization({ accountId, platformKey, authorizationType: adapter.manifest.authStrategy, status: "NotAuthorized", scopes: [], expiresAt: null, providerAccountId: null, providerAccountName: null });
    this.deps.logger.info("OAUTH", "LOCAL_DISCONNECT", "已断开本地账号凭据；未宣称 Provider 端撤权", { accountId, platformKey });
  }

  isPending(accountId: string, platformKey: string): boolean { return this.pending.has(this.key(accountId, platformKey)); }

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

  private closePending(accountId: string, platformKey: string): void {
    const pending = this.pending.get(this.key(accountId, platformKey));
    if (pending?.timeout) clearTimeout(pending.timeout);
    pending?.loopbackServer?.close();
    this.pending.delete(this.key(accountId, platformKey));
  }

  private key(accountId: string, platformKey: string): string { return `${accountId}:${platformKey}`; }
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character); }
