import { expect, it } from "vitest";
import { sessionAccountHealth } from "../apps/desktop/src/shared/product-platform-policy";

it("keeps offline distinct from expired and requires live identity before connected health", () => {
  expect(sessionAccountHealth("douyin", "NETWORK_UNAVAILABLE").status).toBe("暂时无法验证连接");
  expect(sessionAccountHealth("douyin", "NEEDS_LOGIN").status).toBe("登录已失效，请重新登录");
  expect(sessionAccountHealth("cnblogs", "CREDENTIAL_INVALID").status).toBe("凭据已失效，请更新凭据");
  expect(sessionAccountHealth("website", "CHECKING").status).toBe("正在验证账号");
  expect(sessionAccountHealth("website", "CONNECTED").status).toBe("已连接");
  expect(sessionAccountHealth("weibo", "AUTHENTICATED").ownerNextAction).toContain("验收");
});
