import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateWorkspaceRequest } from '../lib/workspace-coordinator.js';

const routes = {
  orders: 'https://example.com/orders',
  pendingItineraries: 'https://example.com/pending',
  lineMonitor: 'https://example.com/line-monitor',
  customers: 'https://example.com/customers',
  promotions: 'https://example.com/promotions',
  reservations: 'https://example.com/reservations',
  itineraries: 'https://example.com/itineraries',
  support: 'https://example.com/support'
};

const identity = (roles, extra = {}) => ({
  verifiedUserUid: 'U-test',
  tenantSlug: 'demo',
  membership: { status: 'active', roles },
  ...extra
});

const resolvedIdentity = (roles, primaryRole = roles[0] || 'unassigned') => ({
  tenantSlug: 'demo',
  roles,
  primaryRole
});

test('returns control to the existing flow for unknown text', () => {
  assert.deepEqual(coordinateWorkspaceRequest({
    text: '我想去日本旅遊',
    identityInput: identity(['member']),
    routes
  }), { handled: false, outcome: 'not_workspace_intent' });
});

test('requires login for a guest', () => {
  assert.deepEqual(coordinateWorkspaceRequest({
    text: '工作台',
    identityInput: {},
    routes
  }), {
    handled: true,
    outcome: 'login_required',
    responseText: '請先完成 LINE 登入，再開啟工作台。'
  });
});

test('forbids authenticated unassigned identity', () => {
  assert.deepEqual(coordinateWorkspaceRequest({
    text: '工作台',
    identityInput: identity([]),
    routes
  }), {
    handled: true,
    outcome: 'forbidden',
    responseText: '目前沒有權限使用此工作台。'
  });
});

test('builds an admin Flex response', () => {
  const result = coordinateWorkspaceRequest({
    text: '儀表板',
    identityInput: identity(['tenant_admin']),
    routes
  });
  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'allowed');
  assert.equal(result.targetIntent, 'admin_dashboard');
  assert.equal(result.message.type, 'flex');
  assert.ok(result.fallbackText);
});

test('builds partner and traveler Flex responses', () => {
  const partner = coordinateWorkspaceRequest({
    text: '業務專區',
    identityInput: identity([], { distributorProfile: { status: 'approved' } }),
    routes
  });
  const traveler = coordinateWorkspaceRequest({
    text: '我的行程',
    identityInput: identity(['member']),
    routes
  });
  assert.equal(partner.targetIntent, 'partner_workspace');
  assert.equal(partner.outcome, 'allowed');
  assert.equal(traveler.targetIntent, 'traveler_workspace');
  assert.equal(traveler.outcome, 'allowed');
});

test('routes generic workspace through the permission matrix', () => {
  assert.equal(coordinateWorkspaceRequest({ text: '工作台', identityInput: identity(['tenant_admin']), routes }).targetIntent, 'admin_dashboard');
  assert.equal(coordinateWorkspaceRequest({ text: '工作台', identityInput: identity([], { distributorProfile: { status: 'approved' } }), routes }).targetIntent, 'partner_workspace');
  assert.equal(coordinateWorkspaceRequest({ text: '工作台', identityInput: identity(['member']), routes }).targetIntent, 'traveler_workspace');
  assert.equal(coordinateWorkspaceRequest({ text: '工作台', identityInput: identity(['finance']), routes }).outcome, 'forbidden');
});

test('rejects a role that does not match the requested workspace', () => {
  const result = coordinateWorkspaceRequest({
    text: '業務專區',
    identityInput: identity(['member']),
    routes
  });
  assert.deepEqual(result, {
    handled: true,
    outcome: 'forbidden',
    responseText: '目前沒有權限使用此工作台。'
  });
});

test('fails closed when routes are missing or unsafe', () => {
  const missing = { ...routes };
  delete missing.customers;
  const unsafe = { ...routes, orders: 'http://example.com/orders' };
  for (const testRoutes of [missing, unsafe]) {
    assert.deepEqual(coordinateWorkspaceRequest({
      text: '業務專區',
      identityInput: identity([], { distributorProfile: { status: 'approved' } }),
      routes: testRoutes
    }), {
      handled: true,
      outcome: 'configuration_error',
      responseText: '工作台目前無法開啟，請稍後再試。'
    });
  }
});

test('does not expose text, UID, or identity profiles', () => {
  const rawText = '儀表板';
  const rawUid = 'U-test';
  const result = coordinateWorkspaceRequest({
    text: rawText,
    identityInput: identity(['platform_admin'], {
      distributorProfile: { id: 'private-distributor' },
      customerProfile: { id: 'private-customer' }
    }),
    routes
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(rawText), false);
  assert.equal(serialized.includes(rawUid), false);
  assert.equal(serialized.includes('private-distributor'), false);
  assert.equal(serialized.includes('private-customer'), false);
  assert.equal(serialized.includes('membership'), false);
});

test('handles null and undefined requests safely', () => {
  assert.deepEqual(coordinateWorkspaceRequest(null), { handled: false, outcome: 'not_workspace_intent' });
  assert.deepEqual(coordinateWorkspaceRequest(undefined), { handled: false, outcome: 'not_workspace_intent' });
});

test('accepts a safe pre-resolved identity from the webhook identity adapter', () => {
  const result = coordinateWorkspaceRequest({
    text: '儀表板',
    resolvedIdentity: resolvedIdentity(['tenant_admin']),
    routes
  });
  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'allowed');
  assert.equal(result.targetIntent, 'admin_dashboard');
  assert.equal(result.message.type, 'flex');
});

test('preserves guest and unassigned outcomes for pre-resolved identities', () => {
  assert.equal(coordinateWorkspaceRequest({
    text: '工作台',
    resolvedIdentity: resolvedIdentity([], 'guest'),
    routes
  }).outcome, 'login_required');
  assert.equal(coordinateWorkspaceRequest({
    text: '工作台',
    resolvedIdentity: resolvedIdentity([], 'unassigned'),
    routes
  }).outcome, 'forbidden');
});

test('fails closed for malformed or ambiguous resolved identity input', () => {
  const invalidInputs = [
    { tenantSlug: 'demo', roles: ['tenant_admin'], primaryRole: 'traveler' },
    { tenantSlug: 'demo', roles: ['administrator'], primaryRole: 'administrator' },
    { tenantSlug: 'demo', roles: ['tenant_admin', 'tenant_admin'], primaryRole: 'tenant_admin' },
    { tenantSlug: '', roles: [], primaryRole: 'unassigned' },
    { tenantSlug: 'demo', roles: ['tenant_admin'], primaryRole: 'tenant_admin', membership: { role: 'admin' } }
  ];
  for (const value of invalidInputs) {
    assert.equal(coordinateWorkspaceRequest({
      text: '工作台',
      resolvedIdentity: value,
      routes
    }).outcome, 'configuration_error');
  }

  assert.equal(coordinateWorkspaceRequest({
    text: '工作台',
    identityInput: identity(['tenant_admin']),
    resolvedIdentity: resolvedIdentity(['tenant_admin']),
    routes
  }).outcome, 'configuration_error');
});

test('unknown intent returns to the existing flow before identity evaluation', () => {
  assert.deepEqual(coordinateWorkspaceRequest({
    text: '一般旅遊問題',
    resolvedIdentity: { unsafe: true },
    routes
  }), { handled: false, outcome: 'not_workspace_intent' });
});

test('pre-resolved identity output never exposes identity details', () => {
  const result = coordinateWorkspaceRequest({
    text: '工作台',
    resolvedIdentity: resolvedIdentity(['partner', 'traveler']),
    routes
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.targetIntent, 'partner_workspace');
  assert.doesNotMatch(serialized, /tenantSlug|primaryRole|"roles"|demo/);
});
