-- TravelKeeper settlement payment controls
-- Optional per-tenant guards applied before a settlement batch can be marked paid.

PRAGMA foreign_keys = ON;

ALTER TABLE platform_collection_settlement_rules
  ADD COLUMN require_verified_account INTEGER NOT NULL DEFAULT 0
  CHECK (require_verified_account IN (0, 1));

ALTER TABLE platform_collection_settlement_rules
  ADD COLUMN require_payout_proof INTEGER NOT NULL DEFAULT 0
  CHECK (require_payout_proof IN (0, 1));

-- Preserve backward compatibility for all existing tenants.
UPDATE platform_collection_settlement_rules
SET require_verified_account = COALESCE(require_verified_account, 0),
    require_payout_proof = COALESCE(require_payout_proof, 0);
