import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { routeTenantLineMonitorApi } from '../lib/tenant-line-monitor-api.js';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

class QueueD1 {
  constructor() {
    this.tenants = new Set(['partner-a', 'demo']);
    this.memberships = [
      { tenant_slug: 'partner-a', user_uid: 'U-ADMIN', role: 'tenant_admin', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'partner-a', user_uid: 'U-SALES', role: 'sales', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'partner-a', user_uid: 'U-EDITOR', role: 'editor', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'partner-a', user_uid: 'U-FIN', role: 'finance', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'partner-a', user_uid: 'U-MEMBER', role: 'member', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'demo', user_uid: 'U-DEMO-SALES', role: 'sales', status: 'active', permissions_json: '[]' },
    ];
    this.profiles = [
      { id: 'P-SALES', tenant_slug: 'partner-a', owner_uid: 'U-SALES', display_name: 'Sales Customer', phone: '0900', picture_url: '' },
      { id: 'P-EDITOR', tenant_slug: 'partner-a', owner_uid: 'U-EDITOR', display_name: 'Editor Customer', phone: '0901', picture_url: '' },
      { id: 'P-DEMO', tenant_slug: 'demo', owner_uid: 'U-DEMO-SALES', display_name: 'Demo Customer', phone: '', picture_url: '' },
    ];
    this.threads = [
      { id: 'T-SALES', tenant_slug: 'partner-a', profile_id: 'P-SALES', customer_id: '', line_user_uid: 'U-LINE-SALES', status: 'open', queue_status: 'unassigned', assigned_to_uid: '', assigned_by_uid: '', assigned_at: '', unread_count: 2, risk: 'low', summary: '', note: '', tags_json: '[]', last_message_at: '2026-01-02', last_inbound_at: '2026-01-02', last_outbound_at: '', first_response_at: '', closed_at: '', updated_at: '2026-01-02' },
      { id: 'T-EDITOR', tenant_slug: 'partner-a', profile_id: 'P-EDITOR', customer_id: '', line_user_uid: 'U-LINE-EDITOR', status: 'open', queue_status: 'open', assigned_to_uid: 'U-EDITOR', assigned_by_uid: 'U-ADMIN', assigned_at: '2026-01-01', unread_count: 0, risk: 'medium', summary: '', note: '', tags_json: '[]', last_message_at: '2026-01-01', last_inbound_at: '', last_outbound_at: '', first_response_at: '', closed_at: '', updated_at: '2026-01-01' },
      { id: 'T-DEMO', tenant_slug: 'demo', profile_id: 'P-DEMO', customer_id: '', line_user_uid: 'U-LINE-DEMO', status: 'open', queue_status: 'unassigned', assigned_to_uid: '', assigned_by_uid: '', assigned_at: '', unread_count: 5, risk: 'low', summary: '', note: '', tags_json: '[]', last_message_at: '2026-01-03', last_inbound_at: '', last_outbound_at: '', first_response_at: '', closed_at: '', updated_at: '2026-01-03' },
    ];
    this.messages = [
      { id: 'M1', tenant_slug: 'partner-a', profile_id: 'P-SALES', thread_id: 'T-SALES', direction: 'inbound', event_type: 'message', message_type: 'text', content: 'hello', metadata_json: '{}', event_timestamp: 1, redelivery: 0, created_at: '2026-01-02' },
    ];
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

  threadRow(thread) {
    const profile = this.profiles.find(row => row.tenant_slug === thread.tenant_slug && row.id === thread.profile_id) || {};
    const assignee = this.memberships.find(row => row.tenant_slug === thread.tenant_slug && row.user_uid === thread.assigned_to_uid && row.status === 'active');
    return { ...thread, ...profile, assigned_role: assignee?.role || '', last_message: 'hello', message_count: this.messages.filter(row => row.tenant_slug === thread.tenant_slug && row.thread_id === thread.id).length };
  }

  first(sql, args) {
    if (sql.includes('SELECT slug FROM tenants')) return this.tenants.has(args[0]) ? { slug: args[0] } : null;
    if (sql.includes("role = 'platform_admin'")) return null;
    if (sql.includes('FROM tenant_memberships')) return this.memberships.find(row => row.tenant_slug === args[0] && row.user_uid === args[1] && row.status === 'active') || null;
    if (sql.includes('FROM tenant_crm_threads t')) {
      const thread = this.threads.find(row => row.tenant_slug === args[0] && row.id === args[1]);
      return thread ? this.threadRow(thread) : null;
    }
    return null;
  }

  all(sql, args) {
    if (sql.includes('FROM tenant_crm_threads t')) {
      let rows = this.threads.filter(row => row.tenant_slug === args[0]);
      if (sql.includes('t.unread_count > 0')) rows = rows.filter(row => row.unread_count > 0);
      if (sql.includes("COALESCE(t.assigned_to_uid, '') = ''")) rows = rows.filter(row => !row.assigned_to_uid);
      if (sql.includes('t.assigned_to_uid = ?')) {
        const assignee = args.find(arg => typeof arg === 'string' && arg.startsWith('U-') && arg !== args[0]);
        rows = rows.filter(row => row.assigned_to_uid === assignee);
      }
      if (sql.includes('t.queue_status = ?')) {
        const status = args.find(arg => ['unassigned', 'open', 'pending', 'closed'].includes(arg));
        rows = rows.filter(row => row.queue_status === status);
      }
      return rows.map(row => this.threadRow(row));
    }
    if (sql.includes('FROM tenant_crm_messages')) return this.messages.filter(row => row.tenant_slug === args[0] && row.thread_id === args[1]);
    return [];
  }
  run(sql, args) {
    if (sql.includes('INSERT INTO audit_logs')) {
      this.auditLogs.push({ tenant_slug: args[1], actor_uid: args[2], action: args[3], target_id: args[4], before_json: args[5], after_json: args[6] });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('SET assigned_to_uid = ?') && sql.includes('assigned_at = CASE')) {
      const thread = this.threads.find(row => row.tenant_slug === args[5] && row.id === args[6]);
      thread.assigned_to_uid = args[0];
      thread.assigned_by_uid = args[1];
      thread.assigned_at = args[2] ? 'now' : '';
      if (thread.queue_status !== 'closed') thread.queue_status = args[3];
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET assigned_to_uid = ?") && sql.includes("queue_status = 'open'")) {
      const thread = this.threads.find(row => row.tenant_slug === args[3] && row.id === args[4] && !row.assigned_to_uid && row.queue_status !== 'closed');
      if (!thread) return { success: true, meta: { changes: 0 } };
      thread.assigned_to_uid = args[0];
      thread.assigned_by_uid = args[1];
      thread.assigned_at = 'now';
      thread.queue_status = 'open';
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('SET unread_count = 0')) {
      const thread = this.threads.find(row => row.tenant_slug === args[1] && row.id === args[2]);
      thread.unread_count = 0;
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE tenant_crm_threads SET') && sql.includes('closed_at')) {
      const thread = this.threads.find(row => row.tenant_slug === args[14] && row.id === args[15]);
      if (args[0]) thread.status = args[1];
      if (args[2]) thread.queue_status = args[3];
      if ((args[4] || args[5]) === 'closed') thread.closed_at = 'now';
      if (['open', 'pending'].includes(args[4] || args[5])) thread.closed_at = '';
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 1 } };
  }
}

function req(method, path, uid, body, tenant = 'partner-a') {
  return new Request(`https://worker.example${path}?tenant=${tenant}`, {
    method,
    headers: { 'X-User-Uid': uid, 'X-Tenant-Slug': tenant, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('tenant admin can assign, reassign and unassign only tenant sales/editor members', async () => {
  const env = { DB: new QueueD1() };
  assert.equal((await routeTenantLineMonitorApi(req('PATCH', '/api/v2/line/threads/T-SALES/assignment', 'U-ADMIN', { assigned_to_uid: 'U-SALES' }), env)).status, 200);
  assert.equal(env.DB.threads[0].assigned_to_uid, 'U-SALES');
  assert.equal((await routeTenantLineMonitorApi(req('PATCH', '/api/v2/line/threads/T-SALES/assignment', 'U-ADMIN', { assigned_to_uid: 'U-EDITOR' }), env)).status, 200);
  assert.equal(env.DB.threads[0].assigned_to_uid, 'U-EDITOR');
  assert.equal((await routeTenantLineMonitorApi(req('PATCH', '/api/v2/line/threads/T-SALES/assignment', 'U-ADMIN', { assigned_to_uid: null }), env)).status, 200);
  assert.equal(env.DB.threads[0].assigned_to_uid, '');
  assert.equal((await routeTenantLineMonitorApi(req('PATCH', '/api/v2/line/threads/T-SALES/assignment', 'U-ADMIN', { assigned_to_uid: 'U-DEMO-SALES' }), env)).status, 404);
  assert.equal((await routeTenantLineMonitorApi(req('PATCH', '/api/v2/line/threads/T-SALES/assignment', 'U-ADMIN', { assigned_to_uid: 'U-FIN' }), env)).status, 403);
  assert.ok(env.DB.auditLogs.some(row => row.action === 'tenant.line.thread.assign'));
  assert.ok(env.DB.auditLogs.every(row => !JSON.stringify(row).match(/channel_access_token|Authorization|replyToken|secrets_iv/i)));
});

test('sales and editor claim unassigned threads atomically while forbidden roles fail', async () => {
  const env = { DB: new QueueD1() };
  const first = await routeTenantLineMonitorApi(req('POST', '/api/v2/line/threads/T-SALES/claim', 'U-SALES'), env);
  assert.equal(first.status, 200);
  assert.equal(env.DB.threads[0].assigned_to_uid, 'U-SALES');
  const second = await routeTenantLineMonitorApi(req('POST', '/api/v2/line/threads/T-SALES/claim', 'U-EDITOR'), env);
  assert.equal(second.status, 409);
  assert.equal(env.DB.threads[0].assigned_to_uid, 'U-SALES');
  assert.equal((await routeTenantLineMonitorApi(req('POST', '/api/v2/line/threads/T-EDITOR/claim', 'U-FIN'), env)).status, 403);
  assert.equal((await routeTenantLineMonitorApi(req('POST', '/api/v2/line/threads/T-DEMO/claim', 'U-SALES'), env)).status, 404);
});

test('mark read is tenant and owner or assignee scoped', async () => {
  const env = { DB: new QueueD1() };
  assert.equal((await routeTenantLineMonitorApi(req('POST', '/api/v2/line/threads/T-SALES/read', 'U-SALES'), env)).status, 200);
  assert.equal(env.DB.threads[0].unread_count, 0);
  env.DB.threads[0].unread_count = 2;
  assert.equal((await routeTenantLineMonitorApi(req('POST', '/api/v2/line/threads/T-SALES/read', 'U-EDITOR'), env)).status, 403);
  assert.equal(env.DB.threads[0].unread_count, 2);
});

test('thread list filters support mine, unassigned, unread and queue status without cross-tenant data', async () => {
  const env = { DB: new QueueD1() };
  const mine = await (await routeTenantLineMonitorApi(req('GET', '/api/v2/line/threads', 'U-SALES', undefined, 'partner-a'), env)).json();
  assert.equal(mine.data.some(row => row.tenant_slug === 'demo'), false);
  const unread = await (await routeTenantLineMonitorApi(new Request('https://worker.example/api/v2/line/threads?tenant=partner-a&unread_only=true', { method: 'GET', headers: { 'X-User-Uid': 'U-ADMIN', 'X-Tenant-Slug': 'partner-a' } }), env)).json();
  assert.ok(unread.data.length >= 1);
  assert.equal((await routeTenantLineMonitorApi(new Request('https://worker.example/api/v2/line/threads?tenant=partner-a&assigned_to_uid=U-EDITOR', { method: 'GET', headers: { 'X-User-Uid': 'U-SALES', 'X-Tenant-Slug': 'partner-a' } }), env)).status, 403);
});

test('Phase 15A source exposes work queue APIs and keeps owner separate from assignee', async () => {
  const api = await read('lib/tenant-line-monitor-api.js');
  const client = await read('js/tenant-line-client.js');
  const page = await read('js/tenant-line-monitor-page.js');
  const migration = await read('migrations/0112_tenant_line_work_queue.sql');
  assert.match(api, /assigned_to_uid/);
  assert.match(api, /queue_status/);
  assert.match(api, /unread_count/);
  assert.match(api, /first_response_at/);
  assert.match(api, /COALESCE\(t\.assigned_to_uid, ''\) = ''|COALESCE\(assigned_to_uid, ''\) = ''/);
  assert.match(client, /assignThread/);
  assert.match(client, /claimThread/);
  assert.match(client, /markThreadRead/);
  assert.match(page, /state\.view === 'mine'/);
  assert.doesNotMatch(api, /SET owner_uid =/);
  assert.match(migration, /assigned_to_uid/);
});
