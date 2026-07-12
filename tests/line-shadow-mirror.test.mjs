import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  SHADOW_PATH,
  SHADOW_TENANT_SLUG,
  SHADOW_URL,
  buildShadowRequest,
  createShadowEnvelope,
  mirrorVerifiedWebhookRequest,
  routeLineShadowEndpoint,
  safeShadowEvent,
  shadowConfig,
  signShadowPayload,
  verifyShadowPayload,
} from '../lib/line-shadow-mirror.js';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const SECRET = 'shadow-signing-secret-that-is-at-least-32-bytes-long';
const NOW = Date.parse('2026-07-12T08:00:00.000Z');
const env = {
  APP_ENV: 'staging',
  LINE_STAGING_SHADOW_ENABLED: '1',
  LINE_STAGING_SHADOW_URL: SHADOW_URL,
  LINE_STAGING_SHADOW_UIDS: 'U-TEST-001',
  LINE_STAGING_SHADOW_SIGNING_SECRET: SECRET,
  TENANT_LINE_QUEUE_ENABLED: '0',
  TENANT_LINE_SLA_ENABLED: '0',
  TENANT_LINE_OUTBOUND_ENABLED: '0',
};

function event(overrides = {}) {
  return {
    type: 'message',
    webhookEventId: 'W-EVENT-001',
    timestamp: NOW,
    source: { type: 'user', userId: 'U-TEST-001' },
    message: { type: 'text', id: 'M-001', text: 'shadow hello' },
    replyToken: 'must-not-be-mirrored',
    ...overrides,
  };
}

class ShadowDb {
  constructor() {
    this.profiles = [];
    this.threads = [];
    this.messages = [];
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const db = this;
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (normalized.includes('FROM tenant_line_sla_settings')) return null;
        if (normalized.includes('FROM tenant_crm_profiles')) {
          const found = db.profiles.find(row => row.tenant_slug === args[0] && row.line_user_uid === args[1]);
          return found || null;
        }
        if (normalized.includes('SELECT id FROM tenant_crm_messages')) return db.messages.find(row => row.tenant_slug === args[0] && (row.event_fingerprint === args[1] || (args[2] && row.webhook_event_id === args[3]))) || null;
        if (normalized.includes('FROM tenant_crm_threads')) return db.threads.find(row => row.tenant_slug === args[0] && row.line_user_uid === args[1]) || null;
        return null;
      },
      async run() {
        if (normalized.includes('INSERT INTO tenant_crm_profiles')) {
          const [id, tenant_slug, line_user_uid, display_name, picture_url] = args;
          const existing = db.profiles.find(row => row.tenant_slug === tenant_slug && row.line_user_uid === line_user_uid);
          if (!existing) db.profiles.push({ id, tenant_slug, line_user_uid, display_name, picture_url, customer_id: '' });
        } else if (normalized.includes('INSERT INTO tenant_crm_threads')) {
          const [id, tenant_slug, profile_id, customer_id, line_user_uid] = args;
          const existing = db.threads.find(row => row.tenant_slug === tenant_slug && row.line_user_uid === line_user_uid);
          if (!existing) db.threads.push({ id, tenant_slug, profile_id, customer_id, line_user_uid, status: 'open', queue_status: 'open', unread_count: 0, closed_at: '' });
        } else if (normalized.includes('INSERT INTO tenant_crm_messages')) {
          const [id, tenant_slug, profile_id, thread_id, webhook_event_id, event_fingerprint, event_type, message_type, content, metadata_json, reply_token_present] = args;
          db.messages.push({ id, tenant_slug, profile_id, thread_id, webhook_event_id, event_fingerprint, event_type, message_type, content, metadata_json, reply_token_present });
        } else if (normalized.includes('UPDATE tenant_crm_threads')) {
          const tenant_slug = args[args.length - 2];
          const id = args[args.length - 1];
          const row = db.threads.find(item => item.tenant_slug === tenant_slug && item.id === id);
          if (row) row.unread_count += 1;
        }
        return { success: true, changes: 1 };
      },
    };
  }
}

test('shadow config is disabled or fail-closed without exact URL, secret, and UID allowlist', () => {
  assert.equal(shadowConfig({}).ready, false);
  assert.equal(shadowConfig({ ...env, LINE_STAGING_SHADOW_UIDS: '*' }).ready, false);
  assert.equal(shadowConfig({ ...env, LINE_STAGING_SHADOW_URL: 'https://evil.example/shadow' }).ready, false);
  assert.equal(shadowConfig({ ...env, LINE_STAGING_SHADOW_SIGNING_SECRET: 'short' }).ready, false);
});

test('safe shadow envelope fixes tenant and removes replyToken and credentials', () => {
  const envelope = createShadowEnvelope(event(), new Date(NOW));
  const serialized = JSON.stringify(envelope);
  assert.equal(envelope.tenant_slug, SHADOW_TENANT_SLUG);
  assert.equal(envelope.event.source.userId, 'U-TEST-001');
  assert.equal('replyToken' in envelope.event, false);
  assert.doesNotMatch(serialized, /channel_secret|channel_access_token|Authorization|ciphertext|secrets_iv/i);
});

test('shadow HMAC accepts fresh payload and rejects invalid or replayed timestamp', async () => {
  const body = JSON.stringify(createShadowEnvelope(event(), new Date(NOW)));
  const timestamp = Math.floor(NOW / 1000);
  const signature = await signShadowPayload(body, timestamp, SECRET);
  assert.equal(await verifyShadowPayload(body, timestamp, signature, SECRET, NOW), true);
  assert.equal(await verifyShadowPayload(body, timestamp, `${signature}x`, SECRET, NOW), false);
  assert.equal(await verifyShadowPayload(body, timestamp, signature, SECRET, NOW + 301000), false);
});

test('production rejects shadow endpoint and staging rejects unsigned request', async () => {
  const request = new Request(`https://worker.example${SHADOW_PATH}`, { method: 'POST', body: '{}' });
  const production = await routeLineShadowEndpoint(request.clone(), { APP_ENV: 'production' }, NOW);
  assert.equal(production.status, 404);
  const staging = await routeLineShadowEndpoint(request, env, NOW);
  assert.equal(staging.status, 401);
});

test('allowlisted shadow event inserts once, duplicate is idempotent, and no reply token is stored', async () => {
  const db = new ShadowDb();
  const targetEnv = { ...env, DB: db };
  const first = await routeLineShadowEndpoint(await buildShadowRequest(event(), targetEnv, new Date(NOW)), targetEnv, NOW);
  const second = await routeLineShadowEndpoint(await buildShadowRequest(event(), targetEnv, new Date(NOW)), targetEnv, NOW);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.deepEqual(await first.json(), { success: true, tenant_slug: SHADOW_TENANT_SLUG, inserted: 1, duplicates: 0 });
  assert.deepEqual(await second.json(), { success: false, error: 'SHADOW_REPLAY', tenant_slug: SHADOW_TENANT_SLUG, inserted: 0, duplicates: 1 });
  assert.equal(db.profiles.length, 1);
  assert.equal(db.threads.length, 1);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].tenant_slug, SHADOW_TENANT_SLUG);
  assert.equal(db.messages[0].reply_token_present, 0);
});

test('malformed shadow JSON is rejected without D1 access', async () => {
  const timestamp = Math.floor(NOW / 1000);
  const rawBody = '{';
  const response = await routeLineShadowEndpoint(new Request('https://worker.example' + SHADOW_PATH, {
    method: 'POST',
    headers: {
      'X-TravelKeeper-Shadow-Timestamp': String(timestamp),
      'X-TravelKeeper-Shadow-Signature': await signShadowPayload(rawBody, timestamp, SECRET),
    },
    body: rawBody,
  }), { ...env, DB: new ShadowDb() }, NOW);
  assert.equal(response.status, 400);
});

test('non-allowlisted shadow UID is rejected before D1 insert', async () => {
  const db = new ShadowDb();
  const targetEnv = { ...env, DB: db, LINE_STAGING_SHADOW_UIDS: 'U-OTHER' };
  const response = await routeLineShadowEndpoint(await buildShadowRequest(event(), targetEnv, new Date(NOW)), targetEnv, NOW);
  assert.equal(response.status, 403);
  assert.equal(db.messages.length, 0);
});

test('production mirror skips non-allowlisted events before fetch', async () => {
  const request = new Request('https://production.example/api/v2/line/webhook/demo', {
    method: 'POST',
    body: JSON.stringify({ events: [event({ source: { type: 'user', userId: 'U-NOT-ALLOWED' } })] }),
  });
  let calls = 0;
  const result = await mirrorVerifiedWebhookRequest(request, env, async () => { calls += 1; return new Response(null, { status: 200 }); }, NOW);
  assert.deepEqual(result, { mirrored: 0, failed: 0 });
  assert.equal(calls, 0);
});

test('staging timeout is isolated from the production webhook response path', async () => {
  const request = new Request('https://production.example/api/v2/line/webhook/demo', {
    method: 'POST',
    body: JSON.stringify({ events: [event()] }),
  });
  const result = await mirrorVerifiedWebhookRequest(request, env, async () => { throw new Error('timeout'); }, NOW);
  assert.deepEqual(result, { mirrored: 0, failed: 1 });
});

test('worker schedules mirror only after successful production webhook response', async () => {
  const source = await read('worker-tenant.js');
  assert.match(source, /isLineShadowEndpointRequest/);
  assert.match(source, /ctx\.waitUntil\(mirrorVerifiedWebhookRequest/);
  assert.ok(source.indexOf('response?.ok') < source.indexOf('ctx.waitUntil(mirrorVerifiedWebhookRequest'));
  assert.match(source, /line-shadow-mirror\.js/);
});

test('legacy production /line-webhook mirrors only after signature verification', async () => {
  const source = await read('worker.js');
  assert.match(source, /mirrorVerifiedWebhookPayload/);
  assert.ok(source.indexOf('const valid = await verifyLineSignature') < source.indexOf('mirrorVerifiedWebhookPayload(payload, env)'));
});

test('shadow endpoint remains monitor-only by configuration', async () => {
  const wrangler = await read('wrangler.toml');
  assert.match(wrangler, /TENANT_LINE_QUEUE_ENABLED\s*=\s*"0"/);
  assert.match(wrangler, /TENANT_LINE_SLA_ENABLED\s*=\s*"0"/);
  assert.match(wrangler, /TENANT_LINE_OUTBOUND_ENABLED\s*=\s*"0"/);
  assert.doesNotMatch(wrangler, /LINE_STAGING_SHADOW_ENABLED\s*=\s*"1"/);
});