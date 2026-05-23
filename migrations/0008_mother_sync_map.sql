CREATE TABLE IF NOT EXISTS mother_sync_map (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('distributor', 'itinerary', 'customer', 'order', 'payment', 'commission')),
  local_id TEXT NOT NULL,
  mother_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'push'
    CHECK (direction IN ('push', 'pull')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'synced', 'failed', 'ignored')),
  checksum TEXT NOT NULL DEFAULT '',
  last_pushed_at TEXT NOT NULL DEFAULT '',
  last_pulled_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, local_id)
);

CREATE INDEX IF NOT EXISTS idx_mother_sync_map_status
  ON mother_sync_map(status, entity_type);

CREATE INDEX IF NOT EXISTS idx_mother_sync_map_mother_id
  ON mother_sync_map(mother_id)
  WHERE mother_id <> '';
