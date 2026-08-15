import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  validateReadOnlySql,
  coreIntegritySql,
  parsePendingMigrations,
  isSafePendingSequence,
  quotePowerShellArg,
  staticPlan,
} from '../scripts/attribution-staging-gate.mjs';

const gateUrl = new URL('../scripts/attribution-staging-gate.mjs', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

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

test('pending migration gate accepts only the expected attribution tail', () => {
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

test('PowerShell argument quoting preserves embedded single quotes for Windows Wrangler commands', () => {
  assert.equal(quotePowerShellArg('staging'), "'staging'");
  assert.equal(
    quotePowerShellArg("SELECT name FROM sqlite_master WHERE name='customers'"),
    "'SELECT name FROM sqlite_master WHERE name=''customers'''",
  );
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

test('Windows Wrangler launch uses PowerShell instead of direct spawn of npx.cmd', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /spawnSync\('powershell\.exe'/);
  assert.match(source, /`& npx\.cmd \$\{wranglerArgs\.map\(quotePowerShellArg\)\.join\(' '\)\}`/);
  assert.doesNotMatch(source, /const command = process\.platform === 'win32' \? 'npx\.cmd'/);
});

test('pending review only runs migrations list against staging remote binding', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /'d1', 'migrations', 'list', D1_BINDING/);
  assert.match(source, /mode: 'staging-pending-migration-review'/);
  assert.match(source, /decision: safe \? 'REVIEWED' : 'NO-GO'/);
});

test('migration apply is only printed for human review and is never passed to runWrangler', async () => {
  const source = await readFile(gateUrl, 'utf8');
  assert.match(source, /apply_after_human_review: 'npx wrangler d1 migrations apply DB --env staging --remote'/);
  const runWranglerCalls = [...source.matchAll(/runWrangler\(\[([\s\S]*?)\]\)/g)].map(match => match[1]).join('\n');
  assert.doesNotMatch(runWranglerCalls, /migrations[\s\S]*apply/);
  assert.doesNotMatch(runWranglerCalls, /deploy/);
});

test('package exposes static, pending-review and read-only remote smoke commands', async () => {
  const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(pkg.scripts['staging:attribution-gate'], 'node scripts/attribution-staging-gate.mjs');
  assert.equal(pkg.scripts['staging:attribution-pending'], 'node scripts/attribution-staging-gate.mjs --pending');
  assert.equal(pkg.scripts['staging:attribution-smoke'], 'node scripts/attribution-staging-gate.mjs --remote');
  assert.equal(Object.values(pkg.scripts).some(value => /migrations apply.*--remote/i.test(value)), false);
  assert.equal(Object.values(pkg.scripts).some(value => /wrangler deploy(?!.*dry-run)/i.test(value)), false);
});
