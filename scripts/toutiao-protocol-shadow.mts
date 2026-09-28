import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafeProtocolFixture, protocolShadowEnabled, UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE, AUTHORIZED_TOUTIAO_PROTOCOL_PROFILE_20260924 } from "@publisher/adapters-toutiao/article-api";

const fixtureFlag = process.argv.indexOf("--fixture");
if (fixtureFlag >= 0) {
  const fileName = process.argv[fixtureFlag + 1];
  if (!fileName || !/^[a-z0-9][a-z0-9-]*\.json$/u.test(fileName)) throw new Error("A fixture filename within tests/fixtures/toutiao/protocol is required");
  const fixture = assertSafeProtocolFixture(JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "toutiao", "protocol", fileName), "utf8")) as unknown);
  console.log(JSON.stringify({ mode: "OFFLINE_FIXTURE", source: fixture.source, status: fixture.source === "MOCK_FIXTURE" ? "MOCK_ONLY" : "SANITIZED_CAPTURE_ONLY",
    endpointPath: fixture.endpointPath, method: fixture.method, httpStatus: fixture.status, responseKeyShape: fixture.responseKeyShape,
    cookies: fixture.cookies.map(({ name, domain }) => ({ name, domain })),
    tokens: Object.fromEntries(Object.entries(fixture.tokens).map(([name, evidence]) => [name, evidence.present ? "PRESENT" : "ABSENT"])),
    protocolProfile: fixture.source === "AUTHORIZED_SHADOW_CAPTURE" ? AUTHORIZED_TOUTIAO_PROTOCOL_PROFILE_20260924.version : UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE.version,
    signerPath: "BLOCKED" }));
} else {
  console.log(JSON.stringify({ mode: "LIVE_SHADOW", status: protocolShadowEnabled(process.env) ? "BLOCKED_SESSION_NOT_ATTACHED" : "SHADOW_DISABLED",
    protocolProfile: UNVERIFIED_TOUTIAO_PROTOCOL_PROFILE.version, signerPath: "BLOCKED" }));
}
