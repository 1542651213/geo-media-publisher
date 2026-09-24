PRAGMA foreign_keys = ON;

-- The singleton is a durable, process-wide formal execution lease. A restart
-- reconciles the owner before the lease can be acquired again.
CREATE TABLE IF NOT EXISTS global_formal_publish_execution (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  job_id TEXT NOT NULL REFERENCES publish_jobs(id),
  owner_pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  execution_phase TEXT NOT NULL,
  submit_boundary_entered_at TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE submission_intents ADD COLUMN submission_attempt_id TEXT;
ALTER TABLE submission_intents ADD COLUMN submit_boundary_entered_at TEXT;
ALTER TABLE submission_intents ADD COLUMN payload_hash TEXT;
ALTER TABLE submission_intents ADD COLUMN adapter_id TEXT;
ALTER TABLE submission_intents ADD COLUMN credential_version TEXT;
ALTER TABLE submission_intents ADD COLUMN remote_request_started_at TEXT;
ALTER TABLE submission_intents ADD COLUMN remote_response_received_at TEXT;
ALTER TABLE submission_intents ADD COLUMN remote_status TEXT NOT NULL DEFAULT 'SUBMIT_NOT_STARTED';
ALTER TABLE submission_intents ADD COLUMN reconciliation_required INTEGER NOT NULL DEFAULT 0;

ALTER TABLE publish_records ADD COLUMN submission_attempt_id TEXT;
ALTER TABLE publish_records ADD COLUMN remote_status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_intents_attempt_id
  ON submission_intents(submission_attempt_id) WHERE submission_attempt_id IS NOT NULL;
