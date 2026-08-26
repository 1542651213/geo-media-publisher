import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import { TikTokAdapter } from "./index";

const ctx = (dryRun: boolean, accessToken = "token"): AccountContext => ({ accountId: "a1", accountName: "TikTok 测试账号", platformKey: "tiktok", settings: { dryRun, redirectUri: "https://app.example/callback" }, secrets: { clientKey: "client", clientSecret: "secret", redirectUri: "https://app.example/callback", accessToken } });

describe("TikTok official adapter", () => {
  it("declares a truthful official API manifest", () => {
    const adapter = new TikTokAdapter({ fetchPort: vi.fn() });
    expect(adapter.manifest).toMatchObject({ platformKey: "tiktok", version: "0.4.0", transport: "official_api", supportsArticle: false, supportsVideo: true, status: "Developing" });
    expect(adapter.manifest.officialSources.length).toBeGreaterThan(0);
  });

  it("declares video-only Content Posting capabilities", () => {
    const adapter = new TikTokAdapter({ fetchPort: vi.fn() });
    expect(adapter.getCapabilities()).toMatchObject({ article: false, video: true, draft: true, videoPublishAsync: true });
  });

  it("rejects local paths and unsupported covers", async () => {
    const adapter = new TikTokAdapter({ fetchPort: vi.fn() });
    await expect(adapter.validateVideo({ title: "标题", tags: [], videoPath: "C:/video.mp4", coverPath: "cover.jpg" })).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining([expect.stringContaining("公网视频 URL")]) });
  });

  it("dry-runs without network when the media URL is valid", async () => {
    const fetchPort = vi.fn();
    const adapter = new TikTokAdapter({ fetchPort });
    await expect(adapter.publishVideo(ctx(true), { title: "标题", tags: ["测试"], videoPath: "https://cdn.example/video.mp4" })).resolves.toMatchObject({ success: true, dryRun: true, prepared: true });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("initializes a direct post and polls its status", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { publish_id: "publish-1" }, error: { code: "ok" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } }), { status: 200 }));
    const adapter = new TikTokAdapter({ fetchPort });
    await expect(adapter.publishVideo(ctx(false), { title: "标题", tags: ["测试"], videoPath: "https://cdn.example/video.mp4" })).resolves.toMatchObject({ status: "publishing", externalId: "publish-1" });
    await expect(adapter.getPublishStatus(ctx(false), "publish-1")).resolves.toMatchObject({ status: "published" });
    expect(fetchPort).toHaveBeenCalledTimes(2);
  });

  it("maps official token errors without retrying", async () => {
    const fetchPort = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "invalid_token", message: "token expired", log_id: "log-1" } }), { status: 401 }));
    const adapter = new TikTokAdapter({ fetchPort });

    await expect(adapter.getPublishStatus(ctx(false), "publish-1")).rejects.toMatchObject({ code: "LOGIN_EXPIRED", providerCode: "invalid_token" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });
});
