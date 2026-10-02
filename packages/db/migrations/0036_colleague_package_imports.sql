CREATE TABLE colleague_package_imports (
  package_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES brands(id), article_count INTEGER NOT NULL,
  asset_count INTEGER NOT NULL, imported_at TEXT NOT NULL
);
