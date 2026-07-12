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
  assert.match(migration, /FOREIGN KEY \(batch_id\) REFERENCES platform_collection_batches\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /CREATE TRIGGER/);
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


test('finance API writes reveal audit events to the tenant-scoped audit log', async () => {
  const source = await readFile(new URL('../lib/settlement-finance-api.js', import.meta.url), 'utf8');
  assert.match(source, /INSERT INTO audit_logs/);
  assert.match(source, /payout_account\.reveal/);
  assert.doesNotMatch(source, /INSERT INTO tenant_audit_logs/);
});
test('settlement browser local mode is restricted to localhost workers', async () => {
  const source = await readFile(new URL('../js/settlement-finance-client.js', import.meta.url), 'utf8');
  assert.match(source, /new Set\(\['localhost', '127\.0\.0\.1', '\[::1\]'\]\)/);
  assert.match(source, /localDev && devUid/);
  assert.match(source, /ALLOW_LEGACY_UID_AUTH=1/);
  assert.doesNotMatch(source, /dev_uid.*tenantApi\.DEFAULT_WORKER_URL/s);
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

test('dashboard exposes settlement reports only to admin users with tenant context', async () => {
  const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
  assert.match(dashboard, /id:'settlements'/);
  assert.match(dashboard, /href:`settlements\.html\?tenant=\$\{encodeURIComponent/);
  assert.match(dashboard, /show: isAdmin/);
});
