import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';
import { getTenantPaymentPolicy } from './tenant-payment-policy.js';

const FRONTEND_ROOT = 'https://fangwl591021.github.io/travelkeeper/';
const SUPPORTED_PROVIDER = 'newebpay';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function errorStatus(code) {
  return {
    AUTH_REQUIRED: 401,
    TENANT_ACCESS_DENIED: 403,
    TENANT_ROLE_DENIED: 403,
    TENANT_NOT_FOUND: 404,
    ORDER_NOT_FOUND: 404,
    ORDER_CUSTOMER_MISMATCH: 403,
    PAYMENT_ATTEMPT_NOT_FOUND: 404,
    TENANT_GATEWAY_NOT_CONFIGURED: 409,
    TENANT_GATEWAY_DISABLED: 409,
    TENANT_GATEWAY_POLICY_MISMATCH: 409,
    TENANT_GATEWAY_PROVIDER_UNSUPPORTED: 400,
    TENANT_PAYMENT_MASTER_KEY_MISSING: 503,
    TENANT_PAYMENT_MASTER_KEY_WEAK: 503,
    TENANT_PAYMENT_KEY_VERSION_MISMATCH: 503,
    TENANT_GATEWAY_SECRET_INVALID: 400,
    TENANT_GATEWAY_SECRET_DECRYPT_FAILED: 503,
    INVALID_MERCHANT_ID: 400,
    INVALID_HASH_KEY_LENGTH: 400,
    INVALID_HASH_IV_LENGTH: 400,
    INVALID_GATEWAY_URL: 400,
    PAYMENT_AMOUNT_INVALID: 400,
    PAYMENT_AMOUNT_MISMATCH: 400,
    PAYMENT_ALREADY_COMPLETED: 409,
    MISSING_TRADE_INFO: 400,
    TRADE_SHA_MISMATCH: 400,
    MERCHANT_ID_MISMATCH: 400,
    MISSING_MERCHANT_ORDER_NO: 400,
    D1_REQUIRED: 503,
  }[code] || 400;
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function requestUid(request, body = null) {
  return cleanText(
    request.headers.get('x-user-uid') ||
    body?.user_uid ||
    body?.userUid ||
    body?.uid ||
    body?.operatorUid,
    100,
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value) {
  const hex = String(value || '').trim();
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('TENANT_GATEWAY_SECRET_INVALID');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Bytes(value) {
  const encoded = new TextEncoder().encode(String(value || ''));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
}

async function sha256Hex(value) {
  return bytesToHex(await sha256Bytes(value));
}

function currentKeyVersion(env) {
  return cleanText(env.TENANT_PAYMENT_KEY_VERSION || 'v1', 40) || 'v1';
}

function keyEnvSuffix(version) {
  return String(version || 'v1').replace(/[^a-z0-9]/gi, '_').toUpperCase();
}

function masterSecretForVersion(env, version) {
  const currentVersion = currentKeyVersion(env);
  if (version === currentVersion && env.TENANT_PAYMENT_MASTER_KEY) {
    return String(env.TENANT_PAYMENT_MASTER_KEY);
  }
  const versioned = env[`TENANT_PAYMENT_MASTER_KEY_${keyEnvSuffix(version)}`];
  if (versioned) return String(versioned);
  return '';
}

async function importMasterKey(secret) {
  const normalized = String(secret || '');
  if (!normalized) throw new Error('TENANT_PAYMENT_MASTER_KEY_MISSING');
  if (normalized.length < 32) throw new Error('TENANT_PAYMENT_MASTER_KEY_WEAK');
  const digest = await sha256Bytes(normalized);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptTenantGatewaySecrets(env, tenantSlug, provider, secrets) {
  const version = currentKeyVersion(env);
  const secret = masterSecretForVersion(env, version);
  const key = await importMasterKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`${tenantSlug}:${provider}:${version}`);
  const plaintext = new TextEncoder().encode(JSON.stringify(secrets || {}));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    plaintext,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    keyVersion: version,
  };
}

export async function decryptTenantGatewaySecrets(env, tenantSlug, provider, row) {
  try {
    const version = cleanText(row?.key_version || 'v1', 40) || 'v1';
    const secret = masterSecretForVersion(env, version);
    if (!secret) throw new Error('TENANT_PAYMENT_KEY_VERSION_MISMATCH');
    const key = await importMasterKey(secret);
    const additionalData = new TextEncoder().encode(`${tenantSlug}:${provider}:${version}`);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(row?.secrets_iv),
        additionalData,
        tagLength: 128,
      },
      key,
      base64ToBytes(row?.secrets_ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (error) {
    const code = String(error?.message || error || '');
    if (code.startsWith('TENANT_PAYMENT_')) throw error;
    throw new Error('TENANT_GATEWAY_SECRET_DECRYPT_FAILED');
  }
}

async function aes256CbcEncryptHex(plainText, hashKey, hashIv) {
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
    encoder.encode(plainText),
  );
  return bytesToHex(new Uint8Array(encrypted));
}

async function aes256CbcDecryptText(cipherHex, hashKey, hashIv) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(hashKey),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: encoder.encode(hashIv) },
    key,
    hexToBytes(cipherHex),
  );
  return new TextDecoder().decode(decrypted);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function gatewaySlugFromPath(path) {
  const match = path.match(/^\/api\/v2\/payments\/(?:notify|return)\/tenant\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]).trim().toLowerCase() : '';
}

async function requireGatewayContext(request, env, body = null, roles = ['platform_admin', 'tenant_admin']) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles: roles,
  });
}

async function loadGatewayRow(env, tenantSlug, provider = SUPPORTED_PROVIDER) {
  return env.DB.prepare(`
    SELECT *
    FROM tenant_payment_gateway_credentials
    WHERE tenant_slug = ? AND provider = ?
    LIMIT 1
  `).bind(tenantSlug, provider).first();
}

async function loadActiveGateway(env, tenantSlug) {
  const policy = await getTenantPaymentPolicy(env, tenantSlug);
  if (!policy.enabled || policy.collectionMode !== 'tenant_gateway') {
    throw new Error('TENANT_GATEWAY_POLICY_MISMATCH');
  }
  if (policy.provider !== SUPPORTED_PROVIDER) {
    throw new Error('TENANT_GATEWAY_PROVIDER_UNSUPPORTED');
  }
  const row = await loadGatewayRow(env, tenantSlug, policy.provider);
  if (!row) throw new Error('TENANT_GATEWAY_NOT_CONFIGURED');
  if (Number(row.enabled || 0) !== 1) throw new Error('TENANT_GATEWAY_DISABLED');
  if (!row.merchant_id || !row.secrets_ciphertext || !row.secrets_iv) {
    throw new Error('TENANT_GATEWAY_NOT_CONFIGURED');
  }
  const secrets = await decryptTenantGatewaySecrets(env, tenantSlug, policy.provider, row);
  const hashKey = cleanText(secrets.hashKey, 80);
  const hashIv = cleanText(secrets.hashIv, 80);
  if (hashKey.length !== 32) throw new Error('INVALID_HASH_KEY_LENGTH');
  if (hashIv.length !== 16) throw new Error('INVALID_HASH_IV_LENGTH');
  return {
    policy,
    provider: policy.provider,
    merchantId: cleanText(row.merchant_id, 80),
    environment: row.environment || 'sandbox',
    gatewayUrl: cleanText(
      row.gateway_url || (row.environment === 'production'
        ? 'https://core.newebpay.com/MPG/mpg_gateway'
        : 'https://ccore.newebpay.com/MPG/mpg_gateway'),
      500,
    ),
    version: cleanText(row.protocol_version || '2.0', 20) || '2.0',
    hashKey,
    hashIv,
    keyVersion: row.key_version || 'v1',
  };
}

function gatewayMetadata(row, policy) {
  return {
    tenantSlug: policy.tenantSlug,
    collectionMode: policy.collectionMode,
    provider: policy.provider,
    policyEnabled: policy.enabled,
    configured: Boolean(row?.merchant_id && row?.secrets_ciphertext && row?.secrets_iv),
    enabled: Number(row?.enabled || 0) === 1,
    merchantId: row?.merchant_id || '',
    environment: row?.environment || 'sandbox',
    gatewayUrl: row?.gateway_url || '',
    protocolVersion: row?.protocol_version || '2.0',
    keyVersion: row?.key_version || '',
    updatedBy: row?.updated_by || '',
    updatedAt: row?.updated_at || '',
  };
}

async function getGatewayConfig(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const context = await requireGatewayContext(request, env, null, ['platform_admin', 'tenant_admin', 'finance']);
  const policy = await getTenantPaymentPolicy(env, context.tenantSlug);
  const row = await loadGatewayRow(env, context.tenantSlug, policy.provider || SUPPORTED_PROVIDER);
  return json({ success: true, data: gatewayMetadata(row, policy) });
}

async function updateGatewayConfig(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const context = await requireGatewayContext(request, env, body);
  const policy = await getTenantPaymentPolicy(env, context.tenantSlug);
  if (policy.collectionMode !== 'tenant_gateway') throw new Error('TENANT_GATEWAY_POLICY_MISMATCH');
  if (policy.provider !== SUPPORTED_PROVIDER) throw new Error('TENANT_GATEWAY_PROVIDER_UNSUPPORTED');

  const existing = await loadGatewayRow(env, context.tenantSlug, policy.provider);
  const merchantId = cleanText(body.merchant_id || body.merchantId || existing?.merchant_id, 80);
  if (!merchantId) throw new Error('INVALID_MERCHANT_ID');

  const environment = String(body.environment || existing?.environment || 'sandbox').toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
  const defaultUrl = environment === 'production'
    ? 'https://core.newebpay.com/MPG/mpg_gateway'
    : 'https://ccore.newebpay.com/MPG/mpg_gateway';
  const gatewayUrl = cleanText(body.gateway_url || body.gatewayUrl || existing?.gateway_url || defaultUrl, 500);
  try {
    const parsed = new URL(gatewayUrl);
    if (parsed.protocol !== 'https:') throw new Error('INVALID_GATEWAY_URL');
  } catch (_) {
    throw new Error('INVALID_GATEWAY_URL');
  }
  const protocolVersion = cleanText(body.protocol_version || body.protocolVersion || existing?.protocol_version || '2.0', 20) || '2.0';
  const enabled = body.enabled === undefined
    ? Number(existing?.enabled || 0)
    : (body.enabled === true || body.enabled === 1 || body.enabled === '1' || body.enabled === 'true' ? 1 : 0);

  const hashKeyInput = cleanText(body.hash_key || body.hashKey, 80);
  const hashIvInput = cleanText(body.hash_iv || body.hashIv, 80);
  if ((hashKeyInput && !hashIvInput) || (!hashKeyInput && hashIvInput)) {
    throw new Error('TENANT_GATEWAY_SECRET_INVALID');
  }

  let ciphertext = existing?.secrets_ciphertext || '';
  let secretsIv = existing?.secrets_iv || '';
  let keyVersion = existing?.key_version || currentKeyVersion(env);
  if (hashKeyInput || hashIvInput) {
    if (hashKeyInput.length !== 32) throw new Error('INVALID_HASH_KEY_LENGTH');
    if (hashIvInput.length !== 16) throw new Error('INVALID_HASH_IV_LENGTH');
    const encrypted = await encryptTenantGatewaySecrets(env, context.tenantSlug, policy.provider, {
      hashKey: hashKeyInput,
      hashIv: hashIvInput,
    });
    ciphertext = encrypted.ciphertext;
    secretsIv = encrypted.iv;
    keyVersion = encrypted.keyVersion;
  }

  if (enabled && (!ciphertext || !secretsIv)) throw new Error('TENANT_GATEWAY_NOT_CONFIGURED');

  await env.DB.prepare(`
    INSERT INTO tenant_payment_gateway_credentials (
      tenant_slug, provider, enabled, merchant_id, environment, gateway_url,
      protocol_version, secrets_ciphertext, secrets_iv, key_version,
      updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_slug, provider) DO UPDATE SET
      enabled = excluded.enabled,
      merchant_id = excluded.merchant_id,
      environment = excluded.environment,
      gateway_url = excluded.gateway_url,
      protocol_version = excluded.protocol_version,
      secrets_ciphertext = excluded.secrets_ciphertext,
      secrets_iv = excluded.secrets_iv,
      key_version = excluded.key_version,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    context.tenantSlug,
    policy.provider,
    enabled,
    merchantId,
    environment,
    gatewayUrl,
    protocolVersion,
    ciphertext,
    secretsIv,
    keyVersion,
    context.userUid,
  ).run();

  const row = await loadGatewayRow(env, context.tenantSlug, policy.provider);
  return json({ success: true, data: gatewayMetadata(row, policy) });
}

function makeMerchantOrderNo(tenantSlug, leg) {
  const tenant = String(tenantSlug || 'tenant').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5) || 'TEN';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return `TG${tenant}${timestamp}${random}${leg === 'balance' ? 'B' : 'D'}`.slice(0, 30);
}

async function loadOrder(env, tenantSlug, orderId) {
  return env.DB.prepare(`
    SELECT o.*, i.allowed_payment_methods
    FROM orders o
    LEFT JOIN itineraries i
      ON i.tenant_slug = o.tenant_slug
     AND i.id = o.itinerary_id
    WHERE o.tenant_slug = ? AND o.order_id = ?
    LIMIT 1
  `).bind(tenantSlug, orderId).first();
}

async function createTenantGatewayPayment(request, env, body, tenantSlug) {
  const customerUid = requestUid(request, body);
  if (!customerUid) throw new Error('AUTH_REQUIRED');
  const orderId = cleanText(body.order_id || body.orderId, 120);
  const leg = String(body.leg || 'deposit').toLowerCase() === 'balance' ? 'balance' : 'deposit';
  if (!orderId) throw new Error('ORDER_NOT_FOUND');
  const order = await loadOrder(env, tenantSlug, orderId);
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (String(order.customer_line_uid || '') !== customerUid) throw new Error('ORDER_CUSTOMER_MISMATCH');

  const amount = leg === 'balance' ? Number(order.balance_amount || 0) : Number(order.deposit_amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('PAYMENT_AMOUNT_INVALID');
  if (leg === 'deposit' && String(order.deposit_status || '').toLowerCase() === 'paid') {
    throw new Error('PAYMENT_ALREADY_COMPLETED');
  }
  if (leg === 'balance' && ['paid_online', 'paid_offline'].includes(String(order.balance_status || '').toLowerCase())) {
    throw new Error('PAYMENT_ALREADY_COMPLETED');
  }

  const cfg = await loadActiveGateway(env, tenantSlug);
  const origin = new URL(request.url).origin;
  const merchantOrderNo = makeMerchantOrderNo(tenantSlug, leg);
  const allowed = new Set(
    String(order.allowed_payment_methods || 'credit_card,linepay,atm')
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean),
  );
  const tradeData = {
    MerchantID: cfg.merchantId,
    RespondType: 'JSON',
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: cfg.version,
    MerchantOrderNo: merchantOrderNo,
    Amt: Math.round(amount),
    ItemDesc: cleanText(`${order.itinerary_title || 'TravelKeeper 行程'} ${leg === 'balance' ? '尾款' : '訂金'}`, 50),
    NotifyURL: `${origin}/api/v2/payments/notify/tenant/${encodeURIComponent(tenantSlug)}`,
    ReturnURL: `${origin}/api/v2/payments/return/tenant/${encodeURIComponent(tenantSlug)}?order_id=${encodeURIComponent(orderId)}&leg=${encodeURIComponent(leg)}`,
    ClientBackURL: `${FRONTEND_ROOT}thank-you.html?tenant=${encodeURIComponent(tenantSlug)}&order_id=${encodeURIComponent(orderId)}&leg=${encodeURIComponent(leg)}`,
    Email: '',
    LoginType: 0,
  };
  if (allowed.has('credit_card')) tradeData.CREDIT = 1;
  if (allowed.has('linepay')) tradeData.LINEPAY = 1;
  if (allowed.has('atm') || allowed.has('vacc')) tradeData.VACC = 1;

  const tradeInfo = await aes256CbcEncryptHex(new URLSearchParams(tradeData).toString(), cfg.hashKey, cfg.hashIv);
  const tradeSha = (await sha256Hex(`HashKey=${cfg.hashKey}&${tradeInfo}&HashIV=${cfg.hashIv}`)).toUpperCase();
  const formHtml = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>前往藍新金流</title></head><body>
<form id="newebpay-form" method="post" action="${escapeHtml(cfg.gatewayUrl)}">
  <input type="hidden" name="MerchantID" value="${escapeHtml(cfg.merchantId)}">
  <input type="hidden" name="TradeInfo" value="${escapeHtml(tradeInfo)}">
  <input type="hidden" name="TradeSha" value="${escapeHtml(tradeSha)}">
  <input type="hidden" name="Version" value="${escapeHtml(cfg.version)}">
</form>
<script>document.getElementById('newebpay-form').submit();</script>
</body></html>`;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO payment_attempts (
      id, order_id, leg, merchant_order_no, amount, status,
      method, trade_no, raw_notify_json, created_at, updated_at, tenant_slug
    ) VALUES (?, ?, ?, ?, ?, 'created', '', '', '', ?, ?, ?)
  `).bind(
    merchantOrderNo,
    orderId,
    leg,
    merchantOrderNo,
    Math.round(amount),
    now,
    now,
    tenantSlug,
  ).run();

  return json({
    success: true,
    data: {
      payment_required: true,
      collection_mode: 'tenant_gateway',
      provider: cfg.provider,
      payment_id: merchantOrderNo,
      merchant_order_no: merchantOrderNo,
      amount: Math.round(amount),
      form_html: formHtml,
    },
  });
}

function parseDecryptedPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
}

function normalizeResult(payload) {
  const raw = payload?.Result ?? payload?.result ?? payload;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return Object.fromEntries(new URLSearchParams(raw).entries());
    }
  }
  return {};
}

async function readPaymentRequestData(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return request.json().catch(() => ({}));
  const form = await request.formData().catch(() => null);
  if (form) return Object.fromEntries(form.entries());
  const text = await request.text().catch(() => '');
  return Object.fromEntries(new URLSearchParams(text).entries());
}

function normalizedPaymentMethod(value) {
  return cleanText(value, 80).toLowerCase();
}

async function processTenantGatewayCallback(request, env, tenantSlug) {
  const cfg = await loadActiveGateway(env, tenantSlug);
  const body = await readPaymentRequestData(request);
  const tradeInfo = cleanText(body.TradeInfo || body.TradeInfo_ || body.tradeInfo, 20000);
  const tradeSha = cleanText(body.TradeSha || body.TradeSha_ || body.tradeSha, 200).toUpperCase();
  if (!tradeInfo || !tradeSha) throw new Error('MISSING_TRADE_INFO');
  const expectedSha = (await sha256Hex(`HashKey=${cfg.hashKey}&${tradeInfo}&HashIV=${cfg.hashIv}`)).toUpperCase();
  if (tradeSha !== expectedSha) throw new Error('TRADE_SHA_MISMATCH');

  const payload = parseDecryptedPayload(await aes256CbcDecryptText(tradeInfo, cfg.hashKey, cfg.hashIv));
  const result = normalizeResult(payload);
  const merchantId = cleanText(result.MerchantID || payload.MerchantID, 80);
  if (merchantId && merchantId !== cfg.merchantId) throw new Error('MERCHANT_ID_MISMATCH');
  const merchantOrderNo = cleanText(result.MerchantOrderNo || payload.MerchantOrderNo, 120);
  if (!merchantOrderNo) throw new Error('MISSING_MERCHANT_ORDER_NO');

  const attempt = await env.DB.prepare(`
    SELECT *
    FROM payment_attempts
    WHERE tenant_slug = ? AND merchant_order_no = ?
    LIMIT 1
  `).bind(tenantSlug, merchantOrderNo).first();
  if (!attempt) throw new Error('PAYMENT_ATTEMPT_NOT_FOUND');

  const callbackAmount = Number(result.Amt ?? result.Amount ?? payload.Amt ?? attempt.amount);
  if (Number.isFinite(callbackAmount) && callbackAmount !== Number(attempt.amount || 0)) {
    throw new Error('PAYMENT_AMOUNT_MISMATCH');
  }

  const status = cleanText(payload.Status || payload.status, 80).toUpperCase();
  const isPaid = status === 'SUCCESS';
  const nextStatus = isPaid ? 'paid' : 'failed';
  const method = normalizedPaymentMethod(result.PaymentType || result.PaymentMethod || result.PayType);
  const tradeNo = cleanText(result.TradeNo || result.TradeNO || result.TradeSN, 120);
  const paidAt = cleanText(result.PayTime || result.payTime, 80) || new Date().toISOString();
  const now = new Date().toISOString();
  const rawNotify = JSON.stringify({ received: body, decrypted: payload }).slice(0, 30000);

  await env.DB.prepare(`
    UPDATE payment_attempts
    SET status = ?, method = ?, trade_no = ?, raw_notify_json = ?, updated_at = ?
    WHERE tenant_slug = ? AND merchant_order_no = ?
  `).bind(nextStatus, method, tradeNo, rawNotify, now, tenantSlug, merchantOrderNo).run();

  if (String(attempt.leg || '').toLowerCase() === 'balance') {
    if (isPaid) {
      const order = await env.DB.prepare(`
        SELECT commission_status FROM orders
        WHERE tenant_slug = ? AND order_id = ?
      `).bind(tenantSlug, attempt.order_id).first();
      const shouldSetPayable = String(order?.commission_status || 'pending').toLowerCase() === 'pending';
      const sets = [
        'balance_status = ?',
        'balance_paid_at = ?',
        'balance_method = ?',
        'balance_trade_no = ?',
        'status = ?',
        'updated_at = ?',
      ];
      const values = ['paid_online', paidAt, method, tradeNo, 'completed', now];
      if (shouldSetPayable) {
        sets.push('commission_status = ?');
        sets.push('commission_settled_at = ?');
        values.push('payable', now);
      }
      await env.DB.prepare(`
        UPDATE orders SET ${sets.join(', ')}
        WHERE tenant_slug = ? AND order_id = ?
      `).bind(...values, tenantSlug, attempt.order_id).run();
    } else {
      await env.DB.prepare(`
        UPDATE orders SET balance_status = 'failed', updated_at = ?
        WHERE tenant_slug = ? AND order_id = ?
      `).bind(now, tenantSlug, attempt.order_id).run();
    }
  } else if (isPaid) {
    await env.DB.prepare(`
      UPDATE orders
      SET deposit_status = 'paid', deposit_paid_at = ?, deposit_method = ?,
          deposit_trade_no = ?, status = 'confirmed', updated_at = ?
      WHERE tenant_slug = ? AND order_id = ?
    `).bind(paidAt, method, tradeNo, now, tenantSlug, attempt.order_id).run();
  } else {
    await env.DB.prepare(`
      UPDATE orders SET deposit_status = 'failed', updated_at = ?
      WHERE tenant_slug = ? AND order_id = ?
    `).bind(now, tenantSlug, attempt.order_id).run();
  }

  return {
    success: true,
    tenantSlug,
    orderId: attempt.order_id,
    leg: attempt.leg,
    status: nextStatus,
  };
}

function thankYouRedirect(tenantSlug, orderId, leg, status = '') {
  const params = new URLSearchParams({
    tenant: tenantSlug,
    order_id: orderId || '',
    leg: leg || 'deposit',
  });
  if (status) params.set('payment_status', status);
  return Response.redirect(`${FRONTEND_ROOT}thank-you.html?${params.toString()}`, 302);
}

async function tenantGatewayNotify(request, env, tenantSlug) {
  try {
    await processTenantGatewayCallback(request, env, tenantSlug);
    return new Response('1|OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_GATEWAY_NOTIFY_ERROR');
    return new Response(`0|${code}`, {
      status: errorStatus(code),
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  }
}

async function tenantGatewayReturn(request, env, tenantSlug) {
  const url = new URL(request.url);
  let orderId = cleanText(url.searchParams.get('order_id'), 120);
  let leg = String(url.searchParams.get('leg') || 'deposit').toLowerCase() === 'balance' ? 'balance' : 'deposit';
  let status = '';
  if (request.method === 'POST') {
    try {
      const result = await processTenantGatewayCallback(request, env, tenantSlug);
      orderId = result.orderId || orderId;
      leg = result.leg || leg;
      status = result.status || '';
    } catch (error) {
      status = 'failed';
    }
  }
  return thankYouRedirect(tenantSlug, orderId, leg, status);
}

export function isTenantGatewayApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/tenant/payment-gateway' ||
    path === '/api/v2/payments/create' ||
    /^\/api\/v2\/payments\/(?:notify|return)\/tenant\/[^/]+$/.test(path);
}

export function isPublicTenantGatewayRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return /^\/api\/v2\/payments\/(?:notify|return)\/tenant\/[^/]+$/.test(path);
}

export async function routeTenantGatewayApi(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  try {
    if (/^\/api\/v2\/payments\/notify\/tenant\/[^/]+$/.test(path) && request.method === 'POST') {
      return tenantGatewayNotify(request, env, gatewaySlugFromPath(path));
    }
    if (/^\/api\/v2\/payments\/return\/tenant\/[^/]+$/.test(path) && (request.method === 'GET' || request.method === 'POST')) {
      return tenantGatewayReturn(request, env, gatewaySlugFromPath(path));
    }
    if (path === '/api/v2/tenant/payment-gateway' && request.method === 'GET') {
      return getGatewayConfig(request, env);
    }
    if (path === '/api/v2/tenant/payment-gateway' && request.method === 'POST') {
      return updateGatewayConfig(request, env);
    }
    if (path === '/api/v2/payments/create' && request.method === 'POST') {
      const body = await request.clone().json().catch(() => ({}));
      const tenantSlug = requestedTenantSlug(request, body);
      const policy = await getTenantPaymentPolicy(env, tenantSlug);
      if (policy.collectionMode !== 'tenant_gateway') return null;
      return createTenantGatewayPayment(request, env, body, tenantSlug);
    }
    return null;
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_GATEWAY_ERROR');
    return json({ success: false, error: code }, errorStatus(code));
  }
}
