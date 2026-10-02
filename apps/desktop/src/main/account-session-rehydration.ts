import {
  PlatformAdapterError,
  accountSessionRuntimeKey,
  type AccountSessionRefreshSource,
  type AccountSessionTarget,
  type BrowserSessionManager,
  type PlatformAdapter,
  type SafeAccountSessionSnapshot
} from "@publisher/adapters-core";

export type { AccountSessionTarget, SafeAccountSessionSnapshot } from "@publisher/adapters-core";

interface SessionAdapterRegistry {
  tryGetForConnection(platformKey: string): PlatformAdapter | null;
}

export interface AccountSessionRehydrationOptions {
  registry: SessionAdapterRegistry;
  browserSessions: BrowserSessionManager;
  resolveCompanyId(accountId: string): string | null | Promise<string | null>;
  /** Selects the exact content/connection route for targets where registry preference is insufficient. */
  resolveAdapter?(target: AccountSessionTarget): PlatformAdapter | null;
  /** Re-read the Main-owned binding after remote I/O so stale probes cannot promote a replaced login generation. */
  resolveAuthoritativeTarget?(accountId: string, platformKey: string): AccountSessionTarget | null | Promise<AccountSessionTarget | null>;
  resolveSecrets?(accountId: string, platformKey: string): Record<string, string> | undefined;
  concurrency?: number;
  now?: () => Date;
}

export class AccountSessionRehydrationCoordinator {
  private readonly snapshots = new Map<string, SafeAccountSessionSnapshot>();
  private readonly pending = new Map<string, { fingerprint: string; request: Promise<SafeAccountSessionSnapshot> }>();
  private readonly epochs = new Map<string, number>();
  private readonly fingerprints = new Map<string, string>();
  private initialRehydrationComplete = false;
  private readonly concurrency: number;
  private readonly now: () => Date;

  constructor(private readonly options: AccountSessionRehydrationOptions) {
    this.concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
    this.now = options.now ?? (() => new Date());
  }

  async rehydrate(targets: readonly AccountSessionTarget[]): Promise<SafeAccountSessionSnapshot[]> {
    this.initialRehydrationComplete = false;
    const unique = new Map<string, AccountSessionTarget>();
    const conflicted = new Set<string>();
    for (const target of targets) {
      const key = accountSessionRuntimeKey(target);
      if (conflicted.has(key)) {
        this.store(target, "IDENTITY_MISMATCH", "COMPANY_BINDING_CONFLICT", false, "STARTUP");
        continue;
      }
      const previous = unique.get(key);
      if (previous && previous.companyId !== target.companyId) {
        this.store(target, "IDENTITY_MISMATCH", "COMPANY_BINDING_CONFLICT", false, "STARTUP");
        unique.delete(key);
        conflicted.add(key);
      } else if (!previous) unique.set(key, target);
    }
    const queue = [...unique.values()];
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < queue.length) {
        const target = queue[index++];
        if (target) await this.refresh(target, "STARTUP");
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker));
    } finally {
      this.initialRehydrationComplete = true;
    }
    return targets.map((target) => this.getSnapshot(target.accountId, target.platformKey)).filter((value): value is SafeAccountSessionSnapshot => value !== null);
  }

  refresh(target: AccountSessionTarget, source: AccountSessionRefreshSource = "MANUAL"): Promise<SafeAccountSessionSnapshot> {
    const requested = { ...target };
    const key = accountSessionRuntimeKey(requested);
    const existing = this.pending.get(key);
    const fingerprint = targetFingerprint(requested);
    if (existing?.fingerprint === fingerprint) return existing.request;
    const epoch = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, epoch);
    this.fingerprints.set(key, fingerprint);
    this.store(requested, "CHECKING", null, false, source);
    const request = this.verify(requested, source).then(async result => {
      const stale = await this.staleBinding(requested);
      if (this.epochs.get(key) !== epoch) return this.getSnapshot(requested.accountId, requested.platformKey)
        ?? this.makeSnapshot(requested, "UNVERIFIED", "REQUEST_SUPERSEDED", false, source);
      return stale && result.reasonCode !== "COMPANY_BINDING_MISMATCH" ? this.store(requested, stale.state, stale.reasonCode, false, source)
        : this.store(requested, result.state, result.reasonCode, result.identityMatched, source);
    }).finally(() => {
      if (this.pending.get(key)?.request === request) this.pending.delete(key);
    });
    this.pending.set(key, { fingerprint, request });
    return request;
  }

  invalidate(accountId: string, platformKey: string): void {
    const key = accountSessionRuntimeKey({ accountId, platformKey });
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    this.pending.delete(key); this.snapshots.delete(key); this.fingerprints.delete(key);
  }

  getSnapshotForTarget(target: AccountSessionTarget): SafeAccountSessionSnapshot | null {
    const key = accountSessionRuntimeKey(target);
    return this.fingerprints.get(key) === targetFingerprint(target) ? this.getSnapshot(target.accountId, target.platformKey) : null;
  }

  createRefreshCallback(resolveTarget: (accountId: string, platformKey: string) => AccountSessionTarget | null | Promise<AccountSessionTarget | null>) {
    return async (accountId: string, platformKey: string): Promise<SafeAccountSessionSnapshot | null> => {
      const target = await resolveTarget(accountId, platformKey);
      if (!target) return null;
      if (target.accountId !== accountId || target.platformKey !== platformKey) throw new Error("ACCOUNT_SESSION_TARGET_MISMATCH");
      return this.refresh(target, "MANUAL");
    };
  }

  getSnapshot(accountId: string, platformKey: string): SafeAccountSessionSnapshot | null {
    const value = this.snapshots.get(accountSessionRuntimeKey({ accountId, platformKey }));
    return value ? { ...value } : null;
  }

  listSnapshots(): SafeAccountSessionSnapshot[] {
    return [...this.snapshots.values()].map((value) => ({ ...value }));
  }

  isInitialRehydrationComplete(): boolean { return this.initialRehydrationComplete; }

  private async verify(target: AccountSessionTarget, source: AccountSessionRefreshSource): Promise<SafeAccountSessionSnapshot> {
    if (!target.enabled) return this.makeSnapshot(target, "DISABLED", "ACCOUNT_DISABLED", false, source);
    let companyId: string | null;
    try { companyId = await this.options.resolveCompanyId(target.accountId); }
    catch { return this.makeSnapshot(target, "UNVERIFIED", "COMPANY_BINDING_UNAVAILABLE", false, source); }
    if (!companyId || companyId !== target.companyId) return this.makeSnapshot(target, "IDENTITY_MISMATCH", "COMPANY_BINDING_MISMATCH", false, source);
    let adapter: PlatformAdapter | null;
    try {
      adapter = this.options.resolveAdapter
        ? this.options.resolveAdapter(target)
        : this.options.registry.tryGetForConnection(target.platformKey);
    } catch {
      return this.makeSnapshot(target, "UNVERIFIED", "ADAPTER_RESOLUTION_FAILED", false, source);
    }
    if (!adapter) return this.makeSnapshot(target, "UNVERIFIED", "ADAPTER_UNAVAILABLE", false, source);
    const browser = target.connectionMode === "BrowserAutomation" || adapter.manifest.transport === "browser";
    try {
      if (browser) {
        const restored = await this.options.browserSessions.restore({ platformKey: target.platformKey, accountId: target.accountId });
        if (!restored) return this.makeSnapshot(target, "NEEDS_LOGIN", "BROWSER_SESSION_MISSING", false, source);
      }
      const settings: Record<string, string | number | boolean> = {
        triggerSource: "APP_STARTUP",
        browserExecutionMode: "BACKGROUND",
        ...(target.expectedRemoteIdentity ? { expectedCreatorId: target.expectedRemoteIdentity, expectedRemoteIdentity: target.expectedRemoteIdentity } : {}),
        ...(browser && target.loginGeneration !== undefined && target.loginGeneration !== null ? { expectedLoginGeneration: target.loginGeneration } : {})
      };
      const context = { accountId: target.accountId, accountName: target.accountName, platformKey: target.platformKey, settings,
        secrets: this.options.resolveSecrets?.(target.accountId, target.platformKey) };
      const login = await adapter.checkLogin(context);
      if (login !== "logged_in") return this.loginFailure(target, browser, login, source);
      if (!target.expectedRemoteIdentity) return this.makeSnapshot(target, "UNVERIFIED", "EXPECTED_REMOTE_IDENTITY_MISSING", false, source);
      const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(context) : null;
      const remoteIdentity = profile?.accountId ?? await inspectOwnedRemoteIdentity(adapter, context);
      if (!remoteIdentity) return this.makeSnapshot(target, "UNVERIFIED", "LIVE_IDENTITY_UNAVAILABLE", false, source);
      if (remoteIdentity !== target.expectedRemoteIdentity)
        return this.makeSnapshot(target, "IDENTITY_MISMATCH", "REMOTE_IDENTITY_MISMATCH", false, source);
      if (target.platformKey === "website" && (profile?.authorizationStatus !== "Authorized" || !profile.scopes?.includes("write")))
        return this.makeSnapshot(target, "UNVERIFIED", "WRITE_CAPABILITY_UNAVAILABLE", true, source);
      const stale = await this.staleBinding(target);
      if (stale) return this.makeSnapshot(target, stale.state, stale.reasonCode, false, source);
      return this.makeSnapshot(target, browser ? "AUTHENTICATED" : "CONNECTED", null, true, source);
    } catch (error) {
      const state = stateForError(error, browser);
      return this.makeSnapshot(target, state.state, state.reasonCode, false, source);
    }
  }

  private async staleBinding(target: AccountSessionTarget): Promise<{ state: SafeAccountSessionSnapshot["state"]; reasonCode: string } | null> {
    if (!this.options.resolveAuthoritativeTarget) {
      try {
        const companyId = await this.options.resolveCompanyId(target.accountId);
        return companyId === target.companyId ? null : { state: "IDENTITY_MISMATCH", reasonCode: "COMPANY_BINDING_CHANGED" };
      } catch {
        return { state: "UNVERIFIED", reasonCode: "COMPANY_BINDING_UNAVAILABLE" };
      }
    }
    let current: AccountSessionTarget | null;
    try { current = await this.options.resolveAuthoritativeTarget(target.accountId, target.platformKey); }
    catch { return { state: "UNVERIFIED", reasonCode: "AUTHORITATIVE_BINDING_UNAVAILABLE" }; }
    if (!current) return { state: "UNVERIFIED", reasonCode: "ACCOUNT_BINDING_REMOVED" };
    if (current.accountId !== target.accountId || current.platformKey !== target.platformKey)
      return { state: "IDENTITY_MISMATCH", reasonCode: "ACCOUNT_BINDING_CHANGED" };
    if (current.companyId !== target.companyId) return { state: "IDENTITY_MISMATCH", reasonCode: "COMPANY_BINDING_CHANGED" };
    if ((current.loginGeneration ?? null) !== (target.loginGeneration ?? null))
      return { state: "UNVERIFIED", reasonCode: "LOGIN_GENERATION_CHANGED" };
    if (current.expectedRemoteIdentity !== target.expectedRemoteIdentity)
      return { state: "IDENTITY_MISMATCH", reasonCode: "REMOTE_BINDING_CHANGED" };
    if (!current.enabled) return { state: "DISABLED", reasonCode: "ACCOUNT_DISABLED" };
    if (current.connectionMode !== target.connectionMode)
      return { state: "UNVERIFIED", reasonCode: "CONNECTION_MODE_CHANGED" };
    return null;
  }

  private loginFailure(target: AccountSessionTarget, browser: boolean, login: "logged_out" | "expired" | "needs_user_action" | "unknown", source: AccountSessionRefreshSource): SafeAccountSessionSnapshot {
    if (login === "expired") return this.makeSnapshot(target, browser ? "NEEDS_LOGIN" : "CREDENTIAL_INVALID", browser ? "LOGIN_EXPIRED" : "CREDENTIAL_INVALID", false, source);
    if (login === "logged_out") return this.makeSnapshot(target, browser ? "NEEDS_LOGIN" : "CREDENTIAL_INVALID", browser ? "LOGIN_REQUIRED" : "CREDENTIAL_MISSING", false, source);
    if (login === "needs_user_action") return this.makeSnapshot(target, browser ? "NEEDS_LOGIN" : "UNVERIFIED", "USER_ACTION_REQUIRED", false, source);
    return this.makeSnapshot(target, "UNVERIFIED", "LIVE_VERIFICATION_INCONCLUSIVE", false, source);
  }

  private store(target: AccountSessionTarget, state: SafeAccountSessionSnapshot["state"], reasonCode: string | null, identityMatched: boolean, source: AccountSessionRefreshSource): SafeAccountSessionSnapshot {
    const snapshot = this.makeSnapshot(target, state, reasonCode, identityMatched, source);
    this.snapshots.set(accountSessionRuntimeKey(target), snapshot);
    return { ...snapshot };
  }

  private makeSnapshot(target: AccountSessionTarget, state: SafeAccountSessionSnapshot["state"], reasonCode: string | null, identityMatched: boolean, source: AccountSessionRefreshSource): SafeAccountSessionSnapshot {
    const snapshot: SafeAccountSessionSnapshot = {
      accountId: target.accountId,
      platformKey: target.platformKey,
      companyId: target.companyId,
      state,
      source,
      checkedAt: this.now().toISOString(),
      reasonCode,
      identityMatched,
      loginGeneration: target.loginGeneration ?? null
    };
    return { ...snapshot };
  }
}

function targetFingerprint(target: AccountSessionTarget): string {
  return JSON.stringify([target.accountId, target.platformKey, target.companyId, target.connectionMode, target.enabled, target.expectedRemoteIdentity, target.loginGeneration ?? null]);
}

async function inspectOwnedRemoteIdentity(adapter: PlatformAdapter, context: Parameters<PlatformAdapter["checkLogin"]>[0]): Promise<string | null> {
  const candidate = adapter as PlatformAdapter & { inspectOwnedCreatorIdentity?: (ctx: Parameters<PlatformAdapter["checkLogin"]>[0]) => Promise<string | null> };
  return candidate.inspectOwnedCreatorIdentity ? candidate.inspectOwnedCreatorIdentity(context) : null;
}

function stateForError(error: unknown, browser: boolean): { state: SafeAccountSessionSnapshot["state"]; reasonCode: string } {
  const code = error instanceof PlatformAdapterError ? error.code : readErrorCode(error);
  if (code === "NETWORK_ERROR" || code === "TIMEOUT" || code === "RATE_LIMITED" || /ECONN|ENOTFOUND|ETIMEDOUT|network|offline|fetch failed/iu.test(errorText(error)))
    return { state: "NETWORK_UNAVAILABLE", reasonCode: code || "NETWORK_ERROR" };
  if (["LOGIN_EXPIRED", "AUTH_REQUIRED", "PERMISSION_DENIED"].includes(code))
    return { state: browser ? "NEEDS_LOGIN" : "CREDENTIAL_INVALID", reasonCode: browser ? "LOGIN_REQUIRED" : "CREDENTIAL_INVALID" };
  if (/credential|decrypt|safe.?storage/iu.test(errorText(error)))
    return { state: browser ? "NEEDS_LOGIN" : "CREDENTIAL_INVALID", reasonCode: "CREDENTIAL_DECRYPT_FAILED" };
  return { state: "UNVERIFIED", reasonCode: code || "LIVE_VERIFICATION_FAILED" };
}

function readErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name} ${error.message}` : String(error);
}
