import { spawnSync } from "node:child_process";

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(args: string[]): number {
  const result = spawnSync(packageManager, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  return result.status ?? 1;
}

const hostRebuild = run(["rebuild", "better-sqlite3"]);
if (hostRebuild !== 0) process.exit(hostRebuild);

const testStatus = run(["exec", "vitest", "run"]);
const electronRebuild = run(["run", "rebuild:native"]);
process.exit(testStatus !== 0 ? testStatus : electronRebuild);
