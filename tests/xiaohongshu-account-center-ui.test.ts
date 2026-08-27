import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AccountManagementRow } from "../apps/desktop/src/shared/api";
import { accountConnectionTarget, platformHasConnectedAccount } from "../apps/desktop/src/renderer/v11-ui-model";
import { platformAccountStatusLabel, platformAuthorizationStatusLabel } from "../apps/desktop/src/renderer/platform-connection-ui";

function row(id: string, accountStatus: AccountManagementRow["accountStatus"]): AccountManagementRow {
  return {
    account: { id, platformKey: "xiaohongshu", name: id, accountAlias: id, accountName: null, groupId: null, loginStatus: accountStatus === "Connected" ? "logged_in" : "logged_out", enabled: true, allowAutoPublish: false, minimumIntervalSeconds: 0, publishMode: "manual", todayPublishCount: 0, lastPublishAt: null, lastLoginCheck: null, pausedReason: null, failedCount: 0 },
    platform: null,
    credentialStatus: { configured: false, expired: false, fields: [] },
    lastDryRunAt: null,
    accountStatus,
    authorizationStatus: "Unknown",
    authorizationScopes: [],
    authorizationExpiresAt: null,
    providerAccountId: null,
    providerAccountName: null,
    publishVerification: "NotTested",
    connectionStage: "NotConfigured"
  };
}

describe("BrowserAutomation account creation semantics", () => {
  it("reuses an incomplete container for connect but creates a new account for add", () => {
    const rows = [row("account-connected", "Connected"), row("account-pending", "NeedsLogin")];
    expect(accountConnectionTarget(rows, "connect")).toEqual({ accountId: "account-pending", createAccount: false });
    expect(accountConnectionTarget(rows, "relogin")).toEqual({ accountId: "account-pending", createAccount: false });
    expect(accountConnectionTarget(rows, "add")).toEqual({ accountId: null, createAccount: true });
    expect(platformHasConnectedAccount(rows)).toBe(true);
  });

  it("fails closed when relogin has no selected or incomplete account", () => {
    expect(accountConnectionTarget([], "relogin")).toEqual({ accountId: null, createAccount: false });
    expect(accountConnectionTarget([row("account-connected", "Connected")], "relogin")).toEqual({ accountId: null, createAccount: false });
    expect(accountConnectionTarget([row("account-a", "NeedsLogin"), row("account-b", "NeedsLogin")], "connect")).toEqual({ accountId: null, createAccount: false });
    expect(accountConnectionTarget([row("account-a", "NeedsLogin"), row("account-b", "NeedsLogin")], "relogin")).toEqual({ accountId: null, createAccount: false });
  });

  it("does not route the capability center through a platform-wide first account", () => {
    const source = readFileSync("apps/desktop/src/renderer/PlatformConnectionCenter.tsx", "utf8");
    expect(source).not.toContain("rowsByPlatform");
    expect(source).toContain("selectedAccountId");
    expect(source).toContain('"add-account"');
    expect(source).toContain('kind: "view-account", label: "选择账号"');
    expect(readFileSync("apps/desktop/src/renderer/V11Workspace.tsx", "utf8")).toContain("browser && !connected && rows.length === 0");
    expect(readFileSync("apps/desktop/src/renderer/V11Workspace.tsx", "utf8")).toContain("const accountId = row.account.id");
    expect(readFileSync("apps/desktop/src/renderer/V11Workspace.tsx", "utf8")).toContain("runSafe(accountId)");
  });

  it("summarizes multiple accounts without calling a connected platform not connected", () => {
    const rows = [row("account-a", "Connected"), row("account-b", "NeedsLogin")];
    expect(platformAccountStatusLabel(rows)).toBe("1/2 个已登录");
    expect(platformAuthorizationStatusLabel(rows, "browser")).toBe("已完成");
    expect(platformAccountStatusLabel([row("account-a", "NeedsLogin"), row("account-b", "Expired")])).toBe("2 个账号待处理");
  });
});
