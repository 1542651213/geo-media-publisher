PRAGMA foreign_keys = ON;

-- One immutable settings and prepared-content snapshot per Toutiao article Job.
-- No historical publish records are updated by this migration.
CREATE TABLE IF NOT EXISTS toutiao_article_job_preparations (
  job_id TEXT PRIMARY KEY REFERENCES publish_jobs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  settings_version INTEGER NOT NULL,
  content_transport TEXT NOT NULL CHECK (content_transport = 'ARTICLE_WEB_API'),
  settings_json TEXT NOT NULL,
  canonical_payload_json TEXT,
  payload_hash TEXT,
  prepared_at TEXT,
  intent_id TEXT REFERENCES submission_intents(id),
  created_at TEXT NOT NULL,
  CHECK ((canonical_payload_json IS NULL AND payload_hash IS NULL AND prepared_at IS NULL)
    OR (canonical_payload_json IS NOT NULL AND payload_hash IS NOT NULL AND prepared_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_toutiao_article_preparation_intent
  ON toutiao_article_job_preparations(intent_id) WHERE intent_id IS NOT NULL;
