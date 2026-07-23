import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  isTenantCrmApiRequest,
  routeTenantCrmApi,
} from '../lib/tenant-crm-api.js';
import { statusForError } from '../lib/http-error-status.js';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  first() { return this.db.first(this.sql, this.args); }
  all() { return this.db.all(this.sql, this.args); }
  run() { return this.db.run(this.sql, this.args); }
}

class CrmDb {
  constructor() {
    this.profile = {
      id: 'CUS-PARTNER-1', tenant_slug: 'partner-a', customer_id: 'CUS-PARTNER-1',
      line_user_uid: 'U-CUSTOMER', display_name: 'Partner Customer', picture_url: '',
      phone: '0912888777', email: '', birthday: '', address: '', identity_note: '',
      preference_note: '', taboo_note: '', privacy_consent: '', ref_uid: 'U-SALES',
      invite_code: '', referral_note: '', owner_uid: 'U-SALES', source: 'order',
      status: 'closed', risk: 'low', opportunity_stage: 'won', opportunity_value: 12000,
      opportunity_note: '', summary: '', note: '', tags_json: '[]', last_message_at: '',
      created_at: '2026-07-11 10:00:00', updated_at: '2026-07-11 10:00:00',
    };
  }
  prepare(sql) { return new Statement(this, sql); }
  async first(sql, args) {
    if (sql.includes('SELECT slug FROM tenants')) return args[0] === 'partner-a' ? { slug: 'partner-a' } : null;
    if (sql.includes('FROM tenant_memberships')) {
      const uid = args[1] || args[0];
      const role = uid === 'U-ADMIN' ? 'tenant_admin' : uid === 'U-SALES' ? 'sales' : uid === 'U-FIN' ? 'finance' : '';
      if (sql.includes("role IN ('sales', 'editor')") && role !== 'sales') return null;
      return role ? { tenant_slug: 'partner-a', user_uid: uid, role, status: 'active', permissions_json: '[]' } : null;
    }
    if (sql.includes('FROM tenant_crm_profiles') && sql.includes('line_user_uid = ?')) {
      return args.at(-1) === this.profile.line_user_uid ? { ...this.profile } : null;
    }
    if (sql.includes('FROM tenant_crm_profiles') && /\bid\s*=\s*\?/.test(sql)) {
      return args.at(-1) === this.profile.id ? { ...this.profile } : null;
    }
    if (sql.includes('FROM tenant_crm_profiles') && sql.includes('customer_id = ?')) {
      return args.at(-1) === this.profile.customer_id ? { ...this.profile } : null;
    }
    if (sql.includes('FROM customers') && sql.includes('customer_id = ?')) {
      return args.at(-1) === 'CUS-PARTNER-1' ? {
        tenant_slug: 'partner-a', customer_id: 'CUS-PARTNER-1', customer_phone: 'CUSREL-PARTNER-1',
        contact_phone: '0912888777', customer_name: 'Partner Customer', customer_line_uid: 'U-CUSTOMER',
        owner_uid: 'U-SALES', total_orders: 1, total_amount: 12000, first_order_at: '2026-07-10',
        last_order_at: '2026-07-11', note: '', created_at: '2026-07-10', updated_at: '2026-07-11',
      } : null;
    }
    if (sql.includes('FROM tenant_crm_threads')) return null;
    return null;
  }
  async all(sql, args) {
    if (sql.includes('FROM customers c') && sql.includes('LEFT JOIN tenant_crm_profiles')) {
      return { results: [{
        tenant_slug: 'partner-a', customer_id: 'CUS-PARTNER-1', customer_phone: 'CUSREL-PARTNER-1',
        contact_phone: '0912888777', customer_name: 'Partner Customer', customer_line_uid: 'U-CUSTOMER',
        owner_uid: 'U-SALES', total_orders: 1, total_amount: 12000, first_order_at: '2026-07-10',
        last_order_at: '2026-07-11', note: '', created_at: '2026-07-10', updated_at: '2026-07-11',
        p_id: 'CUS-PARTNER-1', p_customer_id: 'CUS-PARTNER-1', p_line_user_uid: 'U-CUSTOMER',
        p_display_name: 'Partner Customer', p_picture_url: '', p_phone: '0912888777', p_email: '',
        p_birthday: '', p_address: '', p_identity_note: '', p_preference_note: '', p_taboo_note: '',
        p_privacy_consent: '', p_ref_uid: 'U-SALES', p_invite_code: '', p_referral_note: '',
        p_owner_uid: 'U-SALES', p_source: 'order', p_status: 'closed', p_risk: 'low',
        p_opportunity_stage: 'won', p_opportunity_value: 12000, p_opportunity_note: '', p_summary: '',
        p_note: '', p_tags_json: '[]', p_last_message_at: '', p_created_at: '2026-07-10',
        p_updated_at: '2026-07-11',
      }] };
    }
    if (sql.includes('FROM tenant_crm_profiles') && sql.includes("customer_id = ''")) return { results: [] };
    if (sql.includes('FROM orders')) return { results: [{
      tenant_slug: 'partner-a', order_id: 'ORD-PARTNER-1', customer_id: 'CUS-PARTNER-1',
      customer_phone: 'CUSREL-PARTNER-1', contact_phone: '0912888777', customer_name: 'Partner Customer',
      customer_line_uid: 'U-CUSTOMER', distributor_uid: 'U-SALES', itinerary_title: 'Test Tour',
      status: 'confirmed', total_amount: 12000, price: 12000, created_at: '2026-07-11 10:00:00',
    }] };
    if (sql.includes('FROM tenant_crm_threads')) return { results: [] };
    if (sql.includes('FROM tenant_crm_records')) return { results: [{
      id: 'REC1', tenant_slug: 'partner-a', profile_id: 'CUS-PARTNER-1', thread_id: '',
      category: '需求', content: '希望安排親子行程', status: 'follow_up', priority: 'high',
      due_at: '', created_by: 'U-ADMIN', updated_by: 'U-ADMIN', deleted_at: '',
      created_at: '2026-07-11 11:00:00', updated_at: '2026-07-11 11:00:00',
    }] };
    return { results: [] };
  }
  async run(sql, args) {
    if (sql.includes('INSERT INTO tenant_crm_profiles')) {
      this.profile = { ...this.profile, id: args[0], tenant_slug: args[1], ref_uid: args[14], owner_uid: args[17] };
    }
    return { success: true, changes: 1 };
  }
}

function request(path, uid, options = {}) {
  return new Request(`https://worker.example${path}`, {
    method: options.method || 'GET',
    headers: {
      'X-Tenant-Slug': 'partner-a',
      'X-User-Uid': uid,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

test('CRM migration adds tenant profiles, threads, records and tenant indexes', async () => {
  const migration = await readFile(new URL('../migrations/0109_tenant_crm.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant_crm_profiles/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant_crm_threads/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant_crm_records/);
  assert.match(migration, /idx_tenant_crm_profiles_tenant_customer/);
  assert.match(migration, /idx_tenant_crm_profiles_tenant_line_uid/);
  assert.match(migration, /FOREIGN KEY \(tenant_slug\) REFERENCES tenants/);
  assert.match(migration, /idx_tenant_crm_threads_profile/);
  assert.match(migration, /CREATE TRIGGER/);
  assert.match(migration, /FROM customers/);
  assert.match(migration, /ON CONFLICT\(id\) DO NOTHING/);
});

test('tenant CRM route detection is limited to V2 CRM paths', () => {
  assert.equal(isTenantCrmApiRequest(new Request('https://x/api/v2/crm')), true);
  assert.equal(isTenantCrmApiRequest(new Request('https://x/api/v2/crm/profiles/CUS1')), true);
  assert.equal(isTenantCrmApiRequest(new Request('https://x/api/line-oa/crm')), false);
});

test('tenant admin sees isolated CRM customer, order and follow-up record', async () => {
  const response = await routeTenantCrmApi(request('/api/v2/crm', 'U-ADMIN'), { DB: new CrmDb() });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.tenantSlug, 'partner-a');
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].phone, '0912888777');
  assert.equal(payload.data[0].customer_id, 'CUS-PARTNER-1');
  assert.equal(payload.data[0].orders[0].order_id, 'ORD-PARTNER-1');
  assert.equal(payload.data[0].latestRecord.content, '希望安排親子行程');
  assert.equal(payload.summary.follow_up_count, 1);
});

test('finance role cannot read sensitive CRM profile data', async () => {
  const response = await routeTenantCrmApi(request('/api/v2/crm', 'U-FIN'), { DB: new CrmDb() });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'TENANT_ROLE_DENIED');
});

test('sales cannot edit a CRM profile owned by another sales user', async () => {
  const response = await routeTenantCrmApi(request('/api/v2/crm/profiles/CUS-PARTNER-1', 'U-SALES', {
    method: 'POST',
    body: { owner_uid: 'U-OTHER-SALES', display_name: 'Changed' },
  }), { DB: new CrmDb() });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'CRM_PROFILE_ACCESS_DENIED');
});


test('sales cannot overwrite an existing referral owner', async () => {
  const response = await routeTenantCrmApi(request('/api/v2/crm/profiles/CUS-PARTNER-1', 'U-SALES', {
    method: 'POST',
    body: { ref_uid: 'U-OTHER-SALES', display_name: 'Rejected referral overwrite' },
  }), { DB: new CrmDb() });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'CRM_PROFILE_ACCESS_DENIED');
});

test('tenant admin cannot assign a CRM profile to a non-sales member', async () => {
  const response = await routeTenantCrmApi(request('/api/v2/crm/profiles/CUS-PARTNER-1', 'U-ADMIN', {
    method: 'POST',
    body: { owner_uid: 'U-FIN', ref_uid: 'U-FIN', display_name: 'Rejected reassignment' },
  }), { DB: new CrmDb() });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'CRM_PROFILE_ACCESS_DENIED');
});

test('tenant admin can assign a CRM profile to an active same-tenant sales member', async () => {
  const response = await routeTenantCrmApi(request('/api/v2/crm/profiles/CUS-PARTNER-1', 'U-ADMIN', {
    method: 'POST',
    body: { owner_uid: 'U-SALES', ref_uid: 'U-SALES', display_name: 'Accepted reassignment' },
  }), { DB: new CrmDb() });
  assert.equal(response.status, 200);
});
test('same-tenant LINE-only profile creation returns a precise conflict', async () => {
  const response = await routeTenantCrmApi(request('/api/v2/crm/profiles', 'U-ADMIN', {
    method: 'POST',
    body: { line_user_uid: 'U-CUSTOMER', display_name: 'Duplicate Line Customer' },
  }), { DB: new CrmDb() });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error, 'CRM_LINE_UID_CONFLICT');
});
test('CRM error codes map to precise HTTP status', () => {
  assert.equal(statusForError('CRM_PROFILE_ACCESS_DENIED'), 403);
  assert.equal(statusForError('CRM_PROFILE_NOT_FOUND'), 404);
  assert.equal(statusForError('INVALID_CRM_STAGE'), 400);
  assert.equal(statusForError('CRM_LINE_UID_CONFLICT'), 409);
});

test('CRM source always scopes customer, order, profile and record reads by tenant', async () => {
  const source = await readFile(new URL('../lib/tenant-crm-api.js', import.meta.url), 'utf8');
  assert.match(source, /WHERE c\.tenant_slug = \?/);
  assert.match(source, /WHERE tenant_slug = \?/);
  assert.match(source, /WHERE t\.tenant_slug = \?/);
  assert.match(source, /WHERE r\.tenant_slug = \?/);
  assert.match(source, /allowedRoles: READ_ROLES/);
  assert.doesNotMatch(source, /api\/line-oa\/crm/);
});
