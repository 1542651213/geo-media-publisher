import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeProtocolFixture, protocolShadowEnabled } from "./protocol-fixture";

const fixturePath = join(process.cwd(), "tests", "fixtures", "toutiao", "protocol", "mock-login-valid.json");
const invalidFixturePath = join(process.cwd(), "tests", "fixtures", "toutiao", "protocol", "mock-login-invalid.json");

describe("Toutiao protocol fixture boundary", () => {
  it("loads a clearly marked mock shape without claiming real protocol verification", () => {
    const fixture = assertSafeProtocolFixture(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
    expect(fixture.source).toBe("MOCK_FIXTURE");
    expect(fixture.responseShapeVersion).toBe("mock-unverified-v1");
    expect(fixture.secretsRedacted).toBe(true);
    expect(fixture.tokens.csrf.present).toBe(false);
    const invalid = assertSafeProtocolFixture(JSON.parse(readFileSync(invalidFixturePath, "utf8")) as unknown);
    expect(invalid.source).toBe("MOCK_FIXTURE");
    expect(invalid.status).toBe(401);
  });

  it("refuses extra fields and raw response data even when a fixture claims redaction", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    expect(() => assertSafeProtocolFixture({ ...fixture, rawCookie: "fixture-secret" })).toThrow();
    expect(() => assertSafeProtocolFixture({ ...fixture, responseBody: { token: "fixture-secret" } })).toThrow();
    expect(() => assertSafeProtocolFixture({ ...fixture, endpointPath: "/mp/agw/article/publish" })).toThrow();
    expect(() => assertSafeProtocolFixture({ ...fixture, source: "REAL_PROTOCOL_FIXTURE" })).toThrow();
  });

  it("keeps live Shadow disabled unless explicitly enabled", () => {
    expect(protocolShadowEnabled({})).toBe(false);
    expect(protocolShadowEnabled({ TOUTIAO_PROTOCOL_SHADOW_ENABLED: "false" })).toBe(false);
    expect(protocolShadowEnabled({ TOUTIAO_PROTOCOL_SHADOW_ENABLED: "true" })).toBe(true);
  });

  it("accepts safe structural paths for nested response arrays", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    expect(assertSafeProtocolFixture({ ...fixture, responseKeyShape: ["data.rows[][].id"] }).responseKeyShape).toEqual(["data.rows[][].id"]);
  });

  it("keeps authorized Shadow fixtures separate from mock fixtures and free of replayable secrets", () => {
    for (const fileName of ["authorized-20260924-creator-login-valid.json", "authorized-20260924-anti-token.json",
      "authorized-20260924-mssdk-token-bootstrap.json", "authorized-20260924-csrf-header.json"]) {
      const text = readFileSync(join(process.cwd(), "tests", "fixtures", "toutiao", "protocol", fileName), "utf8");
      const fixture = assertSafeProtocolFixture(JSON.parse(text) as unknown);
      expect(fixture.source).toBe("AUTHORIZED_SHADOW_CAPTURE");
      expect(fixture.secretsRedacted).toBe(true);
      expect(text).not.toMatch(/"(?:value|requestBody|responseBody|rawCookie|rawToken|signature)"\s*:/iu);
      expect(text).not.toMatch(/(?:sessionid|msToken|a_bogus|tt-anti-token|x-secsdk-csrf-token)=/iu);
    }
  });

  it("stores only an observed, versioned and secret-free protocol profile", () => {
    const text = readFileSync(join(process.cwd(), "tests", "fixtures", "toutiao", "protocol", "authorized-20260924-profile.json"), "utf8");
    const profile = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(profile).sort()).toEqual(["source", "secretsRedacted", "profileVersion", "capturedAt", "creatorHost", "authStrategy",
      "csrfStrategy", "antiTokenStrategy", "msTokenStrategy", "signerStrategy", "tokenLifetimes"].sort());
    expect(profile).toMatchObject({ source: "AUTHORIZED_SHADOW_CAPTURE", secretsRedacted: true,
      authStrategy: { endpointPath: "/mp/agw/media/user_login_status_api", invalidShape: "NOT_CAPTURED" },
      signerStrategy: { productionPath: "BLOCKED" } });
    expect(text).not.toMatch(/"(?:cookieValue|tokenValue|signatureValue|storageState|phone|email)"\s*:/iu);
  });
});
