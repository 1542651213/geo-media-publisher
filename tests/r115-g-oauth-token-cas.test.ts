import { describe, expect, it, vi } from "vitest";
import type { CredentialStore } from "@publisher/security";
import { OAuthManager, type OAuthPlatformConfig } from "@publisher/adapters-core";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

const accountId = "fixture-account", pendingKey = "oauth:example:fixture-account:pending", tokenKey = "oauth:example:fixture-account:token";
const secrets = { clientId: "fixture-client", clientSecret: "fixture-secret" };
const config: OAuthPlatformConfig = { platformKey: "example", authorizationUrl: "https://example.test/authorize",
  tokenUrl: "https://example.test/token", refreshUrl: "https://example.test/refresh", scopes: ["publish"], usePkce: true };
const originalToken = JSON.stringify({ accessToken: "fixture-old", refreshToken: "fixture-refresh", tokenType: "Bearer", scope: ["publish"] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("R1.15-G OAuth token persistence compare-and-swap", () => {
  it.each(["cleared", "replaced"])("does not persist an authorization exchange after its pending state was %s", async changed => {
    const store = new MemoryCredentialStore(), response = deferred<Response>();
    store.set(tokenKey, originalToken);
    const fetchPort = vi.fn<typeof fetch>(() => response.promise), manager = new OAuthManager(store, fetchPort);
    const old = manager.createAuthorization(accountId, config, secrets, "https://app.example.test/callback");
    const exchange = manager.completeAuthorization(accountId, config, secrets, "fixture-code", old.state);
    const rejected = expect(exchange).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED", providerCode: "OAUTH_REQUEST_SUPERSEDED" });
    const replacement = changed === "cleared" ? null : manager.createAuthorization(accountId, config, secrets, "https://app.example.test/callback");
    if (!replacement) store.delete(pendingKey);
    const pendingAfterChange = store.get(pendingKey);
    response.resolve(new Response(JSON.stringify({ access_token: "fixture-late-token" }), { status: 200 }));
    await rejected;

    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(store.get(tokenKey)).toBe(originalToken);
    expect(store.get(pendingKey)).toBe(pendingAfterChange);
    if (replacement) expect(manager.getToken(accountId, "example")?.accessToken).not.toBe("fixture-late-token");
  });

  it.each(["disconnected", "replaced"])("does not persist a refresh after its raw token snapshot was %s", async changed => {
    const store = new MemoryCredentialStore(), response = deferred<Response>();
    store.set(tokenKey, originalToken);
    const fetchPort = vi.fn<typeof fetch>(() => response.promise), manager = new OAuthManager(store, fetchPort);
    const refresh = manager.refresh(accountId, config, secrets);
    const rejected = expect(refresh).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED", providerCode: "OAUTH_REQUEST_SUPERSEDED" });
    if (changed === "disconnected") store.delete(tokenKey);
    else store.set(tokenKey, JSON.stringify({ accessToken: "fixture-new-login", refreshToken: "fixture-new-refresh", tokenType: "Bearer", scope: ["publish"] }));
    const tokenAfterChange = store.get(tokenKey);
    response.resolve(new Response(JSON.stringify({ access_token: "fixture-late-token", refresh_token: "fixture-late-refresh" }), { status: 200 }));
    await rejected;

    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(store.get(tokenKey)).toBe(tokenAfterChange);
  });

  it("retains the first successful concurrent refresh when the older exchange returns later", async () => {
    const store = new MemoryCredentialStore(), first = deferred<Response>(), second = deferred<Response>();
    store.set(tokenKey, originalToken);
    const fetchPort = vi.fn<typeof fetch>().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const manager = new OAuthManager(store, fetchPort), older = manager.refresh(accountId, config, secrets);
    const rejected = expect(older).rejects.toMatchObject({ providerCode: "OAUTH_REQUEST_SUPERSEDED" });
    const newer = manager.refresh(accountId, config, secrets);
    second.resolve(new Response(JSON.stringify({ access_token: "fixture-newer" }), { status: 200 }));
    await expect(newer).resolves.toMatchObject({ accessToken: "fixture-newer", refreshToken: "fixture-refresh" });
    const current = store.get(tokenKey);
    first.resolve(new Response(JSON.stringify({ access_token: "fixture-older" }), { status: 200 }));
    await rejected;
    expect(store.get(tokenKey)).toBe(current);
  });

  it.each([400, 401, 200])("classifies explicit invalid_grant at HTTP %s as a credential rejection without replacing the stored token", async status => {
    const store = new MemoryCredentialStore();
    store.set(tokenKey, originalToken);
    const manager = new OAuthManager(store, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status })));
    await expect(manager.refresh(accountId, config, secrets)).rejects.toMatchObject({ code: "LOGIN_EXPIRED", providerCode: "invalid_grant" });
    expect(store.get(tokenKey)).toBe(originalToken);
  });

  it.each([
    { status: 503, error: "server_error", code: "NETWORK_ERROR" },
    { status: 503, error: "invalid_grant", code: "NETWORK_ERROR" },
    { status: 429, error: "temporarily_unavailable", code: "NETWORK_ERROR" },
    { status: 401, error: "invalid_client", code: "PERMISSION_DENIED" },
    { status: 403, error: "insufficient_scope", code: "PERMISSION_DENIED" }
  ])("does not classify $error as a rejected user token", async ({ status, error, code }) => {
    const store = new MemoryCredentialStore();
    store.set(tokenKey, originalToken);
    const manager = new OAuthManager(store, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error }), { status })));
    await expect(manager.refresh(accountId, config, secrets)).rejects.toMatchObject({ code, providerCode: error });
    expect(store.get(tokenKey)).toBe(originalToken);
  });
});
