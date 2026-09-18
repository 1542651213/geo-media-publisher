import { createHash, randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { authorizeXhsMax3Config, parseXhsMax3Config, readXhsMax3Gate } from "../apps/desktop/src/main/xhs-max3-config";

const root = "C:/public-export-fixtures/xhs-max3/run";
const configPath = `${root}/config.json`;
const authorization = "local-test-authorization";
const config = {
  version: 1,
  campaignId: "PUBLIC_EXPORT_XHS_MAX3",
  runDirectory: root,
  executablePath: "C:/public-export-fixtures/xhs-max3/package/Geo Media Publisher.exe",
  executableSha256: "a".repeat(64),
  appAsarPath: "C:/public-export-fixtures/xhs-max3/package/resources/app.asar",
  appAsarSha256: "b".repeat(64),
  manifestPath: `${root}/approved-content.json`,
  manifestSha256: "c".repeat(64),
  authorizationSha256: createHash("sha256").update(authorization).digest("hex"),
  covers: [1, 2, 3].map((number) => ({ slot: `XHS-0${number}`, sha256: "d".repeat(64) })),
  accountId: randomUUID(),
  creatorId: "123456789",
  expiresAtUtc: "2027-01-01T00:00:00Z"
};

describe("scoped live config", () => {
  it("requires an external configuration and authorization", () => {
    expect(readXhsMax3Gate({})).toBeNull();
    expect(() => readXhsMax3Gate({ GEO_XHS_MAX3: authorization })).toThrow();
    expect(() => readXhsMax3Gate({ GEO_XHS_MAX3: authorization, GEO_XHS_MAX3_CONFIG: "relative.json" })).toThrow();
    expect(readXhsMax3Gate({ GEO_XHS_MAX3: authorization, GEO_XHS_MAX3_CONFIG: configPath })).toBe(win32.resolve(configPath));
  });

  it("pins the isolated control tree, package layout, and authorization", () => {
    const parsed = parseXhsMax3Config(config, configPath);
    expect(parsed).toMatchObject({ campaignId: config.campaignId, accountId: config.accountId });
    expect(() => authorizeXhsMax3Config(parsed, "wrong")).toThrow();
    expect(() => authorizeXhsMax3Config(parsed, authorization)).not.toThrow();
    expect(() => parseXhsMax3Config({ ...config, runDirectory: "C:/Users/Public" }, configPath)).toThrow();
    expect(() => parseXhsMax3Config({ ...config, manifestPath: "C:/outside/approved.json" }, configPath)).toThrow();
    expect(() => parseXhsMax3Config({ ...config, executablePath: `${root}/candidate.exe` }, configPath)).toThrow();
    expect(() => parseXhsMax3Config({ ...config, accountId: "other" }, configPath)).toThrow();
  });
});
