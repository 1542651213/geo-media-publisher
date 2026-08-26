PRAGMA foreign_keys = ON;

ALTER TABLE platforms ADD COLUMN integration_mode TEXT NOT NULL DEFAULT 'Manual';

ALTER TABLE publish_records ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE publish_records ADD COLUMN automation_type TEXT NOT NULL DEFAULT 'Manual';
ALTER TABLE publish_records ADD COLUMN browser_session_id_hash TEXT;
ALTER TABLE publish_records ADD COLUMN operator TEXT NOT NULL DEFAULT 'desktop-user';
ALTER TABLE publish_records ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'NotTested';

CREATE INDEX IF NOT EXISTS idx_publish_records_automation ON publish_records(platform_key, automation_type, published_at);
