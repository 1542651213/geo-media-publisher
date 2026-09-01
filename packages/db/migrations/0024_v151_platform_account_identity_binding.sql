PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_account_identity_bindings (
  id TEXT PRIMARY KEY,
  platform_key TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_creator_id TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  binding_source TEXT NOT NULL CHECK (binding_source IN ('LEGACY_ACCOUNT_EXTERNAL_ID_MATCH', 'OWNER_APPROVED_CREATOR_IDENTITY_BINDING')),
  bound_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_account_identity_bindings_account
  ON platform_account_identity_bindings(platform_key, account_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_account_identity_bindings_external
  ON platform_account_identity_bindings(platform_key, external_creator_id);
