import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceRouteRegistry } from '../lib/workspace-route-registry.js';

test('builds the five approved routes with tenant query and optional hash', () => {
  const routes = buildWorkspaceRouteRegistry({
    appBaseUrl: 'https://example.com/',
    tenantSlug: 'demo'
  });

  assert.deepEqual(Object.keys(routes).sort(), [
    'customers',
    'orders',
    'pendingItineraries',
    'promotions',
    'lineMonitor'
  ].sort());
  assert.equal(routes.orders, 'https://example.com/dashboard.html?tenant=demo#orders');
  assert.equal(routes.pendingItineraries, 'https://example.com/dashboard.html?tenant=demo#review');
  assert.equal(routes.customers, 'https://example.com/dashboard.html?tenant=demo#customers');
  assert.equal(routes.promotions, 'https://example.com/dashboard.html?tenant=demo#promote');
  assert.equal(routes.lineMonitor, 'https://example.com/line-oa-monitor.html?tenant=demo');
  for (const [key, value] of Object.entries(routes)) {
    const url = new URL(value);
    assert.equal(url.searchParams.get('tenant'), 'demo');
    assert.equal(url.searchParams.has('uid'), false);
    assert.equal(url.searchParams.has('dev_uid'), false);
    assert.equal(url.searchParams.has('token'), false);
    if (key === 'lineMonitor') assert.equal(url.hash, '');
    else assert.ok(value.indexOf('?tenant=demo') < value.indexOf('#'));
  }
});

test('supports an app base URL with a subdirectory', () => {
  const routes = buildWorkspaceRouteRegistry({
    appBaseUrl: 'https://example.com/travelkeeper/',
    tenantSlug: 'tenant-01'
  });
  assert.equal(routes.orders, 'https://example.com/travelkeeper/dashboard.html?tenant=tenant-01#orders');
  assert.equal(routes.lineMonitor, 'https://example.com/travelkeeper/line-oa-monitor.html?tenant=tenant-01');
});

for (const appBaseUrl of [
  '',
  'http://example.com/',
  'javascript:alert(1)/',
  'data:text/plain,blocked/',
  'https://example.com',
  'https://user:password@example.com/',
  'https://example.com/?source=test',
  'https://example.com/#existing'
]) {
  test(`rejects unsafe base URL: ${appBaseUrl || '(empty)'}`, () => {
    assert.throws(() => buildWorkspaceRouteRegistry({ appBaseUrl, tenantSlug: 'demo' }));
  });
}

for (const tenantSlug of ['', '   ', 'Demo', 'tenant_slug', 'tenant slug', '-tenant', 'tenant-', 'tenant!']) {
  test(`rejects invalid tenant slug: ${tenantSlug || '(empty)'}`, () => {
    assert.throws(() => buildWorkspaceRouteRegistry({
      appBaseUrl: 'https://example.com/',
      tenantSlug
    }), /TENANT_SLUG/);
  });
}

test('does not fallback to demo and does not produce unapproved routes', () => {
  assert.throws(() => buildWorkspaceRouteRegistry({ appBaseUrl: 'https://example.com/' }), /TENANT_SLUG_REQUIRED/);
  const routes = buildWorkspaceRouteRegistry({ appBaseUrl: 'https://example.com/', tenantSlug: 'tenant' });
  assert.equal('lineMonitor' in routes, true);
  assert.equal('reservations' in routes, false);
  assert.equal('itineraries' in routes, false);
  assert.equal('support' in routes, false);
});
