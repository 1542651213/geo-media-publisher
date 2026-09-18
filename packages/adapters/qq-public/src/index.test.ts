import { describe, expect, it } from "vitest";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import { QqPublicAdapter, mapQqPublicError } from "./index";

const context = (dryRun = false): AccountContext => ({ accountId: "a", accountName: "企鹅号测试", platformKey: "qq_public", settings: { dryRun } });
const article: PublishArticleInput = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };

describe("Penguin manual adapter", () => {
  it("declares blocked status instead of pretending third-party API support", () => {
    const adapter = new QqPublicAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "qq_public", status: "Blocked", transport: "manual", supportsArticle: true });
  });
  it("exposes a manual login boundary", async () => {
    const adapter = new QqPublicAdapter();
    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    await expect(adapter.beginLogin(context())).resolves.toMatchObject({ requiresUserAction: true });
  });
  it("keeps dry-run and manual publish separate", async () => {
    const adapter = new QqPublicAdapter();
    await expect(adapter.publishArticle(context(true), article)).resolves.toMatchObject({ dryRun: true, prepared: true });
    await expect(adapter.publishArticle(context(), article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  });
  it("maps auth and content errors", () => {
    expect(mapQqPublicError("login required", 401)).toBe("LOGIN_EXPIRED");
    expect(mapQqPublicError("content invalid", 400)).toBe("CONTENT_REJECTED");
  });
});
