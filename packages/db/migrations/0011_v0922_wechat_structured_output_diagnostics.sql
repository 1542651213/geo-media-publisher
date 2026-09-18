PRAGMA foreign_keys = ON;

ALTER TABLE quality_benchmark_items ADD COLUMN failure_category TEXT;
ALTER TABLE quality_benchmark_items ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS quality_benchmark_item_attempts (
  id TEXT PRIMARY KEY,
  benchmark_item_id TEXT NOT NULL REFERENCES quality_benchmark_items(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Success', 'Failed', 'RetryableFailure')),
  failure_category TEXT,
  error_code TEXT,
  error_message TEXT,
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  finish_reason TEXT,
  response_length INTEGER NOT NULL DEFAULT 0,
  request_duration_ms INTEGER NOT NULL DEFAULT 0,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(benchmark_item_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_quality_benchmark_item_attempts_item ON quality_benchmark_item_attempts(benchmark_item_id, attempt_number);

INSERT OR IGNORE INTO quality_benchmark_item_attempts (id, benchmark_item_id, attempt_number, status, failure_category, error_code, error_message, diagnostics_json, request_duration_ms, token_usage_json, created_at)
SELECT id || ':legacy:' || attempt_count, id, attempt_count, 'Failed', 'LEGACY_UNCLASSIFIED', error_code, error_message, '{"legacy":true}', request_duration_ms, token_usage_json, updated_at
FROM quality_benchmark_items
WHERE status='Failed' AND attempt_count > 0;

PRAGMA foreign_keys = ON;
