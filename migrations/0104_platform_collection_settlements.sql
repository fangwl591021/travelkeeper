-- TravelKeeper platform collection settlement ledger
-- Separates platform-collected principal settlement from individual sales commission payout.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_collection_settlement_rules (
  tenant_slug TEXT PRIMARY KEY,
  beneficiary_type TEXT NOT NULL DEFAULT 'tenant'
    CHECK (beneficiary_type IN ('tenant', 'platform')),
  gateway_fee_rate REAL NOT NULL DEFAULT 0,
  gateway_fee_fixed INTEGER NOT NULL DEFAULT 0,
  platform_fee_rate REAL NOT NULL DEFAULT 0,
  platform_fee_fixed INTEGER NOT NULL DEFAULT 0,
  reserve_rate REAL NOT NULL DEFAULT 0,
  hold_days INTEGER NOT NULL DEFAULT 7,
  minimum_payout INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  payout_note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS platform_collection_payables (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  payment_attempt_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  leg TEXT NOT NULL DEFAULT 'deposit'
    CHECK (leg IN ('deposit', 'balance')),
  beneficiary_type TEXT NOT NULL DEFAULT 'tenant'
    CHECK (beneficiary_type IN ('tenant', 'platform')),
  beneficiary_key TEXT NOT NULL DEFAULT '',
  gross_amount INTEGER NOT NULL DEFAULT 0,
  gateway_fee_amount INTEGER NOT NULL DEFAULT 0,
  platform_fee_amount INTEGER NOT NULL DEFAULT 0,
  reserve_amount INTEGER NOT NULL DEFAULT 0,
  payable_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'eligible', 'batched', 'paid', 'retained', 'void', 'disputed')),
  eligible_at TEXT NOT NULL DEFAULT '',
  batch_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_slug, payment_attempt_id),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE,
  FOREIGN KEY (payment_attempt_id) REFERENCES payment_attempts(id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_collection_payables_tenant_status
  ON platform_collection_payables(tenant_slug, status, eligible_at);
CREATE INDEX IF NOT EXISTS idx_platform_collection_payables_batch
  ON platform_collection_payables(tenant_slug, batch_id);
CREATE INDEX IF NOT EXISTS idx_platform_collection_payables_order
  ON platform_collection_payables(tenant_slug, order_id);

CREATE TABLE IF NOT EXISTS platform_collection_batches (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
  period_start TEXT NOT NULL DEFAULT '',
  period_end TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  total_gross INTEGER NOT NULL DEFAULT 0,
  total_gateway_fee INTEGER NOT NULL DEFAULT 0,
  total_platform_fee INTEGER NOT NULL DEFAULT 0,
  total_reserve INTEGER NOT NULL DEFAULT 0,
  total_payable INTEGER NOT NULL DEFAULT 0,
  payout_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT NOT NULL DEFAULT '',
  paid_by TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_collection_batches_tenant_status
  ON platform_collection_batches(tenant_slug, status, created_at);

CREATE TABLE IF NOT EXISTS platform_collection_batch_items (
  batch_id TEXT NOT NULL,
  payable_id TEXT NOT NULL,
  tenant_slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, payable_id),
  FOREIGN KEY (batch_id) REFERENCES platform_collection_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (payable_id) REFERENCES platform_collection_payables(id),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_collection_batch_items_tenant
  ON platform_collection_batch_items(tenant_slug, batch_id);





-- Existing platform-owned demo sales are retained by the platform and are not external payables.
INSERT INTO platform_collection_settlement_rules (
  tenant_slug, beneficiary_type, gateway_fee_rate, gateway_fee_fixed,
  platform_fee_rate, platform_fee_fixed, reserve_rate, hold_days,
  minimum_payout, enabled, payout_note
)
VALUES (
  'demo', 'platform', 0, 0, 0, 0, 0, 0, 0, 1,
  '平台自有訂單只記錄代收帳本，不建立對外付款批次'
)
ON CONFLICT(tenant_slug) DO NOTHING;

-- Every non-demo tenant using platform collection starts with a conservative 7-day hold.
INSERT INTO platform_collection_settlement_rules (
  tenant_slug, beneficiary_type, hold_days, minimum_payout, enabled, payout_note
)
SELECT
  t.slug,
  IIF(t.slug = 'demo', 'platform', 'tenant'),
  IIF(t.slug = 'demo', 0, 7),
  0,
  1,
  IIF(t.slug = 'demo', '平台自有訂單', '平台代收後依結算規則撥付租戶')
FROM tenants t
WHERE 1
ON CONFLICT(tenant_slug) DO NOTHING;
