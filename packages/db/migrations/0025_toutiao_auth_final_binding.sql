PRAGMA foreign_keys = ON;

-- Keep 0024 payload_hash as the historical full-snapshot checksum.
-- The semantic content hash excludes preparation timestamps and local paths.
ALTER TABLE toutiao_article_job_preparations ADD COLUMN content_binding_hash TEXT;

CREATE TABLE IF NOT EXISTS toutiao_article_credential_metadata (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  bundle_version INTEGER NOT NULL CHECK (bundle_version > 0),
  login_generation INTEGER NOT NULL CHECK (login_generation > 0),
  credential_state TEXT NOT NULL CHECK (credential_state IN ('VALID','INVALID','UNKNOWN')),
  credential_fingerprint TEXT NOT NULL,
  validated_at TEXT,
  updated_at TEXT NOT NULL
);

-- Only non-secret pre-submit evidence is stored here. No signature or auth response.
CREATE TABLE IF NOT EXISTS toutiao_article_final_bindings (
  job_id TEXT PRIMARY KEY REFERENCES toutiao_article_job_preparations(job_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  content_binding_hash TEXT NOT NULL,
  final_payload_hash TEXT NOT NULL,
  credential_bundle_version INTEGER NOT NULL,
  login_generation INTEGER NOT NULL,
  signer_version TEXT NOT NULL,
  signer_input_hash TEXT NOT NULL,
  signature_generated_at TEXT NOT NULL,
  auth_validated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
