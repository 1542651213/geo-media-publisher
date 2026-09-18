import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import { DouyinOfficialAdapter, DOUYIN_ENDPOINTS, DouyinAdapterError } from "./index";
import type { CredentialStore } from "@publisher/security";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

function context(store: MemoryCredentialStore, settings: Record<string, string | boolean> = {}): AccountContext {
  store.set("oauth:douyin:account-1:token", JSON.stringify({ accessToken: "access-token", tokenType: "Bearer", scope: ["video.create"] }));
  return { accountId: "account-1", accountName: "测试账号", platformKey: "douyin", settings, secrets: { clientKey: "client-key", clientSecret: "client-secret", redirectUri: "app://douyin/callback" } };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

describe("DouyinOfficialAdapter", () => {
  it("exposes the verified official API-only boundary", () => {
    const adapter = new DouyinOfficialAdapter({ credentialStore: new MemoryCredentialStore(), fetch: vi.fn() });
    expect(adapter.manifest.transport).toBe("official_api");
    expect(adapter.manifest.supportsArticle).toBe(false);
    expect(adapter.manifest.supportsVideo).toBe(true);
    expect(adapter.getCapabilities().videoFormats).toEqual(["video/mp4", "video/quicktime"]);
    expect(adapter.getCredentialSchema().map((field) => field.key)).toEqual(["clientKey", "clientSecret", "redirectUri"]);
  });

  it("uses the core OAuth state flow and translates the Douyin client key parameter", async () => {
    const store = new MemoryCredentialStore();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchPort = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return response({ data: { access_token: "new-token", refresh_token: "refresh-token", expires_in: 3600 } });
    });
    const adapter = new DouyinOfficialAdapter({ credentialStore: store, fetch: fetchPort });
    const ctx = context(store);
    const login = await adapter.beginLogin(ctx);
    expect(login.authorizationUrl).toContain("client_key=client-key");
    expect(login.authorizationUrl).not.toContain("client_id=");
    const state = new URL(login.authorizationUrl ?? "").searchParams.get("state") ?? "";
    await adapter.completeLogin(ctx, "code", state);
    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get("client_key")).toBe("client-key");
    expect((body as URLSearchParams).get("client_id")).toBeNull();
  });

  it("keeps dry-run entirely off the network", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn(async () => { throw new Error("network must not be called"); });
    const adapter = new DouyinOfficialAdapter({
      credentialStore: store,
      fetch: fetchPort,
      transport: {
        fetch: fetchPort,
        stat: async () => ({ isFile: () => true, size: 10 }),
        readFile: async () => new Uint8Array([1, 2, 3])
      }
    });
    const result = await adapter.publishVideo(context(store, { dryRun: true }), { title: "测试视频", tags: [], videoPath: "clip.mp4" });
    expect(result).toMatchObject({ success: true, dryRun: true, prepared: true });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("validates video files before a real publish", async () => {
    const fetchPort = vi.fn(async () => response({ data: { publish_id: "publish-1" } }));
    const adapter = new DouyinOfficialAdapter({
      credentialStore: new MemoryCredentialStore(),
      fetch: fetchPort,
      transport: { stat: async () => ({ isFile: () => false, size: 0 }) }
    });
    await expect(adapter.publishVideo(context(new MemoryCredentialStore()), { title: "", tags: [], videoPath: "clip.exe" })).rejects.toMatchObject({ code: "CONTENT_REJECTED" });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("maps accepted publish and status responses without exposing tokens", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(response({ data: { publish_id: "publish-1", status: "processing" } }))
      .mockResolvedValueOnce(response({ data: { item_id: "publish-1", status: "approved", share_url: "https://www.douyin.com/video/1" } }));
    const adapter = new DouyinOfficialAdapter({
      credentialStore: store,
      fetch: fetchPort,
      transport: { stat: async () => ({ isFile: () => true, size: 10 }), readFile: async () => new Uint8Array([1]) }
    });
    const ctx = context(store);
    const published = await adapter.publishVideo(ctx, { title: "测试视频", description: "描述", tags: ["测试"], videoPath: "clip.mp4" });
    expect(published).toMatchObject({ status: "publishing", externalId: "publish-1" });
    expect(JSON.stringify(published.response)).not.toContain("access-token");
    const status = await adapter.getPublishStatus(ctx, "publish-1");
    expect(status).toMatchObject({ status: "published", publishedUrl: "https://www.douyin.com/video/1" });
    expect(fetchPort.mock.calls[0]?.[0]).toBe(DOUYIN_ENDPOINTS.videoCreate);
    expect(fetchPort.mock.calls[1]?.[0]).toBe(DOUYIN_ENDPOINTS.videoQuery);
  });

  it("maps expired-token errors to the login boundary", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn(async () => response({ error_code: 10003, message: "access token invalid" }, 401));
    const adapter = new DouyinOfficialAdapter({ credentialStore: store, fetch: fetchPort });
    await expect(adapter.getPublishStatus(context(store), "publish-1")).rejects.toBeInstanceOf(DouyinAdapterError);
    await expect(adapter.checkLogin(context(store))).resolves.toBe("expired");
  });
});
