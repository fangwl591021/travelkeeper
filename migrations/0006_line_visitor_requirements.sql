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
