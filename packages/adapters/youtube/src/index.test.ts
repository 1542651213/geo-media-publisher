import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import { YouTubeAdapter } from "./index";

const context = (dryRun: boolean, accessToken = "token"): AccountContext => ({ accountId: "account-1", accountName: "YouTube 测试账号", platformKey: "youtube", settings: { dryRun }, secrets: { accessToken } });

describe("YouTube official adapter", () => {
  it("declares a truthful official API manifest", () => {
    const adapter = new YouTubeAdapter({ fetchPort: vi.fn() });
    expect(adapter.manifest).toMatchObject({ platformKey: "youtube", version: "0.4.0", transport: "official_api", supportsArticle: false, supportsVideo: true, status: "Developing" });
    expect(adapter.manifest.officialSources.length).toBeGreaterThan(0);
  });

  it("declares video-only capabilities and rejects articles", async () => {
    const adapter = new YouTubeAdapter({ fetchPort: vi.fn() });
    expect(adapter.getCapabilities()).toMatchObject({ article: false, video: true, maxTitleLength: 100, videoPublishAsync: true });
    await expect(adapter.validateArticle({ articleId: "a", title: "标题", body: "正文", summary: "", tags: [] })).resolves.toMatchObject({ valid: false });
  });

  it("dry-runs after local validation without calling the network", async () => {
    const fetchPort = vi.fn();
    const adapter = new YouTubeAdapter({ fetchPort });
    const dir = await mkdtemp(join(tmpdir(), "youtube-adapter-"));
    const videoPath = join(dir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    await expect(adapter.publishVideo(context(true), { title: "测试视频", description: "说明", tags: ["测试"], videoPath })).resolves.toMatchObject({ success: true, dryRun: true, prepared: true });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("starts and completes a resumable upload, then polls processing", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: "https://upload.example/session" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "video-1" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "video-1", status: { uploadStatus: "processed" }, processingDetails: { processingStatus: "succeeded" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new YouTubeAdapter({ fetchPort });
    const dir = await mkdtemp(join(tmpdir(), "youtube-adapter-"));
    const videoPath = join(dir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    const result = await adapter.publishVideo(context(false), { title: "测试视频", description: "说明", tags: ["测试"], videoPath });
    expect(result).toMatchObject({ success: true, status: "publishing", externalId: "video-1" });
    await expect(adapter.getPublishStatus(context(false), "video-1")).resolves.toMatchObject({ status: "published", publishedUrl: "https://www.youtube.com/watch?v=video-1" });
    expect(fetchPort).toHaveBeenCalledTimes(3);
    expect(fetchPort.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchPort.mock.calls[1]?.[0]).toBe("https://upload.example/session");
  });

  it("fails closed without credentials", async () => {
    const adapter = new YouTubeAdapter({ fetchPort: vi.fn() });
    await expect(adapter.checkLogin({ accountId: "a", accountName: "测试", platformKey: "youtube", settings: {} })).resolves.toBe("logged_out");
    await expect(adapter.getPublishStatus(context(false, ""), "video-1")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("maps official quota errors without retrying", async () => {
    const fetchPort = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 403 }));
    const adapter = new YouTubeAdapter({ fetchPort });

    await expect(adapter.getPublishStatus(context(false), "video-1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });
});
