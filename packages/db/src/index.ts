import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { AppRepository } from "./repository";

export { AppRepository } from "./repository";
export * from "./ai-center";
export type { StoredVideoAsset, StoredVideoAssetStatus } from "./repository";
export type { AIBatchItem, AIBatchTarget, ArticleInput, ArticlePage, AIProviderProfileInput, BrandInput, BrandKnowledgeEntryInput, ContentQualityAuditView, ContentQualityItemView, ContentQualityReviewView, ContentQualityStateView, ContentStudioMediaAssetView, ContentStudioTaskPayload, ContentStudioTaskView, ContentStudioVersionView, HumanReviewContentSnapshot, HumanReviewDatasetItemView, HumanReviewDatasetStatus, HumanReviewDatasetView, HumanReviewDecision, HumanReviewFinalStatus, HumanReviewIssueDecisionView, HumanReviewItemReviewView, HumanReviewItemStatus, HumanReviewMachineDecision, HumanReviewMachineIssueView, HumanReviewSubmitInput, JobInput, JobPage, QualityBenchmarkContentView, QualityBenchmarkItemAttemptStatus, QualityBenchmarkItemAttemptView, QualityBenchmarkItemStatus, QualityBenchmarkItemView, QualityBenchmarkMetrics, QualityBenchmarkRunStatus, QualityBenchmarkRunType, QualityBenchmarkRunView } from "./repository";
export * from "./schema";

/** Reject host-Node Repository access to the app's production database before any filesystem write. */
export function assertProductionDatabaseRuntime(filePath: string, electronVersion: string | null = process.versions.electron ?? null): void {
  const pathComponent = (value: string) => value.replace(/[. ]+$/u, "").toLowerCase();
  const absolutePath = resolve(filePath);
  if (pathComponent(basename(absolutePath)) !== "publisher.db") return;
  const parent = dirname(absolutePath);
  const canonicalParent = existsSync(parent) ? realpathSync(parent) : parent;
  const productionDirectory = [parent, canonicalParent].some((path) => pathComponent(basename(path)) === "production-data");
  if (productionDirectory && !electronVersion) {
    throw Object.assign(new Error("PRODUCTION_DATABASE_ELECTRON_REQUIRED"), { code: "PRODUCTION_DATABASE_ELECTRON_REQUIRED" });
  }
}

export function openDatabase(filePath: string, migrationsDir: string): { db: Database.Database; repository: AppRepository } {
  assertProductionDatabaseRuntime(filePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrationsDir);
  return { db, repository: new AppRepository(db) };
}

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  if (!existsSync(migrationsDir)) throw new Error(`Migration directory not found: ${migrationsDir}`);
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const apply = db.transaction((file: string, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
  });
  for (const file of files) {
    const applied = db.prepare("SELECT id FROM migrations WHERE id=?").get(file) as { id: string } | undefined;
    if (!applied) apply(file, readFileSync(join(migrationsDir, file), "utf8"));
  }
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
