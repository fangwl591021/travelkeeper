-- TravelKeeper D1 initial schema
-- Phase 1: mirror the current Google Sheets model with normalized names.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  liff_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distributors (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
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
  tg_token TEXT NOT NULL DEFAULT '',
  tg_chat_id TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  oa_intro TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_branch TEXT NOT NULL DEFAULT '',
  bank_holder TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'active', 'suspended', 'rejected')),
  commission_pct REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  sales_revenue INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  ref_uid TEXT NOT NULL DEFAULT '',
  agency_slug TEXT NOT NULL DEFAULT 'demo',
  can_upload INTEGER NOT NULL DEFAULT 0 CHECK (can_upload IN (0, 1)),
  invite_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agency_slug) REFERENCES tenants(slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_distributors_invite_code
  ON distributors(invite_code)
  WHERE invite_code <> '';

CREATE INDEX IF NOT EXISTS idx_distributors_status ON distributors(status);

CREATE INDEX IF NOT EXISTS idx_distributors_ref_uid ON distributors(ref_uid);

CREATE INDEX IF NOT EXISTS idx_distributors_agency_slug ON distributors(agency_slug);

CREATE TABLE IF NOT EXISTS itineraries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  owner_uid TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'published'
    CHECK (review_status IN ('published', 'pending_review', 'rejected', 'deleted')),
  review_note TEXT NOT NULL DEFAULT '',
  payment_mode TEXT NOT NULL DEFAULT 'deposit'
    CHECK (payment_mode IN ('deposit', 'full')),
  deposit_ratio INTEGER NOT NULL DEFAULT 20,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  balance_collect TEXT NOT NULL DEFAULT 'online'
    CHECK (balance_collect IN ('online', 'offline', 'not_required')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (owner_uid) REFERENCES distributors(uid)
);

CREATE INDEX IF NOT EXISTS idx_itineraries_review_status ON itineraries(review_status);

CREATE INDEX IF NOT EXISTS idx_itineraries_owner_uid ON itineraries(owner_uid);

CREATE INDEX IF NOT EXISTS idx_itineraries_region ON itineraries(region);

CREATE INDEX IF NOT EXISTS idx_itineraries_created_at ON itineraries(created_at);

CREATE TABLE IF NOT EXISTS customers (
  customer_phone TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_line_uid TEXT NOT NULL DEFAULT '',
  owner_uid TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  first_order_at TEXT NOT NULL DEFAULT '',
  last_order_at TEXT NOT NULL DEFAULT '',
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'referral',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_uid) REFERENCES distributors(uid)
);

CREATE INDEX IF NOT EXISTS idx_customers_owner_uid ON customers(owner_uid);

CREATE INDEX IF NOT EXISTS idx_customers_line_uid ON customers(customer_line_uid);

CREATE INDEX IF NOT EXISTS idx_customers_last_order_at ON customers(last_order_at);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  itinerary_id TEXT NOT NULL,
  itinerary_title TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  distributor_uid TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_line_uid TEXT NOT NULL DEFAULT '',
  travelers INTEGER NOT NULL DEFAULT 1,
  travel_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  commission_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  balance_amount INTEGER NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'deposit'
    CHECK (payment_mode IN ('deposit', 'full')),
  balance_collect TEXT NOT NULL DEFAULT 'online'
    CHECK (balance_collect IN ('online', 'offline', 'not_required')),
  deposit_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (deposit_status IN ('unpaid', 'awaiting_atm', 'paid', 'failed')),
  deposit_paid_at TEXT NOT NULL DEFAULT '',
  deposit_method TEXT NOT NULL DEFAULT '',
  deposit_trade_no TEXT NOT NULL DEFAULT '',
  balance_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (balance_status IN ('not_required', 'unpaid', 'awaiting_atm', 'paid_online', 'paid_offline', 'failed')),
  balance_paid_at TEXT NOT NULL DEFAULT '',
  balance_method TEXT NOT NULL DEFAULT '',
  balance_trade_no TEXT NOT NULL DEFAULT '',
  commission_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (commission_status IN ('pending', 'payable', 'paid_out')),
  commission_settled_at TEXT NOT NULL DEFAULT '',
  commission_paid_out_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'referral',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (itinerary_id) REFERENCES itineraries(id),
  FOREIGN KEY (distributor_uid) REFERENCES distributors(uid),
  FOREIGN KEY (customer_phone) REFERENCES customers(customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_orders_distributor_uid ON orders(distributor_uid);

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);

CREATE INDEX IF NOT EXISTS idx_orders_customer_line_uid ON orders(customer_line_uid);

CREATE INDEX IF NOT EXISTS idx_orders_itinerary_id ON orders(itinerary_id);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE INDEX IF NOT EXISTS idx_orders_commission_status ON orders(commission_status);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE INDEX IF NOT EXISTS idx_orders_deposit_status ON orders(deposit_status);

CREATE INDEX IF NOT EXISTS idx_orders_balance_status ON orders(balance_status);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  leg TEXT NOT NULL CHECK (leg IN ('deposit', 'balance')),
  merchant_order_no TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'awaiting_atm', 'paid', 'failed', 'expired')),
  method TEXT NOT NULL DEFAULT '',
  trade_no TEXT NOT NULL DEFAULT '',
  raw_notify_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON payment_attempts(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts(status);

CREATE TABLE IF NOT EXISTS payout_batches (
  id TEXT PRIMARY KEY,
  operator_uid TEXT NOT NULL,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payout_batch_orders (
  batch_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, order_id),
  FOREIGN KEY (batch_id) REFERENCES payout_batches(id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '',
  after_json TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_uid ON audit_logs(actor_uid);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

ALTER TABLE itineraries
ADD COLUMN commission_amount INTEGER NOT NULL DEFAULT 0;

ALTER TABLE itineraries
ADD COLUMN seat_limit INTEGER NOT NULL DEFAULT 0;

ALTER TABLE itineraries
ADD COLUMN min_group_size INTEGER NOT NULL DEFAULT 0;

ALTER TABLE itineraries
ADD COLUMN allowed_payment_methods TEXT NOT NULL DEFAULT 'credit_card,linepay,atm';

ALTER TABLE itineraries
ADD COLUMN share_enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE itineraries
ADD COLUMN commission_mode TEXT NOT NULL DEFAULT 'amount';

ALTER TABLE itineraries
ADD COLUMN commission_percent REAL NOT NULL DEFAULT 0;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS line_threads (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL DEFAULT 'line_oa',
  source_user_id TEXT NOT NULL DEFAULT '',
  source_group_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'closed')),
  risk_level TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  assigned_to TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  last_message_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_threads_status
  ON line_threads(status);

CREATE INDEX IF NOT EXISTS idx_line_threads_risk_level
  ON line_threads(risk_level);

CREATE INDEX IF NOT EXISTS idx_line_threads_last_message_at
  ON line_threads(last_message_at);

CREATE TABLE IF NOT EXISTS line_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  line_event_id TEXT NOT NULL DEFAULT '',
  reply_token TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  sender_role TEXT NOT NULL DEFAULT 'user'
    CHECK (sender_role IN ('user', 'guide', 'system')),
  sender_id TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  inserted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES line_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_line_messages_thread_id
  ON line_messages(thread_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_line_messages_event_id
  ON line_messages(line_event_id)
  WHERE line_event_id <> '';

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS line_visitor_requirements (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  source_user_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '需求',
  content TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'follow_up', 'done')),
  follow_up_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (thread_id) REFERENCES line_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_line_visitor_requirements_thread_id
  ON line_visitor_requirements(thread_id, archived_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_line_visitor_requirements_source_user_id
  ON line_visitor_requirements(source_user_id, archived_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_line_visitor_requirements_status
  ON line_visitor_requirements(status, priority, archived_at);

CREATE TABLE IF NOT EXISTS wasabi_import_objects (
  object_key TEXT PRIMARY KEY,
  source_group TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  last_modified TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS wasabi_import_records (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  source_group TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  record_json TEXT NOT NULL DEFAULT '{}',
  mapped_table TEXT NOT NULL DEFAULT '',
  mapped_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'staged',
  note TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (object_key) REFERENCES wasabi_import_objects(object_key)
);

CREATE INDEX IF NOT EXISTS idx_wasabi_import_records_object_key
  ON wasabi_import_records(object_key);

CREATE INDEX IF NOT EXISTS idx_wasabi_import_records_source_group
  ON wasabi_import_records(source_group, status);

CREATE INDEX IF NOT EXISTS idx_wasabi_import_records_mapped
  ON wasabi_import_records(mapped_table, mapped_key);

CREATE TABLE IF NOT EXISTS mother_sync_map (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('distributor', 'itinerary', 'customer', 'order', 'payment', 'commission')),
  local_id TEXT NOT NULL,
  mother_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'push'
    CHECK (direction IN ('push', 'pull')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'synced', 'failed', 'ignored')),
  checksum TEXT NOT NULL DEFAULT '',
  last_pushed_at TEXT NOT NULL DEFAULT '',
  last_pulled_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, local_id)
);

CREATE INDEX IF NOT EXISTS idx_mother_sync_map_status
  ON mother_sync_map(status, entity_type);

CREATE INDEX IF NOT EXISTS idx_mother_sync_map_mother_id
  ON mother_sync_map(mother_id)
  WHERE mother_id <> '';

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'general',
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_settings_namespace ON system_settings(namespace);

CREATE TABLE IF NOT EXISTS flex_shares (
  id TEXT PRIMARY KEY,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_flex_shares_expires_at
  ON flex_shares(expires_at);

ALTER TABLE line_threads
  ADD COLUMN opportunity_stage TEXT NOT NULL DEFAULT 'new'
    CHECK (opportunity_stage IN ('new', 'qualified', 'quoted', 'payment', 'won', 'lost'));

ALTER TABLE line_threads
  ADD COLUMN opportunity_value INTEGER NOT NULL DEFAULT 0;

ALTER TABLE line_threads
  ADD COLUMN opportunity_note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_line_threads_opportunity_stage
  ON line_threads(opportunity_stage, updated_at);

CREATE TABLE IF NOT EXISTS share_events (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL DEFAULT '',
  distributor_uid TEXT NOT NULL DEFAULT '',
  invite_code TEXT NOT NULL DEFAULT '',
  itinerary_id TEXT NOT NULL DEFAULT '',
  order_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_share_events_share_id
  ON share_events(share_id, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_distributor_uid
  ON share_events(distributor_uid, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_itinerary_id
  ON share_events(itinerary_id, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_event_type
  ON share_events(event_type, created_at);

ALTER TABLE line_messages
  ADD COLUMN media_url TEXT NOT NULL DEFAULT '';

ALTER TABLE line_messages
  ADD COLUMN media_content_type TEXT NOT NULL DEFAULT '';

ALTER TABLE line_messages
  ADD COLUMN media_size INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS internal_employees (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'sales',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  commission_rate REAL NOT NULL DEFAULT 0.4,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_employees_uid ON internal_employees(uid);

CREATE INDEX IF NOT EXISTS idx_internal_employees_status ON internal_employees(status);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  line_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);

CREATE INDEX IF NOT EXISTS idx_suppliers_type ON suppliers(type);

CREATE TABLE IF NOT EXISTS order_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  default_fee_rate REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_sources_status ON order_sources(status);

CREATE TABLE IF NOT EXISTS cost_item_settings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  default_amount REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_item_settings_status ON cost_item_settings(status);

CREATE INDEX IF NOT EXISTS idx_cost_item_settings_category ON cost_item_settings(category);

CREATE TABLE IF NOT EXISTS payment_fee_settings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  fee_rate REAL NOT NULL DEFAULT 0,
  fixed_fee REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_fee_settings_status ON payment_fee_settings(status);

CREATE INDEX IF NOT EXISTS idx_payment_fee_settings_method ON payment_fee_settings(method);

CREATE TABLE IF NOT EXISTS accounting_receipts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL DEFAULT '',
  leg TEXT NOT NULL DEFAULT '',
  payment_date TEXT NOT NULL DEFAULT '',
  sales_uid TEXT NOT NULL DEFAULT '',
  sales_name TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  check_code TEXT NOT NULL DEFAULT '',
  accounting_status TEXT NOT NULL DEFAULT 'pending_check'
    CHECK (accounting_status IN ('pending_check', 'received', 'processing')),
  payment_status TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounting_receipts_order_id ON accounting_receipts(order_id);

CREATE INDEX IF NOT EXISTS idx_accounting_receipts_payment_date ON accounting_receipts(payment_date);

CREATE INDEX IF NOT EXISTS idx_accounting_receipts_status ON accounting_receipts(accounting_status);

CREATE INDEX IF NOT EXISTS idx_accounting_receipts_sales_uid ON accounting_receipts(sales_uid);

ALTER TABLE line_threads
  ADD COLUMN ai_paused INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_line_threads_ai_paused
  ON line_threads(ai_paused, updated_at);

CREATE TABLE IF NOT EXISTS line_learning_examples (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  source_user_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  customer_context TEXT NOT NULL DEFAULT '',
  customer_messages TEXT NOT NULL DEFAULT '',
  guide_responses TEXT NOT NULL DEFAULT '',
  learned_reply_style TEXT NOT NULL DEFAULT '',
  intent_tags TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_response', 'archived')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (thread_id) REFERENCES line_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_line_learning_examples_thread_id
  ON line_learning_examples(thread_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_line_learning_examples_source_user_id
  ON line_learning_examples(source_user_id, status, updated_at);

-- deposit_amount is already present in 0001_initial_schema.sql.
-- Keep this migration as a no-op so existing migration history remains stable.
SELECT 1;

CREATE TABLE IF NOT EXISTS internal_orders (
  id TEXT PRIMARY KEY,
  order_date TEXT NOT NULL DEFAULT '',
  departure_date TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  sales_uid TEXT NOT NULL DEFAULT '',
  sales_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'checking'
    CHECK (status IN ('pending', 'checking', 'departed', 'cancelled')),
  items_json TEXT NOT NULL DEFAULT '[]',
  costs_json TEXT NOT NULL DEFAULT '[]',
  payments_json TEXT NOT NULL DEFAULT '[]',
  travelers_json TEXT NOT NULL DEFAULT '[]',
  net_total INTEGER NOT NULL DEFAULT 0,
  report_total INTEGER NOT NULL DEFAULT 0,
  company_cost INTEGER NOT NULL DEFAULT 0,
  fee_total INTEGER NOT NULL DEFAULT 0,
  profit INTEGER NOT NULL DEFAULT 0,
  commission INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  unpaid_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_orders_departure_date ON internal_orders(departure_date);

CREATE INDEX IF NOT EXISTS idx_internal_orders_sales_uid ON internal_orders(sales_uid);

CREATE INDEX IF NOT EXISTS idx_internal_orders_status ON internal_orders(status);

CREATE TABLE IF NOT EXISTS internal_expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  booked INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_expenses_date ON internal_expenses(date);

CREATE INDEX IF NOT EXISTS idx_internal_expenses_category ON internal_expenses(category);

CREATE TABLE IF NOT EXISTS internal_salary_records (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL DEFAULT '',
  sales_uid TEXT NOT NULL DEFAULT '',
  sales_name TEXT NOT NULL DEFAULT '',
  order_count INTEGER NOT NULL DEFAULT 0,
  commission_total INTEGER NOT NULL DEFAULT 0,
  base_salary INTEGER NOT NULL DEFAULT 0,
  adjustment INTEGER NOT NULL DEFAULT 0,
  deductions INTEGER NOT NULL DEFAULT 0,
  total_pay INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'paid')),
  paid_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(month, sales_uid)
);

CREATE INDEX IF NOT EXISTS idx_internal_salary_month ON internal_salary_records(month);

CREATE INDEX IF NOT EXISTS idx_internal_salary_sales_uid ON internal_salary_records(sales_uid);

ALTER TABLE itineraries
ADD COLUMN expire_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_itineraries_expire_at
ON itineraries(expire_at);

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

CREATE TRIGGER IF NOT EXISTS trg_payout_batch_orders_tenant_insert
BEFORE INSERT ON payout_batch_orders
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM payout_batches pb
  WHERE pb.id = NEW.batch_id AND pb.tenant_slug <> NEW.tenant_slug
) OR EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.order_id = NEW.order_id AND o.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:payout_batch_order');
END;

CREATE TRIGGER IF NOT EXISTS trg_payout_batch_orders_tenant_update
BEFORE UPDATE OF tenant_slug, batch_id, order_id ON payout_batch_orders
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM payout_batches pb
  WHERE pb.id = NEW.batch_id AND pb.tenant_slug <> NEW.tenant_slug
) OR EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.order_id = NEW.order_id AND o.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:payout_batch_order');
END;

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
WHERE 1
ON CONFLICT(tenant_slug) DO NOTHING;

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

CREATE TRIGGER IF NOT EXISTS trg_platform_collection_payables_tenant_insert
BEFORE INSERT ON platform_collection_payables
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM payment_attempts p
  WHERE p.id = NEW.payment_attempt_id AND p.tenant_slug <> NEW.tenant_slug
) OR EXISTS (
  SELECT 1 FROM orders o
  WHERE o.order_id = NEW.order_id AND o.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:platform_collection_payable');
END;

CREATE TRIGGER IF NOT EXISTS trg_platform_collection_payables_tenant_update
BEFORE UPDATE OF tenant_slug, payment_attempt_id, order_id ON platform_collection_payables
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM payment_attempts p
  WHERE p.id = NEW.payment_attempt_id AND p.tenant_slug <> NEW.tenant_slug
) OR EXISTS (
  SELECT 1 FROM orders o
  WHERE o.order_id = NEW.order_id AND o.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:platform_collection_payable');
END;

CREATE TRIGGER IF NOT EXISTS trg_platform_collection_batch_items_tenant_insert
BEFORE INSERT ON platform_collection_batch_items
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM platform_collection_batches b
  WHERE b.id = NEW.batch_id AND b.tenant_slug <> NEW.tenant_slug
) OR EXISTS (
  SELECT 1 FROM platform_collection_payables p
  WHERE p.id = NEW.payable_id AND p.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:platform_collection_batch_item');
END;

CREATE TRIGGER IF NOT EXISTS trg_platform_collection_batch_items_tenant_update
BEFORE UPDATE OF tenant_slug, batch_id, payable_id ON platform_collection_batch_items
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM platform_collection_batches b
  WHERE b.id = NEW.batch_id AND b.tenant_slug <> NEW.tenant_slug
) OR EXISTS (
  SELECT 1 FROM platform_collection_payables p
  WHERE p.id = NEW.payable_id AND p.tenant_slug <> NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:platform_collection_batch_item');
END;

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
  CASE WHEN t.slug = 'demo' THEN 'platform' ELSE 'tenant' END,
  CASE WHEN t.slug = 'demo' THEN 0 ELSE 7 END,
  0,
  1,
  CASE WHEN t.slug = 'demo'
    THEN '平台自有訂單'
    ELSE '平台代收後依結算規則撥付租戶'
  END
FROM tenants t
WHERE 1
ON CONFLICT(tenant_slug) DO NOTHING;

-- A payable may belong to only one settlement batch, even under concurrent batch creation.

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_collection_batch_items_payable_unique
  ON platform_collection_batch_items(payable_id);

-- TravelKeeper settlement payout accounts and private proof metadata
-- Full bank account numbers are encrypted by the Worker before storage.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_payout_accounts (
  tenant_slug TEXT PRIMARY KEY,
  payout_method TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (payout_method IN ('bank_transfer', 'manual')),
  bank_code TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  branch_code TEXT NOT NULL DEFAULT '',
  branch_name TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  account_last4 TEXT NOT NULL DEFAULT '',
  account_ciphertext TEXT NOT NULL DEFAULT '',
  account_iv TEXT NOT NULL DEFAULT '',
  key_version TEXT NOT NULL DEFAULT 'v1',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected', 'disabled')),
  verification_note TEXT NOT NULL DEFAULT '',
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_payout_accounts_status
  ON tenant_payout_accounts(verification_status, enabled);

CREATE TABLE IF NOT EXISTS platform_collection_batch_proofs (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  proof_type TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (proof_type IN ('bank_transfer', 'receipt', 'statement', 'other')),
  storage_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT NOT NULL DEFAULT '',
  reference_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES platform_collection_batches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_collection_batch_proofs_batch
  ON platform_collection_batch_proofs(tenant_slug, batch_id, created_at);

-- Snapshot fields preserve where a paid batch was intended to be remitted.
ALTER TABLE platform_collection_batches ADD COLUMN payout_bank_code TEXT NOT NULL DEFAULT '';

ALTER TABLE platform_collection_batches ADD COLUMN payout_bank_name TEXT NOT NULL DEFAULT '';

ALTER TABLE platform_collection_batches ADD COLUMN payout_account_name TEXT NOT NULL DEFAULT '';

ALTER TABLE platform_collection_batches ADD COLUMN payout_account_last4 TEXT NOT NULL DEFAULT '';

CREATE TRIGGER IF NOT EXISTS trg_settlement_proof_tenant_insert
BEFORE INSERT ON platform_collection_batch_proofs
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM platform_collection_batches b
  WHERE b.id = NEW.batch_id
    AND b.tenant_slug = NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: settlement proof batch');
END;

CREATE TRIGGER IF NOT EXISTS trg_settlement_proof_tenant_update
BEFORE UPDATE OF tenant_slug, batch_id ON platform_collection_batch_proofs
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM platform_collection_batches b
  WHERE b.id = NEW.batch_id
    AND b.tenant_slug = NEW.tenant_slug
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: settlement proof batch');
END;

-- TravelKeeper settlement payment controls
-- Optional per-tenant guards applied before a settlement batch can be marked paid.

PRAGMA foreign_keys = ON;

ALTER TABLE platform_collection_settlement_rules
  ADD COLUMN require_verified_account INTEGER NOT NULL DEFAULT 0
  CHECK (require_verified_account IN (0, 1));

ALTER TABLE platform_collection_settlement_rules
  ADD COLUMN require_payout_proof INTEGER NOT NULL DEFAULT 0
  CHECK (require_payout_proof IN (0, 1));

-- Preserve backward compatibility for all existing tenants.
UPDATE platform_collection_settlement_rules
SET require_verified_account = COALESCE(require_verified_account, 0),
    require_payout_proof = COALESCE(require_payout_proof, 0);

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

-- New V2 orders must point at the same tenant customer and the same legacy
-- relation key. Existing legacy rows with an empty customer_id remain readable.
CREATE TRIGGER IF NOT EXISTS trg_orders_tenant_customer_insert
BEFORE INSERT ON orders
FOR EACH ROW
WHEN NEW.customer_id <> '' AND NOT EXISTS (
  SELECT 1
  FROM customers c
  WHERE c.tenant_slug = NEW.tenant_slug
    AND c.customer_id = NEW.customer_id
    AND c.customer_phone = NEW.customer_phone
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:order_customer');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_tenant_customer_update
BEFORE UPDATE OF tenant_slug, customer_id, customer_phone ON orders
FOR EACH ROW
WHEN NEW.customer_id <> '' AND NOT EXISTS (
  SELECT 1
  FROM customers c
  WHERE c.tenant_slug = NEW.tenant_slug
    AND c.customer_id = NEW.customer_id
    AND c.customer_phone = NEW.customer_phone
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:order_customer');
END;

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

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_line_channels (
  tenant_slug TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL DEFAULT '',
  bot_basic_id TEXT NOT NULL DEFAULT '',
  bot_display_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  secrets_ciphertext TEXT NOT NULL DEFAULT '',
  secrets_iv TEXT NOT NULL DEFAULT '',
  key_version TEXT NOT NULL DEFAULT 'v1',
  channel_secret_last4 TEXT NOT NULL DEFAULT '',
  access_token_last4 TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL DEFAULT '',
  verified_by TEXT NOT NULL DEFAULT '',
  last_webhook_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_line_channels_enabled
  ON tenant_line_channels(enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_crm_messages (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  webhook_event_id TEXT NOT NULL DEFAULT '',
  event_fingerprint TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound', 'system')),
  event_type TEXT NOT NULL DEFAULT 'message',
  message_type TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  reply_token_present INTEGER NOT NULL DEFAULT 0 CHECK (reply_token_present IN (0, 1)),
  event_timestamp INTEGER NOT NULL DEFAULT 0,
  redelivery INTEGER NOT NULL DEFAULT 0 CHECK (redelivery IN (0, 1)),
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug),
  FOREIGN KEY (profile_id) REFERENCES tenant_crm_profiles(id),
  FOREIGN KEY (thread_id) REFERENCES tenant_crm_threads(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_messages_event_id
  ON tenant_crm_messages(tenant_slug, webhook_event_id)
  WHERE webhook_event_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_messages_fingerprint
  ON tenant_crm_messages(tenant_slug, event_fingerprint);

CREATE INDEX IF NOT EXISTS idx_tenant_crm_messages_thread
  ON tenant_crm_messages(tenant_slug, thread_id, event_timestamp DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_line_webhook_logs (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'rejected', 'failed')),
  error_code TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_line_webhook_logs_request
  ON tenant_line_webhook_logs(tenant_slug, request_fingerprint);

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_message_profile_insert
BEFORE INSERT ON tenant_crm_messages
WHEN NOT EXISTS (
  SELECT 1 FROM tenant_crm_profiles p
  WHERE p.tenant_slug = NEW.tenant_slug AND p.id = NEW.profile_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_message_profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_crm_message_thread_insert
BEFORE INSERT ON tenant_crm_messages
WHEN NOT EXISTS (
  SELECT 1 FROM tenant_crm_threads t
  WHERE t.tenant_slug = NEW.tenant_slug AND t.id = NEW.thread_id
)
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH:crm_message_thread');
END;

PRAGMA foreign_keys = ON;

ALTER TABLE tenant_crm_messages ADD COLUMN text_content TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN send_status TEXT NOT NULL DEFAULT '' CHECK (send_status IN ('', 'pending', 'sent', 'failed'));

ALTER TABLE tenant_crm_messages ADD COLUMN line_message_id TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN error_code TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN error_message_safe TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN sent_by_uid TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN sent_by_role TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN sent_at TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN client_request_id TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_messages ADD COLUMN retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1));

UPDATE tenant_crm_messages
SET text_content = content
WHERE text_content = '' AND content <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_messages_client_request
  ON tenant_crm_messages(tenant_slug, thread_id, client_request_id)
  WHERE client_request_id <> '';

CREATE INDEX IF NOT EXISTS idx_tenant_crm_messages_send_status
  ON tenant_crm_messages(tenant_slug, send_status, created_at DESC);

ALTER TABLE tenant_crm_threads ADD COLUMN assigned_to_uid TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN assigned_by_uid TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN assigned_at TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN queue_status TEXT NOT NULL DEFAULT 'unassigned';

ALTER TABLE tenant_crm_threads ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0);

ALTER TABLE tenant_crm_threads ADD COLUMN first_response_at TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN closed_at TEXT NOT NULL DEFAULT '';

UPDATE tenant_crm_threads
SET queue_status = CASE
  WHEN status = 'closed' THEN 'closed'
  WHEN COALESCE(assigned_to_uid, '') = '' THEN 'unassigned'
  ELSE status
END
WHERE queue_status = 'unassigned';

CREATE INDEX IF NOT EXISTS idx_tenant_crm_threads_queue
  ON tenant_crm_threads(tenant_slug, queue_status, unread_count, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_crm_threads_assignee
  ON tenant_crm_threads(tenant_slug, assigned_to_uid, queue_status, last_message_at DESC);

PRAGMA foreign_keys = ON;

ALTER TABLE tenant_crm_threads ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'));

ALTER TABLE tenant_crm_threads ADD COLUMN sla_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (sla_status IN ('waiting','due_soon','breached','paused','not_applicable'));

ALTER TABLE tenant_crm_threads ADD COLUMN sla_due_at TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN sla_started_at TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN sla_paused_at TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN sla_remaining_seconds INTEGER NOT NULL DEFAULT 0 CHECK (sla_remaining_seconds >= 0);

ALTER TABLE tenant_crm_threads ADD COLUMN waiting_since TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_crm_threads ADD COLUMN last_customer_wait_seconds INTEGER NOT NULL DEFAULT 0 CHECK (last_customer_wait_seconds >= 0);

ALTER TABLE tenant_crm_threads ADD COLUMN total_customer_wait_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_customer_wait_seconds >= 0);

ALTER TABLE tenant_crm_threads ADD COLUMN response_count INTEGER NOT NULL DEFAULT 0 CHECK (response_count >= 0);

ALTER TABLE tenant_crm_threads ADD COLUMN sla_breached_at TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS tenant_line_sla_settings (
  tenant_slug TEXT PRIMARY KEY,
  first_response_sla_minutes INTEGER NOT NULL DEFAULT 30 CHECK (first_response_sla_minutes BETWEEN 1 AND 10080),
  followup_response_sla_minutes INTEGER NOT NULL DEFAULT 60 CHECK (followup_response_sla_minutes BETWEEN 1 AND 10080),
  due_soon_percentage INTEGER NOT NULL DEFAULT 20 CHECK (due_soon_percentage BETWEEN 1 AND 99),
  pause_sla_on_pending INTEGER NOT NULL DEFAULT 1 CHECK (pause_sla_on_pending IN (0,1)),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_slug) REFERENCES tenants(slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_crm_threads_sla
  ON tenant_crm_threads(tenant_slug, sla_status, sla_due_at, waiting_since);

CREATE INDEX IF NOT EXISTS idx_tenant_crm_threads_priority_sla
  ON tenant_crm_threads(tenant_slug, priority, sla_due_at, unread_count, last_message_at DESC);

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
