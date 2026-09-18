import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it("rejects matching migration names with different SQL bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "migration-parity-")); dirs.push(dir);
  for (const name of ["source", "package"]) mkdirSync(join(dir, name));
  writeFileSync(join(dir, "source/0001.sql"), "SELECT 1;");
  writeFileSync(join(dir, "package/0001.sql"), "SELECT 2;");
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-packaged-migrations.mts"], { encoding: "utf8", env: { ...process.env, SOURCE_MIGRATIONS_DIR: join(dir, "source"), PACKAGED_MIGRATIONS_DIR: join(dir, "package") } });
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
});
it("explicitly skips absent optional resources but fails when required", () => {
  for (const required of [false, true]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-packaged-migrations.mts", ...(required ? ["--required"] : ["--optional"])], { encoding: "utf8", env: { ...process.env, PACKAGED_MIGRATIONS_DIR: join(tmpdir(), "batch1-definitely-absent") } });
    expect(result.status).toBe(required ? 1 : 0);
    if (!required) expect(result.stdout).toContain('"SKIP"');
  }
});
