CREATE TABLE operations_account_company_bindings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  bound_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_operations_account_company ON operations_account_company_bindings(company_id, account_id);

CREATE TABLE operations_content_plans (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL,
  topic TEXT NOT NULL,
  content_type TEXT NOT NULL,
  target_platforms_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Planned','DraftCreated','Archived')),
  source TEXT NOT NULL CHECK(source IN ('Generated7','Generated30','Manual')),
  article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_operations_content_plans_company_date ON operations_content_plans(company_id, plan_date, created_at);

CREATE TABLE operations_facts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('Manual','Company Profile','Internal Document','Published Website','Verified Case')),
  source_date TEXT,
  verified_at TEXT,
  expires_at TEXT,
  approved_for_ai INTEGER NOT NULL DEFAULT 0 CHECK(approved_for_ai IN (0,1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_operations_facts_company_ai ON operations_facts(company_id, approved_for_ai, expires_at, updated_at);

CREATE TABLE operations_studio_defaults (
  company_id TEXT PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
  model TEXT,
  template_id TEXT,
  template_version INTEGER,
  purpose TEXT NOT NULL,
  target_platforms_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((template_id IS NULL AND template_version IS NULL) OR (template_id IS NOT NULL AND template_version IS NOT NULL))
);

CREATE TABLE operations_generation_queues (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES ai_provider_profiles(id) ON DELETE RESTRICT,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  topic TEXT NOT NULL,
  requested_count INTEGER NOT NULL CHECK(requested_count BETWEEN 1 AND 20),
  target_platforms_json TEXT NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('Pending','Running','Paused','Completed','Failed','Cancelled')),
  concurrency INTEGER NOT NULL DEFAULT 1 CHECK(concurrency BETWEEN 1 AND 4),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_operations_generation_queues_company ON operations_generation_queues(company_id, created_at DESC);

CREATE TABLE operations_generation_items (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES operations_generation_queues(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('Source','Variant')),
  target_platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Pending','Running','Completed','Failed','Cancelled','Recoverable','Blocked')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  generation_id TEXT REFERENCES ai_generation_history(generation_id) ON DELETE SET NULL,
  source_draft_id TEXT,
  output_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  error_code TEXT,
  available_after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(queue_id, source_index, item_kind, target_platform)
);
CREATE INDEX idx_operations_generation_items_queue_status ON operations_generation_items(queue_id, status, source_index, target_platform);
CREATE UNIQUE INDEX idx_operations_generation_items_generation ON operations_generation_items(generation_id) WHERE generation_id IS NOT NULL;
