PRAGMA foreign_keys = ON;

-- One durable B01 opportunity per data directory. A revoked or consumed grant
-- cannot be replaced to replay the same acceptance under a new Job.
CREATE TABLE b01_product_e2e_authorization (
  id TEXT PRIMARY KEY CHECK (id = 'R1.15-B01'),
  platform_key TEXT NOT NULL CHECK (platform_key = 'douyin'),
  authorization_purpose TEXT NOT NULL CHECK (authorization_purpose = 'R1.15-B01'),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  article_content_hash TEXT NOT NULL,
  article_snapshot_sha256 TEXT NOT NULL CHECK (length(article_snapshot_sha256) = 64),
  image_asset_id TEXT NOT NULL REFERENCES media_assets(id),
  image_sha256 TEXT NOT NULL CHECK (length(image_sha256) = 64),
  job_id TEXT UNIQUE REFERENCES publish_jobs(id),
  status TEXT NOT NULL CHECK (status IN ('Created','Bound','Prepared','FinalApproved','Consumed','Revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  prepared_at TEXT,
  final_authorized_at TEXT,
  owner_final_approval_reference TEXT,
  consumed_at TEXT,
  revoked_at TEXT
);
