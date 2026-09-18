-- A claimed send is never reusable merely because a Job status was changed.
-- RESTRICT preserves the barrier when a parent is deleted/cancelled.
CREATE TABLE submission_dispatch_claims (
  intent_id TEXT PRIMARY KEY REFERENCES submission_intents(id) ON DELETE RESTRICT,
  job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  platform_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Claimed','Accepted','NotSubmitted')),
  claimed_at TEXT NOT NULL,
  resolution_json TEXT,
  resolved_at TEXT
);
CREATE INDEX idx_submission_dispatch_scope ON submission_dispatch_claims(account_id,platform_key,article_id,state);
-- Older Prepared/API and manually cleared intents have no durable evidence of
-- non-dispatch. Preserve each legacy row, including duplicate scopes, for review.
INSERT INTO submission_dispatch_claims(intent_id,job_id,account_id,article_id,platform_key,state,claimed_at)
SELECT id,job_id,account_id,article_id,platform_key,
  CASE WHEN state='Submitted' THEN 'Accepted' ELSE 'Claimed' END,updated_at
FROM submission_intents;
UPDATE submission_intents SET state='Unknown', error_code='LEGACY_SUBMISSION_REQUIRES_RECONCILIATION'
WHERE state<>'Submitted';
UPDATE publish_jobs SET status='NeedsReconciliation',next_retry_at=NULL,last_error_code='LEGACY_SUBMISSION_REQUIRES_RECONCILIATION'
WHERE id IN (SELECT job_id FROM submission_intents WHERE state='Unknown')
  AND status NOT IN ('Success','Published','Publishing','Submitted');
