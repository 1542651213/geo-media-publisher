import { describe, expect, it } from "vitest";
import type { AccountContext, PublishVideoInput } from "@publisher/domain";
import { WechatChannelsAdapter, mapWechatChannelsError } from "./index";

const context = (dryRun = false): AccountContext => ({ accountId: "a", accountName: "视频号测试", platformKey: "wechat_channels", settings: { dryRun } });
const video: PublishVideoInput = { title: "视频", tags: [], videoPath: "video.mp4" };

describe("WeChat Channels manual adapter", () => {
  it("declares video-only manual capabilities", () => {
    const adapter = new WechatChannelsAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "wechat_channels", status: "ManualOnly", transport: "manual", supportsArticle: false, supportsVideo: true });
    expect(adapter.getCredentialSchema()[0]?.type).toBe("browser_login");
  });
  it("pauses until the user completes video assistant login", async () => {
    const adapter = new WechatChannelsAdapter();
    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    await expect(adapter.beginLogin(context())).resolves.toMatchObject({ requiresUserAction: true });
  });
  it("supports local validation/dry-run and pauses real publish", async () => {
    const adapter = new WechatChannelsAdapter();
    await expect(adapter.validateVideo({ ...video, title: "" })).resolves.toMatchObject({ valid: false });
    await expect(adapter.publishVideo(context(true), video)).resolves.toMatchObject({ dryRun: true, prepared: true });
    await expect(adapter.publishVideo(context(), video)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  });
  it("maps captcha and permission errors", () => {
    expect(mapWechatChannelsError("人机验证")).toBe("USER_ACTION_REQUIRED");
    expect(mapWechatChannelsError("permission denied", 403)).toBe("PERMISSION_DENIED");
  });
});
