import { describe, expect, it } from "vitest";
import type { Account, Platform } from "@publisher/domain";
import { accountCapabilityText, accountStatusLabel, articleReviewLabel, connectedAccountsForPlatform, normalNavigation, publishStatusLabel } from "../apps/desktop/src/renderer/v11-ui-model";

describe("V1.1 operations workspace model", () => {
  it("keeps the normal navigation focused on seven everyday operating areas", () => {
    expect(normalNavigation.map((item) => item.label)).toEqual(["首页", "内容生产", "文章库", "图片库", "账号中心", "发布中心", "数据统计"]);
  });

  it("translates internal review and publishing states into business-facing labels", () => {
    expect(articleReviewLabel("Draft")).toBe("草稿");
    expect(articleReviewLabel("Needs_Review")).toBe("需修改");
    expect(articleReviewLabel("Approved")).toBe("已通过");
    expect(publishStatusLabel("AwaitingConfirmation")).toBe("等待确认");
    expect(publishStatusLabel("DryRunPassed")).not.toBe("已发布");
    expect(publishStatusLabel("Publishing")).toBe("发布中");
    expect(publishStatusLabel("NeedsUserAction")).toBe("需要处理");
  });

  it("separates connected-session state from verified publishing capability", () => {
    const browserPlatform = { integrationMode: "BrowserAutomation", backgroundAutomationStatus: "UNKNOWN" } as Platform;
    expect(accountCapabilityText(browserPlatform, "PublishPassed")).not.toBe(accountCapabilityText(browserPlatform, "NotTested"));
    expect(accountCapabilityText(browserPlatform, "NotTested")).toContain("验证码");
  });

  it("keeps automatic account selection limited to enabled, logged-in accounts", () => {
    const accounts = [
      { id: "online", platformAccountId: "platform-online", platformKey: "zhihu", enabled: true, loginStatus: "logged_in" },
      { id: "offline", platformAccountId: "platform-offline", platformKey: "zhihu", enabled: true, loginStatus: "expired" },
      { id: "disabled", platformAccountId: "platform-disabled", platformKey: "zhihu", enabled: false, loginStatus: "logged_in" },
      { id: "other", platformAccountId: "platform-other", platformKey: "weibo", enabled: true, loginStatus: "logged_in" }
    ];
    expect(connectedAccountsForPlatform(accounts as unknown as Account[], "zhihu").map((account) => account.id)).toEqual(["online"]);
    expect(accountStatusLabel({ loginStatus: "logged_in" })).toBe("已登录");
    expect(accountStatusLabel({ loginStatus: "expired" })).toBe("需要重新登录");
  });
});
