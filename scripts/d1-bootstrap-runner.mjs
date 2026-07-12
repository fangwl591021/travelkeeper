import { checksum, parseSqlStatements } from './d1-remote-migration-plan.mjs';

export const LEDGER_TABLE = 'travelkeeper_project_migration_ledger';

export function createLedgerSchema(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS " + LEDGER_TABLE + " (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "entry_type TEXT NOT NULL CHECK (entry_type IN ('baseline','forward'))," +
    "baseline_version TEXT NOT NULL," +
    "migration_version TEXT NOT NULL DEFAULT ''," +
    "migration_start TEXT NOT NULL DEFAULT ''," +
    "migration_end TEXT NOT NULL DEFAULT ''," +
    "bootstrap_checksum TEXT NOT NULL DEFAULT ''," +
    "manifest_checksum TEXT NOT NULL DEFAULT ''," +
    "migration_checksum TEXT NOT NULL DEFAULT ''," +
    "source_commit TEXT NOT NULL," +
    "schema_checksum TEXT NOT NULL," +
    "migration_first TEXT NOT NULL DEFAULT ''," +
    "migration_last TEXT NOT NULL DEFAULT ''," +
    "migration_count INTEGER NOT NULL DEFAULT 0," +
    "statement_count INTEGER NOT NULL DEFAULT 0," +
    "status TEXT NOT NULL CHECK (status IN ('started','completed','failed'))," +
    "statement_index INTEGER NOT NULL DEFAULT -1," +
    "error_type TEXT NOT NULL DEFAULT ''," +
    "error_message TEXT NOT NULL DEFAULT ''," +
    "applied_statement_count INTEGER NOT NULL DEFAULT 0," +
    "completed_at TEXT NOT NULL DEFAULT ''," +
    "failure_statement_index INTEGER NOT NULL DEFAULT -1," +
    "failure_statement_type TEXT NOT NULL DEFAULT ''," +
    "failure_statement_checksum TEXT NOT NULL DEFAULT ''," +
    "failure_error_safe TEXT NOT NULL DEFAULT ''," +
    "created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
    ")"
  );
}

function userObjects(db) {
  return db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '" + LEDGER_TABLE + "' ORDER BY type, name").all();
}

function assertEmptyDatabase(db) {
  const objects = userObjects(db);
  if (objects.length) throw new Error('bootstrap requires an empty database; found ' + objects.map((object) => object.type + ':' + object.name).join(','));
}

function manifestStatements(manifest) {
  return manifest.migrations.flatMap((migration) => migration.statements.map((statement) => ({
    file: migration.file,
    ...statement,
  })));
}

export function verifyBootstrapIntegrity(bootstrapSql, manifest) {
  if (checksum(bootstrapSql) !== manifest.bootstrap_checksum) throw new Error('bootstrap checksum mismatch');
  const statements = parseSqlStatements(bootstrapSql, 'bootstrap.sql');
  const expected = manifestStatements(manifest);
  if (statements.length !== expected.length) throw new Error('bootstrap statement count mismatch');
  statements.forEach((statement, index) => {
    const expectedStatement = expected[index];
    if (statement.type !== expectedStatement.type || statement.checksum !== expectedStatement.checksum) {
      throw new Error('bootstrap statement drift at index ' + index + ' expected ' + expectedStatement.type + '/' + expectedStatement.checksum + ' got ' + statement.type + '/' + statement.checksum);
    }
  });
  return statements;
}

function insertLedger(db, row) {
  db.prepare(
    "INSERT INTO " + LEDGER_TABLE + " (" +
    "entry_type, baseline_version, migration_version, migration_start, migration_end, " +
    "bootstrap_checksum, manifest_checksum, migration_checksum, source_commit, schema_checksum, status, " +
    "migration_first, migration_last, migration_count, statement_count, applied_statement_count, " +
    "statement_index, error_type, error_message, failure_statement_index, failure_statement_type, " +
    "failure_statement_checksum, failure_error_safe" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    row.entry_type,
    row.baseline_version,
    row.migration_version || '',
    row.migration_start || '',
    row.migration_end || '',
    row.bootstrap_checksum || '',
    row.manifest_checksum || '',
    row.migration_checksum || '',
    row.source_commit,
    row.schema_checksum,
    row.status,
    row.migration_first || '',
    row.migration_last || '',
    row.migration_count ?? 0,
    row.statement_count ?? 0,
    row.applied_statement_count ?? 0,
    row.statement_index ?? -1,
    row.error_type || '',
    row.error_message || '',
    row.failure_statement_index ?? -1,
    row.failure_statement_type || '',
    row.failure_statement_checksum || '',
    row.failure_error_safe || '',
  );
}

export function installBootstrap(db, { bootstrapSql, manifest }) {
  assertEmptyDatabase(db);
  const statements = verifyBootstrapIntegrity(bootstrapSql, manifest);
  createLedgerSchema(db);
  insertLedger(db, {
    entry_type: 'baseline',
    baseline_version: manifest.baseline_version,
    migration_start: manifest.migration_start,
    migration_end: manifest.migration_end,
    bootstrap_checksum: manifest.bootstrap_checksum,
    manifest_checksum: manifest.manifest_checksum,
    source_commit: manifest.source_commit,
    schema_checksum: manifest.schema_checksum,
    migration_first: manifest.migration_start,
    migration_last: manifest.migration_end,
    migration_count: manifest.migration_count,
    statement_count: manifest.statement_count,
    status: 'started',
  });

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    try {
      db.exec(statement.sql);
    } catch (error) {
      insertLedger(db, {
        entry_type: 'baseline',
        baseline_version: manifest.baseline_version,
        migration_start: manifest.migration_start,
        migration_end: manifest.migration_end,
        bootstrap_checksum: manifest.bootstrap_checksum,
        manifest_checksum: manifest.manifest_checksum,
        source_commit: manifest.source_commit,
        schema_checksum: manifest.schema_checksum,
        migration_first: manifest.migration_start,
        migration_last: manifest.migration_end,
        migration_count: manifest.migration_count,
        statement_count: manifest.statement_count,
        applied_statement_count: index,
        failure_statement_index: index,
        failure_statement_type: statement.type,
        failure_statement_checksum: statement.checksum,
        failure_error_safe: String(error.message || error).slice(0, 500),
        status: 'failed',
        statement_index: index,
        error_type: statement.type,
        error_message: String(error.message || error).slice(0, 500),
      });
      throw new Error('bootstrap failed at statement ' + index + ' type=' + statement.type + ' checksum=' + statement.checksum);
    }
  }

  const completed = db.prepare(
    "UPDATE " + LEDGER_TABLE + " SET status = 'completed', completed_at = datetime('now'), applied_statement_count = ? " +
    "WHERE entry_type = 'baseline' AND baseline_version = ? AND status = 'started' " +
    "AND bootstrap_checksum = ? AND manifest_checksum = ? AND schema_checksum = ?"
  ).run(
    statements.length, manifest.baseline_version, manifest.bootstrap_checksum,
    manifest.manifest_checksum, manifest.schema_checksum,
  );
  if (completed.changes !== 1) throw new Error('baseline ledger completion requires exactly one matching started row');
  return { completed: true, statementCount: statements.length };
}

export function applyForwardMigration(db, { version, sql, manifest }) {
  if (!/^011[5-9]_|^01[2-9]\d_/.test(version)) throw new Error('forward migration must start at 0115');
  const completed = db.prepare("SELECT * FROM " + LEDGER_TABLE + " WHERE entry_type = 'baseline' AND status = 'completed' ORDER BY id DESC LIMIT 1").get();
  if (!completed) throw new Error('completed baseline ledger entry is required');
  if (completed.bootstrap_checksum !== manifest.bootstrap_checksum || completed.schema_checksum !== manifest.schema_checksum) throw new Error('baseline manifest drift detected');
  const statements = parseSqlStatements(sql, version);
  const migrationChecksum = checksum(sql);
  insertLedger(db, {
    entry_type: 'forward',
    baseline_version: manifest.baseline_version,
    migration_version: version,
    migration_checksum: migrationChecksum,
    source_commit: manifest.source_commit,
    schema_checksum: manifest.schema_checksum,
    status: 'started',
  });
  for (let index = 0; index < statements.length; index += 1) {
    try {
      db.exec(statements[index].sql);
    } catch (error) {
      insertLedger(db, {
        entry_type: 'forward',
        baseline_version: manifest.baseline_version,
        migration_version: version,
        migration_checksum: migrationChecksum,
        source_commit: manifest.source_commit,
        schema_checksum: manifest.schema_checksum,
        status: 'failed',
        statement_index: index,
        error_type: statements[index].type,
        error_message: String(error.message || error).slice(0, 500),
      });
      throw new Error('forward migration failed at statement ' + index + ' type=' + statements[index].type + ' checksum=' + statements[index].checksum);
    }
  }
  insertLedger(db, {
    entry_type: 'forward',
    baseline_version: manifest.baseline_version,
    migration_version: version,
    migration_checksum: migrationChecksum,
    source_commit: manifest.source_commit,
    schema_checksum: manifest.schema_checksum,
    status: 'completed',
  });
  return { completed: true, statementCount: statements.length, migrationChecksum };
}
