import { describe, expect, it, vi } from "vitest";
import { describeReadonlyBrowserRequest, replayCapturedReadonlyGet } from "./protocol-request-bridge";

describe("Toutiao diagnostic Browser request bridge", () => {
  const request = { method: "GET", url: "https://mp.toutiao.com/mp/agw/media/user_login_status_api?msToken=query-secret",
    headers: { cookie: "cookie-secret", "x-secsdk-csrf-token": "csrf-secret", accept: "application/json" } } as const;

  it("returns only a safe request shape for GET and OPTIONS", () => {
    const shape = describeReadonlyBrowserRequest(request);
    expect(shape).toEqual({ method: "GET", host: "mp.toutiao.com", path: "/mp/agw/media/user_login_status_api",
      queryParameterNames: ["msToken"], headerNames: ["accept", "cookie", "x-secsdk-csrf-token"],
      bodyKeyNames: [], bodySha256: null, signedParameterNames: [] });
    expect(describeReadonlyBrowserRequest({ ...request, method: "OPTIONS" })?.method).toBe("OPTIONS");
    expect(JSON.stringify(shape)).not.toMatch(/query-secret|cookie-secret|csrf-secret/u);
  });

  it("replays only the allowlisted GET in memory and compares auth response shapes", async () => {
    const transport = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ code: 0, data: { is_login: true, user_secret: "private" } }),
      { status: 200, headers: { "content-type": "application/json" } }));
    const result = await replayCapturedReadonlyGet(request, { status: 200, authState: "VALID" }, transport);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toBe(request.url);
    expect(result).toMatchObject({ attempted: true, nodeStatus: 200, browserStatus: 200, nodeAuthState: "VALID", browserAuthState: "VALID", authStatesMatch: true });
    expect(result.responseKeyShape).toContain("data.is_login");
    expect(JSON.stringify(result)).not.toMatch(/query-secret|cookie-secret|csrf-secret|private/u);
  });

  it("refuses POST, content endpoints, and redirects without exposing inputs", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.com" } }));
    for (const candidate of [
      { ...request, method: "POST" },
      { ...request, url: "https://mp.toutiao.com/mp/agw/article/new" },
      { ...request, url: "https://mp.toutiao.com/mp/agw/article/publish" },
      { ...request, url: "https://other.example/mp/agw/media/user_login_status_api" }
    ]) {
      const result = await replayCapturedReadonlyGet(candidate, { status: 200, authState: "VALID" }, transport);
      expect(result.attempted).toBe(false);
    }
    expect(transport).not.toHaveBeenCalled();
    const redirect = await replayCapturedReadonlyGet(request, { status: 200, authState: "VALID" }, transport);
    expect(redirect.reasonCode).toBe("REDIRECT_NOT_FOLLOWED");
    expect(JSON.stringify(redirect)).not.toContain("example.com");
  });

  it("sanitizes transport errors", async () => {
    const result = await replayCapturedReadonlyGet(request, { status: 200, authState: "VALID" }, async () => { throw new Error("cookie-secret csrf-secret"); });
    expect(result.reasonCode).toBe("TRANSPORT_ERROR");
    expect(JSON.stringify(result)).not.toContain("cookie-secret");
  });

  it("accepts JSON carried as text/plain without exposing the response body", async () => {
    const result = await replayCapturedReadonlyGet(request, { status: 200, authState: "VALID" }, async () =>
      new Response(JSON.stringify({ code: 0, data: { is_login: true, secret: "private" } }),
        { status: 200, headers: { "content-type": "text/plain;charset=UTF-8" } }));
    expect(result).toMatchObject({ reasonCode: "OK", nodeAuthState: "VALID", authStatesMatch: true, nodeMediaType: "TEXT_PLAIN" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
