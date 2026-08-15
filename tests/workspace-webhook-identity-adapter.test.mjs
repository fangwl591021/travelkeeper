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
  assert.equal(database.calls.length, 4);
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

test('customer profile with explicit customer binding resolves traveler', async () => {
  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_crm_profiles: { tenant_slug: 'acme', line_user_uid: 'U4', customer_id: 'CUSTOMER-4', status: 'open' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U4',
  });
  assert.equal(identity.primaryRole, 'traveler');
});

test('formal tenant customer line binding resolves traveler even when CRM remains line-only', async () => {
  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({
      tenant_crm_profiles: { tenant_slug: 'acme', line_user_uid: 'U-bound', customer_id: '', source: 'line', status: 'open' },
      customers: { tenant_slug: 'acme', customer_id: 'CUSTOMER-BOUND', customer_line_uid: 'U-bound', owner_uid: 'U-SALES' },
    }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U-bound',
  });
  assert.equal(identity.primaryRole, 'traveler');
  assert.equal(identity.roles.includes('traveler'), true);
});

test('line-only CRM profile without customer binding does not resolve traveler', async () => {
  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_crm_profiles: { tenant_slug: 'acme', line_user_uid: 'U-line-only', customer_id: '', source: 'line', status: 'open' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U-line-only',
  });
  assert.equal(identity.primaryRole, 'unassigned');
  assert.deepEqual(identity.roles, []);
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
      tenant_crm_profiles: { customer_id: 'CUSTOMER-7', status: 'blocked' },
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

test('platform admin requires an active membership in the requested tenant', async () => {
  const activePlatformAdmin = await resolveWorkspaceWebhookIdentity({
    env: env({ tenant_memberships: { role: 'platform_admin', status: 'active' } }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U-platform',
  });
  assert.equal(activePlatformAdmin.primaryRole, 'platform_admin');

  const database = createDb();
  const globalOnly = await resolveWorkspaceWebhookIdentity({
    env: { DB: database, PLATFORM_ADMIN_UIDS: 'U-global' },
    tenantSlug: 'acme',
    verifiedUserUid: 'U-global',
  });
  assert.equal(globalOnly.primaryRole, 'unassigned');
  assert.deepEqual(globalOnly.roles, []);
});

test('only approved or active distributor profiles create partner', async () => {
  for (const status of ['approved', 'active']) {
    const identity = await resolveWorkspaceWebhookIdentity({
      env: env({ tenant_distributor_profiles: { status } }),
      tenantSlug: 'acme',
      verifiedUserUid: `U-distributor-${status}`,
    });
    assert.equal(identity.primaryRole, 'partner', status);
  }

  for (const status of ['pending', 'rejected', 'blocked', 'inactive', 'deleted']) {
    const identity = await resolveWorkspaceWebhookIdentity({
      env: env({ tenant_distributor_profiles: { status } }),
      tenantSlug: 'acme',
      verifiedUserUid: `U-distributor-${status}`,
    });
    assert.equal(identity.primaryRole, 'unassigned', status);
    assert.equal(identity.roles.includes('partner'), false, status);
  }
});

test('blocked inactive or deleted bound CRM profiles do not create traveler', async () => {
  for (const status of ['blocked', 'inactive', 'deleted']) {
    const identity = await resolveWorkspaceWebhookIdentity({
      env: env({ tenant_crm_profiles: { customer_id: `CUSTOMER-${status}`, status } }),
      tenantSlug: 'acme',
      verifiedUserUid: `U-customer-${status}`,
    });
    assert.equal(identity.primaryRole, 'unassigned', status);
    assert.equal(identity.roles.includes('traveler'), false, status);
  }
});

test('D1 failure is an error, never an identity-shaped result', async () => {
  const envWithFailure = {
    DB: {
      prepare() {
        throw new Error('raw D1 error for private tenant and UID');
      },
    },
  };

  await assert.rejects(() => resolveWorkspaceWebhookIdentity({
    env: envWithFailure,
    tenantSlug: 'private-tenant',
    verifiedUserUid: 'U-private',
  }), (error) => {
    assert.equal(error.message, 'WORKSPACE_IDENTITY_ADAPTER_UNAVAILABLE');
    assert.equal(Object.hasOwn(error, 'roles'), false);
    assert.equal(Object.hasOwn(error, 'primaryRole'), false);
    assert.doesNotMatch(String(error), /private-tenant|U-private|raw D1|SELECT|token|secret|credential/i);
    return true;
  });
});

test('tenant slug validation rejects unsafe boundaries without demo fallback', async () => {
  const invalidTenantSlugs = [
    '',
    'Demo',
    'tenant_slug',
    'tenant slug',
    'tenant/child',
    'tenant?x=1',
    'tenant#hash',
    '-tenant',
    'tenant-',
    'a'.repeat(64),
  ];

  for (const tenantSlug of invalidTenantSlugs) {
    await assert.rejects(() => resolveWorkspaceWebhookIdentity({
      env: env({}),
      tenantSlug,
      verifiedUserUid: 'U-boundary',
    }), { message: 'WORKSPACE_IDENTITY_ADAPTER_INVALID_INPUT' });
  }

  const database = createDb();
  const explicitDemo = await resolveWorkspaceWebhookIdentity({
    env: { DB: database },
    tenantSlug: 'demo',
    verifiedUserUid: 'U-demo',
  });
  assert.equal(explicitDemo.primaryRole, 'unassigned');
  assert.equal(database.calls.length, 4);
  for (const call of database.calls) assert.deepEqual(call.values, ['demo', 'U-demo']);
});

test('successful output contains identity fields only, never raw fact rows', async () => {
  const identity = await resolveWorkspaceWebhookIdentity({
    env: env({
      tenant_memberships: { role: 'tenant_admin', status: 'active', permissions_json: '{"secret":true}' },
      tenant_distributor_profiles: { status: 'approved', internal_note: 'private' },
      tenant_crm_profiles: { customer_id: 'CUSTOMER-output', status: 'open', phone: '0900000000' },
      customers: { customer_id: 'CUSTOMER-output', customer_line_uid: 'U-output', owner_uid: 'U-owner-secret' },
    }),
    tenantSlug: 'acme',
    verifiedUserUid: 'U-output',
  });

  assert.deepEqual(Object.keys(identity).sort(), ['primaryRole', 'roles', 'tenantSlug']);
  assert.doesNotMatch(JSON.stringify(identity), /permissions_json|internal_note|0900000000|U-output|U-owner-secret/i);
});