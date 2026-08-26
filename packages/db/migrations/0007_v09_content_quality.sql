PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_quality_states (
  content_type TEXT NOT NULL CHECK(content_type IN ('article', 'article_variant')),
  content_id TEXT NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform_key TEXT,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'AI_Checked', 'Needs_Review', 'Approved', 'Rejected')),
  content_hash TEXT NOT NULL,
  last_review_id TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(content_type, content_id)
);

CREATE TABLE IF NOT EXISTS content_quality_reviews (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK(content_type IN ('article', 'article_variant')),
  content_id TEXT NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('AI_Checked', 'Needs_Review', 'Approved', 'Rejected')),
  trigger TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  score INTEGER NOT NULL,
  checks_json TEXT NOT NULL DEFAULT '[]',
  issues_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_quality_reviews_content ON content_quality_reviews(content_type, content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_quality_states_status ON content_quality_states(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_quality_states_brand ON content_quality_states(brand_id, status, updated_at DESC);

ALTER TABLE content_studio_versions ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'Draft';
ALTER TABLE content_studio_versions ADD COLUMN quality_review_id TEXT;
