PRAGMA foreign_keys = ON;

ALTER TABLE platforms ADD COLUMN transport TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE platforms ADD COLUMN blocking_reason TEXT;
ALTER TABLE platforms ADD COLUMN official_website TEXT NOT NULL DEFAULT '';
ALTER TABLE platforms ADD COLUMN developer_portal TEXT;
ALTER TABLE platforms ADD COLUMN credential_schema_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE platforms ADD COLUMN official_sources_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS video_assets (
  id TEXT PRIMARY KEY,
  local_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);

ALTER TABLE publish_jobs ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'article';
ALTER TABLE publish_jobs ADD COLUMN video_asset_id TEXT REFERENCES video_assets(id) ON DELETE SET NULL;
ALTER TABLE publish_jobs ADD COLUMN publish_payload_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS account_authorizations (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL REFERENCES platforms(platform_key) ON DELETE CASCADE,
  authorization_type TEXT NOT NULL,
  encrypted_token_ref TEXT,
  status TEXT NOT NULL DEFAULT 'not_authorized',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, platform_key)
);

CREATE INDEX IF NOT EXISTS idx_jobs_content_kind_status ON publish_jobs(content_kind, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_authorizations_status ON account_authorizations(platform_key, status);
