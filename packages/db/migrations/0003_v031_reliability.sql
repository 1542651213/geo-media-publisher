PRAGMA foreign_keys = ON;

ALTER TABLE accounts ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'inherit';
ALTER TABLE publish_jobs ADD COLUMN submission_intent_id TEXT;
ALTER TABLE publish_jobs ADD COLUMN external_id TEXT;
ALTER TABLE ai_tasks ADD COLUMN batch_id TEXT;

CREATE TABLE IF NOT EXISTS submission_intents (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'Prepared',
  external_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, attempt)
);

CREATE TABLE IF NOT EXISTS ai_batches (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES ai_tasks(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  total_count INTEGER NOT NULL,
  concurrency INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ai_batches(id) ON DELETE CASCADE,
  keyword_id TEXT,
  city TEXT NOT NULL,
  keyword TEXT NOT NULL,
  article_type TEXT NOT NULL,
  target_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  last_error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, target_index)
);

CREATE INDEX IF NOT EXISTS idx_submission_intents_job_state ON submission_intents(job_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_batches_task_status ON ai_batches(task_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_batch_items_claim ON ai_batch_items(batch_id, status, target_index);
