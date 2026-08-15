import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseSqlStatements, migrationPlan } from '../scripts/d1-remote-migration-plan.mjs';
import { compareSchemaSnapshots } from '../scripts/d1-schema-equivalence.mjs';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

test('parser keeps a multi-statement trigger as one statement', () => {
  const statements = parseSqlStatements("CREATE TRIGGER trg AFTER INSERT ON t BEGIN INSERT INTO log VALUES ('a;b'); UPDATE t SET x = 1; END;");
  assert.equal(statements.length, 1);
  assert.equal(statements[0].type, 'CREATE TRIGGER');
});

test('parser ignores semicolons in comments and strings', () => {
  const statements = parseSqlStatements("-- comment;\nCREATE TABLE t (value TEXT DEFAULT 'x;y'); /* block; */ CREATE INDEX idx ON t(value);");
  assert.equal(statements.length, 2);
  assert.deepEqual(statements.map((statement) => statement.type), ['CREATE TABLE', 'CREATE INDEX']);
});

test('parser accepts CASE and IIF expressions', () => {
  const statements = parseSqlStatements("INSERT INTO t VALUES (CASE WHEN x = 1 THEN 'a;b' ELSE 'c' END); INSERT INTO t VALUES (IIF(x = 1, 'a', 'b'));");
  assert.equal(statements.length, 2);
  assert.deepEqual(statements.map((statement) => statement.type), ['INSERT', 'INSERT']);
});

test('parser rejects an incomplete trigger', () => {
  assert.throws(() => parseSqlStatements('CREATE TRIGGER trg AFTER INSERT ON t BEGIN INSERT INTO log VALUES (1);'), /incomplete CREATE TRIGGER/);
});

test('all canonical migrations parse and preserve all trigger statements', () => {
  const plan = migrationPlan(migrationsDir);
  assert.equal(plan.migrationCount, 37);
  assert.equal(plan.triggerCount, 42);
  assert.equal(plan.migrations.find((migration) => migration.file === '0114_d1_tenant_integrity_compat.sql').statementCount, 11);
  const attribution = plan.migrations.find((migration) => migration.file === '0115_attribution_contract_v1.sql');
  assert.equal(attribution.statementCount, 19);
  assert.equal(attribution.statements.filter((statement) => statement.type === 'CREATE TRIGGER').length, 11);
  const firstTouch = plan.migrations.find((migration) => migration.file === '0116_tenant_first_touch_attribution.sql');
  assert.equal(firstTouch.statementCount, 13);
  assert.equal(firstTouch.statements.filter((statement) => statement.type === 'CREATE TRIGGER').length, 5);
});

test('schema equivalence fails closed on trigger loss', () => {
  const canonical = { tables: [{ name: 't', sql: 'CREATE TABLE t (id TEXT)' }], indexes: [], uniqueConstraints: [], foreignKeys: [], triggers: [{ name: 'trg', table: 't', sql: 'CREATE TRIGGER trg ...', checksum: 'abc' }] };
  const result = compareSchemaSnapshots(canonical, { ...canonical, triggers: [] });
  assert.equal(result.equal, false);
  assert.deepEqual(result.differences, ['triggers']);
});

test('schema equivalence accepts normalized formatting only', () => {
  const left = { tables: [{ name: 't', sql: 'CREATE TABLE t (id TEXT)' }], indexes: [], uniqueConstraints: [], foreignKeys: [], triggers: [] };
  const right = { tables: [{ name: 't', sql: 'CREATE  TABLE t (id TEXT)' }], indexes: [], uniqueConstraints: [], foreignKeys: [], triggers: [] };
  assert.equal(compareSchemaSnapshots(left, right).equal, true);
});

test('cross-tenant trigger rules are represented in canonical migrations', () => {
  const expectations = [
    ['0100_tenant_isolation_phase1.sql', 'trg_orders_tenant_itinerary_insert'],
    ['0100_tenant_isolation_phase1.sql', 'trg_payments_tenant_order_insert'],
    ['0108_tenant_customer_identity.sql', 'trg_orders_tenant_customer_insert'],
    ['0109_tenant_crm.sql', 'trg_tenant_crm_thread_profile_insert'],
    ['0110_tenant_line_channels.sql', 'trg_tenant_crm_message_thread_insert'],
    ['0104_platform_collection_settlements.sql', 'trg_platform_collection_payables_tenant_insert'],
    ['0106_settlement_accounts_and_proofs.sql', 'trg_settlement_proof_tenant_insert'],
    ['0101_tenant_profiles_and_relations.sql', 'trg_payout_batch_orders_tenant_insert'],
    ['0115_attribution_contract_v1.sql', 'trg_customers_referrer_immutable'],
    ['0115_attribution_contract_v1.sql', 'trg_distributor_referrer_immutable'],
    ['0115_attribution_contract_v1.sql', 'trg_crm_referrer_customer_update'],
    ['0115_attribution_contract_v1.sql', 'trg_customer_attribution_projection_update'],
    ['0116_tenant_first_touch_attribution.sql', 'trg_tenant_first_touch_validate_insert'],
    ['0116_tenant_first_touch_attribution.sql', 'trg_tenant_first_touch_immutable'],
    ['0116_tenant_first_touch_attribution.sql', 'trg_tenant_first_touch_no_delete'],
    ['0116_tenant_first_touch_attribution.sql', 'trg_customers_referrer_insert'],
    ['0116_tenant_first_touch_attribution.sql', 'trg_customers_referrer_update'],
  ];
  const plan = migrationPlan(migrationsDir);
  for (const [file, name] of expectations) {
    const migration = plan.migrations.find((item) => item.file === file);
    assert.ok(migration.statements.some((statement) => statement.triggerName === name));
  }
});

test('canonical migration files are immutable against the Phase 16.3 baseline', () => {
  const baseline = '6bafde8a6ca6a4e29363e4f706d9d300e42882eb';
  const historicalFiles = migrationPlan(migrationsDir).migrations.filter((migration) => Number(migration.file.slice(0, 4)) <= 113).map((migration) => 'migrations/' + migration.file);
  assert.equal(execFileSync('git', ['diff', '--quiet', baseline, '--', ...historicalFiles], { encoding: 'utf8' }), '');
});
