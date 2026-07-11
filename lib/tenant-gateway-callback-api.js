import { decryptTenantGatewaySecrets } from './tenant-gateway-api.js';

const FRONTEND_ROOT = 'https://fangwl591021.github.io/travelkeeper/';

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value) {
  const hex = String(value || '').trim();
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('INVALID_TRADE_INFO');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return bytesToHex(new Uint8Array(digest));
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

function gatewaySlugFromPath(path) {
  const match = path.match(/^\/api\/v2\/payments\/(?:notify|return)\/tenant\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]).trim().toLowerCase() : '';
}

async function readPaymentRequestData(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return request.json().catch(() => ({}));
  const form = await request.formData().catch(() => null);
  if (form) return Object.fromEntries(form.entries());
  const text = await request.text().catch(() => '');
  return Object.fromEntries(new URLSearchParams(text).entries());
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

async function loadCallbackGateway(env, tenantSlug) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const row = await env.DB.prepare(`
    SELECT *
    FROM tenant_payment_gateway_credentials
    WHERE tenant_slug = ? AND provider = 'newebpay'
    LIMIT 1
  `).bind(tenantSlug).first();
  if (!row || !row.merchant_id || !row.secrets_ciphertext || !row.secrets_iv) {
    throw new Error('TENANT_GATEWAY_NOT_CONFIGURED');
  }

  // Deliberately do not require enabled=1 or a current tenant_gateway policy here.
  // A payment initiated earlier must still be able to complete after an admin
  // disables or changes the collection mode.
  const secrets = await decryptTenantGatewaySecrets(env, tenantSlug, 'newebpay', row);
  const hashKey = cleanText(secrets.hashKey, 80);
  const hashIv = cleanText(secrets.hashIv, 80);
  if (hashKey.length !== 32) throw new Error('INVALID_HASH_KEY_LENGTH');
  if (hashIv.length !== 16) throw new Error('INVALID_HASH_IV_LENGTH');
  return {
    merchantId: cleanText(row.merchant_id, 80),
    hashKey,
    hashIv,
  };
}

export async function processDurableTenantGatewayCallback(request, env, tenantSlug) {
  const gateway = await loadCallbackGateway(env, tenantSlug);
  const body = await readPaymentRequestData(request);
  const tradeInfo = cleanText(body.TradeInfo || body.TradeInfo_ || body.tradeInfo, 20000);
  const tradeSha = cleanText(body.TradeSha || body.TradeSha_ || body.tradeSha, 200).toUpperCase();
  if (!tradeInfo || !tradeSha) throw new Error('MISSING_TRADE_INFO');

  const expectedSha = (await sha256Hex(
    `HashKey=${gateway.hashKey}&${tradeInfo}&HashIV=${gateway.hashIv}`,
  )).toUpperCase();
  if (tradeSha !== expectedSha) throw new Error('TRADE_SHA_MISMATCH');

  const decrypted = await aes256CbcDecryptText(tradeInfo, gateway.hashKey, gateway.hashIv);
  const payload = parseDecryptedPayload(decrypted);
  const result = normalizeResult(payload);
  const merchantId = cleanText(result.MerchantID || payload.MerchantID, 80);
  if (merchantId && merchantId !== gateway.merchantId) throw new Error('MERCHANT_ID_MISMATCH');

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
  const method = cleanText(result.PaymentType || result.PaymentMethod || result.PayType, 80).toLowerCase();
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
        SELECT commission_status
        FROM orders
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

async function notifyResponse(request, env, tenantSlug) {
  try {
    await processDurableTenantGatewayCallback(request, env, tenantSlug);
    return new Response('1|OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_GATEWAY_NOTIFY_ERROR');
    return new Response(`0|${code}`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  }
}

async function returnResponse(request, env, tenantSlug) {
  const url = new URL(request.url);
  let orderId = cleanText(url.searchParams.get('order_id'), 120);
  let leg = String(url.searchParams.get('leg') || 'deposit').toLowerCase() === 'balance' ? 'balance' : 'deposit';
  let status = '';
  if (request.method === 'POST') {
    try {
      const result = await processDurableTenantGatewayCallback(request, env, tenantSlug);
      orderId = result.orderId || orderId;
      leg = result.leg || leg;
      status = result.status || '';
    } catch (_) {
      status = 'failed';
    }
  }
  return thankYouRedirect(tenantSlug, orderId, leg, status);
}

export function isTenantGatewayCallbackRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return /^\/api\/v2\/payments\/(?:notify|return)\/tenant\/[^/]+$/.test(path);
}

export async function routeTenantGatewayCallback(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const tenantSlug = gatewaySlugFromPath(path);
  if (/^\/api\/v2\/payments\/notify\/tenant\/[^/]+$/.test(path) && request.method === 'POST') {
    return notifyResponse(request, env, tenantSlug);
  }
  if (/^\/api\/v2\/payments\/return\/tenant\/[^/]+$/.test(path) && (request.method === 'GET' || request.method === 'POST')) {
    return returnResponse(request, env, tenantSlug);
  }
  return null;
}
