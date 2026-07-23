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
