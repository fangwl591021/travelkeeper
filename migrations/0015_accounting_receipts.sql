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
