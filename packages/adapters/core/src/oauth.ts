import { createHash, randomBytes } from "node:crypto";
import type { CredentialStore } from "@publisher/security";
import { PlatformAdapterError } from "./index";

export interface OAuthPlatformConfig {
  platformKey: string;
  authorizationUrl: string;
  tokenUrl: string;
  refreshUrl?: string;
  revokeUrl?: string;
  clientIdKey?: string;
  clientSecretKey?: string;
  scopes: string[];
  usePkce?: boolean;
  tokenClientAuth?: "body" | "basic" | "none";
  extraAuthorizationParams?: Record<string, string>;
  extraTokenParams?: Record<string, string>;
}

export interface OAuthAuthorizationRequest {
  authorizationUrl: string;
  callbackUrl: string;
  state: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope: string[];
  expiresAt?: string;
  providerAccountId?: string;
}

interface PendingAuthorization {
  state: string;
  verifier?: string;
  redirectUri: string;
  createdAt: string;
}

interface TokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  open_id?: unknown;
  openid?: unknown;
  data?: unknown;
  error?: unknown;
  error_description?: unknown;
  message?: unknown;
}

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function requiredSecret(secrets: Record<string, string> | undefined, key: string, label: string): string {
  const value = secrets?.[key]?.trim();
  if (!value) throw new PlatformAdapterError("AUTH_REQUIRED", `${label} 未配置`);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : undefined;
}

function scopes(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(/[\s,]+/u).filter(Boolean);
  return fallback;
}

/**
 * Platform-neutral OAuth state, PKCE and encrypted token lifecycle.
 * UI code receives only authorization status/URLs; secrets and token exchange stay in the main process.
 */
export class OAuthManager {
  constructor(private readonly store: CredentialStore, private readonly fetchPort: FetchPort = fetch, private readonly timeoutMs = 30_000) {}

  createAuthorization(accountId: string, config: OAuthPlatformConfig, secrets: Record<string, string> | undefined, redirectUri: string): OAuthAuthorizationRequest {
    const clientIdKey = config.clientIdKey ?? "clientId";
    const clientId = requiredSecret(secrets, clientIdKey, "OAuth Client ID");
    const state = base64Url(randomBytes(32));
    const verifier = config.usePkce === false ? undefined : base64Url(randomBytes(48));
    const pending: PendingAuthorization = { state, verifier, redirectUri, createdAt: new Date().toISOString() };
    this.store.set(this.pendingKey(accountId, config.platformKey), JSON.stringify(pending));
    const url = new URL(config.authorizationUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (config.scopes.length > 0) url.searchParams.set("scope", config.scopes.join(" "));
    if (verifier) {
      url.searchParams.set("code_challenge", base64Url(createHash("sha256").update(verifier).digest()));
      url.searchParams.set("code_challenge_method", "S256");
    }
    for (const [key, value] of Object.entries(config.extraAuthorizationParams ?? {})) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), callbackUrl: redirectUri, state };
  }

  async completeAuthorization(accountId: string, config: OAuthPlatformConfig, secrets: Record<string, string> | undefined, code: string, state: string): Promise<OAuthTokenSet> {
    const pending = this.readPending(accountId, config.platformKey);
    if (!pending || pending.state !== state) throw new PlatformAdapterError("PERMISSION_DENIED", "OAuth state 校验失败，请重新发起授权");
    if (Date.now() - new Date(pending.createdAt).getTime() > 10 * 60 * 1000) throw new PlatformAdapterError("AUTH_REQUIRED", "OAuth 授权会话已过期，请重新发起授权");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      ...config.extraTokenParams
    });
    if (pending.verifier) body.set("code_verifier", pending.verifier);
    const token = await this.exchange(config, secrets, body);
    this.store.set(this.tokenKey(accountId, config.platformKey), JSON.stringify(token));
    this.store.delete(this.pendingKey(accountId, config.platformKey));
    return token;
  }

  getToken(accountId: string, platformKey: string): OAuthTokenSet | null {
    const stored = this.store.get(this.tokenKey(accountId, platformKey));
    if (!stored) return null;
    try {
      const value = JSON.parse(stored) as OAuthTokenSet;
      return typeof value.accessToken === "string" ? value : null;
    } catch {
      return null;
    }
  }

  async refresh(accountId: string, config: OAuthPlatformConfig, secrets: Record<string, string> | undefined): Promise<OAuthTokenSet> {
    const current = this.getToken(accountId, config.platformKey);
    if (!current?.refreshToken) throw new PlatformAdapterError("LOGIN_EXPIRED", "OAuth refresh token 不可用，请重新授权");
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, ...config.extraTokenParams });
    const refreshed = await this.exchange({ ...config, tokenUrl: config.refreshUrl ?? config.tokenUrl }, secrets, body);
    const token = { ...refreshed, refreshToken: refreshed.refreshToken ?? current.refreshToken };
    this.store.set(this.tokenKey(accountId, config.platformKey), JSON.stringify(token));
    return token;
  }

  async revoke(accountId: string, config: OAuthPlatformConfig, secrets: Record<string, string> | undefined): Promise<void> {
    const current = this.getToken(accountId, config.platformKey);
    try {
      if (current && config.revokeUrl) {
        const body = new URLSearchParams({ token: current.refreshToken ?? current.accessToken });
        const headers = this.clientAuthentication(config, secrets, body);
        const response = await this.fetchWithTimeout(config.revokeUrl, { method: "POST", headers, body });
        if (!response.ok) throw new PlatformAdapterError("NETWORK_ERROR", `OAuth 撤销失败（HTTP ${response.status}）`);
      }
    } finally {
      this.store.delete(this.tokenKey(accountId, config.platformKey));
      this.store.delete(this.pendingKey(accountId, config.platformKey));
    }
  }

  private async exchange(config: OAuthPlatformConfig, secrets: Record<string, string> | undefined, body: URLSearchParams): Promise<OAuthTokenSet> {
    const headers = this.clientAuthentication(config, secrets, body);
    let response: Response;
    try {
      response = await this.fetchWithTimeout(config.tokenUrl, { method: "POST", headers, body });
    } catch (error) {
      if (error instanceof PlatformAdapterError) throw error;
      throw new PlatformAdapterError("NETWORK_ERROR", "OAuth Token 接口网络失败");
    }
    let payload: TokenPayload;
    try {
      payload = await response.json() as TokenPayload;
    } catch {
      throw new PlatformAdapterError("NETWORK_ERROR", "OAuth Token 接口返回了无效 JSON");
    }
    if (!response.ok || payload.error) {
      const detail = stringValue(payload.error_description) ?? stringValue(payload.message) ?? stringValue(payload.error) ?? `HTTP ${response.status}`;
      throw new PlatformAdapterError(response.status === 401 || response.status === 403 ? "PERMISSION_DENIED" : "NETWORK_ERROR", `OAuth Token 交换失败：${detail}`);
    }
    const nested = payload.data && typeof payload.data === "object" ? payload.data as TokenPayload : payload;
    const accessToken = stringValue(nested.access_token);
    if (!accessToken) throw new PlatformAdapterError("NETWORK_ERROR", "OAuth Token 响应缺少 access_token");
    const expiresIn = numberValue(nested.expires_in);
    return {
      accessToken,
      ...(stringValue(nested.refresh_token) ? { refreshToken: stringValue(nested.refresh_token) } : {}),
      tokenType: stringValue(nested.token_type) ?? "Bearer",
      scope: scopes(nested.scope, config.scopes),
      ...(expiresIn ? { expiresAt: new Date(Date.now() + Math.max(1, expiresIn - 60) * 1000).toISOString() } : {}),
      ...(stringValue(nested.open_id) ?? stringValue(nested.openid) ? { providerAccountId: stringValue(nested.open_id) ?? stringValue(nested.openid) } : {})
    };
  }

  private clientAuthentication(config: OAuthPlatformConfig, secrets: Record<string, string> | undefined, body: URLSearchParams): Record<string, string> {
    const clientId = requiredSecret(secrets, config.clientIdKey ?? "clientId", "OAuth Client ID");
    const method = config.tokenClientAuth ?? "body";
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (method === "none") {
      body.set("client_id", clientId);
      return headers;
    }
    const secret = requiredSecret(secrets, config.clientSecretKey ?? "clientSecret", "OAuth Client Secret");
    if (method === "basic") headers.Authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`;
    else {
      body.set("client_id", clientId);
      body.set("client_secret", secret);
    }
    return headers;
  }

  private readPending(accountId: string, platformKey: string): PendingAuthorization | null {
    const stored = this.store.get(this.pendingKey(accountId, platformKey));
    if (!stored) return null;
    try {
      const value = JSON.parse(stored) as PendingAuthorization;
      return typeof value.state === "string" && typeof value.redirectUri === "string" ? value : null;
    } catch {
      return null;
    }
  }

  private async fetchWithTimeout(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1_000, this.timeoutMs));
    try {
      return await Promise.race([
        this.fetchPort(input, { ...init, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(new PlatformAdapterError("TIMEOUT", "OAuth 请求超时")), { once: true });
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private pendingKey(accountId: string, platformKey: string): string { return `oauth:${platformKey}:${accountId}:pending`; }
  private tokenKey(accountId: string, platformKey: string): string { return `oauth:${platformKey}:${accountId}:token`; }
}
