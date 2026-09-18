CREATE TABLE content_objects (
 sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE content_snapshots (
 id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('PRODUCTION','ONE_SHOT_ACCEPTANCE')),
 payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE content_confirmations (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
 snapshot_id TEXT NOT NULL REFERENCES content_snapshots(id) ON DELETE RESTRICT,
 intent_id TEXT REFERENCES submission_intents(id) ON DELETE RESTRICT,
 consumed INTEGER NOT NULL DEFAULT 0, runtime_identity_json TEXT, confirmed_at TEXT NOT NULL
);
ALTER TABLE submission_intents ADD COLUMN content_binding_id TEXT;
CREATE TRIGGER content_snapshot_no_update BEFORE UPDATE ON content_snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CONTENT_SNAPSHOT'); END;
CREATE TRIGGER content_snapshot_no_delete BEFORE DELETE ON content_snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CONTENT_SNAPSHOT'); END;
CREATE TRIGGER content_object_no_update BEFORE UPDATE ON content_objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CONTENT_OBJECT'); END;
CREATE TRIGGER content_object_no_delete BEFORE DELETE ON content_objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CONTENT_OBJECT'); END;
-- Legacy bindings are retained, not promoted to validated snapshots/confirmations.
CREATE UNIQUE INDEX content_confirmation_pending ON content_confirmations(job_id,snapshot_id) WHERE consumed=0;

CREATE TABLE content_snapshot_invalidations (
 snapshot_id TEXT PRIMARY KEY REFERENCES content_snapshots(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL, invalidated_at TEXT NOT NULL
);
CREATE TRIGGER content_article_changed AFTER UPDATE OF title,body,summary,tags_json ON articles
WHEN OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body OR OLD.summary IS NOT NEW.summary OR OLD.tags_json IS NOT NEW.tags_json
BEGIN
 INSERT OR IGNORE INTO content_snapshot_invalidations SELECT s.id,'ARTICLE_CHANGED',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM content_snapshots s JOIN publish_jobs j ON j.content_binding_id=s.id WHERE j.article_id=NEW.id;
END;
CREATE TRIGGER content_variant_changed AFTER UPDATE ON article_variants
BEGIN
 INSERT OR IGNORE INTO content_snapshot_invalidations SELECT s.id,'VARIANT_CHANGED',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM content_snapshots s JOIN publish_jobs j ON j.content_binding_id=s.id WHERE j.article_variant_id=NEW.id;
END;
CREATE TRIGGER content_job_selection_changed AFTER UPDATE OF account_id,platform_key,article_id,article_variant_id,selected_image_asset_id ON publish_jobs
WHEN OLD.account_id IS NOT NEW.account_id OR OLD.platform_key IS NOT NEW.platform_key OR OLD.article_id IS NOT NEW.article_id OR OLD.article_variant_id IS NOT NEW.article_variant_id OR OLD.selected_image_asset_id IS NOT NEW.selected_image_asset_id
BEGIN
 INSERT OR IGNORE INTO content_snapshot_invalidations SELECT id,'JOB_SELECTION_CHANGED',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM content_snapshots WHERE id=OLD.content_binding_id;
END;
CREATE TRIGGER content_asset_registration_changed AFTER UPDATE OF file_path,metadata_json ON media_assets
WHEN OLD.file_path IS NOT NEW.file_path OR OLD.metadata_json IS NOT NEW.metadata_json
BEGIN
 INSERT OR IGNORE INTO content_snapshot_invalidations SELECT s.id,'ASSET_REGISTRATION_CHANGED',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM content_snapshots s,json_each(s.payload_json,'$.images') i WHERE json_extract(i.value,'$.assetId')=NEW.id;
END;
