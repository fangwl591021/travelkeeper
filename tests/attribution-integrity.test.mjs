import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  isTenantAttributionIntegrityRequest,
  routeTenantAttributionIntegrity,
} from '../lib/tenant-attribution-integrity-api.js';

const workerUrl = new URL('../worker-tenant.js', import.meta.url);
const integrityUrl = new URL('../lib/tenant-attribution-integrity-api.js', import.meta.url);

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
}

class IntegrityDb {
  constructor({ role = 'tenant_admin', counts = [], migrationMissing = false } = {}) {
    this.role = role;
    this.counts = [...counts];
    this.migrationMissing = migrationMissing;
    this.countQueries = [];
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  async first(sql, args) {
    if (sql.includes('SELECT slug FROM tenants')) return { slug: 'acme' };
    if (sql.includes('SELECT tenant_slug, user_uid, role, status, permissions_json') && sql.includes('FROM tenant_memberships')) {
      return {
        tenant_slug: 'acme',
        user_uid: String(args[1] || ''),
        role: this.role,
        status: 'active',
        permissions_json: '[]',
      };
    }
    if (/COUNT\(\*\) AS count/i.test(sql)) {
      this.countQueries.push({ sql, args });
      if (this.migrationMissing && sql.includes('tenant_first_touch_attributions')) {
        throw new Error('D1_ERROR: no such table: tenant_first_touch_attributions');
      }
      return { count: this.counts.length ? this.counts.shift() : 0 };
    }
    return null;
  }
}

function request() {
  return new Request('https://worker.example/api/v2/attribution/integrity?tenant=acme', {
    method: 'GET',
    headers: {
      'X-Tenant-Slug': 'acme',
      'X-User-Uid': 'U-ADMIN-SECRET',
    },
  });
}

test('integrity route is explicit and read-only', () => {
  assert.equal(isTenantAttributionIntegrityRequest(new Request('https://x/api/v2/attribution/integrity')), true);
  assert.equal(isTenantAttributionIntegrityRequest(new Request('https://x/api/v2/attribution/first-touch')), false);
});

test('tenant admin gets healthy=true when all core checks are zero', async () => {
  const db = new IntegrityDb();
  const response = await routeTenantAttributionIntegrity(request(), { DB: db });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.tenantSlug, 'acme');
  assert.equal(payload.healthy, true);
  assert.equal(payload.gate.required_schema, '0116+');
  assert.equal(payload.gate.core_mismatch_count, 0);
  assert.equal(payload.gate.warning_count, 0);
  assert.equal(db.countQueries.length, 14);
  assert.ok(db.countQueries.every(item => item.args[0] === 'acme'));
  assert.doesNotMatch(JSON.stringify(payload), /U-ADMIN-SECRET/);
});

test('core mismatches fail the gate while warnings remain separately counted', async () => {
  const db = new IntegrityDb({
    counts: [1, 0, 2, 0, 1, 0, 0, 0, 3, 0, 0, 0, 0, 0],
  });
  const response = await routeTenantAttributionIntegrity(request(), { DB: db });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.healthy, false);
  assert.equal(payload.gate.core_mismatch_count, 4);
  assert.equal(payload.gate.warning_count, 3);
  assert.equal(payload.core.customer_first_touch_ref_mismatch, 1);
  assert.equal(payload.core.crm_customer_owner_mismatch, 2);
  assert.equal(payload.core.duplicate_customer_line_identity, 1);
  assert.equal(payload.warnings.customer_owner_not_active, 3);
});

test('non-admin roles cannot read attribution integrity', async () => {
  const db = new IntegrityDb({ role: 'sales' });
  const response = await routeTenantAttributionIntegrity(request(), { DB: db });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'TENANT_ROLE_DENIED');
  assert.equal(db.countQueries.length, 0);
});

test('missing 0116 schema fails closed instead of reporting a false healthy state', async () => {
  const db = new IntegrityDb({ migrationMissing: true });
  const response = await routeTenantAttributionIntegrity(request(), { DB: db });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error, 'ATTRIBUTION_MIGRATION_REQUIRED');
});

test('integrity implementation returns aggregate counts only and never selects PII detail rows', async () => {
  const source = await readFile(integrityUrl, 'utf8');
  assert.match(source, /COUNT\(\*\) AS count/g);
  assert.doesNotMatch(source, /SELECT\s+c\.customer_id\s*,/i);
  assert.doesNotMatch(source, /SELECT\s+p\.line_user_uid\s*,/i);
  assert.doesNotMatch(source, /examples\s*:/i);
  assert.doesNotMatch(source, /sample\s*:/i);
});

test('worker routes integrity through authenticated tenant request before first-touch attribution', async () => {
  const source = await readFile(workerUrl, 'utf8');
  assert.match(source, /isTenantAttributionIntegrityRequest/);
  assert.match(source, /return securedRoute\(request, env, routeTenantAttributionIntegrity\)/);
  const integrityIndex = source.indexOf('if (isTenantAttributionIntegrityRequest(request))');
  const firstTouchIndex = source.indexOf('if (isTenantAttributionApiRequest(request))');
  assert.ok(integrityIndex >= 0 && firstTouchIndex > integrityIndex);
});
