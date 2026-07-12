import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const INTERNAL_PREFIXES = ['sqlite_', '_cf_'];

function isInternal(name) {
  return INTERNAL_PREFIXES.some((prefix) => String(name || '').startsWith(prefix)) || name === 'd1_migrations' || name === 'travelkeeper_project_migration_ledger';
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])]));
  }
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').trim().replace(/[ \t]+/g, ' ');
  return value;
}

function quoteIdentifier(identifier) {
  return '"' + String(identifier).replaceAll('"', '""') + '"';
}

export function normalizeSchemaSnapshot(snapshot) {
  const sections = ['tables', 'indexes', 'uniqueConstraints', 'foreignKeys', 'triggers'];
  const normalized = {};
  for (const section of sections) {
    normalized[section] = (snapshot[section] || [])
      .map(normalizeValue)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return normalized;
}

export function schemaChecksum(snapshot) {
  return createHash('sha256')
    .update(JSON.stringify(normalizeSchemaSnapshot(snapshot)), 'utf8')
    .digest('hex');
}

export function snapshotSqliteDatabase(db) {
  const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') ORDER BY type, name").all();
  const tableObjects = objects.filter((row) => row.type === 'table' && !isInternal(row.name));
  const indexObjects = objects.filter((row) => row.type === 'index' && !isInternal(row.name));

  const tables = tableObjects.map((table) => ({
    name: table.name,
    sql: table.sql,
    columns: db.prepare('PRAGMA table_info(' + quoteIdentifier(table.name) + ')').all().map((column) => ({
      cid: column.cid,
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      default: column.dflt_value,
      primaryKey: column.pk,
    })),
  }));

  const foreignKeys = [];
  const indexes = [];
  const uniqueConstraints = [];
  for (const table of tableObjects) {
    for (const foreignKey of db.prepare('PRAGMA foreign_key_list(' + quoteIdentifier(table.name) + ')').all()) {
      foreignKeys.push({
        table: table.name,
        id: foreignKey.id,
        seq: foreignKey.seq,
        from: foreignKey.from,
        to: foreignKey.to,
        parentTable: foreignKey.table,
        onUpdate: foreignKey.on_update,
        onDelete: foreignKey.on_delete,
        match: foreignKey.match,
      });
    }
    for (const index of db.prepare('PRAGMA index_list(' + quoteIdentifier(table.name) + ')').all()) {
      if (isInternal(index.name)) continue;
      const indexRow = {
        name: index.name,
        table: table.name,
        sql: indexObjects.find((candidate) => candidate.name === index.name)?.sql || '',
        unique: index.unique,
        origin: index.origin,
        partial: index.partial,
        columns: db.prepare('PRAGMA index_info(' + quoteIdentifier(index.name) + ')').all().map((column) => ({
          seqno: column.seqno,
          name: column.name,
        })),
      };
      indexes.push(indexRow);
      if (index.unique) uniqueConstraints.push({
        table: table.name,
        name: index.name,
        columns: indexRow.columns,
      });
    }
  }

  return normalizeSchemaSnapshot({
    tables,
    indexes,
    uniqueConstraints,
    foreignKeys,
    triggers: objects.filter((row) => row.type === 'trigger' && !isInternal(row.name)).map((trigger) => ({
      name: trigger.name,
      table: trigger.tbl_name,
      sql: trigger.sql,
    })),
  });
}

export function compareSchemaSnapshots(left, right) {
  const normalizedLeft = normalizeSchemaSnapshot(left);
  const normalizedRight = normalizeSchemaSnapshot(right);
  const differences = Object.keys(normalizedLeft)
    .filter((section) => JSON.stringify(normalizedLeft[section]) !== JSON.stringify(normalizedRight[section]));
  return { equal: differences.length === 0, differences, left: normalizedLeft, right: normalizedRight };
}

if (process.argv[1]?.endsWith('d1-schema-equivalence.mjs')) {
  const [leftPath, rightPath] = process.argv.slice(2);
  if (!leftPath || !rightPath) {
    console.error('Usage: node scripts/d1-schema-equivalence.mjs <canonical.json> <proposed.json>');
    process.exit(2);
  }
  const result = compareSchemaSnapshots(JSON.parse(readFileSync(leftPath, 'utf8')), JSON.parse(readFileSync(rightPath, 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  if (!result.equal) process.exitCode = 1;
}
