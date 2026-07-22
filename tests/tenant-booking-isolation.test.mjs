import test from 'node:test';
import assert from 'node:assert/strict';

import {
  customerIdentityId,
  normalizeCustomerPhone,
  routeTenantBookingApi,
} from '../lib/tenant-booking-api.js';

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
     this.prepares = [];
    this.existingCustomer = null;
    this.globalCustomerTenant = '';
    this.order = null;
  }

  prepare(sql) {
    this.prepares.push(sql);
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

    if (sql.includes('COALESCE(NULLIF(contact_phone')) {
      return this.existingCustomer;
    }

    if (sql.includes('FROM customers') && sql.includes('WHERE customer_phone = ?')) {
      return this.globalCustomerTenant ? { tenant_slug: this.globalCustomerTenant } : null;
    }

    if (sql.includes('FROM orders')) return this.order;
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

test('phone normalization produces a stable tenant identity input', () => {
  assert.equal(normalizeCustomerPhone('0912-000-000'), '0912000000');
  assert.equal(normalizeCustomerPhone('+886 912 000 000'), '+886912000000');
});

test('the same phone receives different customer ids in different tenants', async () => {
  const a = await customerIdentityId('tenant-a', '0912000000');
  const b = await customerIdentityId('tenant-b', '0912000000');
  assert.match(a, /^CUS[A-F0-9]{32}$/);
  assert.notEqual(a, b);
  assert.equal(a, await customerIdentityId('tenant-a', '0912-000-000'));
});

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

test('booking stores authenticated UID plus customer id and actual contact phone', async () => {
  const env = { DB: new FakeDb() };
  const response = await routeTenantBookingApi(
    bookingRequest('demo', {
      itinerary_id: 'TOUR-DEMO',
      invite_code: 'SELLER1',
      customer_line_uid: 'U-FORGED',
      customer_name: 'Tony',
      customer_phone: '0912-000-000',
      travelers: 2,
    }, 'U-REAL'),
    env,
    { fetch: async () => new Response('{}') },
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.data.customer_line_uid, 'U-REAL');
  assert.equal(payload.data.customer_phone, '0912000000');
  assert.match(payload.data.customer_id, /^CUS[A-F0-9]{32}$/);
  assert.equal(payload.data.total_amount, 2000);
  assert.equal(payload.data.deposit_amount, 400);
  const distributorQueries = env.DB.prepares.filter(sql => sql.includes('FROM tenant_distributor_profiles'));
  assert.equal(distributorQueries.length, 1);
  assert.match(distributorQueries[0], /m\.role IN \('sales', 'editor'\)/);

  const [customerWrite, orderWrite] = env.DB.batches[0];
  assert.match(customerWrite.sql, /customer_id/);
  assert.equal(orderWrite.args[8], '0912000000');
  assert.equal(orderWrite.args[9], 'U-REAL');
  assert.equal(orderWrite.args.at(-1), 'demo');
});

test('a phone used as a legacy key by another tenant no longer blocks booking', async () => {
  const db = new FakeDb();
  db.globalCustomerTenant = 'tenant-b';
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
  assert.equal(response.status, 201);
  const orderWrite = db.batches[0][1];
  assert.match(orderWrite.args[6], /^CUS[A-F0-9]{32}$/);
  assert.equal(orderWrite.args[8], '0912000000');
  assert.equal(payload.data.customer_phone, '0912000000');
});

test('an existing tenant customer keeps its relation key and customer id', async () => {
  const db = new FakeDb();
  db.existingCustomer = { customer_id: 'CUS-EXISTING', customer_key: 'LEGACY-KEY' };
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
  assert.equal(response.status, 201);
  const [customerWrite, orderWrite] = db.batches[0];
  assert.match(customerWrite.sql, /UPDATE customers/);
  assert.equal(orderWrite.args[6], 'LEGACY-KEY');
  assert.equal(orderWrite.args[7], 'CUS-EXISTING');
  assert.equal(payload.data.customer_id, 'CUS-EXISTING');
});

test('existing customer owner remains stable while each order keeps its referral distributor', async () => {
  const db = new FakeDb();
  db.existingCustomer = {
    customer_id: 'CUS-EXISTING', customer_key: 'LEGACY-KEY',
    owner_uid: 'U-ORIGINAL', owner_name: 'Original Sales',
  };
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
  assert.equal(response.status, 201);
  const [customerWrite, orderWrite] = db.batches[0];
  assert.match(customerWrite.sql, /owner_uid = CASE WHEN COALESCE\(owner_uid, ''\) = '' THEN \? ELSE owner_uid END/);
  assert.match(customerWrite.sql, /owner_name = CASE WHEN COALESCE\(owner_uid, ''\) = '' THEN \? ELSE owner_name END/);
  assert.equal(customerWrite.args[4], 'U-SALES');
  assert.equal(orderWrite.args[4], 'U-SALES');
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
