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
