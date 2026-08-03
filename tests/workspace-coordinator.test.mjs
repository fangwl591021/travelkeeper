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
