import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTenantPaymentPolicy,
  normalizeCollectionMode,
  paymentPolicyMessage,
} from '../lib/tenant-payment-policy.js';
import { routeTenantPaymentApi } from '../lib/tenant-payment-api.js';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  first() {
    return this.db.first(this.sql, this.args);
  }

  all() {
    return this.db.all(this.sql, this.args);
  }

  run() {
    return this.db.run(this.sql, this.args);
  }
}

class PaymentDb {
  constructor({ mode = 'offline', tenantSlug = 'tenant-b' } = {}) {
    this.mode = mode;
    this.tenantSlug = tenantSlug;
    this.paymentAttempts = [];
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async first(sql, args) {
    if (sql.includes('FROM tenant_payment_settings')) {
      return {
        tenant_slug: args[0],
        collection_mode: this.mode,
        provider: this.mode === 'platform_collect' ? 'newebpay' : (this.mode === 'tenant_gateway' ? 'newebpay' : 'none'),
        enabled: 1,
        display_label: this.mode === 'platform_collect' ? '平台代收' : '人工收款',
        settlement_note: this.mode === 'offline' ? '由合作業務另行聯絡付款' : '',
      };
    }

    if (sql.includes('FROM orders o')) {
      return {
        order_id: 'ORD-1',
        tenant_slug: args[0],
        customer_line_uid: 'U-CUSTOMER',
        itinerary_id: 'TOUR-1',
        itinerary_title: '測試行程',
        deposit_amount: 1000,
        balance_amount: 4000,
        deposit_status: 'unpaid',
        balance_status: 'unpaid',
        allowed_payment_methods: 'credit_card,atm',
      };
    }

    return null;
  }

  async all(sql) {
    if (sql.includes('FROM system_settings')) {
      return {
        results: [
          { key: 'newebpay_enabled', value: '1' },
          { key: 'newebpay_merchant_id', value: 'MS123456789' },
          { key: 'newebpay_hash_key', value: '12345678901234567890123456789012' },
          { key: 'newebpay_hash_iv', value: '1234567890123456' },
          { key: 'newebpay_mpg_url', value: 'https://ccore.newebpay.com/MPG/mpg_gateway' },
          { key: 'newebpay_version', value: '2.0' },
        ],
      };
    }
    return { results: [] };
  }

  async run(sql, args) {
    if (sql.includes('INSERT INTO payment_attempts')) {
      this.paymentAttempts.push({ sql, args });
    }
    return { success: true, meta: { changes: 1 } };
  }
}

class MissingPolicyDb {
  prepare(sql) {
    return {
      bind() {
        return this;
      },
      async first() {
        if (sql.includes('tenant_payment_settings')) throw new Error('no such table: tenant_payment_settings');
        return null;
      },
    };
  }
}

test('collection mode normalization preserves the three supported models', () => {
  assert.equal(normalizeCollectionMode('platform_collect'), 'platform_collect');
  assert.equal(normalizeCollectionMode('tenant_gateway'), 'tenant_gateway');
  assert.equal(normalizeCollectionMode('offline'), 'offline');
  assert.equal(normalizeCollectionMode('unknown'), 'offline');
});

test('tenants without payment policy default safely: demo platform collect, others offline', async () => {
  const env = { DB: new MissingPolicyDb() };
  const demo = await getTenantPaymentPolicy(env, 'demo');
  const partner = await getTenantPaymentPolicy(env, 'partner-a');

  assert.equal(demo.collectionMode, 'platform_collect');
  assert.equal(partner.collectionMode, 'offline');
  assert.match(paymentPolicyMessage(partner), /付款|收款/);
});

test('offline cooperation tenant keeps the order and does not create a payment attempt', async () => {
  const db = new PaymentDb({ mode: 'offline', tenantSlug: 'tenant-b' });
  const request = new Request('https://worker.example/api/v2/payments/create?tenant=tenant-b', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': 'tenant-b',
      'X-User-Uid': 'U-CUSTOMER',
    },
    body: JSON.stringify({ order_id: 'ORD-1', leg: 'deposit' }),
  });

  const response = await routeTenantPaymentApi(request, { DB: db });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error, 'TENANT_PAYMENT_CONFIGURATION_REQUIRED');
  assert.equal(payload.data.collection_mode, 'offline');
  assert.equal(db.paymentAttempts.length, 0);
});

test('approved platform collection creates a tenant-scoped NewebPay attempt', async () => {
  const db = new PaymentDb({ mode: 'platform_collect', tenantSlug: 'partner-a' });
  const request = new Request('https://worker.example/api/v2/payments/create?tenant=partner-a', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': 'partner-a',
      'X-User-Uid': 'U-CUSTOMER',
    },
    body: JSON.stringify({ order_id: 'ORD-1', leg: 'deposit' }),
  });

  const response = await routeTenantPaymentApi(request, { DB: db });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.collection_mode, 'platform_collect');
  assert.match(payload.data.form_html, /newebpay-form/);
  assert.equal(db.paymentAttempts.length, 1);
  assert.equal(db.paymentAttempts[0].args.at(-1), 'partner-a');
});

test('tenant-owned gateway never falls back to the platform merchant', async () => {
  const db = new PaymentDb({ mode: 'tenant_gateway', tenantSlug: 'tenant-b' });
  const request = new Request('https://worker.example/api/v2/payments/create?tenant=tenant-b', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': 'tenant-b',
      'X-User-Uid': 'U-CUSTOMER',
    },
    body: JSON.stringify({ order_id: 'ORD-1', leg: 'deposit' }),
  });

  const response = await routeTenantPaymentApi(request, { DB: db });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error, 'TENANT_PAYMENT_CONFIGURATION_REQUIRED');
  assert.equal(payload.data.collection_mode, 'tenant_gateway');
  assert.equal(db.paymentAttempts.length, 0);
});
