import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AccountManagementRow } from "../apps/desktop/src/shared/api";
import { accountConnectionTarget, isOnlineAccount, platformHasConnectedAccount } from "../apps/desktop/src/renderer/v11-ui-model";
import { accountStatusLabel, disconnectFeedbackMessage, platformAccountStatusLabel, platformAuthorizationStatusLabel, platformConnectionActions } from "../apps/desktop/src/renderer/platform-connection-ui";
import { classifyBrowserLoginResult } from "../apps/desktop/src/renderer/V11Workspace";

type RuntimeRow = AccountManagementRow & { runtimeAuthState?: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED" | null };

function row(id: string, accountStatus: AccountManagementRow["accountStatus"] | "Unverified", overrides: Partial<RuntimeRow> = {}): RuntimeRow {
  const result: RuntimeRow = {
    account: { id, platformKey: "xiaohongshu", name: id, accountAlias: id, accountName: null, groupId: null, loginStatus: accountStatus === "Connected" ? "logged_in" : "logged_out", enabled: true, allowAutoPublish: false, minimumIntervalSeconds: 0, publishMode: "manual", todayPublishCount: 0, lastPublishAt: null, lastLoginCheck: null, pausedReason: null, failedCount: 0 },
    platform: null,
    credentialStatus: { configured: false, expired: false, fields: [] },
    lastDryRunAt: null,
    accountStatus: accountStatus as AccountManagementRow["accountStatus"],
    authorizationStatus: "Unknown",
    authorizationScopes: [],
    authorizationExpiresAt: null,
    providerAccountId: null,
    providerAccountName: null,
    publishVerification: "NotTested",
    connectionStage: "NotConfigured",
    runtimeAuthState: null,
    ...overrides
  };
  result.account.loginStatus = "logged_in";
  return result;
}

describe("BrowserAutomation account creation semantics", () => {
  it("maps the main-process Connected contract to renderer success", () => {
    expect(classifyBrowserLoginResult({ accountStatus: "Connected" })).toBe("SUCCESS");
    expect(classifyBrowserLoginResult({ accountStatus: "NeedsLogin" })).toBe("NEEDS_USER_ACTION");
  });

  it("labels a historical XHS login as unverified and excludes it from online accounts", () => {
    const historical = row("account-1", "Unverified", { runtimeAuthState: "UNVERIFIED" });

    expect(accountStatusLabel(historical)).toBe("待验证");
    expect(isOnlineAccount({ ...historical.account, accountStatus: historical.accountStatus, runtimeAuthState: historical.runtimeAuthState })).toBe(false);
  });

  it("does not report persisted logged_in as live XHS authentication without a Context", () => {
    const historical = row("account-1", "Unverified", { runtimeAuthState: "UNVERIFIED" });

    expect(historical.account.loginStatus).toBe("logged_in");
    expect(historical.accountStatus).toBe("Unverified");
    expect(historical.runtimeAuthState).toBe("UNVERIFIED");
  });

  it("counts an XHS account online only after the canonical Context is authenticated", () => {
    const live = row("account-1", "Connected", { runtimeAuthState: "AUTHENTICATED" });

    expect(accountStatusLabel(live)).toBe("已连接");
    expect(isOnlineAccount({ ...live.account, accountStatus: live.accountStatus, runtimeAuthState: live.runtimeAuthState })).toBe(true);
  });

  it("keeps XHS verification and relogin actions available for historical rows", () => {
    const xhs = { platformKey: "xiaohongshu", displayName: "小红书", verificationStatus: "WaitingForUser", integrationMode: "BrowserAutomation", transport: "browser" } as never;
    const historical = row("account-1", "Unverified", { platform: xhs });

    expect(platformConnectionActions(xhs, historical).map((item) => item.label)).toEqual(["重新登录", "+ 添加账号"]);
  });

  it("releases only the connection Page when the adapter supports page-only cleanup", () => {
    const source = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    const start = source.indexOf('register("accounts:complete-login"');
    const end = source.indexOf('register("accounts:refresh-login"', start);
    const completionBlock = source.slice(start, end);

    expect(completionBlock).toContain("releaseConnectionPage");
    expect(completionBlock).toContain("releaseConnectionSession");
  });

  it("derives XHS account overview status from runtime authentication state", () => {
    const source = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");

    expect(source).toContain("getBrowserRuntimeState");
    expect(source).toContain('runtimeAuthState === "AUTHENTICATED" ? "Connected"');
    expect(source).toContain('account.loginStatus === "logged_in" ? "Unverified"');
  });

  it("uses the exact pending account for browser login completion", () => {
    const source = readFileSync("apps/desktop/src/renderer/V11Workspace.tsx", "utf8");
    expect(source).toContain("setPendingLogin({ accountId: account.id, platformKey });");
    expect(source).toContain('accounts.completeLogin(pendingLogin.accountId, pendingLogin.platformKey, "")');
  });

  it("exposes a dedicated XHS controlled self-test entry without changing generic self-test", () => {
    const source = readFileSync("apps/desktop/src/renderer/V11Workspace.tsx", "utf8");
    expect(source).toContain("首次上传后发现");
    expect(source).toContain("supportsControlledPostUploadDiscovery");
    expect(source).toContain("CONTROLLED_SELF_TEST_CONFIRMATION");
    expect(source).toContain("platformSelfTest.runPostUploadDiscovery(request)");
    expect(source).toContain("platformSelfTest.runSafe(accountId)");
  });

  it("uses the same typed controlled mode in both renderer entry points and IPC", () => {
    const centerSource = readFileSync("apps/desktop/src/renderer/PlatformSelfTestCenter.tsx", "utf8");
    const apiSource = readFileSync("apps/desktop/src/shared/api.ts", "utf8");
    const ipcSource = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    expect(centerSource).toContain("platformSelfTest.runPostUploadDiscovery(request)");
    expect(apiSource).toContain("mode: ControlledSelfTestMode");
    expect(ipcSource).toContain('mode: z.literal("POST_UPLOAD_DISCOVERY_ONLY")');
    expect(ipcSource).toContain("runPostUploadDiscovery(input.platformAccountId, input.mode)");
  });

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

  it("shows explicit feedback for an already disconnected account", () => {
    expect(disconnectFeedbackMessage({ outcome: "ALREADY_DISCONNECTED" }, "小红书账号 2")).toBe("小红书账号 2 当前已处于未连接状态；活动账号已移除。");
  });

  it("shows explicit feedback for a disconnected account and keeps the row refresh contract", () => {
    expect(disconnectFeedbackMessage({ outcome: "DISCONNECTED" }, "小红书账号 2")).toBe("已移除小红书账号 2；已清除登录状态和本地会话，历史发布记录保留。");
  });

  it("routes disconnect through the exact requested account ID and exposes an outcome", () => {
    const source = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    const start = source.indexOf('register("accounts:disconnect"');
    const end = source.indexOf('register("accounts:open-backend"', start);
    const disconnectBlock = source.slice(start, end);
    expect(disconnectBlock).toContain("input.accountId");
    expect(disconnectBlock).toContain("input.platformKey");
    expect(disconnectBlock).toContain("outcome");
    expect(disconnectBlock).not.toContain("accounts[0]");
    expect(disconnectBlock).not.toContain("connectedRows[0]");
  });

  it("routes BrowserAutomation removal to archive instead of deleting an account container", () => {
    const source = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    const start = source.indexOf('register("accounts:disconnect"');
    const end = source.indexOf('register("accounts:open-backend"', start);
    const disconnectBlock = source.slice(start, end);
    expect(disconnectBlock).toContain("markPlatformAccountDisconnected");
    expect(disconnectBlock).not.toMatch(/deleteAccount|accounts:delete|accounts:remove/iu);
    expect(source).toContain("accountRowArchived");
  });

  it("uses the stable-identity restore path without introducing platform-wide account fallback", () => {
    const mainSource = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    expect(mainSource).toContain("findArchivedAccountByExternalIdForConnection");
    expect(mainSource).toContain("restoreArchivedAccountByExternalId");
    expect(mainSource).toContain("rebindAccountSession");
    expect(mainSource).not.toContain("accounts[0]");
  });

  it("uses removal wording and the history-preserving confirmation", () => {
    const workspaceSource = readFileSync("apps/desktop/src/renderer/V11Workspace.tsx", "utf8");
    const appSource = readFileSync("apps/desktop/src/renderer/App.tsx", "utf8");
    expect(workspaceSource).toContain(">移除</button>");
    expect(workspaceSource).toContain("移除后会清除此账号的登录状态和本地会话，但不会删除历史发布记录。");
    expect(appSource).toContain(">移除</button>");
    expect(appSource).toContain("移除后会清除此账号的登录状态和本地会话，但不会删除历史发布记录。");
  });
});
