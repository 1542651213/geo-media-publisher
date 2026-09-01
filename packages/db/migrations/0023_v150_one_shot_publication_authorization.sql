PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS one_shot_publication_authorizations (
  id TEXT PRIMARY KEY,
  authorization TEXT NOT NULL,
  platform_key TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  state TEXT NOT NULL,
  publication_transaction_count INTEGER NOT NULL DEFAULT 0,
  publication_commit_action_count INTEGER NOT NULL DEFAULT 0,
  final_submit_attempt_count INTEGER NOT NULL DEFAULT 0,
  final_submit_retry_count INTEGER NOT NULL DEFAULT 0,
  final_submit_action_started INTEGER NOT NULL DEFAULT 0,
  final_submit_action_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_one_shot_publication_authorizations_account_state
  ON one_shot_publication_authorizations(account_id, platform_key, state, created_at);
