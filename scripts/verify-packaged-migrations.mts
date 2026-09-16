import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function migrationIds(directory: string): string[] {
  if (!existsSync(directory)) throw new Error(`Packaged migration directory not found: ${directory}`);
  return readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
}

const sourceDirectory = resolve(process.env.SOURCE_MIGRATIONS_DIR ?? "packages/db/migrations");
const packagedDirectory = resolve(process.env.PACKAGED_MIGRATIONS_DIR ?? "release/win-unpacked/resources/packages/db/migrations");
const source = migrationIds(sourceDirectory);
const packaged = migrationIds(packagedDirectory);

if (source.length !== packaged.length || source.some((file, index) => file !== packaged[index])) {
  throw new Error(`MIGRATION_PACKAGE_PARITY_FAILED source=${source.join(",")} packaged=${packaged.join(",")}`);
}

console.log(JSON.stringify({
  migrationPackageParity: "PASS",
  sourceCount: source.length,
  packagedCount: packaged.length,
  latestSourceMigration: source.at(-1) ?? null,
  latestPackagedMigration: packaged.at(-1) ?? null
}));
