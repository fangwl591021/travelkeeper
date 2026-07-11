-- A payable may belong to only one settlement batch, even under concurrent batch creation.

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_collection_batch_items_payable_unique
  ON platform_collection_batch_items(payable_id);
