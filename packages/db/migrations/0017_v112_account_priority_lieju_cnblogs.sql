PRAGMA foreign_keys = ON;

-- V1.1.2 keeps accounts as the canonical PlatformAccount table while adding
-- local aliases and deterministic recent-use ordering for multi-account UI.
ALTER TABLE accounts ADD COLUMN account_alias TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN platform_account_name TEXT;
ALTER TABLE accounts ADD COLUMN last_used_at TEXT;

UPDATE accounts SET account_alias = name WHERE account_alias = '';

CREATE INDEX IF NOT EXISTS idx_accounts_platform_recent_use
  ON accounts(platform_key, last_used_at DESC);
