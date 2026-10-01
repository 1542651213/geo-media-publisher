import { expect, it } from "vitest";
import { accountStatusLabel, isOnlineAccount, canPublishWithReviewMode } from "../apps/desktop/src/renderer/v11-ui-model";

it("uses live runtime health and requires human approval even under legacy review modes", () => {
  expect(accountStatusLabel({ loginStatus: "logged_in", runtimeAuthState: "NETWORK_UNAVAILABLE" })).toBe("暂时无法验证连接");
  expect(accountStatusLabel({ loginStatus: "logged_in", runtimeAuthState: "CHECKING" })).toBe("正在验证账号");
  expect(accountStatusLabel({ loginStatus: "logged_in" })).toBe("尚未验证");
  expect(isOnlineAccount({ enabled: true, platformKey: "weibo", loginStatus: "logged_in" })).toBe(false);
  expect(isOnlineAccount({ enabled: true, platformKey: "website", loginStatus: "expired", runtimeAuthState: "CONNECTED" })).toBe(true);
  expect(isOnlineAccount({ enabled: true, platformKey: "website", loginStatus: "logged_in", accountStatus: "Connected", runtimeAuthState: "NETWORK_UNAVAILABLE" })).toBe(false);
  for (const mode of ["Off", "WarningOnly", "Strict"]) {
    expect(canPublishWithReviewMode("Draft", mode)).toBe(false);
    expect(canPublishWithReviewMode("Approved", mode)).toBe(true);
  }
});
