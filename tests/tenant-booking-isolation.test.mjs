import test from 'node:test';
import assert from 'node:assert/strict';

import { routeTenantBookingApi } from '../lib/tenant-booking-api.js';

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    return this.db.first(this.sql, this.args);
  }

  async run() {
    this.db.runs.push({ sql: this.sql, args: this.args });
    return { success: true, meta: { changes: 1 } };
  }
}

class FakeDb {
  constructor() {
    this.runs = [];
    this.batches = [];
    this.customerTenant = '';
    this.order = null;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    this.batches.push(statements.map(statement => ({ sql: statement.sql, args: statement.args })));
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }

  async first(sql, args) {
    if (sql.includes('FROM tenants')) {
      return ['demo', 'tenant-b'].includes(args[0]) ? { slug: args[0] } : null;
    }

    if (sql.includes('FROM itineraries')) {
      if (args[0] === 'demo' && args[1] === 'TOUR-DEMO') {
        return {
          id: 'TOUR-DEMO',
          tenant_slug: 'demo',
          title: 'Demo Tour',
          price: 1000,
          payment_mode: 'deposit',
          deposit_ratio: 20,
          deposit_amount: 0,
          balance_collect: 'online',
          commission_mode: 'amount',
          commission_amount: 100,
          review_status: 'published',
          deleted_at: '',
          expire_at: '',
        };
      }
      return null;
    }

    if (sql.includes('FROM tenant_distributor_profiles')) {
      const tenant = args[0];
      const key = args[1];
      if (tenant === 'demo' && (key === 'SELLER1' || key === 'U-SALES')) {
        return {
          user_uid: 'U-SALES',
          display_name: 'Sales Demo',
          invite_code: 'SELLER1',
          role: 'sales',
          status: 'active',
        };
      }
      return null;
    }

    if (sql.includes('FROM customers')) {
      return this.customerTenant ? { tenant_slug: this.customerTenant } : null;
    }

    if (sql.includes('FROM orders')) {
      return this.order;
    }

    return null;
  }
}

function bookingRequest(tenant, body, userUid = 'U-CUSTOMER') {
  return new Request(`https://worker.example/api/v2/bookings?tenant=${tenant}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenant,
      'X-User-Uid': userUid,
    },
    body: JSON.stringify(body),
  });
}

test('booking cannot use an itinerary from another tenant', async () => {
  const env = { DB: new FakeDb() };
  const response = await routeTenantBookingApi(
    bookingRequest('tenant-b', {
      itinerary_id: 'TOUR-DEMO',
      invite_code: 'SELLER1',
      customer_name: 'Tony',
      customer_phone: '0912000000',
    }),
    env,
    { fetch: async () => new Response('{}') },
  );
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.error, 'ITINERARY_NOT_FOUND');
  assert.equal(env.DB.batches.length, 0);
});

test('booking stores the authenticated LINE UID instead of a forged body UID', async () => {
  const env = { DB: new FakeDb() };
  const response = await routeTenantBookingApi(
    bookingRequest('demo', {
      itinerary_id: 'TOUR-DEMO',
      invite_code: 'SELLER1',
      customer_line_uid: 'U-FORGED',
      customer_name: 'Tony',
      customer_phone: '0912000000',
      travelers: 2,
    }, 'U-REAL'),
    env,
    { fetch: async () => new Response('{}') },
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.data.customer_line_uid, 'U-REAL');
  assert.equal(payload.data.tenant_slug, 'demo');
  assert.equal(payload.data.total_amount, 2000);
  assert.equal(payload.data.deposit_amount, 400);

  const orderWrite = env.DB.batches[0][0];
  assert.equal(orderWrite.args[7], 'U-REAL');
  assert.equal(orderWrite.args.at(-1), 'demo');
});

test('global phone key fails safely when the phone belongs to another tenant', async () => {
  const db = new FakeDb();
  db.customerTenant = 'tenant-b';
  const response = await routeTenantBookingApi(
    bookingRequest('demo', {
      itinerary_id: 'TOUR-DEMO',
      invite_code: 'SELLER1',
      customer_name: 'Tony',
      customer_phone: '0912000000',
    }),
    { DB: db },
    { fetch: async () => new Response('{}') },
  );
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error, 'CUSTOMER_PHONE_TENANT_CONFLICT');
  assert.equal(db.batches.length, 0);
});

test('payment creation checks tenant and customer before calling legacy gateway', async () => {
  const db = new FakeDb();
  db.order = {
    order_id: 'ORD-B',
    tenant_slug: 'tenant-b',
    customer_line_uid: 'U-REAL',
    deposit_amount: 500,
    balance_amount: 1500,
  };
  let legacyCalled = false;
  const response = await routeTenantBookingApi(
    new Request('https://worker.example/api/v2/payments/create?tenant=tenant-b', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': 'tenant-b',
        'X-User-Uid': 'U-REAL',
      },
      body: JSON.stringify({ order_id: 'ORD-B', leg: 'deposit' }),
    }),
    { DB: db },
    { fetch: async () => { legacyCalled = true; return new Response('{}'); } },
  );
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error, 'TENANT_PAYMENT_CONFIGURATION_REQUIRED');
  assert.equal(legacyCalled, false);
});

test('another LINE user cannot create payment for the customer order', async () => {
  const db = new FakeDb();
  db.order = {
    order_id: 'ORD-DEMO',
    tenant_slug: 'demo',
    customer_line_uid: 'U-OWNER',
    deposit_amount: 500,
    balance_amount: 1500,
  };
  const response = await routeTenantBookingApi(
    new Request('https://worker.example/api/v2/payments/create?tenant=demo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': 'demo',
        'X-User-Uid': 'U-OTHER',
      },
      body: JSON.stringify({ order_id: 'ORD-DEMO', leg: 'deposit' }),
    }),
    { DB: db },
    { fetch: async () => new Response('{}') },
  );
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'ORDER_CUSTOMER_MISMATCH');
});
