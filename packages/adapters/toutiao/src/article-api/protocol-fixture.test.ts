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
});
