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
