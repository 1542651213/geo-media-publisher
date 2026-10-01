export const ACCOUNT_SESSION_RUNTIME_STATES = [
  "CHECKING",
  "AUTHENTICATED",
  "CONNECTED",
  "NEEDS_LOGIN",
  "CREDENTIAL_INVALID",
  "IDENTITY_MISMATCH",
  "NETWORK_UNAVAILABLE",
  "UNVERIFIED",
  "DISABLED"
] as const;

export type AccountSessionRuntimeState = (typeof ACCOUNT_SESSION_RUNTIME_STATES)[number];
export type AccountSessionRefreshSource = "STARTUP" | "MANUAL";
export type AccountSessionConnectionMode = "BrowserAutomation" | "OfficialAPI" | "OAuth" | "Manual";

export interface AccountSessionTarget {
  accountId: string;
  accountName: string;
  platformKey: string;
  companyId: string;
  connectionMode: AccountSessionConnectionMode;
  enabled: boolean;
  expectedRemoteIdentity: string | null;
  loginGeneration?: number | null;
}

/** Renderer-safe runtime state. It intentionally excludes credentials, StorageState, paths and raw remote identity. */
export interface SafeAccountSessionSnapshot {
  accountId: string;
  platformKey: string;
  companyId: string;
  state: AccountSessionRuntimeState;
  source: AccountSessionRefreshSource;
  checkedAt: string;
  reasonCode: string | null;
  identityMatched: boolean;
  loginGeneration: number | null;
}

export function accountSessionRuntimeKey(identity: Pick<AccountSessionTarget, "platformKey" | "accountId">): string {
  return `${identity.platformKey}:${identity.accountId}`;
}
