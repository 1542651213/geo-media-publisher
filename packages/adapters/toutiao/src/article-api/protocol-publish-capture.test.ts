import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page, Request, Response, Route } from "playwright-core";
import { createControlledPublishCaptureGuard, runControlledToutiaoPublishCapture } from "./protocol-publish-capture";

function request(method: string, url: string, body: string | null = null): Request {
  return { method: () => method, url: () => url,
    headers: () => ({ cookie: "cookie-secret", "content-type": "application/x-www-form-urlencoded", "x-secsdk-csrf-token": "token-secret" }),
    postDataBuffer: () => body === null ? null : Buffer.from(body) } as unknown as Request;
}

function routeFor(item: Request): { route: Route; continued: ReturnType<typeof vi.fn>; aborted: ReturnType<typeof vi.fn> } {
  const continued = vi.fn(async () => undefined);
  const aborted = vi.fn(async () => undefined);
  return { route: { request: () => item, continue: continued, abort: aborted } as unknown as Route, continued, aborted };
}

describe("controlled publish request capture guard", () => {
  it("captures only the final publish request shape and aborts before dispatch", async () => {
    const guard = createControlledPublishCaptureGuard();
    const publish = routeFor(request("POST", "https://mp.toutiao.com/mp/agw/article/publish?a_bogus=signature-secret",
      "title=private-content&content=private-body&article_ad_type=0"));
    await guard.handle(publish.route);
    expect(publish.continued).not.toHaveBeenCalled();
    expect(publish.aborted).toHaveBeenCalledOnce();
    expect(guard.evidence()).toMatchObject({ publishAttemptCount: 1, publishSentCount: 0,
      publishRequest: { method: "POST", host: "mp.toutiao.com", path: "/mp/agw/article/publish",
        queryKeys: ["a_bogus"], bodyKeys: ["article_ad_type", "content", "title"], contentType: "application/x-www-form-urlencoded" } });
    expect(JSON.stringify(guard.evidence())).not.toMatch(/cookie-secret|token-secret|signature-secret|private-content|private-body/u);
  });

  it("allows at most one exact article/new GET and blocks all content mutation paths", async () => {
    const guard = createControlledPublishCaptureGuard();
    const first = routeFor(request("GET", "https://mp.toutiao.com/mp/agw/article/new?format=html"));
    const second = routeFor(request("GET", "https://mp.toutiao.com/mp/agw/article/new?format=html"));
    const draft = routeFor(request("POST", "https://mp.toutiao.com/mp/agw/draft/save"));
    const upload = routeFor(request("POST", "https://mp.toutiao.com/mp/agw/image/upload"));
    await guard.handle(first.route);
    await guard.handle(second.route);
    await guard.handle(draft.route);
    await guard.handle(upload.route);
    expect(first.continued).toHaveBeenCalledOnce();
    expect(second.aborted).toHaveBeenCalledOnce();
    expect(draft.aborted).toHaveBeenCalledOnce();
    expect(upload.aborted).toHaveBeenCalledOnce();
    expect(guard.evidence()).toMatchObject({ articleNewSentCount: 1, articleNewBlockedCount: 1,
      draftSentCount: 0, uploadSentCount: 0, publishSentCount: 0 });
  });

  it("never lets an unknown POST or a mismatched publish host through", async () => {
    const guard = createControlledPublishCaptureGuard();
    const unknown = routeFor(request("POST", "https://mp.toutiao.com/mp/agw/unknown"));
    const external = routeFor(request("POST", "https://example.invalid/mp/agw/article/publish"));
    await guard.handle(unknown.route);
    await guard.handle(external.route);
    expect(unknown.aborted).toHaveBeenCalledOnce();
    expect(external.aborted).toHaveBeenCalledOnce();
    expect(guard.evidence().publishRequest).toBeNull();
  });

  it("installs the guard before opening the editor and stops after one blocked publish attempt", async () => {
    let guard: ((route: Route) => Promise<void>) | undefined;
    let onResponse: ((response: Response) => void) | undefined;
    const steps: string[] = [];
    const context = { serviceWorkers: () => [], route: vi.fn(async (_: string, callback: (route: Route) => Promise<void>) => { guard = callback; steps.push("guard"); }),
      unroute: vi.fn(async () => undefined), on: vi.fn((_event: string, callback: (response: Response) => void) => { onResponse = callback; }),
      off: vi.fn(), newPage: vi.fn(async () => editor) } as unknown as BrowserContext;
    const dispatch = async (method: string, url: string, body: unknown = {}): Promise<void> => {
      const item = request(method, url);
      const route = routeFor(item);
      await guard?.(route.route);
      if (vi.mocked(route.continued).mock.calls.length) onResponse?.({ request: () => item, status: () => 200,
        allHeaders: async () => ({ "content-type": "application/json" }), json: async () => body } as unknown as Response);
    };
    const home = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/index",
      reload: vi.fn(async () => { steps.push("home-auth"); await dispatch("GET", "https://mp.toutiao.com/mp/agw/media/user_login_status_api", { code: 0, data: { is_login: true } }); }),
      waitForTimeout: vi.fn(async () => undefined) } as unknown as Page;
    const editor = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/graphic/publish",
      goto: vi.fn(async () => { steps.push("editor"); await dispatch("GET", "https://mp.toutiao.com/mp/agw/article/new", { code: 0, data: { media_id: "secret" } }); }),
      close: vi.fn(async () => undefined), waitForTimeout: vi.fn(async () => undefined) } as unknown as Page;
    const result = await runControlledToutiaoPublishCapture(context, home, async (_page, marks) => {
      steps.push("action"); marks.contentFilled(); marks.buttonTriggered();
      await dispatch("POST", "https://mp.toutiao.com/mp/agw/article/publish?a_bogus=secret");
    });
    expect(steps).toEqual(["guard", "home-auth", "editor", "action"]);
    expect(result).toMatchObject({ status: "REQUEST_CAPTURED", remoteAuthState: "VALID", contentFilled: true, buttonTriggered: true,
      guard: { articleNewSentCount: 1, publishAttemptCount: 1, blockedPublishCount: 1, publishSentCount: 0 } });
    expect(JSON.stringify(result)).not.toMatch(/secret/u);
  });

  it("does not fill or click if article/new exposes an article identifier", async () => {
    let guard: ((route: Route) => Promise<void>) | undefined;
    let onResponse: ((response: Response) => void) | undefined;
    const context = { serviceWorkers: () => [], route: vi.fn(async (_: string, callback: (route: Route) => Promise<void>) => { guard = callback; }),
      unroute: vi.fn(async () => undefined), on: vi.fn((_event: string, callback: (response: Response) => void) => { onResponse = callback; }),
      off: vi.fn(), newPage: vi.fn(async () => editor) } as unknown as BrowserContext;
    const dispatch = async (url: string, body: unknown): Promise<void> => {
      const item = request("GET", url);
      await guard?.(routeFor(item).route);
      onResponse?.({ request: () => item, status: () => 200, allHeaders: async () => ({ "content-type": "application/json" }), json: async () => body } as unknown as Response);
    };
    const home = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/index",
      reload: vi.fn(async () => dispatch("https://mp.toutiao.com/mp/agw/media/user_login_status_api", { code: 0, data: { is_login: true } })),
      waitForTimeout: vi.fn(async () => undefined) } as unknown as Page;
    const editor = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/graphic/publish",
      goto: vi.fn(async () => dispatch("https://mp.toutiao.com/mp/agw/article/new", { code: 0, data: { pgc_id: "secret" } })),
      close: vi.fn(async () => undefined), waitForTimeout: vi.fn(async () => undefined) } as unknown as Page;
    const action = vi.fn(async () => undefined);
    const result = await runControlledToutiaoPublishCapture(context, home, action);
    expect(result.status).toBe("REMOTE_ARTICLE_OBJECT_DETECTED");
    expect(action).not.toHaveBeenCalled();
  });
});
