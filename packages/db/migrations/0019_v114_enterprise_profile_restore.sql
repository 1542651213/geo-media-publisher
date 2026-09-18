PRAGMA foreign_keys = ON;

ALTER TABLE brands ADD COLUMN industry TEXT NOT NULL DEFAULT '';
ALTER TABLE brands ADD COLUMN official_website TEXT NOT NULL DEFAULT '';
ALTER TABLE brands ADD COLUMN notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS brand_knowledge_entries (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  source_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(brand_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_brand_knowledge_brand_category
  ON brand_knowledge_entries(brand_id, category, enabled, updated_at DESC);

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':advantages', id, 'enterprise_advantage', '企业优势',
       replace(replace(replace(trim(advantages_json), '[', ''), ']', ''), '"', ''),
       1, 'advantages', created_at, updated_at
FROM brands
WHERE trim(advantages_json) NOT IN ('', '[]');

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':service_process', id, 'service_process', '服务流程', service_process, 1, 'serviceProcess', created_at, updated_at
FROM brands WHERE trim(service_process) <> '';

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':after_sales', id, 'service_process', '售后服务', after_sales, 1, 'afterSales', created_at, updated_at
FROM brands WHERE trim(after_sales) <> '';

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':faq', id, 'other_material', '常见问题', faq, 1, 'faq', created_at, updated_at
FROM brands WHERE trim(faq) <> '';

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':certificates', id, 'qualification_certificate', '资质证书', certificates, 1, 'certificates', created_at, updated_at
FROM brands WHERE trim(certificates) <> '';

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':patents', id, 'patent', '专利', patents, 1, 'patents', created_at, updated_at
FROM brands WHERE trim(patents) <> '';

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':equipment', id, 'equipment', '设备', equipment, 1, 'equipment', created_at, updated_at
FROM brands WHERE trim(equipment) <> '';

INSERT OR IGNORE INTO brand_knowledge_entries (id, brand_id, category, title, content, enabled, source_key, created_at, updated_at)
SELECT 'legacy:' || id || ':cases', id, 'case', '案例', cases, 1, 'cases', created_at, updated_at
FROM brands WHERE trim(cases) <> '';
