PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  main_business TEXT NOT NULL DEFAULT '',
  service_regions_json TEXT NOT NULL DEFAULT '[]',
  advantages_json TEXT NOT NULL DEFAULT '[]',
  contact_json TEXT NOT NULL DEFAULT '{}',
  established_at TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  service_process TEXT NOT NULL DEFAULT '',
  after_sales TEXT NOT NULL DEFAULT '',
  faq TEXT NOT NULL DEFAULT '',
  certificates TEXT NOT NULL DEFAULT '',
  patents TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '',
  cases TEXT NOT NULL DEFAULT '',
  ai_forbidden_claims_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_assets (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keyword_templates (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  template TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '通用',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS keyword_items (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  keyword TEXT NOT NULL,
  source_template_id TEXT NOT NULL REFERENCES keyword_templates(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  UNIQUE(brand_id, city, keyword)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  topic TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  seo_keywords_json TEXT NOT NULL DEFAULT '[]',
  cover_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  article_type TEXT NOT NULL DEFAULT '科普',
  ai_provider TEXT NOT NULL,
  ai_model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  reuse_policy TEXT NOT NULL DEFAULT 'once',
  content_hash TEXT NOT NULL UNIQUE,
  use_count INTEGER NOT NULL DEFAULT 0,
  publish_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_variants (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cover_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(article_id, platform_key)
);

CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,
  platform_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  adapter_status TEXT NOT NULL DEFAULT 'not_implemented',
  adapter_version TEXT NOT NULL DEFAULT '0.1.0',
  enabled INTEGER NOT NULL DEFAULT 1,
  capabilities_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS account_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  platform_key TEXT NOT NULL REFERENCES platforms(platform_key),
  name TEXT NOT NULL,
  group_id TEXT REFERENCES account_groups(id) ON DELETE SET NULL,
  encrypted_session_path TEXT,
  login_status TEXT NOT NULL DEFAULT 'unknown',
  enabled INTEGER NOT NULL DEFAULT 1,
  paused_reason TEXT,
  last_login_check_at TEXT,
  last_publish_at TEXT,
  today_publish_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  strategy TEXT NOT NULL DEFAULT 'same_article',
  articles_per_day INTEGER NOT NULL DEFAULT 1,
  time_rules_json TEXT NOT NULL DEFAULT '{}',
  account_scope_json TEXT NOT NULL DEFAULT '[]',
  reuse_policy TEXT NOT NULL DEFAULT 'once',
  min_interval_seconds INTEGER NOT NULL DEFAULT 60,
  max_retries INTEGER NOT NULL DEFAULT 3,
  consecutive_failure_threshold INTEGER NOT NULL DEFAULT 3,
  start_date TEXT NOT NULL,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  plan_id TEXT REFERENCES publish_plans(id) ON DELETE SET NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  article_variant_id TEXT REFERENCES article_variants(id) ON DELETE SET NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_retry_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  published_url TEXT,
  published_external_id TEXT,
  success INTEGER NOT NULL,
  response_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  cost_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  module TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_due ON publish_jobs(status, scheduled_at, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_created ON app_logs(created_at);
