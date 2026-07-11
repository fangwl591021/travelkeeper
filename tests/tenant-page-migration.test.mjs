import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Phase 10 Worker routes tenant page APIs before the generic V2 router', async () => {
  const worker = await read('worker-tenant.js');
  assert.match(worker, /tenant-order-actions-api/);
  assert.match(worker, /tenant-profile-api/);
  assert.match(worker, /tenant-distributor-api/);
  assert.ok(worker.indexOf('isTenantOrderActionRequest(request)') < worker.indexOf('isTenantApiRequest(request)'));
  assert.match(worker, /X-TravelKeeper-Tenant-Isolation', 'phase10'/);
});

test('shared page client uses tenant Bearer APIs and normalizes legacy views', async () => {
  const source = await read('js/tenant-page-client.js');
  assert.match(source, /initLiffSession/);
  assert.match(source, /\/api\/v2\/orders/);
  assert.match(source, /\/api\/v2\/orders\/\$\{encodeURIComponent\(orderId\)\}/);
  assert.doesNotMatch(source, /api\/orders\/status\?order_id/);
  assert.match(source, /\/api\/v2\/customers/);
  assert.match(source, /\/api\/v2\/tenant\/profile/);
  assert.match(source, /\/api\/v2\/distributors/);
  assert.match(source, /contact_phone \|\| row\.customer_phone/);
  assert.doesNotMatch(source, /dev_uid.*DEFAULT_WORKER_URL/s);
});

test('canonical dashboard loads tenant clients and no longer uses uid-only core customer/order calls', async () => {
  const page = await read('dashboard.html');
  assert.match(page, /tenant-api-client\.js/);
  assert.match(page, /tenant-page-client\.js/);
  assert.match(page, /tenantPage\.initLiffSession/);
  assert.match(page, /tenantPage\.listOrders/);
  assert.match(page, /tenantPage\.listCustomers/);
  assert.match(page, /tenantPage\.markBalancePaid/);
  assert.match(page, /tenantPage\.updateDistributorStatus/);
  assert.doesNotMatch(page, /api\/my\/customers\?uid=/);
  assert.doesNotMatch(page, /action=getUserOrders&uid=\$\{userId\}/);
  assert.doesNotMatch(page, /action:'updateOrderStatus'/);
});

test('old admin page redirects to the canonical tenant dashboard', async () => {
  const page = await read('admin.html');
  assert.match(page, /dashboard\.html/);
  assert.match(page, /location\.replace/);
  assert.doesNotMatch(page, /action=getAllOrders/);
});

test('CRM combines tenant customer/order APIs and keeps global LINE CRM demo-only', async () => {
  const page = await read('crm.html');
  assert.match(page, /tenantPage\.listCustomers/);
  assert.match(page, /tenantPage\.listOrders/);
  assert.match(page, /tenantSlug === 'demo'/);
  assert.match(page, /tenantPage\.initLiffSession/);
});

test('customer payment pages require tenant LIFF authentication', async () => {
  const balance = await read('Pay balance.html');
  const thanks = await read('Thank you.html');
  for (const page of [balance, thanks]) {
    assert.match(page, /tenant-api-client\.js/);
    assert.match(page, /tenant-page-client\.js/);
    assert.match(page, /tenantPage\.initLiffSession/);
    assert.match(page, /tenantPage\.getOrderStatus/);
  }
  assert.match(balance, /tenantPage\.createPayment\(orderId, 'balance'\)/);
  assert.doesNotMatch(thanks, /fetch\(`\$\{WORKER_URL\}\/api\/orders\/status/);
});

test('model page uses tenant public itineraries and tenant staff APIs', async () => {
  const page = await read('model.html');
  assert.match(page, /tenantPage\.initLiffSession/);
  assert.match(page, /tenantPage\.localDev && tenantPage\.devUid/);
  assert.match(page, /tenantPage\.listPublicItineraries/);
  assert.match(page, /tenantPage\.listDistributors/);
  assert.match(page, /tenantPage\.updateProfile/);
  assert.match(page, /tenant=\$\{encodeURIComponent\(tenantSlug\)\}/);
});

test('tenant order, profile and distributor modules are tenant scoped', async () => {
  const order = await read('lib/tenant-order-actions-api.js');
  const profile = await read('lib/tenant-profile-api.js');
  const distributors = await read('lib/tenant-distributor-api.js');
  const tenantApi = await read('lib/tenant-api.js');
  assert.match(order, /WHERE tenant_slug = \? AND order_id = \?/);
  assert.match(tenantApi, /WHERE tenant_slug = \? AND order_id = \?/);
  assert.match(tenantApi, /customer_line_uid === context\.userUid/);
  assert.match(profile, /ON CONFLICT\(tenant_slug, user_uid\)/);
  assert.match(distributors, /WHERE m\.tenant_slug = \?/);
});
