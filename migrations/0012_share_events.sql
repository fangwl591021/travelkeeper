CREATE TABLE IF NOT EXISTS share_events (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL DEFAULT '',
  distributor_uid TEXT NOT NULL DEFAULT '',
  invite_code TEXT NOT NULL DEFAULT '',
  itinerary_id TEXT NOT NULL DEFAULT '',
  order_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_share_events_share_id
  ON share_events(share_id, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_distributor_uid
  ON share_events(distributor_uid, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_itinerary_id
  ON share_events(itinerary_id, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_event_type
  ON share_events(event_type, created_at);
