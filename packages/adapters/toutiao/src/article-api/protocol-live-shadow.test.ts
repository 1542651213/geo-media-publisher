import type { BrowserContext, Page, Request, Response, Route } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { classifyCreatorSessionBody, classifyShadowRequest, isSafeCreatorHomePath, readBoundedResponseJson, runReadOnlyToutiaoProtocolShadow } from "./protocol-live-shadow";

describe("Toutiao live Shadow network guard", () => {
  it("allows only read methods for ordinary endpoints", () => {
    expect(classifyShadowRequest("GET", "https://mp.toutiao.com/profile_v4/index")).toBe("READ_ONLY");
    expect(classifyShadowRequest("OPTIONS", "https://mp.toutiao.com/mp/agw/creator_center/item/list")).toBe("READ_ONLY");
    expect(classifyShadowRequest("POST", "https://mp.toutiao.com/mp/agw/unknown")).toBe("DENY_UNKNOWN_MUTATION");
  });

  it("blocks every content write and article/new even as GET", () => {
    for (const path of ["/mp/agw/article/new", "/mp/agw/article/publish", "/mp/agw/article/save", "/draft/create", "/media/create", "/image/upload", "/schedule", "/article%2Fpublish", "/settings/update", "/settings/save"]) {
      expect(classifyShadowRequest("GET", `https://mp.toutiao.com${path}`)).toMatch(/^DENY_/u);
      expect(classifyShadowRequest("POST", `https://mp.toutiao.com${path}`)).toMatch(/^DENY_/u);
    }
    expect(classifyShadowRequest("GET", "https://mp.toutiao.com/mp/agw/deliver?action=delete")).toBe("DENY_CONTENT_MUTATION");
  });

  it("recognizes only narrowly allowlisted non-content telemetry", () => {
    expect(classifyShadowRequest("POST", "https://mon.zijieapi.com/log/v2?x=secret")).toBe("NON_CONTENT_TELEMETRY");
    expect(classifyShadowRequest("POST", "https://mp.toutiao.com/log/v2")).toBe("DENY_UNKNOWN_MUTATION");
    expect(classifyShadowRequest("POST", "https://mon.zijieapi.com/article/publish")).toBe("DENY_CONTENT_MUTATION");
  });

  it("allows only exact mssdk token bootstrap POST paths", () => {
    expect(classifyShadowRequest("POST", "https://mssdk.bytedance.com/web/r/token")).toBe("AUTH_TOKEN_BOOTSTRAP");
    expect(classifyShadowRequest("POST", "https://mssdk.bytedance.com/web/common")).toBe("AUTH_TOKEN_BOOTSTRAP");
    expect(classifyShadowRequest("POST", "https://mssdk.bytedance.com/web/other")).toBe("DENY_UNKNOWN_MUTATION");
  });

  it("maps explicit current Creator login response without treating malformed data as invalid", () => {
    expect(classifyCreatorSessionBody({ code: 0, data: { is_login: true } })).toBe("VALID");
    expect(classifyCreatorSessionBody({ code: 0, data: { is_login: false } })).toBe("INVALID");
    expect(classifyCreatorSessionBody({ code: 500, data: { is_login: true } })).toBe("UNKNOWN");
    expect(classifyCreatorSessionBody({ data: {} })).toBe("UNKNOWN");
  });

  it("denies malformed, non-https, and unknown mutating requests", () => {
    expect(classifyShadowRequest("POST", "https://unknown.invalid/collect")).toBe("DENY_UNKNOWN_MUTATION");
    expect(classifyShadowRequest("PUT", "https://mp.toutiao.com/anything")).toBe("DENY_UNKNOWN_MUTATION");
    expect(classifyShadowRequest("GET", "http://mp.toutiao.com/profile_v4/index")).toBe("DENY_UNSAFE_URL");
    expect(classifyShadowRequest("GET", "not a url")).toBe("DENY_UNSAFE_URL");
  });

  it("skips streams and bounds responses that never finish", async () => {
    const response = { json: vi.fn(() => new Promise<unknown>(() => undefined)) } as unknown as Response;
    expect(await readBoundedResponseJson(response, { "content-type": "text/event-stream" }, 5)).toEqual({});
    expect(response.json).not.toHaveBeenCalled();
    expect(await readBoundedResponseJson(response, { "content-type": "text/plain" }, 5)).toEqual({});
    expect(response.json).toHaveBeenCalledTimes(1);
  });

  it("installs the guard before reload and returns only sanitized owned-page evidence", async () => {
    const sequence: string[] = [];
    let handler: ((route: Route) => Promise<void>) | null = null;
    let onResponse: ((response: Response) => void) | null = null;
    const context = {
      serviceWorkers: () => [],
      route: vi.fn(async (_pattern: string, callback: (route: Route) => Promise<void>) => { sequence.push("guard"); handler = callback; }),
      on: vi.fn((_event: string, callback: (response: Response) => void) => { sequence.push("listener"); onResponse = callback; }),
      off: vi.fn(), unroute: vi.fn(async () => undefined),
      cookies: vi.fn(async () => [{ name: "sessionid", value: "cookie-secret", domain: ".toutiao.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }])
    } as unknown as BrowserContext;
    const dispatch = async (method: string, url: string): Promise<{ continued: number; aborted: number }> => {
      let continued = 0;
      let aborted = 0;
      const request = { method: () => method, url: () => url, allHeaders: async () => ({ cookie: "cookie-secret" }) } as unknown as Request;
      const route = { request: () => request, continue: async () => { continued += 1; }, abort: async () => { aborted += 1; } } as unknown as Route;
      if (!handler) throw new Error("guard missing");
      await handler(route);
      if (continued && onResponse) onResponse({ request: () => request, status: () => 200,
        allHeaders: async () => ({ "content-type": "text/plain", "x-secsdk-csrf-token": "csrf-secret" }),
        json: async () => ({ data: { loggedIn: true, token: "body-secret" } }) } as unknown as Response);
      return { continued, aborted };
    };
    const page = {
      isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/index",
      evaluate: vi.fn(async () => []), waitForTimeout: vi.fn(async () => undefined),
      reload: vi.fn(async () => {
        sequence.push("reload");
        expect(await dispatch("POST", "https://mp.toutiao.com/mp/agw/article/publish")).toEqual({ continued: 0, aborted: 1 });
        expect(await dispatch("GET", "https://mp.toutiao.com/safe/session?msToken=query-secret")).toEqual({ continued: 1, aborted: 0 });
      })
    } as unknown as Page;
    const result = await runReadOnlyToutiaoProtocolShadow(context, page);
    expect(sequence).toEqual(["guard", "listener", "reload"]);
    expect(result.blockedContentMutationCount).toBe(1);
    expect(result.blockedRequestShapes).toEqual([{ method: "POST", host: "mp.toutiao.com", path: "/mp/agw/article/publish", category: "DENY_CONTENT_MUTATION" }]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.tokens.csrf.present).toBe(true);
    expect(result.observations[0]?.responseKeyShape).toContain("data.loggedIn");
    expect(result.observations[0]?.queryParameterNames).toEqual(["msToken"]);
    expect(JSON.stringify(result)).not.toMatch(/cookie-secret|csrf-secret|query-secret|body-secret/u);
  });

  it("allows only the exact editor document route while blocking article/new", () => {
    expect(classifyShadowRequest("GET", "https://mp.toutiao.com/profile_v4/graphic/publish")).toBe("READ_ONLY");
    expect(classifyShadowRequest("GET", "https://mp.toutiao.com/profile_v4/graphic/publish?draft=1")).toBe("DENY_CONTENT_MUTATION");
    expect(classifyShadowRequest("POST", "https://mp.toutiao.com/profile_v4/graphic/publish")).toBe("DENY_CONTENT_MUTATION");
    expect(classifyShadowRequest("GET", "https://mp.toutiao.com/mp/agw/article/new")).toBe("DENY_ARTICLE_NEW");
  });

  it("requires a canonical Creator home path and rejects same-host login pages", () => {
    expect(isSafeCreatorHomePath("/")).toBe(true);
    expect(isSafeCreatorHomePath("/profile_v4/")).toBe(true);
    expect(isSafeCreatorHomePath("/profile_v4/index")).toBe(true);
    expect(isSafeCreatorHomePath("/auth/login")).toBe(false);
    expect(isSafeCreatorHomePath("/profile_v4/graphic/publish")).toBe(false);
  });

  it("captures only hashed script metadata after installing the guard", async () => {
    let guard: ((route: Route) => Promise<void>) | undefined;
    let listener: ((response: Response) => void) | undefined;
    const context = {
      serviceWorkers: () => [], route: async (_: string, callback: (route: Route) => Promise<void>) => { guard = callback; },
      on: (_: string, callback: (response: Response) => void) => { listener = callback; },
      off: vi.fn(), unroute: vi.fn(async () => undefined), cookies: vi.fn(async () => [])
    } as unknown as BrowserContext;
    const page = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/index",
      evaluate: vi.fn(async () => []), waitForTimeout: vi.fn(async () => undefined),
      reload: vi.fn(async () => {
        const request = { method: () => "GET", url: () => "https://mp.toutiao.com/static/app.js?token=secret", allHeaders: async () => ({}) } as unknown as Request;
        const route = { request: () => request, continue: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) } as unknown as Route;
        await guard?.(route);
        listener?.({ request: () => request, status: () => 200, allHeaders: async () => ({ "content-type": "application/javascript" }),
          body: async () => new TextEncoder().encode('const key="a_bogus"; const marker="/mp/agw/article/publish";') } as unknown as Response);
      }) } as unknown as Page;
    const result = await runReadOnlyToutiaoProtocolShadow(context, page);
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0]?.keywordOffsets.a_bogus).toHaveLength(1);
    expect(result.scripts[0]?.keywordOffsets["/mp/agw/article/publish"]).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/token=secret|const key=/u);
  });

  it("opens a separate guarded editor page and leaves the canonical home page untouched", async () => {
    let guard: ((route: Route) => Promise<void>) | undefined;
    const context = { serviceWorkers: () => [], route: async (_: string, callback: (route: Route) => Promise<void>) => { guard = callback; },
      on: vi.fn(), off: vi.fn(), unroute: vi.fn(async () => undefined), cookies: vi.fn(async () => []),
      newPage: vi.fn(async () => editorPage) } as unknown as BrowserContext;
    const home = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/index",
      evaluate: vi.fn(async () => []), reload: vi.fn() } as unknown as Page;
    const editorPage = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/graphic/publish",
      evaluate: vi.fn(async () => []), waitForTimeout: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      goto: vi.fn(async () => {
        const request = { method: () => "GET", url: () => "https://mp.toutiao.com/mp/agw/article/new" } as unknown as Request;
        const route = { request: () => request, continue: vi.fn(), abort: vi.fn(async () => undefined) } as unknown as Route;
        await guard?.(route);
        expect(route.abort).toHaveBeenCalledOnce();
      }) } as unknown as Page;
    const result = await runReadOnlyToutiaoProtocolShadow(context, home, { mode: "EDITOR" });
    expect(home.reload).not.toHaveBeenCalled();
    expect(context.newPage).toHaveBeenCalledOnce();
    expect(editorPage.goto).toHaveBeenCalledWith("https://mp.toutiao.com/profile_v4/graphic/publish", expect.any(Object));
    expect(editorPage.close).toHaveBeenCalledOnce();
    expect(result.blockedArticleNewCount).toBe(1);
  });

  it("invokes the contract probe only after installing the editor write guard", async () => {
    let guardInstalled = false;
    const context = { serviceWorkers: () => [], route: vi.fn(async () => { guardInstalled = true; }),
      unroute: vi.fn(async () => undefined), on: vi.fn(), off: vi.fn(), cookies: vi.fn(async () => []),
      newPage: vi.fn(async () => editorPage) } as unknown as BrowserContext;
    const home = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/index",
      evaluate: vi.fn(async () => []), reload: vi.fn() } as unknown as Page;
    const contract = { exists: true, signExists: true, initExists: true, objectKeys: ["sign"], signName: "sign",
      signLength: 1, signSourceLength: 20, signSourceSha256: "hash", probes: [] };
    const editorPage = { isClosed: () => false, context: () => context, url: () => "https://mp.toutiao.com/profile_v4/graphic/publish",
      goto: vi.fn(async () => undefined), waitForTimeout: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      evaluate: vi.fn(async (fn: () => unknown) => {
        if (fn.name === "probeAcrCrawlerSignInPage") {
          expect(guardInstalled).toBe(true);
          return contract;
        }
        return [];
      }) } as unknown as Page;
    const result = await runReadOnlyToutiaoProtocolShadow(context, home, { mode: "SIGNER_CONTRACT" });
    expect(result.signerContract).toEqual(contract);
    expect(result.signerProbeNetworkRequestDelta).toBe(0);
    expect(home.reload).not.toHaveBeenCalled();
    expect(editorPage.close).toHaveBeenCalledOnce();
    expect(context.unroute).toHaveBeenCalledOnce();
  });
});
