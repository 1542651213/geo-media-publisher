import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type RuntimeIdentity = {
  electronVersion: string | null;
  executable: string;
  runAsNode: boolean;
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

function electronExecutable(): string {
  return realpathSync(join(workspaceRoot, "node_modules", "electron", "dist", "electron.exe"));
}

async function probeBetterSqlite3InMemory(): Promise<void> {
  const { default: Database } = await import("better-sqlite3");
  const probe = new Database(":memory:");
  probe.close();
}

async function runChild(candidatePath: string): Promise<void> {
  await runElectronCandidateAfterChecks({
    candidatePath,
    workspaceRoot,
    expectedElectronExecutable: electronExecutable(),
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

function launchChild(candidatePath: string): number {
  const candidate = validateDouyinCandidateScript(candidatePath, workspaceRoot);
  const executable = electronExecutable();
  const result = spawnSync(executable, ["--import", "tsx", fileURLToPath(import.meta.url), "--electron-child", candidate], {
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
    process.exitCode = launchChild(candidatePath);
  }
}
