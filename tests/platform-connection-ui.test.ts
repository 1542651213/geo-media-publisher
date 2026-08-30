import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Platform } from "@publisher/domain";
import type { AccountManagementRow } from "../apps/desktop/src/shared/api";
import { accountStatusLabel, authorizationLabel, connectionErrorMessage, platformConnectionActions, platformConnectionKind } from "../apps/desktop/src/renderer/platform-connection-ui";
import { platformConnectionModeLabel } from "../apps/desktop/src/renderer/v11-ui-model";

function platform(overrides: Partial<Platform> = {}): Platform {
  return {
    id: "platform-1", platformKey: "zhihu", displayName: "知乎", category: "图文/问答", adapterStatus: "ready", adapterVersion: "1.0.0", enabled: true,
    capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10 },
    researchStatus: "partial", healthStatus: "healthy", lastVerifiedAt: "2026-08-21", verificationStatus: "WaitingForUser", backgroundAutomationStatus: "UNKNOWN", backgroundAutomationLastTestedAt: null, backgroundAutomationReason: null, transport: "browser", integrationMode: "BrowserAutomation", officialWebsite: "https://www.zhihu.com", developerPortal: null, blockingReason: "等待用户完成登录", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", credentialSchema: [], officialSources: [] ,
    ...overrides
  };
}

function row(overrides: Partial<AccountManagementRow> = {}): AccountManagementRow {
  return {
    account: { id: "account-1", platformKey: "zhihu", name: "知乎账号", accountAlias: "知乎账号", accountName: null, groupId: null, loginStatus: "logged_out", enabled: true, allowAutoPublish: false, minimumIntervalSeconds: 0, publishMode: "manual", todayPublishCount: 0, lastPublishAt: null, lastLoginCheck: null, pausedReason: null, failedCount: 0 },
    platform: platform(), credentialStatus: { configured: false, expired: false, fields: [] }, lastDryRunAt: null, accountStatus: "NotConnected", authorizationStatus: "Unknown", authorizationScopes: [], authorizationExpiresAt: null, providerAccountId: null, providerAccountName: null, publishVerification: "NotTested", connectionStage: "NotConfigured", runtimeAuthState: null, ...overrides
  };
}

describe("V1.0.1 platform connection UI decisions", () => {
  it("shows browser connection actions and separates adapter readiness from account state", () => {
    expect(platformConnectionKind(platform())).toBe("browser");
    expect(platformConnectionActions(platform(), row()).map((item) => item.label)).toEqual(["连接账号", "+ 添加账号"]);
    expect(accountStatusLabel(row())).toBe("未连接");
    expect(authorizationLabel(platform(), row())).toBe("不适用");
    expect(platformConnectionActions(platform(), row({ accountStatus: "Connected", authorizationStatus: "Authorized" })).map((item) => item.label)).toEqual(["查看账号", "打开后台", "重新登录", "+ 添加账号"]);
  });

  it("uses configure/connect/reauthorize actions for OAuth without exposing internal states", () => {
    const oauth = platform({ platformKey: "douyin", displayName: "抖音", transport: "official_api", integrationMode: "OAuth", authStrategy: "OAuth2" });
    expect(platformConnectionActions(oauth, row({ platform: oauth })).map((item) => item.label)).toEqual(["配置开放平台应用"]);
    expect(platformConnectionActions(oauth, row({ platform: oauth, credentialStatus: { configured: true, expired: false, fields: [] } })).map((item) => item.label)).toEqual(["连接账号"]);
    expect(platformConnectionActions(oauth, row({ platform: oauth, credentialStatus: { configured: true, expired: false, fields: [] }, accountStatus: "Connected" })).map((item) => item.label)).toEqual(["查看账号", "重新授权"]);
  });

  it("uses the runtime account connection mode for Toutiao and offers relogin for attention states", () => {
    const toutiao = platform({ platformKey: "toutiao", transport: "official_api", integrationMode: "API", accountConnectionMode: "BrowserAutomation" });
    expect(platformConnectionKind(toutiao)).toBe("browser");
    expect(platformConnectionActions(toutiao, row({ platform: toutiao })).map((item) => item.kind)).toEqual(["connect", "add-account"]);
    expect(platformConnectionActions(toutiao, row({ platform: toutiao, accountStatus: "NeedsLogin" })).map((item) => item.kind)).toEqual(["relogin", "add-account"]);
    expect(platformConnectionActions(toutiao, row({ platform: toutiao, accountStatus: "Expired" })).map((item) => item.kind)).toEqual(["relogin", "add-account"]);
  });

  it("shows BrowserAutomation as the actual connection mode in the account center", () => {
    expect(platformConnectionModeLabel(platform())).toBe("浏览器自动化");
    expect(platformConnectionModeLabel(platform({ integrationMode: "API", accountConnectionMode: "BrowserAutomation" }))).toBe("浏览器自动化");
    expect(readFileSync("apps/desktop/src/renderer/V11Workspace.tsx", "utf8")).toContain("platformConnectionModeLabel(platform)");
    expect(readFileSync("apps/desktop/src/renderer/PlatformConnectionCenter.tsx", "utf8")).toContain("accountConnectionMode");
    expect(readFileSync("apps/desktop/src/renderer/PlatformSelfTestCenter.tsx", "utf8")).toContain("accountConnectionMode");
  });

  it("keeps manual, blocked and not implemented platforms fail-closed", () => {
    expect(platformConnectionActions(platform({ transport: "manual", integrationMode: "Manual", authStrategy: "ManualOnly", verificationStatus: "ManualOnly" }), null).map((item) => item.label)).toEqual(["查看接入说明"]);
    expect(platformConnectionActions(platform({ integrationMode: "Blocked", verificationStatus: "Blocked" }), null).map((item) => item.label)).toEqual(["查看原因"]);
    expect(platformConnectionActions(platform({ adapterStatus: "not_implemented", verificationStatus: "NotImplemented" }), null).map((item) => item.label)).toEqual(["暂未支持"]);
  });

  it("keeps browser runtime diagnostics safe for ordinary UI", () => {
    expect(connectionErrorMessage(new Error("Error invoking remote method 'accounts:begin-login': Error: Cannot find package 'playwright' at C:\\Users\\secret\\node_modules"))).toBe("连接启动失败，请查看应用日志中的详细诊断。");
    expect(connectionErrorMessage(new Error("未检测到 Microsoft Edge 或 Google Chrome，请安装浏览器后重试。"))).toContain("Microsoft Edge");
  });
});
