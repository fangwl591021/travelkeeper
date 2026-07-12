-- TravelKeeper tenant isolation — phase 1
-- Backward compatible: all existing records are assigned to the legacy `demo` tenant.
-- This migration creates tenant memberships and adds tenant ownership to core business tables.

PRAGMA foreign_keys = ON;

INSERT INTO tenants (slug, name, liff_id, created_at, updated_at)
VALUES ('demo', '既有租戶', '', datetime('now'), datetime('now'))
ON CONFLICT(slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_slug TEXT NOT NULL,
  user_uid TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('platform_admin', 'tenant_admin', 'editor', 'sales', 'finance', 'support', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_slug, user_uid),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_uid
  ON tenant_memberships(user_uid);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_status
  ON tenant_memberships(tenant_slug, status);

-- Backfill current distributors as members of their existing agency.
INSERT INTO tenant_memberships (tenant_slug, user_uid, role, status, created_at, updated_at)
SELECT
  COALESCE(NULLIF(agency_slug, ''), 'demo'),
  uid,
  CASE WHEN can_upload = 1 THEN 'editor' ELSE 'sales' END,
  CASE
    WHEN lower(status) IN ('approved', 'active') THEN 'active'
    WHEN lower(status) = 'suspended' THEN 'suspended'
    ELSE 'invited'
  END,
  COALESCE(NULLIF(created_at, ''), datetime('now')),
  COALESCE(NULLIF(updated_at, ''), datetime('now'))
FROM distributors
WHERE uid <> ''
ON CONFLICT(tenant_slug, user_uid) DO NOTHING;

-- Core tenant ownership columns. SQLite permits ADD COLUMN with constant defaults.
ALTER TABLE itineraries ADD COLUMN tenant_slug TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE customers ADD COLUMN tenant_slug TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE orders ADD COLUMN tenant_slug TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE payment_attempts ADD COLUMN tenant_slug TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE payout_batches ADD COLUMN tenant_slug TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE audit_logs ADD COLUMN tenant_slug TEXT NOT NULL DEFAULT 'demo';

-- Derive tenant ownership from the strongest existing relation.
UPDATE itineraries
SET tenant_slug = COALESCE(
  (SELECT NULLIF(d.agency_slug, '') FROM distributors d WHERE d.uid = itineraries.owner_uid),
  'demo'
);

UPDATE customers
SET tenant_slug = COALESCE(
  (SELECT NULLIF(d.agency_slug, '') FROM distributors d WHERE d.uid = customers.owner_uid),
  'demo'
);

UPDATE orders
SET tenant_slug = COALESCE(
  (SELECT NULLIF(d.agency_slug, '') FROM distributors d WHERE d.uid = orders.distributor_uid),
  (SELECT NULLIF(i.tenant_slug, '') FROM itineraries i WHERE i.id = orders.itinerary_id),
  'demo'
);

UPDATE payment_attempts
SET tenant_slug = COALESCE(
  (SELECT NULLIF(o.tenant_slug, '') FROM orders o WHERE o.order_id = payment_attempts.order_id),
  'demo'
);

UPDATE payout_batches
SET tenant_slug = COALESCE(
  (SELECT NULLIF(d.agency_slug, '') FROM distributors d WHERE d.uid = payout_batches.operator_uid),
  'demo'
);

-- Audit records created before isolation remain attached to the legacy tenant.
UPDATE audit_logs SET tenant_slug = 'demo' WHERE tenant_slug IS NULL OR tenant_slug = '';

CREATE INDEX IF NOT EXISTS idx_itineraries_tenant_status
  ON itineraries(tenant_slug, review_status, created_at);
CREATE INDEX IF NOT EXISTS idx_itineraries_tenant_owner
  ON itineraries(tenant_slug, owner_uid);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_owner
  ON customers(tenant_slug, owner_uid, last_order_at);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
  ON customers(tenant_slug, customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status
  ON orders(tenant_slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_distributor
  ON orders(tenant_slug, distributor_uid, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer
  ON orders(tenant_slug, customer_phone, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_tenant_order
  ON payment_attempts(tenant_slug, order_id);
CREATE INDEX IF NOT EXISTS idx_payout_batches_tenant_created
  ON payout_batches(tenant_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON audit_logs(tenant_slug, created_at);

-- Prevent newly written cross-tenant relationships.
CREATE TRIGGER IF NOT EXISTS trg_orders_tenant_itinerary_insert
BEFORE INSERT ON orders
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM itineraries i
  WHERE i.id = NEW.itinerary_id AND i.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:order_itinerary');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_tenant_itinerary_update
BEFORE UPDATE OF tenant_slug, itinerary_id ON orders
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM itineraries i
  WHERE i.id = NEW.itinerary_id AND i.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:order_itinerary');
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_tenant_order_insert
BEFORE INSERT ON payment_attempts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM orders o
  WHERE o.order_id = NEW.order_id AND o.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:payment_order');
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_tenant_order_update
BEFORE UPDATE OF tenant_slug, order_id ON payment_attempts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM orders o
  WHERE o.order_id = NEW.order_id AND o.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:payment_order');
END;
