import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  validateReadOnlySql,
  coreIntegritySql,
  parsePendingMigrations,
  isSafePendingSequence,
  evaluateBaselineLedger,
  reconcilePendingWithBootstrap,
  staticPlan,
} from '../scripts/attribution-staging-gate.mjs';

const gateUrl = new URL('../scripts/attribution-staging-gate.mjs', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const manifestUrl = new URL('../artifacts/d1-bootstrap/manifest.json', import.meta.url);

test('staging gate accepts read-only SQL and rejects D1 mutation statements', () => {
  assert.equal(validateReadOnlySql('SELECT COUNT(*) FROM customers'), 'SELECT COUNT(*) FROM customers');
  assert.equal(validateReadOnlySql('PRAGMA foreign_key_check'), 'PRAGMA foreign_key_check');
  for (const sql of [
    'UPDATE customers SET owner_uid = x',
    'INSERT INTO customers DEFAULT VALUES',
    'DELETE FROM customers',
    'ALTER TABLE customers ADD COLUMN x TEXT',
    'CREATE TABLE unsafe (id TEXT)',
    'DROP TABLE customers',
  ]) {
    assert.throws(() => validateReadOnlySql(sql), /READ_ONLY_SQL_REQUIRED/);
  }
});

test('core staging integrity scan covers all tenants instead of hard-coding demo', () => {
  const sql = coreIntegritySql();
  assert.doesNotMatch(sql, /tenant_slug\s*=\s*['"]demo['"]/i);
  assert.match(sql, /GROUP BY tenant_slug, customer_line_uid/);
  assert.match(sql, /f\.tenant_slug = c\.tenant_slug/);
  assert.match(sql, /c\.tenant_slug = p\.tenant_slug/);
});

test('pending migration parser extracts Wrangler migration filenames in order without duplicates', () => {
  const output = `Migrations to be applied:\n0115_attribution_contract_v1.sql\n0116_tenant_first_touch_attribution.sql\n0116_tenant_first_touch_attribution.sql`;
  assert.deepEqual(parsePendingMigrations(output), [
    '0115_attribution_contract_v1.sql',
    '0116_tenant_first_touch_attribution.sql',
  ]);
});

test('pending migration gate accepts only the expected attribution tail in Wrangler-native mode', () => {
  assert.equal(isSafePendingSequence([]), true);
  assert.equal(isSafePendingSequence(['0116_tenant_first_touch_attribution.sql']), true);
  assert.equal(isSafePendingSequence([
    '0115_attribution_contract_v1.sql',
    '0116_tenant_first_touch_attribution.sql',
  ]), true);
  assert.equal(isSafePendingSequence(['0115_attribution_contract_v1.sql']), false);
  assert.equal(isSafePendingSequence([
    '0114_d1_tenant_integrity_compat.sql',
    '0115_attribution_contract_v1.sql',
    '0116_tenant_first_touch_attribution.sql',
  ]), false);
  assert.equal(isSafePendingSequence(['9999_unknown.sql']), false);
});

test('bootstrap baseline ledger must exactly match the checked-in manifest', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const row = {
    status: 'completed',
    baseline_version: manifest.baseline_version,
    migration_start: manifest.migration_start,
    migration_end: manifest.migration_end,
    migration_count: manifest.migration_count,
    statement_count: manifest.statement_count,
    applied_statement_count: manifest.statement_count,
    bootstrap_checksum: manifest.bootstrap_checksum,
    manifest_checksum: manifest.manifest_checksum,
    schema_checksum: manifest.schema_checksum,
    source_commit: manifest.source_commit,
  };
  const valid = evaluateBaselineLedger(row, manifest);
  assert.equal(valid.safe, true);
  const invalid = evaluateBaselineLedger({ ...row, schema_checksum: 'drift' }, manifest);
  assert.equal(invalid.safe, false);
  assert.equal(invalid.checks.schema_checksum, false);
});

test('full Wrangler pending list can reconcile through a trusted bootstrap ledger without allowing Wrangler apply', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const baseline = manifest.migrations.map(item => item.file);
  const fullPending = [...baseline,
    '0115_attribution_contract_v1.sql',
    '0116_tenant_first_touch_attribution.sql',
  ];
  const result = reconcilePendingWithBootstrap(fullPending, {
    manifest,
    baselineTrusted: true,
    completedForward: [],
    forwardBlocked: false,
  });
  assert.equal(result.safe, true);
  assert.equal(result.registry_mode, 'bootstrap-ledger');
  assert.equal(result.apply_strategy, 'project-forward-ledger-required');
  assert.equal(result.decision, 'REVIEWED_BOOTSTRAP_BASELINE');
  assert.deepEqual(result.logical_pending, [
    '0115_attribution_contract_v1.sql',
    '0116_tenant_first_touch_attribution.sql',
  ]);
});

test('bootstrap ledger completed forward migrations are removed from logical pending in order', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const baseline = manifest.migrations.map(item => item.file);
  const result = reconcilePendingWithBootstrap([
    ...baseline,
    '0115_attribution_contract_v1.sql',
    '0116_tenant_first_touch_attribution.sql',
  ], {
    manifest,
    baselineTrusted: true,
    completedForward: ['0115_attribution_contract_v1.sql'],
    forwardBlocked: false,
  });
  assert.equal(result.safe, true);
  assert.deepEqual(result.logical_pending, ['0116_tenant_first_touch_attribution.sql']);
  assert.equal(result.apply_strategy, 'project-forward-ledger-required');
});

test('untrusted or blocked bootstrap ledger remains NO-GO', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const pending = [
    ...manifest.migrations.map(item => item.file),
    '0115_attribution_contract_v1.sql',
    '0116_tenant_first_touch_attribution.sql',
  ];
  assert.equal(reconcilePendingWithBootstrap(pending, {
    manifest,
    baselineTrusted: false,
  }).safe, false);
  assert.equal(reconcilePendingWithBootstrap(pending, {
    manifest,
    baselineTrusted: true,
    forwardBlocked: true,
  }).safe, false);
});

test('static staging plan targets the distinct staging D1 binding and never production', () => {
  const plan = staticPlan();
  assert.equal(plan.safe, true);
  assert.equal(plan.staging_env, 'staging');
  assert.equal(plan.d1_binding, 'DB');
  assert.equal(plan.staging_database_name, 'travelkeeper-staging-v2');
  assert.equal(plan.staging_database_id_distinct, true);
  assert.equal(plan.remote_d1_touched, false);
  assert.equal(plan.production_touched, false);
  assert.equal(plan.expected_migrations['0115_attribution_contract_v1.sql'].present, true);
  assert.equal(plan.expected_migrations['0116_tenant_first_touch_attribution.sql'].present, true);
  assert.match(plan.rule, /Never run Wrangler migrations apply when pending review reports bootstrap-ledger mode/);
});

test('remote smoke implementation uses staging env, remote D1 and JSON read queries only', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /'d1', 'execute', D1_BINDING/);
  assert.match(source, /'--env', STAGING_ENV/);
  assert.match(source, /'--remote'/);
  assert.match(source, /'--json'/);
  assert.match(source, /validateReadOnlySql\(sql\)/);
  assert.match(source, /scope: 'all-tenants'/);
  assert.match(source, /remote_d1_mutated: false/);
  assert.match(source, /production_touched: false/);
});

test('baseline review is read-only and verifies the project ledger', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /travelkeeper_project_migration_ledger/);
  assert.match(source, /entry_type = 'baseline'/);
  assert.match(source, /baseline\.safe/);
  assert.match(source, /BASELINE_TRUSTED/);
  assert.doesNotMatch(source, /UPDATE\s+travelkeeper_project_migration_ledger/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+travelkeeper_project_migration_ledger/i);
});

test('pending review only runs migrations list and read-only ledger queries against staging remote binding', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /'d1', 'migrations', 'list', D1_BINDING/);
  assert.match(source, /mode: 'staging-pending-migration-review'/);
  assert.match(source, /registry_mode/);
  assert.match(source, /project-forward-ledger-required/);
});

test('Windows Wrangler launch uses PowerShell with safely quoted arguments', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /process\.platform === 'win32'/);
  assert.match(source, /spawnSync\('powershell\.exe'/);
  assert.match(source, /npx\.cmd wrangler/);
  assert.match(source, /replace\(\/\'\/g, "''"\)/);
});

test('migration apply is only printed for human review and is never passed to runWrangler', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /wrangler_apply_only_if_registry_native: 'npx wrangler d1 migrations apply DB --env staging --remote'/);
  const runWranglerCalls = [...source.matchAll(/runWrangler\(\[([\s\S]*?)\]\)/g)].map(match => match[1]).join('\n');
  assert.doesNotMatch(runWranglerCalls, /migrations[\s\S]*apply/);
  assert.doesNotMatch(runWranglerCalls, /deploy/);
});

test('package exposes static, baseline, pending-review and read-only remote smoke commands', async () => {
  const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(pkg.scripts['staging:attribution-gate'], 'node scripts/attribution-staging-gate.mjs');
  assert.equal(pkg.scripts['staging:attribution-baseline'], 'node scripts/attribution-staging-gate.mjs --baseline');
  assert.equal(pkg.scripts['staging:attribution-pending'], 'node scripts/attribution-staging-gate.mjs --pending');
  assert.equal(pkg.scripts['staging:attribution-smoke'], 'node scripts/attribution-staging-gate.mjs --remote');
  assert.equal(Object.values(pkg.scripts).some(value => /migrations apply.*--remote/i.test(value)), false);
  assert.equal(Object.values(pkg.scripts).some(value => /wrangler deploy(?!.*dry-run)/i.test(value)), false);
});
