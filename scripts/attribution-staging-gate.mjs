import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksum } from './d1-remote-migration-plan.mjs';

const root = process.cwd();
const REMOTE = process.argv.includes('--remote');
const PENDING = process.argv.includes('--pending');
const BASELINE = process.argv.includes('--baseline');
const STAGING_ENV = 'staging';
const D1_BINDING = 'DB';
const EXPECTED_STAGING_DB = 'travelkeeper-staging-v2';
const LEDGER_TABLE = 'travelkeeper_project_migration_ledger';
const BOOTSTRAP_MANIFEST = 'artifacts/d1-bootstrap/manifest.json';
const EXPECTED_MIGRATIONS = [
  '0115_attribution_contract_v1.sql',
  '0116_tenant_first_touch_attribution.sql',
];
const SAFE_PENDING_SEQUENCES = [
  [],
  ['0116_tenant_first_touch_attribution.sql'],
  EXPECTED_MIGRATIONS,
];
const REQUIRED_TRIGGERS = [
  'trg_customers_referrer_immutable',
  'trg_distributor_referrer_immutable',
  'trg_customer_attribution_projection_insert',
  'trg_customer_attribution_projection_update',
  'trg_tenant_first_touch_validate_insert',
  'trg_tenant_first_touch_immutable',
  'trg_tenant_first_touch_no_delete',
];

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function firstMatch(text, regex) {
  return regex.exec(text)?.[1] || '';
}

function bootstrapManifest() {
  return JSON.parse(read(BOOTSTRAP_MANIFEST));
}

function baselineFiles() {
  return bootstrapManifest().migrations.map(item => item.file);
}

function localMigrationChecksum(file) {
  return checksum(read(path.join('migrations', file)));
}

export function validateReadOnlySql(sql) {
  const value = String(sql || '').trim();
  if (!value) throw new Error('EMPTY_SQL');
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b/i.test(value)) {
    throw new Error('READ_ONLY_SQL_REQUIRED');
  }
  return value;
}

export function coreIntegritySql() {
  return `
    SELECT
      (SELECT COUNT(*)
       FROM customers c
       INNER JOIN tenant_first_touch_attributions f
         ON f.tenant_slug = c.tenant_slug
        AND f.line_user_uid = c.customer_line_uid
       WHERE c.customer_line_uid <> ''
         AND c.ref_uid <> ''
         AND f.ref_uid <> c.ref_uid) AS customer_first_touch_ref_mismatch,
      (SELECT COUNT(*)
       FROM tenant_crm_profiles p
       INNER JOIN customers c
         ON c.tenant_slug = p.tenant_slug
        AND c.customer_id = p.customer_id
       WHERE p.customer_id <> ''
         AND COALESCE(p.ref_uid, '') <> COALESCE(c.ref_uid, '')) AS crm_customer_ref_mismatch,
      (SELECT COUNT(*)
       FROM tenant_crm_profiles p
       INNER JOIN customers c
         ON c.tenant_slug = p.tenant_slug
        AND c.customer_id = p.customer_id
       WHERE p.customer_id <> ''
         AND COALESCE(p.owner_uid, '') <> COALESCE(c.owner_uid, '')) AS crm_customer_owner_mismatch,
      (SELECT COUNT(*)
       FROM tenant_crm_profiles p
       LEFT JOIN customers c
         ON c.tenant_slug = p.tenant_slug
        AND c.customer_id = p.customer_id
       WHERE p.customer_id <> ''
         AND c.customer_id IS NULL) AS crm_customer_missing,
      (SELECT COUNT(*)
       FROM (
         SELECT tenant_slug, customer_line_uid
         FROM customers
         WHERE customer_line_uid <> ''
         GROUP BY tenant_slug, customer_line_uid
         HAVING COUNT(*) > 1
       ) duplicated) AS duplicate_customer_line_identity,
      (SELECT COUNT(*)
       FROM tenant_crm_profiles p
       INNER JOIN tenant_first_touch_attributions f
         ON f.tenant_slug = p.tenant_slug
        AND f.line_user_uid = p.line_user_uid
       WHERE p.customer_id = ''
         AND p.line_user_uid <> ''
         AND COALESCE(p.ref_uid, '') <> COALESCE(f.ref_uid, '')) AS crm_first_touch_ref_mismatch,
      (SELECT COUNT(*)
       FROM tenant_distributor_profiles p
       WHERE p.ref_uid <> ''
         AND p.ref_uid = p.user_uid) AS partner_self_referrer
  `;
}

export function parsePendingMigrations(output) {
  const matches = String(output || '').match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/g) || [];
  return [...new Set(matches)];
}

export function isSafePendingSequence(files) {
  const value = Array.isArray(files) ? files : [];
  return SAFE_PENDING_SEQUENCES.some(sequence =>
    sequence.length === value.length && sequence.every((file, index) => file === value[index])
  );
}

export function evaluateBaselineLedger(row, manifest) {
  const value = row || {};
  const checks = {
    status_completed: String(value.status || '') === 'completed',
    baseline_version: String(value.baseline_version || '') === String(manifest.baseline_version || ''),
    migration_start: String(value.migration_start || '') === String(manifest.migration_start || ''),
    migration_end: String(value.migration_end || '') === String(manifest.migration_end || ''),
    migration_count: Number(value.migration_count || 0) === Number(manifest.migration_count || 0),
    statement_count: Number(value.statement_count || 0) === Number(manifest.statement_count || 0),
    applied_statement_count: Number(value.applied_statement_count || 0) === Number(manifest.statement_count || 0),
    bootstrap_checksum: String(value.bootstrap_checksum || '') === String(manifest.bootstrap_checksum || ''),
    manifest_checksum: String(value.manifest_checksum || '') === String(manifest.manifest_checksum || ''),
    schema_checksum: String(value.schema_checksum || '') === String(manifest.schema_checksum || ''),
    source_commit: String(value.source_commit || '') === String(manifest.source_commit || ''),
  };
  return { safe: Object.values(checks).every(Boolean), checks };
}

export function reconcilePendingWithBootstrap(wranglerPending, {
  manifest,
  baselineTrusted,
  completedForward = [],
  forwardBlocked = false,
} = {}) {
  const pending = Array.isArray(wranglerPending) ? wranglerPending : [];
  if (isSafePendingSequence(pending)) {
    return {
      safe: true,
      registry_mode: 'wrangler-native',
      logical_pending: pending,
      apply_strategy: 'wrangler-migrations',
      decision: 'REVIEWED',
    };
  }

  const baseline = (manifest?.migrations || []).map(item => item.file);
  const hasExactBaselinePrefix = baseline.length > 0 &&
    pending.length >= baseline.length &&
    baseline.every((file, index) => pending[index] === file);

  if (!hasExactBaselinePrefix || !baselineTrusted || forwardBlocked) {
    return {
      safe: false,
      registry_mode: hasExactBaselinePrefix ? 'bootstrap-ledger-untrusted' : 'unknown',
      logical_pending: pending,
      apply_strategy: 'none',
      decision: 'NO-GO',
    };
  }

  const rawForward = pending.slice(baseline.length);
  if (rawForward.some(file => !EXPECTED_MIGRATIONS.includes(file))) {
    return {
      safe: false,
      registry_mode: 'bootstrap-ledger',
      logical_pending: rawForward,
      apply_strategy: 'none',
      decision: 'NO-GO',
    };
  }

  const completed = new Set(completedForward);
  const logicalPending = rawForward.filter(file => !completed.has(file));
  const completedExpected = EXPECTED_MIGRATIONS.filter(file => completed.has(file));
  const completedIsPrefix = completedExpected.every((file, index) => EXPECTED_MIGRATIONS[index] === file);
  const safe = completedIsPrefix && isSafePendingSequence(logicalPending);

  return {
    safe,
    registry_mode: 'bootstrap-ledger',
    logical_pending: logicalPending,
    raw_forward_pending: rawForward,
    completed_forward: completedExpected,
    apply_strategy: safe ? 'project-forward-ledger-required' : 'none',
    decision: safe ? 'REVIEWED_BOOTSTRAP_BASELINE' : 'NO-GO',
  };
}

function parseWranglerJson(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(item => Array.isArray(item?.results) ? item.results : []);
}

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runWrangler(args) {
  let result;
  if (process.platform === 'win32') {
    const commandLine = `& npx.cmd wrangler ${args.map(quotePowerShellArg).join(' ')}`;
    result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', commandLine,
    ], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
    });
  } else {
    result = spawnSync('npx', ['wrangler', ...args], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
    });
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || result.error?.message || 'WRANGLER_FAILED').trim());
  }
  return String(result.stdout || '').trim();
}

function remoteQuery(sql) {
  validateReadOnlySql(sql);
  const output = runWrangler([
    'd1', 'execute', D1_BINDING,
    '--env', STAGING_ENV,
    '--remote',
    '--json',
    '--command', sql,
  ]);
  return parseWranglerJson(output);
}

function hasColumn(rows, name) {
  return rows.some(row => String(row?.name || '') === name);
}

function sumValues(row = {}) {
  return Object.values(row).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

export function staticPlan() {
  const wrangler = read('wrangler.toml');
  const stagingBlock = wrangler.includes('[env.staging]')
    ? wrangler.slice(wrangler.indexOf('[env.staging]'))
    : '';
  const productionId = firstMatch(wrangler, /database_id\s*=\s*"([^"]+)"/);
  const stagingId = firstMatch(wrangler, /\[\[env\.staging\.d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/);
  const stagingName = firstMatch(wrangler, /\[\[env\.staging\.d1_databases\]\][\s\S]*?database_name\s*=\s*"([^"]+)"/);

  const migrations = Object.fromEntries(EXPECTED_MIGRATIONS.map(file => {
    const source = read(path.join('migrations', file));
    return [file, {
      present: source.length > 0,
      has_ref_uid: file.startsWith('0115_') ? /ADD COLUMN ref_uid/.test(source) : true,
      has_first_touch_table: file.startsWith('0116_') ? /CREATE TABLE IF NOT EXISTS tenant_first_touch_attributions/.test(source) : true,
    }];
  }));

  const safe = stagingName === EXPECTED_STAGING_DB &&
    Boolean(stagingId) &&
    stagingId !== productionId &&
    /APP_ENV\s*=\s*"staging"/.test(stagingBlock);

  return {
    safe,
    mode: 'static-plan',
    remote_d1_touched: false,
    production_touched: false,
    staging_env: STAGING_ENV,
    d1_binding: D1_BINDING,
    staging_database_name: stagingName,
    staging_database_id_distinct: Boolean(stagingId) && stagingId !== productionId,
    expected_migrations: migrations,
    commands: {
      review_baseline: 'npm run staging:attribution-baseline',
      review_pending: 'npm run staging:attribution-pending',
      list_pending: 'npx wrangler d1 migrations list DB --env staging --remote',
      wrangler_apply_only_if_registry_native: 'npx wrangler d1 migrations apply DB --env staging --remote',
      deploy_dry_run: 'npx wrangler deploy --env staging --dry-run',
      deploy_staging: 'npx wrangler deploy --env staging',
    },
    rule: 'Never run Wrangler migrations apply when pending review reports bootstrap-ledger mode.',
  };
}

export function baselineReview() {
  const plan = staticPlan();
  if (!plan.safe) throw new Error('STAGING_CONFIGURATION_UNSAFE');
  const manifest = bootstrapManifest();
  const table = remoteQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name='${LEDGER_TABLE}'`);
  if (!table.some(row => row?.name === LEDGER_TABLE)) {
    return {
      mode: 'staging-bootstrap-baseline-review',
      remote_d1_touched: true,
      remote_d1_mutated: false,
      production_touched: false,
      staging_database_name: plan.staging_database_name,
      safe: false,
      decision: 'NO-GO',
      reason: 'PROJECT_MIGRATION_LEDGER_MISSING',
      completed_forward_migrations: [],
      forward_blocked: false,
    };
  }

  const baselineRows = remoteQuery(`
    SELECT baseline_version, migration_start, migration_end,
           bootstrap_checksum, manifest_checksum, source_commit, schema_checksum,
           migration_count, statement_count, applied_statement_count,
           status, completed_at
    FROM ${LEDGER_TABLE}
    WHERE entry_type = 'baseline'
    ORDER BY id DESC
    LIMIT 1
  `);
  const baseline = evaluateBaselineLedger(baselineRows[0], manifest);

  const forwardRows = remoteQuery(`
    SELECT migration_version, migration_checksum, status, created_at, completed_at
    FROM ${LEDGER_TABLE}
    WHERE entry_type = 'forward'
    ORDER BY id ASC
  `);
  const latest = new Map();
  for (const row of forwardRows) latest.set(String(row.migration_version || ''), row);

  const unexpectedForward = [...latest.keys()].filter(version => version && !EXPECTED_MIGRATIONS.includes(version));
  const completedForward = [];
  const forwardChecks = {};
  let forwardBlocked = unexpectedForward.length > 0;

  for (const file of EXPECTED_MIGRATIONS) {
    const row = latest.get(file);
    if (!row) continue;
    const expectedChecksum = localMigrationChecksum(file);
    const status = String(row.status || '');
    const checksumMatches = String(row.migration_checksum || '') === expectedChecksum;
    forwardChecks[file] = { status, checksum_matches: checksumMatches };
    if (status === 'completed' && checksumMatches) completedForward.push(file);
    else forwardBlocked = true;
  }

  const completedIsPrefix = completedForward.every((file, index) => EXPECTED_MIGRATIONS[index] === file);
  if (!completedIsPrefix) forwardBlocked = true;

  const safe = baseline.safe && !forwardBlocked;
  return {
    mode: 'staging-bootstrap-baseline-review',
    remote_d1_touched: true,
    remote_d1_mutated: false,
    production_touched: false,
    staging_database_name: plan.staging_database_name,
    safe,
    decision: safe ? 'BASELINE_TRUSTED' : 'NO-GO',
    baseline_version: manifest.baseline_version,
    baseline_checks: baseline.checks,
    completed_forward_migrations: completedForward,
    forward_checks: forwardChecks,
    unexpected_forward_migrations: unexpectedForward,
    forward_blocked: forwardBlocked,
  };
}

export function pendingReview() {
  const plan = staticPlan();
  if (!plan.safe) throw new Error('STAGING_CONFIGURATION_UNSAFE');
  const output = runWrangler([
    'd1', 'migrations', 'list', D1_BINDING,
    '--env', STAGING_ENV,
    '--remote',
  ]);
  const pending = parsePendingMigrations(output);

  let baseline = null;
  const manifest = bootstrapManifest();
  const baselinePrefix = baselineFiles();
  const hasBaselinePrefix = baselinePrefix.length > 0 &&
    pending.length >= baselinePrefix.length &&
    baselinePrefix.every((file, index) => pending[index] === file);

  if (!isSafePendingSequence(pending) && hasBaselinePrefix) baseline = baselineReview();

  const reconciled = reconcilePendingWithBootstrap(pending, {
    manifest,
    baselineTrusted: Boolean(baseline?.safe),
    completedForward: baseline?.completed_forward_migrations || [],
    forwardBlocked: Boolean(baseline?.forward_blocked),
  });

  return {
    mode: 'staging-pending-migration-review',
    remote_d1_touched: true,
    remote_d1_mutated: false,
    production_touched: false,
    staging_database_name: plan.staging_database_name,
    safe: reconciled.safe,
    wrangler_pending: pending,
    logical_pending: reconciled.logical_pending,
    registry_mode: reconciled.registry_mode,
    apply_strategy: reconciled.apply_strategy,
    baseline_review: baseline ? {
      decision: baseline.decision,
      baseline_version: baseline.baseline_version,
      baseline_checks: baseline.baseline_checks,
      completed_forward_migrations: baseline.completed_forward_migrations,
      forward_checks: baseline.forward_checks,
      unexpected_forward_migrations: baseline.unexpected_forward_migrations,
    } : null,
    expected_safe_sequences: SAFE_PENDING_SEQUENCES,
    decision: reconciled.decision,
    rule: reconciled.registry_mode === 'bootstrap-ledger'
      ? 'DO NOT run wrangler d1 migrations apply; use the project forward-ledger path for 0115/0116.'
      : 'Wrangler migrations apply is eligible only after explicit human approval.',
  };
}

export function remoteSmoke() {
  const plan = staticPlan();
  if (!plan.safe) throw new Error('STAGING_CONFIGURATION_UNSAFE');

  const customerColumns = remoteQuery('PRAGMA table_info(customers)');
  const distributorColumns = remoteQuery('PRAGMA table_info(tenant_distributor_profiles)');
  const firstTouchTable = remoteQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_first_touch_attributions'");
  const triggerRows = remoteQuery(`SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (${REQUIRED_TRIGGERS.map(name => `'${name}'`).join(',')}) ORDER BY name`);
  const foreignKeyRows = remoteQuery('PRAGMA foreign_key_check');
  const coreRows = remoteQuery(coreIntegritySql());
  const core = coreRows[0] || {};
  const coreMismatchCount = sumValues(core);
  const triggerNames = new Set(triggerRows.map(row => String(row?.name || '')));
  const missingTriggers = REQUIRED_TRIGGERS.filter(name => !triggerNames.has(name));

  const checks = {
    customers_ref_uid: hasColumn(customerColumns, 'ref_uid'),
    tenant_distributor_profiles_ref_uid: hasColumn(distributorColumns, 'ref_uid'),
    first_touch_table: firstTouchTable.some(row => row?.name === 'tenant_first_touch_attributions'),
    required_triggers: missingTriggers.length === 0,
    foreign_keys_clean: foreignKeyRows.length === 0,
    core_attribution_clean: coreMismatchCount === 0,
  };

  return {
    mode: 'staging-remote-read-only',
    scope: 'all-tenants',
    remote_d1_touched: true,
    remote_d1_mutated: false,
    production_touched: false,
    staging_database_name: plan.staging_database_name,
    healthy: Object.values(checks).every(Boolean),
    checks,
    missing_triggers: missingTriggers,
    core,
    core_mismatch_count: coreMismatchCount,
    checked_at: new Date().toISOString(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = BASELINE ? baselineReview() : (PENDING ? pendingReview() : (REMOTE ? remoteSmoke() : staticPlan()));
    console.log(JSON.stringify(report, null, 2));
    if (report.safe === false || report.healthy === false) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      mode: BASELINE ? 'staging-bootstrap-baseline-review' : (PENDING ? 'staging-pending-migration-review' : (REMOTE ? 'staging-remote-read-only' : 'static-plan')),
      remote_d1_mutated: false,
      production_touched: false,
      error: String(error?.message || error),
    }, null, 2));
    process.exitCode = 1;
  }
}
