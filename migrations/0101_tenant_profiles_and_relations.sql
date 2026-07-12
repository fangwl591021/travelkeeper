-- TravelKeeper tenant isolation — phase 1.1
-- Separate per-tenant distributor profile data from the legacy global distributor record.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_distributor_profiles (
  tenant_slug TEXT NOT NULL,
  user_uid TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  line_link TEXT NOT NULL DEFAULT '',
  line_at_link TEXT NOT NULL DEFAULT '',
  line_at_id TEXT NOT NULL DEFAULT '',
  fb_link TEXT NOT NULL DEFAULT '',
  ig_link TEXT NOT NULL DEFAULT '',
  web_link TEXT NOT NULL DEFAULT '',
  map_link TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  oa_intro TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_branch TEXT NOT NULL DEFAULT '',
  bank_holder TEXT NOT NULL DEFAULT '',
  commission_pct REAL NOT NULL DEFAULT 0,
  invite_code TEXT NOT NULL DEFAULT '',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_slug, user_uid),
  FOREIGN KEY (tenant_slug, user_uid)
    REFERENCES tenant_memberships(tenant_slug, user_uid)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_distributor_profiles_invite
  ON tenant_distributor_profiles(tenant_slug, invite_code)
  WHERE invite_code <> '';
CREATE INDEX IF NOT EXISTS idx_tenant_distributor_profiles_user
  ON tenant_distributor_profiles(user_uid);

INSERT INTO tenant_distributor_profiles (
  tenant_slug, user_uid, display_name, phone, email, company_name, tax_id,
  line_link, line_at_link, line_at_id, fb_link, ig_link, web_link, map_link,
  avatar, bio, oa_intro, bank_account, bank_name, bank_branch, bank_holder,
  commission_pct, invite_code, joined_at, created_at, updated_at
)
SELECT
  COALESCE(NULLIF(agency_slug, ''), 'demo'),
  uid,
  name,
  phone,
  email,
  company_name,
  tax_id,
  line_link,
  line_at_link,
  line_at_id,
  fb_link,
  ig_link,
  web_link,
  map_link,
  avatar,
  bio,
  oa_intro,
  bank_account,
  bank_name,
  bank_branch,
  bank_holder,
  commission_pct,
  invite_code,
  joined_at,
  created_at,
  updated_at
FROM distributors
WHERE uid <> ''
ON CONFLICT(tenant_slug, user_uid) DO UPDATE SET
  display_name = excluded.display_name,
  phone = excluded.phone,
  email = excluded.email,
  company_name = excluded.company_name,
  tax_id = excluded.tax_id,
  line_link = excluded.line_link,
  line_at_link = excluded.line_at_link,
  line_at_id = excluded.line_at_id,
  fb_link = excluded.fb_link,
  ig_link = excluded.ig_link,
  web_link = excluded.web_link,
  map_link = excluded.map_link,
  avatar = excluded.avatar,
  bio = excluded.bio,
  oa_intro = excluded.oa_intro,
  bank_account = excluded.bank_account,
  bank_name = excluded.bank_name,
  bank_branch = excluded.bank_branch,
  bank_holder = excluded.bank_holder,
  commission_pct = excluded.commission_pct,
  invite_code = excluded.invite_code,
  updated_at = excluded.updated_at;

-- Existing global invite-code uniqueness is incompatible with multi-tenant SaaS.
-- Keep the legacy table operational, but allow the same code in separate tenants
-- through tenant_distributor_profiles.

ALTER TABLE payout_batch_orders ADD COLUMN tenant_slug TEXT NOT NULL DEFAULT 'demo';

UPDATE payout_batch_orders
SET tenant_slug = COALESCE(
  (SELECT pb.tenant_slug FROM payout_batches pb WHERE pb.id = payout_batch_orders.batch_id),
  (SELECT o.tenant_slug FROM orders o WHERE o.order_id = payout_batch_orders.order_id),
  'demo'
);

CREATE INDEX IF NOT EXISTS idx_payout_batch_orders_tenant_batch
  ON payout_batch_orders(tenant_slug, batch_id);
CREATE INDEX IF NOT EXISTS idx_payout_batch_orders_tenant_order
  ON payout_batch_orders(tenant_slug, order_id);
