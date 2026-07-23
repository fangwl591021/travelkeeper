import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTenantSlug,
  requestedTenantSlug,
  requireTenantContext,
} from '../lib/tenant-context.js';
import { authenticateLineRequest } from '../lib/line-auth.js';
import { routeTenantApi } from '../lib/tenant-api.js';

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

  async all() {
    return { results: await this.db.all(this.sql, this.args) };
  }

  async run() {
    return { meta: { changes: 1 } };
  }
}

class FakeDb {
  constructor() {
    this.tenants = [
      { slug: 'demo', name: 'Demo', liff_id: '2000000000-demo' },
      { slug: 'tenant-b', name: 'Tenant B', liff_id: '2000000001-b' },
    ];
    this.memberships = [
      { tenant_slug: 'demo', user_uid: 'U-DEMO', role: 'tenant_admin', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'demo', user_uid: 'U-SALES', role: 'sales', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'demo', user_uid: 'U-OTHER', role: 'sales', status: 'active', permissions_json: '[]' },
      { tenant_slug: 'tenant-b', user_uid: 'U-B', role: 'tenant_admin', status: 'active', permissions_json: '[]' },
    ];
    this.itineraries = [
      { id: 'TOUR-1', tenant_slug: 'demo', title: 'Demo Tour', owner_uid: 'U-SALES', review_status: 'published', deleted_at: '', price: 1000 },
      { id: 'TOUR-2', tenant_slug: 'demo', title: 'Other Sales Tour', owner_uid: 'U-OTHER', review_status: 'draft', deleted_at: '', price: 1100 },
      { id: 'TOUR-1', tenant_slug: 'tenant-b', title: 'Tenant B Tour', review_status: 'published', deleted_at: '', price: 2000 },
    ];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async first(sql, args) {
    if (sql.includes('FROM tenants')) {
      return this.tenants.find(row => row.slug === args[0]) || null;
    }
    if (sql.includes('FROM tenant_memberships')) {
      if (sql.includes("role = 'platform_admin'")) return null;
      return this.memberships.find(row => row.tenant_slug === args[0] && row.user_uid === args[1]) || null;
    }
    if (sql.includes('FROM tenant_distributor_profiles')) return null;
    if (sql.includes('FROM itineraries')) {
      return this.itineraries.find(row => row.tenant_slug === args[0] && row.id === args[1] &&
        (!sql.includes('owner_uid = ?') || row.owner_uid === args[2])) || null;
    }
    return null;
  }

  async all(sql, args) {
    if (sql.includes('FROM itineraries')) {
      const ownerIndex = sql.includes('owner_uid = ?') ? 1 : -1;
      return this.itineraries.filter(row => row.tenant_slug === args[0] &&
        (ownerIndex < 0 || row.owner_uid === args[ownerIndex]));
    }
    return [];
  }
}

test('tenant slug normalization only accepts safe SaaS slugs', () => {
  assert.equal(normalizeTenantSlug(' Tenant-B '), 'tenant-b');
  assert.throws(() => normalizeTenantSlug('../demo'), /INVALID_TENANT_SLUG/);
});

test('tenant request resolves explicit header before URL fallback', () => {
  const request = new Request('https://example.com/api/v2/orders?a=demo', {
    headers: { 'X-Tenant-Slug': 'tenant-b' },
  });
  assert.equal(requestedTenantSlug(request), 'tenant-b');
});

test('membership is scoped to the requested tenant', async () => {
  const env = { DB: new FakeDb() };
  const context = await requireTenantContext(env, {
    tenantSlug: 'demo',
    userUid: 'U-DEMO',
  });
  assert.equal(context.tenantSlug, 'demo');
  assert.equal(context.role, 'tenant_admin');

  await assert.rejects(
    requireTenantContext(env, { tenantSlug: 'tenant-b', userUid: 'U-DEMO' }),
    /TENANT_ACCESS_DENIED/,
  );
});

test('public itinerary lookup never crosses tenant boundary', async () => {
  const env = { DB: new FakeDb() };

  const demoResponse = await routeTenantApi(
    new Request('https://worker.example/api/v2/itineraries/TOUR-1?tenant=demo&scope=public'),
    env,
  );
  const demo = await demoResponse.json();
  assert.equal(demo.success, true);
  assert.equal(demo.data.title, 'Demo Tour');

  const tenantBResponse = await routeTenantApi(
    new Request('https://worker.example/api/v2/itineraries/TOUR-1?tenant=tenant-b&scope=public'),
    env,
  );
  const tenantB = await tenantBResponse.json();
  assert.equal(tenantB.success, true);
  assert.equal(tenantB.data.title, 'Tenant B Tour');
});

test('sales itinerary list ignores requested owner and stays owner scoped', async () => {
  const env = { DB: new FakeDb() };
  const response = await routeTenantApi(
    new Request('https://worker.example/api/v2/itineraries?tenant=demo&scope=private&owner=U-OTHER', {
      headers: { 'X-Tenant-Slug': 'demo', 'X-User-Uid': 'U-SALES' },
    }),
    env,
  );
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.deepEqual(payload.data.map(row => row.id), ['TOUR-1']);
});

test('sales cannot read another sales user itinerary by id', async () => {
  const env = { DB: new FakeDb() };
  const response = await routeTenantApi(
    new Request('https://worker.example/api/v2/itineraries/TOUR-2?tenant=demo&scope=private', {
      headers: { 'X-Tenant-Slug': 'demo', 'X-User-Uid': 'U-SALES' },
    }),
    env,
  );
  assert.equal(response.status, 404);
});

test('UID alone is rejected unless temporary legacy mode is explicitly enabled', async () => {
  const request = new Request('https://worker.example/api/v2/orders?uid=U-DEMO');
  await assert.rejects(authenticateLineRequest(request, {}), /AUTH_REQUIRED/);

  const legacy = await authenticateLineRequest(request, { ALLOW_LEGACY_UID_AUTH: '1' });
  assert.equal(legacy.authMode, 'legacy_uid');
  assert.equal(legacy.userUid, 'U-DEMO');
});
