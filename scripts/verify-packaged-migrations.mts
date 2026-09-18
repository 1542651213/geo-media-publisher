import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

function inventory(directory: string): Array<{ id: string; sha256: string }> {
  if (!existsSync(directory)) throw new Error(`Migration directory not found: ${directory}`);
  return readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()
    .map((id) => ({ id, sha256: createHash("sha256").update(readFileSync(join(directory, id))).digest("hex") }));
}
const sourceDirectory = resolve(process.env.SOURCE_MIGRATIONS_DIR ?? "packages/db/migrations");
const packagedDirectory = resolve(process.env.PACKAGED_MIGRATIONS_DIR ?? "release/win-unpacked/resources/packages/db/migrations");
const optional = process.argv.includes("--optional") && !process.argv.includes("--required");
try {
  const source = inventory(sourceDirectory);
  if (!existsSync(packagedDirectory) && optional) {
    console.log(JSON.stringify({ migrationPackageParity: "SKIP", reason: "Optional packaged resource directory absent", packagedDirectory }));
  } else {
    const packaged = inventory(packagedDirectory);
    if (JSON.stringify(source) !== JSON.stringify(packaged)) throw new Error("MIGRATION_PACKAGE_PARITY_FAILED: migration set or SHA256 differs");
    console.log(JSON.stringify({ migrationPackageParity: "PASS", sourceDirectory, packagedDirectory, sourceCount: source.length, packagedCount: packaged.length, migrations: source }));
  }
} catch (error) {
  console.error(JSON.stringify({ migrationPackageParity: "FAIL", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
