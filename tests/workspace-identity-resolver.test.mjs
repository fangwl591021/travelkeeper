import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceIdentity } from '../lib/workspace-identity-resolver.js';

const base = { verifiedUserUid: 'U-test', tenantSlug: 'demo' };

test('returns guest without a verified UID', () => {
  assert.deepEqual(resolveWorkspaceIdentity({ tenantSlug: 'demo' }), {
    tenantSlug: 'demo',
    roles: [],
    primaryRole: 'guest'
  });
  assert.deepEqual(resolveWorkspaceIdentity({ ...base, verifiedUserUid: '  ' }), {
    tenantSlug: 'demo',
    roles: [],
    primaryRole: 'guest'
  });
});

test('returns unassigned for an authenticated user without a known role', () => {
  assert.deepEqual(resolveWorkspaceIdentity({ ...base, membership: { status: 'active', role: 'unknown' } }), {
    tenantSlug: 'demo',
    roles: [],
    primaryRole: 'unassigned'
  });
});

const membershipRoleCases = [
  ['platform_admin', 'platform_admin'],
  ['tenant_admin', 'tenant_admin'],
  ['finance', 'finance'],
  ['sales', 'partner'],
  ['editor', 'partner'],
  ['member', 'traveler']
];

for (const [role, expected] of membershipRoleCases) {
  test(`maps active membership role ${role}`, () => {
    assert.deepEqual(resolveWorkspaceIdentity({ ...base, membership: { status: 'active', role } }), {
      tenantSlug: 'demo',
      roles: [expected],
      primaryRole: expected
    });
  });
}

test('ignores inactive membership roles', () => {
  assert.deepEqual(resolveWorkspaceIdentity({
    ...base,
    membership: { status: 'inactive', role: 'platform_admin' }
  }), {
    tenantSlug: 'demo',
    roles: [],
    primaryRole: 'unassigned'
  });
});

test('adds partner for approved or active distributor profiles', () => {
  assert.deepEqual(resolveWorkspaceIdentity({ ...base, distributorProfile: { status: 'approved' } }), {
    tenantSlug: 'demo',
    roles: ['partner'],
    primaryRole: 'partner'
  });
  assert.deepEqual(resolveWorkspaceIdentity({ ...base, distributorProfile: { status: 'active' } }), {
    tenantSlug: 'demo',
    roles: ['partner'],
    primaryRole: 'partner'
  });
});

test('adds traveler when a customer profile exists', () => {
  assert.deepEqual(resolveWorkspaceIdentity({ ...base, customerProfile: { id: 'customer-1' } }), {
    tenantSlug: 'demo',
    roles: ['traveler'],
    primaryRole: 'traveler'
  });
});

test('deduplicates roles and uses the fixed privilege order', () => {
  assert.deepEqual(resolveWorkspaceIdentity({
    ...base,
    membership: {
      status: 'active',
      roles: ['member', 'sales', 'editor', 'finance', 'sales']
    },
    distributorProfile: { status: 'approved' },
    customerProfile: { id: 'customer-1' }
  }), {
    tenantSlug: 'demo',
    roles: ['finance', 'partner', 'traveler'],
    primaryRole: 'finance'
  });
});

test('does not elevate finance or unknown roles', () => {
  assert.deepEqual(resolveWorkspaceIdentity({
    ...base,
    membership: { status: 'active', roles: ['finance', 'super_admin', 'owner'] }
  }), {
    tenantSlug: 'demo',
    roles: ['finance'],
    primaryRole: 'finance'
  });
});

test('handles null and undefined inputs safely', () => {
  assert.deepEqual(resolveWorkspaceIdentity(null), {
    tenantSlug: '',
    roles: [],
    primaryRole: 'guest'
  });
  assert.deepEqual(resolveWorkspaceIdentity(undefined), {
    tenantSlug: '',
    roles: [],
    primaryRole: 'guest'
  });
});
