import { describe, expect, it, vi } from "vitest";
import type { CredentialStore } from "@publisher/security";
import { OAuthManager, type OAuthPlatformConfig } from "./index";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

const accountId = "account-1";
const pendingKey = `oauth:example:${accountId}:pending`;
const tokenKey = `oauth:example:${accountId}:token`;
const secrets = { clientId: "client-id", clientSecret: "client-secret" };
const config: OAuthPlatformConfig = {
  platformKey: "example",
  authorizationUrl: "https://official.example/oauth/authorize",
  tokenUrl: "https://official.example/oauth/token",
  refreshUrl: "https://official.example/oauth/refresh",
  revokeUrl: "https://official.example/oauth/revoke",
  scopes: ["publish"],
  usePkce: true,
  tokenClientAuth: "body"
};

describe("OAuthManager security lifecycle", () => {
  it("rejects a mismatched state without exchanging or replacing stored authorization state", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn<typeof fetch>();
    const manager = new OAuthManager(store, fetchPort);
    manager.createAuthorization(accountId, config, secrets, "https://app.example/oauth/callback");
    const pendingBefore = store.get(pendingKey);

    await expect(manager.completeAuthorization(accountId, config, secrets, "code", "wrong-state")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    expect(fetchPort).not.toHaveBeenCalled();
    expect(store.get(pendingKey)).toBe(pendingBefore);
    expect(store.has(tokenKey)).toBe(false);
  });

  it("rejects an expired pending authorization before token exchange", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn<typeof fetch>();
    const manager = new OAuthManager(store, fetchPort);
    const authorization = manager.createAuthorization(accountId, config, secrets, "https://app.example/oauth/callback");
    const stored = store.get(pendingKey);
    if (!stored) throw new Error("pending authorization was not stored");
    const pending = JSON.parse(stored) as { state: string; verifier?: string; redirectUri: string; createdAt: string };
    store.set(pendingKey, JSON.stringify({ ...pending, createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() }));

    await expect(manager.completeAuthorization(accountId, config, secrets, "code", authorization.state)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(fetchPort).not.toHaveBeenCalled();
    expect(store.has(tokenKey)).toBe(false);
  });

  it("refreshes through the configured endpoint and preserves an unrotated refresh token", async () => {
    const store = new MemoryCredentialStore();
    store.set(tokenKey, JSON.stringify({ accessToken: "old-access", refreshToken: "old-refresh", tokenType: "Bearer", scope: ["publish"] }));
    const fetchPort = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 }));
    const manager = new OAuthManager(store, fetchPort);

    const refreshed = await manager.refresh(accountId, config, secrets);

    expect(refreshed).toMatchObject({ accessToken: "new-access", refreshToken: "old-refresh" });
    expect(manager.getToken(accountId, config.platformKey)).toMatchObject({ accessToken: "new-access", refreshToken: "old-refresh" });
    expect(fetchPort.mock.calls[0]?.[0]).toBe(config.refreshUrl);
    const body = fetchPort.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get("refresh_token")).toBe("old-refresh");
  });

  it("clears local token and pending state even when remote revocation fails", async () => {
    const store = new MemoryCredentialStore();
    store.set(tokenKey, JSON.stringify({ accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", scope: ["publish"] }));
    store.set(pendingKey, JSON.stringify({ state: "state", redirectUri: "https://app.example/oauth/callback", createdAt: new Date().toISOString() }));
    const fetchPort = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const manager = new OAuthManager(store, fetchPort);

    await expect(manager.revoke(accountId, config, secrets)).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    expect(store.has(tokenKey)).toBe(false);
    expect(store.has(pendingKey)).toBe(false);
    const body = fetchPort.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get("token")).toBe("refresh");
  });
});
