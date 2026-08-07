import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_ERROR, resolveWorkspaceWebhookRoutes } from '../lib/workspace-webhook-route-adapter.js';

test('builds only approved tenant-scoped HTTPS routes', () => {
  const routes = resolveWorkspaceWebhookRoutes({
    appBaseUrl: 'https://example.com/travelkeeper/', tenantSlug: 'partner-a'
  });
  assert.deepEqual(routes, {
    orders: 'https://example.com/travelkeeper/dashboard.html?tenant=partner-a#orders',
    pendingItineraries: 'https://example.com/travelkeeper/dashboard.html?tenant=partner-a#review',
    customers: 'https://example.com/travelkeeper/dashboard.html?tenant=partner-a#customers',
    promotions: 'https://example.com/travelkeeper/dashboard.html?tenant=partner-a#promote',
    lineMonitor: 'https://example.com/travelkeeper/line-oa-monitor.html?tenant=partner-a'
  });
});

test('does not fallback to demo when tenant is missing or invalid', () => {
  for (const tenantSlug of ['', 'demo/', 'tenant-', 'Tenant']) {
    assert.throws(() => resolveWorkspaceWebhookRoutes({
      appBaseUrl: 'https://example.com/', tenantSlug
    }), new RegExp(ADAPTER_ERROR));
  }
});

test('rejects unsafe app base URLs without exposing details', () => {
  for (const appBaseUrl of ['', 'http://example.com/', 'https://user:pass@example.com/', 'https://example.com/?x=1']) {
    assert.throws(() => resolveWorkspaceWebhookRoutes({ appBaseUrl, tenantSlug: 'acme' }),
      new RegExp(ADAPTER_ERROR));
  }
});

test('rejects request-shaped and credential-shaped inputs', () => {
  for (const extra of [{ request: {} }, { query: {} }, { header: {} }, { token: 'secret' }]) {
    assert.throws(() => resolveWorkspaceWebhookRoutes({
      appBaseUrl: 'https://example.com/', tenantSlug: 'acme', ...extra
    }), new RegExp(ADAPTER_ERROR));
  }
});

test('errors are stable and do not include tenant or app base values', () => {
  assert.throws(() => resolveWorkspaceWebhookRoutes({
    appBaseUrl: 'http://private.example/', tenantSlug: 'private-tenant'
  }), (error) => error.message === ADAPTER_ERROR && !/private/.test(error.message));
});
