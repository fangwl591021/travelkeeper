import { requestedTenantSlug } from './tenant-context.js';
import { referralTokenSecret, verifyReferralToken } from './referral-token.js';
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

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function attributionStatus(code) {
  if (code === 'REFERRAL_SIGNING_NOT_CONFIGURED') return 503;
  if (code === 'REFERRAL_TOKEN_CONTEXT_MISMATCH') return 403;
  if (code === 'INVALID_REFERRAL_TOKEN' || code === 'EXPIRED_REFERRAL_TOKEN') return 400;
  return statusForError(code, 400);
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value || '')),
  ));
  return Array.from(bytes, item => item.toString(16).padStart(2, '0')).join('');
}

async function loadActiveDistributor(env, tenantSlug, distributorUid) {
  return env.DB.prepare(`
    SELECT p.user_uid, p.display_name, p.invite_code, m.role, m.status
    FROM tenant_distributor_profiles p
    INNER JOIN tenant_memberships m
      ON m.tenant_slug = p.tenant_slug
     AND m.user_uid = p.user_uid
    WHERE p.tenant_slug = ?
      AND p.user_uid = ?
      AND m.status = 'active'
      AND m.role IN ('sales', 'editor')
    LIMIT 1
  `).bind(tenantSlug, distributorUid).first();
}

async function loadFirstTouch(env, tenantSlug, lineUserUid) {
  return env.DB.prepare(`
    SELECT tenant_slug, line_user_uid, ref_uid, first_itinerary_id,
           first_share_id, referral_jti, source, captured_at
    FROM tenant_first_touch_attributions
    WHERE tenant_slug = ? AND line_user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, lineUserUid).first();
}

async function loadCustomerByLine(env, tenantSlug, lineUserUid) {
  return env.DB.prepare(`
    SELECT customer_id, customer_line_uid, owner_uid, owner_name, ref_uid
    FROM customers
    WHERE tenant_slug = ? AND customer_line_uid = ?
    LIMIT 1
  `).bind(tenantSlug, lineUserUid).first();
}

async function loadProfileByLine(env, tenantSlug, lineUserUid) {
  return env.DB.prepare(`
    SELECT id, customer_id, line_user_uid, ref_uid, owner_uid
    FROM tenant_crm_profiles
    WHERE tenant_slug = ? AND line_user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, lineUserUid).first();
}

async function loadCustomerById(env, tenantSlug, customerId) {
  if (!customerId) return null;
  return env.DB.prepare(`
    SELECT customer_id, customer_line_uid, owner_uid, owner_name, ref_uid
    FROM customers
    WHERE tenant_slug = ? AND customer_id = ?
    LIMIT 1
  `).bind(tenantSlug, customerId).first();
}

async function writeFirstTouch(env, {
  tenantSlug,
  lineUserUid,
  refUid,
  itineraryId,
  shareId,
  referralJti,
  source,
}) {
  return env.DB.prepare(`
    INSERT INTO tenant_first_touch_attributions (
      tenant_slug, line_user_uid, ref_uid, first_itinerary_id,
      first_share_id, referral_jti, source, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_slug, line_user_uid) DO NOTHING
  `).bind(
    tenantSlug,
    lineUserUid,
    refUid,
    itineraryId,
    shareId,
    referralJti,
    source,
  ).run();
}

async function ensureLeadProjection(env, {
  tenantSlug,
  lineUserUid,
  refUid,
  ownerUid,
}) {
  const hash = await sha256Hex(`${tenantSlug}:${lineUserUid}`);
  const id = `CRMTOUCH-${hash.slice(0, 32).toUpperCase()}`;
  await env.DB.prepare(`
    INSERT INTO tenant_crm_profiles (
      id, tenant_slug, customer_id, line_user_uid, ref_uid, owner_uid,
      source, status, risk, opportunity_stage,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, '', ?, ?, ?, 'line', 'open', 'low', 'new',
      'first-touch', 'first-touch', datetime('now'), datetime('now'))
    ON CONFLICT(tenant_slug, line_user_uid) WHERE line_user_uid <> '' DO UPDATE SET
      ref_uid = CASE
        WHEN tenant_crm_profiles.ref_uid = '' THEN excluded.ref_uid
        ELSE tenant_crm_profiles.ref_uid
      END,
      owner_uid = CASE
        WHEN tenant_crm_profiles.owner_uid = '' THEN excluded.owner_uid
        ELSE tenant_crm_profiles.owner_uid
      END,
      updated_by = 'first-touch',
      updated_at = datetime('now')
  `).bind(id, tenantSlug, lineUserUid, refUid, ownerUid).run();

  return loadProfileByLine(env, tenantSlug, lineUserUid);
}

async function projectToFormalCustomer(env, {
  tenantSlug,
  customer,
  refUid,
  ownerUid,
  ownerName,
}) {
  if (customer.ref_uid && customer.ref_uid !== refUid) {
    throw new Error('ATTRIBUTION_FIRST_TOUCH_CONFLICT');
  }

  await env.DB.prepare(`
    UPDATE customers
    SET ref_uid = CASE WHEN ref_uid = '' THEN ? ELSE ref_uid END,
        owner_uid = CASE WHEN COALESCE(owner_uid, '') = '' THEN ? ELSE owner_uid END,
        owner_name = CASE WHEN COALESCE(owner_uid, '') = '' THEN ? ELSE owner_name END,
        updated_at = datetime('now')
    WHERE tenant_slug = ? AND customer_id = ?
  `).bind(
    refUid,
    ownerUid,
    ownerName,
    tenantSlug,
    customer.customer_id,
  ).run();
}

async function auditNewFirstTouch(env, {
  tenantSlug,
  actorUid,
  targetType,
  targetId,
  refUid,
  itineraryId,
  shareId,
}) {
  const id = `AUDIT-FIRSTTOUCH-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
  await env.DB.prepare(`
    INSERT INTO audit_logs (
      id, tenant_slug, actor_uid, action, target_type, target_id,
      before_json, after_json, request_id, created_at
    ) VALUES (?, ?, ?, 'customer.attribution.first_touch', ?, ?, '{}', ?, ?, datetime('now'))
  `).bind(
    id,
    tenantSlug,
    'verified-line-user',
    targetType,
    targetId,
    JSON.stringify({
      ref_uid: refUid,
      itinerary_id: itineraryId,
      share_id: shareId,
      source: 'booking_landing',
    }),
    id,
  ).run();
}

async function captureFirstTouch(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const tenantSlug = requestedTenantSlug(request, body);
  const lineUserUid = text(request.headers.get('x-user-uid'), 120);
  if (!lineUserUid) throw new Error('AUTH_REQUIRED');

  const itineraryId = text(body.itinerary_id ?? body.itineraryId, 120);
  const referralToken = text(body.referral_token ?? body.referralToken, 2400);
  const shareId = text(body.share_id ?? body.shareId, 120);
  if (!itineraryId) throw new Error('ITINERARY_NOT_FOUND');
  if (!referralToken) throw new Error('REFERRAL_TOKEN_REQUIRED');

  const verified = await verifyReferralToken(
    referralTokenSecret(env),
    referralToken,
    { tenant_slug: tenantSlug, itinerary_id: itineraryId },
  );
  if (!verified.ok) throw new Error(verified.error);

  const tokenRefUid = text(verified.claims?.distributor_uid, 120);
  if (!tokenRefUid) throw new Error('INVALID_REFERRAL_TOKEN');
  const tokenDistributor = await loadActiveDistributor(env, tenantSlug, tokenRefUid);
  if (!tokenDistributor) throw new Error('DISTRIBUTOR_NOT_FOUND');

  const customerByLine = await loadCustomerByLine(env, tenantSlug, lineUserUid);
  const profileBefore = await loadProfileByLine(env, tenantSlug, lineUserUid);

  if (profileBefore?.customer_id) {
    const linkedCustomer = await loadCustomerById(env, tenantSlug, profileBefore.customer_id);
    if (!linkedCustomer) throw new Error('ATTRIBUTION_CUSTOMER_LINK_CONFLICT');
    const linkedLineUid = text(linkedCustomer.customer_line_uid, 120);
    if (linkedLineUid && linkedLineUid !== lineUserUid) {
      throw new Error('ATTRIBUTION_CUSTOMER_LINK_CONFLICT');
    }
    if (customerByLine && customerByLine.customer_id !== linkedCustomer.customer_id) {
      throw new Error('ATTRIBUTION_CUSTOMER_LINK_CONFLICT');
    }
  }

  // Preserve any attribution that pre-dates this feature. Migration 0116 also
  // backfills it, but this check keeps the endpoint fail-safe during rollouts.
  const preexistingRefUid = text(customerByLine?.ref_uid || profileBefore?.ref_uid, 120);
  const candidateRefUid = preexistingRefUid || tokenRefUid;
  const candidateSource = preexistingRefUid
    ? (customerByLine?.ref_uid ? 'customer_existing' : 'crm_existing')
    : 'booking_landing';

  const write = await writeFirstTouch(env, {
    tenantSlug,
    lineUserUid,
    refUid: candidateRefUid,
    itineraryId: preexistingRefUid ? '' : itineraryId,
    shareId: preexistingRefUid ? '' : shareId,
    referralJti: preexistingRefUid ? '' : text(verified.claims?.jti, 80),
    source: candidateSource,
  });

  const firstTouch = await loadFirstTouch(env, tenantSlug, lineUserUid);
  if (!firstTouch?.ref_uid) throw new Error('ATTRIBUTION_FIRST_TOUCH_UNAVAILABLE');
  const canonicalRefUid = text(firstTouch.ref_uid, 120);

  if (preexistingRefUid && canonicalRefUid !== preexistingRefUid) {
    throw new Error('ATTRIBUTION_FIRST_TOUCH_CONFLICT');
  }

  let canonicalReferrer = tokenDistributor;
  if (canonicalRefUid !== tokenRefUid) {
    canonicalReferrer = await loadActiveDistributor(env, tenantSlug, canonicalRefUid);
  }
  const defaultOwnerUid = canonicalReferrer?.user_uid || tokenDistributor.user_uid;
  const defaultOwnerName = canonicalReferrer?.display_name || tokenDistributor.display_name || '';

  let projection = 'crm_lead';
  let targetType = 'tenant_crm_profile';
  let targetId = '';

  if (customerByLine) {
    await projectToFormalCustomer(env, {
      tenantSlug,
      customer: customerByLine,
      refUid: canonicalRefUid,
      ownerUid: defaultOwnerUid,
      ownerName: defaultOwnerName,
    });
    projection = 'customer';
    targetType = 'customer';
    targetId = customerByLine.customer_id;
  } else {
    if (profileBefore?.ref_uid && profileBefore.ref_uid !== canonicalRefUid) {
      throw new Error('ATTRIBUTION_FIRST_TOUCH_CONFLICT');
    }
    const profile = await ensureLeadProjection(env, {
      tenantSlug,
      lineUserUid,
      refUid: canonicalRefUid,
      ownerUid: text(profileBefore?.owner_uid, 120) || defaultOwnerUid,
    });
    if (!profile?.id) throw new Error('ATTRIBUTION_FIRST_TOUCH_UNAVAILABLE');
    targetId = profile.id;
  }

  const captured = Number(write?.meta?.changes || 0) > 0 && !preexistingRefUid;
  if (captured) {
    await auditNewFirstTouch(env, {
      tenantSlug,
      actorUid: lineUserUid,
      targetType,
      targetId,
      refUid: canonicalRefUid,
      itineraryId,
      shareId,
    });
  }

  return json({
    success: true,
    outcome: captured ? 'captured' : 'preserved',
    projection,
    first_touch: {
      ref_uid: canonicalRefUid,
      first_itinerary_id: text(firstTouch.first_itinerary_id, 120),
      first_share_id: text(firstTouch.first_share_id, 120),
      source: text(firstTouch.source, 80),
      captured_at: text(firstTouch.captured_at, 40),
    },
  });
}

export function isTenantAttributionApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return path === '/api/v2/attribution/first-touch';
}

export async function routeTenantAttributionApi(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    if (request.method === 'POST' && path === '/api/v2/attribution/first-touch') {
      return await captureFirstTouch(request, env);
    }
    return json({ success: false, error: 'TENANT_ATTRIBUTION_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_ATTRIBUTION_ERROR');
    return json({ success: false, error: code }, attributionStatus(code));
  }
}
