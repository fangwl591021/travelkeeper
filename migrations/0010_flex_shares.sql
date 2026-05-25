CREATE TABLE IF NOT EXISTS flex_shares (
  id TEXT PRIMARY KEY,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_flex_shares_expires_at
  ON flex_shares(expires_at);
