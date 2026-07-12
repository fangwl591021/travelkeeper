-- TravelKeeper tenant-safe customer identity transition
-- Keeps the legacy phone primary key as an internal relation key while exposing
-- a tenant-scoped customer_id and contact_phone for all V2 APIs.

PRAGMA foreign_keys = ON;

ALTER TABLE customers ADD COLUMN customer_id TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';

UPDATE customers
SET contact_phone = customer_phone
WHERE contact_phone = '';

UPDATE customers
SET customer_id = 'CUS' || upper(hex(randomblob(16)))
WHERE customer_id = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_id
  ON customers(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_contact_phone
  ON customers(tenant_slug, contact_phone);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_line_uid
  ON customers(tenant_slug, customer_line_uid);

ALTER TABLE orders ADD COLUMN customer_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';

UPDATE orders
SET contact_phone = customer_phone
WHERE contact_phone = '';

UPDATE orders
SET customer_id = COALESCE(
  (
    SELECT c.customer_id
    FROM customers c
    WHERE c.tenant_slug = orders.tenant_slug
      AND c.customer_phone = orders.customer_phone
    LIMIT 1
  ),
  ''
)
WHERE customer_id = '';

CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer_id
  ON orders(tenant_slug, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_contact_phone
  ON orders(tenant_slug, contact_phone, created_at);

-- New V2 order/customer tenant matching is enforced by the Worker before write.
-- Existing legacy rows with an empty customer_id remain readable.
