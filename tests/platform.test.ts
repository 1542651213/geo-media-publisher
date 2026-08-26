import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";

describe("TestPlatform and registry", () => {
  const context = { accountId: "account-1", accountName: "测试账号", platformKey: "test", settings: {} };
  const article = { articleId: "article-1", title: "测试标题", body: "这是一段足够长的测试正文，用于验证 TestPlatform 能够完成正常的模拟发布闭环。", summary: "摘要", tags: ["测试"] };

  it("registers by platform key and publishes success", async () => {
    const registry = new AdapterRegistry();
    const adapter = new TestPlatformAdapter();
    registry.register(adapter);
    expect(registry.get("test").getCapabilities().scheduledPublish).toBe(true);
    const result = await registry.get("test").publishArticle(context, article);
    expect(result.publishedUrl).toMatch(/^test:\/\/published\//);
  });

  it("exposes controlled failure modes without bypass logic", async () => {
    const adapter = new TestPlatformAdapter("user_action");
    await expect(adapter.publishArticle(context, article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(await adapter.checkLogin(context)).toBe("needs_user_action");
  });
});
