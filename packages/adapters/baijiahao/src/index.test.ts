import { describe, expect, it } from "vitest";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import { BaijiahaoAdapter, mapBaijiahaoError } from "./index";

const context = (dryRun = false): AccountContext => ({ accountId: "a", accountName: "百家号测试", platformKey: "baijiahao", settings: { dryRun } });
const article: PublishArticleInput = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };

describe("Baijiahao manual adapter", () => {
  it("declares manual-only capabilities and credentials", () => {
    const adapter = new BaijiahaoAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "baijiahao", status: "ManualOnly", transport: "manual", supportsArticle: true, supportsVideo: false });
    expect(adapter.getCredentialSchema()[0]?.type).toBe("browser_login");
  });
  it("pauses login until the user completes the official page flow", async () => {
    const adapter = new BaijiahaoAdapter();
    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    await expect(adapter.beginLogin(context())).resolves.toMatchObject({ requiresUserAction: true });
  });
  it("validates, dry-runs locally, and never claims a real publish", async () => {
    const adapter = new BaijiahaoAdapter();
    await expect(adapter.validateArticle({ ...article, title: "" })).resolves.toMatchObject({ valid: false });
    await expect(adapter.publishArticle(context(true), article)).resolves.toMatchObject({ dryRun: true, prepared: true });
    await expect(adapter.publishArticle(context(), article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  });
  it("maps auth, content, rate and verification errors", () => {
    expect(mapBaijiahaoError("验证码")).toBe("USER_ACTION_REQUIRED");
    expect(mapBaijiahaoError("permission denied", 403)).toBe("PERMISSION_DENIED");
    expect(mapBaijiahaoError("title invalid", 400)).toBe("CONTENT_REJECTED");
    expect(mapBaijiahaoError("rate limited", 429)).toBe("RATE_LIMITED");
  });
});
