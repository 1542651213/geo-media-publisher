ALTER TABLE submission_intents ADD COLUMN final_submit_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_submission_intents_final_submit
  ON submission_intents(job_id, final_submit_count, state);
