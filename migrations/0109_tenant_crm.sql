PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_crm_profiles (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  line_user_uid TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  birthday TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  identity_note TEXT NOT NULL DEFAULT '',
  preference_note TEXT NOT NULL DEFAULT '',
  taboo_note TEXT NOT NULL DEFAULT '',
  privacy_consent TEXT NOT NULL DEFAULT '',
  ref_uid TEXT NOT NULL DEFAULT '',
  invite_code TEXT NOT NULL DEFAULT '',
  referral_note TEXT NOT NULL DEFAULT '',
  owner_uid TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'order' CHECK (source IN ('order', 'line', 'manual', 'import')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  risk TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  opportunity_stage TEXT NOT NULL DEFAULT 'new' CHECK (opportunity_stage IN ('new', 'qualified', 'quoted', 'payment', 'won', 'lost')),
  opportunity_value INTEGER NOT NULL DEFAULT 0,
  opportunity_note TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  last_message_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_profiles_tenant_customer
  ON tenant_crm_profiles(tenant_slug, customer_id)
  WHERE customer_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_profiles_tenant_line_uid
  ON tenant_crm_profiles(tenant_slug, line_user_uid)
  WHERE line_user_uid <> '';

CREATE INDEX IF NOT EXISTS idx_tenant_crm_profiles_owner
  ON tenant_crm_profiles(tenant_slug, owner_uid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_crm_profiles_stage
  ON tenant_crm_profiles(tenant_slug, opportunity_stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_crm_threads (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  line_user_uid TEXT NOT NULL DEFAULT '',
  channel_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  risk TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  summary TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  last_message_at TEXT NOT NULL DEFAULT '',
  last_inbound_at TEXT NOT NULL DEFAULT '',
  last_outbound_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug),
  FOREIGN KEY (profile_id) REFERENCES tenant_crm_profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_threads_tenant_line_uid
  ON tenant_crm_threads(tenant_slug, line_user_uid)
  WHERE line_user_uid <> '';

CREATE INDEX IF NOT EXISTS idx_tenant_crm_threads_profile
  ON tenant_crm_threads(tenant_slug, profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_crm_records (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'follow_up', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug),
  FOREIGN KEY (profile_id) REFERENCES tenant_crm_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_crm_records_profile
  ON tenant_crm_records(tenant_slug, profile_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_crm_records_due
  ON tenant_crm_records(tenant_slug, status, priority, due_at);

INSERT INTO tenant_crm_profiles (
  id, tenant_slug, customer_id, line_user_uid, display_name, phone,
  owner_uid, source, status, opportunity_stage, opportunity_value,
  last_message_at, created_by, updated_by, created_at, updated_at
)
SELECT
  c.customer_id,
  c.tenant_slug,
  c.customer_id,
  CASE
    WHEN c.customer_line_uid <> '' AND c.customer_id = (
      SELECT MIN(c2.customer_id)
      FROM customers c2
      WHERE c2.tenant_slug = c.tenant_slug
        AND c2.customer_line_uid = c.customer_line_uid
    ) THEN c.customer_line_uid
    ELSE ''
  END,
  c.customer_name,
  c.contact_phone,
  c.owner_uid,
  'order',
  CASE WHEN c.total_orders > 0 THEN 'closed' ELSE 'open' END,
  CASE WHEN c.total_orders > 0 THEN 'won' ELSE 'new' END,
  c.total_amount,
  c.last_order_at,
  'migration-0109',
  'migration-0109',
  c.created_at,
  c.updated_at
FROM customers c
WHERE c.customer_id <> ''
  AND c.tenant_slug <> ''
  AND 1
ON CONFLICT(id) DO NOTHING;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_profile_customer_insert
BEFORE INSERT ON tenant_crm_profiles
WHEN NEW.customer_id <> '' AND NOT EXISTS (
  SELECT 1 FROM customers c
  WHERE c.tenant_slug = NEW.tenant_slug AND c.customer_id = NEW.customer_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_profile_customer');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_profile_customer_update
BEFORE UPDATE OF tenant_slug, customer_id ON tenant_crm_profiles
WHEN NEW.customer_id <> '' AND NOT EXISTS (
  SELECT 1 FROM customers c
  WHERE c.tenant_slug = NEW.tenant_slug AND c.customer_id = NEW.customer_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_profile_customer');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_thread_profile_insert
BEFORE INSERT ON tenant_crm_threads
WHEN NEW.profile_id <> '' AND NOT EXISTS (
  SELECT 1 FROM tenant_crm_profiles p
  WHERE p.tenant_slug = NEW.tenant_slug AND p.id = NEW.profile_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_thread_profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_thread_profile_update
BEFORE UPDATE OF tenant_slug, profile_id ON tenant_crm_threads
WHEN NEW.profile_id <> '' AND NOT EXISTS (
  SELECT 1 FROM tenant_crm_profiles p
  WHERE p.tenant_slug = NEW.tenant_slug AND p.id = NEW.profile_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_thread_profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_record_profile_insert
BEFORE INSERT ON tenant_crm_records
WHEN NOT EXISTS (
  SELECT 1 FROM tenant_crm_profiles p
  WHERE p.tenant_slug = NEW.tenant_slug AND p.id = NEW.profile_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_record_profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_record_profile_update
BEFORE UPDATE OF tenant_slug, profile_id ON tenant_crm_records
WHEN NOT EXISTS (
  SELECT 1 FROM tenant_crm_profiles p
  WHERE p.tenant_slug = NEW.tenant_slug AND p.id = NEW.profile_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_record_profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_record_thread_insert
BEFORE INSERT ON tenant_crm_records
WHEN NEW.thread_id <> '' AND NOT EXISTS (
  SELECT 1 FROM tenant_crm_threads t
  WHERE t.tenant_slug = NEW.tenant_slug AND t.id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_record_thread');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_record_thread_update
BEFORE UPDATE OF tenant_slug, thread_id ON tenant_crm_records
WHEN NEW.thread_id <> '' AND NOT EXISTS (
  SELECT 1 FROM tenant_crm_threads t
  WHERE t.tenant_slug = NEW.tenant_slug AND t.id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_record_thread');
END;
