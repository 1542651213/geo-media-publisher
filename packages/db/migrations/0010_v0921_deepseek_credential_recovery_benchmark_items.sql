PRAGMA foreign_keys = ON;

ALTER TABLE quality_benchmark_runs ADD COLUMN control_status TEXT NOT NULL DEFAULT 'RUNNING' CHECK(control_status IN ('RUNNING', 'PAUSED', 'CANCELLED'));

CREATE TABLE IF NOT EXISTS quality_benchmark_items (
  id TEXT PRIMARY KEY,
  benchmark_run_id TEXT NOT NULL REFERENCES quality_benchmark_runs(benchmark_run_id) ON DELETE CASCADE,
  benchmark_id TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  topic_index INTEGER NOT NULL,
  topic TEXT NOT NULL,
  city TEXT NOT NULL,
  keyword TEXT NOT NULL,
  business TEXT NOT NULL,
  platform_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Pending', 'Running', 'Success', 'Failed', 'RetryableFailure')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  content_studio_task_id TEXT,
  content_type_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  request_duration_ms INTEGER NOT NULL DEFAULT 0,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(benchmark_run_id, topic_index, platform_key)
);

CREATE INDEX IF NOT EXISTS idx_quality_benchmark_items_run_status ON quality_benchmark_items(benchmark_run_id, status, topic_index, platform_key);
