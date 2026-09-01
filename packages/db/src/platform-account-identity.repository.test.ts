import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "task10v-identity-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  return database;
}

describe("Task10V platform account identity binding schema", () => {
  it("creates the identity binding table and unique indexes", () => {
    const database = fixture();
    const table = database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_account_identity_bindings'").get();
    const indexes = database.db.prepare("SELECT name,\n       CASE WHEN sql LIKE 'CREATE UNIQUE INDEX%' THEN 1 ELSE 0 END AS unique_index\n       FROM sqlite_master WHERE type='index' AND tbl_name='platform_account_identity_bindings'").all() as Array<{ name: string; unique_index: number }>;
    const columns = database.db.prepare("PRAGMA table_info(platform_account_identity_bindings)").all() as Array<{ name: string }>;

    expect(table).toBeTruthy();
    expect(indexes).toEqual(expect.arrayContaining([
      { name: "uq_platform_account_identity_bindings_account", unique_index: 1 },
      { name: "uq_platform_account_identity_bindings_external", unique_index: 1 }
    ]));
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "id", "platform_key", "account_id", "external_creator_id", "display_name", "profile_url",
      "binding_source", "bound_at", "created_at", "updated_at"
    ]));
  });
});
