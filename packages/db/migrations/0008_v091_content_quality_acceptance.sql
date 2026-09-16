PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_content_rules (
  platform_key TEXT PRIMARY KEY,
  title_min_length INTEGER NOT NULL DEFAULT 1,
  title_max_length INTEGER NOT NULL DEFAULT 40,
  body_min_length INTEGER NOT NULL DEFAULT 80,
  body_max_length INTEGER NOT NULL DEFAULT 2000,
  summary_max_length INTEGER NOT NULL DEFAULT 120,
  max_tags INTEGER NOT NULL DEFAULT 5,
  max_images INTEGER NOT NULL DEFAULT 1,
  supports_links INTEGER NOT NULL DEFAULT 0,
  supports_markdown INTEGER NOT NULL DEFAULT 0,
  supports_html INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL CHECK(content_type IN ('article', 'video_script', 'mixed')),
  source TEXT,
  last_verified_at TEXT,
  verification_status TEXT NOT NULL CHECK(verification_status IN ('verified', 'unverified')) DEFAULT 'unverified',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO platform_content_rules (platform_key,title_min_length,title_max_length,body_min_length,body_max_length,summary_max_length,max_tags,max_images,supports_links,supports_markdown,supports_html,content_type,source,last_verified_at,verification_status,updated_at) VALUES
  ('wechat_official', 1, 40, 80, 2000, 120, 5, 1, 0, 0, 0, 'article', NULL, NULL, 'unverified', datetime('now')),
  ('zhihu', 1, 40, 80, 2000, 120, 5, 1, 0, 0, 0, 'article', NULL, NULL, 'unverified', datetime('now')),
  ('toutiao', 1, 40, 80, 2000, 120, 5, 1, 0, 0, 0, 'article', NULL, NULL, 'unverified', datetime('now')),
  ('weibo', 1, 40, 80, 2000, 120, 5, 1, 0, 0, 0, 'article', NULL, NULL, 'unverified', datetime('now')),
  ('douyin', 1, 40, 80, 2000, 120, 5, 1, 0, 0, 0, 'video_script', NULL, NULL, 'unverified', datetime('now')),
  ('bilibili', 1, 40, 80, 2000, 120, 5, 1, 0, 0, 0, 'video_script', NULL, NULL, 'unverified', datetime('now'));

ALTER TABLE content_quality_reviews ADD COLUMN operator_type TEXT NOT NULL DEFAULT 'system';
ALTER TABLE content_quality_reviews ADD COLUMN previous_status TEXT;
ALTER TABLE content_quality_reviews ADD COLUMN new_status TEXT;
ALTER TABLE content_quality_reviews ADD COLUMN reason TEXT;

CREATE TABLE IF NOT EXISTS content_quality_audits (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK(content_type IN ('article', 'article_variant')),
  content_id TEXT NOT NULL,
  operator_type TEXT NOT NULL CHECK(operator_type IN ('system', 'human')),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_quality_audits_content ON content_quality_audits(content_type, content_id, timestamp DESC);
