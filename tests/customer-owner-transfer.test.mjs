import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  isTenantOrderActionRequest,
  routeTenantOrderAction,
} from '../lib/tenant-order-actions-api.js';

const sourceUrl = new URL('../lib/tenant-order-actions-api.js', import.meta.url);
const migrationUrl = new URL('../migrations/0115_attribution_contract_v1.sql', import.meta.url);

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  first() { return this.db.first(this.sql, this.args); }
  run() { return this.db.run(this.sql, this.args); }
}

class TransferDb {
  constructor({ actorRole = 'tenant_admin', targetRole = 'sales', sameOwner = false } = {}) {
    this.actorRole = actorRole;
    this.targetRole = targetRole;
    this.sameOwner = sameOwner;
    this.batches = [];
    this.runs = [];
  }
  prepare(sql) { return new Statement(this, sql); }
  async first(sql, args) {
    if (sql.includes('SELECT slug FROM tenants')) return { slug: 'acme' };
    if (sql.includes('FROM tenant_memberships') && !sql.includes("role IN ('sales', 'editor')")) {
      const uid = args[1] || args[0];
      if (uid === 'U-ADMIN') return { tenant_slug: 'acme', user_uid: uid, role: this.actorRole, status: 'active', permissions_json: '[]' };
      return null;
    }
    if (sql.includes('FROM customers')) {
      return {
        customer_id: 'CUS-1',
        owner_uid: this.sameOwner ? 'U-TARGET' : 'U-OLD',
        owner_name: this.sameOwner ? 'Target Sales' : 'Old Sales',
        ref_uid: 'U-REF-ORIGINAL',
      };
    }
    if (sql.includes("m.role IN ('sales', 'editor')")) {
      if (this.targetRole === 'sales' || this.targetRole === 'editor') {
        return { user_uid: 'U-TARGET', display_name: 'Target Sales' };
      }
      return null;
    }
    return null;
  }
  async run(sql, args) {
    this.runs.push({ sql, args });
    return { success: true, meta: { changes: 1 } };
  }
  async batch(statements) {
    const snapshot = statements.map(statement => ({ sql: statement.sql, args: statement.args }));
    this.batches.push(snapshot);
    return [
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 1 } },
    ];
  }
}

function transferRequest(body = { owner_uid: 'U-TARGET' }) {
  return new Request('https://worker.example/api/v2/customers/CUS-1/owner-transfer?tenant=acme', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': 'acme',
      'X-User-Uid': 'U-ADMIN',
      'X-Request-Id': 'REQ-OWNER-1',
    },
    body: JSON.stringify(body),
  });
}

test('owner transfer route is explicit and does not replace regular CRM editing', () => {
  assert.equal(isTenantOrderActionRequest(new Request('https://x/api/v2/customers/CUS-1/owner-transfer')), true);
  assert.equal(isTenantOrderActionRequest(new Request('https://x/api/v2/customers/CUS-1')), false);
});

test('tenant admin can transfer service owner without changing original referrer', async () => {
  const db = new TransferDb();
  const response = await routeTenantOrderAction(transferRequest(), { DB: db });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.idempotent, false);
  assert.equal(payload.data.customer_id, 'CUS-1');
  assert.equal(payload.data.ref_uid, 'U-REF-ORIGINAL');
  assert.equal(payload.data.owner_uid, 'U-TARGET');
  assert.equal(db.batches.length, 1);

  const [customerUpdate, auditInsert] = db.batches[0];
  assert.match(customerUpdate.sql, /UPDATE customers/);
  assert.match(customerUpdate.sql, /SET owner_uid = \?/);
  assert.doesNotMatch(customerUpdate.sql, /ref_uid\s*=/);
  assert.equal(customerUpdate.args[0], 'U-TARGET');
  assert.equal(customerUpdate.args[2], 'acme');
  assert.equal(customerUpdate.args[3], 'CUS-1');
  assert.equal(customerUpdate.args[4], 'U-OLD');

  assert.match(auditInsert.sql, /customer\.owner\.transfer/);
  assert.match(auditInsert.sql, /WHERE changes\(\) = 1/);
  assert.deepEqual(JSON.parse(auditInsert.args[4]), { owner_uid: 'U-OLD', owner_name: 'Old Sales' });
  assert.deepEqual(JSON.parse(auditInsert.args[5]), { owner_uid: 'U-TARGET', owner_name: 'Target Sales' });
  assert.doesNotMatch(auditInsert.args[4] + auditInsert.args[5], /ref_uid|phone|line|email/i);
});

test('owner transfer rejects a target that is not active sales or editor in the same tenant', async () => {
  const db = new TransferDb({ targetRole: 'finance' });
  const response = await routeTenantOrderAction(transferRequest(), { DB: db });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'OWNER_TRANSFER_TARGET_DENIED');
  assert.equal(db.batches.length, 0);
});

test('non-admin role cannot transfer customer owner', async () => {
  const db = new TransferDb({ actorRole: 'sales' });
  const response = await routeTenantOrderAction(transferRequest(), { DB: db });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'TENANT_ROLE_DENIED');
  assert.equal(db.batches.length, 0);
});

test('transferring to the existing owner is idempotent and does not create an audit row', async () => {
  const db = new TransferDb({ sameOwner: true });
  const response = await routeTenantOrderAction(transferRequest(), { DB: db });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.idempotent, true);
  assert.equal(payload.data.ref_uid, 'U-REF-ORIGINAL');
  assert.equal(payload.data.owner_uid, 'U-TARGET');
  assert.equal(db.batches.length, 0);
});

test('Attribution V1 projection trigger propagates canonical owner changes to CRM', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /trg_customer_attribution_projection_update/);
  assert.match(migration, /owner_uid = NEW\.owner_uid/);
});

test('owner transfer implementation never updates order distributor or customer referrer', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const start = source.indexOf('async function transferCustomerOwner');
  const end = source.indexOf('export function isTenantOrderActionRequest');
  const block = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(block, /UPDATE orders/);
  assert.doesNotMatch(block, /SET[^;]*ref_uid\s*=/s);
  assert.match(block, /customer\.owner\.transfer/);
});