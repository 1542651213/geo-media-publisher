import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertElectronNativeRuntime,
  assertRuntimeArtifactHashes,
  runElectronCandidateAfterChecks,
  validateDouyinCandidateScript
} from "../scripts/douyin-acceptance-electron-runtime.mjs";

const temporaryRoots: string[] = [];
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "douyin-abi-"));
  temporaryRoots.push(root);
  const output = join(root, "output");
  mkdirSync(output);
  const candidate = join(output, "douyin-acceptance-candidate.mts");
  writeFileSync(candidate, "export const marker = 'fixture';\n");
  const executable = join(root, "electron.exe");
  writeFileSync(executable, "fixture");
  return { root, candidate, executable };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Douyin acceptance Electron ABI gate", () => {
  it("checks exact installer, executable, archive, and Main bytes before candidate import", async () => {
    const { root, executable } = fixture();
    const installer = join(root, "installer.exe");
    const appAsar = join(root, "app.asar");
    const main = join(root, "main.js");
    const original = { installer: "installer", executable: "fixture", appAsar: "archive", main: "compiled main" };
    writeFileSync(installer, original.installer);
    writeFileSync(appAsar, original.appAsar);
    writeFileSync(main, original.main);
    const paths = { installer, executable, appAsar, main };
    const hash = (value: string) => createHash("sha256").update(value).digest("hex").toUpperCase();
    const expected = {
      installer: hash(original.installer), executable: hash(original.executable),
      appAsar: hash(original.appAsar), main: hash(original.main)
    };
    await expect(assertRuntimeArtifactHashes(paths, expected)).resolves.toBeUndefined();
    for (const [key, code] of [
      ["installer", "DOUYIN_ACCEPTANCE_INSTALLER_HASH_MISMATCH"],
      ["executable", "DOUYIN_ACCEPTANCE_EXE_HASH_MISMATCH"],
      ["appAsar", "DOUYIN_ACCEPTANCE_ASAR_HASH_MISMATCH"],
      ["main", "DOUYIN_ACCEPTANCE_MAIN_HASH_MISMATCH"]
    ] as const) {
      writeFileSync(paths[key], "tampered");
      await expect(assertRuntimeArtifactHashes(paths, expected)).rejects.toThrow(code);
      writeFileSync(paths[key], original[key]);
    }
  });

  it("loads the CLI before rejecting an invalid candidate without launching Electron", () => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx",
      join(workspaceRoot, "scripts", "douyin-acceptance-electron-runtime.mts"),
      "--candidate-script", "package.json"
    ], { cwd: workspaceRoot, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DOUYIN_ACCEPTANCE_CANDIDATE_PATH_INVALID");
  });

  it("rejects a candidate outside the bounded output directory", () => {
    const { root } = fixture();
    const outside = join(root, "douyin-seed.mts");
    writeFileSync(outside, "export {};");
    expect(() => validateDouyinCandidateScript(outside, root)).toThrow("DOUYIN_ACCEPTANCE_CANDIDATE_PATH_INVALID");
  });

  it("rejects historical seed scripts that must never be rerun", () => {
    const { root } = fixture();
    const historicalSeed = join(root, "output", "douyin-r1-10-seed.mts");
    writeFileSync(historicalSeed, "throw new Error('must not run');");
    expect(() => validateDouyinCandidateScript(historicalSeed, root)).toThrow("DOUYIN_ACCEPTANCE_CANDIDATE_PATH_INVALID");
  });

  it("stops host Node before native probing or candidate import", async () => {
    const { root, candidate, executable } = fixture();
    const calls: string[] = [];
    await expect(runElectronCandidateAfterChecks({
      candidatePath: candidate, workspaceRoot: root, expectedElectronExecutable: executable,
      runtime: { electronVersion: null, executable, runAsNode: true },
      probeNative: async () => { calls.push("native"); },
      importCandidate: async () => { calls.push("candidate"); }
    })).rejects.toThrow("DOUYIN_ACCEPTANCE_ELECTRON_RUNTIME_REQUIRED");
    expect(calls).toEqual([]);
  });

  it("checks executable identity before native probing or candidate import", async () => {
    const { root, candidate, executable } = fixture();
    const otherExecutable = join(root, "other-electron.exe");
    writeFileSync(otherExecutable, "fixture");
    const calls: string[] = [];
    await expect(runElectronCandidateAfterChecks({
      candidatePath: candidate, workspaceRoot: root, expectedElectronExecutable: executable,
      runtime: { electronVersion: "37.10.3", executable: otherExecutable, runAsNode: true },
      probeNative: async () => { calls.push("native"); },
      importCandidate: async () => { calls.push("candidate"); }
    })).rejects.toThrow("DOUYIN_ACCEPTANCE_ELECTRON_EXECUTABLE_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("stops on native ABI mismatch before candidate import", async () => {
    const { root, candidate, executable } = fixture();
    const calls: string[] = [];
    await expect(runElectronCandidateAfterChecks({
      candidatePath: candidate, workspaceRoot: root, expectedElectronExecutable: executable,
      runtime: { electronVersion: "37.10.3", executable, runAsNode: true },
      probeNative: async () => { calls.push("native"); throw new Error("NODE_MODULE_VERSION mismatch"); },
      importCandidate: async () => { calls.push("candidate"); }
    })).rejects.toThrow("DOUYIN_ACCEPTANCE_NATIVE_ABI_MISMATCH");
    expect(calls).toEqual(["native"]);
  });

  it("imports the exact candidate only after all checks pass", async () => {
    const { root, candidate, executable } = fixture();
    const calls: string[] = [];
    expect(validateDouyinCandidateScript(candidate, root)).toBe(realpathSync(candidate));
    expect(() => assertElectronNativeRuntime(
      { electronVersion: "37.10.3", executable, runAsNode: true }, executable
    )).not.toThrow();
    await runElectronCandidateAfterChecks({
      candidatePath: candidate, workspaceRoot: root, expectedElectronExecutable: executable,
      runtime: { electronVersion: "37.10.3", executable, runAsNode: true },
      probeNative: async () => { calls.push("native"); },
      importCandidate: async (path) => { expect(path).toBe(realpathSync(candidate)); calls.push("candidate"); }
    });
    expect(calls).toEqual(["native", "candidate"]);
  });
});
