import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationIds(directory: string): string[] {
  return readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
}

describe("packaged migration contract", () => {
  it("keeps the electron-builder migration resource mapping explicit", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { build?: { extraResources?: Array<{ from?: string; to?: string }> } };
    expect(packageJson.build?.extraResources).toEqual(expect.arrayContaining([{ from: "packages/db/migrations", to: "packages/db/migrations" }]));
  });

  it.skipIf(!process.env.PACKAGED_MIGRATIONS_DIR)("matches source and packaged migration sets when a packaged resource directory is supplied", () => {
    const source = join(process.cwd(), "packages", "db", "migrations");
    const packaged = process.env.PACKAGED_MIGRATIONS_DIR;
    if (!packaged || !existsSync(packaged)) throw new Error("Explicit packaged migration path is missing");
    expect(migrationIds(packaged)).toEqual(migrationIds(source));
    for (const id of migrationIds(source)) expect(createHash("sha256").update(readFileSync(join(packaged, id))).digest("hex")).toBe(createHash("sha256").update(readFileSync(join(source, id))).digest("hex"));
  });
});
