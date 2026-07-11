import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');

import {
  encryptTenantGatewaySecrets,
  decryptTenantGatewaySecrets,
} from '../lib/tenant-gateway-api.js';
import { statusForError } from '../lib/http-error-status.js';
import { isTenantLineWebhookRequest } from '../lib/tenant-line-webhook-api.js';
import { isTenantLineChannelApiRequest } from '../lib/tenant-line-channel-api.js';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

async function lineSignature(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64');
}

test('LINE channel secrets use tenant-bound AES-GCM and do not store plaintext', async () => {
  const env = {
    TENANT_PAYMENT_MASTER_KEY: 'phase12-local-master-key-longer-than-thirty-two-characters',
    TENANT_PAYMENT_KEY_VERSION: 'v1',
  };
  const secrets = { channel_secret: 'SECRET-PARTNER-A', channel_access_token: 'TOKEN-PARTNER-A' };
  const encrypted = await encryptTenantGatewaySecrets(env, 'partner-a', 'line', secrets);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.equal(encrypted.ciphertext.includes(secrets.channel_secret), false);
  assert.deepEqual(await decryptTenantGatewaySecrets(env, 'partner-a', 'line', {
    secrets_ciphertext: encrypted.ciphertext,
    secrets_iv: encrypted.iv,
    key_version: encrypted.keyVersion,
  }), secrets);
  await assert.rejects(() => decryptTenantGatewaySecrets(env, 'demo', 'line', {
    secrets_ciphertext: encrypted.ciphertext,
    secrets_iv: encrypted.iv,
    key_version: encrypted.keyVersion,
  }), /TENANT_GATEWAY_SECRET_DECRYPT_FAILED/);
});

test('LINE webhook uses HMAC SHA-256 base64 over the exact raw body', async () => {
  const body = JSON.stringify({ destination: 'UDEST', events: [{ type: 'message' }] });
  const signature = await lineSignature(body, 'channel-secret');
  assert.match(signature, /^[A-Za-z0-9+/]+=*$/);
  const source = await read('lib/tenant-line-webhook-api.js');
  assert.match(source, /HMAC/);
  assert.match(source, /SHA-256/);
  assert.match(source, /new TextEncoder\(\)\.encode\(rawBody\)/);
  assert.match(source, /x-line-signature/);
});

test('only tenant slug in webhook URL selects the tenant', () => {
  assert.equal(isTenantLineWebhookRequest(new Request('https://worker.example/api/v2/line/webhook/partner-a', { method: 'POST' })), true);
  assert.equal(isTenantLineWebhookRequest(new Request('https://worker.example/api/v2/line/webhook/partner-a?tenant=demo', { method: 'POST' })), true);
  assert.equal(isTenantLineWebhookRequest(new Request('https://worker.example/api/v2/line/webhook/../demo', { method: 'POST' })), false);
  assert.equal(isTenantLineWebhookRequest(new Request('https://worker.example/api/v2/line/webhook/partner-a', { method: 'GET' })), false);
});

test('LINE settings route is separate from the public webhook route', () => {
  assert.equal(isTenantLineChannelApiRequest(new Request('https://worker.example/api/v2/line/channel')), true);
  assert.equal(isTenantLineChannelApiRequest(new Request('https://worker.example/api/v2/line/webhook/partner-a', { method: 'POST' })), false);
});

test('webhook source implements tenant CRM profile, thread, message and idempotency', async () => {
  const source = await read('lib/tenant-line-webhook-api.js');
  assert.match(source, /tenant_crm_profiles/);
  assert.match(source, /tenant_crm_threads/);
  assert.match(source, /tenant_crm_messages/);
  assert.match(source, /webhook_event_id/);
  assert.match(source, /event_fingerprint/);
  assert.match(source, /deliveryContext\?\.isRedelivery/);
  assert.match(source, /WHERE tenant_slug = \? AND/);
  assert.doesNotMatch(source, /console\.log\([^)]*(channel_secret|channel_access_token)/i);
});

test('migration enforces message and webhook tenant uniqueness', async () => {
  const migration = await read('migrations/0110_tenant_line_channels.sql');
  assert.match(migration, /tenant_line_channels/);
  assert.match(migration, /tenant_crm_messages/);
  assert.match(migration, /tenant_line_webhook_logs/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_messages_event_id/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_tenant_crm_messages_fingerprint/);
  assert.match(migration, /TENANT_MISMATCH:crm_message_profile/);
  assert.match(migration, /TENANT_MISMATCH:crm_message_thread/);
});

test('LINE webhook and channel errors use precise HTTP status', () => {
  assert.equal(statusForError('LINE_WEBHOOK_SIGNATURE_INVALID'), 401);
  assert.equal(statusForError('TENANT_LINE_CHANNEL_NOT_CONFIGURED'), 404);
  assert.equal(statusForError('TENANT_LINE_CHANNEL_DISABLED'), 409);
  assert.equal(statusForError('TENANT_LINE_CHANNEL_ID_REQUIRED'), 400);
  assert.equal(statusForError('TENANT_LINE_CHANNEL_SECRET_REQUIRED'), 400);
});

test('worker evaluates public LINE webhook before authenticated tenant routes', async () => {
  const source = await read('worker-tenant.js');
  const webhook = source.indexOf('isTenantLineWebhookRequest(request)');
  const authRoute = source.indexOf('isTenantLineChannelApiRequest(request)');
  const legacy = source.indexOf('legacyWorker.fetch(request, env, ctx)');
  assert.ok(webhook >= 0);
  assert.ok(authRoute > webhook);
  assert.ok(legacy > authRoute);
  assert.match(source, /X-TravelKeeper-Tenant-Isolation', 'phase13'/);
});
