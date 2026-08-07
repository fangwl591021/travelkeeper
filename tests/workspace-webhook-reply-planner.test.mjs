import test from 'node:test';
import assert from 'node:assert/strict';
import { planWorkspaceWebhookReply } from '../lib/workspace-webhook-reply-planner.js';

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

function createDb(rows = {}, error = null) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      if (error) throw error;
      const table = sql.match(/FROM\s+([a-z_]+)/i)?.[1] || '';
      return {
        bind(...values) {
          calls.push({ table, values });
          return { async first() { return rows[table] ?? null; } };
        }
      };
    }
  };
}

test('unknown intent returns no reply plan and does not query D1', async () => {
  const database = createDb();
  const result = await planWorkspaceWebhookReply({
    env: { DB: database },
    tenantSlug: 'acme',
    verifiedUserUid: 'U1',
    text: '我想詢問日本旅遊',
    routes
  });
  assert.deepEqual(result, {
    handled: false,
    outcome: 'not_workspace_intent',
    replyPlan: null
  });
  assert.equal(database.calls.length, 0);
});

test('tenant admin receives one admin Flex reply plan', async () => {
  const result = await planWorkspaceWebhookReply({
    env: { DB: createDb({ tenant_memberships: { role: 'tenant_admin', status: 'active' } }) },
    tenantSlug: 'acme',
    verifiedUserUid: 'U-admin',
    text: '儀表板',
    routes
  });
  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'allowed');
  assert.equal(result.targetIntent, 'admin_dashboard');
  assert.equal(result.replyPlan.messages.length, 1);
  assert.equal(result.replyPlan.messages[0].type, 'flex');
});

test('partner and traveler receive their permitted Flex reply plans', async () => {
  const partner = await planWorkspaceWebhookReply({
    env: { DB: createDb({ tenant_distributor_profiles: { status: 'approved' } }) },
    tenantSlug: 'acme',
    verifiedUserUid: 'U-partner',
    text: '業務專區',
    routes
  });
  const traveler = await planWorkspaceWebhookReply({
    env: { DB: createDb({ tenant_crm_profiles: { status: 'open' } }) },
    tenantSlug: 'acme',
    verifiedUserUid: 'U-traveler',
    text: '我的行程',
    routes
  });
  assert.equal(partner.targetIntent, 'partner_workspace');
  assert.equal(partner.replyPlan.messages.length, 1);
  assert.equal(traveler.targetIntent, 'traveler_workspace');
  assert.equal(traveler.replyPlan.messages.length, 1);
});

test('guest receives one login-required text plan without querying D1', async () => {
  const database = createDb();
  const result = await planWorkspaceWebhookReply({
    env: { DB: database },
    tenantSlug: 'acme',
    verifiedUserUid: '',
    text: '工作台',
    routes
  });
  assert.equal(result.outcome, 'login_required');
  assert.deepEqual(result.replyPlan.messages, [{
    type: 'text',
    text: '請先完成 LINE 登入，再開啟工作台。'
  }]);
  assert.equal(database.calls.length, 0);
});

test('authenticated unassigned member receives one forbidden text plan', async () => {
  const result = await planWorkspaceWebhookReply({
    env: { DB: createDb() },
    tenantSlug: 'acme',
    verifiedUserUid: 'U-unassigned',
    text: '工作台',
    routes
  });
  assert.equal(result.outcome, 'forbidden');
  assert.equal(result.replyPlan.messages.length, 1);
  assert.equal(result.replyPlan.messages[0].type, 'text');
});

test('identity lookup failure returns one sanitized configuration-error plan', async () => {
  const result = await planWorkspaceWebhookReply({
    env: { DB: createDb({}, new Error('private D1 SQL U-secret token')) },
    tenantSlug: 'acme',
    verifiedUserUid: 'U-secret',
    text: '工作台',
    routes
  });
  assert.equal(result.outcome, 'configuration_error');
  assert.equal(result.replyPlan.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /U-secret|private D1|SQL|token/i);
});

test('invalid tenant and unsafe routes fail closed with one text plan', async () => {
  const invalidTenant = await planWorkspaceWebhookReply({
    env: { DB: createDb() },
    tenantSlug: 'tenant-',
    verifiedUserUid: 'U1',
    text: '工作台',
    routes
  });
  const unsafeRoutes = await planWorkspaceWebhookReply({
    env: { DB: createDb({ tenant_memberships: { role: 'tenant_admin', status: 'active' } }) },
    tenantSlug: 'acme',
    verifiedUserUid: 'U2',
    text: '儀表板',
    routes: { ...routes, orders: 'http://example.com/orders' }
  });
  for (const result of [invalidTenant, unsafeRoutes]) {
    assert.equal(result.outcome, 'configuration_error');
    assert.equal(result.replyPlan.messages.length, 1);
    assert.equal(result.replyPlan.messages[0].type, 'text');
  }
});

test('rejects request event replyToken and credential-shaped inputs', async () => {
  for (const extra of [
    { request: {} },
    { event: {} },
    { replyToken: 'secret' },
    { channelAccessToken: 'secret' }
  ]) {
    const result = await planWorkspaceWebhookReply({
      env: { DB: createDb() },
      tenantSlug: 'acme',
      verifiedUserUid: 'U1',
      text: '工作台',
      routes,
      ...extra
    });
    assert.equal(result.outcome, 'configuration_error');
    assert.equal(result.replyPlan.messages.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /secret/i);
  }
});

test('every handled outcome contains at most one message and no sensitive input', async () => {
  const result = await planWorkspaceWebhookReply({
    env: { DB: createDb({ tenant_memberships: { role: 'platform_admin', status: 'active' } }) },
    tenantSlug: 'private-tenant',
    verifiedUserUid: 'U-private',
    text: '管理工作台',
    routes
  });
  assert.equal(result.replyPlan.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /U-private|private-tenant|replyToken|channelAccessToken/i);
});
