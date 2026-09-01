import { describe, expect, it, vi } from "vitest";
import type { PublishArticleInput } from "@publisher/domain";
import { XiaohongshuBrowserAdapter, XiaohongshuAdapter, mapXiaohongshuError } from "./index";

const article: PublishArticleInput = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };
describe("Xiaohongshu BrowserAutomation adapter", () => {
  it("uses the formal xiaohongshu platform key without overclaiming video support", () => {
    const adapter = new XiaohongshuAdapter({ sessionManager: { hasStoredSession: vi.fn(() => false), open: vi.fn(), save: vi.fn(), close: vi.fn(), clear: vi.fn() } as never });
    expect(adapter).toBeInstanceOf(XiaohongshuBrowserAdapter);
    expect(adapter.manifest).toMatchObject({ platformKey: "xiaohongshu", status: "WaitingForUser", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false });
    expect(adapter.getCapabilities().controlledSelfTestModes).toEqual(["POST_UPLOAD_DISCOVERY_ONLY", "XHS_PUBLISH_FLOW_EXPLORATION"]);
  });
  it("validates image-post input before any browser operation", async () => {
    const adapter = new XiaohongshuAdapter({ sessionManager: { hasStoredSession: vi.fn(() => false), open: vi.fn(), save: vi.fn(), close: vi.fn(), clear: vi.fn() } as never });
    await expect(adapter.validateArticle({ ...article, body: "" })).resolves.toMatchObject({ valid: false });
    await expect(adapter.validateArticle({ ...article, images: [] })).resolves.toMatchObject({ valid: false });
  });
  it("maps SDK review and validation errors", () => {
    expect(mapXiaohongshuError("permission denied", 403)).toBe("PERMISSION_DENIED");
    expect(mapXiaohongshuError("content invalid", 400)).toBe("CONTENT_REJECTED");
    expect(mapXiaohongshuError("安全验证")).toBe("USER_ACTION_REQUIRED");
  });
});
