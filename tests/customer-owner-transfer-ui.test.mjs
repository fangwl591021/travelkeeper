import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const clientUrl = new URL('../js/tenant-crm-client.js', import.meta.url);

test('CRM client exposes explicit owner transfer API and tenant distributor lookup', async () => {
  const source = await readFile(clientUrl, 'utf8');
  assert.match(source, /apiCall\('\/api\/v2\/distributors'\)/);
  assert.match(source, /\/api\/v2\/customers\/\$\{encodeURIComponent\(customerId\)\}\/owner-transfer/);
  assert.match(source, /body:\s*\{ owner_uid: ownerUid \}/);
});

test('CRM client exposes sanitized owner transfer history endpoint as read-only', async () => {
  const source = await readFile(clientUrl, 'utf8');
  assert.match(source, /ownerTransferHistory\(customerId\)/);
  assert.match(source, /\/owner-transfer-history/);
  assert.doesNotMatch(source, /before_json|after_json/);
});

test('owner transfer controls are admin-only and referrer remains read-only in UI', async () => {
  const source = await readFile(clientUrl, 'utf8');
  assert.match(source, /new Set\(\['platform_admin', 'tenant_admin'\]\)/);
  assert.match(source, /const canTransfer = adminRoles\.has\(role\)/);
  assert.match(source, /原始介紹人 · 永久鎖定/);
  assert.match(source, /目前服務負責人/);
  assert.doesNotMatch(source, /ref_uid:\s*refUidOf\(customer\)/);
  assert.doesNotMatch(source, /body:\s*\{[^}]*ref_uid/s);
});

test('owner transfer UI tells operator that first-touch and historical orders do not change', async () => {
  const source = await readFile(clientUrl, 'utf8');
  assert.match(source, /原始介紹人與歷史訂單歸屬保持不變/);
  assert.match(source, /原始介紹人 .* 不會改變，歷史訂單歸屬也不會改變/);
  assert.match(source, /服務負責人已完成移交。原始介紹人與歷史訂單未變更/);
});

test('owner transfer candidate list excludes the current owner and only presents active distributors', async () => {
  const source = await readFile(clientUrl, 'utf8');
  assert.match(source, /uid !== currentOwner/);
  assert.match(source, /\['approved', 'active'\]\.includes/);
  assert.match(source, /請選擇新的服務負責人/);
});

test('owner transfer history UI shows only sanitized audit fields', async () => {
  const source = await readFile(clientUrl, 'utf8');
  assert.match(source, /查看交接紀錄/);
  assert.match(source, /item\.created_at/);
  assert.match(source, /item\.actor_uid/);
  assert.match(source, /\$\{prefix\}_owner_name/);
  assert.match(source, /\$\{prefix\}_owner_uid/);
  assert.match(source, /historyOwnerLabel\(item, 'from'\)/);
  assert.match(source, /historyOwnerLabel\(item, 'to'\)/);
  assert.match(source, /item\.request_id/);
  assert.doesNotMatch(source, /phone|line_user_uid|email/);
});

test('owner transfer UI enhancement is bounded to the existing CRM detail panel', async () => {
  const source = await readFile(clientUrl, 'utf8');
  assert.match(source, /document\.getElementById\('detail'\)/);
  assert.match(source, /id="attribution-panel"/);
  assert.match(source, /MutationObserver/);
  assert.doesNotMatch(source, /document\.body\.innerHTML\s*=/);
});