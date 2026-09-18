import { describe, expect, it } from "vitest";
import { parseOrdinaryPilotConfiguration, readOrdinaryPilotGate } from "../../apps/desktop/src/main/ordinary-pilot/config";

const root = "C:/public-export-fixtures/ordinary/runtime";
const configPath = `${root}/test-run/config.json`;
const input = () => ({ version: 1, runId: "test-run", runDirectory: `${root}/test-run`, executablePath: "C:/public-export-fixtures/ordinary/candidate/Geo Media Publisher.exe", executableSha256: "a".repeat(64), appAsarPath: "C:/public-export-fixtures/ordinary/candidate/resources/app.asar", appAsarSha256: "b".repeat(64), token: "c".repeat(64), allowRecovery: false });

describe("explicit isolated ordinary pilot configuration", () => {
  it("normal startup has no synthetic services", () => expect(readOrdinaryPilotGate({})).toBeNull());
  it("requires both explicit switches", () => {
    expect(() => readOrdinaryPilotGate({ ORDINARY_XHS_PILOT: "SYNTHETIC_ONLY" })).toThrow();
    expect(() => readOrdinaryPilotGate({ ORDINARY_XHS_PILOT_CONFIG: "C:/config.json" })).toThrow();
  });
  it("pins a config beside its isolated run directory", () => {
    expect(parseOrdinaryPilotConfiguration(input(), configPath).runId).toBe("test-run");
    for (const path of ["C:/GMP116ZhihuL5", `${root}/../production-data`, root, `${root}/another-run`]) expect(() => parseOrdinaryPilotConfiguration({ ...input(), runDirectory: path }, configPath)).toThrow();
  });
  it("rejects arbitrary fields, unpinned binaries, and invalid package layouts", () => {
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), module: "malicious.js" }, configPath)).toThrow();
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), endpoint: "https://creator.xiaohongshu.com" }, configPath)).toThrow();
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), executableSha256: "" }, configPath)).toThrow();
    expect(() => parseOrdinaryPilotConfiguration({ ...input(), appAsarPath: "C:/installed/app.asar" }, configPath)).toThrow();
  });
});
