PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS quality_benchmark_runs (
  benchmark_run_id TEXT PRIMARY KEY,
  benchmark_id TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK(run_type IN ('MOCK_BASELINE', 'DEEPSEEK_REAL')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  temperature REAL,
  max_tokens INTEGER,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  total_token_usage_json TEXT NOT NULL DEFAULT '{}',
  estimated_cost REAL,
  similarity_summary_json TEXT NOT NULL DEFAULT '{}',
  block_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_benchmark_contents (
  id TEXT PRIMARY KEY,
  benchmark_run_id TEXT NOT NULL REFERENCES quality_benchmark_runs(benchmark_run_id) ON DELETE CASCADE,
  benchmark_id TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  topic_index INTEGER NOT NULL,
  topic TEXT NOT NULL,
  city TEXT NOT NULL,
  keyword TEXT NOT NULL,
  platform_key TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('article', 'video_script')),
  content_type_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  quality_status TEXT NOT NULL CHECK(quality_status IN ('Draft', 'AI_Checked', 'Needs_Review', 'Approved', 'Rejected')),
  risk_count INTEGER NOT NULL DEFAULT 0,
  revision_number INTEGER NOT NULL DEFAULT 0,
  is_current INTEGER NOT NULL DEFAULT 1,
  request_duration_ms INTEGER NOT NULL DEFAULT 0,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  intra_platform_similarity REAL,
  cross_platform_similarity REAL,
  created_at TEXT NOT NULL,
  UNIQUE(benchmark_run_id, topic_index, platform_key, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_quality_benchmark_contents_run_current ON quality_benchmark_contents(benchmark_run_id, is_current);
CREATE INDEX IF NOT EXISTS idx_quality_benchmark_contents_content ON quality_benchmark_contents(content_type_id, created_at DESC);

ALTER TABLE content_quality_reviews ADD COLUMN benchmark_run_id TEXT;
ALTER TABLE content_quality_audits ADD COLUMN benchmark_run_id TEXT;

