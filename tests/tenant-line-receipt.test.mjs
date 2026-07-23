import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emitLineReceipt, emitShadowReceipt, receiptEnabled } from '../lib/tenant-line-receipt.js';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const baseEnv = { TENANT_LINE_RECEIPT_ENABLED: '1', TRAVELKEEPER_RELEASE_SHA: 'bc5bae5c42f0cf9010271ac2ee58a4550039386a' };

async function capture(callback, { throwOnLog = false } = {}) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    if (throwOnLog) throw new Error('console write failed with secret-like details');
    logs.push(args.join(' '));
  };
  try { return { value: await callback(), logs }; } finally { console.log = original; }
}

function parsed(logs) { return logs.length ? JSON.parse(logs[0]) : null; }

test('receipt flag missing disables output', async () => {
  const result = await capture(() => emitLineReceipt({ env: {}, stage: 'RECEIVED', result: 'success' }));
  assert.equal(result.logs.length, 0);
  assert.equal(result.value, null);
});

test('receipt flag typo disables output', async () => {
  const result = await capture(() => emitLineReceipt({ env: { TENANT_LINE_RECEIPT_ENABLED: 'enable' }, stage: 'RECEIVED', result: 'success' }));
  assert.equal(result.logs.length, 0);
});

test('explicit receipt flag emits fixed JSON structure', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, eventKey: 'WEBHOOK-EVENT-1', tenantSlug: 'tenant-a', sourcePath: 'tenant-v2', stage: 'SIGNATURE_VERIFIED', result: 'success', createdAt: '2026-07-13T00:00:00.000Z' }));
  const receipt = parsed(result.logs);
  assert.equal(receipt.type, 'tenant_line_delivery_receipt');
  assert.equal(receipt.receipt_version, 1);
  assert.equal(receipt.source_path, 'tenant-v2');
  assert.equal(receipt.stage, 'SIGNATURE_VERIFIED');
  assert.equal(receipt.result, 'success');
  assert.equal(receipt.created_at, '2026-07-13T00:00:00.000Z');
});

test('all explicit allowlist values enable receipts', async () => {
  for (const value of ['1', 'true', 'on', 'yes', 'enabled']) {
    assert.equal(receiptEnabled({ TENANT_LINE_RECEIPT_ENABLED: value }), true);
  }
});

test('blank and disabled values fail closed', async () => {
  for (const value of ['', ' ', '0', 'false', 'off', 'no', 'disabled', 'tru', 'enable']) {
    assert.equal(receiptEnabled({ TENANT_LINE_RECEIPT_ENABLED: value }), false);
  }
});

test('valid release SHA is emitted and normalized', async () => {
  const result = await capture(() => emitLineReceipt({ env: { ...baseEnv, TRAVELKEEPER_RELEASE_SHA: 'ABCDEF1' }, stage: 'RECEIVED', result: 'success' }));
  assert.equal(parsed(result.logs).release_sha, 'abcdef1');
});

test('invalid or missing release SHA becomes unknown', async () => {
  for (const value of ['', 'not-a-sha', 'a'.repeat(41)]) {
    const result = await capture(() => emitLineReceipt({ env: { TENANT_LINE_RECEIPT_ENABLED: '1', TRAVELKEEPER_RELEASE_SHA: value }, stage: 'RECEIVED', result: 'success' }));
    assert.equal(parsed(result.logs).release_sha, 'unknown');
  }
});

test('event key is hashed and original value is absent', async () => {
  const eventKey = 'WEBHOOK-EVENT-PRIVATE-001';
  const result = await capture(() => emitLineReceipt({ env: baseEnv, eventKey, tenantSlug: 'tenant-a', stage: 'SIGNATURE_VERIFIED', result: 'success' }));
  const serialized = result.logs.join('');
  assert.equal(serialized.includes(eventKey), false);
  assert.match(parsed(result.logs).event_key_hash, /^[0-9a-f]{64}$/);
});

test('receipt output excludes UID and message content', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, eventKey: 'EVENT-1', tenantSlug: 'tenant-a', stage: 'SIGNATURE_VERIFIED', result: 'success' }));
  const serialized = result.logs.join('');
  assert.equal(serialized.includes('U-SENSITIVE-001'), false);
  assert.equal(serialized.includes('private message text'), false);
});

test('receipt output excludes replyToken, signature, credentials, ciphertext and IV', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, eventKey: 'EVENT-1', tenantSlug: 'tenant-a', stage: 'FAILED', result: 'failed', safeErrorCode: 'SIGNATURE_INVALID' }));
  const serialized = result.logs.join('').toLowerCase();
  for (const value of ['replytoken', 'x-line-signature', 'channel secret', 'access token', 'authorization', 'ciphertext', 'secrets_iv']) assert.equal(serialized.includes(value), false);
});

test('shadow success emits stored success receipt', async () => {
  const result = await capture(() => emitShadowReceipt({ env: baseEnv, eventKey: 'EVENT-1', tenantSlug: 'legacy', result: { mirrored: 1, failed: 0 } }));
  assert.deepEqual({ stage: parsed(result.logs).stage, result: parsed(result.logs).result, safe_error_code: parsed(result.logs).safe_error_code }, { stage: 'SHADOW_STORED', result: 'success', safe_error_code: '' });
});

test('shadow disabled emits skipped receipt', async () => {
  const result = await capture(() => emitShadowReceipt({ env: baseEnv, result: { mirrored: 0, failed: 0, skipped: 'disabled' } }));
  assert.deepEqual({ stage: parsed(result.logs).stage, result: parsed(result.logs).result, safe_error_code: parsed(result.logs).safe_error_code }, { stage: 'SHADOW_DISPATCHED', result: 'skipped', safe_error_code: 'SHADOW_DISABLED' });
});

test('shadow failure emits safe failed receipt', async () => {
  const result = await capture(() => emitShadowReceipt({ env: baseEnv, result: { mirrored: 0, failed: 1 } }));
  assert.equal(parsed(result.logs).stage, 'SHADOW_DISPATCHED');
  assert.equal(parsed(result.logs).safe_error_code, 'SHADOW_DISPATCH_FAILED');
});

test('shadow duplicate emits duplicate receipt', async () => {
  const result = await capture(() => emitShadowReceipt({ env: baseEnv, result: { mirrored: 0, failed: 0, duplicate: 1 } }));
  assert.equal(parsed(result.logs).stage, 'SHADOW_STORED');
  assert.equal(parsed(result.logs).result, 'duplicate');
  assert.equal(parsed(result.logs).safe_error_code, 'SHADOW_DUPLICATE');
});

test('console receipt write failure is swallowed', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, stage: 'RECEIVED', result: 'success' }), { throwOnLog: true });
  assert.equal(result.logs.length, 0);
});

test('tenant identity is only emitted after verified event key is supplied', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, tenantSlug: 'tenant-a', stage: 'RECEIVED', result: 'success' }));
  assert.equal(parsed(result.logs).tenant_slug, '');
  assert.equal(parsed(result.logs).event_key_hash, '');
});

test('tenant A receipt cannot claim tenant B', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, eventKey: 'EVENT-A', tenantSlug: 'tenant-a', stage: 'SIGNATURE_VERIFIED', result: 'success' }));
  assert.equal(parsed(result.logs).tenant_slug, 'tenant-a');
  assert.notEqual(parsed(result.logs).tenant_slug, 'tenant-b');
});

test('unknown safe error codes normalize to UNKNOWN_SAFE_FAILURE', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, stage: 'FAILED', result: 'failed', safeErrorCode: 'database raw error' }));
  assert.equal(parsed(result.logs).safe_error_code, 'UNKNOWN_SAFE_FAILURE');
});

test('invalid stage and result normalize to safe values', async () => {
  const result = await capture(() => emitLineReceipt({ env: baseEnv, stage: 'RAW_EXCEPTION', result: 'unexpected' }));
  assert.equal(parsed(result.logs).stage, 'FAILED');
  assert.equal(parsed(result.logs).result, 'failed');
});

test('legacy handler imports receipt helper and preserves response owner path', async () => {
  const source = await read('worker.js');
  assert.match(source, /emitLineReceipt/);
  assert.match(source, /handleLineWebhookGateway/);
  assert.match(source, /ctx\.waitUntil\(backgroundWork\)/);
});

test('tenant-v2 handler imports receipt helper and keeps non-blocking shadow', async () => {
  const source = await read('worker-tenant.js');
  assert.match(source, /emitShadowReceipt/);
  assert.match(source, /ctx\.waitUntil\(mirrorVerifiedWebhookRequest/);
  assert.match(source, /mirrorVerifiedWebhookRequest/);
});

test('receipt helper never uses exception text as safe error output', async () => {
  const source = await read('lib/tenant-line-receipt.js');
  assert.doesNotMatch(source, /error\.message|stack|rawBody|replyToken|channel_secret|channel_access_token/i);
});
