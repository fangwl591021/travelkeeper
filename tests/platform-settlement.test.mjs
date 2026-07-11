import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  calculateSettlementAmounts,
  settlementEligibleAt,
} from '../lib/platform-settlement-api.js';
import { statusForError } from '../lib/http-error-status.js';

test('settlement calculation deducts gateway, platform and reserve amounts once', () => {
  const result = calculateSettlementAmounts(10000, {
    gateway_fee_rate: 2.8,
    gateway_fee_fixed: 10,
    platform_fee_rate: 5,
    platform_fee_fixed: 20,
    reserve_rate: 10,
  });

  assert.deepEqual(result, {
    grossAmount: 10000,
    gatewayFeeAmount: 290,
    platformFeeAmount: 520,
    reserveAmount: 1000,
    payableAmount: 8190,
  });
});

test('settlement calculation never produces a negative payable', () => {
  const result = calculateSettlementAmounts(100, {
    gateway_fee_rate: 100,
    gateway_fee_fixed: 999,
    platform_fee_rate: 100,
    platform_fee_fixed: 999,
    reserve_rate: 100,
  });

  assert.equal(result.grossAmount, 100);
  assert.equal(result.gatewayFeeAmount, 100);
  assert.equal(result.platformFeeAmount, 0);
  assert.equal(result.reserveAmount, 0);
  assert.equal(result.payableAmount, 0);
});

test('settlement eligibility adds the configured UTC hold period', () => {
  assert.equal(
    settlementEligibleAt('2026-07-11T00:00:00.000Z', 7),
    '2026-07-18T00:00:00.000Z',
  );
});

test('tenant API errors return precise HTTP status classes', () => {
  assert.equal(statusForError('AUTH_REQUIRED'), 401);
  assert.equal(statusForError('TENANT_ROLE_DENIED'), 403);
  assert.equal(statusForError('ORDER_NOT_FOUND'), 404);
  assert.equal(statusForError('TENANT_GATEWAY_NOT_CONFIGURED'), 409);
  assert.equal(statusForError('INVALID_HASH_KEY_LENGTH'), 400);
  assert.equal(statusForError('TENANT_PAYMENT_MASTER_KEY_MISSING'), 503);
});

test('platform principal settlement stays separate from sales commission payout', async () => {
  const source = await readFile(new URL('../lib/platform-settlement-api.js', import.meta.url), 'utf8');
  assert.equal(source.includes('commission_amount'), false);
  assert.equal(source.includes('commission_status'), false);
});

test('settlement schema enforces tenant-scoped unique payment attempts and batches', async () => {
  const migration = await readFile(new URL('../migrations/0104_platform_collection_settlements.sql', import.meta.url), 'utf8');
  assert.match(migration, /UNIQUE \(tenant_slug, payment_attempt_id\)/);
  assert.match(migration, /platform_collection_batch_items/);
  assert.match(migration, /FOREIGN KEY \(tenant_slug\) REFERENCES tenants/);
});
