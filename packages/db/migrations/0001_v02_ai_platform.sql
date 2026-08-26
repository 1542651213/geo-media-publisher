PRAGMA foreign_keys = ON;

ALTER TABLE platforms ADD COLUMN research_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE platforms ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE platforms ADD COLUMN last_verified_at TEXT;

ALTER TABLE accounts ADD COLUMN allow_auto_publish INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN minimum_interval_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE publish_jobs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 1;
ALTER TABLE publish_jobs ADD COLUMN manual_confirmation_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE publish_jobs ADD COLUMN confirmed_at TEXT;

ALTER TABLE publish_records ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 1;

ALTER TABLE ai_tasks ADD COLUMN usage_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_tasks ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS platform_profiles (
  platform_key TEXT PRIMARY KEY REFERENCES platforms(platform_key) ON DELETE CASCADE,
  style TEXT NOT NULL DEFAULT '',
  title_limit INTEGER NOT NULL DEFAULT 100,
  preferred_min_words INTEGER NOT NULL DEFAULT 300,
  preferred_max_words INTEGER NOT NULL DEFAULT 2000,
  supports_cover INTEGER NOT NULL DEFAULT 0,
  supports_tags INTEGER NOT NULL DEFAULT 0,
  supports_markdown INTEGER NOT NULL DEFAULT 0,
  supports_rich_text INTEGER NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL DEFAULT '',
  research_status TEXT NOT NULL DEFAULT 'unverified',
  last_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS platform_health (
  platform_key TEXT PRIMARY KEY REFERENCES platforms(platform_key) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS account_sessions (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_ref TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'safe-storage',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_tasks (
  id TEXT PRIMARY KEY,
  article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_health_status ON platform_health(status);
