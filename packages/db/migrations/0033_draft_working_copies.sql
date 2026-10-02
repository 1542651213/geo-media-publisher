CREATE TABLE draft_working_copies (
  copy_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  document_kind TEXT NOT NULL CHECK(document_kind IN ('Article','StudioGeneration')),
  document_id TEXT NOT NULL,
  base_version TEXT NOT NULL,
  local_version INTEGER NOT NULL DEFAULT 0 CHECK(local_version >= 0),
  base_snapshot_json TEXT NOT NULL,
  base_snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  active_editing INTEGER NOT NULL DEFAULT 0 CHECK(active_editing IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('Editing','Recovered','Conflict','Committed','Discarded')),
  commit_result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  persisted_at TEXT NOT NULL
);
CREATE INDEX idx_draft_working_copies_document ON draft_working_copies(company_id,document_kind,document_id,status);
CREATE INDEX idx_draft_working_copies_recovery ON draft_working_copies(company_id,status,updated_at DESC);
