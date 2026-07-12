-- Tenant integrity compatibility forward-fix.
--
-- Historical migrations remain immutable. D1 remote migration parsing does not
-- reliably accept the multi-statement cross-table trigger blocks that exist in
-- 0100-0113, so new application writes must validate parent tenant ownership
-- in the Worker/API transaction before INSERT or UPDATE.
--
-- These indexes are safe to apply to existing data and make the required
-- tenant-scoped parent lookups deterministic without rebuilding tables.

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_itineraries_tenant_id
  ON itineraries(tenant_slug, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_customer_id
  ON customers(tenant_slug, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tenant_order_id
  ON orders(tenant_slug, order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_tenant_id
  ON payment_attempts(tenant_slug, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_batches_tenant_id
  ON payout_batches(tenant_slug, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_profiles_tenant_id
  ON tenant_crm_profiles(tenant_slug, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_threads_tenant_id
  ON tenant_crm_threads(tenant_slug, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_messages_tenant_id
  ON tenant_crm_messages(tenant_slug, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_collection_batches_tenant_id
  ON platform_collection_batches(tenant_slug, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_collection_payables_tenant_id
  ON platform_collection_payables(tenant_slug, id);
