import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceWebhookIdentity } from '../lib/workspace-webhook-identity-adapter.js';

function createDb(rows = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const table = sql.match(/FROM\s+([a-z_]+)/i)?.[1] || '';
      return {
        bind(...values) {
          calls.push({ table, sql, values });
          return {
            async first() {
              return rows[table] ?? null;
            },
          };
        },
      };
    },
  };
}

function env(rows) {
  return { DB: createDb(rows) };
}

test('missing UID returns guest without querying D1', async () => {
  const database = createDb();
  const identity = await resolveWorkspaceWebhookIdentity({
    env: { DB: database },
    tenantSlug: 'acme',
    verifiedUserUid: '  ',
  });
  assert.equal(identity.primaryRole, 'guest');
  assert.equal(database.calls.length, 0);
});

test('tenant is required, never defaults to demo, and must be valid', async () => {
  await assert.rejects(() => resolveWorkspaceWebhookIdentity({ env: env({}), verifiedUserUid: 'U1' }), {
    message: 'WORKSPACE_IDENTITY_ADAPTER_INVALID_INPUT',
  });
  await assert.rejects(() => resolveWorkspaceWebhookIdentity({ env: env({}), tenantSlug: 'Demo', verifiedUserUid: 'U1' }), {
    message: 'WORKSPACE_IDENTITY_ADAPTER_INVALID_INPUT',
  });
  await assert.rejects(() => resolveWorkspaceWebhookIdentity({ env: env({}), tenantSlug: 'bad_slug', verifiedUserUid: 'U1' }), {
    message: 'WORKSPACE_IDENTITY_ADAPTER_INVALID_INPUT',
  });
});

test('all identity queries bind the same tenant and verified UID', async () => {
  const database = createDb();
  await resolveWorkspaceWebhookIdentity({
    env: { DB: database },
    tenantSlug: 'acme',
    verifiedUserUid: 'U123',
  });
  assert.equal(database.calls.length, 3);
  for (const call of database.calls) {
    assert.deepEqual(call.values, ['acme', 'U123']);
    assert.match(call.sql, /tenant_slug = \?/i);
  }
});

test('active tenant admin and finance roles resolve from active membership', async () => {
  const admin = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_memberships: { tenant_slug: 'acme', user_uid: 'U1', role: 'tenant_admin', status: 'active' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U1',
  });
  assert.equal(admin.primaryRole, 'tenant_admin');

  const finance = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_memberships: { tenant_slug: 'acme', user_uid: 'U2', role: 'finance', status: 'active' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U2',
  });
  assert.equal(finance.primaryRole, 'finance');
});

test('approved distributor profile resolves partner', async () => {
  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_distributor_profiles: { tenant_slug: 'acme', user_uid: 'U3', status: 'approved' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U3',
  });
  assert.equal(identity.primaryRole, 'partner');
});

test('customer profile resolves traveler', async () => {
  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_crm_profiles: { tenant_slug: 'acme', line_user_uid: 'U4', status: 'open' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U4',
  });
  assert.equal(identity.primaryRole, 'traveler');
});

test('missing facts resolve unassigned and unknown roles do not elevate', async () => {
  const empty = await resolveWorkspaceWebhookIdentity({
    env: env({}),
    tenantSlug: 'acme',
    verifiedUserUid: 'U5',
  });
  assert.equal(empty.primaryRole, 'unassigned');

  const unknown = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_memberships: { role: 'owner', status: 'active' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U6',
  });
  assert.equal(unknown.primaryRole, 'unassigned');
});

test('inactive or blocked profiles do not create traveler or partner', async () => {
  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({
      tenant_distributor_profiles: { status: 'inactive' },
      tenant_crm_profiles: { status: 'blocked' },
    }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U7',
  });
  assert.equal(identity.primaryRole, 'unassigned');
});

test('D1 failures fail closed without exposing sensitive input', async () => {
  const envWithFailure = {
    DB: {
      prepare() {
        throw new Error('database failure U8 SELECT token=secret');
      },
    },
  };
  await assert.rejects(() => resolveWorkspaceWebhookIdentity({
    env: envWithFailure,
    tenantSlug: 'acme',
    verifiedUserUid: 'U8',
  }), (error) => {
    assert.equal(error.message, 'WORKSPACE_IDENTITY_ADAPTER_UNAVAILABLE');
    assert.doesNotMatch(error.message, /U8|SELECT|token|secret/i);
    return true;
  });
});

test('adapter rejects request-shaped or sensitive inputs and never returns them', async () => {
  await assert.rejects(() => resolveWorkspaceWebhookIdentity({
    env: env({}),
    tenantSlug: 'acme',
    verifiedUserUid: 'U9',
    request: new Request('https://example.test'),
  }), { message: 'WORKSPACE_IDENTITY_ADAPTER_INVALID_INPUT' });

  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({}),
    tenantSlug: 'acme',
    verifiedUserUid: 'U10',
  });
  const serialized = JSON.stringify(identity);
  assert.doesNotMatch(serialized, /replyToken|Channel Secret|Access Token|raw event|U10/i);
});
