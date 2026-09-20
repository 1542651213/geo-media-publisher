-- Kangyi operation checkpoints live on the existing submission intent.
-- Historical XHS and other platform intents remain NULL and unchanged.
ALTER TABLE submission_intents ADD COLUMN operation_metadata_json TEXT;
