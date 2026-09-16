PRAGMA foreign_keys = ON;

ALTER TABLE articles ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'unchecked';
ALTER TABLE platforms ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'Unverified';
ALTER TABLE articles ADD COLUMN quality_warnings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE publish_jobs ADD COLUMN publish_record_id TEXT;
ALTER TABLE publish_jobs ADD COLUMN last_polled_at TEXT;
ALTER TABLE publish_records ADD COLUMN status TEXT NOT NULL DEFAULT 'Published';
ALTER TABLE ai_tasks ADD COLUMN next_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN updated_at TEXT;

ALTER TABLE platform_profiles ADD COLUMN min_body_length INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_profiles ADD COLUMN max_body_length INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_profiles ADD COLUMN cover_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_profiles ADD COLUMN cover_sizes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE platform_profiles ADD COLUMN max_images INTEGER NOT NULL DEFAULT 1;
ALTER TABLE platform_profiles ADD COLUMN max_tags INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_profiles ADD COLUMN supports_html INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ai_provider_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.7,
  max_output_tokens INTEGER NOT NULL DEFAULT 3000,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  retry_count INTEGER NOT NULL DEFAULT 2,
  concurrency INTEGER NOT NULL DEFAULT 2,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_fallback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS city_regions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  district TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(brand_id, province, city, district)
);

CREATE INDEX IF NOT EXISTS idx_articles_brand_status_created ON articles(brand_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_due_v03 ON publish_jobs(status, scheduled_at, next_retry_at, platform_key, account_id);
CREATE INDEX IF NOT EXISTS idx_jobs_account_status ON publish_jobs(account_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_records_job_status ON publish_records(job_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_records_account_platform ON publish_records(account_id, platform_key, published_at);
CREATE INDEX IF NOT EXISTS idx_keywords_brand_city ON keyword_items(brand_id, city, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_updated ON ai_tasks(status, updated_at, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_level_module_created ON app_logs(level, module, created_at);
