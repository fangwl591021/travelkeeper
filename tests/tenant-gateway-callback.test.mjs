import test from 'node:test';
import assert from 'node:assert/strict';

import { encryptTenantGatewaySecrets } from '../lib/tenant-gateway-api.js';
import { processDurableTenantGatewayCallback } from '../lib/tenant-gateway-callback-api.js';

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function encryptTradeInfo(text, hashKey, hashIv) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(hashKey),
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: encoder.encode(hashIv) },
    key,
    encoder.encode(text),
  );
  return bytesToHex(new Uint8Array(encrypted));
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    return this.db.first(this.sql, this.args);
  }

  async run() {
    return this.db.run(this.sql, this.args);
  }
}

class FakeDb {
  constructor(gatewayRow) {
    this.gatewayRow = gatewayRow;
    this.attempt = {
      tenant_slug: 'agency-b',
      merchant_order_no: 'TGAGENCYTEST01D',
      order_id: 'ORDER-B-1',
      leg: 'deposit',
      amount: 500,
      status: 'created',
    };
    this.order = {
      tenant_slug: 'agency-b',
      order_id: 'ORDER-B-1',
      commission_status: 'pending',
      deposit_status: 'unpaid',
      status: 'pending',
    };
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async first(sql, args) {
    if (sql.includes('FROM tenant_payment_gateway_credentials')) {
      return args[0] === 'agency-b' ? this.gatewayRow : null;
    }
    if (sql.includes('FROM payment_attempts')) {
      return args[0] === this.attempt.tenant_slug && args[1] === this.attempt.merchant_order_no
        ? { ...this.attempt }
        : null;
    }
    if (sql.includes('SELECT commission_status') && sql.includes('FROM orders')) {
      return args[0] === this.order.tenant_slug && args[1] === this.order.order_id
        ? { commission_status: this.order.commission_status }
        : null;
    }
    return null;
  }

  async run(sql, args) {
    if (sql.includes('UPDATE payment_attempts')) {
      this.attempt.status = args[0];
      this.attempt.method = args[1];
      this.attempt.trade_no = args[2];
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("deposit_status = 'paid'")) {
      this.order.deposit_status = 'paid';
      this.order.deposit_paid_at = args[0];
      this.order.deposit_method = args[1];
      this.order.deposit_trade_no = args[2];
      this.order.status = 'confirmed';
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("deposit_status = 'failed'")) {
      this.order.deposit_status = 'failed';
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 1 } };
  }
}

test('an in-flight tenant gateway payment completes even after the gateway is disabled', async () => {
  const env = {
    TENANT_PAYMENT_MASTER_KEY: 'local-test-master-key-that-is-longer-than-32-characters',
    TENANT_PAYMENT_KEY_VERSION: 'v1',
  };
  const hashKey = '12345678901234567890123456789012';
  const hashIv = '1234567890123456';
  const encrypted = await encryptTenantGatewaySecrets(env, 'agency-b', 'newebpay', { hashKey, hashIv });
  const db = new FakeDb({
    tenant_slug: 'agency-b',
    provider: 'newebpay',
    enabled: 0,
    merchant_id: 'MS123456789',
    secrets_ciphertext: encrypted.ciphertext,
    secrets_iv: encrypted.iv,
    key_version: encrypted.keyVersion,
  });
  env.DB = db;

  const payload = {
    Status: 'SUCCESS',
    Message: '授權成功',
    Result: {
      MerchantID: 'MS123456789',
      MerchantOrderNo: 'TGAGENCYTEST01D',
      Amt: 500,
      PaymentType: 'CREDIT',
      TradeNo: 'NEWEBPAY-TRADE-1',
      PayTime: '2026-07-11 10:30:00',
    },
  };
  const tradeInfo = await encryptTradeInfo(JSON.stringify(payload), hashKey, hashIv);
  const tradeSha = (await sha256Hex(`HashKey=${hashKey}&${tradeInfo}&HashIV=${hashIv}`)).toUpperCase();
  const request = new Request('https://worker.example/api/v2/payments/notify/tenant/agency-b', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TradeInfo: tradeInfo, TradeSha: tradeSha }),
  });

  const result = await processDurableTenantGatewayCallback(request, env, 'agency-b');

  assert.equal(result.success, true);
  assert.equal(result.status, 'paid');
  assert.equal(db.attempt.status, 'paid');
  assert.equal(db.attempt.trade_no, 'NEWEBPAY-TRADE-1');
  assert.equal(db.order.deposit_status, 'paid');
  assert.equal(db.order.status, 'confirmed');
});
