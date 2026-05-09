ALTER TABLE itineraries
ADD COLUMN seat_limit INTEGER NOT NULL DEFAULT 0;

ALTER TABLE itineraries
ADD COLUMN min_group_size INTEGER NOT NULL DEFAULT 0;

ALTER TABLE itineraries
ADD COLUMN allowed_payment_methods TEXT NOT NULL DEFAULT 'credit_card,linepay,atm';

ALTER TABLE itineraries
ADD COLUMN share_enabled INTEGER NOT NULL DEFAULT 1;
