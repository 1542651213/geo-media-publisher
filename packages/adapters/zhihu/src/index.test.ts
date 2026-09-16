import { describe, expect, it } from "vitest";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import { ZhihuAdapter, mapZhihuError } from "./index";

const context = (dryRun = false): AccountContext => ({ accountId: "a", accountName: "知乎测试", platformKey: "zhihu", settings: { dryRun } });
const article: PublishArticleInput = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };

describe("Zhihu manual adapter", () => {
  it("declares manual-only article capability", () => {
    const adapter = new ZhihuAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "zhihu", status: "ManualOnly", transport: "manual", supportsArticle: true, supportsVideo: false });
    expect(adapter.getCapabilities().draft).toBe(true);
  });
  it("exposes an explicit user-action login boundary", async () => {
    const adapter = new ZhihuAdapter();
    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    await expect(adapter.beginLogin(context())).resolves.toMatchObject({ requiresUserAction: true });
  });
  it("keeps dry-run local and requires user action for real publish", async () => {
    const adapter = new ZhihuAdapter();
    await expect(adapter.publishArticle(context(true), article)).resolves.toMatchObject({ dryRun: true, prepared: true });
    await expect(adapter.publishArticle(context(), article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    await expect(adapter.getPublishStatus(context(), "id")).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  });
  it("maps validation and login errors", () => {
    expect(mapZhihuError("title invalid", 400)).toBe("CONTENT_REJECTED");
    expect(mapZhihuError("login required", 401)).toBe("LOGIN_EXPIRED");
  });
});
