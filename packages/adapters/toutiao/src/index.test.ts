import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import {
  mapToutiaoError,
  TOUTIAO_ENDPOINTS,
  TOUTIAO_MAX_VIDEO_BYTES,
  ToutiaoAdapter,
  ToutiaoAdapterError
} from "./index";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

function context(settings: Record<string, string | boolean> = {}): AccountContext {
  return {
    accountId: "account-1",
    accountName: "头条测试账号",
    platformKey: "toutiao",
    settings,
    secrets: { clientKey: "client-key", clientSecret: "client-secret", redirectUri: "https://app.example/toutiao/callback" }
  };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function storeToken(store: MemoryCredentialStore): void {
  store.set("oauth:toutiao:account-1:token", JSON.stringify({ accessToken: "access-token", refreshToken: "refresh-token", tokenType: "Bearer", scope: ["toutiao.video.create", "toutiao.video.data"], providerAccountId: "open-id" }));
}

function videoInput(path = "clip.mp4") {
  return { title: "测试视频", description: "视频说明", tags: [], videoPath: path };
}

describe("Toutiao official video adapter", () => {
  it("declares a truthful video-only official API manifest and capabilities", async () => {
    const adapter = new ToutiaoAdapter({ credentialStore: new MemoryCredentialStore(), fetchPort: vi.fn(), statPort: async () => ({ isFile: () => true, size: 1 }) });
    expect(adapter.manifest).toMatchObject({ platformKey: "toutiao", status: "WaitingForUser", adapterStatus: "ready", researchStatus: "verified", transport: "official_api", supportsArticle: false, supportsVideo: true });
    expect(adapter.getCapabilities()).toMatchObject({ article: false, video: true, maxVideoSize: TOUTIAO_MAX_VIDEO_BYTES, maxVideoDuration: 60, videoPublishAsync: true });
    await expect(adapter.validateArticle({ articleId: "a", title: "文章", body: "正文", summary: "", tags: [] })).resolves.toMatchObject({ valid: false });
    await expect(adapter.publishArticle(context(), { articleId: "a", title: "文章", body: "正文", summary: "", tags: [] })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("strictly validates format, cover and the 128MB single-file boundary", async () => {
    const adapter = new ToutiaoAdapter({ credentialStore: new MemoryCredentialStore(), statPort: async () => ({ isFile: () => true, size: TOUTIAO_MAX_VIDEO_BYTES + 1 }) });
    await expect(adapter.validateVideo(videoInput("clip.mp4"))).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining([expect.stringContaining("128MB")]) });
    await expect(adapter.validateVideo({ ...videoInput("clip.mov"), coverPath: "cover.jpg" })).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining([expect.stringContaining("MP4 或 WebM"), expect.stringContaining("自定义封面")]) });
  });

  it("maps official, HTTP and human-verification failures without retrying", () => {
    expect(mapToutiaoError(10008, 200)).toBe("LOGIN_EXPIRED");
    expect(mapToutiaoError(2190004, 200)).toBe("PERMISSION_DENIED");
    expect(mapToutiaoError(2190001, 200)).toBe("RATE_LIMITED");
    expect(mapToutiaoError(2100005, 200)).toBe("CONTENT_REJECTED");
    expect(mapToutiaoError(10012, 200)).toBe("API_REVIEW_REQUIRED");
    expect(mapToutiaoError(undefined, 412, "需要安全验证")).toBe("USER_ACTION_REQUIRED");
    expect(mapToutiaoError(2100004, 200)).toBe("NETWORK_ERROR");
  });

  it("creates an official Toutiao OAuth request and translates client_id to client_key", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("client_key")).toBe("client-key");
      expect(body.get("client_id")).toBeNull();
      return response({ data: { access_token: "new-token", refresh_token: "refresh", expires_in: 3600, open_id: "open-id", scope: "toutiao.video.create,toutiao.video.data" } });
    });
    const adapter = new ToutiaoAdapter({ credentialStore: store, fetchPort, statPort: async () => ({ isFile: () => true, size: 1 }) });
    const login = await adapter.beginLogin(context());
    expect(login).toMatchObject({ requiresUserAction: true, callbackUrl: "https://app.example/toutiao/callback" });
    expect(login.authorizationUrl).toContain("open.snssdk.com/oauth/authorize/");
    expect(login.authorizationUrl).toContain("client_key=client-key");
    expect(login.authorizationUrl).toContain("scope=toutiao.video.create%2Ctoutiao.video.data");
    const state = new URL(login.authorizationUrl ?? "").searchParams.get("state") ?? "";
    await adapter.completeLogin(context(), "code", state);
    await expect(adapter.checkLogin(context())).resolves.toBe("logged_in");
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });

  it("keeps Dry Run entirely off the network and does not require OAuth", async () => {
    const fetchPort = vi.fn(async () => { throw new Error("network must not be called"); });
    const readFilePort = vi.fn(async () => new Uint8Array([1]));
    const adapter = new ToutiaoAdapter({ credentialStore: new MemoryCredentialStore(), fetchPort, readFilePort, statPort: async () => ({ isFile: () => true, size: TOUTIAO_MAX_VIDEO_BYTES }) });
    await expect(adapter.publishVideo(context({ dryRun: true }), videoInput())).resolves.toMatchObject({ success: true, dryRun: true, prepared: true, response: { networkCalls: 0 } });
    expect(fetchPort).not.toHaveBeenCalled();
    expect(readFilePort).not.toHaveBeenCalled();
  });

  it("uploads, publishes for review and reconciles through the official video list", async () => {
    const store = new MemoryCredentialStore();
    storeToken(store);
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(response({ data: { error_code: 0, video: { video_id: "video-1" } }, extra: { error_code: 0 } }))
      .mockResolvedValueOnce(response({ data: { error_code: 0, item_id: "item-1" }, extra: { error_code: 0 } }))
      .mockResolvedValueOnce(response({ data: { error_code: 0, list: [{ item_id: "item-1", is_reviewed: true, share_url: "https://www.toutiao.com/video/item-1" }] }, extra: { error_code: 0 } }));
    const adapter = new ToutiaoAdapter({ credentialStore: store, fetchPort, readFilePort: async () => new Uint8Array([1, 2, 3]), statPort: async () => ({ isFile: () => true, size: 3 }) });
    const published = await adapter.publishVideo(context(), videoInput());
    expect(published).toMatchObject({ success: true, status: "publishing", externalId: "item-1" });
    expect(fetchPort.mock.calls[0]?.[0]).toBe(TOUTIAO_ENDPOINTS.videoUpload);
    expect(fetchPort.mock.calls[1]?.[0]).toBe(TOUTIAO_ENDPOINTS.videoCreate);
    expect(new Headers(fetchPort.mock.calls[0]?.[1]?.headers).get("access-token")).toBe("access-token");
    expect(String(fetchPort.mock.calls[1]?.[1]?.body)).toContain('"video_id":"video-1"');
    await expect(adapter.getPublishStatus(context(), "item-1")).resolves.toMatchObject({ status: "published", publishedUrl: "https://www.toutiao.com/video/item-1" });
    expect(fetchPort.mock.calls[2]?.[0]).toBe(TOUTIAO_ENDPOINTS.videoList);
  });

  it("fails closed on permission review errors and unresolved list results", async () => {
    const store = new MemoryCredentialStore();
    storeToken(store);
    const deniedFetch = vi.fn(async () => response({ data: { error_code: 2190004, description: "应用未获得该能力" }, extra: { error_code: 2190004 } }));
    const denied = new ToutiaoAdapter({ credentialStore: store, fetchPort: deniedFetch, readFilePort: async () => new Uint8Array([1]), statPort: async () => ({ isFile: () => true, size: 1 }) });
    const deniedPublish = denied.publishVideo(context(), videoInput());
    await expect(deniedPublish).rejects.toBeInstanceOf(ToutiaoAdapterError);
    await expect(deniedPublish).rejects.toMatchObject({ code: "PERMISSION_DENIED", providerCode: "2190004" });
    expect(deniedFetch).toHaveBeenCalledTimes(1);

    const listFetch = vi.fn(async () => response({ data: { error_code: 0, list: [] }, extra: { error_code: 0 } }));
    const unresolved = new ToutiaoAdapter({ credentialStore: store, fetchPort: listFetch, statPort: async () => ({ isFile: () => true, size: 1 }) });
    await expect(unresolved.getPublishStatus(context(), "missing-item")).resolves.toMatchObject({ status: "publishing", response: { found: false, needsReconciliation: true } });
  });
});
