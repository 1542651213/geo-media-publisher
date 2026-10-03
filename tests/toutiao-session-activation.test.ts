import { rendererSource } from "./renderer-source";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ToutiaoSessionActivation, type ToutiaoSessionActivationDeps, type ToutiaoSessionSnapshot } from "../apps/desktop/src/main/toutiao-session-activation";
import { isOnlineAccount } from "../apps/desktop/src/renderer/v11-ui-model";

function snapshot(accountId: string, active = false, host: string | null = null): ToutiaoSessionSnapshot {
  return { platformKey: "toutiao", accountId, sessionExists: active, contextExists: active,
    canonicalPageExists: active, canonicalPageClosed: active ? false : null,
    canonicalPageContextMatchesSession: active ? true : null, browserConnected: active ? true : null,
    canonicalPageHost: host, canonicalPagePath: active ? "/" : null };
}

function harness() {
  const states = new Map<string, ToutiaoSessionSnapshot>();
  const accounts = new Map(["a", "b"].map((id) => [id, { id, platformKey: "toutiao", loginStatus: "logged_in", authorizationStatus: "Authorized" }]));
  const stored = new Set(["a", "b"]);
  const openBackend = vi.fn(async (id: string) => { states.set(id, snapshot(id, true, "mp.toutiao.com")); return { backendUrl: "https://mp.toutiao.com/" }; });
  const beginLogin = vi.fn(async (id: string) => { states.set(id, snapshot(id, true, "mp.toutiao.com")); return { opened: true }; });
  const closeRuntime = vi.fn(async (id: string) => { states.set(id, snapshot(id)); });
  const onHeartbeat = vi.fn();
  const deps: ToutiaoSessionActivationDeps = {
    account: (id) => accounts.get(id) ?? null,
    hasStoredSession: (id) => stored.has(id),
    snapshot: (id) => states.get(id) ?? snapshot(id),
    openBackend, beginLogin, closeRuntime, onHeartbeat
  };
  return { activation: new ToutiaoSessionActivation(deps), accounts, states, stored, openBackend, beginLogin, closeRuntime, onHeartbeat };
}

describe("Toutiao BrowserSession activation", () => {
  it("routes explicit activation and read-only status through main IPC without a publish call", () => {
    const ipc = readFileSync(new URL("../apps/desktop/src/main/ipc.ts", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../apps/desktop/src/main/preload.ts", import.meta.url), "utf8");
    const workspace = rendererSource("V11Workspace");
    expect(ipc).toContain('register("accounts:activate-session"');
    expect(ipc).toContain('register("accounts:get-runtime-session-status"');
    expect(preload).toContain('invoke("accounts:activate-session"');
    expect(preload).toContain('invoke("accounts:get-runtime-session-status"');
    expect(ipc).toContain('toutiaoSessionActivation.status(account.id)');
    expect(workspace).toContain('accounts.activateSession(row.account.id, "toutiao")');
  });

  it("keeps stored authorization separate from a missing runtime", () => {
    const { activation } = harness();
    expect(activation.status("a")).toMatchObject({ storedAuthorization: "AUTHORIZED_SAVED", runtimeState: "DISCONNECTED", remoteAuthState: "UNKNOWN" });
  });

  it("does not display a saved Toutiao login as a live online runtime", () => {
    expect(isOnlineAccount({ enabled: true, platformKey: "toutiao", loginStatus: "logged_in", accountStatus: "Unverified" })).toBe(false);
    expect(isOnlineAccount({ enabled: true, platformKey: "toutiao", loginStatus: "logged_in" })).toBe(false);
    expect(isOnlineAccount({ enabled: true, platformKey: "toutiao", loginStatus: "logged_in", accountStatus: "Connected" })).toBe(true);
  });

  it("reuses a healthy owned Creator page without opening another Context", async () => {
    const h = harness(); h.states.set("a", snapshot("a", true, "mp.toutiao.com"));
    expect((await h.activation.activate("a")).outcome).toBe("ACTIVE_REUSED");
    expect(h.openBackend).not.toHaveBeenCalled();
  });

  it("restores an encrypted saved session and binds its canonical page", async () => {
    const h = harness();
    expect((await h.activation.activate("a")).outcome).toBe("ACTIVE_RESTORED");
    expect(h.activation.status("a")).toMatchObject({ runtimeState: "ACTIVE", pageHost: "mp.toutiao.com" });
  });

  it("accepts the observed Creator dashboard landing without accepting a login page", async () => {
    const h = harness();
    h.states.set("a", { ...snapshot("a", true, "mp.toutiao.com"), canonicalPagePath: "/profile_v4/index" });
    expect(h.activation.status("a")).toMatchObject({ runtimeState: "ACTIVE", contextOwnsPage: true });
    expect((await h.activation.activate("a")).outcome).toBe("ACTIVE_REUSED");
    h.states.set("a", { ...snapshot("a", true, "mp.toutiao.com"), canonicalPagePath: "/profile_v4/" });
    expect(h.activation.status("a").runtimeState).toBe("ACTIVE");
    h.states.set("a", { ...snapshot("a", true, "mp.toutiao.com"), canonicalPagePath: "/profile_v4/login" });
    expect(h.activation.status("a").runtimeState).toBe("DISCONNECTED");
  });

  it("opens the normal Owner login flow when no saved session exists", async () => {
    const h = harness(); h.stored.delete("a");
    expect((await h.activation.activate("a")).outcome).toBe("OWNER_LOGIN_REQUIRED");
    expect(h.beginLogin).toHaveBeenCalledOnce();
    expect(h.openBackend).not.toHaveBeenCalled();
  });

  it("opens an owner-completable login flow when the saved session redirects to login", async () => {
    const h = harness();
    h.openBackend.mockRejectedValueOnce(Object.assign(new Error("login page"), { code: "LOGIN_EXPIRED" }));
    expect((await h.activation.activate("a")).outcome).toBe("OWNER_LOGIN_REQUIRED");
    expect(h.beginLogin).toHaveBeenCalledWith("a");
  });

  it("does not accept stale IDs, closed pages, or foreign hosts as active", async () => {
    const h = harness();
    h.states.set("a", { ...snapshot("a", true, "mp.toutiao.com"), canonicalPageClosed: true });
    expect(h.activation.status("a").runtimeState).toBe("DISCONNECTED");
    h.states.set("a", snapshot("a", true, "www.toutiao.com"));
    expect(h.activation.status("a").runtimeState).toBe("DISCONNECTED");
    h.states.set("a", { ...snapshot("a", true, "mp.toutiao.com"), canonicalPagePath: "/login" });
    expect(h.activation.status("a").runtimeState).toBe("DISCONNECTED");
  });

  it("does not conflate a browser startup error with invalid remote auth", async () => {
    const h = harness(); h.openBackend.mockRejectedValueOnce(new Error("browser launch failed"));
    expect(await h.activation.activate("a")).toMatchObject({ outcome: "ACTIVATION_FAILED", remoteAuthState: "UNKNOWN" });
  });

  it("isolates concurrent requests for the same account and different accounts", async () => {
    const h = harness();
    const [first, second, other] = await Promise.all([h.activation.activate("a"), h.activation.activate("a"), h.activation.activate("b")]);
    expect(first.outcome).toBe("ACTIVE_RESTORED"); expect(second.outcome).toBe("ACTIVE_RESTORED"); expect(other.outcome).toBe("ACTIVE_RESTORED");
    expect(h.openBackend.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]);
  });

  it("rejects an account outside the Toutiao account binding", async () => {
    const h = harness();
    await expect(h.activation.activate("missing")).rejects.toThrow("TOUTIAO_ACCOUNT_MISMATCH");
    expect(h.openBackend).not.toHaveBeenCalled();
  });

  it("closing runtime keeps saved authorization and does not claim remote expiry", async () => {
    const h = harness(); h.states.set("a", snapshot("a", true, "mp.toutiao.com"));
    await h.activation.close("a");
    expect(h.activation.status("a")).toMatchObject({ storedAuthorization: "AUTHORIZED_SAVED", runtimeState: "DISCONNECTED", remoteAuthState: "UNKNOWN" });
    expect(h.stored.has("a")).toBe(true);
  });

  it("heartbeats only while the activated runtime remains live", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.activation.activate("a");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.onHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a", runtimeState: "ACTIVE", pageHost: "mp.toutiao.com" }));
      h.states.set("a", snapshot("a"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.onHeartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ runtimeState: "DISCONNECTED" }));
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
