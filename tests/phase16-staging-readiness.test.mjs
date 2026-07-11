import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const requiredDocSections = [
  '## 1. Overview',
  '## 2. Staging Resources',
  '## 3. Required Secrets',
  '## 4. Migration Dry Run',
  '## 5. D1 Backup',
  '## 6. Worker Staging Deployment Command',
  '## 7. LINE Test OA Webhook Setup',
  '## 8. Smoke Test',
  '## 9. Negative Tests',
  '## 10. Rollback',
  '## 11. Evidence Collection',
  '## 12. Go/No-Go Criteria',
];

test('Phase 16 exposes a local-only staging migration readiness command', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts['staging:migration-check'], 'node scripts/staging-migration-check.mjs');
  const script = await read('scripts/staging-migration-check.mjs');
  assert.match(script, /remote_d1_touched: false/);
  assert.match(script, /production_secrets_read: false/);
  assert.match(script, /'--local'/);
  assert.match(script, /tenant_line_sla_settings/);
  assert.match(script, /tenant_crm_threads/);
  assert.match(script, /foreign_key_check/);
  assert.match(script, /NO-GO/);
  assert.match(script, /Remote D1 access is blocked/);
  assert.doesNotMatch(script, /migrations\s+apply/i);
  assert.doesNotMatch(script, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});

test('Phase 16 readiness doc covers staging, secrets, LINE test OA, rollback, and evidence', async () => {
  const doc = await read('docs/phase16-staging-readiness.md');
  for (const section of requiredDocSections) assert.match(doc, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(doc, /distinct staging D1 database/i);
  assert.match(doc, /presence only/i);
  assert.match(doc, /LINE test OA/i);
  assert.match(doc, /Invalid signature returns 401/i);
  assert.match(doc, /TENANT_LINE_MONITOR_ENABLED=0/);
  assert.match(doc, /TENANT_LINE_OUTBOUND_ENABLED=0/);
  assert.match(doc, /TENANT_LINE_QUEUE_ENABLED=0/);
  assert.match(doc, /TENANT_LINE_SLA_ENABLED=0/);
  assert.match(doc, /Current result.*NO-GO/is);
  assert.doesNotMatch(doc, /channel_access_token\s*[:=]\s*['"][^'"]+/i);
  assert.doesNotMatch(doc, /Authorization:\s*Bearer\s+\S+/i);
});

test('Phase 16 feature flags are wired into LINE monitor, outbound, queue, and SLA code paths', async () => {
  const monitor = await read('lib/tenant-line-monitor-api.js');
  const webhook = await read('lib/tenant-line-webhook-api.js');
  assert.match(monitor, /TENANT_LINE_MONITOR_ENABLED/);
  assert.match(monitor, /TENANT_LINE_OUTBOUND_ENABLED/);
  assert.match(monitor, /TENANT_LINE_QUEUE_ENABLED/);
  assert.match(monitor, /TENANT_LINE_SLA_ENABLED/);
  assert.match(webhook, /TENANT_LINE_SLA_ENABLED/);
  assert.match(webhook, /startWaitingCycle\(thread, settings\)/);
  assert.doesNotMatch(webhook, /if \(slaStart\)[\s\S]*?const slaStart/);
});

test('Phase 16 wrangler config assessment documents missing staging env instead of reusing production', async () => {
  const wrangler = await read('wrangler.toml');
  const doc = await read('docs/phase16-staging-readiness.md');
  assert.doesNotMatch(wrangler, /\[env\.staging\]/);
  assert.match(doc, /NO-GO.*staging environment resources and secrets are not configured/is);
});
