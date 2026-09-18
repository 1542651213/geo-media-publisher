-- A formal production pilot is a bounded, durable authorization.  It is
-- deliberately independent of the historical one-shot/Task10S tables.
CREATE TABLE production_pilot_authorizations (
  pilot_id TEXT PRIMARY KEY,
  platform_key TEXT NOT NULL CHECK (platform_key = 'xiaohongshu'),
  expires_at TEXT NOT NULL,
  max_final_submissions INTEGER NOT NULL CHECK (max_final_submissions BETWEEN 1 AND 3),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A prepared editor is registered before confirmation.  This prevents a
-- historical Prepared Job from being manually run inside the pilot window.
CREATE TABLE production_pilot_prepared_bindings (
  pilot_id TEXT NOT NULL REFERENCES production_pilot_authorizations(pilot_id) ON DELETE RESTRICT,
  job_id TEXT PRIMARY KEY REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL REFERENCES content_snapshots(id) ON DELETE RESTRICT,
  publish_record_id TEXT NOT NULL UNIQUE REFERENCES publish_records(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  platform_key TEXT NOT NULL CHECK (platform_key = 'xiaohongshu'),
  creator_id TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  UNIQUE (pilot_id, job_id)
);
CREATE TRIGGER production_pilot_prepared_binding_immutable
BEFORE UPDATE ON production_pilot_prepared_bindings
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PRODUCTION_PILOT_PREPARED_BINDING');
END;

-- A row is written in the same IMMEDIATE transaction as F01's final-submit
-- claim.  Its immutable binding makes a process restart or package change
-- unable to create a replacement slot for the same real operation.
CREATE TABLE production_pilot_slots (
  pilot_id TEXT NOT NULL REFERENCES production_pilot_authorizations(pilot_id) ON DELETE RESTRICT,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 3),
  job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  intent_id TEXT NOT NULL UNIQUE REFERENCES submission_intents(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL REFERENCES content_snapshots(id) ON DELETE RESTRICT,
  publish_record_id TEXT NOT NULL UNIQUE REFERENCES publish_records(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  platform_key TEXT NOT NULL CHECK (platform_key = 'xiaohongshu'),
  creator_id TEXT NOT NULL,
  build_sha256 TEXT NOT NULL CHECK (length(build_sha256) = 64),
  state TEXT NOT NULL CHECK (state IN ('Claimed','Unknown','Accepted','Published')),
  claimed_at TEXT NOT NULL,
  unknown_error_code TEXT,
  accepted_external_id TEXT,
  accepted_url TEXT,
  receipt_sha256 TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pilot_id, slot_number),
  UNIQUE (pilot_id, job_id)
);
CREATE INDEX idx_production_pilot_slots_state ON production_pilot_slots(pilot_id, state, slot_number);
CREATE TRIGGER production_pilot_slot_binding_immutable
BEFORE UPDATE OF pilot_id, slot_number, job_id, intent_id, snapshot_id, publish_record_id, account_id, article_id, platform_key, creator_id, build_sha256 ON production_pilot_slots
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PRODUCTION_PILOT_SLOT');
END;
