import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KangyiWebsiteAdapter } from "./index";

const enabled = process.env.KANGYI_STAGING_INTEGRATION === "1";

describe("Kangyi staging read-only integration", () => {
  it.skipIf(!enabled)("verifies capabilities through the GEO Website Adapter path", async () => {
    const secretFile = process.env.CMS_PUBLISH_SECRET_FILE;
    const origin = process.env.CMS_PUBLISH_ORIGIN;
    const siteId = process.env.CMS_PUBLISH_SITE_ID;
    const environment = process.env.CMS_PUBLISH_ENVIRONMENT;
    const keyId = process.env.CMS_PUBLISH_KEY_ID;
    if (!secretFile || !origin || !siteId || !environment || !keyId) throw new Error("Kangyi staging integration environment is incomplete");
    const secret = readFileSync(secretFile, "utf8");
    const adapter = new KangyiWebsiteAdapter();
    const remote = await adapter.readRemoteCapabilities({ accountId: "staging-acceptance", accountName: "Kangyi staging", platformKey: "kangyi_website", settings: {}, secrets: { origin, siteId, environment, keyId, secret } });
    expect(remote).toMatchObject({ siteId: "kangyi", environment: "staging", protocolVersion: "2", writesEnabled: true });
    expect(remote.contentKinds).toEqual(expect.arrayContaining(["article", "case"]));
  });
});
