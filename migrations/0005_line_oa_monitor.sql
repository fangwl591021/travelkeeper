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
