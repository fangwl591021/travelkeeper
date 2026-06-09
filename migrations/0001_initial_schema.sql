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
