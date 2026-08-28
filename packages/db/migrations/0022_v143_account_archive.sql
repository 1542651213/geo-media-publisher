ALTER TABLE accounts ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_platform_archived
  ON accounts(platform_key, archived_at, name);
