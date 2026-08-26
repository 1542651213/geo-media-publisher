import { describe, expect, it } from "vitest";
import type { AccountContext, PublishArticleInput, PublishVideoInput } from "@publisher/domain";
import { SohuMediaAdapter, mapSohuMediaError } from "./index";

const context = (dryRun = false): AccountContext => ({ accountId: "a", accountName: "搜狐号测试", platformKey: "sohu_media", settings: { dryRun } });
const article: PublishArticleInput = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };
const video: PublishVideoInput = { title: "视频", tags: [], videoPath: "video.mp4" };

describe("Sohu media manual adapter", () => {
  it("declares article and video manual capabilities", () => {
    const adapter = new SohuMediaAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "sohu_media", status: "ManualOnly", supportsArticle: true, supportsVideo: true });
    expect(adapter.getCapabilities()).toMatchObject({ article: true, video: true, draft: true });
  });
  it("requires official-page login instead of storing browser credentials", async () => {
    const adapter = new SohuMediaAdapter();
    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    await expect(adapter.beginLogin(context())).resolves.toMatchObject({ requiresUserAction: true });
  });
  it("validates both content kinds and keeps real submission manual", async () => {
    const adapter = new SohuMediaAdapter();
    await expect(adapter.validateVideo({ ...video, title: "" })).resolves.toMatchObject({ valid: false });
    await expect(adapter.publishArticle(context(true), article)).resolves.toMatchObject({ dryRun: true });
    await expect(adapter.publishVideo(context(), video)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  });
  it("maps security and content errors", () => {
    expect(mapSohuMediaError("security verification")).toBe("USER_ACTION_REQUIRED");
    expect(mapSohuMediaError("permission denied", 403)).toBe("PERMISSION_DENIED");
    expect(mapSohuMediaError("video invalid", 400)).toBe("CONTENT_REJECTED");
  });
});
