import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  maskBankAccount,
  settlementProofStorageKey,
  validateProofMetadata,
} from '../lib/settlement-finance-api.js';
import { statusForError } from '../lib/http-error-status.js';

test('bank accounts are masked to the final four digits', () => {
  const masked = maskBankAccount('012-345-678901');
  assert.equal(masked.endsWith('8901'), true);
  assert.equal(masked.includes('012345'), false);
  assert.equal(masked.length >= 8, true);
});

test('settlement proof object keys remain private and tenant scoped', () => {
  const key = settlementProofStorageKey('partner-a', 'BATCH-1', 'PROOF-1', '匯款 證明.pdf');
  assert.match(key, /^private\/settlement-proofs\/partner-a\/BATCH-1\/PROOF-1-/);
  assert.match(key, /\.pdf$/);
  assert.equal(key.includes('../'), false);
});

test('proof metadata only accepts supported private document formats and size limits', () => {
  assert.equal(validateProofMetadata('application/pdf', 1024), true);
  assert.equal(validateProofMetadata('image/jpeg', 8 * 1024 * 1024), true);
  assert.equal(validateProofMetadata('text/html', 1024), false);
  assert.equal(validateProofMetadata('application/pdf', 8 * 1024 * 1024 + 1), false);
});

test('settlement finance errors use precise HTTP status classes', () => {
  assert.equal(statusForError('PAYOUT_ACCOUNT_NOT_FOUND'), 404);
  assert.equal(statusForError('PAYOUT_ACCOUNT_NOT_VERIFIED'), 409);
  assert.equal(statusForError('INVALID_BANK_ACCOUNT'), 400);
  assert.equal(statusForError('PROOF_FILE_TOO_LARGE'), 413);
  assert.equal(statusForError('R2_REQUIRED'), 503);
});

test('migration stores encrypted accounts and enforces proof tenant matching', async () => {
  const migration = await readFile(new URL('../migrations/0106_settlement_accounts_and_proofs.sql', import.meta.url), 'utf8');
  assert.match(migration, /account_ciphertext TEXT NOT NULL/);
  assert.match(migration, /account_iv TEXT NOT NULL/);
  assert.doesNotMatch(migration, /account_number TEXT/);
  assert.match(migration, /TENANT_MISMATCH: settlement proof batch/);
  assert.match(migration, /payout_account_last4/);
});

test('finance API keeps proof files in authenticated R2 routes', async () => {
  const source = await readFile(new URL('../lib/settlement-finance-api.js', import.meta.url), 'utf8');
  assert.match(source, /private\/settlement-proofs/);
  assert.match(source, /Cache-Control', 'private, no-store/);
  assert.match(source, /requireContext\(request, env, \['platform_admin', 'tenant_admin', 'finance'\]\)/);
  assert.match(source, /encryptTenantGatewaySecrets/);
  assert.match(source, /payout_account\.reveal/);
});

test('settlement report page uses tenant authentication and never embeds account secrets', async () => {
  const page = await readFile(new URL('../settlements.html', import.meta.url), 'utf8');
  assert.match(page, /tenantApi\.getContext\(tenantSlug\)/);
  assert.match(page, /financeApi\.getReport\(tenantSlug/);
  assert.match(page, /financeApi\.fetchProofBlob/);
  assert.doesNotMatch(page, /account_ciphertext/);
  assert.doesNotMatch(page, /account_iv/);

  const inlineScripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(inlineScripts.length > 0, true);
  for (const script of inlineScripts) new vm.Script(script);
});
