/** Browser runtime activation is separate from stored authorization and remote auth. */
export interface ToutiaoSessionSnapshot {
  platformKey: string;
  accountId: string;
  sessionExists: boolean;
  contextExists: boolean;
  canonicalPageExists: boolean;
  canonicalPageClosed: boolean | null;
  canonicalPageContextMatchesSession: boolean | null;
  browserConnected: boolean | null;
  canonicalPageHost: string | null;
  canonicalPagePath: string | null;
}

export interface ToutiaoSessionActivationDeps {
  account(accountId: string): { id: string; platformKey: string; loginStatus: string; authorizationStatus?: string } | null;
  hasStoredSession(accountId: string): boolean;
  snapshot(accountId: string): ToutiaoSessionSnapshot;
  openBackend(accountId: string): Promise<{ backendUrl: string }>;
  beginLogin(accountId: string): Promise<{ opened?: boolean }>;
  closeRuntime(accountId: string): Promise<void>;
  onHeartbeat?(status: ToutiaoSessionStatus): void;
}

export type ToutiaoRuntimeState = "DISCONNECTED" | "ACTIVE";
export interface ToutiaoSessionStatus {
  accountId: string;
  storedAuthorization: "AUTHORIZED_SAVED" | "EXPIRED" | "UNKNOWN";
  runtimeState: ToutiaoRuntimeState;
  remoteAuthState: "UNKNOWN";
  sessionExists: boolean;
  contextExists: boolean;
  canonicalPageExists: boolean;
  pageAlive: boolean;
  pageHost: string | null;
  lastHeartbeatAt: string;
}
export type ToutiaoActivationOutcome = "ACTIVE_REUSED" | "ACTIVE_RESTORED" | "OWNER_LOGIN_REQUIRED" | "ACTIVATION_FAILED";
export interface ToutiaoActivationResult extends ToutiaoSessionStatus {
  outcome: ToutiaoActivationOutcome;
  reasonCode: "LOGIN_REQUIRED" | "BROWSER_START_FAILED" | "CANONICAL_PAGE_UNAVAILABLE" | null;
}

function creatorHost(host: string | null): boolean { return host === "mp.toutiao.com"; }
function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}
function healthy(snapshot: ToutiaoSessionSnapshot): boolean {
  return snapshot.platformKey === "toutiao" && snapshot.sessionExists && snapshot.contextExists
    && snapshot.canonicalPageExists && snapshot.canonicalPageClosed === false
    && snapshot.canonicalPageContextMatchesSession === true && snapshot.browserConnected === true
    && creatorHost(snapshot.canonicalPageHost) && snapshot.canonicalPagePath === "/";
}

export class ToutiaoSessionActivation {
  private readonly pending = new Map<string, Promise<ToutiaoActivationResult>>();
  private readonly heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  constructor(private readonly deps: ToutiaoSessionActivationDeps) {}

  status(accountId: string): ToutiaoSessionStatus {
    const account = this.deps.account(accountId);
    if (!account || account.id !== accountId || account.platformKey !== "toutiao") throw new Error("TOUTIAO_ACCOUNT_MISMATCH");
    const snapshot = this.deps.snapshot(accountId);
    const stored = this.deps.hasStoredSession(accountId);
    return {
      accountId,
      storedAuthorization: account.loginStatus === "expired" || account.authorizationStatus === "Revoked" ? "EXPIRED"
        : stored && account.loginStatus === "logged_in" && account.authorizationStatus === "Authorized" ? "AUTHORIZED_SAVED" : "UNKNOWN",
      runtimeState: healthy(snapshot) ? "ACTIVE" : "DISCONNECTED",
      remoteAuthState: "UNKNOWN",
      sessionExists: snapshot.sessionExists,
      contextExists: snapshot.contextExists,
      canonicalPageExists: snapshot.canonicalPageExists && snapshot.canonicalPageClosed === false,
      pageAlive: snapshot.canonicalPageExists && snapshot.canonicalPageClosed === false && snapshot.browserConnected === true,
      pageHost: snapshot.canonicalPageHost,
      lastHeartbeatAt: new Date().toISOString()
    };
  }

  activate(accountId: string): Promise<ToutiaoActivationResult> {
    const existing = this.pending.get(accountId);
    if (existing) return existing;
    const operation = this.activateOnce(accountId).then((result) => {
      if (result.outcome === "ACTIVE_REUSED" || result.outcome === "ACTIVE_RESTORED") this.startHeartbeat(accountId);
      return result;
    });
    this.pending.set(accountId, operation);
    const clear = (): void => { if (this.pending.get(accountId) === operation) this.pending.delete(accountId); };
    void operation.then(clear, clear);
    return operation;
  }

  private async activateOnce(accountId: string): Promise<ToutiaoActivationResult> {
    const before = this.status(accountId);
    if (before.runtimeState === "ACTIVE") return { ...before, outcome: "ACTIVE_REUSED", reasonCode: null };
    if (before.storedAuthorization !== "AUTHORIZED_SAVED") {
      try {
        const login = await this.deps.beginLogin(accountId);
        if (!login.opened) return { ...this.status(accountId), outcome: "ACTIVATION_FAILED", reasonCode: "BROWSER_START_FAILED" };
        return { ...this.status(accountId), outcome: "OWNER_LOGIN_REQUIRED", reasonCode: "LOGIN_REQUIRED" };
      } catch {
        return { ...this.status(accountId), outcome: "ACTIVATION_FAILED", reasonCode: "BROWSER_START_FAILED" };
      }
    }
    try {
      const opened = await this.deps.openBackend(accountId);
      const after = this.status(accountId);
      if (hostOf(opened.backendUrl) !== "mp.toutiao.com" || after.runtimeState !== "ACTIVE") {
        return { ...after, outcome: "ACTIVATION_FAILED", reasonCode: "CANONICAL_PAGE_UNAVAILABLE" };
      }
      return { ...after, outcome: "ACTIVE_RESTORED", reasonCode: null };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "LOGIN_EXPIRED" || code === "USER_ACTION_REQUIRED") {
        try {
          const login = await this.deps.beginLogin(accountId);
          if (login.opened) return { ...this.status(accountId), outcome: "OWNER_LOGIN_REQUIRED", reasonCode: "LOGIN_REQUIRED" };
        } catch { /* Report the failed owner login window without exposing the underlying browser error. */ }
        return { ...this.status(accountId), outcome: "ACTIVATION_FAILED", reasonCode: "BROWSER_START_FAILED" };
      }
      return { ...this.status(accountId), outcome: "ACTIVATION_FAILED", reasonCode: "BROWSER_START_FAILED" };
    }
  }

  async close(accountId: string): Promise<ToutiaoSessionStatus> {
    this.stopHeartbeat(accountId);
    const before = this.status(accountId);
    if (before.sessionExists) await this.deps.closeRuntime(accountId);
    return this.status(accountId);
  }

  private startHeartbeat(accountId: string): void {
    if (!this.deps.onHeartbeat || this.heartbeatTimers.has(accountId)) return;
    const timer = setInterval(() => {
      try {
        const status = this.status(accountId);
        this.deps.onHeartbeat?.(status);
        if (status.runtimeState !== "ACTIVE") this.stopHeartbeat(accountId);
      } catch { this.stopHeartbeat(accountId); }
    }, 30_000);
    timer.unref?.();
    this.heartbeatTimers.set(accountId, timer);
  }

  private stopHeartbeat(accountId: string): void {
    const timer = this.heartbeatTimers.get(accountId);
    if (timer) clearInterval(timer);
    this.heartbeatTimers.delete(accountId);
  }
}
