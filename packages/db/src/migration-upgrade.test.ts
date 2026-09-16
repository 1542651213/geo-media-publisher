import { copyFileSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type MigrationEvent } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createMigrationFixtureThrough0022(): { databasePath: string; beforeCounts: Record<string, number> } {
  const directory = mkdtempSync(join(tmpdir(), "task10t-migration-"));
  tempDirs.push(directory);
  const fixtureMigrations = join(directory, "migrations-0022");
  mkdirSync(fixtureMigrations, { recursive: true });
  for (const file of readdirSync(migrationDir).filter((item) => item.endsWith(".sql") && item <= "0022_v143_account_archive.sql")) {
    copyFileSync(join(migrationDir, file), join(fixtureMigrations, file));
  }
  const databasePath = join(directory, "publisher.db");
  const database = openDatabase(databasePath, fixtureMigrations);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = database.repository.createBrand({ name: "Task10T fixture", companyName: "Task10T fixture" });
  const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10T fixture account" });
  const beforeCounts = {
    publish_jobs: (database.db.prepare("SELECT COUNT(*) AS count FROM publish_jobs").get() as { count: number }).count,
    submission_intents: (database.db.prepare("SELECT COUNT(*) AS count FROM submission_intents").get() as { count: number }).count,
    publish_records: (database.db.prepare("SELECT COUNT(*) AS count FROM publish_records").get() as { count: number }).count
  };
  database.db.prepare("INSERT INTO articles (id, brand_id, title, body, ai_provider, ai_model, generated_at, content_hash, created_at, updated_at) VALUES ('task10t-article', ?, 'Task10T fixture article', 'Fixture body', 'fixture', 'fixture', '2026-09-01T00:00:00.000Z', 'task10t-content-hash', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')").run(brand.id);
  database.db.prepare("INSERT INTO publish_jobs (id, account_id, platform_key, article_id, scheduled_at, status, dry_run, manual_confirmation_required, content_kind, publish_payload_json, final_publish_mode, created_at) VALUES ('task10t-job', ?, 'xiaohongshu', 'task10t-article', '2026-09-01T00:00:00.000Z', 'Pending', 1, 1, 'article', '{}', 'CONFIRM_BEFORE_PUBLISH', '2026-09-01T00:00:00.000Z')").run(account.id);
  beforeCounts.publish_jobs += 1;
  database.db.close();
  return { databasePath, beforeCounts };
}

function tableExists(database: Database.Database, name: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function indexExists(database: Database.Database, name: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name));
}

describe("Task10V migration activation", () => {
  it("upgrades an exact 0022 database through 0024 once without losing domain rows", () => {
    const fixture = createMigrationFixtureThrough0022();
    const database = new Database(fixture.databasePath);
    databases.push(database);
    const events: MigrationEvent[] = [];

    runMigrations(database, migrationDir, (event) => events.push(event));
    const appliedAfterFirstRun = database.prepare("SELECT id FROM migrations ORDER BY id").all() as Array<{ id: string }>;
    const authorizationRows = database.prepare("SELECT COUNT(*) AS count FROM one_shot_publication_authorizations").get() as { count: number };
    const afterCounts = database.prepare("SELECT COUNT(*) AS count FROM publish_jobs").get() as { count: number };

    runMigrations(database, migrationDir, (event) => events.push(event));
    const appliedAfterSecondRun = database.prepare("SELECT id FROM migrations WHERE id='0023_v150_one_shot_publication_authorization.sql'").all();

    expect(appliedAfterFirstRun.at(-1)?.id).toBe("0024_v151_platform_account_identity_binding.sql");
    expect(appliedAfterFirstRun.map((migration) => migration.id)).toEqual(expect.arrayContaining([
      "0023_v150_one_shot_publication_authorization.sql",
      "0024_v151_platform_account_identity_binding.sql"
    ]));
    expect(tableExists(database, "one_shot_publication_authorizations")).toBe(true);
    expect(tableExists(database, "platform_account_identity_bindings")).toBe(true);
    expect(indexExists(database, "idx_one_shot_publication_authorizations_account_state")).toBe(true);
    const columns = database.prepare("PRAGMA table_info(one_shot_publication_authorizations)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "id", "authorization", "platform_key", "account_id", "operation_id", "mode", "state",
      "publication_transaction_count", "publication_commit_action_count", "final_submit_attempt_count",
      "final_submit_retry_count", "final_submit_action_started", "final_submit_action_completed", "created_at", "updated_at", "consumed_at"
    ]));
    const uniqueIndexes = database.prepare("PRAGMA index_list(one_shot_publication_authorizations)").all() as Array<{ unique: number }>;
    expect(uniqueIndexes.some((index) => index.unique === 1)).toBe(true);
    expect(database.prepare("PRAGMA foreign_key_list(one_shot_publication_authorizations)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ from: "account_id", table: "accounts" })]));
    expect(authorizationRows.count).toBe(0);
    expect(afterCounts.count).toBe(fixture.beforeCounts.publish_jobs);
    expect(appliedAfterSecondRun).toHaveLength(1);
    expect(events.map((event) => event.code)).toEqual(expect.arrayContaining(["MIGRATION_DISCOVERY", "MIGRATION_APPLY_STARTED", "MIGRATION_APPLY_COMPLETED", "TASK10S_SCHEMA_READY"]));
  });

  it("reports a missing migration resource instead of silently starting", () => {
    const directory = mkdtempSync(join(tmpdir(), "task10t-migration-missing-"));
    tempDirs.push(directory);
    const database = new Database(join(directory, "publisher.db"));
    databases.push(database);

    expect(() => runMigrations(database, join(directory, "missing-migrations"))).toThrow(`Migration directory not found: ${join(directory, "missing-migrations")}`);
  });
});
