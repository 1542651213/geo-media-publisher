PRAGMA foreign_keys = ON;

-- Self-test evidence is kept separate from platform lifecycle state and from
-- ordinary production content. No credential, Cookie, token or secret belongs
-- in either table.
CREATE TABLE IF NOT EXISTS platform_self_test_runs (
  id TEXT PRIMARY KEY,
  test_run_id TEXT NOT NULL UNIQUE,
  platform_key TEXT NOT NULL,
  platform_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_level TEXT NOT NULL,
  overall_result TEXT NOT NULL DEFAULT 'NOT_TESTED',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_tested_at TEXT NOT NULL,
  publish_confirmed_at TEXT,
  delete_confirmed_at TEXT,
  test_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  publish_job_id TEXT REFERENCES publish_jobs(id) ON DELETE SET NULL,
  publish_record_id TEXT REFERENCES publish_records(id) ON DELETE SET NULL,
  external_id TEXT,
  external_url TEXT,
  cleanup_status TEXT NOT NULL DEFAULT 'NOT_AVAILABLE',
  cleaned_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_self_test_steps (
  id TEXT PRIMARY KEY,
  test_run_id TEXT NOT NULL REFERENCES platform_self_test_runs(test_run_id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL,
  platform_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  test_level TEXT NOT NULL,
  step_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT NOT NULL DEFAULT 'NOT_TESTED',
  error_code TEXT,
  message TEXT,
  verification_signal TEXT,
  external_id TEXT,
  external_url TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(test_run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_self_test_runs_account
  ON platform_self_test_runs(platform_account_id, last_tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_self_test_runs_platform
  ON platform_self_test_runs(platform_key, last_tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_self_test_steps_run_level
  ON platform_self_test_steps(test_run_id, test_level, started_at);
