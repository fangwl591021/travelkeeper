import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { encryptTenantGatewaySecrets } from '../lib/tenant-gateway-api.js';
import { routeTenantLineMonitorApi } from '../lib/tenant-line-monitor-api.js';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

async function encryptedLineChannel(tenantSlug, token) {
  const env = {
    TENANT_PAYMENT_MASTER_KEY: 'phase14-local-master-key-longer-than-thirty-two-characters',
    TENANT_PAYMENT_KEY_VERSION: 'v1',
  };
  const encrypted = await encryptTenantGatewaySecrets(env, tenantSlug, 'line', {
    channel_secret: `${tenantSlug}-secret`,
    channel_access_token: token,
  });
  return {
    tenant_slug: tenantSlug,
    enabled: 1,
    secrets_ciphertext: encrypted.ciphertext,
    secrets_iv: encrypted.iv,
    key_version: encrypted.keyVersion,
  };
}

class FakeD1 {
  constructor(channel) {
    this.tenants = new Set(['partner-a', 'demo']);
    this.memberships = [
      { tenant_slug: 'partner-a', user_uid: 'U-ADMIN', role: 'tenant_admin', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'partner-a', user_uid: 'U-SALES', role: 'sales', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'partner-a', user_uid: 'U-EDITOR', role: 'editor', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'partner-a', user_uid: 'U-FIN', role: 'finance', status: 'active', permissions_json: '[]' },
    ];
    this.channel = channel;
    this.profile = { id: 'P1', tenant_slug: 'partner-a', owner_uid: 'U-SALES', display_name: 'Sales Owner', phone: '', picture_url: '' };
    this.thread = { id: 'T1', tenant_slug: 'partner-a', profile_id: 'P1', customer_id: '', line_user_uid: 'U-LINE-RECIPIENT', status: 'open', risk: 'low', summary: '', note: '', tags_json: '[]', last_message_at: '', last_inbound_at: '', last_outbound_at: '', updated_at: '2026-01-01T00:00:00Z' };
    this.messages = [];
    this.auditLogs = [];
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        first: async () => this.first(sql, args),
        all: async () => ({ results: this.all(sql, args) }),
        run: async () => this.run(sql, args),
      }),
    };
  }

  first(sql, args) {
    if (sql.includes('SELECT slug FROM tenants')) return this.tenants.has(args[0]) ? { slug: args[0] } : null;
    if (sql.includes('FROM tenant_memberships') && sql.includes("role = 'platform_admin'")) return null;
    if (sql.includes('FROM tenant_memberships') && sql.includes('tenant_slug = ?')) {
      return this.memberships.find(row => row.tenant_slug === args[0] && row.user_uid === args[1]) || null;
    }
    if (sql.includes("role = 'platform_admin'")) return null;
    if (sql.includes('FROM tenant_line_channels')) return this.channel?.tenant_slug === args[0] ? this.channel : null;
    if (sql.includes('FROM tenant_crm_threads t')) {
      if (args[0] !== this.thread.tenant_slug || args[1] !== this.thread.id) return null;
      return { ...this.thread, ...this.profile };
    }
    if (sql.includes('client_request_id = ?')) {
      return this.messages.find(row => row.client_request_id === args[2]) || null;
    }
    if (sql.includes('SELECT * FROM tenant_crm_messages WHERE tenant_slug = ? AND id = ?')) {
      return this.messages.find(row => row.tenant_slug === args[0] && row.id === args[1]) || null;
    }
    return null;
  }

  all(sql, args) {
    if (sql.includes('FROM tenant_crm_messages')) {
      return this.messages.filter(row => row.tenant_slug === args[0] && row.thread_id === args[1]);
    }
    return [];
  }

  run(sql, args) {
    if (sql.includes('INSERT INTO tenant_crm_messages')) {
      this.messages.push({
        id: args[0],
        tenant_slug: args[1],
        profile_id: args[2],
        thread_id: args[3],
        event_fingerprint: args[4],
        direction: 'outbound',
        event_type: 'message',
        message_type: 'text',
        content: args[5],
        text_content: args[6],
        metadata_json: '{}',
        event_timestamp: args[7],
        processed_at: args[8],
        created_at: args[9],
        send_status: 'pending',
        sent_by_uid: args[10],
        sent_by_role: args[11],
        client_request_id: args[12],
        line_message_id: '',
        error_code: '',
        error_message_safe: '',
        sent_at: '',
        retryable: 0,
      });
    }
    if (sql.includes('UPDATE tenant_crm_messages')) {
      const row = this.messages.find(item => item.tenant_slug === args[6] && item.id === args[7]);
      Object.assign(row, {
        send_status: args[0],
        line_message_id: args[1],
        error_code: args[2],
        error_message_safe: args[3],
        retryable: args[4],
        sent_at: args[5] === 'sent' ? 'sent-now' : '',
      });
    }
    if (sql.includes('UPDATE tenant_crm_threads')) this.thread.last_outbound_at = 'sent-now';
    if (sql.includes('INSERT INTO audit_logs')) this.auditLogs.push({ tenant_slug: args[1], actor_uid: args[2], action: args[3], target_id: args[4], after_json: args[5] });
    return { success: true };
  }
}

function request(uid, body, tenant = 'partner-a', threadId = 'T1') {
  return new Request(`https://worker.example/api/v2/line/threads/${threadId}/messages?tenant=${tenant}`, {
    method: 'POST',
    headers: { 'X-User-Uid': uid, 'X-Tenant-Slug': tenant, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('outbound message API uses tenant token, records sent message, and is idempotent', async () => {
  const channel = await encryptedLineChannel('partner-a', 'TOKEN-PARTNER-A');
  const db = new FakeD1(channel);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ sentMessages: [{ id: 'LINE-MSG-1' }] }), { status: 200 });
  };
  try {
    const env = { DB: db, ...channel, TENANT_PAYMENT_MASTER_KEY: 'phase14-local-master-key-longer-than-thirty-two-characters', TENANT_PAYMENT_KEY_VERSION: 'v1', LINE_PUSH_API_URL: 'https://line-mock.local/push' };
    const first = await routeTenantLineMonitorApi(request('U-SALES', { type: 'text', text: ' hello ', client_request_id: 'REQ-1' }), env);
    assert.equal(first.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://line-mock.local/push');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer TOKEN-PARTNER-A');
    assert.deepEqual(calls[0].body, { to: 'U-LINE-RECIPIENT', messages: [{ type: 'text', text: 'hello' }] });
    assert.equal(db.messages[0].send_status, 'sent');
    assert.equal(db.messages[0].reply_token_present, undefined);
    assert.equal(db.auditLogs.length, 1);
    const payloadText = await first.text();
    assert.equal(payloadText.includes('TOKEN-PARTNER-A'), false);

    const duplicate = await routeTenantLineMonitorApi(request('U-SALES', { type: 'text', text: 'hello', client_request_id: 'REQ-1' }), env);
    assert.equal(duplicate.status, 200);
    assert.equal(calls.length, 1);
    assert.equal((await duplicate.json()).duplicate, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('outbound message API enforces roles, owner scope and tenant thread scope', async () => {
  const channel = await encryptedLineChannel('partner-a', 'TOKEN-PARTNER-A');
  const env = { DB: new FakeD1(channel), TENANT_PAYMENT_MASTER_KEY: 'phase14-local-master-key-longer-than-thirty-two-characters', TENANT_PAYMENT_KEY_VERSION: 'v1', LINE_PUSH_API_URL: 'https://line-mock.local/push' };
  assert.equal((await routeTenantLineMonitorApi(request('U-FIN', { type: 'text', text: 'x', client_request_id: 'REQ-FIN' }), env)).status, 403);
  assert.equal((await routeTenantLineMonitorApi(request('U-EDITOR', { type: 'text', text: 'x', client_request_id: 'REQ-EDITOR' }), env)).status, 403);
  assert.equal((await routeTenantLineMonitorApi(request('U-SALES', { type: 'text', text: 'x', client_request_id: 'REQ-MISSING' }, 'partner-a', 'T-DEMO'), env)).status, 404);
});

test('LINE API failure keeps safe failed outbound record without credential leakage', async () => {
  const channel = await encryptedLineChannel('partner-a', 'TOKEN-PARTNER-A');
  const db = new FakeD1(channel);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'do not persist' }), { status: 429 });
  try {
    const env = { DB: db, TENANT_PAYMENT_MASTER_KEY: 'phase14-local-master-key-longer-than-thirty-two-characters', TENANT_PAYMENT_KEY_VERSION: 'v1', LINE_PUSH_API_URL: 'https://line-mock.local/push' };
    const response = await routeTenantLineMonitorApi(request('U-SALES', { type: 'text', text: '<script>alert(1)</script>', client_request_id: 'REQ-429' }), env);
    assert.equal(response.status, 502);
    assert.equal(db.messages[0].send_status, 'failed');
    assert.equal(db.messages[0].error_code, 'LINE_PUSH_HTTP_429');
    assert.equal(db.messages[0].retryable, 1);
    const serialized = JSON.stringify(db.messages[0]) + await response.text();
    assert.equal(serialized.includes('TOKEN-PARTNER-A'), false);
    assert.equal(serialized.includes('Authorization'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Phase 14 source keeps outbound sending tenant scoped and does not store LINE credentials', async () => {
  const api = await read('lib/tenant-line-monitor-api.js');
  const migration = await read('migrations/0111_tenant_line_outbound_messages.sql');
  const page = await read('line-oa-monitor.html');
  assert.match(api, /POST' && messages/);
  assert.match(api, /loadTenantLineSecrets\(env, ctx\.tenantSlug\)/);
  assert.match(api, /client_request_id/);
  assert.match(api, /INSERT INTO audit_logs/);
  assert.match(migration, /idx_tenant_crm_messages_client_request/);
  assert.match(migration, /send_status/);
  assert.match(page, /reply-text/);
  assert.doesNotMatch(api, new RegExp('console\\\\.(log|error|warn).*?(token|secret|Authorization|ciphertext|iv)', 'i'));
  assert.doesNotMatch(page, /replyToken|Reply Token|channel_secret|channel_access_token|secrets_ciphertext|secrets_iv/i);
});
