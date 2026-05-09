ALTER TABLE itineraries
ADD COLUMN commission_mode TEXT NOT NULL DEFAULT 'amount';

ALTER TABLE itineraries
ADD COLUMN commission_percent REAL NOT NULL DEFAULT 0;
