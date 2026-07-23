import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSettlementPaymentControls,
} from '../lib/settlement-payment-control-api.js';
import { statusForError } from '../lib/http-error-status.js';

test('settlement payment controls default off for backward compatibility', () => {
  assert.deepEqual(normalizeSettlementPaymentControls({}), {
    require_verified_account: false,
    require_payout_proof: false,
  });
  assert.deepEqual(normalizeSettlementPaymentControls({
    require_verified_account: 1,
    require_payout_proof: '1',
  }), {
    require_verified_account: true,
    require_payout_proof: true,
  });
});

test('migration adds optional verified-account and payout-proof guards', async () => {
  const migration = await readFile(
    new URL('../migrations/0107_settlement_payment_controls.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /require_verified_account INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /require_payout_proof INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \(require_verified_account IN \(0, 1\)\)/);
  assert.match(migration, /CHECK \(require_payout_proof IN \(0, 1\)\)/);
});

test('guard checks verified payout account and active private proof before payment', async () => {
  const source = await readFile(
    new URL('../lib/settlement-payment-control-api.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /verification_status = 'verified'/);
  assert.match(source, /enabled = 1/);
  assert.match(source, /platform_collection_batch_proofs/);
  assert.match(source, /deleted_at IS NULL OR deleted_at = ''/);
  assert.match(source, /PAYOUT_ACCOUNT_NOT_VERIFIED/);
  assert.match(source, /SETTLEMENT_PROOF_REQUIRED/);
  assert.match(source, /payout_account_last4 = COALESCE/);
});

test('guarded paid route is evaluated before the generic settlement router', async () => {
  const worker = await readFile(new URL('../worker-tenant.js', import.meta.url), 'utf8');
  const guardIndex = worker.indexOf('isSettlementPaymentControlApiRequest(request)');
  const genericIndex = worker.indexOf('isPlatformSettlementApiRequest(request)');
  assert.equal(guardIndex >= 0, true);
  assert.equal(genericIndex >= 0, true);
  assert.equal(guardIndex < genericIndex, true);
  assert.match(worker, /X-TravelKeeper-Tenant-Isolation', 'phase13'/);
});

test('control errors use conflict status instead of authentication status', () => {
  assert.equal(statusForError('PAYOUT_ACCOUNT_NOT_VERIFIED'), 409);
  assert.equal(statusForError('SETTLEMENT_PROOF_REQUIRED'), 409);
});

test('browser finance client exposes per-tenant control APIs', async () => {
  const source = await readFile(
    new URL('../js/settlement-finance-client.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /getPaymentControls\(tenantSlug\)/);
  assert.match(source, /updatePaymentControls\(data, tenantSlug\)/);
  assert.match(source, /\/api\/v2\/platform-settlements\/controls/);
  assert.match(source, /SETTLEMENT_PROOF_REQUIRED/);
});

test('settlement report page exposes minimal payment control UI', async () => {
  const page = await readFile(new URL('../settlements.html', import.meta.url), 'utf8');
  assert.match(page, /financeApi\.getPaymentControls\(tenantSlug\)/);
  assert.match(page, /financeApi\.updatePaymentControls/);
  assert.match(page, /require_verified_account/);
  assert.match(page, /require_payout_proof/);
  assert.match(page, /state\.context\?\.role === 'platform_admin'/);
  assert.doesNotMatch(page, /account_ciphertext/);
  assert.doesNotMatch(page, /account_iv/);
  assert.doesNotMatch(page, /storage_key/);
});
