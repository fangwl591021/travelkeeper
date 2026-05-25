CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'general',
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_settings_namespace ON system_settings(namespace);
