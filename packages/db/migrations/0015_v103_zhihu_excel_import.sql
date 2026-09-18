PRAGMA foreign_keys = ON;

-- V1.0.3 keeps the existing accounts table as the single canonical
-- PlatformAccount store. Existing ids remain stable for queue references.
ALTER TABLE accounts ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'Manual';
ALTER TABLE accounts ADD COLUMN authorization_status TEXT NOT NULL DEFAULT 'Unknown';
ALTER TABLE accounts ADD COLUMN browser_session_id TEXT;
ALTER TABLE accounts ADD COLUMN external_account_id TEXT;
ALTER TABLE accounts ADD COLUMN last_verified_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_platform_external_identity
  ON accounts(platform_key, external_account_id)
  WHERE external_account_id IS NOT NULL;

ALTER TABLE articles ADD COLUMN source TEXT NOT NULL DEFAULT 'production';
ALTER TABLE articles ADD COLUMN company TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN business TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN target_platforms_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE articles ADD COLUMN promotion_strength TEXT;
ALTER TABLE articles ADD COLUMN source_note TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN import_batch_id TEXT;
ALTER TABLE articles ADD COLUMN imported_at TEXT;
ALTER TABLE articles ADD COLUMN source_filename TEXT;
ALTER TABLE articles ADD COLUMN content_fingerprint TEXT;

UPDATE articles SET content_fingerprint = content_hash WHERE content_fingerprint IS NULL;

CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source, created_at);
CREATE INDEX IF NOT EXISTS idx_articles_import_batch ON articles(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_articles_content_fingerprint ON articles(content_fingerprint);

ALTER TABLE publish_jobs ADD COLUMN platform_account_id TEXT;
UPDATE publish_jobs SET platform_account_id = account_id WHERE platform_account_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_publish_jobs_platform_account ON publish_jobs(platform_account_id, platform_key, status);

ALTER TABLE publish_records ADD COLUMN platform_account_id TEXT;
UPDATE publish_records SET platform_account_id = account_id WHERE platform_account_id IS NULL;
ALTER TABLE publish_records ADD COLUMN editor_opened_at TEXT;
ALTER TABLE publish_records ADD COLUMN title_filled INTEGER;
ALTER TABLE publish_records ADD COLUMN body_filled INTEGER;
CREATE INDEX IF NOT EXISTS idx_publish_records_platform_account ON publish_records(platform_account_id, platform_key, published_at);
