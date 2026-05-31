CREATE TABLE IF NOT EXISTS line_learning_examples (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  source_user_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  customer_context TEXT NOT NULL DEFAULT '',
  customer_messages TEXT NOT NULL DEFAULT '',
  guide_responses TEXT NOT NULL DEFAULT '',
  learned_reply_style TEXT NOT NULL DEFAULT '',
  intent_tags TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_response', 'archived')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (thread_id) REFERENCES line_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_line_learning_examples_thread_id
  ON line_learning_examples(thread_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_line_learning_examples_source_user_id
  ON line_learning_examples(source_user_id, status, updated_at);
