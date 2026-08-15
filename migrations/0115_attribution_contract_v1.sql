-- TravelKeeper Attribution Contract V1
-- Separates immutable original referrer from mutable service owner and per-order distributor.

PRAGMA foreign_keys = ON;

ALTER TABLE customers ADD COLUMN ref_uid TEXT NOT NULL DEFAULT '';
ALTER TABLE tenant_distributor_profiles ADD COLUMN ref_uid TEXT NOT NULL DEFAULT '';

-- Legacy customer ownership is the strongest available historical attribution.
-- Backfill only when that owner is an active sales/editor member of the same tenant.
UPDATE customers AS c
SET ref_uid = c.owner_uid
WHERE c.ref_uid = ''
  AND c.owner_uid <> ''
  AND EXISTS (
    SELECT 1
    FROM tenant_memberships m
    WHERE m.tenant_slug = c.tenant_slug
      AND m.user_uid = c.owner_uid
      AND m.status = 'active'
      AND m.role IN ('sales', 'editor')
  );

-- Move distributor/upline attribution out of the legacy global distributors row.
-- A legacy referrer is copied only when it is valid inside the same tenant.
UPDATE tenant_distributor_profiles AS p
SET ref_uid = COALESCE((
  SELECT d.ref_uid
  FROM distributors d
  WHERE d.uid = p.user_uid
    AND d.ref_uid <> ''
    AND d.ref_uid <> p.user_uid
    AND EXISTS (
      SELECT 1
      FROM tenant_memberships m
      WHERE m.tenant_slug = p.tenant_slug
        AND m.user_uid = d.ref_uid
        AND m.status = 'active'
        AND m.role IN ('sales', 'editor')
    )
  LIMIT 1
), '')
WHERE p.ref_uid = '';

-- Bound CRM profiles inherit the canonical customer referrer.
UPDATE tenant_crm_profiles AS p
SET ref_uid = COALESCE((
  SELECT c.ref_uid
  FROM customers c
  WHERE c.tenant_slug = p.tenant_slug
    AND c.customer_id = p.customer_id
  LIMIT 1
), p.ref_uid)
WHERE p.customer_id <> ''
  AND EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.tenant_slug = p.tenant_slug
      AND c.customer_id = p.customer_id
      AND c.ref_uid <> ''
  );

CREATE INDEX IF NOT EXISTS idx_customers_tenant_ref_uid
  ON customers(tenant_slug, ref_uid, created_at);
CREATE INDEX IF NOT EXISTS idx_tenant_distributor_profiles_ref_uid
  ON tenant_distributor_profiles(tenant_slug, ref_uid, joined_at);

-- Customer referrer must be an active sales/editor in the same tenant.
CREATE TRIGGER IF NOT EXISTS trg_customers_referrer_insert
BEFORE INSERT ON customers
WHEN NEW.ref_uid <> '' AND NOT EXISTS (
  SELECT 1 FROM tenant_memberships m
  WHERE m.tenant_slug = NEW.tenant_slug
    AND m.user_uid = NEW.ref_uid
    AND m.status = 'active'
    AND m.role IN ('sales', 'editor')
)
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_TENANT_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_customers_referrer_update
BEFORE UPDATE OF tenant_slug, ref_uid ON customers
WHEN NEW.ref_uid <> '' AND NOT EXISTS (
  SELECT 1 FROM tenant_memberships m
  WHERE m.tenant_slug = NEW.tenant_slug
    AND m.user_uid = NEW.ref_uid
    AND m.status = 'active'
    AND m.role IN ('sales', 'editor')
)
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_TENANT_MISMATCH');
END;

-- Once an original referrer exists it is immutable through ordinary writes.
CREATE TRIGGER IF NOT EXISTS trg_customers_referrer_immutable
BEFORE UPDATE OF ref_uid ON customers
WHEN OLD.ref_uid <> '' AND NEW.ref_uid <> OLD.ref_uid
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_CONFLICT');
END;

-- Distributor/upline attribution is tenant-scoped and cannot self-reference.
CREATE TRIGGER IF NOT EXISTS trg_distributor_referrer_insert
BEFORE INSERT ON tenant_distributor_profiles
WHEN NEW.ref_uid <> '' AND (
  NEW.ref_uid = NEW.user_uid OR NOT EXISTS (
    SELECT 1 FROM tenant_memberships m
    WHERE m.tenant_slug = NEW.tenant_slug
      AND m.user_uid = NEW.ref_uid
      AND m.status = 'active'
      AND m.role IN ('sales', 'editor')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_TENANT_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_distributor_referrer_update
BEFORE UPDATE OF tenant_slug, user_uid, ref_uid ON tenant_distributor_profiles
WHEN NEW.ref_uid <> '' AND (
  NEW.ref_uid = NEW.user_uid OR NOT EXISTS (
    SELECT 1 FROM tenant_memberships m
    WHERE m.tenant_slug = NEW.tenant_slug
      AND m.user_uid = NEW.ref_uid
      AND m.status = 'active'
      AND m.role IN ('sales', 'editor')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_TENANT_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_distributor_referrer_immutable
BEFORE UPDATE OF ref_uid ON tenant_distributor_profiles
WHEN OLD.ref_uid <> '' AND NEW.ref_uid <> OLD.ref_uid
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_CONFLICT');
END;

-- CRM is a projection of canonical customer attribution, never a second authority.
CREATE TRIGGER IF NOT EXISTS trg_crm_referrer_customer_insert
BEFORE INSERT ON tenant_crm_profiles
WHEN NEW.customer_id <> '' AND EXISTS (
  SELECT 1 FROM customers c
  WHERE c.tenant_slug = NEW.tenant_slug
    AND c.customer_id = NEW.customer_id
    AND c.ref_uid <> ''
    AND NEW.ref_uid <> c.ref_uid
)
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_CONFLICT');
END;

CREATE TRIGGER IF NOT EXISTS trg_crm_referrer_customer_update
BEFORE UPDATE OF tenant_slug, customer_id, ref_uid ON tenant_crm_profiles
WHEN NEW.customer_id <> '' AND EXISTS (
  SELECT 1 FROM customers c
  WHERE c.tenant_slug = NEW.tenant_slug
    AND c.customer_id = NEW.customer_id
    AND c.ref_uid <> ''
    AND NEW.ref_uid <> c.ref_uid
)
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_CONFLICT');
END;

CREATE TRIGGER IF NOT EXISTS trg_crm_referrer_immutable
BEFORE UPDATE OF ref_uid ON tenant_crm_profiles
WHEN OLD.ref_uid <> '' AND NEW.ref_uid <> OLD.ref_uid
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTION_REFERRER_CONFLICT');
END;

-- Customer remains the authority after creation and after future owner transfers.
-- Existing LINE-only profiles are linked when the formal customer identity appears.
CREATE TRIGGER IF NOT EXISTS trg_customer_attribution_projection_insert
AFTER INSERT ON customers
WHEN NEW.customer_id <> ''
BEGIN
  UPDATE tenant_crm_profiles
  SET customer_id = CASE WHEN customer_id = '' THEN NEW.customer_id ELSE customer_id END,
      ref_uid = NEW.ref_uid,
      owner_uid = NEW.owner_uid,
      updated_by = 'attribution-sync',
      updated_at = datetime('now')
  WHERE tenant_slug = NEW.tenant_slug
    AND (
      customer_id = NEW.customer_id OR
      (customer_id = '' AND NEW.customer_line_uid <> '' AND line_user_uid = NEW.customer_line_uid)
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_customer_attribution_projection_update
AFTER UPDATE OF customer_id, customer_line_uid, ref_uid, owner_uid ON customers
WHEN NEW.customer_id <> ''
BEGIN
  UPDATE tenant_crm_profiles
  SET customer_id = CASE WHEN customer_id = '' THEN NEW.customer_id ELSE customer_id END,
      ref_uid = NEW.ref_uid,
      owner_uid = NEW.owner_uid,
      updated_by = 'attribution-sync',
      updated_at = datetime('now')
  WHERE tenant_slug = NEW.tenant_slug
    AND (
      customer_id = NEW.customer_id OR
      (customer_id = '' AND NEW.customer_line_uid <> '' AND line_user_uid = NEW.customer_line_uid)
    );
END;