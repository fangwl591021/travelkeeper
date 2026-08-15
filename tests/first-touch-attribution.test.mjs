import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');

import { signReferralToken } from '../lib/referral-token.js';
import {
  isTenantAttributionApiRequest,
  routeTenantAttributionApi,
} from '../lib/tenant-attribution-api.js';

const secret = 'first-touch-test-secret-long-enough-for-hmac';

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  first() { return this.db.first(this.sql, this.args); }
  run() { return this.db.run(this.sql, this.args); }
}

class FirstTouchDb {
  constructor({ firstTouch = null, customer = null, profile = null } = {}) {
    this.firstTouch = firstTouch;
    this.customer = customer;
    this.profile = profile;
    this.auditCount = 0;
    this.queries = [];
  }
  prepare(sql) {
    this.queries.push(sql);
    return new Statement(this, sql);
  }
  async first(sql, args) {
    if (sql.includes('FROM tenant_distributor_profiles')) {
      const uid = args[1];
      if (uid === 'U-A') return { user_uid: 'U-A', display_name: 'Seller A', invite_code: 'A1', role: 'sales', status: 'active' };
      if (uid === 'U-B') return { user_uid: 'U-B', display_name: 'Seller B', invite_code: 'B1', role: 'sales', status: 'active' };
      return null;
    }
    if (sql.includes('FROM tenant_first_touch_attributions')) return this.firstTouch;
    if (sql.includes('FROM customers') && sql.includes('customer_line_uid = ?')) return this.customer;
    if (sql.includes('FROM customers') && sql.includes('customer_id = ?')) {
      return this.customer?.customer_id === args[1] ? this.customer : null;
    }
    if (sql.includes('FROM tenant_crm_profiles')) return this.profile;
    return null;
  }
  async run(sql, args) {
    if (sql.includes('INSERT INTO tenant_first_touch_attributions')) {
      if (this.firstTouch) return { success: true, meta: { changes: 0 } };
      this.firstTouch = {
        tenant_slug: args[0],
        line_user_uid: args[1],
        ref_uid: args[2],
        first_itinerary_id: args[3],
        first_share_id: args[4],
        referral_jti: args[5],
        source: args[6],
        captured_at: '2026-08-15 11:30:00',
      };
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('INSERT INTO tenant_crm_profiles')) {
      if (!this.profile) {
        this.profile = {
          id: args[0],
          tenant_slug: args[1],
          customer_id: '',
          line_user_uid: args[2],
          ref_uid: args[3],
          owner_uid: args[4],
        };
      } else {
        if (!this.profile.ref_uid) this.profile.ref_uid = args[3];
        if (!this.profile.owner_uid) this.profile.owner_uid = args[4];
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE customers')) {
      if (!this.customer.ref_uid) this.customer.ref_uid = args[0];
      if (!this.customer.owner_uid) {
        this.customer.owner_uid = args[1];
        this.customer.owner_name = args[2];
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      this.auditCount += 1;
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 1 } };
  }
}

async function referralToken(distributorUid, inviteCode = distributorUid === 'U-A' ? 'A1' : 'B1', itineraryId = 'TOUR-1') {
  return signReferralToken(secret, {
    tenant_slug: 'acme',
    itinerary_id: itineraryId,
    distributor_uid: distributorUid,
    invite_code: inviteCode,
    jti: `JTI-${distributorUid}-${itineraryId}`,
  });
}

function request(token, body = {}, lineUid = 'U-CUSTOMER') {
  return new Request('https://worker.example/api/v2/attribution/first-touch?tenant=acme', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': 'acme',
      'X-User-Uid': lineUid,
    },
    body: JSON.stringify({
      itinerary_id: 'TOUR-1',
      referral_token: token,
      share_id: 'SHARE-1',
      ...body,
    }),
  });
}

function env(db) {
  return { DB: db, REFERRAL_SIGNING_SECRET: secret };
}

test('first-touch route is explicit and tenant authenticated', () => {
  assert.equal(isTenantAttributionApiRequest(new Request('https://x/api/v2/attribution/first-touch')), true);
  assert.equal(isTenantAttributionApiRequest(new Request('https://x/api/v2/attribution/other')), false);
});

test('first valid signed referral captures canonical referrer and LINE lead projection', async () => {
  const db = new FirstTouchDb();
  const response = await routeTenantAttributionApi(request(await referralToken('U-A')), env(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.outcome, 'captured');
  assert.equal(payload.projection, 'crm_lead');
  assert.equal(payload.first_touch.ref_uid, 'U-A');
  assert.equal(payload.first_touch.first_itinerary_id, 'TOUR-1');
  assert.equal(payload.first_touch.first_share_id, 'SHARE-1');
  assert.equal(db.firstTouch.line_user_uid, 'U-CUSTOMER');
  assert.equal(db.profile.ref_uid, 'U-A');
  assert.equal(db.profile.owner_uid, 'U-A');
  assert.equal(db.auditCount, 1);
});

test('later signed referral cannot replace an earlier canonical first touch', async () => {
  const db = new FirstTouchDb({
    firstTouch: {
      tenant_slug: 'acme', line_user_uid: 'U-CUSTOMER', ref_uid: 'U-A',
      first_itinerary_id: 'TOUR-OLD', first_share_id: 'SHARE-A', referral_jti: 'JTI-A',
      source: 'booking_landing', captured_at: '2026-08-01 10:00:00',
    },
    profile: { id: 'CRM-1', customer_id: '', line_user_uid: 'U-CUSTOMER', ref_uid: 'U-A', owner_uid: 'U-A' },
  });
  const response = await routeTenantAttributionApi(request(await referralToken('U-B')), env(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.outcome, 'preserved');
  assert.equal(payload.first_touch.ref_uid, 'U-A');
  assert.equal(db.firstTouch.ref_uid, 'U-A');
  assert.equal(db.profile.ref_uid, 'U-A');
  assert.equal(db.auditCount, 0);
});

test('existing formal customer attribution seeds first-touch before a later referral can claim it', async () => {
  const db = new FirstTouchDb({
    customer: {
      customer_id: 'CUS-1', customer_line_uid: 'U-CUSTOMER',
      ref_uid: 'U-A', owner_uid: 'U-A', owner_name: 'Seller A',
    },
  });
  const response = await routeTenantAttributionApi(request(await referralToken('U-B')), env(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.outcome, 'preserved');
  assert.equal(payload.projection, 'customer');
  assert.equal(payload.first_touch.ref_uid, 'U-A');
  assert.equal(db.firstTouch.ref_uid, 'U-A');
  assert.equal(db.firstTouch.source, 'customer_existing');
  assert.equal(db.customer.ref_uid, 'U-A');
  assert.equal(db.auditCount, 0);
});

test('unsigned distributor fields in body cannot override signed token claims', async () => {
  const db = new FirstTouchDb();
  const response = await routeTenantAttributionApi(request(await referralToken('U-A'), {
    distributor_uid: 'U-B',
    ref_uid: 'U-B',
    user_uid: 'U-FORGED',
  }), env(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.first_touch.ref_uid, 'U-A');
  assert.equal(db.firstTouch.line_user_uid, 'U-CUSTOMER');
  assert.equal(db.firstTouch.ref_uid, 'U-A');
});

test('referral token must match tenant itinerary context', async () => {
  const db = new FirstTouchDb();
  const response = await routeTenantAttributionApi(request(await referralToken('U-A', 'A1', 'TOUR-OTHER')), env(db));
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'REFERRAL_TOKEN_CONTEXT_MISMATCH');
  assert.equal(db.firstTouch, null);
});

test('first-touch migration backfills customer before CRM and then makes rows immutable', async () => {
  const migration = await readFile(new URL('../migrations/0116_tenant_first_touch_attribution.sql', import.meta.url), 'utf8');
  const customerBackfill = migration.indexOf("'customer_backfill'");
  const crmBackfill = migration.indexOf("'crm_backfill'");
  assert.ok(customerBackfill >= 0 && crmBackfill > customerBackfill);
  assert.match(migration, /PRIMARY KEY \(tenant_slug, line_user_uid\)/);
  assert.match(migration, /trg_tenant_first_touch_immutable/);
  assert.match(migration, /ATTRIBUTION_FIRST_TOUCH_IMMUTABLE/);
  assert.match(migration, /tenant_first_touch_attributions f/);
  assert.match(migration, /f\.line_user_uid = NEW\.customer_line_uid/);
});

test('worker sends first-touch through authenticated tenant route and booking waits for landing capture', async () => {
  const worker = await readFile(new URL('../worker-tenant.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../js/tenant-api-client.js', import.meta.url), 'utf8');

  assert.match(worker, /isTenantAttributionApiRequest\(request\).*securedRoute\(request, env, routeTenantAttributionApi\)/s);
  assert.match(client, /bookingFirstTouchConfig/);
  assert.match(client, /referral_token: config\.referral_token/);
  assert.match(client, /await bookingFirstTouchPromise/);
  assert.match(client, /runBookingFirstTouchCapture\(\{ waitForLogin: false \}\)/);
  assert.doesNotMatch(client, /first-touch[^\n]*distributor_uid/i);
});