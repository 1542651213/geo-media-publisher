CREATE TABLE IF NOT EXISTS douyin_image_text_connections (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL,
  browser_session_id_hash TEXT NOT NULL,
  login_generation INTEGER NOT NULL CHECK (login_generation >= 1),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_douyin_image_text_creator
  ON douyin_image_text_connections (creator_id, active);
