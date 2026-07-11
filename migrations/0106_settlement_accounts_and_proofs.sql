-- TravelKeeper settlement payout accounts and private proof metadata
-- Full bank account numbers are encrypted by the Worker before storage.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_payout_accounts (
  tenant_slug TEXT PRIMARY KEY,
  payout_method TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (payout_method IN ('bank_transfer', 'manual')),
  bank_code TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  branch_code TEXT NOT NULL DEFAULT '',
  branch_name TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  account_last4 TEXT NOT NULL DEFAULT '',
  account_ciphertext TEXT NOT NULL DEFAULT '',
  account_iv TEXT NOT NULL DEFAULT '',
  key_version TEXT NOT NULL DEFAULT 'v1',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected', 'disabled')),
  verification_note TEXT NOT NULL DEFAULT '',
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_payout_accounts_status
  ON tenant_payout_accounts(verification_status, enabled);

CREATE TABLE IF NOT EXISTS platform_collection_batch_proofs (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  proof_type TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (proof_type IN ('bank_transfer', 'receipt', 'statement', 'other')),
  storage_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT NOT NULL DEFAULT '',
  reference_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES platform_collection_batches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_collection_batch_proofs_batch
  ON platform_collection_batch_proofs(tenant_slug, batch_id, created_at);

-- Snapshot fields preserve where a paid batch was intended to be remitted.
ALTER TABLE platform_collection_batches ADD COLUMN payout_bank_code TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_collection_batches ADD COLUMN payout_bank_name TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_collection_batches ADD COLUMN payout_account_name TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_collection_batches ADD COLUMN payout_account_last4 TEXT NOT NULL DEFAULT '';

CREATE TRIGGER IF NOT EXISTS trg_settlement_proof_tenant_insert
BEFORE INSERT ON platform_collection_batch_proofs
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM platform_collection_batches b
  WHERE b.id = NEW.batch_id
    AND b.tenant_slug = NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: settlement proof batch');
END;

CREATE TRIGGER IF NOT EXISTS trg_settlement_proof_tenant_update
BEFORE UPDATE OF tenant_slug, batch_id ON platform_collection_batch_proofs
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM platform_collection_batches b
  WHERE b.id = NEW.batch_id
    AND b.tenant_slug = NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: settlement proof batch');
END;
