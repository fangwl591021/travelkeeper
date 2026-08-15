import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { routeTenantBookingApi } from '../lib/tenant-booking-api.js';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.db.first(this.sql, this.args); }
  async run() { return { success: true, meta: { changes: 1 } }; }
}

class Db {
  constructor({ customer = null, profile = null } = {}) {
    this.customer = customer;
    this.profile = profile;
    this.batches = [];
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.batches.push(statements.map(statement => ({ sql: statement.sql, args: statement.args })));
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }
  async first(sql, args) {
    if (sql.includes('FROM tenants')) return { slug: args[0] };
    if (sql.includes('FROM itineraries')) return {
      id: 'TOUR-1', tenant_slug: 'acme', title: 'Tour', price: 1000,
      payment_mode: 'deposit', deposit_ratio: 20, deposit_amount: 0,
      balance_collect: 'online', commission_mode: 'amount', commission_amount: 100,
      review_status: 'published', deleted_at: '', expire_at: '',
    };
    if (sql.includes('FROM tenant_distributor_profiles')) return {
      user_uid: 'U-SELLER-B', display_name: 'Seller B', invite_code: 'SELLERB',
      role: 'sales', status: 'active',
    };
    if (sql.includes('COALESCE(NULLIF(contact_phone')) return this.customer;
    if (sql.includes('FROM tenant_crm_profiles')) return this.profile;
    if (sql.includes('FROM customers') && sql.includes('WHERE customer_phone = ?')) return null;
    return null;
  }
}

function bookingRequest(userUid = 'U-CUSTOMER') {
  return new Request('https://worker.example/api/v2/bookings?tenant=acme', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': 'acme',
      'X-User-Uid': userUid,
    },
    body: JSON.stringify({
      itinerary_id: 'TOUR-1',
      invite_code: 'SELLERB',
      customer_name: 'Customer',
      customer_phone: '0912-000-000',
    }),
  });
}

test('Attribution migration separates referrer, owner, and per-order distributor', async () => {
  const migration = await read('migrations/0115_attribution_contract_v1.sql');
  assert.match(migration, /ALTER TABLE customers ADD COLUMN ref_uid/);
  assert.match(migration, /ALTER TABLE tenant_distributor_profiles ADD COLUMN ref_uid/);
  assert.match(migration, /trg_customers_referrer_immutable/);
  assert.match(migration, /trg_distributor_referrer_immutable/);
  assert.match(migration, /trg_crm_referrer_customer_update/);
  assert.match(migration, /ATTRIBUTION_REFERRER_CONFLICT/);
  assert.match(migration, /m\.tenant_slug = NEW\.tenant_slug/);
});

test('existing customer cannot be claimed by another LINE UID just because phone matches', async () => {
  const db = new Db({
    customer: {
      customer_id: 'CUS-1', customer_key: 'LEGACY-1', customer_line_uid: 'U-ORIGINAL',
      owner_uid: 'U-OWNER', owner_name: 'Owner', ref_uid: 'U-REF',
    },
  });
  const response = await routeTenantBookingApi(bookingRequest('U-OTHER'), { DB: db }, { fetch: async () => new Response('{}') });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error, 'CUSTOMER_LINE_IDENTITY_CONFLICT');
  assert.equal(db.batches.length, 0);
});

test('repeat booking preserves original referrer and owner while order records current distributor', async () => {
  const db = new Db({
    customer: {
      customer_id: 'CUS-1', customer_key: 'LEGACY-1', customer_line_uid: 'U-CUSTOMER',
      owner_uid: 'U-OWNER-A', owner_name: 'Owner A', ref_uid: 'U-REF-A',
    },
  });
  const response = await routeTenantBookingApi(bookingRequest(), { DB: db }, { fetch: async () => new Response('{}') });
  assert.equal(response.status, 201);
  assert.equal(db.batches.length, 1);
  const [customerWrite, orderWrite, crmLink] = db.batches[0];
  assert.match(customerWrite.sql, /ref_uid = CASE WHEN COALESCE\(ref_uid, ''\) = '' THEN \? ELSE ref_uid END/);
  assert.equal(customerWrite.args[4], 'U-SELLER-B');
  assert.equal(customerWrite.args[6], 'U-REF-A');
  assert.equal(orderWrite.args[4], 'U-SELLER-B');
  assert.match(crmLink.sql, /ref_uid = CASE WHEN ref_uid = '' THEN \? ELSE ref_uid END/);
  assert.equal(crmLink.args[1], 'U-REF-A');
  assert.equal(crmLink.args[2], 'U-OWNER-A');
});

test('new customer receives first valid distributor as both initial referrer and initial owner', async () => {
  const db = new Db();
  const response = await routeTenantBookingApi(bookingRequest(), { DB: db }, { fetch: async () => new Response('{}') });
  assert.equal(response.status, 201);
  const [customerWrite, orderWrite, crmLink] = db.batches[0];
  assert.match(customerWrite.sql, /owner_name, ref_uid/);
  assert.equal(customerWrite.args[3], 'U-SELLER-B');
  assert.equal(customerWrite.args[5], 'U-SELLER-B');
  assert.equal(orderWrite.args[4], 'U-SELLER-B');
  assert.equal(crmLink.args[1], 'U-SELLER-B');
  assert.equal(crmLink.args[2], 'U-SELLER-B');
});
