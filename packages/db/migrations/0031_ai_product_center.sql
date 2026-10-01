CREATE TABLE ai_enterprise_contexts (
  company_id TEXT PRIMARY KEY REFERENCES brands(id), context_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE ai_prompt_templates (
  template_id TEXT NOT NULL, version INTEGER NOT NULL, template_json TEXT NOT NULL,
  PRIMARY KEY(template_id,version)
);
CREATE TABLE ai_generation_history (
  generation_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES brands(id), source_article_id TEXT REFERENCES articles(id),
  provider TEXT NOT NULL, model TEXT NOT NULL, template_id TEXT NOT NULL, template_version INTEGER NOT NULL,
  target_platform TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, token_usage_json TEXT,
  error_code TEXT, output_article_id TEXT REFERENCES articles(id), variant_id TEXT REFERENCES article_variants(id)
);
CREATE TABLE ai_local_drafts (
  generation_id TEXT PRIMARY KEY REFERENCES ai_generation_history(generation_id), title TEXT NOT NULL,
  body TEXT NOT NULL, validation_json TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'article'
);
CREATE TABLE ai_generation_inputs (
  generation_id TEXT PRIMARY KEY REFERENCES ai_generation_history(generation_id),
  profile_id TEXT NOT NULL, purpose TEXT NOT NULL, context_version INTEGER NOT NULL,
  context_hash TEXT NOT NULL, source_hash TEXT NOT NULL, context_json TEXT NOT NULL, source_text TEXT NOT NULL
);
CREATE TABLE ai_provider_verifications (
  profile_id TEXT PRIMARY KEY REFERENCES ai_provider_profiles(id) ON DELETE CASCADE,
  last_verified_at TEXT, status TEXT NOT NULL, error_code TEXT, is_default INTEGER NOT NULL DEFAULT 0
);
