import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildTenantCustomerExportPayload,
  buildTenantOrderExportPayload,
  isLegacyCustomerCompatRequest,
  routeLegacyCustomerCompatApi,
  toLegacyCustomerView,
  toLegacyOrderView,
} from '../lib/legacy-customer-compat-api.js';
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
  first() {
    return this.db.first(this.sql, this.args);
  }
  all() {
    return this.db.all(this.sql, this.args);
  }
}

class CompatDb {
  prepare(sql) {
    return new Statement(this, sql);
  }
  async first(sql, args) {
    if (sql.includes('SELECT slug FROM tenants')) return args[0] === 'partner-a' ? { slug: 'partner-a' } : null;
    if (sql.includes('FROM tenant_memberships')) {
      if (sql.includes("role = 'platform_admin'")) return null;
      return args[0] === 'partner-a' && args[1] === 'U-ADMIN'
        ? { tenant_slug: 'partner-a', user_uid: 'U-ADMIN', role: 'platform_admin', status: 'active', permissions_json: '["*"]' }
        : null;
    }
    if (sql.includes('FROM customers')) {
      return {
        tenant_slug: 'partner-a',
        customer_id: 'CUS-PARTNER-1',
        customer_phone: 'CUSREL-PARTNER-1',
        contact_phone: '0912888777',
        customer_name: 'Partner Customer',
        customer_line_uid: 'U-CUSTOMER',
        owner_uid: 'U-SALES',
        owner_name: 'Sales',
        total_orders: 2,
        total_amount: 24000,
        source: 'referral',
        created_at: '2026-07-11 10:00:00',
        updated_at: '2026-07-11 10:00:00',
      };
    }
    return null;
  }
  async all(sql, args) {
    if (sql.includes('FROM customers')) return { results: [] };
    if (sql.includes('FROM orders')) return { results: [] };
    return { results: [] };
  }
}

test('only explicit non-demo legacy requests enter the compatibility layer', () => {
  assert.equal(isLegacyCustomerCompatRequest(new Request('https://worker.example/api/orders/create?a=demo', { method: 'POST' })), false);
  assert.equal(isLegacyCustomerCompatRequest(new Request('https://worker.example/api/orders/create?a=partner-a', { method: 'POST' })), true);
  assert.equal(isLegacyCustomerCompatRequest(new Request('https://worker.example/api/my/customers', {
    headers: { Referer: 'https://example.com/dashboard.html?tenant=partner-a' },
  })), true);
  assert.equal(isLegacyCustomerCompatRequest(new Request('https://worker.example/api/mother/export-customer?tenant=partner-a', { method: 'POST' })), true);
});

test('legacy views display contact phone while retaining a separate relation key', () => {
  const customer = toLegacyCustomerView({
    customer_id: 'CUS1', customer_phone: 'CUSREL1', contact_phone: '0912000000', total_orders: 2,
  });
  assert.equal(customer.customer_phone, '0912000000');
  assert.equal(customer.customerphone, '0912000000');
  assert.equal(customer.customer_key, 'CUSREL1');
  assert.equal(customer.customer_id, 'CUS1');

  const order = toLegacyOrderView({
    order_id: 'ORD1', customer_id: 'CUS1', customer_phone: 'CUSREL1', contact_phone: '0912000000',
  });
  assert.equal(order.customer_phone, '0912000000');
  assert.equal(order.customer_key, 'CUSREL1');
  assert.equal(order.customer_id, 'CUS1');
});

test('mother customer and order payloads use customer id and contact phone', () => {
  const customer = buildTenantCustomerExportPayload({
    tenant_slug: 'partner-a', customer_id: 'CUS1', customer_phone: 'CUSREL1', contact_phone: '0912000000',
  });
  assert.equal(customer.local_id, 'CUS1');
  assert.equal(customer.customer_id, 'CUS1');
  assert.equal(customer.customer_phone, '0912000000');
  assert.equal('customer_key' in customer, false);

  const order = buildTenantOrderExportPayload({
    tenant_slug: 'partner-a', order_id: 'ORD1', customer_id: 'CUS1', customer_phone: 'CUSREL1', contact_phone: '0912000000',
  });
  assert.equal(order.local_id, 'ORD1');
  assert.equal(order.customer_id, 'CUS1');
  assert.equal(order.customer_phone, '0912000000');
  assert.equal('customer_key' in order, false);
});

test('tenant customer mother export dry run is tenant scoped', async () => {
  const request = new Request('https://worker.example/api/mother/export-customer?tenant=partner-a', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': 'partner-a',
      'X-User-Uid': 'U-ADMIN',
    },
    body: JSON.stringify({ customer_id: 'CUS-PARTNER-1', dryRun: true }),
  });
  const response = await routeLegacyCustomerCompatApi(request, { DB: new CompatDb(), WASABI_PREFIX: 'travelkeeper' }, {});
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.tenant_slug, 'partner-a');
  assert.equal(payload.data.results[0].payload.local_id, 'CUS-PARTNER-1');
  assert.equal(payload.data.results[0].payload.customer_phone, '0912888777');
  assert.match(payload.data.results[0].key, /tenants\/partner-a\/customers\/CUS-PARTNER-1\.json$/);
});

test('compatibility source scopes reads and exports by tenant', async () => {
  const source = await readFile(new URL('../lib/legacy-customer-compat-api.js', import.meta.url), 'utf8');
  assert.match(source, /WHERE tenant_slug = \?/);
  assert.match(source, /customer_id = \? OR contact_phone = \?/);
  assert.match(source, /tenants\/\$\{encodeURIComponent\(tenantSlug\)\}/);
  assert.match(source, /routeTenantBookingApi\(translated, env, legacyWorker\)/);
  assert.doesNotMatch(source, /ON CONFLICT\(customer_phone\)/);
});

test('worker evaluates compatibility routes before legacy worker fallback', async () => {
  const worker = await readFile(new URL('../worker-tenant.js', import.meta.url), 'utf8');
  const compat = worker.indexOf('isLegacyCustomerCompatRequest(request)');
  const fallback = worker.indexOf('legacyWorker.fetch(request, env, ctx)');
  assert.equal(compat >= 0, true);
  assert.equal(fallback >= 0, true);
  assert.equal(compat < fallback, true);
  assert.match(worker, /X-TravelKeeper-Tenant-Isolation', 'phase9'/);
});

test('mother storage compatibility errors have operational status codes', () => {
  assert.equal(statusForError('MOTHER_STORAGE_NOT_CONFIGURED'), 503);
  assert.equal(statusForError('MOTHER_STORAGE_WRITE_DISABLED'), 409);
  assert.equal(statusForError('MOTHER_STORAGE_WRITE_FAILED:500:test'), 502);
});
