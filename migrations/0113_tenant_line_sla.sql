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
