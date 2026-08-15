-- TravelKeeper First-Touch Attribution V1
-- Canonical tenant-scoped first authenticated referral touch.
-- The first valid signed referral + verified LINE identity wins permanently.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_first_touch_attributions (
  tenant_slug TEXT NOT NULL,
  line_user_uid TEXT NOT NULL,
  ref_uid TEXT NOT NULL,
  first_itinerary_id TEXT NOT NULL DEFAULT '',
  first_share_id TEXT NOT NULL DEFAULT '',
  referral_jti TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_slug, line_user_uid),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug)
);

-- Existing formal customer attribution is stronger than any later link click.
INSERT INTO tenant_first_touch_attributions (
  tenant_slug, line_user_uid, ref_uid, first_itinerary_id, first_share_id,
  referral_jti, source, captured_at
)
SELECT
  c.tenant_slug,
  c.customer_line_uid,
  c.ref_uid,
  '',
  '',
  '',
  'customer_backfill',
  COALESCE(NULLIF(c.first_order_at, ''), NULLIF(c.created_at, ''), datetime('now'))
FROM customers c
WHERE c.tenant_slug <> ''
  AND c.customer_line_uid <> ''
  AND c.ref_uid <> ''
ON CONFLICT(tenant_slug, line_user_uid) DO NOTHING;

-- Preserve historical first-touch already held by a LINE lead when no formal
-- customer attribution exists for that tenant + LINE identity.
INSERT INTO tenant_first_touch_attributions (
  tenant_slug, line_user_uid, ref_uid, first_itinerary_id, first_share_id,
  referral_jti, source, captured_at
)
SELECT
  p.tenant_slug,
  p.line_user_uid,
  p.ref_uid,
  '',
  '',
  '',
  'crm_backfill',
  COALESCE(NULLIF(p.created_at, ''), datetime('now'))
FROM tenant_crm_profiles p
WHERE p.tenant_slug <> ''
  AND p.line_user_uid <> ''
  AND p.ref_uid <> ''
ON CONFLICT(tenant_slug, line_user_uid) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tenant_first_touch_referrer
  ON tenant_first_touch_attributions(tenant_slug, ref_uid, captured_at);

CREATE INDEX IF NOT EXISTS idx_tenant_first_touch_captured
  ON tenant_first_touch_attributions(tenant_slug, captured_at DESC);

-- First-touch rows are write-once. Later referrals may be tracked as analytics,
-- but ordinary application writes cannot replace the canonical first touch.
CREATE TRIGGER IF NOT EXISTS trg_tenant_first_touch_immutable
BEFORE UPDATE ON tenant_first_touch_attributions
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_FIRST_TOUCH_IMMUTABLE');
END;