import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';
import { statusForError } from './http-error-status.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function requestUid(request, body = null) {
  const url = new URL(request.url);
  return String(
    request.headers.get('x-user-uid') ||
    body?.user_uid ||
    body?.userUid ||
    body?.uid ||
    url.searchParams.get('uid') ||
    '',
  ).trim();
}

async function requireContext(request, env, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles: ['platform_admin', 'tenant_admin', 'finance', 'support'],
  });
}

async function loadOrder(env, tenantSlug, orderId) {
  return env.DB.prepare(`
    SELECT *
    FROM orders
    WHERE tenant_slug = ? AND order_id = ?
    LIMIT 1
  `).bind(tenantSlug, orderId).first();
}

function normalizeOrder(row = {}) {
  return {
    ...row,
    customer_phone: row.contact_phone || row.customer_phone || '',
    customer_key: row.customer_phone || '',
  };
}

async function markBalancePaid(request, env, orderId) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, body);
  const order = await loadOrder(env, context.tenantSlug, orderId);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  const current = String(order.balance_status || '').toLowerCase();
  if (['paid_online', 'paid_offline', 'paid'].includes(current)) {
    return json({
      success: true,
      data: normalizeOrder(order),
      tenantSlug: context.tenantSlug,
      idempotent: true,
    });
  }

  if (Number(order.balance_amount || 0) <= 0 || String(order.payment_mode || '').toLowerCase() === 'full') {
    throw new Error('ORDER_BALANCE_NOT_REQUIRED');
  }

  const result = await env.DB.prepare(`
    UPDATE orders
    SET balance_status = 'paid_offline',
        balance_paid_at = datetime('now'),
        balance_method = 'offline',
        status = 'completed',
        commission_status = CASE
          WHEN commission_status IN ('paid_out', 'settled') THEN commission_status
          ELSE 'payable'
        END,
        commission_settled_at = CASE
          WHEN commission_settled_at IS NULL OR commission_settled_at = '' THEN datetime('now')
          ELSE commission_settled_at
        END,
        updated_at = datetime('now')
    WHERE tenant_slug = ?
      AND order_id = ?
      AND balance_status NOT IN ('paid_online', 'paid_offline', 'paid')
  `).bind(context.tenantSlug, orderId).run();

  if (!Number(result.meta?.changes || 0)) throw new Error('ORDER_STATUS_CONFLICT');
  return json({
    success: true,
    data: normalizeOrder(await loadOrder(env, context.tenantSlug, orderId)),
    tenantSlug: context.tenantSlug,
  });
}

export function isTenantOrderActionRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return /^\/api\/v2\/orders\/[^/]+\/balance-paid$/.test(path);
}

export async function routeTenantOrderAction(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    const match = path.match(/^\/api\/v2\/orders\/([^/]+)\/balance-paid$/);
    if (match && request.method === 'POST') {
      return await markBalancePaid(request, env, decodeURIComponent(match[1]));
    }
    return json({ success: false, error: 'TENANT_ORDER_ACTION_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_ORDER_ACTION_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}
