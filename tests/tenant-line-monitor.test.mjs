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

test('monitor page only uses tenant LINE and CRM clients', async () => {
  const page = await read('line-oa-monitor.html');
  const controller = await read('js/tenant-line-monitor-page.js');
  assert.match(page, /tenant-line-client\.js/);
  assert.match(page, /tenant-line-monitor-page\.js/);
  assert.match(controller, /listThreads/);
  assert.match(controller, /getThreadMessages/);
  assert.match(controller, /updateThread/);
  assert.match(controller, /initLiffSession/);
  assert.doesNotMatch(page + controller, /\/api\/line-oa\//);
  assert.doesNotMatch(page + controller, /channel_secret|channel_access_token|secrets_ciphertext|secrets_iv/i);
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
test('Phase 13 does not enable outbound LINE sending', async () => {
  const monitor = await read('lib/tenant-line-monitor-api.js');
  const page = await read('line-oa-monitor.html');
  assert.doesNotMatch(monitor, /api\.line\.me\/v2\/bot\/message\/push/);
  assert.match(page, /尚未開放直接推送 LINE 回覆/);
});
