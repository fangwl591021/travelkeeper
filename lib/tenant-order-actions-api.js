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

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

async function requireContext(request, env, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles: ['platform_admin', 'tenant_admin', 'finance', 'support'],
  });
}

async function requireOwnerTransferContext(request, env, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles: ['platform_admin', 'tenant_admin'],
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

async function loadCustomer(env, tenantSlug, customerId) {
  return env.DB.prepare(`
    SELECT customer_id, owner_uid, owner_name, ref_uid
    FROM customers
    WHERE tenant_slug = ? AND customer_id = ?
    LIMIT 1
  `).bind(tenantSlug, customerId).first();
}

async function loadAssignableOwner(env, tenantSlug, ownerUid) {
  return env.DB.prepare(`
    SELECT m.user_uid, p.display_name
    FROM tenant_memberships m
    LEFT JOIN tenant_distributor_profiles p
      ON p.tenant_slug = m.tenant_slug
     AND p.user_uid = m.user_uid
    WHERE m.tenant_slug = ?
      AND m.user_uid = ?
      AND m.status = 'active'
      AND m.role IN ('sales', 'editor')
    LIMIT 1
  `).bind(tenantSlug, ownerUid).first();
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

async function transferCustomerOwner(request, env, customerId) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const context = await requireOwnerTransferContext(request, env, body);
  const targetOwnerUid = cleanText(body.owner_uid ?? body.ownerUid, 120);
  if (!targetOwnerUid) throw new Error('OWNER_TRANSFER_TARGET_REQUIRED');

  const customer = await loadCustomer(env, context.tenantSlug, customerId);
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  const target = await loadAssignableOwner(env, context.tenantSlug, targetOwnerUid);
  if (!target) throw new Error('OWNER_TRANSFER_TARGET_DENIED');

  const previousOwnerUid = cleanText(customer.owner_uid, 120);
  const previousOwnerName = cleanText(customer.owner_name, 200);
  const targetOwnerName = cleanText(target.display_name, 200);
  if (previousOwnerUid === targetOwnerUid) {
    return json({
      success: true,
      tenantSlug: context.tenantSlug,
      idempotent: true,
      data: {
        customer_id: customerId,
        ref_uid: cleanText(customer.ref_uid, 120),
        owner_uid: previousOwnerUid,
        owner_name: previousOwnerName,
      },
    });
  }

  const auditId = `AUDIT-OWNER-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
  const requestId = cleanText(request.headers.get('x-request-id'), 160) || auditId;
  const beforeJson = JSON.stringify({ owner_uid: previousOwnerUid, owner_name: previousOwnerName });
  const afterJson = JSON.stringify({ owner_uid: targetOwnerUid, owner_name: targetOwnerName });

  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE customers
      SET owner_uid = ?,
          owner_name = ?,
          updated_at = datetime('now')
      WHERE tenant_slug = ?
        AND customer_id = ?
        AND COALESCE(owner_uid, '') = ?
    `).bind(
      targetOwnerUid,
      targetOwnerName,
      context.tenantSlug,
      customerId,
      previousOwnerUid,
    ),
    env.DB.prepare(`
      INSERT INTO audit_logs (
        id, tenant_slug, actor_uid, action, target_type, target_id,
        before_json, after_json, request_id, created_at
      )
      SELECT ?, ?, ?, 'customer.owner.transfer', 'customer', ?, ?, ?, ?, datetime('now')
      WHERE changes() = 1
    `).bind(
      auditId,
      context.tenantSlug,
      context.userUid,
      customerId,
      beforeJson,
      afterJson,
      requestId,
    ),
  ]);

  if (!Number(results?.[0]?.meta?.changes || 0)) throw new Error('OWNER_TRANSFER_CONFLICT');

  return json({
    success: true,
    tenantSlug: context.tenantSlug,
    idempotent: false,
    data: {
      customer_id: customerId,
      ref_uid: cleanText(customer.ref_uid, 120),
      owner_uid: targetOwnerUid,
      owner_name: targetOwnerName,
    },
  });
}

export function isTenantOrderActionRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return /^\/api\/v2\/orders\/[^/]+\/balance-paid$/.test(path) ||
    /^\/api\/v2\/customers\/[^/]+\/owner-transfer$/.test(path);
}

export async function routeTenantOrderAction(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    const balanceMatch = path.match(/^\/api\/v2\/orders\/([^/]+)\/balance-paid$/);
    if (balanceMatch && request.method === 'POST') {
      return await markBalancePaid(request, env, decodeURIComponent(balanceMatch[1]));
    }
    const ownerMatch = path.match(/^\/api\/v2\/customers\/([^/]+)\/owner-transfer$/);
    if (ownerMatch && request.method === 'POST') {
      return await transferCustomerOwner(request, env, decodeURIComponent(ownerMatch[1]));
    }
    return json({ success: false, error: 'TENANT_ACTION_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_ACTION_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}