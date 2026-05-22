CREATE TABLE IF NOT EXISTS wasabi_import_objects (
  object_key TEXT PRIMARY KEY,
  source_group TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  last_modified TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS wasabi_import_records (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  source_group TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  record_json TEXT NOT NULL DEFAULT '{}',
  mapped_table TEXT NOT NULL DEFAULT '',
  mapped_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'staged',
  note TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (object_key) REFERENCES wasabi_import_objects(object_key)
);

CREATE INDEX IF NOT EXISTS idx_wasabi_import_records_object_key
  ON wasabi_import_records(object_key);

CREATE INDEX IF NOT EXISTS idx_wasabi_import_records_source_group
  ON wasabi_import_records(source_group, status);

CREATE INDEX IF NOT EXISTS idx_wasabi_import_records_mapped
  ON wasabi_import_records(mapped_table, mapped_key);
