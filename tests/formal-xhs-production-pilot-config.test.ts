import { describe, expect, it } from "vitest";
import { FORMAL_XHS_PRODUCTION_PILOT_ID, FORMAL_XHS_UNTIL_REVOKED_PILOT_ID, FORMAL_XHS_UNTIL_REVOKED_PILOT_GATE, FORMAL_XHS_UNTIL_REVOKED_STORAGE_EXPIRY_UTC, parseFormalXhsProductionPilotConfig, readFormalXhsProductionPilotGate } from "../apps/desktop/src/main/formal-xhs-production-pilot-config";

const sha = "a".repeat(64);

describe("formal XHS production-pilot config", () => {
  it("requires an explicit dual gate and pins this task's finite authorization", () => {
    expect(readFormalXhsProductionPilotGate({})).toBeNull();
    expect(() => readFormalXhsProductionPilotGate({ GEO_XHS_PRODUCTION_PILOT: "OWNER_AUTHORIZED_PRODUCTION_PILOT_MAX3_20260918" })).toThrow("FORMAL_XHS_PRODUCTION_PILOT_DUAL_GATE_REQUIRED");
    expect(readFormalXhsProductionPilotGate({ GEO_XHS_PRODUCTION_PILOT: "OWNER_AUTHORIZED_PRODUCTION_PILOT_MAX3_20260918", GEO_XHS_PRODUCTION_PILOT_CONFIG: "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data/production-pilot-control/config.json" })).toMatch(/config\.json$/u);
    expect(() => parseFormalXhsProductionPilotConfig({ version: 1, pilotId: "other", expiresAtUtc: "2026-09-18T14:59:59Z", maxFinalSubmissions: 3, executablePath: "C:/GMP/Geo Media Publisher.exe", executableSha256: sha, appAsarPath: "C:/GMP/resources/app.asar", appAsarSha256: sha })).toThrow();
  });

  it("accepts only the ordinary-XHS max-three definition and normalizes its package hashes", () => {
    const config = parseFormalXhsProductionPilotConfig({
      version: 1,
      pilotId: FORMAL_XHS_PRODUCTION_PILOT_ID,
      expiresAtUtc: "2026-09-18T14:59:59Z",
      maxFinalSubmissions: 3,
      executablePath: "C:/GMP/Geo Media Publisher.exe",
      executableSha256: sha.toUpperCase(),
      appAsarPath: "C:/GMP/resources/app.asar",
      appAsarSha256: sha.toUpperCase()
    });
    expect(config).toMatchObject({ pilotId: FORMAL_XHS_PRODUCTION_PILOT_ID, maxFinalSubmissions: 3, executableSha256: sha, appAsarSha256: sha });
  });

  it("accepts one until-revoked authorization and rejects any broader substitute", () => {
    const common = { version: 1, pilotId: FORMAL_XHS_UNTIL_REVOKED_PILOT_ID, expiresAtUtc: FORMAL_XHS_UNTIL_REVOKED_STORAGE_EXPIRY_UTC, maxFinalSubmissions: 1, authorizationMode: "UNTIL_REVOKED", executablePath: "C:/GMP/Geo Media Publisher.exe", executableSha256: sha, appAsarPath: "C:/GMP/resources/app.asar", appAsarSha256: sha } as const;
    expect(parseFormalXhsProductionPilotConfig(common)).toMatchObject({ pilotId: FORMAL_XHS_UNTIL_REVOKED_PILOT_ID, maxFinalSubmissions: 1, authorizationMode: "UNTIL_REVOKED" });
    expect(readFormalXhsProductionPilotGate({ GEO_XHS_PRODUCTION_PILOT: FORMAL_XHS_UNTIL_REVOKED_PILOT_GATE, GEO_XHS_PRODUCTION_PILOT_CONFIG: "C:/control.json" })).toMatch(/control\.json$/u);
    expect(() => parseFormalXhsProductionPilotConfig({ ...common, maxFinalSubmissions: 3 })).toThrow("FORMAL_XHS_UNTIL_REVOKED_SINGLE_DEFINITION_MISMATCH");
    expect(() => parseFormalXhsProductionPilotConfig({ ...common, authorizationMode: undefined })).toThrow("FORMAL_XHS_UNTIL_REVOKED_SINGLE_DEFINITION_MISMATCH");
  });

  it("accepts the optional account binding used by the packaged formal runtime", () => {
    const config = parseFormalXhsProductionPilotConfig({
      version: 1,
      pilotId: FORMAL_XHS_PRODUCTION_PILOT_ID,
      expiresAtUtc: "2026-09-18T14:59:59Z",
      maxFinalSubmissions: 3,
      executablePath: "C:/GMP/Geo Media Publisher.exe",
      executableSha256: sha,
      appAsarPath: "C:/GMP/resources/app.asar",
      appAsarSha256: sha,
      xhsAccountId: "f7a9a5bd-91ba-4ee5-b1d4-8010f72cefa8"
    });
    expect(config.xhsAccountId).toBe("f7a9a5bd-91ba-4ee5-b1d4-8010f72cefa8");
  });

  it("accepts only one exact cross-brand image binding for the current ordinary article", () => {
    const config = parseFormalXhsProductionPilotConfig({
      version: 1,
      pilotId: FORMAL_XHS_PRODUCTION_PILOT_ID,
      expiresAtUtc: "2026-09-18T14:59:59Z",
      maxFinalSubmissions: 3,
      executablePath: "C:/GMP/Geo Media Publisher.exe",
      executableSha256: sha,
      appAsarPath: "C:/GMP/resources/app.asar",
      appAsarSha256: sha,
      crossBrandImageBindingAuthorization: {
        articleId: "5d310162-a5c9-4577-9ce5-e1ef81f08d65",
        articleBrandId: "9f9bf15e-7c06-401d-bac3-9ad6bc9ed8c0",
        imageAssetId: "a9de9c2f-44c1-4f9e-a3e6-192a4d73e3c2",
        imageBrandId: "f2485a75-2308-4f5c-bd2d-3c8ed61f0114",
        imageSha256: "b".repeat(64)
      }
    });
    expect(config.crossBrandImageBindingAuthorization).toMatchObject({
      articleId: "5d310162-a5c9-4577-9ce5-e1ef81f08d65",
      imageAssetId: "a9de9c2f-44c1-4f9e-a3e6-192a4d73e3c2",
      imageSha256: "b".repeat(64)
    });
  });
});
