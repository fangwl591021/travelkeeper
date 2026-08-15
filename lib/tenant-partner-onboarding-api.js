import { requestedTenantSlug, requireTenantContext } from './tenant-context.js';
import {
  partnerInviteSecret,
  signPartnerInviteToken,
  verifyPartnerInviteToken,
} from './partner-invite-token.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function statusFor(code) {
  return {
    AUTH_REQUIRED: 401,
    TENANT_ACCESS_DENIED: 403,
    TENANT_ROLE_DENIED: 403,
    TENANT_NOT_FOUND: 404,
    DISTRIBUTOR_NOT_FOUND: 404,
    PARTNER_REFERRER_NOT_FOUND: 404,
    PARTNER_APPLICATION_ALREADY_ACTIVE: 409,
    PARTNER_APPLICATION_STATUS_CONFLICT: 409,
    PARTNER_INVITE_CODE_CONFLICT: 409,
    PARTNER_INVITE_SIGNING_NOT_CONFIGURED: 503,
    INVALID_PARTNER_INVITE_TOKEN: 400,
    EXPIRED_PARTNER_INVITE_TOKEN: 400,
    PARTNER_INVITE_CONTEXT_MISMATCH: 403,
    PARTNER_APPLICATION_NAME_REQUIRED: 400,
    D1_REQUIRED: 503,
  }[code] || 400;
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value || '')),
  ));
  return Array.from(bytes, item => item.toString(16).padStart(2, '0')).join('');
}

async function generatedInviteCode(tenantSlug, userUid) {
  const hash = await sha256Hex(`${tenantSlug}:${userUid}`);
  return `P${hash.slice(0, 10).toUpperCase()}`;
}

async function tenantExists(env, tenantSlug) {
  return env.DB.prepare(`SELECT slug FROM tenants WHERE slug = ? LIMIT 1`)
    .bind(tenantSlug).first();
}

async function loadApplication(env, tenantSlug, userUid) {
  return env.DB.prepare(`
    SELECT
      m.tenant_slug,
      m.user_uid,
      m.role,
      m.status,
      m.permissions_json,
      m.created_at,
      m.updated_at,
      p.display_name,
      p.phone,
      p.email,
      p.company_name,
      p.avatar,
      p.invite_code,
      p.ref_uid,
      p.joined_at
    FROM tenant_memberships m
    LEFT JOIN tenant_distributor_profiles p
      ON p.tenant_slug = m.tenant_slug
     AND p.user_uid = m.user_uid
    WHERE m.tenant_slug = ? AND m.user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, userUid).first();
}

async function loadActiveReferrer(env, tenantSlug, refUid) {
  return env.DB.prepare(`
    SELECT m.user_uid, m.role, m.status, p.display_name, p.invite_code
    FROM tenant_memberships m
    LEFT JOIN tenant_distributor_profiles p
      ON p.tenant_slug = m.tenant_slug
     AND p.user_uid = m.user_uid
    WHERE m.tenant_slug = ?
      AND m.user_uid = ?
      AND m.status = 'active'
      AND m.role IN ('sales', 'editor')
    LIMIT 1
  `).bind(tenantSlug, refUid).first();
}

function stateForApplication(row) {
  if (!row) return 'none';
  if (row.status === 'active') return 'approved';
  if (row.status === 'invited') return 'pending';
  return row.status || 'unknown';
}

function publicApplication(row) {
  if (!row) return { state: 'none' };
  return {
    state: stateForApplication(row),
    role: row.role || '',
    status: row.status || '',
    display_name: row.display_name || '',
    company_name: row.company_name || '',
    invite_code: row.invite_code || '',
    has_referrer: Boolean(text(row.ref_uid, 120)),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

async function resolvePartnerInvite(env, tenantSlug, token) {
  if (!token) return { refUid: '', source: 'generic_application', jti: '' };
  const verified = await verifyPartnerInviteToken(
    partnerInviteSecret(env),
    token,
    { tenant_slug: tenantSlug },
  );
  if (!verified.ok) throw new Error(verified.error);
  const refUid = text(verified.claims?.ref_uid, 120);
  const referrer = await loadActiveReferrer(env, tenantSlug, refUid);
  if (!referrer) throw new Error('PARTNER_REFERRER_NOT_FOUND');
  return {
    refUid,
    source: 'signed_partner_invite',
    jti: text(verified.claims?.jti, 80),
    referrer,
  };
}

async function mirrorDemoLegacy(request, env, legacyWorker, application) {
  if (application.tenantSlug !== 'demo' || !legacyWorker?.fetch) return 'skipped';
  try {
    const url = new URL('/api/partner/register', request.url);
    url.searchParams.set('a', application.tenantSlug);
    const legacyRequest = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: application.userUid,
        name: application.displayName,
        phone: application.phone,
        company_name: application.companyName,
        avatar: application.avatar,
        ref_uid: application.refUid,
      }),
    });
    const response = await legacyWorker.fetch(legacyRequest, env, {});
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.success !== false) return 'mirrored';
    if (['already_pending', 'already_approved'].includes(String(payload?.error || ''))) return 'already_present';
    return 'failed';
  } catch (_) {
    return 'failed';
  }
}

async function getMyApplication(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const tenantSlug = requestedTenantSlug(request);
  const userUid = text(request.headers.get('x-user-uid'), 120);
  if (!userUid) throw new Error('AUTH_REQUIRED');
  if (!await tenantExists(env, tenantSlug)) throw new Error('TENANT_NOT_FOUND');
  const application = await loadApplication(env, tenantSlug, userUid);
  return json({ success: true, tenant_slug: tenantSlug, data: publicApplication(application) });
}

async function createApplication(request, env, legacyWorker) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const tenantSlug = requestedTenantSlug(request, body);
  const userUid = text(request.headers.get('x-user-uid'), 120);
  if (!userUid) throw new Error('AUTH_REQUIRED');
  if (!await tenantExists(env, tenantSlug)) throw new Error('TENANT_NOT_FOUND');

  const displayName = text(body.name ?? body.display_name ?? body.displayName, 200);
  const phone = text(body.phone, 80);
  const email = text(body.email, 200);
  const companyName = text(body.company_name ?? body.companyName, 200);
  const avatar = text(body.avatar ?? body.picture_url ?? body.pictureUrl, 1000);
  const partnerInviteToken = text(body.partner_invite_token ?? body.partnerInviteToken ?? body.pit, 2400);
  if (!displayName) throw new Error('PARTNER_APPLICATION_NAME_REQUIRED');

  const existing = await loadApplication(env, tenantSlug, userUid);
  if (existing?.status === 'active') throw new Error('PARTNER_APPLICATION_ALREADY_ACTIVE');
  if (existing && existing.status !== 'invited') throw new Error('PARTNER_APPLICATION_STATUS_CONFLICT');
  if (existing?.status === 'invited') {
    await env.DB.prepare(`
      UPDATE tenant_distributor_profiles
      SET display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
          phone = CASE WHEN ? <> '' THEN ? ELSE phone END,
          email = CASE WHEN ? <> '' THEN ? ELSE email END,
          company_name = CASE WHEN ? <> '' THEN ? ELSE company_name END,
          avatar = CASE WHEN ? <> '' THEN ? ELSE avatar END,
          updated_at = datetime('now')
      WHERE tenant_slug = ? AND user_uid = ?
    `).bind(
      displayName, displayName,
      phone, phone,
      email, email,
      companyName, companyName,
      avatar, avatar,
      tenantSlug, userUid,
    ).run();
    return json({
      success: true,
      tenant_slug: tenantSlug,
      idempotent: true,
      data: publicApplication(await loadApplication(env, tenantSlug, userUid)),
    });
  }

  const invitation = await resolvePartnerInvite(env, tenantSlug, partnerInviteToken);
  const inviteCode = await generatedInviteCode(tenantSlug, userUid);
  const auditId = `AUDIT-PARTNER-APPLY-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO tenant_memberships (
          tenant_slug, user_uid, role, status, permissions_json, created_at, updated_at
        ) VALUES (?, ?, 'sales', 'invited', '[]', datetime('now'), datetime('now'))
      `).bind(tenantSlug, userUid),
      env.DB.prepare(`
        INSERT INTO tenant_distributor_profiles (
          tenant_slug, user_uid, display_name, phone, email, company_name,
          avatar, invite_code, ref_uid, joined_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
      `).bind(
        tenantSlug,
        userUid,
        displayName,
        phone,
        email,
        companyName,
        avatar,
        inviteCode,
        invitation.refUid,
      ),
      env.DB.prepare(`
        INSERT INTO audit_logs (
          id, tenant_slug, actor_uid, action, target_type, target_id,
          before_json, after_json, request_id, created_at
        ) VALUES (?, ?, ?, 'partner.application.created', 'tenant_membership', ?, '{}', ?, ?, datetime('now'))
      `).bind(
        auditId,
        tenantSlug,
        userUid,
        userUid,
        JSON.stringify({
          role: 'sales',
          status: 'invited',
          ref_uid: invitation.refUid,
          source: invitation.source,
          invite_jti: invitation.jti,
        }),
        auditId,
      ),
    ]);
  } catch (error) {
    const message = String(error?.message || error || '');
    if (/invite/i.test(message) && /unique|constraint/i.test(message)) {
      throw new Error('PARTNER_INVITE_CODE_CONFLICT');
    }
    throw error;
  }

  const legacyMirror = await mirrorDemoLegacy(request, env, legacyWorker, {
    tenantSlug,
    userUid,
    displayName,
    phone,
    companyName,
    avatar,
    refUid: invitation.refUid,
  });

  return json({
    success: true,
    tenant_slug: tenantSlug,
    idempotent: false,
    legacy_mirror: legacyMirror,
    data: publicApplication(await loadApplication(env, tenantSlug, userUid)),
  }, 201);
}

async function createPartnerInvite(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const context = await requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: text(request.headers.get('x-user-uid'), 120),
    allowedRoles: ['sales', 'editor'],
  });
  const referrer = await loadActiveReferrer(env, context.tenantSlug, context.userUid);
  if (!referrer) throw new Error('DISTRIBUTOR_NOT_FOUND');

  const ttlSeconds = 60 * 60 * 24 * 30;
  const token = await signPartnerInviteToken(
    partnerInviteSecret(env),
    {
      tenant_slug: context.tenantSlug,
      ref_uid: context.userUid,
      invite_code: referrer.invite_code || '',
      ttl_seconds: ttlSeconds,
    },
  );

  return json({
    success: true,
    tenant_slug: context.tenantSlug,
    data: {
      partner_invite_token: token,
      query_param: 'pit',
      ref_uid: context.userUid,
      invite_code: referrer.invite_code || '',
      expires_in_seconds: ttlSeconds,
    },
  });
}

export function isTenantPartnerOnboardingApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return path === '/api/v2/partner-applications' ||
    path === '/api/v2/partner-applications/me' ||
    path === '/api/v2/partner-invites';
}

export async function routeTenantPartnerOnboardingApi(request, env, legacyWorker = null) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    if (request.method === 'GET' && path === '/api/v2/partner-applications/me') {
      return await getMyApplication(request, env);
    }
    if (request.method === 'POST' && path === '/api/v2/partner-applications') {
      return await createApplication(request, env, legacyWorker);
    }
    if (request.method === 'POST' && path === '/api/v2/partner-invites') {
      return await createPartnerInvite(request, env);
    }
    return json({ success: false, error: 'TENANT_PARTNER_ONBOARDING_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_PARTNER_ONBOARDING_ERROR');
    return json({ success: false, error: code }, statusFor(code));
  }
}
