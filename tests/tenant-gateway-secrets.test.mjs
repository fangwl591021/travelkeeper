import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encryptTenantGatewaySecrets,
  decryptTenantGatewaySecrets,
  isPublicTenantGatewayRequest,
} from '../lib/tenant-gateway-api.js';

const env = {
  TENANT_PAYMENT_MASTER_KEY: 'local-test-master-key-that-is-longer-than-32-characters',
  TENANT_PAYMENT_KEY_VERSION: 'v1',
};

const credentials = {
  hashKey: '12345678901234567890123456789012',
  hashIv: '1234567890123456',
};

test('tenant gateway secrets round-trip through AES-GCM without plaintext storage', async () => {
  const encrypted = await encryptTenantGatewaySecrets(env, 'agency-b', 'newebpay', credentials);

  assert.equal(encrypted.keyVersion, 'v1');
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.equal(encrypted.ciphertext.includes(credentials.hashKey), false);
  assert.equal(encrypted.ciphertext.includes(credentials.hashIv), false);

  const decrypted = await decryptTenantGatewaySecrets(env, 'agency-b', 'newebpay', {
    secrets_ciphertext: encrypted.ciphertext,
    secrets_iv: encrypted.iv,
    key_version: encrypted.keyVersion,
  });
  assert.deepEqual(decrypted, credentials);
});

test('encrypted gateway secrets cannot be moved to another tenant', async () => {
  const encrypted = await encryptTenantGatewaySecrets(env, 'agency-b', 'newebpay', credentials);

  await assert.rejects(
    decryptTenantGatewaySecrets(env, 'agency-c', 'newebpay', {
      secrets_ciphertext: encrypted.ciphertext,
      secrets_iv: encrypted.iv,
      key_version: encrypted.keyVersion,
    }),
    /TENANT_GATEWAY_SECRET_DECRYPT_FAILED/,
  );
});

test('gateway secret encryption refuses missing or weak master keys', async () => {
  await assert.rejects(
    encryptTenantGatewaySecrets({}, 'agency-b', 'newebpay', credentials),
    /TENANT_PAYMENT_MASTER_KEY_MISSING/,
  );
  await assert.rejects(
    encryptTenantGatewaySecrets({ TENANT_PAYMENT_MASTER_KEY: 'too-short' }, 'agency-b', 'newebpay', credentials),
    /TENANT_PAYMENT_MASTER_KEY_WEAK/,
  );
});

test('tenant gateway notify and return routes are public callbacks', () => {
  assert.equal(
    isPublicTenantGatewayRequest(new Request('https://worker.example/api/v2/payments/notify/tenant/agency-b', { method: 'POST' })),
    true,
  );
  assert.equal(
    isPublicTenantGatewayRequest(new Request('https://worker.example/api/v2/payments/return/tenant/agency-b')),
    true,
  );
  assert.equal(
    isPublicTenantGatewayRequest(new Request('https://worker.example/api/v2/tenant/payment-gateway')),
    false,
  );
});
