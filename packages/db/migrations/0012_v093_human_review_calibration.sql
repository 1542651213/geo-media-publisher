PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS human_review_datasets (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL UNIQUE,
  benchmark_run_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('WAITING_FOR_HUMAN_REVIEW','HUMAN_REVIEW_COMPLETED')) DEFAULT 'WAITING_FOR_HUMAN_REVIEW',
  target_count INTEGER NOT NULL DEFAULT 20,
  completed_count INTEGER NOT NULL DEFAULT 0,
  selection_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_review_dataset_items (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES human_review_datasets(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('article','article_variant')),
  content_id TEXT NOT NULL,
  benchmark_content_id TEXT NOT NULL,
  topic_index INTEGER NOT NULL,
  topic TEXT NOT NULL,
  city TEXT NOT NULL,
  keyword TEXT NOT NULL,
  business TEXT NOT NULL,
  platform_key TEXT,
  title_snapshot TEXT NOT NULL,
  original_content_json TEXT NOT NULL,
  original_status TEXT NOT NULL CHECK(original_status IN ('Draft','AI_Checked','Needs_Review','Approved','Rejected')),
  original_risk_count INTEGER NOT NULL DEFAULT 0,
  original_content_hash TEXT NOT NULL,
  selection_reason TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK(review_status IN ('Pending','Completed')) DEFAULT 'Pending',
  final_status TEXT CHECK(final_status IN ('AI_Checked','Needs_Review','Approved','Rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(dataset_id, content_type, content_id),
  UNIQUE(dataset_id, sequence)
);

CREATE TABLE IF NOT EXISTS human_review_item_reviews (
  id TEXT PRIMARY KEY,
  dataset_item_id TEXT NOT NULL REFERENCES human_review_dataset_items(id) ON DELETE CASCADE,
  reviewer_type TEXT NOT NULL CHECK(reviewer_type IN ('human')),
  reviewed_at TEXT NOT NULL,
  original_status TEXT NOT NULL CHECK(original_status IN ('Draft','AI_Checked','Needs_Review','Approved','Rejected')),
  final_status TEXT NOT NULL CHECK(final_status IN ('AI_Checked','Needs_Review','Approved','Rejected')),
  review_duration_ms INTEGER NOT NULL DEFAULT 0,
  edit_count INTEGER NOT NULL DEFAULT 0,
  original_content_hash TEXT NOT NULL,
  final_content_hash TEXT NOT NULL,
  original_content_json TEXT NOT NULL,
  final_content_json TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_review_issue_decisions (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES human_review_item_reviews(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  issue_index INTEGER NOT NULL,
  machine_decision TEXT NOT NULL CHECK(machine_decision IN ('Detected','NotDetected')),
  human_decision TEXT NOT NULL CHECK(human_decision IN ('TruePositive','FalsePositive','Uncertain','MissedIssue')),
  reason TEXT,
  issue_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(review_id, rule_id, issue_index)
);

CREATE INDEX IF NOT EXISTS idx_human_review_datasets_status ON human_review_datasets(status);
CREATE INDEX IF NOT EXISTS idx_human_review_dataset_items_dataset ON human_review_dataset_items(dataset_id, sequence);
CREATE INDEX IF NOT EXISTS idx_human_review_item_reviews_item ON human_review_item_reviews(dataset_item_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_human_review_issue_decisions_review ON human_review_issue_decisions(review_id);
