import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function errorStatus(code) {
  return {
    AUTH_REQUIRED: 401,
    TENANT_ACCESS_DENIED: 403,
    TENANT_ROLE_DENIED: 403,
    TENANT_PERMISSION_DENIED: 403,
    PLATFORM_ADMIN_REQUIRED: 403,
    TENANT_NOT_FOUND: 404,
    ITINERARY_NOT_FOUND: 404,
    INVITE_CODE_NOT_FOUND: 404,
    INVALID_TENANT_SLUG: 400,
    D1_REQUIRED: 503,
  }[code] || 400;
}

function parseLimit(value) {
  const n = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(n), MAX_LIMIT));
}

function requestUid(request, body = null) {
  const url = new URL(request.url);
  return String(
    request.headers.get('x-user-uid') ||
    body?.user_uid ||
    body?.userUid ||
    body?.uid ||
    body?.operatorUid ||
    url.searchParams.get('uid') ||
    url.searchParams.get('user_uid') ||
    ''
  ).trim();
}

function hasPermission(context, permission) {
  if (!permission) return true;
  return context.permissions.includes('*') || context.permissions.includes(permission);
}

function canReadAllOrders(context) {
  return ['platform_admin', 'tenant_admin', 'finance', 'support'].includes(context.role) ||
    hasPermission(context, 'order.read.all');
}

function canReadAllCustomers(context) {
  return ['platform_admin', 'tenant_admin', 'support'].includes(context.role) ||
    hasPermission(context, 'customer.read.all');
}

function canReadFinance(context) {
  return ['platform_admin', 'tenant_admin', 'finance'].includes(context.role) ||
    hasPermission(context, 'payment.read');
}

async function requireContext(request, env, options = {}, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    ...options,
  });
}

function toPublicItinerary(row) {
  return {
    id: row.id,
    title: row.title || '',
    region: row.region || '',
    price: Number(row.price || 0),
    days: Number(row.days || 0),
    image: row.image || '',
    description: row.description || '',
    notes: row.notes || '',
    paymentMode: row.payment_mode || 'deposit',
    paymentmode: row.payment_mode || 'deposit',
    depositRatio: Number(row.deposit_ratio || 20),
    depositratio: Number(row.deposit_ratio || 20),
    depositAmount: Number(row.deposit_amount || 0),
    depositamount: Number(row.deposit_amount || 0),
    balanceCollect: row.balance_collect || 'online',
    balancecollect: row.balance_collect || 'online',
    expireAt: row.expire_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function toTenantOrder(row = {}) {
  return {
    ...row,
    customer_key: row.customer_phone || '',
    customer_phone: row.contact_phone || row.customer_phone || '',
    customer_id: row.customer_id || '',
  };
}

function toTenantCustomer(row = {}) {
  return {
    ...row,
    customer_key: row.customer_phone || '',
    customer_phone: row.contact_phone || row.customer_phone || '',
    customer_id: row.customer_id || '',
  };
}

async function getPublicTenant(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const tenantSlug = requestedTenantSlug(request);
  const tenant = await env.DB.prepare(`
    SELECT slug, name, liff_id, created_at, updated_at
    FROM tenants
    WHERE slug = ?
    LIMIT 1
  `).bind(tenantSlug).first();

  if (!tenant) return json({ success: false, error: 'TENANT_NOT_FOUND' }, 404);
  return json({ success: true, data: tenant, tenantSlug });
}

async function getTenantContext(request, env) {
  const context = await requireContext(request, env);
  const tenant = await env.DB.prepare(
    `SELECT slug, name, liff_id, created_at, updated_at FROM tenants WHERE slug = ? LIMIT 1`
  ).bind(context.tenantSlug).first();
  const profile = await env.DB.prepare(`
    SELECT display_name, phone, email, company_name, avatar, invite_code, commission_pct
    FROM tenant_distributor_profiles
    WHERE tenant_slug = ? AND user_uid = ?
    LIMIT 1
  `).bind(context.tenantSlug, context.userUid).first().catch(() => null);

  return json({
    success: true,
    data: {
      tenant,
      profile: profile || null,
      tenantSlug: context.tenantSlug,
      userUid: context.userUid,
      role: context.role,
      permissions: context.permissions,
      authMode: request.headers.get('x-tenant-auth-mode') || 'line_access_token',
    },
  });
}

async function resolveInvite(request, env, inviteCode) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const tenantSlug = requestedTenantSlug(request);
  const code = String(inviteCode || '').trim().toUpperCase();
  if (!code) return json({ success: false, error: 'INVITE_CODE_NOT_FOUND' }, 404);

  const row = await env.DB.prepare(`
    SELECT
      p.user_uid AS uid,
      p.display_name AS name,
      p.invite_code AS inviteCode,
      p.avatar,
      p.phone,
      m.role,
      m.status
    FROM tenant_distributor_profiles p
    INNER JOIN tenant_memberships m
      ON m.tenant_slug = p.tenant_slug
     AND m.user_uid = p.user_uid
    WHERE p.tenant_slug = ?
      AND upper(p.invite_code) = ?
      AND m.status = 'active'
    LIMIT 1
  `).bind(tenantSlug, code).first();

  if (!row) return json({ success: false, error: 'INVITE_CODE_NOT_FOUND' }, 404);
  return json({
    success: true,
    data: {
      uid: row.uid,
      name: row.name || '夥伴',
      inviteCode: row.inviteCode || code,
      avatar: row.avatar || '',
      phone: row.phone || '',
      role: row.role || 'sales',
      tenantSlug,
    },
  });
}

async function listItineraries(request, env) {
  const url = new URL(request.url);
  const tenantSlug = requestedTenantSlug(request);
  const scope = String(url.searchParams.get('scope') || 'public').toLowerCase();
  const limit = parseLimit(url.searchParams.get('limit'));
  const binds = [tenantSlug];
  let where = `tenant_slug = ? AND (deleted_at IS NULL OR deleted_at = '')`;

  if (scope === 'public') {
    where += ` AND review_status = 'published'`;
    where += ` AND (expire_at IS NULL OR expire_at = '' OR expire_at >= date('now', '+8 hours'))`;
  } else {
    await requireContext(request, env, {
      allowedRoles: ['platform_admin', 'tenant_admin', 'editor', 'sales', 'finance', 'support', 'member'],
    });

    const owner = String(url.searchParams.get('owner') || '').trim();
    const status = String(url.searchParams.get('status') || '').trim();
    if (owner) {
      where += ' AND owner_uid = ?';
      binds.push(owner);
    }
    if (status) {
      where += ' AND review_status = ?';
      binds.push(status);
    }
  }

  const { results } = await env.DB.prepare(`
    SELECT *
    FROM itineraries
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({
    success: true,
    data: (results || []).map(toPublicItinerary),
    tenantSlug,
  });
}

async function getItinerary(request, env, itineraryId) {
  const url = new URL(request.url);
  const tenantSlug = requestedTenantSlug(request);
  const scope = String(url.searchParams.get('scope') || 'public').toLowerCase();
  let query = `SELECT * FROM itineraries WHERE tenant_slug = ? AND id = ? AND (deleted_at IS NULL OR deleted_at = '')`;
  const binds = [tenantSlug, itineraryId];

  if (scope === 'public') {
    query += ` AND review_status = 'published'`;
    query += ` AND (expire_at IS NULL OR expire_at = '' OR expire_at >= date('now', '+8 hours'))`;
  } else {
    await requireContext(request, env);
  }

  const row = await env.DB.prepare(`${query} LIMIT 1`).bind(...binds).first();
  if (!row) return json({ success: false, error: 'ITINERARY_NOT_FOUND' }, 404);
  return json({ success: true, data: toPublicItinerary(row), tenantSlug });
}

async function listOrders(request, env) {
  const url = new URL(request.url);
  const context = await requireContext(request, env);
  const limit = parseLimit(url.searchParams.get('limit'));
  const binds = [context.tenantSlug];
  let where = 'tenant_slug = ?';

  if (!canReadAllOrders(context)) {
    where += ' AND distributor_uid = ?';
    binds.push(context.userUid);
  }

  const status = String(url.searchParams.get('status') || '').trim();
  const customerPhone = String(url.searchParams.get('customer_phone') || '').trim();
  const distributorUid = String(url.searchParams.get('distributor_uid') || '').trim();
  if (status) {
    where += ' AND status = ?';
    binds.push(status);
  }
  if (customerPhone) {
    where += ` AND COALESCE(NULLIF(contact_phone, ''), customer_phone) = ?`;
    binds.push(customerPhone);
  }
  if (distributorUid && canReadAllOrders(context)) {
    where += ' AND distributor_uid = ?';
    binds.push(distributorUid);
  }

  const { results } = await env.DB.prepare(`
    SELECT *
    FROM orders
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({ success: true, data: (results || []).map(toTenantOrder), tenantSlug: context.tenantSlug });
}

async function listCustomers(request, env) {
  const url = new URL(request.url);
  const context = await requireContext(request, env);
  const limit = parseLimit(url.searchParams.get('limit'));
  const binds = [context.tenantSlug];
  let where = 'tenant_slug = ?';

  if (!canReadAllCustomers(context)) {
    where += ' AND owner_uid = ?';
    binds.push(context.userUid);
  }

  const phone = String(url.searchParams.get('phone') || '').trim();
  if (phone) {
    where += ` AND COALESCE(NULLIF(contact_phone, ''), customer_phone) = ?`;
    binds.push(phone);
  }

  const { results } = await env.DB.prepare(`
    SELECT *
    FROM customers
    WHERE ${where}
    ORDER BY last_order_at DESC, updated_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({ success: true, data: (results || []).map(toTenantCustomer), tenantSlug: context.tenantSlug });
}

async function listPayments(request, env) {
  const url = new URL(request.url);
  const context = await requireContext(request, env);
  if (!canReadFinance(context)) throw new Error('TENANT_ROLE_DENIED');

  const limit = parseLimit(url.searchParams.get('limit'));
  const status = String(url.searchParams.get('status') || '').trim();
  const binds = [context.tenantSlug];
  let where = 'p.tenant_slug = ? AND o.tenant_slug = p.tenant_slug';
  if (status) {
    where += ' AND p.status = ?';
    binds.push(status);
  }

  const { results } = await env.DB.prepare(`
    SELECT
      p.*,
      o.itinerary_title,
      o.customer_name,
      o.customer_id,
      COALESCE(NULLIF(o.contact_phone, ''), o.customer_phone) AS customer_phone,
      o.distributor_uid
    FROM payment_attempts p
    INNER JOIN orders o ON o.order_id = p.order_id
    WHERE ${where}
    ORDER BY p.created_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({ success: true, data: results || [], tenantSlug: context.tenantSlug });
}

async function updateOrderStatus(request, env, orderId) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, {
    allowedRoles: ['platform_admin', 'tenant_admin', 'finance', 'support'],
  }, body);
  const status = String(body.status || '').trim().toLowerCase();
  const allowed = new Set(['pending', 'confirmed', 'completed', 'cancelled']);
  if (!allowed.has(status)) return json({ success: false, error: 'INVALID_ORDER_STATUS' }, 400);

  const result = await env.DB.prepare(`
    UPDATE orders
    SET status = ?, updated_at = datetime('now')
    WHERE tenant_slug = ? AND order_id = ?
  `).bind(status, context.tenantSlug, orderId).run();

  if (!Number(result.meta?.changes || 0)) {
    return json({ success: false, error: 'ORDER_NOT_FOUND' }, 404);
  }
  return json({ success: true, data: { orderId, status }, tenantSlug: context.tenantSlug });
}

export async function routeTenantApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (request.method === 'GET' && path === '/api/v2/tenant/public') {
      return await getPublicTenant(request, env);
    }
    if (request.method === 'GET' && path === '/api/v2/tenant/context') {
      return await getTenantContext(request, env);
    }
    if (request.method === 'GET' && path === '/api/v2/itineraries') {
      return await listItineraries(request, env);
    }
    const itineraryMatch = path.match(/^\/api\/v2\/itineraries\/([^/]+)$/);
    if (request.method === 'GET' && itineraryMatch) {
      return await getItinerary(request, env, decodeURIComponent(itineraryMatch[1]));
    }
    const inviteMatch = path.match(/^\/api\/v2\/invites\/([^/]+)$/);
    if (request.method === 'GET' && inviteMatch) {
      return await resolveInvite(request, env, decodeURIComponent(inviteMatch[1]));
    }
    if (request.method === 'GET' && path === '/api/v2/orders') {
      return await listOrders(request, env);
    }
    if (request.method === 'GET' && path === '/api/v2/customers') {
      return await listCustomers(request, env);
    }
    if (request.method === 'GET' && path === '/api/v2/payments') {
      return await listPayments(request, env);
    }
    const orderStatusMatch = path.match(/^\/api\/v2\/orders\/([^/]+)\/status$/);
    if (request.method === 'POST' && orderStatusMatch) {
      return await updateOrderStatus(request, env, decodeURIComponent(orderStatusMatch[1]));
    }

    return json({ success: false, error: 'TENANT_API_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_API_ERROR');
    return json({ success: false, error: code }, errorStatus(code));
  }
}

export function isTenantApiRequest(request) {
  return new URL(request.url).pathname.startsWith('/api/v2/');
}
