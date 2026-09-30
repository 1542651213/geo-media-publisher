-- Preserve every authorization and frozen binding. Only a proved pre-boundary retirement may permit a new, distinct attempt.
CREATE TABLE b01_product_e2e_authorization_forward (
  id TEXT PRIMARY KEY,
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
  retired_preboundary_at TEXT,
  revoked_at TEXT
);

INSERT INTO b01_product_e2e_authorization_forward (id,platform_key,authorization_purpose,account_id,article_id,article_content_hash,article_snapshot_sha256,image_asset_id,image_sha256,job_id,status,created_at,expires_at,prepared_at,final_authorized_at,owner_final_approval_reference,consumed_at,revoked_at) SELECT id,platform_key,authorization_purpose,account_id,article_id,article_content_hash,article_snapshot_sha256,image_asset_id,image_sha256,job_id,status,created_at,expires_at,prepared_at,final_authorized_at,owner_final_approval_reference,consumed_at,revoked_at FROM b01_product_e2e_authorization;
DROP TABLE b01_product_e2e_authorization;
ALTER TABLE b01_product_e2e_authorization_forward RENAME TO b01_product_e2e_authorization;
CREATE UNIQUE INDEX b01_one_active_authorization ON b01_product_e2e_authorization(authorization_purpose) WHERE status != 'Revoked';
