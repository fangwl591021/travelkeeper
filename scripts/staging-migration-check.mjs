import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const immutableBaselineCommit = '6bafde8a6ca6a4e29363e4f706d9d300e42882eb';
const localOnly = ['--local'];
const requiredTables = [
  'tenant_line_channels',
  'tenant_crm_profiles',
  'tenant_crm_threads',
  'tenant_crm_messages',
  'tenant_line_sla_settings',
  'tenant_memberships',
  'audit_logs',
  'customers',
  'orders',
];
const requiredThreadColumns = [
  'priority',
  'waiting_since',
  'sla_due_at',
  'sla_status',
  'sla_paused_at',
  'sla_remaining_seconds',
  'response_count',
  'last_customer_wait_seconds',
  'total_customer_wait_seconds',
  'sla_breached_at',
];
const requiredSecrets = [
  'TENANT_PAYMENT_MASTER_KEY',
];
const requiredVars = [
  'TENANT_PAYMENT_KEY_VERSION',
];
const tenantLineCredentialStores = [
  'tenant_line_channels.channel_secret encrypted via tenant LINE channel API',
  'tenant_line_channels.channel_access_token encrypted via tenant LINE channel API',
];
const checkedButUnusedSecrets = [
  'TENANT_CREDENTIAL_MASTER_KEY not referenced by current Worker code',
  'SESSION_SECRET not referenced by current Worker code',
];
const featureFlags = [
  'TENANT_LINE_MONITOR_ENABLED',
  'TENANT_LINE_OUTBOUND_ENABLED',
  'TENANT_LINE_QUEUE_ENABLED',
  'TENANT_LINE_SLA_ENABLED',
];

function read(rel) { return readFileSync(path.join(root, rel), 'utf8'); }
function status(name, ok, detail = '') { return { name, ok: Boolean(ok), detail }; }
function firstMatch(text, regex) { return regex.exec(text)?.[1] || ''; }
function quotePowerShellArg(value) { return `'${String(value).replace(/'/g, "''")}'`; }

function run(command, args) {
  if (args.includes('--remote')) throw new Error('Remote D1 access is blocked by Phase 16 readiness check');
  const isWindowsCmd = process.platform === 'win32' && /\.cmd$/i.test(command);
  const result = isWindowsCmd
    ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${command} ${args.map(quotePowerShellArg).join(' ')}`], { cwd: root, encoding: 'utf8', shell: false })
    : spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || result.error?.message || '').trim(),
  };
}

function wranglerSql(sql) {
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum)\b/i.test(sql)) {
    throw new Error(`Read-only SQL required: ${sql}`);
  }
  return run('npx.cmd', ['wrangler', 'd1', 'execute', 'travelkeeper', ...localOnly, '--command', sql]);
}

function wranglerResults(output) {
  const start = String(output || '').indexOf('[\n');
  if (start < 0) return [];
  try { return JSON.parse(String(output).slice(start))?.[0]?.results || []; } catch (_) { return []; }
}
function redactName(name) { return /(secret|token|authorization|replytoken|ciphertext|\biv\b)/i.test(String(name || '')) ? '[redacted-column]' : name; }
function countFromOutput(output) { return Number(wranglerResults(output)?.[0]?.count ?? 0); }
function tableInfo(table) { const result = wranglerSql(`PRAGMA table_info(${table})`); return result.ok ? result.stdout : result.stderr; }
function rowCount(table) { const result = wranglerSql(`SELECT COUNT(*) AS count FROM ${table}`); return result.ok ? result.stdout : result.stderr; }

const checks = [];
const warnings = [];
const blockers = [];
const wrangler = existsSync(path.join(root, 'wrangler.toml')) ? read('wrangler.toml') : '';
const wranglerExample = existsSync(path.join(root, 'wrangler.example.toml')) ? read('wrangler.example.toml') : '';
const migrationsDir = path.join(root, 'migrations');
const migrations = existsSync(migrationsDir) ? readdirSync(migrationsDir).filter(file => /^\d+_.*\.sql$/.test(file)).sort() : [];
const historicalMigrations = migrations.filter(file => Number(file.slice(0, 4)) <= 113);
const phaseMigrations = migrations.filter(file => /^01(0\\d|1[0-3])_/.test(file));
const forwardFixMigration = '0114_d1_tenant_integrity_compat.sql';
const hasStagingEnv = /\[env\.staging\]/.test(wrangler);
const stagingBlock = hasStagingEnv ? wrangler.slice(wrangler.indexOf('[env.staging]')) : '';
const productionD1Id = firstMatch(wrangler, /database_id\s*=\s*"([^"]+)"/);
const stagingD1Id = firstMatch(wrangler, /\[\[env\.staging\.d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/);

checks.push(status('worker entrypoint is worker-tenant.js', /main\s*=\s*"worker-tenant\.js"/.test(wrangler)));
checks.push(status('production D1 binding remains DB/travelkeeper', /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"[\s\S]*?database_name\s*=\s*"travelkeeper"[\s\S]*?database_id\s*=\s*"184f9dff-18fe-401f-9374-098ed7b0eb38"/.test(wrangler)));
checks.push(status('D1 binding has migrations_dir', /migrations_dir\s*=\s*"migrations"/.test(wrangler)));
checks.push(status('latest Phase 15B migration exists', migrations.includes('0113_tenant_line_sla.sql')));
checks.push(status('D1 tenant integrity forward-fix exists', migrations.includes(forwardFixMigration)));
checks.push(status('Phase 13-15B migration range present', ['0109_tenant_crm.sql', '0110_tenant_line_channels.sql', '0111_tenant_line_outbound_messages.sql', '0112_tenant_line_work_queue.sql', '0113_tenant_line_sla.sql'].every(file => migrations.includes(file))));
const immutableCheck = run('git', ['diff', '--quiet', immutableBaselineCommit, '--', ...historicalMigrations.map(file => path.join('migrations', file))]);
checks.push(status('historical migrations match immutable Phase 16.3 baseline', immutableCheck.ok, immutableCheck.ok ? immutableBaselineCommit : immutableCheck.stderr || immutableCheck.stdout));
checks.push(status('wrangler.example.toml keeps placeholder D1 id', /REPLACE_WITH_DATABASE_ID/.test(wranglerExample)));
checks.push(status('staging env is configured in wrangler.toml', hasStagingEnv, 'NO-GO until [env.staging] is configured'));
checks.push(status('staging Worker name is travelkeeper-staging', /\[env\.staging\][\s\S]*?name\s*=\s*"travelkeeper-staging"/.test(wrangler)));
checks.push(status('staging D1 database name is travelkeeper-staging-v2', /\[\[env\.staging\.d1_databases\]\][\s\S]*?database_name\s*=\s*"travelkeeper-staging-v2"/.test(wrangler)));
checks.push(status('staging D1 id is distinct from production', !!stagingD1Id && stagingD1Id !== productionD1Id && !/REPLACE_WITH/.test(stagingD1Id), stagingD1Id ? 'placeholder or distinct id required before remote deploy' : 'missing staging database_id'));
checks.push(status('staging APP_ENV is explicit', /APP_ENV\s*=\s*"staging"/.test(stagingBlock)));
checks.push(status('staging starts with monitor-only rollout flags', /TENANT_LINE_MONITOR_ENABLED\s*=\s*"1"/.test(stagingBlock) && /TENANT_LINE_QUEUE_ENABLED\s*=\s*"0"/.test(stagingBlock) && /TENANT_LINE_SLA_ENABLED\s*=\s*"0"/.test(stagingBlock) && /TENANT_LINE_OUTBOUND_ENABLED\s*=\s*"0"/.test(stagingBlock)));
checks.push(status('staging allowed origin is explicit and not wildcard', /STAGING_ALLOWED_ORIGIN\s*=\s*"https:\/\//.test(stagingBlock) && !/STAGING_ALLOWED_ORIGIN\s*=\s*"\*"/.test(stagingBlock) && !/<replace-with|replace-with-workers-subdomain>/i.test(stagingBlock)));
checks.push(status('staging allowed origin matches confirmed Worker host', /STAGING_ALLOWED_ORIGIN\s*=\s*"https:\/\/travelkeeper-staging\.fangwl591021\.workers\.dev"/.test(stagingBlock)));
checks.push(status('staging payment key version is explicit', /TENANT_PAYMENT_KEY_VERSION\s*=\s*"v1"/.test(stagingBlock)));
checks.push(status('staging LINE push uses mock until test OA is confirmed', /LINE_PUSH_API_URL\s*=\s*"https:\/\/line-push-mock\.invalid\//.test(stagingBlock)));

if (!hasStagingEnv) blockers.push('wrangler.toml has no [env.staging]; staging deployment is not ready yet.');
if (!stagingD1Id || /REPLACE_WITH/.test(stagingD1Id)) blockers.push('staging D1 database_id must be replaced after human-confirmed D1 creation.');
if (stagingD1Id && stagingD1Id === productionD1Id) blockers.push('staging D1 database_id must not reuse production database_id.');
if (/<replace-with|replace-with-workers-subdomain>/i.test(stagingBlock)) blockers.push('staging allowed origin is still a placeholder; CORS remains fail-closed until the staging host is confirmed.');
blockers.push('staging secrets must be set with Wrangler after human confirmation; values were not read.');
blockers.push('test LINE OA channel has not been confirmed in this checkout.');

for (const file of phaseMigrations) {
  const sql = read(path.join('migrations', file));
  if (/\b(seed|sample|fixture|test tenant|demo tenant)\b/i.test(sql)) warnings.push(`${file}: review text for seed/test wording`);
}

const migrationList = run('npx.cmd', ['wrangler', 'd1', 'migrations', 'list', 'travelkeeper', ...localOnly]);
checks.push(status('local D1 migration list command completed', migrationList.ok, migrationList.ok ? '' : migrationList.stderr));
const schema = wranglerSql("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name");
checks.push(status('local D1 schema inventory query completed', schema.ok, schema.ok ? '' : schema.stderr));

const tableResults = {};
const rawTableInfo = {};
for (const table of requiredTables) {
  const info = tableInfo(table);
  rawTableInfo[table] = info;
  const countOutput = rowCount(table);
  tableResults[table] = { columns: wranglerResults(info).map(row => redactName(row.name)), row_count: countFromOutput(countOutput) };
  checks.push(status(`local D1 table exists: ${table}`, !/no such table/i.test(info) && info.length > 0, /no such table/i.test(info) || !info.length ? 'missing-or-empty-output' : ''));
}
for (const column of requiredThreadColumns) checks.push(status(`tenant_crm_threads column: ${column}`, rawTableInfo.tenant_crm_threads.includes(column)));
const integrity = wranglerSql('PRAGMA foreign_key_check');
const integrityRows = wranglerResults(integrity.stdout);
checks.push(status('local D1 foreign_key_check command completed', integrity.ok && integrityRows.length === 0, integrity.ok ? `rows=${integrityRows.length}` : integrity.stderr));

const report = {
  generated_at: new Date().toISOString(),
  mode: 'local-read-only',
  remote_d1_touched: false,
  production_secrets_read: false,
  worker_entrypoint: firstMatch(wrangler, /main\s*=\s*"([^"]+)"/),
  default_d1_database_name: firstMatch(wrangler, /database_name\s*=\s*"([^"]+)"/),
  default_d1_database_id_present: Boolean(productionD1Id),
  staging_env_present: hasStagingEnv,
  staging_d1_database_name: firstMatch(wrangler, /\[\[env\.staging\.d1_databases\]\][\s\S]*?database_name\s*=\s*"([^"]+)"/),
  staging_d1_database_id_status: stagingD1Id && !/REPLACE_WITH/.test(stagingD1Id) ? 'configured' : 'placeholder',
  required_worker_secrets: requiredSecrets.map(name => ({ name, value_read: false, status: 'presence-only-check-required-in-staging-worker' })),
  required_worker_vars: requiredVars.map(name => ({ name, value_read: false, status: 'presence-only-check-required-in-staging-worker' })),
  tenant_line_credentials: tenantLineCredentialStores.map(name => ({ name, value_read: false, status: 'stored-encrypted-in-d1-not-worker-secret' })),
  checked_but_unused_worker_secrets: checkedButUnusedSecrets,
  feature_flags: featureFlags,
  migration_count: migrations.length,
  immutable_baseline_commit: immutableBaselineCommit,
  immutable_historical_migration_count: historicalMigrations.length,
  forward_fix_migration: forwardFixMigration,
  phase_migrations: phaseMigrations,
  checks,
  warnings,
  blockers,
  table_results: tableResults,
  go_no_go: blockers.length ? 'NO-GO' : 'GO',
};

console.log(JSON.stringify(report, null, 2));
if (strict && report.go_no_go !== 'GO') process.exit(1);
