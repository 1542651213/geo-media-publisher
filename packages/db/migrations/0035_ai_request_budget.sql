CREATE TABLE ai_request_budgets (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES brands(id), kind TEXT NOT NULL CHECK(kind IN ('Studio','Queue')),
  request_fingerprint TEXT NOT NULL, snapshot_fingerprint TEXT NOT NULL, preview_json TEXT NOT NULL,
  max_requests INTEGER NOT NULL CHECK(max_requests BETWEEN 1 AND 1000), issued_requests INTEGER NOT NULL DEFAULT 0 CHECK(issued_requests>=0),
  status TEXT NOT NULL CHECK(status IN ('Preview','Active','Stale')), created_at TEXT NOT NULL
);
CREATE TABLE ai_request_journal (
  id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES ai_request_budgets(id), generation_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('Base','TitleRepair')), status TEXT NOT NULL CHECK(status IN ('Started','Succeeded','Failed','Unknown')),
  error_code TEXT, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX idx_ai_request_budget_company ON ai_request_budgets(company_id,created_at);
CREATE INDEX idx_ai_request_journal_budget ON ai_request_journal(budget_id,created_at);
ALTER TABLE operations_generation_queues ADD COLUMN request_budget_id TEXT REFERENCES ai_request_budgets(id);
ALTER TABLE operations_generation_queues ADD COLUMN snapshot_fingerprint TEXT;
CREATE TABLE operations_generation_attempts (
  item_id TEXT NOT NULL REFERENCES operations_generation_items(id), generation_id TEXT NOT NULL REFERENCES ai_generation_history(generation_id),
  created_at TEXT NOT NULL, PRIMARY KEY(item_id,generation_id)
);

ALTER TABLE ai_generation_history ADD COLUMN request_budget_id TEXT REFERENCES ai_request_budgets(id);
