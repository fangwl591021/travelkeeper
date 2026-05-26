ALTER TABLE line_threads
  ADD COLUMN ai_paused INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_line_threads_ai_paused
  ON line_threads(ai_paused, updated_at);
