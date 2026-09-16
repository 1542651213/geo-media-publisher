import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Account, Platform } from "@publisher/domain";
import type { AccountDisconnectResult } from "../shared/api";

export interface BrowserAccountConnectionResult {
  configured: true;
  accountStatus: "Connected";
  authorizationStatus: "Authorized";
  accountId: string;
  accountName: string | null;
  scopes: string[];
  expiresAt: null;
}

export function browserAccountConnectionResult(account: Pick<Account, "id" | "accountName" | "name">): BrowserAccountConnectionResult {
  return {
    configured: true,
    accountStatus: "Connected",
    authorizationStatus: "Authorized",
    accountId: account.id,
    accountName: account.accountName ?? account.name,
    scopes: [],
    expiresAt: null
  };
}

export function browserAccountDisconnectResult(input: { loginStatus: Account["loginStatus"]; credentialPresent: boolean; activeSession: boolean; archived?: boolean }): AccountDisconnectResult {
  const alreadyDisconnected = (input.archived === true || input.loginStatus === "logged_out") && !input.credentialPresent && !input.activeSession;
  return { disconnected: true, accountStatus: "NotConnected", outcome: alreadyDisconnected ? "ALREADY_DISCONNECTED" : "DISCONNECTED" };
}

/**
 * Account lifecycle capability is intentionally overlaid on the repository
 * platform view. Publish transport and content routing remain unchanged.
 */
export function addAccountConnectionMode(platform: Platform, registry: AdapterRegistry): Platform {
  const accountConnectionMode = registry.getAccountConnectionMode(platform.platformKey);
  return accountConnectionMode ? { ...platform, accountConnectionMode } : platform;
}

export function addAccountConnectionModes(platforms: Platform[], registry: AdapterRegistry): Platform[] {
  return platforms.map((platform) => addAccountConnectionMode(platform, registry));
}
