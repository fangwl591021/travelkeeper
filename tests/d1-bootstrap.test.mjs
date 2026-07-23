import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checksum, parseSqlStatements } from '../scripts/d1-remote-migration-plan.mjs';
import { compareSchemaSnapshots, snapshotSqliteDatabase } from '../scripts/d1-schema-equivalence.mjs';
import { generateBootstrap, writeBootstrapArtifacts, checkBootstrapArtifacts } from '../scripts/d1-bootstrap-generator.mjs';
import { applyForwardMigration, installBootstrap, LEDGER_TABLE } from '../scripts/d1-bootstrap-runner.mjs';

const migrationsDir = path.resolve('migrations');

function generated() {
  return generateBootstrap({
    migrationsDir,
    sourceCommit: '2aedbcde8829d6dedd5b836ddf87cbc4627d2e9b',
  });
}

function canonicalDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
    for (const statement of parseSqlStatements(readFileSync(path.join(migrationsDir, file), 'utf8'), file)) db.exec(statement.sql);
  }
  return db;
}

function seedCrossTenantRows(db) {
  db.exec("INSERT INTO tenants (slug, name) VALUES ('tenant-b', 'Tenant B')");
  db.exec("INSERT INTO distributors (uid, agency_slug) VALUES ('U-DEMO', 'demo'), ('U-B', 'tenant-b')");
  db.exec("INSERT INTO customers (customer_phone, owner_uid, tenant_slug, customer_id, contact_phone) VALUES ('0900', 'U-DEMO', 'demo', 'C1', '0900')");
  db.exec("INSERT INTO itineraries (id, owner_uid, tenant_slug, title) VALUES ('I-DEMO', 'U-DEMO', 'demo', 'Demo'), ('I-B', 'U-B', 'tenant-b', 'Tenant B')");
  db.exec("INSERT INTO tenant_crm_profiles (id, tenant_slug, customer_id) VALUES ('P-DEMO', 'demo', 'C1')");
  db.exec("INSERT INTO tenant_crm_threads (id, tenant_slug, profile_id) VALUES ('T-DEMO', 'demo', 'P-DEMO')");
  db.exec("INSERT INTO platform_collection_batches (id, tenant_slug) VALUES ('B-DEMO', 'demo')");
}

function assertCrossTenantRejections(db) {
  assert.throws(() => db.exec("INSERT INTO tenant_crm_threads (id, tenant_slug, profile_id) VALUES ('T-BAD', 'tenant-b', 'P-DEMO')"), /TENANT_MISMATCH:crm_thread_profile/);
  assert.throws(() => db.exec("INSERT INTO tenant_crm_messages (id, tenant_slug, profile_id, thread_id, event_fingerprint) VALUES ('M-BAD', 'tenant-b', 'P-DEMO', 'T-DEMO', 'bad-message')"), /TENANT_MISMATCH:crm_message_(profile|thread)/);
  assert.throws(() => db.exec("INSERT INTO orders (order_id, itinerary_id, distributor_uid, customer_name, customer_phone, travelers, travel_date, status, tenant_slug, customer_id, contact_phone) VALUES ('O-BAD', 'I-B', 'U-B', 'Bad', '0900', 1, '2026-08-01', 'pending', 'tenant-b', 'C1', '0900')"), /TENANT_MISMATCH:order_customer/);
  assert.throws(() => db.exec("INSERT INTO platform_collection_batch_proofs (id, tenant_slug, batch_id, storage_key) VALUES ('PROOF-BAD', 'tenant-b', 'B-DEMO', 'proof-bad')"), /TENANT_MISMATCH/);
}

test('bootstrap generation is deterministic and checksummed', () => {
  const left = generated();
  const right = generated();
  assert.equal(left.bootstrapSql, right.bootstrapSql);
  assert.deepEqual(left.manifest, right.manifest);
  assert.equal(left.manifest.migration_count, 35);
  assert.equal(left.manifest.statement_count, 301);
  assert.equal(left.manifest.migrations.flatMap((migration) => migration.statements).length, 301);
  assert.equal(left.manifest.manifest_checksum, checksum(JSON.stringify({ ...left.manifest, manifest_checksum: undefined })));
});

test('artifact generator detects bootstrap and manifest drift', () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'travelkeeper-bootstrap-'));
  const artifact = generated();
  writeBootstrapArtifacts(outputDir, artifact);
  assert.equal(checkBootstrapArtifacts(outputDir, artifact), true);
  const manifestPath = path.join(outputDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.bootstrap_checksum = 'drift';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  assert.throws(() => checkBootstrapArtifacts(outputDir, artifact), /manifest drift detected/);
});

test('bootstrap install matches canonical schema and writes completed project ledger', () => {
  const artifact = generated();
  const db = new DatabaseSync(':memory:');
  const result = installBootstrap(db, artifact);
  assert.deepEqual(result, { completed: true, statementCount: 301 });
  assert.equal(compareSchemaSnapshots(artifact.schema, snapshotSqliteDatabase(db)).equal, true);
  const ledger = db.prepare("SELECT entry_type, status, baseline_version, migration_start, migration_end, bootstrap_checksum, manifest_checksum, schema_checksum, applied_statement_count, completed_at FROM " + LEDGER_TABLE + " WHERE status = 'completed'").all();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].baseline_version, '0001-0114');
  assert.equal(ledger[0].migration_start, '0001_initial_schema.sql');
  assert.equal(ledger[0].migration_end, '0114_d1_tenant_integrity_compat.sql');
  assert.equal(ledger[0].manifest_checksum, artifact.manifest.manifest_checksum);
  assert.equal(ledger[0].applied_statement_count, 301);
  assert.notEqual(ledger[0].completed_at, '');
});

test('bootstrap and canonical clean schemas are equivalent', () => {
  const artifact = generated();
  assert.equal(compareSchemaSnapshots(artifact.schema, snapshotSqliteDatabase(canonicalDb())).equal, true);
  const db = new DatabaseSync(':memory:');
  installBootstrap(db, artifact);
  assert.equal(compareSchemaSnapshots(artifact.schema, snapshotSqliteDatabase(db)).equal, true);
});

test('bootstrap schema has all 26 triggers and rejects cross-tenant writes', () => {
  const artifact = generated();
  const db = new DatabaseSync(':memory:');
  installBootstrap(db, artifact);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger'").get().count, 26);
  seedCrossTenantRows(db);
  assertCrossTenantRejections(db);
});

test('bootstrap failure records statement diagnostics and never completed', () => {
  const artifact = generated();
  const badStatement = 'SELECT * FROM missing_bootstrap_table;';
  const badSql = artifact.bootstrapSql + badStatement + '\n';
  const badManifest = structuredClone(artifact.manifest);
  const last = badManifest.migrations.at(-1);
  last.statements.push({ index: last.statements.length, type: 'SELECT', triggerName: '', checksum: checksum(badStatement) });
  last.statementCount += 1;
  badManifest.statement_count += 1;
  badManifest.bootstrap_checksum = checksum(badSql);
  const db = new DatabaseSync(':memory:');
  assert.throws(() => installBootstrap(db, { bootstrapSql: badSql, manifest: badManifest }), /bootstrap failed at statement 301 type=SELECT/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM " + LEDGER_TABLE + " WHERE status = 'completed'").get().count, 0);
  assert.equal(db.prepare("SELECT statement_index, error_type FROM " + LEDGER_TABLE + " WHERE status = 'failed'").get().statement_index, 301);
});

test('empty database gate rejects existing user objects', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE existing_user_table (id TEXT)');
  assert.throws(() => installBootstrap(db, generated()), /bootstrap requires an empty database/);
});

test('forward prototype requires 0115 and preserves schema equivalence', () => {
  const artifact = generated();
  const forwardSql = "CREATE TABLE bootstrap_forward_probe (id TEXT PRIMARY KEY, tenant_slug TEXT NOT NULL); CREATE INDEX idx_bootstrap_forward_probe_tenant ON bootstrap_forward_probe(tenant_slug);";
  const canonical = new DatabaseSync(':memory:');
  installBootstrap(canonical, artifact);
  canonical.exec(forwardSql);
  const proposed = new DatabaseSync(':memory:');
  installBootstrap(proposed, artifact);
  const result = applyForwardMigration(proposed, { version: '0115_bootstrap_forward_probe.sql', sql: forwardSql, manifest: artifact.manifest });
  assert.equal(result.completed, true);
  assert.equal(compareSchemaSnapshots(snapshotSqliteDatabase(canonical), snapshotSqliteDatabase(proposed)).equal, true);
  assert.throws(() => applyForwardMigration(proposed, { version: '0114_invalid.sql', sql: forwardSql, manifest: artifact.manifest }), /forward migration must start at 0115/);
});
