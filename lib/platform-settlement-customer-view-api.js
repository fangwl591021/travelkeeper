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

function requestUid(request) {
  const url = new URL(request.url);
  return String(
    request.headers.get('x-user-uid') ||
    url.searchParams.get('uid') ||
    ''
  ).trim();
}

function parseLimit(value) {
  const parsed = Number(value || 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(Math.floor(parsed), 500));
}

async function listPayables(request, env) {
  const url = new URL(request.url);
  const context = await requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request),
    userUid: requestUid(request),
    allowedRoles: ['platform_admin', 'tenant_admin', 'finance'],
  });

  await env.DB.prepare(`
    UPDATE platform_collection_payables
    SET status = 'eligible', updated_at = datetime('now')
    WHERE tenant_slug = ?
      AND status = 'pending'
      AND eligible_at <> ''
      AND datetime(eligible_at) <= datetime('now')
  `).bind(context.tenantSlug).run();

  const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
  const allowed = new Set(['pending', 'eligible', 'batched', 'paid', 'retained', 'void', 'disputed']);
  if (status && !allowed.has(status)) throw new Error('INVALID_SETTLEMENT_STATUS');

  const binds = [context.tenantSlug];
  let where = 'pc.tenant_slug = ?';
  if (status) {
    where += ' AND pc.status = ?';
    binds.push(status);
  }

  const rows = await env.DB.prepare(`
    SELECT
      pc.*,
      o.itinerary_title,
      o.customer_name,
      o.customer_id,
      COALESCE(NULLIF(o.contact_phone, ''), o.customer_phone) AS customer_phone,
      o.distributor_uid,
      p.method AS payment_method,
      p.trade_no
    FROM platform_collection_payables pc
    INNER JOIN orders o
      ON o.tenant_slug = pc.tenant_slug
     AND o.order_id = pc.order_id
    INNER JOIN payment_attempts p
      ON p.tenant_slug = pc.tenant_slug
     AND p.id = pc.payment_attempt_id
    WHERE ${where}
    ORDER BY pc.created_at DESC
    LIMIT ?
  `).bind(...binds, parseLimit(url.searchParams.get('limit'))).all();

  return json({ success: true, data: rows.results || [], tenantSlug: context.tenantSlug });
}

export function isPlatformSettlementCustomerViewRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  return request.method === 'GET' && path === '/api/v2/platform-settlements/payables';
}

export async function routePlatformSettlementCustomerView(request, env) {
  try {
    return await listPayables(request, env);
  } catch (error) {
    const code = String(error?.message || error || 'PLATFORM_SETTLEMENT_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}
