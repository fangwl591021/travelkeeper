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
  return String(
    request.headers.get('x-user-uid') ||
    body?.user_uid || body?.userUid || body?.uid || '',
  ).trim();
}

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

async function contextFor(request, env, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles: ['platform_admin', 'tenant_admin', 'editor', 'sales'],
  });
}

async function loadProfile(env, tenantSlug, userUid) {
  return env.DB.prepare(`
    SELECT *
    FROM tenant_distributor_profiles
    WHERE tenant_slug = ? AND user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, userUid).first();
}

async function getProfile(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const context = await contextFor(request, env);
  return json({
    success: true,
    data: await loadProfile(env, context.tenantSlug, context.userUid),
    tenantSlug: context.tenantSlug,
  });
}

async function updateProfile(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const context = await contextFor(request, env, body);
  const current = await loadProfile(env, context.tenantSlug, context.userUid);

  const fields = {
    display_name: clean(body.display_name ?? body.displayName ?? current?.display_name, 120),
    phone: clean(body.phone ?? current?.phone, 40),
    email: clean(body.email ?? current?.email, 180),
    company_name: clean(body.company_name ?? body.companyName ?? current?.company_name, 180),
    avatar: clean(body.avatar ?? current?.avatar, 1000),
    bio: clean(body.bio ?? current?.bio, 2000),
    oa_intro: clean(body.oa_intro ?? body.oaIntro ?? current?.oa_intro, 2000),
    line_link: clean(body.line_link ?? body.lineLink ?? current?.line_link, 1000),
    line_at_link: clean(body.line_at_link ?? body.lineAtLink ?? current?.line_at_link, 1000),
    line_at_id: clean(body.line_at_id ?? body.lineAtId ?? current?.line_at_id, 100),
    fb_link: clean(body.fb_link ?? body.fbLink ?? current?.fb_link, 1000),
    ig_link: clean(body.ig_link ?? body.igLink ?? current?.ig_link, 1000),
    web_link: clean(body.web_link ?? body.webLink ?? current?.web_link, 1000),
    map_link: clean(body.map_link ?? body.mapLink ?? current?.map_link, 1000),
  };

  await env.DB.prepare(`
    INSERT INTO tenant_distributor_profiles (
      tenant_slug, user_uid, display_name, phone, email, company_name,
      avatar, bio, oa_intro, line_link, line_at_link, line_at_id,
      fb_link, ig_link, web_link, map_link, invite_code, commission_pct,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_slug, user_uid) DO UPDATE SET
      display_name = excluded.display_name,
      phone = excluded.phone,
      email = excluded.email,
      company_name = excluded.company_name,
      avatar = excluded.avatar,
      bio = excluded.bio,
      oa_intro = excluded.oa_intro,
      line_link = excluded.line_link,
      line_at_link = excluded.line_at_link,
      line_at_id = excluded.line_at_id,
      fb_link = excluded.fb_link,
      ig_link = excluded.ig_link,
      web_link = excluded.web_link,
      map_link = excluded.map_link,
      updated_at = datetime('now')
  `).bind(
    context.tenantSlug,
    context.userUid,
    fields.display_name,
    fields.phone,
    fields.email,
    fields.company_name,
    fields.avatar,
    fields.bio,
    fields.oa_intro,
    fields.line_link,
    fields.line_at_link,
    fields.line_at_id,
    fields.fb_link,
    fields.ig_link,
    fields.web_link,
    fields.map_link,
    clean(current?.invite_code, 80),
    Number(current?.commission_pct || 0),
  ).run();

  return json({
    success: true,
    data: await loadProfile(env, context.tenantSlug, context.userUid),
    tenantSlug: context.tenantSlug,
  });
}

export function isTenantProfileApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return path === '/api/v2/tenant/profile';
}

export async function routeTenantProfileApi(request, env) {
  try {
    if (request.method === 'GET') return await getProfile(request, env);
    if (request.method === 'POST') return await updateProfile(request, env);
    return json({ success: false, error: 'TENANT_PROFILE_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_PROFILE_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}
