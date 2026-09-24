import { describe, expect, it, vi } from "vitest";
import { ToutiaoArticleApiAdapter } from "./adapter";

describe("Toutiao article API offline adapter", () => {
  it("exposes only article preparation and fails closed for submit or login", async () => {
    const adapter = new ToutiaoArticleApiAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "toutiao", transport: "web_api", supportsArticle: true, supportsVideo: false, adapterStatus: "not_implemented" });
    expect(adapter.getCapabilities()).toMatchObject({ contentTransport: "ARTICLE_WEB_API", article: true, video: false });
    await expect(adapter.publishArticle({ accountId: "a", accountName: "a", platformKey: "toutiao", settings: {} }, { articleId: "a", title: "标题", body: "正文", summary: "", tags: [] })).rejects.toMatchObject({ code: "ARTICLE_API_SUBMIT_NOT_IMPLEMENTED" });
    await expect(adapter.beginLogin({ accountId: "a", accountName: "a", platformKey: "toutiao", settings: {} })).rejects.toMatchObject({ code: "ARTICLE_API_SUBMIT_NOT_IMPLEMENTED" });
  });

  it("prepares offline and never invokes HTTP", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("HTTP must stay offline"); });
    try {
      const adapter = new ToutiaoArticleApiAdapter();
      const prepared = adapter.prepareArticle({ jobId: "job", articleId: "article", accountId: "account", brandId: "brand", title: "图文标题", html: "<p>正文</p>", settings: { version: 1, coverMode: "none", coverImages: [], articleAdType: "none", remoteScheduledAt: null }, resolveAsset: () => null, now: new Date("2026-09-24T00:00:00.000Z") });
      expect(prepared.payloadHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(fetch).not.toHaveBeenCalled();
      await expect(adapter.publishArticle({ accountId: "account", accountName: "account", platformKey: "toutiao", settings: {} }, { articleId: "article", title: "图文标题", body: "正文", summary: "", tags: [] })).rejects.toMatchObject({ code: "ARTICLE_API_SUBMIT_NOT_IMPLEMENTED" });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
