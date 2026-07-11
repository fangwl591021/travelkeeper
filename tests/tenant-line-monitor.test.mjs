import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('tenant LINE monitor API scopes threads and messages by tenant', async () => {
  const source = await read('lib/tenant-line-monitor-api.js');
  assert.match(source, /t\.tenant_slug = \?/);
  assert.match(source, /tenant_crm_messages/);
  assert.match(source, /WHERE tenant_slug = \? AND thread_id = \?/);
  assert.match(source, /LINE_THREAD_ACCESS_DENIED/);
  assert.match(source, /allowedRoles: \['platform_admin', 'tenant_admin', 'sales', 'editor'\]/);
  assert.doesNotMatch(source, /finance/);
});

test('LINE monitor and settings pages use local CSS without Tailwind CDN', async () => {
  const monitor = await read('line-oa-monitor.html');
  const settings = await read('line-channel-settings.html');
  const css = await read('css/tenant-line-pages.css');
  assert.match(monitor, /css\/tenant-line-pages\.css/);
  assert.match(settings, /css\/tenant-line-pages\.css/);
  assert.match(css, /\.thread-card/);
  assert.doesNotMatch(monitor + settings, /cdn\.tailwindcss\.com|tailwindcss\.com/);
});
test('monitor page only uses tenant LINE and CRM clients', async () => {
  const page = await read('line-oa-monitor.html');
  const controller = await read('js/tenant-line-monitor-page.js');
  assert.match(page, /tenant-line-client\.js/);
  assert.match(page, /tenant-line-monitor-page\.js/);
  assert.match(controller, /listThreads/);
  assert.match(controller, /getThreadMessages/);
  assert.match(controller, /updateThread/);
  assert.match(controller, /sendThreadMessage/);
  assert.match(controller, /openSeq/);
  assert.match(controller, /state\.sending/);
  assert.match(controller, /activeThreadId/);
  assert.match(controller, /error\.payload\?\.data\?\.message/);
  assert.match(controller, /initLiffSession/);
  assert.doesNotMatch(page + controller, /\/api\/line-oa\//);
  assert.doesNotMatch(page + controller, /channel_secret|channel_access_token|secrets_ciphertext|secrets_iv/i);
  assert.doesNotMatch(controller, /alert\(/);
  assert.match(controller, /Unable to open thread/);
});

test('LINE settings page uses masked channel API and preserves local safety', async () => {
  const page = await read('line-channel-settings.html');
  const client = await read('js/tenant-line-client.js');
  assert.match(page, /getChannel/);
  assert.match(page, /saveChannel/);
  assert.match(page, /channel_secret_masked/);
  assert.match(page, /access_token_masked/);
  assert.match(client, /\/api\/v2\/line\/channel/);
  assert.match(client, /\/api\/v2\/line\/threads/);
  assert.doesNotMatch(page, /secrets_ciphertext|secrets_iv/);
});

test('worker routes LINE monitor before CRM and generic APIs', async () => {
  const source = await read('worker-tenant.js');
  const monitor = source.indexOf('isTenantLineMonitorApiRequest(request)');
  const crm = source.indexOf('isTenantCrmApiRequest(request)');
  const generic = source.indexOf('isTenantApiRequest(request)');
  assert.ok(monitor >= 0);
  assert.ok(crm > monitor);
  assert.ok(generic > crm);
  assert.match(source, /X-TravelKeeper-Tenant-Isolation', 'phase13'/);
});

test('secured tenant routes return JSON status errors instead of Worker 500s', async () => {
  const source = await read('worker-tenant.js');
  assert.match(source, /async function securedRoute\(request, env, router\)/);
  assert.match(source, /catch \(error\) \{\s*return errorResponse\(error\);\s*\}/s);
});
test('Phase 14 enables outbound LINE sending only through tenant V2 APIs', async () => {
  const monitor = await read('lib/tenant-line-monitor-api.js');
  const page = await read('line-oa-monitor.html');
  const client = await read('js/tenant-line-client.js');
  assert.match(monitor, /loadTenantLineSecrets\(env, ctx\.tenantSlug\)/);
  assert.match(monitor, /LINE_PUSH_API_URL/);
  assert.match(client, /\/api\/v2\/line\/threads\/\$\{encodeURIComponent\(threadId\)\}\/messages/);
  assert.match(page, /reply-text/);
  assert.match(page, /composer hidden/);
  assert.doesNotMatch(page + client, /\/api\/line-oa\//);
  assert.doesNotMatch(page + client, /channel_secret|channel_access_token|secrets_ciphertext|secrets_iv/i);
});

test('Phase 15B exposes SLA settings, priority, filters, and safe audits', async () => {
  const monitor = await read('lib/tenant-line-monitor-api.js');
  const webhook = await read('lib/tenant-line-webhook-api.js');
  const migration = await read('migrations/0113_tenant_line_sla.sql');
  assert.match(migration, /tenant_line_sla_settings/);
  assert.match(migration, /priority TEXT NOT NULL DEFAULT 'normal'/);
  assert.match(migration, /waiting_since TEXT NOT NULL DEFAULT ''/);
  assert.match(migration, /sla_due_at TEXT NOT NULL DEFAULT ''/);
  assert.match(migration, /response_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /sla_breached_at TEXT NOT NULL DEFAULT ''/);
  assert.match(monitor, /\/api\/v2\/tenant\/line-sla-settings/);
  assert.match(monitor, /tenant\.line\.sla_settings\.update/);
  assert.match(monitor, /tenant\.line\.thread\.priority_change/);
  assert.match(monitor, /sla_status/);
  assert.match(monitor, /breached_only/);
  assert.match(monitor, /waiting_only/);
  assert.match(monitor, /priorityFilter/);
  assert.match(monitor, /closeWaitingCycle\(thread/);
  assert.match(monitor, /response_count = response_count \+ 1/);
  assert.match(webhook, /startWaitingCycle/);
  assert.match(webhook, /tenant\.line\.sla\.waiting_start/);
});

test('Phase 15B monitor UI renders SLA filters, summary, and priority controls without credentials', async () => {
  const page = await read('line-oa-monitor.html');
  const controller = await read('js/tenant-line-monitor-page.js');
  const client = await read('js/tenant-line-client.js');
  assert.match(page, /sla-filter/);
  assert.match(page, /priority-filter/);
  assert.match(page, /waiting-only/);
  assert.match(page, /breached-only/);
  assert.match(page, /sla-summary/);
  assert.match(page, /id="priority"/);
  assert.match(controller, /slaLabel/);
  assert.match(controller, /durationText/);
  assert.match(controller, /updateThreadPriority/);
  assert.match(controller, /sla_status/);
  assert.match(client, /\/api\/v2\/tenant\/line-sla-settings/);
  assert.match(client, /\/priority/);
  assert.doesNotMatch(page + controller + client, /channel_secret|channel_access_token|secrets_ciphertext|secrets_iv|ciphertext/i);
});
