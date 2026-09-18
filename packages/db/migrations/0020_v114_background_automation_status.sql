PRAGMA foreign_keys = ON;

-- Background mode is opt-in by evidence. Existing and newly discovered
-- browser platforms remain UNKNOWN until an explicit user-run self-test
-- proves L1-L3 (and required image upload) in a headless context.
ALTER TABLE platforms ADD COLUMN background_automation_status TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK (background_automation_status IN ('UNKNOWN','PASSED','FAILED','REQUIRES_VISIBLE_BROWSER'));
ALTER TABLE platforms ADD COLUMN background_automation_last_tested_at TEXT;
ALTER TABLE platforms ADD COLUMN background_automation_reason TEXT;

-- Snapshot the user's final-submit choice on every job. Browser platforms
-- still capability-fallback to confirmation when no reviewed final-submit
-- automation exists; official API adapters may honor AUTO_PUBLISH directly.
ALTER TABLE publish_jobs ADD COLUMN final_publish_mode TEXT NOT NULL DEFAULT 'CONFIRM_BEFORE_PUBLISH'
  CHECK (final_publish_mode IN ('PREPARE_ONLY','CONFIRM_BEFORE_PUBLISH','AUTO_PUBLISH'));
