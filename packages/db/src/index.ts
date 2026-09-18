import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AppRepository } from "./repository";

export { AppRepository } from "./repository";
export type { OneShotConfirmationPersistenceResult, StoredVideoAsset, StoredVideoAssetStatus } from "./repository";
export type { AIBatchItem, AIBatchTarget, ArticleInput, ArticlePage, AIProviderProfileInput, BrandInput, BrandKnowledgeEntryInput, ContentQualityAuditView, ContentQualityItemView, ContentQualityReviewView, ContentQualityStateView, ContentStudioMediaAssetView, ContentStudioTaskPayload, ContentStudioTaskView, ContentStudioVersionView, HumanReviewContentSnapshot, HumanReviewDatasetItemView, HumanReviewDatasetStatus, HumanReviewDatasetView, HumanReviewDecision, HumanReviewFinalStatus, HumanReviewIssueDecisionView, HumanReviewItemReviewView, HumanReviewItemStatus, HumanReviewMachineDecision, HumanReviewMachineIssueView, HumanReviewSubmitInput, JobInput, JobPage, QualityBenchmarkContentView, QualityBenchmarkItemAttemptStatus, QualityBenchmarkItemAttemptView, QualityBenchmarkItemStatus, QualityBenchmarkItemView, QualityBenchmarkMetrics, QualityBenchmarkRunStatus, QualityBenchmarkRunType, QualityBenchmarkRunView } from "./repository";
export * from "./schema";

export type MigrationEventCode = "MIGRATION_DISCOVERY" | "MIGRATION_APPLY_STARTED" | "MIGRATION_APPLY_COMPLETED" | "MIGRATION_APPLY_FAILED" | "TASK10S_SCHEMA_READY";

export interface MigrationEvent {
  code: MigrationEventCode;
  migrationId?: string;
  discoveredMigrationCount?: number;
  appliedMigrationCount?: number;
  latestMigrationId?: string | null;
  latestSourceMigrationId?: string | null;
  latestPackagedMigrationId?: string | null;
  productionSchemaVersion?: string | null;
  schemaUpToDate?: boolean;
  authTablePresent?: boolean;
}

export type MigrationObserver = (event: MigrationEvent) => void;

export interface MigrationInventory {
  ids: string[];
  latestId: string | null;
  latestVersion: string | null;
}

export function readMigrationInventory(migrationsDir: string): MigrationInventory {
  if (!existsSync(migrationsDir)) throw new Error(`Migration directory not found: ${migrationsDir}`);
  const ids = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const latestId = ids.at(-1) ?? null;
  return { ids, latestId, latestVersion: latestId ? latestId.slice(0, 4) : null };
}

export function openDatabase(filePath: string, migrationsDir: string, observeMigration?: MigrationObserver): { db: Database.Database; repository: AppRepository } {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrationsDir, observeMigration);
  return { db, repository: new AppRepository(db) };
}

export function runMigrations(db: Database.Database, migrationsDir: string, observeMigration?: MigrationObserver): void {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const inventory = readMigrationInventory(migrationsDir);
  const files = inventory.ids;
  const latestMigrationId = inventory.latestId;
  observeMigration?.({ code: "MIGRATION_DISCOVERY", discoveredMigrationCount: files.length, latestMigrationId, latestSourceMigrationId: latestMigrationId, latestPackagedMigrationId: latestMigrationId });
  const apply = db.transaction((file: string, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
  });
  let appliedMigrationCount = 0;
  for (const file of files) {
    const applied = db.prepare("SELECT id FROM migrations WHERE id=?").get(file) as { id: string } | undefined;
    if (!applied) {
      observeMigration?.({ code: "MIGRATION_APPLY_STARTED", migrationId: file });
      try {
        apply(file, readFileSync(join(migrationsDir, file), "utf8"));
        appliedMigrationCount += 1;
        observeMigration?.({ code: "MIGRATION_APPLY_COMPLETED", migrationId: file, appliedMigrationCount });
      } catch (error) {
        observeMigration?.({ code: "MIGRATION_APPLY_FAILED", migrationId: file });
        throw error;
      }
    }
  }
  const authTablePresent = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='one_shot_publication_authorizations'").get());
  const appliedIds = (db.prepare("SELECT id FROM migrations ORDER BY id").all() as Array<{ id: string }>).map((item) => item.id);
  const productionSchemaVersion = appliedIds.at(-1)?.slice(0, 4) ?? null;
  const schemaUpToDate = files.length === appliedIds.length && files.every((file, index) => appliedIds[index] === file);
  if (files.includes("0023_v150_one_shot_publication_authorization.sql") && authTablePresent) observeMigration?.({ code: "TASK10S_SCHEMA_READY", migrationId: "0023_v150_one_shot_publication_authorization.sql", latestMigrationId, latestSourceMigrationId: latestMigrationId, latestPackagedMigrationId: latestMigrationId, productionSchemaVersion, schemaUpToDate, authTablePresent });
}

export async function backupDatabase(db: Database.Database, backupPath: string): Promise<void> {
  mkdirSync(dirname(backupPath), { recursive: true });
  if (existsSync(backupPath)) throw new Error("备份文件已存在，请使用新的文件名");
  await db.backup(backupPath);
}

export function validateDatabaseBackup(backupPath: string): { valid: boolean; message: string } {
  if (!existsSync(backupPath)) return { valid: false, message: "备份文件不存在" };
  const check = new Database(backupPath, { readonly: true });
  try {
    const result = check.pragma("integrity_check", { simple: true });
    return result === "ok" ? { valid: true, message: "SQLite integrity_check 通过" } : { valid: false, message: String(result) };
  } finally {
    check.close();
  }
}

export function restoreDatabaseSafely(db: Database.Database, databasePath: string, backupPath: string): { restored: boolean; preRestoreBackupPath: string } {
  const validation = validateDatabaseBackup(backupPath);
  if (!validation.valid) throw new Error(`Backup validation failed: ${validation.message}`);
  db.pragma("wal_checkpoint(TRUNCATE)");
  const preRestoreBackupPath = `${databasePath}.pre-restore-${Date.now()}.db`;
  const temporaryPath = `${databasePath}.restore-${process.pid}.tmp`;
  copyFileSync(databasePath, preRestoreBackupPath);
  copyFileSync(backupPath, temporaryPath);
  const temporaryValidation = validateDatabaseBackup(temporaryPath);
  if (!temporaryValidation.valid) { rmSync(temporaryPath, { force: true }); throw new Error(`Temporary restore validation failed: ${temporaryValidation.message}`); }
  db.close();
  const oldPath = `${databasePath}.old-${process.pid}.tmp`;
  try {
    renameSync(databasePath, oldPath);
    renameSync(temporaryPath, databasePath);
    rmSync(oldPath, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    return { restored: true, preRestoreBackupPath };
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (existsSync(oldPath) && !existsSync(databasePath)) renameSync(oldPath, databasePath);
    throw error;
  }
}
