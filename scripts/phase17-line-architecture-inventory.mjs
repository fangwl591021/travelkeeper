#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export const ROUTE_TABLE_MAPPING = Object.freeze([
  { route: '/line-webhook', architecture: 'production-legacy', tables: ['line_threads', 'line_messages'], tenantResolution: 'environment/single-OA assumption; requires verification' },
  { route: '/line-webhook/{tenant}', architecture: 'legacy-tenant-parameter', tables: ['line_threads', 'line_messages'], tenantResolution: 'path parameter; handler verification required' },
  { route: '/api/v2/line/webhook/{tenant_slug}', architecture: 'tenant-v2', tables: ['tenant_crm_profiles', 'tenant_crm_threads', 'tenant_crm_messages'], tenantResolution: 'validated path tenant_slug plus tenant channel settings' },
  { route: '/platform-line-webhook', architecture: 'platform', tables: ['platform webhook log/settings tables'], tenantResolution: 'platform channel configuration' },
]);

export const SCHEMA_MAPPING = Object.freeze([
  ['LINE UID', 'legacy user/thread UID field', 'line_user_uid', 'transform/verify'],
  ['display_name', 'legacy profile/thread field', 'tenant_crm_profiles.display_name', 'direct when present'],
  ['picture_url', 'legacy profile field', 'tenant_crm_profiles.picture_url', 'direct when present'],
  ['thread ID', 'line_threads primary key', 'tenant_crm_threads.id', 'transform; preserve legacy reference'],
  ['status', 'legacy status', 'tenant_crm_threads.status/queue_status', 'transform'],
  ['risk', 'possibly absent', 'tenant_crm_threads.risk', 'legacy missing risk'],
  ['note', 'legacy note if present', 'tenant_crm_threads.note/profile note', 'verify schema'],
  ['tags', 'legacy tags if present', 'tenant-v2 tags', 'normalize JSON/list'],
  ['message type', 'line_messages type', 'tenant_crm_messages.message_type', 'direct/normalize'],
  ['text', 'line_messages text/content', 'tenant_crm_messages.content', 'direct; never print plaintext'],
  ['event ID', 'legacy event id if present', 'tenant_crm_messages.webhook_event_id', 'verify uniqueness/nulls'],
  ['created_at', 'legacy timestamp', 'created_at', 'normalize timezone/format'],
  ['owner_uid', 'possibly absent', 'tenant_crm_threads.owner_uid', 'legacy missing'],
  ['assignee', 'possibly absent', 'tenant_crm_threads.assignee_uid', 'legacy missing'],
  ['unread', 'boolean/count if present', 'tenant_crm_threads.unread_count', 'transform'],
  ['direction', 'implicit or explicit', 'tenant_crm_messages.direction', 'transform'],
  ['send status', 'legacy outbound status if present', 'tenant-v2 outbound/send status', 'verify schema'],
  ['SLA', 'absent/unstructured', 'tenant_crm_threads SLA fields', 'legacy missing'],
  ['tenant_slug', 'typically absent', 'required on tenant-v2 rows', 'critical resolution required'],
]);

const forbiddenKey = /(token|secret|ciphertext|\biv\b|message_text|content|body|plaintext|uid_list|replytoken)/i;
const allowedAggregateKey = /^(count|counts|total|distinct|duplicate|orphan|null|invalid|earliest|latest|distribution|schema|columns|tables|indexes|route|mapping|metadata|source|status|architecture|tenant|unknown|quarantine|reply_token_non_empty)$/i;

export function sanitizeInventory(value, key = '') {
  if (forbiddenKey.test(key) && !/^reply_token_non_empty$/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) {
    if (/uid/i.test(key)) return { count: value.length, redacted: true };
    return value.map(item => sanitizeInventory(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeInventory(child, childKey)]));
  }
  if (/uid/i.test(key) && !allowedAggregateKey.test(key)) return value ? '[REDACTED]' : value;
  return value;
}

export function summarizeRows(rows = [], options = {}) {
  const uidField = options.uidField || 'line_user_uid';
  const eventField = options.eventField || 'webhook_event_id';
  const threadField = options.threadField || 'thread_id';
  const typeField = options.typeField || 'message_type';
  const createdField = options.createdField || 'created_at';
  const replyTokenField = options.replyTokenField || 'reply_token';
  const ids = new Set();
  const events = new Map();
  const types = {};
  let nullInvalidUid = 0;
  let replyTokenNonEmpty = 0;
  let earliest = '';
  let latest = '';
  let orphanMessages = 0;
  for (const row of rows) {
    const uid = String(row?.[uidField] || '').trim();
    if (!/^U[0-9a-f]{32}$/i.test(uid)) nullInvalidUid += 1;
    else ids.add(uid);
    const eventId = String(row?.[eventField] || '').trim();
    if (eventId) events.set(eventId, (events.get(eventId) || 0) + 1);
    const type = String(row?.[typeField] || 'unknown').trim() || 'unknown';
    types[type] = (types[type] || 0) + 1;
    const created = String(row?.[createdField] || '').trim();
    if (created && (!earliest || created < earliest)) earliest = created;
    if (created && (!latest || created > latest)) latest = created;
    if (threadField && !String(row?.[threadField] || '').trim()) orphanMessages += 1;
    if (String(row?.[replyTokenField] || '').trim()) replyTokenNonEmpty += 1;
  }
  return {
    count: rows.length,
    distinct_line_uid: ids.size,
    duplicate_event_id: [...events.values()].filter(count => count > 1).reduce((sum, count) => sum + count - 1, 0),
    null_invalid_uid: nullInvalidUid,
    orphan_messages: orphanMessages,
    message_type_distribution: types,
    earliest_created_at: earliest || null,
    latest_created_at: latest || null,
    reply_token_non_empty: replyTokenNonEmpty,
  };
}

function parseArgs(argv) {
  const result = { input: '', output: '', pretty: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') result.input = argv[++i] || '';
    else if (argv[i] === '--output') result.output = argv[++i] || '';
    else if (argv[i] === '--compact') result.pretty = false;
    else if (argv[i] === '--help') result.help = true;
  }
  return result;
}

export function buildReport(input = {}) {
  return sanitizeInventory({
    generated_at: new Date().toISOString(),
    mode: 'read-only-safe-aggregate',
    routes: ROUTE_TABLE_MAPPING,
    schema_mapping: SCHEMA_MAPPING,
    production_legacy: input.production_legacy || { status: 'not_provided' },
    staging_tenant_v2: input.staging_tenant_v2 || { status: 'not_provided' },
    tenant_resolution: input.tenant_resolution || { unknown: 'quarantine; never default to demo' },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/phase17-line-architecture-inventory.mjs --input safe-aggregates.json [--output report.json] [--compact]');
    return;
  }
  let input = {};
  if (args.input) input = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
  const report = buildReport(input);
  const text = JSON.stringify(report, null, args.pretty ? 2 : 0) + '\n';
  if (args.output) fs.writeFileSync(path.resolve(args.output), text, 'utf8');
  else process.stdout.write(text);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.message); process.exitCode = 1; });
