import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type RuntimeIdentity = {
  electronVersion: string | null;
  executable: string;
  runAsNode: boolean;
};

type RuntimeArtifacts = {
  installer: string;
  executable: string;
  appAsar: string;
  main: string;
};

type RuntimeHashes = RuntimeArtifacts;

const R111_RUNTIME_HASHES: RuntimeHashes = {
  installer: "2FEAF00A37CB0D9915B36494BC6B4501FCF456FAA67D41CADF6A01053B6F06AD",
  executable: "A9A10D870DF2EA389B0CD89A9FA2D6910FB4A962028F4CFFDE37C6C7D498C4DF",
  appAsar: "BF9C38A4073539EE9616D13B290327ECC6549021498E7596BFD32ADB72F7FAF7",
  main: "7050F0D81B43D479C97F95B165AD1AAD905821AA8D960B4383828C509F279C98"
};

type CandidateRun = {
  candidatePath: string;
  workspaceRoot: string;
  expectedElectronExecutable: string;
  runtime: RuntimeIdentity;
  probeNative: () => Promise<void>;
  importCandidate: (path: string) => Promise<void>;
};

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = process.versions.electron
    ? (await import("original-fs")).createReadStream(path)
    : createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

export async function assertRuntimeArtifactHashes(paths: RuntimeArtifacts, expected: RuntimeHashes): Promise<void> {
  for (const [key, code] of [
    ["installer", "DOUYIN_ACCEPTANCE_INSTALLER_HASH_MISMATCH"],
    ["executable", "DOUYIN_ACCEPTANCE_EXE_HASH_MISMATCH"],
    ["appAsar", "DOUYIN_ACCEPTANCE_ASAR_HASH_MISMATCH"],
    ["main", "DOUYIN_ACCEPTANCE_MAIN_HASH_MISMATCH"]
  ] as const) {
    if (await sha256File(paths[key]) !== expected[key]) throw new Error(code);
  }
}

async function assertR111RuntimeIdentity(): Promise<RuntimeArtifacts> {
  const unpackedRoot = join(workspaceRoot, "release", "win-unpacked");
  const paths = {
    installer: realpathSync("C:\\Users\\Administrator\\.codex\\artifacts\\douyin-r1-11-aa2d701-short\\Geo Media Publisher Setup 1.1.9.exe"),
    executable: realpathSync(join(unpackedRoot, "Geo Media Publisher.exe")),
    appAsar: realpathSync(join(unpackedRoot, "resources", "app.asar")),
    main: realpathSync(join(workspaceRoot, "out", "main", "main.js"))
  };
  await assertRuntimeArtifactHashes(paths, R111_RUNTIME_HASHES);
  return paths;
}

function samePath(left: string, right: string): boolean {
  const a = realpathSync(left);
  const b = realpathSync(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function validateDouyinCandidateScript(path: string, root: string): string {
  const outputRoot = realpathSync(join(root, "output"));
  const candidate = realpathSync(isAbsolute(path) ? path : resolve(root, path));
  const withinOutput = relative(outputRoot, candidate);
  if (!withinOutput || withinOutput === ".." || withinOutput.startsWith(`..${sep}`) || isAbsolute(withinOutput)
    || !/^douyin-acceptance-candidate(?:-[a-z0-9-]+)?\.mts$/i.test(withinOutput)
    || !statSync(candidate).isFile()) {
    throw new Error("DOUYIN_ACCEPTANCE_CANDIDATE_PATH_INVALID");
  }
  return candidate;
}

export function assertElectronNativeRuntime(runtime: RuntimeIdentity, expectedElectronExecutable: string): void {
  if (!runtime.electronVersion || !runtime.runAsNode) {
    throw new Error("DOUYIN_ACCEPTANCE_ELECTRON_RUNTIME_REQUIRED");
  }
  if (!samePath(runtime.executable, expectedElectronExecutable)) {
    throw new Error("DOUYIN_ACCEPTANCE_ELECTRON_EXECUTABLE_MISMATCH");
  }
}

export async function runElectronCandidateAfterChecks(input: CandidateRun): Promise<void> {
  const candidate = validateDouyinCandidateScript(input.candidatePath, input.workspaceRoot);
  assertElectronNativeRuntime(input.runtime, input.expectedElectronExecutable);
  try {
    await input.probeNative();
  } catch (error) {
    throw new Error("DOUYIN_ACCEPTANCE_NATIVE_ABI_MISMATCH", { cause: error });
  }
  await input.importCandidate(candidate);
}

async function probeBetterSqlite3InMemory(): Promise<void> {
  const { default: Database } = await import("better-sqlite3");
  const probe = new Database(":memory:");
  probe.close();
}

async function runChild(candidatePath: string): Promise<void> {
  const runtimeArtifacts = await assertR111RuntimeIdentity();
  await runElectronCandidateAfterChecks({
    candidatePath,
    workspaceRoot,
    expectedElectronExecutable: runtimeArtifacts.executable,
    runtime: {
      electronVersion: process.versions.electron ?? null,
      executable: process.execPath,
      runAsNode: process.env.ELECTRON_RUN_AS_NODE === "1"
    },
    probeNative: async () => {
      await probeBetterSqlite3InMemory();
      process.stdout.write(JSON.stringify({
        code: "DOUYIN_ACCEPTANCE_ELECTRON_NATIVE_READY",
        electronVersion: process.versions.electron,
        nativeModuleAbi: process.versions.modules
      }) + "\n");
    },
    importCandidate: async (path) => { await import(pathToFileURL(path).href); }
  });
}

async function launchChild(candidatePath: string): Promise<number> {
  const candidate = validateDouyinCandidateScript(candidatePath, workspaceRoot);
  const runtimeArtifacts = await assertR111RuntimeIdentity();
  const result = spawnSync(runtimeArtifacts.executable, ["--import", "tsx", fileURLToPath(import.meta.url), "--electron-child", candidate], {
    cwd: workspaceRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  const [mode, candidatePath, extra] = process.argv.slice(2);
  if (!candidatePath || extra || (mode !== "--candidate-script" && mode !== "--electron-child")) {
    throw new Error("DOUYIN_ACCEPTANCE_USAGE: --candidate-script output/douyin-...-candidate.mts");
  }
  if (mode === "--electron-child") {
    await runChild(candidatePath);
  } else {
    process.exitCode = await launchChild(candidatePath);
  }
}
