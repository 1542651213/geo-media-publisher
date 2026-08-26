import { describe, expect, it } from "vitest";
import type { AccountContext, PublishArticleInput, PublishVideoInput } from "@publisher/domain";
import { XiaohongshuAdapter, mapXiaohongshuError } from "./index";

const context = (dryRun = false): AccountContext => ({ accountId: "a", accountName: "小红书测试", platformKey: "xiaohongshu", settings: { dryRun } });
const article: PublishArticleInput = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };
const video: PublishVideoInput = { title: "视频", tags: [], videoPath: "video.mp4" };

describe("Xiaohongshu official SDK boundary adapter", () => {
  it("does not overclaim the user-triggered SDK as background publishing", () => {
    const adapter = new XiaohongshuAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "xiaohongshu", status: "Blocked", transport: "official_sdk", supportsArticle: true, supportsVideo: true });
    expect(adapter.manifest.blockingReason).toContain("用户");
  });
  it("requires user authorization for the official SDK boundary", async () => {
    const adapter = new XiaohongshuAdapter();
    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    await expect(adapter.beginLogin(context())).resolves.toMatchObject({ requiresUserAction: true });
  });
  it("validates both inputs and requires user action for actual publish", async () => {
    const adapter = new XiaohongshuAdapter();
    await expect(adapter.validateArticle({ ...article, body: "" })).resolves.toMatchObject({ valid: false });
    await expect(adapter.publishVideo(context(true), video)).resolves.toMatchObject({ dryRun: true });
    await expect(adapter.publishArticle(context(), article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  });
  it("maps SDK review and validation errors", () => {
    expect(mapXiaohongshuError("permission denied", 403)).toBe("PERMISSION_DENIED");
    expect(mapXiaohongshuError("content invalid", 400)).toBe("CONTENT_REJECTED");
    expect(mapXiaohongshuError("安全验证")).toBe("USER_ACTION_REQUIRED");
  });
});
