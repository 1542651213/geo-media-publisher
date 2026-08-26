PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_studio_tasks (
  id TEXT PRIMARY KEY,
  parent_task_id TEXT REFERENCES content_studio_tasks(id) ON DELETE SET NULL,
  root_task_id TEXT NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  source_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS content_studio_versions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES content_studio_tasks(id) ON DELETE CASCADE,
  root_task_id TEXT NOT NULL REFERENCES content_studio_tasks(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  seo_keywords_json TEXT NOT NULL DEFAULT '[]',
  tone TEXT NOT NULL DEFAULT '',
  structure_json TEXT NOT NULL DEFAULT '[]',
  keyword_layout_json TEXT NOT NULL DEFAULT '{}',
  media_asset_ids_json TEXT NOT NULL DEFAULT '[]',
  video_asset_ids_json TEXT NOT NULL DEFAULT '[]',
  source_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  article_variant_id TEXT REFERENCES article_variants(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}',
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(root_task_id, platform_key, version_number)
);

CREATE INDEX IF NOT EXISTS idx_content_studio_tasks_brand_created ON content_studio_tasks(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_studio_tasks_status ON content_studio_tasks(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_content_studio_versions_history ON content_studio_versions(root_task_id, platform_key, version_number DESC);
