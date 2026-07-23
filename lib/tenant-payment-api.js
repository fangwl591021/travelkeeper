import { requestedTenantSlug } from './tenant-context.js';
import {
  getTenantPaymentPolicy,
  getPaymentPolicyResponse,
  updatePaymentPolicyResponse,
  paymentPolicyMessage,
} from './tenant-payment-policy.js';

const FRONTEND_ROOT = 'https://fangwl591021.github.io/travelkeeper/';

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
    ORDER_NOT_FOUND: 404,
    ORDER_CUSTOMER_MISMATCH: 403,
    TENANT_NOT_FOUND: 404,
    TENANT_ACCESS_DENIED: 403,
    TENANT_ROLE_DENIED: 403,
    PLATFORM_COLLECTION_APPROVAL_REQUIRED: 403,
    PAYMENT_PROVIDER_REQUIRED: 400,
    INVALID_COLLECTION_MODE: 400,
    PAYMENT_AMOUNT_INVALID: 400,
    PAYMENT_ALREADY_COMPLETED: 409,
    TENANT_PAYMENT_CONFIGURATION_REQUIRED: 409,
    PLATFORM_PAYMENT_DISABLED: 503,
    PLATFORM_PAYMENT_SECRET_MISSING: 503,
    PLATFORM_PAYMENT_SECRET_LENGTH_INVALID: 503,
    D1_REQUIRED: 503,
  }[code] || 400;
}

function authenticatedUserUid(request) {
  return String(request.headers.get('x-user-uid') || '').trim();
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return bytesToHex(new Uint8Array(digest));
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function readPlatformPaymentSettings(env) {
  if (!env.DB) return {};
  try {
    const rows = await env.DB.prepare(`
      SELECT key, value
      FROM system_settings
      WHERE namespace = 'payment'
    `).all();
    return Object.fromEntries((rows.results || []).map(row => [row.key, row.value]));
  } catch (error) {
    if (String(error?.message || '').includes('no such table')) return {};
    throw error;
  }
}

async function getPlatformNewebPayConfig(env) {
  const settings = await readPlatformPaymentSettings(env);
  const merchantId = cleanText(settings.newebpay_merchant_id || env.NEWEBPAY_MERCHANT_ID, 80);
  const hashKey = cleanText(settings.newebpay_hash_key || env.NEWEBPAY_HASH_KEY, 80);
  const hashIv = cleanText(settings.newebpay_hash_iv || env.NEWEBPAY_HASH_IV, 80);
  const mpgUrl = cleanText(
    settings.newebpay_mpg_url || env.NEWEBPAY_MPG_URL || 'https://ccore.newebpay.com/MPG/mpg_gateway',
    500,
  );
  const version = cleanText(settings.newebpay_version || env.NEWEBPAY_VERSION || '2.0', 20) || '2.0';
  const enabledRaw = String(settings.newebpay_enabled || '').trim().toLowerCase();
  const enabled = enabledRaw
    ? ['1', 'true', 'yes', 'on'].includes(enabledRaw)
    : Boolean(merchantId && hashKey && hashIv);

  if (!enabled) throw new Error('PLATFORM_PAYMENT_DISABLED');
  if (!merchantId || !hashKey || !hashIv) throw new Error('PLATFORM_PAYMENT_SECRET_MISSING');
  if (hashKey.length !== 32 || hashIv.length !== 16) {
    throw new Error('PLATFORM_PAYMENT_SECRET_LENGTH_INVALID');
  }
  return { merchantId, hashKey, hashIv, mpgUrl, version };
}

function makeMerchantOrderNo(tenantSlug, leg) {
  const tenant = String(tenantSlug || 'demo').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5) || 'DEMO';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const legCode = leg === 'balance' ? 'B' : 'D';
  return `TK${tenant}${timestamp}${random}${legCode}`.slice(0, 30);
}

async function loadPaymentOrder(env, tenantSlug, orderId) {
  return env.DB.prepare(`
    SELECT
      o.*,
      i.allowed_payment_methods
    FROM orders o
    LEFT JOIN itineraries i
      ON i.tenant_slug = o.tenant_slug
     AND i.id = o.itinerary_id
    WHERE o.tenant_slug = ?
      AND o.order_id = ?
    LIMIT 1
  `).bind(tenantSlug, orderId).first();
}

async function createPlatformCollectPayment(request, env, tenantSlug, order, leg) {
  const cfg = await getPlatformNewebPayConfig(env);
  const amount = leg === 'balance'
    ? Number(order.balance_amount || 0)
    : Number(order.deposit_amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('PAYMENT_AMOUNT_INVALID');

  if (leg === 'deposit' && String(order.deposit_status || '').toLowerCase() === 'paid') {
    throw new Error('PAYMENT_ALREADY_COMPLETED');
  }
  if (leg === 'balance' && ['paid_online', 'paid_offline'].includes(String(order.balance_status || '').toLowerCase())) {
    throw new Error('PAYMENT_ALREADY_COMPLETED');
  }

  const merchantOrderNo = makeMerchantOrderNo(tenantSlug, leg);
  const now = new Date().toISOString();
  const origin = new URL(request.url).origin;
  const allowed = new Set(
    String(order.allowed_payment_methods || 'credit_card,linepay,atm')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const itemDesc = cleanText(
    `${order.itinerary_title || 'TravelKeeper 行程'} ${leg === 'balance' ? '尾款' : '訂金'}`,
    50,
  );

  const tradeData = {
    MerchantID: cfg.merchantId,
    RespondType: 'JSON',
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: cfg.version,
    MerchantOrderNo: merchantOrderNo,
    Amt: Math.round(amount),
    ItemDesc: itemDesc,
    NotifyURL: `${origin}/api/payment/notify`,
    ReturnURL: `${origin}/api/v2/payments/return/platform?tenant=${encodeURIComponent(tenantSlug)}&order_id=${encodeURIComponent(order.order_id)}&leg=${encodeURIComponent(leg)}`,
    ClientBackURL: `${FRONTEND_ROOT}thank-you.html?tenant=${encodeURIComponent(tenantSlug)}&order_id=${encodeURIComponent(order.order_id)}&leg=${encodeURIComponent(leg)}`,
    Email: '',
    LoginType: 0,
  };
  if (allowed.has('credit_card')) tradeData.CREDIT = 1;
  if (allowed.has('linepay')) tradeData.LINEPAY = 1;
  if (allowed.has('atm') || allowed.has('vacc')) tradeData.VACC = 1;

  const tradeQuery = new URLSearchParams(tradeData).toString();
  const tradeInfo = await aes256CbcEncryptHex(tradeQuery, cfg.hashKey, cfg.hashIv);
  const tradeSha = (await sha256Hex(`HashKey=${cfg.hashKey}&${tradeInfo}&HashIV=${cfg.hashIv}`)).toUpperCase();
  const formHtml = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>前往藍新金流</title></head><body>
<form id="newebpay-form" method="post" action="${escapeHtml(cfg.mpgUrl)}">
  <input type="hidden" name="MerchantID" value="${escapeHtml(cfg.merchantId)}">
  <input type="hidden" name="TradeInfo" value="${escapeHtml(tradeInfo)}">
  <input type="hidden" name="TradeSha" value="${escapeHtml(tradeSha)}">
  <input type="hidden" name="Version" value="${escapeHtml(cfg.version)}">
</form>
<script>document.getElementById('newebpay-form').submit();</script>
</body></html>`;

  await env.DB.prepare(`
    INSERT INTO payment_attempts (
      id, order_id, leg, merchant_order_no, amount, status,
      method, trade_no, raw_notify_json, created_at, updated_at, tenant_slug
    ) VALUES (?, ?, ?, ?, ?, 'created', '', '', '', ?, ?, ?)
  `).bind(
    merchantOrderNo,
    order.order_id,
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
      collection_mode: 'platform_collect',
      provider: 'newebpay',
      payment_id: merchantOrderNo,
      merchant_order_no: merchantOrderNo,
      amount: Math.round(amount),
      form_html: formHtml,
    },
  });
}

async function createPayment(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const tenantSlug = requestedTenantSlug(request, body);
  const customerLineUid = authenticatedUserUid(request);
  if (!customerLineUid) throw new Error('AUTH_REQUIRED');

  const orderId = cleanText(body.order_id || body.orderId, 120);
  const leg = String(body.leg || 'deposit').toLowerCase() === 'balance' ? 'balance' : 'deposit';
  if (!orderId) throw new Error('ORDER_NOT_FOUND');

  const order = await loadPaymentOrder(env, tenantSlug, orderId);
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (String(order.customer_line_uid || '') !== customerLineUid) {
    throw new Error('ORDER_CUSTOMER_MISMATCH');
  }

  const policy = await getTenantPaymentPolicy(env, tenantSlug);
  if (!policy.enabled || policy.collectionMode === 'offline') {
    return json({
      success: false,
      error: 'TENANT_PAYMENT_CONFIGURATION_REQUIRED',
      message: paymentPolicyMessage(policy),
      data: {
        payment_required: false,
        collection_mode: policy.collectionMode,
        provider: policy.provider,
      },
    }, 409);
  }

  if (policy.collectionMode === 'platform_collect') {
    if (policy.provider !== 'newebpay') {
      return json({
        success: false,
        error: 'TENANT_PAYMENT_CONFIGURATION_REQUIRED',
        message: '目前平台代收僅支援藍新金流，訂單已建立，客服將協助確認付款方式。',
      }, 409);
    }
    return createPlatformCollectPayment(request, env, tenantSlug, order, leg);
  }

  return json({
    success: false,
    error: 'TENANT_PAYMENT_CONFIGURATION_REQUIRED',
    message: paymentPolicyMessage(policy),
    data: {
      payment_required: false,
      collection_mode: policy.collectionMode,
      provider: policy.provider,
    },
  }, 409);
}

function platformReturn(request) {
  const url = new URL(request.url);
  const tenantSlug = String(url.searchParams.get('tenant') || 'demo').trim().toLowerCase() || 'demo';
  const orderId = cleanText(url.searchParams.get('order_id'), 120);
  const leg = String(url.searchParams.get('leg') || 'deposit').toLowerCase() === 'balance' ? 'balance' : 'deposit';
  const redirectUrl = `${FRONTEND_ROOT}thank-you.html?tenant=${encodeURIComponent(tenantSlug)}&order_id=${encodeURIComponent(orderId)}&leg=${encodeURIComponent(leg)}`;
  return Response.redirect(redirectUrl, 302);
}

export function isTenantPaymentApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/payments/create' ||
    path === '/api/v2/payments/return/platform' ||
    path === '/api/v2/tenant/payment-policy';
}

export function isPublicTenantPaymentRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/payments/return/platform';
}

export async function routeTenantPaymentApi(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  try {
    if ((request.method === 'GET' || request.method === 'POST') && path === '/api/v2/payments/return/platform') {
      return platformReturn(request);
    }
    if (request.method === 'POST' && path === '/api/v2/payments/create') {
      return await createPayment(request, env);
    }
    if (request.method === 'GET' && path === '/api/v2/tenant/payment-policy') {
      return await getPaymentPolicyResponse(request, env);
    }
    if (request.method === 'POST' && path === '/api/v2/tenant/payment-policy') {
      return await updatePaymentPolicyResponse(request, env);
    }
    return json({ success: false, error: 'TENANT_PAYMENT_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_PAYMENT_ERROR');
    return json({ success: false, error: code }, errorStatus(code));
  }
}
