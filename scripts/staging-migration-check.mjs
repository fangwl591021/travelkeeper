import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
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
  'LINE channel secret per tenant',
  'LINE channel access token per tenant',
  'TENANT_PAYMENT_MASTER_KEY',
  'TENANT_PAYMENT_KEY_VERSION',
  'auth/session secret used by LINE LIFF auth',
];
const featureFlags = [
  'TENANT_LINE_MONITOR_ENABLED',
  'TENANT_LINE_OUTBOUND_ENABLED',
  'TENANT_LINE_QUEUE_ENABLED',
  'TENANT_LINE_SLA_ENABLED',
];

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function status(name, ok, detail = '') {
  return { name, ok: Boolean(ok), detail };
}

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

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

function redactName(name) {
  return /(secret|token|authorization|replytoken|ciphertext|\biv\b)/i.test(String(name || '')) ? '[redacted-column]' : name;
}

function countFromOutput(output) {
  return Number(wranglerResults(output)?.[0]?.count ?? 0);
}
function tableInfo(table) {
  const result = wranglerSql(`PRAGMA table_info(${table})`);
  return result.ok ? result.stdout : result.stderr;
}

function rowCount(table) {
  const result = wranglerSql(`SELECT COUNT(*) AS count FROM ${table}`);
  return result.ok ? result.stdout : result.stderr;
}

const checks = [];
const warnings = [];
const blockers = [];
const wrangler = existsSync(path.join(root, 'wrangler.toml')) ? read('wrangler.toml') : '';
const wranglerExample = existsSync(path.join(root, 'wrangler.example.toml')) ? read('wrangler.example.toml') : '';
const migrationsDir = path.join(root, 'migrations');
const migrations = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter(file => /^\d+_.*\.sql$/.test(file)).sort()
  : [];
const phaseMigrations = migrations.filter(file => /^01(0\d|1[0-3])_/.test(file));

checks.push(status('worker entrypoint is worker-tenant.js', /main\s*=\s*"worker-tenant\.js"/.test(wrangler)));
checks.push(status('D1 binding has migrations_dir', /migrations_dir\s*=\s*"migrations"/.test(wrangler)));
checks.push(status('latest Phase 15B migration exists', migrations.includes('0113_tenant_line_sla.sql')));
checks.push(status('Phase 13-15B migration range present', ['0109_tenant_crm.sql', '0110_tenant_line_channels.sql', '0111_tenant_line_outbound_messages.sql', '0112_tenant_line_work_queue.sql', '0113_tenant_line_sla.sql'].every(file => migrations.includes(file))));
checks.push(status('no staging env is currently configured in wrangler.toml', !/\[env\.staging\]/.test(wrangler), 'NO-GO until a distinct staging env and D1 id are configured'));
checks.push(status('wrangler.example.toml keeps placeholder D1 id', /REPLACE_WITH_DATABASE_ID/.test(wranglerExample)));

const d1Ids = [...wrangler.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map(match => match[1]);
const uniqueD1Ids = new Set(d1Ids);
if (/\[env\.staging\]/.test(wrangler) && uniqueD1Ids.size < d1Ids.length) {
  blockers.push('staging D1 database_id must not reuse another environment id');
}
if (!/\[env\.staging\]/.test(wrangler)) warnings.push('wrangler.toml has no [env.staging]; staging deployment is not ready yet.');

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
  tableResults[table] = {
    columns: wranglerResults(info).map(row => redactName(row.name)),
    row_count: countFromOutput(countOutput),
  };
  checks.push(status(`local D1 table exists: ${table}`, !/no such table/i.test(info) && info.length > 0, /no such table/i.test(info) || !info.length ? 'missing-or-empty-output' : ''));
}
for (const column of requiredThreadColumns) {
  checks.push(status(`tenant_crm_threads column: ${column}`, rawTableInfo.tenant_crm_threads.includes(column)));
}

const integrity = wranglerSql('PRAGMA foreign_key_check');
const integrityRows = wranglerResults(integrity.stdout);
checks.push(status('local D1 foreign_key_check command completed', integrity.ok && integrityRows.length === 0, integrity.ok ? `rows=${integrityRows.length}` : integrity.stderr));

const report = {
  generated_at: new Date().toISOString(),
  mode: 'local-read-only',
  remote_d1_touched: false,
  production_secrets_read: false,
  worker_entrypoint: /main\s*=\s*"([^"]+)"/.exec(wrangler)?.[1] || '',
  default_d1_database_name: /database_name\s*=\s*"([^"]+)"/.exec(wrangler)?.[1] || '',
  default_d1_database_id_present: d1Ids.length > 0,
  staging_env_present: /\[env\.staging\]/.test(wrangler),
  required_secrets: requiredSecrets.map(name => ({ name, value_read: false, status: 'presence-only-check-required-in-staging' })),
  feature_flags: featureFlags,
  migration_count: migrations.length,
  phase_migrations: phaseMigrations,
  checks,
  warnings,
  blockers,
  table_results: tableResults,
  go_no_go: blockers.length || !/\[env\.staging\]/.test(wrangler) ? 'NO-GO' : 'GO',
};

console.log(JSON.stringify(report, null, 2));

if (strict && report.go_no_go !== 'GO') process.exit(1);
