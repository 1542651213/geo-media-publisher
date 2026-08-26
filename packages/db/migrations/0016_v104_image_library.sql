PRAGMA foreign_keys = ON;

-- V1.0.4 reuses media_assets for image-library records. The new columns only
-- trace the chosen image through the existing persistent publish lifecycle.
ALTER TABLE publish_jobs ADD COLUMN selected_image_asset_id TEXT;
ALTER TABLE publish_jobs ADD COLUMN image_selection_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE publish_records ADD COLUMN selected_image_asset_id TEXT;
ALTER TABLE publish_records ADD COLUMN image_selection_mode TEXT NOT NULL DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_publish_jobs_selected_image
  ON publish_jobs(selected_image_asset_id, created_at);
CREATE INDEX IF NOT EXISTS idx_publish_records_selected_image
  ON publish_records(selected_image_asset_id, published_at);
