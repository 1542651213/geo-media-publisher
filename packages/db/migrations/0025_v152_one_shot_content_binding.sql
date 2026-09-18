PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS one_shot_content_bindings (
  content_binding_id TEXT PRIMARY KEY,
  platform_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  title_canonical TEXT NOT NULL,
  body_canonical TEXT NOT NULL,
  title_sha256 TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  image_asset_id TEXT NOT NULL,
  image_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_one_shot_content_bindings_account
  ON one_shot_content_bindings(platform_key, account_id, created_at);

ALTER TABLE platform_self_test_runs ADD COLUMN content_binding_id TEXT;
ALTER TABLE articles ADD COLUMN content_binding_id TEXT;
ALTER TABLE publish_jobs ADD COLUMN content_binding_id TEXT;
ALTER TABLE publish_records ADD COLUMN content_binding_id TEXT;
ALTER TABLE one_shot_publication_authorizations ADD COLUMN content_binding_id TEXT;
