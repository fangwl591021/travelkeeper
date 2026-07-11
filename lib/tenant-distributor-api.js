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
  return String(request.headers.get('x-user-uid') || body?.uid || body?.user_uid || '').trim();
}

async function requireAdmin(request, env, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles: ['platform_admin', 'tenant_admin'],
  });
}

function toView(row = {}) {
  const approved = row.status === 'active';
  const canUpload = row.role === 'editor';
  return {
    ...row,
    uid: row.user_uid || '',
    name: row.display_name || '',
    displayName: row.display_name || '',
    inviteCode: row.invite_code || '',
    invitecode: row.invite_code || '',
    commission: Number(row.commission_pct || 0),
    commissionPct: Number(row.commission_pct || 0),
    status: approved ? 'approved' : row.status,
    canUpload: canUpload,
    canupload: canUpload ? 'Y' : 'N',
  };
}

async function listDistributors(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const context = await requireAdmin(request, env);
  const rows = await env.DB.prepare(`
    SELECT
      m.tenant_slug,
      m.user_uid,
      m.role,
      m.status,
      m.permissions_json,
      p.display_name,
      p.phone,
      p.email,
      p.company_name,
      p.avatar,
      p.bio,
      p.oa_intro,
      p.line_link,
      p.line_at_link,
      p.line_at_id,
      p.fb_link,
      p.ig_link,
      p.web_link,
      p.map_link,
      p.invite_code,
      p.commission_pct,
      m.created_at,
      m.updated_at
    FROM tenant_memberships m
    LEFT JOIN tenant_distributor_profiles p
      ON p.tenant_slug = m.tenant_slug
     AND p.user_uid = m.user_uid
    WHERE m.tenant_slug = ?
      AND m.role IN ('sales', 'editor')
    ORDER BY CASE m.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END,
             m.updated_at DESC
  `).bind(context.tenantSlug).all();
  return json({ success: true, data: (rows.results || []).map(toView), tenantSlug: context.tenantSlug });
}

async function loadMembership(env, tenantSlug, userUid) {
  return env.DB.prepare(`
    SELECT tenant_slug, user_uid, role, status, permissions_json, created_at, updated_at
    FROM tenant_memberships
    WHERE tenant_slug = ? AND user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, userUid).first();
}

async function updateStatus(request, env, targetUid) {
  const body = await request.json().catch(() => ({}));
  const context = await requireAdmin(request, env, body);
  const current = await loadMembership(env, context.tenantSlug, targetUid);
  if (!current || !['sales', 'editor'].includes(current.role)) throw new Error('DISTRIBUTOR_NOT_FOUND');
  const requested = String(body.status || '').trim().toLowerCase();
  const status = requested === 'approved' ? 'active' : requested === 'pending' ? 'invited' : requested;
  if (!['invited', 'active', 'suspended', 'revoked'].includes(status)) throw new Error('INVALID_DISTRIBUTOR_STATUS');
  await env.DB.prepare(`
    UPDATE tenant_memberships
    SET status = ?, updated_at = datetime('now')
    WHERE tenant_slug = ? AND user_uid = ? AND role IN ('sales', 'editor')
  `).bind(status, context.tenantSlug, targetUid).run();
  const profile = await env.DB.prepare(`
    SELECT m.*, p.*
    FROM tenant_memberships m
    LEFT JOIN tenant_distributor_profiles p
      ON p.tenant_slug = m.tenant_slug AND p.user_uid = m.user_uid
    WHERE m.tenant_slug = ? AND m.user_uid = ?
  `).bind(context.tenantSlug, targetUid).first();
  return json({ success: true, data: toView(profile), tenantSlug: context.tenantSlug });
}

async function updateUpload(request, env, targetUid) {
  const body = await request.json().catch(() => ({}));
  const context = await requireAdmin(request, env, body);
  const current = await loadMembership(env, context.tenantSlug, targetUid);
  if (!current || !['sales', 'editor'].includes(current.role)) throw new Error('DISTRIBUTOR_NOT_FOUND');
  const enabled = body.can_upload === true || body.canUpload === true || body.can_upload === 1 || body.canUpload === 1 || body.can_upload === '1' || body.canUpload === '1';
  await env.DB.prepare(`
    UPDATE tenant_memberships
    SET role = ?, updated_at = datetime('now')
    WHERE tenant_slug = ? AND user_uid = ? AND role IN ('sales', 'editor')
  `).bind(enabled ? 'editor' : 'sales', context.tenantSlug, targetUid).run();
  const profile = await env.DB.prepare(`
    SELECT m.*, p.*
    FROM tenant_memberships m
    LEFT JOIN tenant_distributor_profiles p
      ON p.tenant_slug = m.tenant_slug AND p.user_uid = m.user_uid
    WHERE m.tenant_slug = ? AND m.user_uid = ?
  `).bind(context.tenantSlug, targetUid).first();
  return json({ success: true, data: toView(profile), tenantSlug: context.tenantSlug });
}

export function isTenantDistributorApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return path === '/api/v2/distributors' || /^\/api\/v2\/distributors\/[^/]+\/(status|upload)$/.test(path);
}

export async function routeTenantDistributorApi(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/api/v2/distributors' && request.method === 'GET') return await listDistributors(request, env);
    const statusMatch = path.match(/^\/api\/v2\/distributors\/([^/]+)\/status$/);
    if (statusMatch && request.method === 'POST') return await updateStatus(request, env, decodeURIComponent(statusMatch[1]));
    const uploadMatch = path.match(/^\/api\/v2\/distributors\/([^/]+)\/upload$/);
    if (uploadMatch && request.method === 'POST') return await updateUpload(request, env, decodeURIComponent(uploadMatch[1]));
    return json({ success: false, error: 'TENANT_DISTRIBUTOR_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_DISTRIBUTOR_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}
