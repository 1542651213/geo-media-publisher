import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import { WeChatOfficialAdapter } from "@publisher/adapters-wechat";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function context(settings: Record<string, string | boolean> = {}, secrets: Record<string, string> = { appId: "wx-id", appSecret: "secret" }): AccountContext {
  return { accountId: "account-1", accountName: "测试公众号", platformKey: "wechat_official", settings, secrets };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("WeChat official adapter", () => {
  it("declares a truthful official API manifest", () => {
    const adapter = new WeChatOfficialAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "wechat_official", version: "0.4.0", transport: "official_api", supportsArticle: true, supportsVideo: false, status: "WaitingForUser" });
    expect(adapter.manifest.officialSources.length).toBeGreaterThan(0);
  });

  it("declares official article capabilities and fails closed without cover", async () => {
    const adapter = new WeChatOfficialAdapter();
    expect(adapter.getCapabilities()).toMatchObject({ article: true, tags: false, draft: true });
    const result = await adapter.validateArticle({ articleId: "a", title: "标题", body: "正文", summary: "", tags: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("微信公众号图文发布需要封面图片");
  });

  it("does not claim login when credentials are missing", async () => {
    const adapter = new WeChatOfficialAdapter();
    await expect(adapter.checkLogin({ accountId: "a", accountName: "测试", platformKey: "wechat_official", settings: {} })).resolves.toBe("logged_out");
  });

  it("requires AppID/AppSecret before starting the official configuration flow", async () => {
    const adapter = new WeChatOfficialAdapter();
    await expect(adapter.beginLogin(context({}, {}))).resolves.toMatchObject({ requiresUserAction: true, message: expect.stringContaining("appId") });
    await expect(adapter.beginLogin(context())).resolves.toMatchObject({ requiresUserAction: true, message: expect.stringContaining("access_token") });
  });

  it("maps official authentication and rate-limit errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 40001, errmsg: "invalid credential" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 45009, errmsg: "rate limited" }), { status: 200 }));
    const adapter = new WeChatOfficialAdapter();
    const credentials = { appId: "wx-id", appSecret: "secret" };

    await expect(adapter.checkLogin({ accountId: "expired-account", accountName: "test", platformKey: "wechat_official", settings: {}, secrets: credentials })).resolves.toBe("expired");
    await expect(adapter.publishArticle({ accountId: "limited-account", accountName: "test", platformKey: "wechat_official", settings: { dryRun: true }, secrets: credentials }, { articleId: "article-1", title: "title", body: "body", summary: "", tags: [], coverPath: "unused.png" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("submits real publishing and maps publish_id to a status poll", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wechat-adapter-"));
    try {
      const coverPath = join(dir, "cover.png"); writeFileSync(coverPath, "fake-image");
      const fetchMock = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 7200 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ media_id: "cover-media" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ media_id: "draft-media" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ publish_id: "publish-1" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ publish_status: 1 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ publish_status: 0, article_id: "article-1", article_detail: { count: 1, item: [{ article_url: "https://mp.weixin.qq.com/s/1" }] } }), { status: 200 }));
      const adapter = new WeChatOfficialAdapter();
      const ctx = { accountId: "a", accountName: "测试", platformKey: "wechat_official", settings: { dryRun: false }, secrets: { appId: "wx-id", appSecret: "secret" } };
      const result = await adapter.publishArticle(ctx, { articleId: "article-1", title: "标题", body: "正文", summary: "摘要", tags: [], coverPath });
      expect(result).toMatchObject({ status: "publishing", externalId: "publish-1", response: { externalIdType: "publish_id", publishId: "publish-1", draftId: "draft-media" } });
      await expect(adapter.getPublishStatus(ctx, "publish-1")).resolves.toMatchObject({ status: "publishing" });
      await expect(adapter.getPublishStatus(ctx, "publish-1")).resolves.toMatchObject({ status: "published", publishedUrl: "https://mp.weixin.qq.com/s/1" });
      expect(fetchMock).toHaveBeenCalledTimes(6);
      fetchMock.mockRestore();
      } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("persists the access token in CredentialStore, refreshes once after expiry, and completes a real draft Dry Run without submit", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "token-1", expires_in: 7200 }))
      .mockResolvedValueOnce(response({ errcode: 42001, errmsg: "access_token expired" }))
      .mockResolvedValueOnce(response({ access_token: "token-2", expires_in: 7200 }))
      .mockResolvedValueOnce(response({ media_id: "cover-media-2" }))
      .mockResolvedValueOnce(response({ media_id: "draft-media-2" }));
    const adapter = new WeChatOfficialAdapter({ credentialStore: store, fetchPort, readFilePort: async () => new Uint8Array([1, 2, 3]), now: () => 0 });
    const result = await adapter.publishArticle(context({ dryRun: true }), { articleId: "article-2", title: "标题", body: "正文", summary: "摘要", tags: [], coverPath: "cover.png" });

    expect(result).toMatchObject({ success: true, dryRun: true, prepared: true, externalId: "draft-media-2", response: { externalIdType: "draft_media_id", publishSubmitted: false } });
    expect(fetchPort).toHaveBeenCalledTimes(5);
    expect(String(fetchPort.mock.calls[1]?.[0])).toContain("access_token=token-1");
    expect(String(fetchPort.mock.calls[3]?.[0])).toContain("access_token=token-2");
    expect(String(fetchPort.mock.calls[4]?.[0])).toContain("/draft/add?access_token=token-2");
    expect(store.get("wechat:official:account-1:access-token")).toContain("token-2");
    expect(JSON.stringify(result.response)).not.toContain("token-2");

    const restarted = new WeChatOfficialAdapter({ credentialStore: store, fetchPort, now: () => 0 });
    await expect(restarted.checkLogin(context())).resolves.toBe("logged_in");
    expect(fetchPort).toHaveBeenCalledTimes(5);
  });

  it("fails closed when the publish status response has no publish_status", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 7200 }))
      .mockResolvedValueOnce(response({ article_detail: { item: [] } }));
    const adapter = new WeChatOfficialAdapter({ fetchPort });
    await expect(adapter.getPublishStatus(context(), "publish-unknown")).resolves.toMatchObject({ status: "failed", externalId: "publish-unknown", errorCode: "PLATFORM_CHANGED" });
  });
});
