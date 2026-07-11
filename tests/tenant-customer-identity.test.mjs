import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../migrations/0108_tenant_customer_identity.sql', import.meta.url);
const bookingUrl = new URL('../lib/tenant-booking-api.js', import.meta.url);
const tenantApiUrl = new URL('../lib/tenant-api.js', import.meta.url);
const settlementViewUrl = new URL('../lib/platform-settlement-customer-view-api.js', import.meta.url);
const workerUrl = new URL('../worker-tenant.js', import.meta.url);

test('customer identity migration keeps legacy relations and adds tenant uniqueness', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /ALTER TABLE customers ADD COLUMN customer_id/);
  assert.match(migration, /ALTER TABLE customers ADD COLUMN contact_phone/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_contact_phone/);
  assert.match(migration, /ALTER TABLE orders ADD COLUMN customer_id/);
  assert.match(migration, /ALTER TABLE orders ADD COLUMN contact_phone/);
  assert.match(migration, /TENANT_MISMATCH:order_customer/);
});

test('booking no longer rejects a phone because another tenant used the legacy key', async () => {
  const source = await readFile(bookingUrl, 'utf8');
  assert.doesNotMatch(source, /CUSTOMER_PHONE_TENANT_CONFLICT/);
  assert.match(source, /customerIdentityId/);
  assert.match(source, /contact_phone/);
  assert.match(source, /customer_id/);
  assert.match(source, /await env\.DB\.batch\(\[customerWrite\.statement, orderInsert\]\)/);
});

test('tenant V2 APIs expose contact phone while retaining an internal relation key', async () => {
  const source = await readFile(tenantApiUrl, 'utf8');
  assert.match(source, /customer_key: row\.customer_phone/);
  assert.match(source, /customer_phone: row\.contact_phone \|\| row\.customer_phone/);
  assert.match(source, /COALESCE\(NULLIF\(contact_phone, ''\), customer_phone\)/);
  assert.match(source, /o\.customer_id/);
  assert.match(source, /COALESCE\(NULLIF\(o\.contact_phone, ''\), o\.customer_phone\) AS customer_phone/);
});

test('settlement payables expose actual contact phone instead of the relation key', async () => {
  const source = await readFile(settlementViewUrl, 'utf8');
  assert.match(source, /COALESCE\(NULLIF\(o\.contact_phone, ''\), o\.customer_phone\) AS customer_phone/);
  assert.match(source, /o\.customer_id/);
  assert.doesNotMatch(source, /o\.customer_phone,\s*o\.distributor_uid/);
});

test('customer-safe settlement route runs before the legacy settlement router', async () => {
  const source = await readFile(workerUrl, 'utf8');
  const safeIndex = source.indexOf('isPlatformSettlementCustomerViewRequest');
  const legacyIndex = source.indexOf('isPlatformSettlementApiRequest(request)');
  assert.ok(safeIndex >= 0);
  assert.ok(legacyIndex > safeIndex);
  assert.match(source, /X-TravelKeeper-Tenant-Isolation', 'phase13'/);
});
