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
