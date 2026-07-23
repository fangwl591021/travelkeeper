import test from 'node:test';
import assert from 'node:assert/strict';

import { signReferralToken, verifyReferralToken } from '../lib/referral-token.js';

const secret = 'staging-and-production-referral-secret-32-bytes';
const claims = {
  tenant_slug: 'partner-a',
  itinerary_id: 'TOUR-1',
  distributor_uid: 'U-SALES',
  invite_code: 'ABC123',
};
const clock = Date.parse('2026-07-23T00:00:00.000Z');

test('referral token is deterministic for fixed claims and clock except jti', async () => {
  const first = await signReferralToken(secret, { ...claims, jti: 'JTI-1' }, clock);
  const second = await signReferralToken(secret, { ...claims, jti: 'JTI-1' }, clock);
  assert.equal(first, second);
  const verified = await verifyReferralToken(secret, first, claims, clock);
  assert.equal(verified.ok, true);
  assert.equal(verified.claims.tenant_slug, 'partner-a');
});

test('referral token rejects tampering and context mismatch', async () => {
  const token = await signReferralToken(secret, { ...claims, jti: 'JTI-2' }, clock);
  const [payload, signature] = token.split('.');
  const tampered = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`;
  assert.equal((await verifyReferralToken(secret, tampered, claims, clock)).error, 'INVALID_REFERRAL_TOKEN');
  assert.equal((await verifyReferralToken(secret, token, { ...claims, tenant_slug: 'tenant-b' }, clock)).error, 'REFERRAL_TOKEN_CONTEXT_MISMATCH');
});

test('referral token rejects expired and future-issued tokens', async () => {
  const token = await signReferralToken(secret, { ...claims, ttl_seconds: 300, jti: 'JTI-3' }, clock);
  assert.equal((await verifyReferralToken(secret, token, claims, clock + 301000)).error, 'EXPIRED_REFERRAL_TOKEN');
  const future = await signReferralToken(secret, { ...claims, jti: 'JTI-4' }, clock + 120000);
  assert.equal((await verifyReferralToken(secret, future, claims, clock)).error, 'EXPIRED_REFERRAL_TOKEN');
});

test('referral token fails closed without a signing secret', async () => {
  assert.equal((await verifyReferralToken('', 'x.y', claims, clock)).error, 'REFERRAL_SIGNING_NOT_CONFIGURED');
  await assert.rejects(() => signReferralToken('', claims, clock), /REFERRAL_SIGNING_NOT_CONFIGURED/);
});