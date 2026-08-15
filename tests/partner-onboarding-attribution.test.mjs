import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');

import {
  signPartnerInviteToken,
  verifyPartnerInviteToken,
} from '../lib/partner-invite-token.js';
import {
  isTenantPartnerOnboardingApiRequest,
  routeTenantPartnerOnboardingApi,
} from '../lib/tenant-partner-onboarding-api.js';

const secret = 'partner-invite-test-secret-long-enough-for-hmac';

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  first() { return this.db.first(this.sql, this.args); }
  run() { return this.db.run(this.sql, this.args); }
}

class OnboardingDb {
  constructor({ membership = null, profile = null } = {}) {
    this.membership = membership;
    this.profile = profile;
    this.batches = [];
    this.runs = [];
  }
  prepare(sql) { return new Statement(this, sql); }
  async first(sql, args) {
    if (sql.includes('SELECT slug FROM tenants')) return { slug: args[0] };

    if (sql.includes('FROM tenant_memberships m') && sql.includes('LEFT JOIN tenant_distributor_profiles p')) {
      if (sql.includes("m.status = 'active'") && sql.includes("m.role IN ('sales', 'editor')")) {
        const uid = args[1];
        if (uid === 'U-REF' || uid === 'U-SALES') {
          return {
            user_uid: uid,
            role: 'sales',
            status: 'active',
            display_name: uid === 'U-REF' ? 'Referrer' : 'Sales',
            invite_code: uid === 'U-REF' ? 'REF001' : 'SALE001',
          };
        }
        return null;
      }
      if (!this.membership) return null;
      return {
        tenant_slug: this.membership.tenant_slug,
        user_uid: this.membership.user_uid,
        role: this.membership.role,
        status: this.membership.status,
        permissions_json: '[]',
        created_at: '2026-08-15 12:00:00',
        updated_at: '2026-08-15 12:00:00',
        display_name: this.profile?.display_name || '',
        phone: this.profile?.phone || '',
        email: this.profile?.email || '',
        company_name: this.profile?.company_name || '',
        avatar: this.profile?.avatar || '',
        invite_code: this.profile?.invite_code || '',
        ref_uid: this.profile?.ref_uid || '',
        joined_at: '2026-08-15 12:00:00',
      };
    }

    // requireTenantContext membership lookup used by partner invite generation.
    if (sql.includes('SELECT role, status, permissions_json') && sql.includes('FROM tenant_memberships')) {
      const uid = args[1];
      if (uid === 'U-SALES') return { role: 'sales', status: 'active', permissions_json: '[]' };
      return null;
    }
    return null;
  }
  async run(sql, args) {
    this.runs.push({ sql, args });
    if (sql.includes('UPDATE tenant_distributor_profiles') && this.profile) {
      if (args[0]) this.profile.display_name = args[1];
      if (args[2]) this.profile.phone = args[3];
      if (args[4]) this.profile.email = args[5];
      if (args[6]) this.profile.company_name = args[7];
      if (args[8]) this.profile.avatar = args[9];
    }
    return { success: true, meta: { changes: 1 } };
  }
  async batch(statements) {
    const rows = statements.map(statement => ({ sql: statement.sql, args: statement.args }));
    this.batches.push(rows);
    const membershipArgs = rows[0].args;
    const profileArgs = rows[1].args;
    this.membership = {
      tenant_slug: membershipArgs[0],
      user_uid: membershipArgs[1],
      role: 'sales',
      status: 'invited',
    };
    this.profile = {
      tenant_slug: profileArgs[0],
      user_uid: profileArgs[1],
      display_name: profileArgs[2],
      phone: profileArgs[3],
      email: profileArgs[4],
      company_name: profileArgs[5],
      avatar: profileArgs[6],
      invite_code: profileArgs[7],
      ref_uid: profileArgs[8],
    };
    return rows.map(() => ({ success: true, meta: { changes: 1 } }));
  }
}

function env(db) {
  return {
    DB: db,
    REFERRAL_SIGNING_SECRET: secret,
  };
}

function applicationRequest(body = {}, tenant = 'acme', userUid = 'U-APPLICANT') {
  return new Request(`https://worker.example/api/v2/partner-applications?tenant=${tenant}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenant,
      'X-User-Uid': userUid,
    },
    body: JSON.stringify({ name: 'Applicant', phone: '0912000000', ...body }),
  });
}

async function inviteToken(refUid = 'U-REF', tenant = 'acme') {
  return signPartnerInviteToken(secret, {
    tenant_slug: tenant,
    ref_uid: refUid,
    invite_code: 'REF001',
    jti: `JTI-${tenant}-${refUid}`,
  });
}

test('partner invite tokens are domain-separated, signed and tenant-bound', async () => {
  const token = await inviteToken();
  const valid = await verifyPartnerInviteToken(secret, token, { tenant_slug: 'acme' });
  assert.equal(valid.ok, true);
  assert.equal(valid.claims.purpose, 'partner_invite');
  assert.equal(valid.claims.ref_uid, 'U-REF');

  const mismatch = await verifyPartnerInviteToken(secret, token, { tenant_slug: 'other' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, 'PARTNER_INVITE_CONTEXT_MISMATCH');

  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await verifyPartnerInviteToken(secret, tampered, { tenant_slug: 'acme' })).ok, false);
});

test('partner onboarding routes are explicit', () => {
  assert.equal(isTenantPartnerOnboardingApiRequest(new Request('https://x/api/v2/partner-applications')), true);
  assert.equal(isTenantPartnerOnboardingApiRequest(new Request('https://x/api/v2/partner-applications/me')), true);
  assert.equal(isTenantPartnerOnboardingApiRequest(new Request('https://x/api/v2/partner-invites')), true);
  assert.equal(isTenantPartnerOnboardingApiRequest(new Request('https://x/api/partner/register')), false);
});

test('generic application trusts verified LINE UID and ignores forged uid/referrer fields', async () => {
  const db = new OnboardingDb();
  let legacyCalled = false;
  const response = await routeTenantPartnerOnboardingApi(
    applicationRequest({ uid: 'U-FORGED', user_uid: 'U-FORGED-2', ref_uid: 'U-REF' }),
    env(db),
    { fetch: async () => { legacyCalled = true; return new Response('{}'); } },
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.data.state, 'pending');
  assert.equal(db.membership.user_uid, 'U-APPLICANT');
  assert.equal(db.profile.user_uid, 'U-APPLICANT');
  assert.equal(db.profile.ref_uid, '');
  assert.equal(legacyCalled, false);

  const [membershipWrite, profileWrite, auditWrite] = db.batches[0];
  assert.equal(membershipWrite.args[1], 'U-APPLICANT');
  assert.equal(profileWrite.args[8], '');
  const audit = JSON.parse(auditWrite.args[4]);
  assert.equal(audit.ref_uid, '');
  assert.equal(audit.source, 'generic_application');
});

test('signed partner invite is the only authority that creates tenant-scoped upline attribution', async () => {
  const db = new OnboardingDb();
  const response = await routeTenantPartnerOnboardingApi(
    applicationRequest({
      partner_invite_token: await inviteToken(),
      ref_uid: 'U-FORGED-REF',
    }),
    env(db),
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.data.state, 'pending');
  assert.equal(payload.data.has_referrer, true);
  assert.equal(db.profile.ref_uid, 'U-REF');
  assert.notEqual(db.profile.ref_uid, 'U-FORGED-REF');
  const audit = JSON.parse(db.batches[0][2].args[4]);
  assert.equal(audit.ref_uid, 'U-REF');
  assert.equal(audit.source, 'signed_partner_invite');
  assert.equal(audit.invite_jti, 'JTI-acme-U-REF');
});

test('partner invite token cannot cross tenants', async () => {
  const db = new OnboardingDb();
  const response = await routeTenantPartnerOnboardingApi(
    applicationRequest({ partner_invite_token: await inviteToken('U-REF', 'other') }),
    env(db),
  );
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'PARTNER_INVITE_CONTEXT_MISMATCH');
  assert.equal(db.batches.length, 0);
});

test('pending application resubmission updates contact fields but cannot replace existing referrer', async () => {
  const db = new OnboardingDb({
    membership: { tenant_slug: 'acme', user_uid: 'U-APPLICANT', role: 'sales', status: 'invited' },
    profile: {
      tenant_slug: 'acme', user_uid: 'U-APPLICANT', display_name: 'Old', phone: '', email: '',
      company_name: '', avatar: '', invite_code: 'PABC', ref_uid: 'U-REF',
    },
  });
  const response = await routeTenantPartnerOnboardingApi(
    applicationRequest({
      name: 'Updated Applicant',
      company_name: 'Updated Co',
      partner_invite_token: await inviteToken('U-SALES'),
      ref_uid: 'U-SALES',
    }),
    env(db),
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.idempotent, true);
  assert.equal(db.profile.ref_uid, 'U-REF');
  assert.equal(db.profile.display_name, 'Updated Applicant');
  assert.equal(db.profile.company_name, 'Updated Co');
  assert.equal(db.batches.length, 0);
  assert.doesNotMatch(db.runs[0].sql, /ref_uid\s*=/);
});

test('active sales can create a signed invite for themselves only', async () => {
  const db = new OnboardingDb({
    membership: { tenant_slug: 'acme', user_uid: 'U-SALES', role: 'sales', status: 'active' },
    profile: { user_uid: 'U-SALES', display_name: 'Sales', invite_code: 'SALE001', ref_uid: '' },
  });
  const req = new Request('https://worker.example/api/v2/partner-invites?tenant=acme', {
    method: 'POST',
    headers: { 'X-Tenant-Slug': 'acme', 'X-User-Uid': 'U-SALES', 'Content-Type': 'application/json' },
    body: '{}',
  });
  const response = await routeTenantPartnerOnboardingApi(req, env(db));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.ref_uid, 'U-SALES');
  const verified = await verifyPartnerInviteToken(secret, payload.data.partner_invite_token, { tenant_slug: 'acme' });
  assert.equal(verified.ok, true);
  assert.equal(verified.claims.ref_uid, 'U-SALES');
});

test('worker places partner onboarding behind verified tenant LINE authentication', async () => {
  const source = await readFile(new URL('../worker-tenant.js', import.meta.url), 'utf8');
  assert.match(source, /isTenantPartnerOnboardingApiRequest\(request\)/);
  assert.match(source, /const securedRequest = await authenticatedTenantRequest\(request, env\)/);
  assert.match(source, /routeTenantPartnerOnboardingApi\(securedRequest, env, legacyWorker\)/);
});
