ALTER TABLE line_threads
  ADD COLUMN opportunity_stage TEXT NOT NULL DEFAULT 'new'
    CHECK (opportunity_stage IN ('new', 'qualified', 'quoted', 'payment', 'won', 'lost'));

ALTER TABLE line_threads
  ADD COLUMN opportunity_value INTEGER NOT NULL DEFAULT 0;

ALTER TABLE line_threads
  ADD COLUMN opportunity_note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_line_threads_opportunity_stage
  ON line_threads(opportunity_stage, updated_at);
