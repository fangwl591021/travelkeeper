-- TravelKeeper tenant-owned payment gateway credentials
-- Secrets are encrypted by the Worker before storage. Never store HashKey/HashIV in plaintext.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_payment_gateway_credentials (
  tenant_slug TEXT NOT NULL,
  provider TEXT NOT NULL
    CHECK (provider IN ('newebpay', 'linepay')),
  enabled INTEGER NOT NULL DEFAULT 0
    CHECK (enabled IN (0, 1)),
  merchant_id TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production')),
  gateway_url TEXT NOT NULL DEFAULT '',
  protocol_version TEXT NOT NULL DEFAULT '2.0',
  secrets_ciphertext TEXT NOT NULL DEFAULT '',
  secrets_iv TEXT NOT NULL DEFAULT '',
  key_version TEXT NOT NULL DEFAULT 'v1',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_slug, provider),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_gateway_credentials_enabled
  ON tenant_payment_gateway_credentials(provider, enabled, environment);

-- A tenant-owned gateway may only be enabled when the tenant policy explicitly uses it.
CREATE TRIGGER IF NOT EXISTS trg_tenant_gateway_enable_policy_insert
BEFORE INSERT ON tenant_payment_gateway_credentials
FOR EACH ROW
WHEN NEW.enabled = 1 AND NOT EXISTS (
  SELECT 1
  FROM tenant_payment_settings p
  WHERE p.tenant_slug = NEW.tenant_slug
    AND p.collection_mode = 'tenant_gateway'
    AND p.provider = NEW.provider
    AND p.enabled = 1
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_GATEWAY_POLICY_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_gateway_enable_policy_update
BEFORE UPDATE OF enabled, provider, tenant_slug ON tenant_payment_gateway_credentials
FOR EACH ROW
WHEN NEW.enabled = 1 AND NOT EXISTS (
  SELECT 1
  FROM tenant_payment_settings p
  WHERE p.tenant_slug = NEW.tenant_slug
    AND p.collection_mode = 'tenant_gateway'
    AND p.provider = NEW.provider
    AND p.enabled = 1
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_GATEWAY_POLICY_MISMATCH');
END;
