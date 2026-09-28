import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assertProductionDatabaseRuntime, openDatabase } from "@publisher/db";

const temporaryRoots: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gmp-production-runtime-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  const tempParent = realpathSync(tmpdir());
  for (const root of temporaryRoots.splice(0)) {
    const actual = realpathSync(root);
    if (dirname(actual).toLowerCase() !== tempParent.toLowerCase()
      || !basename(actual).startsWith("gmp-production-runtime-")) {
      throw new Error("TEMP_FIXTURE_CLEANUP_TARGET_INVALID");
    }
    rmSync(actual, { recursive: true, force: true });
  }
});

describe("production Repository requires an Electron runtime", () => {
  it("rejects host Node before creating a production directory or database", () => {
    const root = fixtureRoot();
    const dataDirectory = join(root, "production-data");
    const databasePath = join(dataDirectory, "publisher.db");
    expect(() => openDatabase(databasePath, join(process.cwd(), "packages/db/migrations")))
      .toThrow("PRODUCTION_DATABASE_ELECTRON_REQUIRED");
    expect(existsSync(dataDirectory)).toBe(false);
    expect(existsSync(databasePath)).toBe(false);
  });

  it("normalizes Windows case and path traversal before applying the guard", () => {
    const root = fixtureRoot();
    const databasePath = `${root}${sep}unused${sep}..${sep}PrOdUcTiOn-DaTa${sep}PuBlIsHeR.Db`;
    expect(() => assertProductionDatabaseRuntime(databasePath, null))
      .toThrow("PRODUCTION_DATABASE_ELECTRON_REQUIRED");
    expect(() => assertProductionDatabaseRuntime(join(root, "PRODUCTION-DATA.", "PUBLISHER.DB."), null))
      .toThrow("PRODUCTION_DATABASE_ELECTRON_REQUIRED");
    expect(existsSync(join(root, "PrOdUcTiOn-DaTa"))).toBe(false);
  });

  it("permits an Electron runtime and leaves development and test paths unrestricted", () => {
    const root = fixtureRoot();
    const productionPath = join(root, "production-data", "publisher.db");
    expect(() => assertProductionDatabaseRuntime(productionPath, "37.10.3")).not.toThrow();
    const developmentPath = resolve(root, "development-data", "publisher.db");
    const testPath = resolve(root, "production-data", "fixture.db");
    expect(relative(root, developmentPath).startsWith("..")).toBe(false);
    expect(() => assertProductionDatabaseRuntime(developmentPath, null)).not.toThrow();
    expect(() => assertProductionDatabaseRuntime(testPath, null)).not.toThrow();
  });
});
