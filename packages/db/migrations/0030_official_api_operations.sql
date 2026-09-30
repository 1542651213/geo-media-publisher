PRAGMA foreign_keys = ON;

CREATE TABLE official_api_operations (
  job_id TEXT PRIMARY KEY REFERENCES publish_jobs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  source_article_id TEXT NOT NULL REFERENCES articles(id),
  site_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
  key_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  content_binding_id TEXT NOT NULL CHECK (length(content_binding_id) = 64),
  phase TEXT NOT NULL CHECK (phase IN ('PREPARING','PREPARED','PUBLISH_DISPATCHING','PUBLISH_ACCEPTED','PUBLISHING','PUBLISHED','FAILED','NEEDS_RECONCILIATION')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  remote_content_id TEXT,
  remote_revision_id TEXT,
  remote_content_hash TEXT,
  remote_row_version INTEGER,
  remote_job_id TEXT,
  public_url TEXT,
  journal_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, source_article_id)
);

CREATE INDEX idx_official_api_operations_phase ON official_api_operations(phase, updated_at);
CREATE UNIQUE INDEX idx_official_api_operations_remote_content ON official_api_operations(site_id, environment, key_id, remote_content_id)
  WHERE remote_content_id IS NOT NULL;
CREATE UNIQUE INDEX idx_official_api_operations_remote_job ON official_api_operations(remote_job_id)
  WHERE remote_job_id IS NOT NULL;
