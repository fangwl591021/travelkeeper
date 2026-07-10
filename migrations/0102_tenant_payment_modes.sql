-- TravelKeeper tenant payment collection modes
-- Distinguishes platform collection, tenant-owned gateway, and offline/manual payment.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_payment_settings (
  tenant_slug TEXT PRIMARY KEY,
  collection_mode TEXT NOT NULL DEFAULT 'offline'
    CHECK (collection_mode IN ('platform_collect', 'tenant_gateway', 'offline')),
  provider TEXT NOT NULL DEFAULT 'none'
    CHECK (provider IN ('newebpay', 'linepay', 'none')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  display_label TEXT NOT NULL DEFAULT '',
  settlement_note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_payment_settings_mode
  ON tenant_payment_settings(collection_mode, enabled);

-- Existing production tenant keeps the current platform payment flow.
INSERT INTO tenant_payment_settings (
  tenant_slug, collection_mode, provider, enabled, display_label, settlement_note
)
VALUES (
  'demo', 'platform_collect', 'newebpay', 1, '平台代收', '沿用既有平台藍新金流設定'
)
ON CONFLICT(tenant_slug) DO NOTHING;

-- Every other tenant starts safely in offline/manual mode.
INSERT INTO tenant_payment_settings (
  tenant_slug, collection_mode, provider, enabled, display_label, settlement_note
)
SELECT
  t.slug,
  CASE WHEN t.slug = 'demo' THEN 'platform_collect' ELSE 'offline' END,
  CASE WHEN t.slug = 'demo' THEN 'newebpay' ELSE 'none' END,
  1,
  CASE WHEN t.slug = 'demo' THEN '平台代收' ELSE '人工收款' END,
  CASE WHEN t.slug = 'demo' THEN '沿用既有平台藍新金流設定' ELSE '由業務或客服另行確認付款方式' END
FROM tenants t
ON CONFLICT(tenant_slug) DO NOTHING;
