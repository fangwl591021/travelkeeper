const DEFAULT_TENANT_SLUG = 'demo';

export function normalizeTenantSlug(value, fallback = DEFAULT_TENANT_SLUG) {
  const slug = String(value || '').trim().toLowerCase();
  if (!slug) return fallback;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error('INVALID_TENANT_SLUG');
  }
  return slug;
}

function tenantFromReferer(request) {
  const referer = String(request.headers.get('referer') || '').trim();
  if (!referer) return '';
  try {
    const url = new URL(referer);
    return url.searchParams.get('tenant') ||
      url.searchParams.get('tenant_slug') ||
      url.searchParams.get('a') ||
      '';
  } catch (_) {
    return '';
  }
}

export function requestedTenantSlug(request, body = null) {
  const url = new URL(request.url);
  return normalizeTenantSlug(
    request.headers.get('x-tenant-slug') ||
    body?.tenant_slug ||
    body?.tenantSlug ||
    url.searchParams.get('tenant') ||
    url.searchParams.get('tenant_slug') ||
    url.searchParams.get('a') ||
    tenantFromReferer(request) ||
    DEFAULT_TENANT_SLUG
  );
}

function parseUidList(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map(uid => uid.trim())
    .filter(Boolean);
}

export async function getTenantMembership(env, tenantSlug, userUid) {
  const tenant = normalizeTenantSlug(tenantSlug);
  const uid = String(userUid || '').trim();
  if (!uid) return null;

  const direct = await env.DB.prepare(`
    SELECT tenant_slug, user_uid, role, status, permissions_json
    FROM tenant_memberships
    WHERE tenant_slug = ? AND user_uid = ?
    LIMIT 1
  `).bind(tenant, uid).first();
  if (direct) return direct;

  const envPlatformAdmins = new Set([
    ...parseUidList(env.PLATFORM_ADMIN_UIDS),
    ...parseUidList(env.ADMIN_UIDS),
    ...parseUidList(env.ADMIN_UID_WHITELIST),
  ]);
  if (envPlatformAdmins.has(uid)) {
    return {
      tenant_slug: tenant,
      source_tenant_slug: 'environment',
      user_uid: uid,
      role: 'platform_admin',
      status: 'active',
      permissions_json: '["*"]',
    };
  }

  const platformAdmin = await env.DB.prepare(`
    SELECT tenant_slug, user_uid, role, status, permissions_json
    FROM tenant_memberships
    WHERE user_uid = ? AND role = 'platform_admin' AND status = 'active'
    LIMIT 1
  `).bind(uid).first();

  if (!platformAdmin) return null;
  return {
    ...platformAdmin,
    source_tenant_slug: platformAdmin.tenant_slug,
    tenant_slug: tenant,
  };
}

export function parsePermissions(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch (_) {
    return [];
  }
}

export async function requireTenantContext(env, {
  tenantSlug,
  userUid,
  allowedRoles = [],
  requiredPermission = '',
  platformAdmin = false,
} = {}) {
  if (!env.DB) throw new Error('D1_REQUIRED');

  const tenant = normalizeTenantSlug(tenantSlug);
  const uid = String(userUid || '').trim();
  if (!uid) throw new Error('AUTH_REQUIRED');

  const tenantExists = await env.DB.prepare(
    `SELECT slug FROM tenants WHERE slug = ? LIMIT 1`
  ).bind(tenant).first();
  if (!tenantExists) throw new Error('TENANT_NOT_FOUND');

  const membership = await getTenantMembership(env, tenant, uid);
  if (!membership || membership.status !== 'active') {
    throw new Error('TENANT_ACCESS_DENIED');
  }

  if (platformAdmin && membership.role !== 'platform_admin') {
    throw new Error('PLATFORM_ADMIN_REQUIRED');
  }

  if (allowedRoles.length && !allowedRoles.includes(membership.role)) {
    throw new Error('TENANT_ROLE_DENIED');
  }

  const permissions = parsePermissions(membership.permissions_json);
  if (requiredPermission && !permissions.includes('*') && !permissions.includes(requiredPermission)) {
    throw new Error('TENANT_PERMISSION_DENIED');
  }

  return {
    tenantSlug: tenant,
    userUid: uid,
    role: membership.role,
    permissions,
    membership,
  };
}

export function tenantWhere(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}tenant_slug = ?`;
}

export function tenantPayload(context, data = {}) {
  if (!context?.tenantSlug) throw new Error('TENANT_CONTEXT_REQUIRED');
  return {
    ...data,
    tenant_slug: context.tenantSlug,
  };
}
