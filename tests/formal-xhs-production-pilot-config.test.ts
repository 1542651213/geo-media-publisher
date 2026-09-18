import { describe, expect, it } from "vitest";
import { FORMAL_XHS_PRODUCTION_PILOT_ID, parseFormalXhsProductionPilotConfig, readFormalXhsProductionPilotGate } from "../apps/desktop/src/main/formal-xhs-production-pilot-config";

const sha = "a".repeat(64);

describe("formal XHS production-pilot config", () => {
  it("requires an explicit dual gate and pins this task's finite authorization", () => {
    expect(readFormalXhsProductionPilotGate({})).toBeNull();
    expect(() => readFormalXhsProductionPilotGate({ GEO_XHS_PRODUCTION_PILOT: "OWNER_AUTHORIZED_PRODUCTION_PILOT_MAX3_20260918" })).toThrow("FORMAL_XHS_PRODUCTION_PILOT_DUAL_GATE_REQUIRED");
    expect(readFormalXhsProductionPilotGate({ GEO_XHS_PRODUCTION_PILOT: "OWNER_AUTHORIZED_PRODUCTION_PILOT_MAX3_20260918", GEO_XHS_PRODUCTION_PILOT_CONFIG: "C:/public-export-fixtures/userData/production-data/production-pilot-control/config.json" })).toMatch(/config\.json$/u);
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
});
