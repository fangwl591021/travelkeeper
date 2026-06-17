ALTER TABLE itineraries
ADD COLUMN expire_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_itineraries_expire_at
ON itineraries(expire_at);
