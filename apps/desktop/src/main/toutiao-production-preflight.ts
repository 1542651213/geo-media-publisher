/** Deliberately has no capture, submit, replay, credential write or Repository mutation port. */
export interface ToutiaoProductionPreflightPort {
  readonlyMode: boolean;
  formalExecutionActive: boolean;
  account: { id: string; platformKey: string; externalAccountId?: string | null; enabled: boolean } | null;
  activate(): Promise<{ runtimeState: string; sessionExists: boolean; contextExists: boolean;
    canonicalPageExists: boolean; contextOwnsPage: boolean; pageAlive: boolean; pageHost: string | null }>;
  auth(): Promise<string>;
  identity(): Promise<string | null>;
  smoke(): Promise<{ scopeComplete: boolean; availableStatuses: readonly string[]; totalRows: number; blockedContentMutationCount: number }>;
}

export async function runToutiaoProductionPreflight(port: ToutiaoProductionPreflightPort) {
  const base = { readOnly: true, transport: "BrowserNative" as const, finalSubmitCount: 0,
    accountId: port.account?.id ?? null, accountIdentityMatch: false, sessionActive: false,
    contextOwnership: false, managementReady: false, availableStatuses: [] as readonly string[], rowsObserved: 0 };
  const fail = (reasonCode: string) => ({ ...base, ready: false, reasonCode });
  if (!port.readonlyMode || port.formalExecutionActive) return fail("READONLY_SESSION_REQUIRED");
  if (!port.account || port.account.platformKey !== "toutiao" || !port.account.enabled || !port.account.externalAccountId)
    return fail("ACCOUNT_BINDING_UNAVAILABLE");
  try {
    const runtime = await port.activate();
    base.sessionActive = runtime.runtimeState === "ACTIVE" && runtime.sessionExists && runtime.contextExists
      && runtime.canonicalPageExists && runtime.pageAlive && runtime.pageHost === "mp.toutiao.com";
    base.contextOwnership = runtime.contextOwnsPage;
    if (!base.sessionActive || !base.contextOwnership) return fail("SESSION_OWNERSHIP_UNAVAILABLE");
    if (await port.auth() !== "VALID") return fail("OWNER_LOGIN_OR_VERIFICATION_REQUIRED");
    if (await port.identity() !== port.account.externalAccountId) return fail("ACCOUNT_IDENTITY_MISMATCH");
    base.accountIdentityMatch = true;
    const smoke = await port.smoke();
    base.availableStatuses = smoke.availableStatuses;
    base.rowsObserved = smoke.totalRows;
    base.managementReady = smoke.scopeComplete && smoke.availableStatuses.length > 0 && smoke.blockedContentMutationCount === 0;
    if (!base.managementReady) return fail("MANAGEMENT_READ_INCOMPLETE");
    return { ...base, ready: true, reasonCode: null };
  } catch { return fail("READONLY_PREFLIGHT_FAILED"); }
}
