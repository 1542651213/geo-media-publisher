import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import type { FetchPort, BilibiliOAuthClient, BilibiliOAuthToken } from "./index";
import { BilibiliAdapter } from "./index";

const context = (dryRun: boolean, oauth = true): AccountContext => ({
  accountId: "account-1",
  accountName: "Bilibili 测试账号",
  platformKey: "bilibili",
  settings: { dryRun, oauthRedirectUri: "http://127.0.0.1/callback" },
  ...(oauth ? { secrets: { clientId: "client-id", clientSecret: "client-secret" } } : {})
});

function oauthClient(token: BilibiliOAuthToken | null = { accessToken: "oauth-token" }): BilibiliOAuthClient {
  return {
    createAuthorization: vi.fn(() => ({ authorizationUrl: "https://oauth.example/authorize", callbackUrl: "http://127.0.0.1/callback", state: "state-1" })),
    completeAuthorization: vi.fn(async () => ({ accessToken: "new-token" })),
    getToken: vi.fn(() => token),
    refresh: vi.fn(async () => ({ accessToken: "refreshed-token" }))
  };
}

describe("Bilibili official article adapter", () => {
  it("declares a truthful article-only official API manifest", () => {
    const adapter = new BilibiliAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "bilibili", version: "0.4.0", transport: "official_api", adapterStatus: "degraded", supportsArticle: true, supportsVideo: false, status: "Developing" });
    expect(adapter.manifest.officialSources.length).toBeGreaterThan(0);
  });

  it("advertises article-only capability and closes video publishing", async () => {
    const adapter = new BilibiliAdapter();
    expect(adapter.getCapabilities()).toMatchObject({ article: true, video: false, coverImage: false, tags: false, draft: false });
    await expect(adapter.publishVideo(context(false), { title: "视频", tags: [], videoPath: "clip.mp4" })).rejects.toMatchObject({ code: "API_REVIEW_REQUIRED" });
  });

  it("does not claim login without an OAuth token and validates unsupported article media", async () => {
    const adapter = new BilibiliAdapter({ oauth: oauthClient(null) });
    await expect(adapter.checkLogin(context(false))).resolves.toBe("logged_out");
    await expect(adapter.validateArticle({ articleId: "a", title: "标题", body: "正文", summary: "", tags: [], coverPath: "cover.png" })).resolves.toMatchObject({ valid: false });
  });

  it("returns API_REVIEW_REQUIRED and makes no request when article endpoints are not reviewed", async () => {
    const fetchPort = vi.fn<FetchPort>();
    const adapter = new BilibiliAdapter({ fetchPort, oauth: oauthClient() });
    await expect(adapter.publishArticle(context(true), { articleId: "article-1", title: "标题", body: "正文", summary: "摘要", tags: [] })).rejects.toMatchObject({ code: "API_REVIEW_REQUIRED" });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("uses the configured draft endpoint for dry-run and never calls publish", async () => {
    const fetchPort = vi.fn<FetchPort>().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { draft_id: "draft-1" } }), { status: 200 }));
    const adapter = new BilibiliAdapter({
      fetchPort,
      apiRoot: "https://api.example.test",
      oauth: oauthClient(),
      articleApi: { draft: { url: "/official/article/draft", method: "POST" } }
    });
    const result = await adapter.publishArticle(context(true), { articleId: "article-1", title: "标题", body: "正文", summary: "摘要", tags: ["标签"] });
    expect(result).toMatchObject({ success: true, dryRun: true, prepared: true, externalId: "draft-1" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(fetchPort.mock.calls[0]?.[0]).toBe("https://api.example.test/official/article/draft");
    expect(fetchPort.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer oauth-token" } });
    expect(String(fetchPort.mock.calls[0]?.[1]?.body)).toContain("\"article_id\":\"article-1\"");
    expect(String(fetchPort.mock.calls[0]?.[1]?.body)).not.toContain("client-secret");
  });

  it("publishes through draft then publish and maps an official status response", async () => {
    const fetchPort = vi.fn<FetchPort>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { draft_id: "draft-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { article_id: "article-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { status: "published", article_url: "https://www.bilibili.com/read/cv1" } }), { status: 200 }));
    const adapter = new BilibiliAdapter({
      fetchPort,
      apiRoot: "https://api.example.test",
      oauth: oauthClient(),
      articleApi: {
        draft: { url: "/official/article/draft" },
        publish: { url: "/official/article/publish" },
        status: { url: "/official/article/status", method: "GET", idParameter: "article_id" }
      }
    });
    expect(adapter.getCapabilities().draft).toBe(true);
    const result = await adapter.publishArticle(context(false), { articleId: "article-1", title: "标题", body: "正文", summary: "摘要", tags: [] });
    expect(result).toMatchObject({ success: true, status: "publishing", externalId: "article-1" });
    await expect(adapter.getPublishStatus(context(false), "article-1")).resolves.toMatchObject({ status: "published", publishedUrl: "https://www.bilibili.com/read/cv1" });
    expect(fetchPort).toHaveBeenCalledTimes(3);
    expect(fetchPort.mock.calls[2]?.[0]).toBe("https://api.example.test/official/article/status?article_id=article-1");
  });

  it("maps authentication failures and exposes the OAuth authorization boundary", async () => {
    const fetchPort = vi.fn<FetchPort>().mockResolvedValue(new Response(JSON.stringify({ code: -101, message: "not login" }), { status: 401 }));
    const oauth = oauthClient();
    const adapter = new BilibiliAdapter({ fetchPort, oauth, articleApi: { draft: { url: "https://api.example.test/draft" } } });
    await expect(adapter.beginLogin(context(true))).resolves.toMatchObject({ requiresUserAction: true, authorizationUrl: "https://oauth.example/authorize", callbackUrl: "http://127.0.0.1/callback" });
    await expect(adapter.publishArticle(context(true), { articleId: "article-1", title: "标题", body: "正文", summary: "摘要", tags: [] })).rejects.toMatchObject({ code: "LOGIN_EXPIRED", providerCode: "-101" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });
});
