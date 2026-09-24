import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureSafeProtocolObservation, describeShadowReadiness, UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE } from "./protocol-shadow";

describe("Toutiao protocol shadow diagnostics", () => {
  it("keeps all unobserved token and signer requirements unknown", () => {
    expect(UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE.provenance).toBe("UNVERIFIED");
    expect(UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE.signerStrategy).toBe("BLOCKED");
    expect(Object.values(UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE.tokens).every((token) => token.requirement === "UNKNOWN" && token.lifetime === "UNKNOWN")).toBe(true);
    expect(describeShadowReadiness(false, "VALID")).toBe("SHADOW_DISABLED");
    expect(describeShadowReadiness(true, "EXPIRED")).toBe("BLOCKED_NO_AUTHORIZED_SESSION");
  });

  it("keeps only structural observations and irreversible token fingerprints", () => {
    const observed = captureSafeProtocolObservation({ source: "MOCK_FIXTURE", capturedAt: "2026-09-24T03:00:00.000Z",
      url: "https://mp.toutiao.com/safe/bootstrap?msToken=query-secret&foo=bar", method: "GET", status: 200,
      requestHeaders: { Cookie: "sessionid=cookie-secret", Authorization: "Bearer auth-secret" },
      responseHeaders: { "x-secsdk-csrf-token": "csrf-secret", "Set-Cookie": "sessionid=set-cookie-secret" },
      responseBody: { data: { loggedIn: true, token: "body-secret", rows: [{ id: 123, name: "private-name" }] } },
      cookies: [{ name: "sessionid", value: "cookie-secret", domain: ".toutiao.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }],
      tokenCandidates: { csrf: "csrf-secret", antiToken: null, msToken: "ms-secret", aBogus: null } });
    expect(observed).toMatchObject({ source: "MOCK_FIXTURE", endpointPath: "/safe/bootstrap", method: "GET", status: 200,
      queryParameterNames: ["foo", "msToken"], requestHeaderNames: ["authorization", "cookie"],
      responseHeaderNames: ["set-cookie", "x-secsdk-csrf-token"],
      cookies: [{ name: "sessionid", domain: ".toutiao.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }],
      tokens: { csrf: { present: true, length: 11, sha256: createHash("sha256").update("csrf-secret").digest("hex") }, antiToken: { present: false } } });
    expect(observed.responseKeyShape).toEqual(["data", "data.loggedIn", "data.token", "data.rows", "data.rows[].id", "data.rows[].name"]);
    const serialized = JSON.stringify(observed);
    for (const secret of ["query-secret", "bar", "cookie-secret", "auth-secret", "csrf-secret", "set-cookie-secret", "body-secret", "private-name", "ms-secret"]) expect(serialized).not.toContain(secret);
  });

  it("rejects unsafe requests before recording anything", () => {
    const base = { source: "MOCK_FIXTURE" as const, capturedAt: "2026-09-24T03:00:00.000Z", url: "https://mp.toutiao.com/safe/bootstrap",
      method: "GET", status: 200, requestHeaders: {}, responseHeaders: {}, responseBody: {}, cookies: [], tokenCandidates: {} };
    expect(() => captureSafeProtocolObservation({ ...base, url: "https://mp.toutiao.com/mp/agw/article/new" })).toThrow();
    expect(() => captureSafeProtocolObservation({ ...base, url: "https://mp.toutiao.com/mp/agw/article/publish" })).toThrow();
    expect(() => captureSafeProtocolObservation({ ...base, url: "https://mp.toutiao.com/mp/agw/article%2Fpublish" })).toThrow();
    expect(() => captureSafeProtocolObservation({ ...base, url: "https://mp.toutiao.com/mp/agw/article/save" })).toThrow();
    expect(() => captureSafeProtocolObservation({ ...base, method: "POST" })).toThrow();
    expect(() => captureSafeProtocolObservation({ ...base, url: "https://example.invalid/safe/bootstrap" })).toThrow();
    const malformedCookie = captureSafeProtocolObservation({ ...base, cookies: [{ name: "sessionid", value: "cookie-secret", domain: ".toutiao.com",
      path: "/private/1234567890", secure: true, httpOnly: true, sameSite: "cookie-secret" }] });
    expect(JSON.stringify(malformedCookie)).not.toContain("cookie-secret");
    expect(JSON.stringify(malformedCookie)).not.toContain("1234567890");
  });
});
