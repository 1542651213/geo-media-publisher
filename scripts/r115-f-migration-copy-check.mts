import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "@publisher/db";
import { ContentOperations } from "../apps/desktop/src/main/content-operations";

// Only a private closed-app copy is migrated. No business rows are printed.
const backup = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2] && existsSync(join(backup, "publisher.db")));
const root = join(backup, `f-copy-check-${Date.now()}`), baselineMigrations = join(root, "e-migrations");
mkdirSync(baselineMigrations, { recursive: true });
const protectedRoot = join(process.env.APPDATA ?? "", "codex-media-publisher/production-data");
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const protectedBytes = () => Object.fromEntries(["publisher.db", "publisher.db-wal", "publisher.db-shm", "credentials.enc"].map(name => [name, existsSync(join(protectedRoot, name)) ? hash(readFileSync(join(protectedRoot, name))) : null]));
const original = protectedBytes();
for (const file of readdirSync("packages/db/migrations").filter(name => name.endsWith(".sql") && name !== "0032_content_operations.sql")) {
  writeFileSync(join(baselineMigrations, file), execFileSync("git", ["show", `a2ee465cb95974b36af27c7d1be6485917f6ad29:packages/db/migrations/${file}`]));
}
const path = join(root, "migration-copy.db"); copyFileSync(join(backup, "publisher.db"), path);
const baseline = openDatabase(path, baselineMigrations);
const tables = () => (baseline.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
const existingTables = tables().filter(name => name !== "migrations");
const snapshot = (db: typeof baseline.db, names: string[]) => Object.fromEntries(names.map(name => { assert.match(name, /^[a-z0-9_]+$/u); const rows = db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort(); return [name, { count: rows.length, hash: hash(rows.join("\n")) }]; }));
const before = snapshot(baseline.db, existingTables), count = Number((baseline.db.prepare("SELECT COUNT(*) n FROM migrations").get() as { n: number }).n);
baseline.db.close();
const current = openDatabase(path, join(process.cwd(), "packages/db/migrations"));
const port = { profiles: () => [], history: () => [], generate: async () => [], saveDraft: () => { throw Error("NOT_USED"); } };
const operations = new ContentOperations(current.repository, port);
assert.deepEqual(snapshot(current.db, existingTables), before);
assert.equal(current.db.pragma("integrity_check", { simple: true }), "ok"); assert.deepEqual(current.db.pragma("foreign_key_check"), []);
const newCount = Number((current.db.prepare("SELECT COUNT(*) n FROM migrations").get() as { n: number }).n);
assert.equal(newCount, count + 1);
const bindings = Number((current.db.prepare("SELECT COUNT(*) n FROM operations_account_company_bindings").get() as { n: number }).n), unassigned = operations.listUnboundAccounts().length;
current.db.close();
const reopened = openDatabase(path, join(process.cwd(), "packages/db/migrations")); new ContentOperations(reopened.repository, port);
assert.deepEqual(snapshot(reopened.db, existingTables), before); assert.equal((reopened.db.prepare("SELECT COUNT(*) n FROM migrations").get() as { n: number }).n, newCount);
reopened.db.close(); assert.deepEqual(protectedBytes(), original);
const result = { status: "PASS", eBaselineMigrationCount: count, fMigrationCount: newCount, preservedExistingTables: existingTables.length, exactExistingRowParity: true, legacyAccountBindings: bindings, ambiguousAccountsUnassigned: unassigned, integrity: "PASS", foreignKeys: "PASS", reopenIdempotent: true, originalDatabaseAndCredentialBytesUnchanged: true, realPlatformPublishCount: 0, newFinalSubmitCount: 0 };
writeFileSync("output/r115-f-execution-20261001/migration-copy-check.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
