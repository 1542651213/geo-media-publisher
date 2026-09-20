import { describe, expect, it } from "vitest";
import { parseOrdinaryPilotConfiguration, readOrdinaryPilotGate } from "../../apps/desktop/src/main/ordinary-pilot/config";

const root = "D:/GEO/repairs/batch1-v0-f01-20260917/runtime/ordinary-xhs-pilot";
const input = () => ({ version: 1, runId: "test-run", runDirectory: `${root}/test-run`, executablePath: "D:/GEO/repairs/batch1-v0-f01-20260917/ordinary-xhs-candidate/win-unpacked/Geo Media Publisher.exe", executableSha256: "a".repeat(64), appAsarPath: "D:/GEO/repairs/batch1-v0-f01-20260917/ordinary-xhs-candidate/win-unpacked/resources/app.asar", appAsarSha256: "b".repeat(64), token: "c".repeat(64), allowRecovery: false });
describe("explicit isolated ordinary pilot configuration", () => {
  it("normal startup has no synthetic services", () => expect(readOrdinaryPilotGate({})).toBeNull());
  it("requires both explicit switches", () => {
    expect(() => readOrdinaryPilotGate({ ORDINARY_XHS_PILOT: "SYNTHETIC_ONLY" })).toThrow();
    expect(() => readOrdinaryPilotGate({ ORDINARY_XHS_PILOT_CONFIG: "D:/config.json" })).toThrow();
  });
  it("allows only an exact run directory under the isolated root", () => {
    expect(parseOrdinaryPilotConfiguration(input()).runId).toBe("test-run");
    for (const path of ["C:/GMP116ZhihuL5", `${root}/../production-data`, root, `${root}/another-run`]) expect(() => parseOrdinaryPilotConfiguration({ ...input(), runDirectory: path })).toThrow();
  });
  it("rejects arbitrary modules, network endpoints and unpinned binaries", () => {
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), module: "malicious.js" })).toThrow();
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), endpoint: "https://creator.xiaohongshu.com" })).toThrow();
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), executableSha256: "" })).toThrow();
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), appAsarPath: "C:/installed/app.asar" })).toThrow();
  });
});
