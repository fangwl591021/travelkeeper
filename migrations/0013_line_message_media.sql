ALTER TABLE line_messages
  ADD COLUMN media_url TEXT NOT NULL DEFAULT '';

ALTER TABLE line_messages
  ADD COLUMN media_content_type TEXT NOT NULL DEFAULT '';

ALTER TABLE line_messages
  ADD COLUMN media_size INTEGER NOT NULL DEFAULT 0;
