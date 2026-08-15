import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const MONEY_PATHS = [
  'lib/platform-settlement-api.js',
  'lib/settlement-finance-api.js',
  'lib/platform-settlement-customer-view-api.js',
  'lib/settlement-payment-control-api.js',
];

test('settlement and payout logic never uses customer owner or original referrer as money authority', async () => {
  for (const path of MONEY_PATHS) {
    const source = await read(path);
    assert.doesNotMatch(source, /\bowner_uid\b/, `${path} must not use owner_uid as settlement authority`);
    assert.doesNotMatch(source, /\bref_uid\b/, `${path} must not use ref_uid as settlement authority`);
  }
});

test('commission settlement keeps per-order distributor attribution visible in both platform and finance flows', async () => {
  const platform = await read('lib/platform-settlement-api.js');
  const finance = await read('lib/settlement-finance-api.js');

  assert.match(platform, /\bdistributor_uid\b/);
  assert.match(finance, /\bdistributor_uid\b/);
  assert.match(platform, /\borders\b/i);
  assert.match(finance, /\borders\b/i);
});

test('attribution dimensions remain intentionally separate from money settlement', async () => {
  const booking = await read('lib/tenant-booking-api.js');
  const migration = await read('migrations/0115_attribution_contract_v1.sql');

  assert.match(booking, /orderInsert/);
  assert.match(booking, /distributorUid/);
  assert.match(migration, /ALTER TABLE customers ADD COLUMN ref_uid/);
  assert.match(migration, /owner_uid/);

  // Contract: referrer and service owner belong to customer/CRM attribution,
  // while historical commission ownership remains on each order's distributor.
  assert.doesNotMatch(migration, /UPDATE\s+orders[\s\S]*ref_uid/i);
  assert.doesNotMatch(migration, /UPDATE\s+orders[\s\S]*owner_uid/i);
});
