import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import {
  FACEBOOK_ENDPOINTS,
  FACEBOOK_GRAPH_API_VERSION,
  FacebookAdapterError,
  FacebookPagesAdapter,
  mapFacebookError,
  type FacebookPagePostInput
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
    accountName: "Meta Page 测试账号",
    platformKey: "facebook",
    settings,
    secrets: {
      clientId: "app-id",
      clientSecret: "app-secret",
      redirectUri: "https://app.example/facebook/callback",
      pageId: "123456789"
    }
  };
}

function article(overrides: Partial<FacebookPagePostInput> = {}): FacebookPagePostInput {
  return { articleId: "article-1", title: "页面标题", body: "页面正文", summary: "", tags: [], ...overrides };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function storePageToken(store: MemoryCredentialStore): void {
  store.set("facebook:page:account-1:token", JSON.stringify({
    pageId: "123456789",
    pageName: "Test Page",
    accessToken: "page-access-token",
    scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    tasks: ["CREATE_CONTENT"],
    authorizedAt: "2026-08-20T00:00:00.000Z"
  }));
}

describe("Facebook Pages official adapter", () => {
  it("declares a truthful Page-only text/link manifest and capabilities", () => {
    const adapter = new FacebookPagesAdapter({ credentialStore: new MemoryCredentialStore(), fetchPort: vi.fn() });
    expect(FACEBOOK_GRAPH_API_VERSION).toBe("v26.0");
    expect(adapter.manifest).toMatchObject({
      platformKey: "facebook",
      status: "WaitingForUser",
      adapterStatus: "ready",
      researchStatus: "verified",
      transport: "official_api",
      supportsArticle: true,
      supportsVideo: false
    });
    expect(adapter.getCapabilities()).toMatchObject({ article: true, imagePost: false, video: false, coverImage: false, maxImageCount: 0, draft: false });
    expect(adapter.getCredentialSchema().map((field) => field.key)).toEqual(["clientId", "clientSecret", "redirectUri", "pageId"]);
  });

  it("validates text/link posts and strictly rejects unsupported local attachments", async () => {
    const adapter = new FacebookPagesAdapter({ credentialStore: new MemoryCredentialStore() });
    await expect(adapter.validateArticle(article({ coverPath: "cover.jpg", images: ["one.jpg"] }))).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining("本地封面"), expect.stringContaining("本地图片")])
    });
    await expect(adapter.validateArticle(article({ title: "", body: "", link: "file:///secret.txt" }))).resolves.toMatchObject({ valid: false });
    await expect(adapter.validateArticle(article({ title: "", body: "", link: "https://example.com/story" }))).resolves.toMatchObject({ valid: true });
  });

  it("maps token, review, permission, rate-limit, content and security errors fail-closed", () => {
    expect(mapFacebookError(190, 463, 400)).toBe("LOGIN_EXPIRED");
    expect(mapFacebookError(10, undefined, 400, "Requires App Review and Advanced Access")).toBe("API_REVIEW_REQUIRED");
    expect(mapFacebookError(200, undefined, 403)).toBe("PERMISSION_DENIED");
    expect(mapFacebookError(613, undefined, 400)).toBe("RATE_LIMITED");
    expect(mapFacebookError(368, undefined, 400)).toBe("CONTENT_REJECTED");
    expect(mapFacebookError(190, 459, 400, "Security checkpoint required")).toBe("USER_ACTION_REQUIRED");
    expect(mapFacebookError(undefined, undefined, 408)).toBe("TIMEOUT");
  });

  it("creates a v26.0 OAuth session, validates state/scopes/tasks and stores only the Page token in CredentialStore", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === FACEBOOK_ENDPOINTS.accessToken) {
        const body = init?.body as URLSearchParams;
        expect(body.get("client_id")).toBe("app-id");
        expect(body.get("client_secret")).toBe("app-secret");
        return response({ access_token: "user-access-token", token_type: "bearer", expires_in: 3600 });
      }
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer user-access-token");
      if (url === FACEBOOK_ENDPOINTS.permissions) {
        return response({ data: [
          { permission: "pages_manage_posts", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "pages_show_list", status: "granted" }
        ] });
      }
      if (url.startsWith(FACEBOOK_ENDPOINTS.pages)) {
        return response({ data: [{ id: "123456789", name: "Test Page", access_token: "page-access-token", tasks: ["CREATE_CONTENT"] }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort, now: () => new Date("2026-08-20T00:00:00.000Z") });
    const login = await adapter.beginLogin(context());
    expect(login).toMatchObject({ requiresUserAction: true, callbackUrl: "https://app.example/facebook/callback" });
    const loginUrl = new URL(login.authorizationUrl ?? "");
    expect(loginUrl.origin + loginUrl.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(loginUrl.searchParams.get("scope")?.split(",")).toEqual(["pages_manage_posts", "pages_read_engagement", "pages_show_list"]);
    const state = loginUrl.searchParams.get("state") ?? "";
    await expect(adapter.completeLogin(context(), "code", "wrong-state")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const completed = await adapter.completeLogin(context(), "code", state);
    expect(completed).toMatchObject({ configured: true, pageId: "123456789", pageName: "Test Page" });
    expect(JSON.stringify(completed)).not.toContain("access-token");
    expect(store.get("facebook:page:account-1:token")).toContain("page-access-token");
    await expect(adapter.checkLogin(context())).resolves.toBe("logged_in");
    expect(fetchPort).toHaveBeenCalledTimes(3);
  });

  it("fails OAuth completion when required Page permissions were declined", async () => {
    const store = new MemoryCredentialStore();
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "user-access-token", token_type: "bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ data: [
        { permission: "pages_manage_posts", status: "declined" },
        { permission: "pages_read_engagement", status: "granted" },
        { permission: "pages_show_list", status: "granted" }
      ] }));
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort });
    const login = await adapter.beginLogin(context());
    const state = new URL(login.authorizationUrl ?? "").searchParams.get("state") ?? "";
    await expect(adapter.completeLogin(context(), "code", state)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(store.has("facebook:page:account-1:token")).toBe(false);
    expect(fetchPort).toHaveBeenCalledTimes(2);
  });

  it("keeps Dry Run at zero network and does not require OAuth or a Page token", async () => {
    const fetchPort = vi.fn(async () => { throw new Error("network must not be called"); });
    const store = new MemoryCredentialStore();
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort });
    await expect(adapter.publishArticle(context({ dryRun: true }), article({ link: "https://example.com/story" }))).resolves.toMatchObject({
      success: true,
      dryRun: true,
      prepared: true,
      response: { graphApiVersion: "v26.0", linkPresent: true, networkCalls: 0 }
    });
    expect(fetchPort).not.toHaveBeenCalled();
    expect(store.has("facebook:page:account-1:token")).toBe(false);
  });

  it("publishes a Page feed text/link post with a stored Page token and returns the external id", async () => {
    const store = new MemoryCredentialStore();
    storePageToken(store);
    const fetchPort = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer page-access-token");
      if (url === "https://graph.facebook.com/v26.0/123456789?fields=id%2Cname%2Ctasks") {
        expect(init?.method).toBe("GET");
        return response({ id: "123456789", name: "Test Page", tasks: ["CREATE_CONTENT"] });
      }
      expect(url).toBe("https://graph.facebook.com/v26.0/123456789/feed");
      expect(init?.method).toBe("POST");
      const body = init?.body as URLSearchParams;
      expect(body.get("message")).toBe("页面标题\n\n页面正文");
      expect(body.get("link")).toBe("https://example.com/story");
      expect(body.has("access_token")).toBe(false);
      return response({ id: "123456789_987654321" });
    });
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort });
    await expect(adapter.publishArticle(context(), article({ link: "https://example.com/story" }))).resolves.toMatchObject({
      success: true,
      status: "publishing",
      externalId: "123456789_987654321",
       response: { needsReconciliation: true, pageId: "123456789", externalId: "123456789_987654321" }
     });
    expect(fetchPort).toHaveBeenCalledTimes(2);
  });

  it("blocks a publish when the live Page permission preflight has no content task", async () => {
    const store = new MemoryCredentialStore();
    storePageToken(store);
    const fetchPort = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://graph.facebook.com/v26.0/123456789?fields=id%2Cname%2Ctasks");
      return response({ id: "123456789", name: "Test Page", tasks: ["ANALYZE"] });
    });
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort });
    await expect(adapter.publishArticle(context(), article())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });

  it("reconciles Page post status and permalink through the official Post endpoint", async () => {
    const store = new MemoryCredentialStore();
    storePageToken(store);
    const fetchPort = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v26.0/123456789_987654321");
      expect(url.searchParams.get("fields")).toBe("id,permalink_url,is_published,status_type,created_time");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer page-access-token");
      return response({ id: "123456789_987654321", permalink_url: "https://www.facebook.com/123456789/posts/987654321", is_published: true, status_type: "mobile_status_update" });
    });
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort });
    await expect(adapter.getPublishStatus(context(), "123456789_987654321")).resolves.toMatchObject({
      status: "published",
      externalId: "123456789_987654321",
      publishedUrl: "https://www.facebook.com/123456789/posts/987654321"
    });
  });

  it("turns a missing Graph post into a failed reconciliation result while preserving the external id", async () => {
    const store = new MemoryCredentialStore();
    storePageToken(store);
    const fetchPort = vi.fn(async () => response({ error: { message: "Unsupported get request", code: 100 } }, 400));
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort });
    await expect(adapter.getPublishStatus(context(), "123456789_987654321")).resolves.toMatchObject({
      status: "failed",
      externalId: "123456789_987654321",
      errorCode: "CONTENT_REJECTED"
    });
  });

  it("surfaces official Graph review errors without retrying or leaking Authorization", async () => {
    const store = new MemoryCredentialStore();
    storePageToken(store);
    const fetchPort = vi.fn(async () => response({ error: { message: "Permission requires App Review and Advanced Access", type: "OAuthException", code: 10, fbtrace_id: "trace" } }, 400));
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort });
    const operation = adapter.publishArticle(context(), article());
    await expect(operation).rejects.toBeInstanceOf(FacebookAdapterError);
    await expect(operation).rejects.toMatchObject({ code: "API_REVIEW_REQUIRED", providerCode: "10" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });

  it("aborts a timed-out Graph request once and never retries", async () => {
    const store = new MemoryCredentialStore();
    storePageToken(store);
    const fetchPort = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const adapter = new FacebookPagesAdapter({ credentialStore: store, fetchPort, timeoutMs: 5 });
    const operation = adapter.publishArticle(context(), article());
    await expect(operation).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(fetchPort.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
