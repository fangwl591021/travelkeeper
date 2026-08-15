import { requestedTenantSlug } from './tenant-context.js';
import { referralTokenSecret, verifyReferralToken } from './referral-token.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function errorStatus(code) {
  return {
    AUTH_REQUIRED: 401,
    D1_REQUIRED: 503,
    TENANT_NOT_FOUND: 404,
    ITINERARY_NOT_FOUND: 404,
    DISTRIBUTOR_NOT_FOUND: 404,
    INVITE_CODE_NOT_FOUND: 404,
    ORDER_NOT_FOUND: 404,
    ORDER_CUSTOMER_MISMATCH: 403,
    CUSTOMER_LINE_IDENTITY_CONFLICT: 409,
    ATTRIBUTION_FIRST_TOUCH_CONFLICT: 409,
    TENANT_PAYMENT_CONFIGURATION_REQUIRED: 503,
    INVALID_BOOKING_PAYLOAD: 400,
    PAYMENT_AMOUNT_INVALID: 400,
    INVALID_REFERRAL_TOKEN: 400,
    EXPIRED_REFERRAL_TOKEN: 400,
    REFERRAL_TOKEN_CONTEXT_MISMATCH: 403,
    REFERRAL_SIGNING_NOT_CONFIGURED: 503,
  }[code] || 400;
}

function authenticatedUserUid(request) {
  return String(request.headers.get('x-user-uid') || '').trim();
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

export function normalizeCustomerPhone(value) {
  const source = cleanText(value, 40);
  if (!source) return '';
  const plus = source.trim().startsWith('+') ? '+' : '';
  const digits = source.replace(/\D/g, '');
  return digits ? `${plus}${digits}` : source.toLowerCase();
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export async function customerIdentityId(tenantSlug, contactPhone) {
  const source = `${String(tenantSlug || 'demo').trim().toLowerCase()}\u0000${normalizeCustomerPhone(contactPhone)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return `CUS${bytesToHex(new Uint8Array(digest)).slice(0, 32).toUpperCase()}`;
}

function taipeiDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function makeOrderId(tenantSlug) {
  const tenant = String(tenantSlug || 'demo').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6) || 'DEMO';
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `ORD${tenant}${Date.now()}${random}`;
}

async function resolveDistributor(env, tenantSlug, body = {}) {
  const inviteCode = cleanText(body.invite_code || body.inviteCode, 80).toUpperCase();
  const distributorUid = cleanText(body.distributor_uid || body.distributorUid, 80);

  if (inviteCode) {
    return env.DB.prepare(`
      SELECT
        p.user_uid,
        p.display_name,
        p.invite_code,
        p.commission_pct,
        m.role,
        m.status
      FROM tenant_distributor_profiles p
      INNER JOIN tenant_memberships m
        ON m.tenant_slug = p.tenant_slug
       AND m.user_uid = p.user_uid
      WHERE p.tenant_slug = ?
        AND upper(p.invite_code) = ?
        AND m.status = 'active'
        AND m.role IN ('sales', 'editor')
      LIMIT 1
    `).bind(tenantSlug, inviteCode).first();
  }

  if (!distributorUid) return null;
  return env.DB.prepare(`
    SELECT
      p.user_uid,
      p.display_name,
      p.invite_code,
      p.commission_pct,
      m.role,
      m.status
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

async function prepareCustomerWrite(env, {
  tenantSlug,
  contactPhone,
  customerName,
  customerLineUid,
  distributorUid,
  distributorName,
  initialRefUid,
  initialOwnerUid,
  initialOwnerName,
  totalAmount,
  source,
  createdAt,
}) {
  const existing = await env.DB.prepare(`
    SELECT
      customer_id,
      customer_phone AS customer_key,
      customer_line_uid,
      owner_uid,
      owner_name,
      ref_uid
    FROM customers
    WHERE tenant_slug = ?
      AND COALESCE(NULLIF(contact_phone, ''), customer_phone) = ?
    LIMIT 1
  `).bind(tenantSlug, contactPhone).first();

  if (existing) {
    const existingLineUid = String(existing.customer_line_uid || '').trim();
    if (existingLineUid && existingLineUid !== customerLineUid) {
      throw new Error('CUSTOMER_LINE_IDENTITY_CONFLICT');
    }

    const customerId = String(existing.customer_id || '') || await customerIdentityId(tenantSlug, contactPhone);
    const customerKey = String(existing.customer_key || '');
    const ownerUid = String(existing.owner_uid || '').trim() || initialOwnerUid || distributorUid;
    const ownerName = String(existing.owner_name || '').trim() || initialOwnerName || distributorName;
    const refUid = String(existing.ref_uid || '').trim() || initialRefUid || distributorUid;
    return {
      customerId,
      customerKey,
      ownerUid,
      ownerName,
      refUid,
      statement: env.DB.prepare(`
        UPDATE customers
        SET customer_id = CASE WHEN customer_id = '' THEN ? ELSE customer_id END,
            contact_phone = ?,
            customer_name = CASE WHEN customer_name = '' THEN ? ELSE customer_name END,
            customer_line_uid = CASE WHEN customer_line_uid = '' THEN ? ELSE customer_line_uid END,
            owner_uid = CASE WHEN COALESCE(owner_uid, '') = '' THEN ? ELSE owner_uid END,
            owner_name = CASE WHEN COALESCE(owner_uid, '') = '' THEN ? ELSE owner_name END,
            ref_uid = CASE WHEN COALESCE(ref_uid, '') = '' THEN ? ELSE ref_uid END,
            last_order_at = ?,
            total_orders = total_orders + 1,
            total_amount = total_amount + ?,
            updated_at = ?
        WHERE tenant_slug = ?
          AND customer_phone = ?
      `).bind(
        customerId,
        contactPhone,
        customerName,
        customerLineUid,
        ownerUid,
        ownerName,
        refUid,
        createdAt,
        totalAmount,
        createdAt,
        tenantSlug,
        customerKey,
      ),
    };
  }

  const customerId = await customerIdentityId(tenantSlug, contactPhone);
  let customerKey = customerId;
  const ownerUid = initialOwnerUid || distributorUid;
  const ownerName = initialOwnerName || distributorName;
  const refUid = initialRefUid || distributorUid;

  // Preserve legacy demo compatibility when the original phone key is unused.
  if (tenantSlug === 'demo') {
    const occupied = await env.DB.prepare(`
      SELECT tenant_slug
      FROM customers
      WHERE customer_phone = ?
      LIMIT 1
    `).bind(contactPhone).first();
    if (!occupied) customerKey = contactPhone;
  }

  return {
    customerId,
    customerKey,
    ownerUid,
    ownerName,
    refUid,
    statement: env.DB.prepare(`
      INSERT INTO customers (
        customer_phone, customer_name, customer_line_uid, owner_uid, owner_name, ref_uid,
        first_order_at, last_order_at, total_orders, total_amount, source, note,
        created_at, updated_at, tenant_slug, customer_id, contact_phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, '', ?, ?, ?, ?, ?)
      ON CONFLICT(customer_phone) DO UPDATE SET
        customer_id = CASE WHEN customers.customer_id = '' THEN excluded.customer_id ELSE customers.customer_id END,
        contact_phone = CASE WHEN customers.contact_phone = '' THEN excluded.contact_phone ELSE customers.contact_phone END,
        customer_name = CASE WHEN customers.customer_name = '' THEN excluded.customer_name ELSE customers.customer_name END,
        customer_line_uid = CASE WHEN customers.customer_line_uid = '' THEN excluded.customer_line_uid ELSE customers.customer_line_uid END,
        owner_uid = CASE WHEN COALESCE(customers.owner_uid, '') = '' THEN excluded.owner_uid ELSE customers.owner_uid END,
        owner_name = CASE WHEN COALESCE(customers.owner_uid, '') = '' THEN excluded.owner_name ELSE customers.owner_name END,
        ref_uid = CASE WHEN COALESCE(customers.ref_uid, '') = '' THEN excluded.ref_uid ELSE customers.ref_uid END,
        last_order_at = excluded.last_order_at,
        total_orders = customers.total_orders + 1,
        total_amount = customers.total_amount + excluded.total_amount,
        updated_at = excluded.updated_at
      WHERE customers.tenant_slug = excluded.tenant_slug
    `).bind(
      customerKey,
      customerName,
      customerLineUid,
      ownerUid,
      ownerName,
      refUid,
      createdAt,
      createdAt,
      totalAmount,
      source,
      createdAt,
      createdAt,
      tenantSlug,
      customerId,
      contactPhone,
    ),
  };
}

async function createBooking(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const tenantSlug = requestedTenantSlug(request, body);
  const customerLineUid = authenticatedUserUid(request);
  if (!customerLineUid) throw new Error('AUTH_REQUIRED');

  const itineraryId = cleanText(body.itinerary_id || body.itineraryId, 100);
  const customerName = cleanText(body.customer_name || body.customerName, 120);
  const contactPhone = normalizeCustomerPhone(body.customer_phone || body.customerPhone);
  const travelers = Math.max(1, Math.min(50, Number(body.travelers) || 1));
  const travelDate = cleanText(body.travel_date || body.travelDate, 30);
  const note = cleanText(body.note, 2000);
  const source = cleanText(body.source || 'referral', 80) || 'referral';
  const referralToken = cleanText(body.referral_token || body.referralToken, 2400);
  const shareId = cleanText(body.share_id || body.shareId, 120);

  if (!itineraryId || !customerName || !contactPhone) {
    return json({ success: false, error: 'INVALID_BOOKING_PAYLOAD' }, 400);
  }

  const tenant = await env.DB.prepare(
    `SELECT slug FROM tenants WHERE slug = ? LIMIT 1`
  ).bind(tenantSlug).first();
  if (!tenant) throw new Error('TENANT_NOT_FOUND');

  const itinerary = await env.DB.prepare(`
    SELECT *
    FROM itineraries
    WHERE tenant_slug = ?
      AND id = ?
      AND review_status = 'published'
      AND (deleted_at IS NULL OR deleted_at = '')
      AND (expire_at IS NULL OR expire_at = '' OR expire_at >= date('now', '+8 hours'))
    LIMIT 1
  `).bind(tenantSlug, itineraryId).first();
  if (!itinerary) throw new Error('ITINERARY_NOT_FOUND');

  let referralBody = body;
  let verifiedReferralClaims = null;
  if (referralToken) {
    const verified = await verifyReferralToken(referralTokenSecret(env), referralToken, {
      tenant_slug: tenantSlug,
      itinerary_id: itineraryId,
    });
    if (!verified.ok) throw new Error(verified.error);
    verifiedReferralClaims = verified.claims;
    const suppliedUid = cleanText(body.distributor_uid || body.distributorUid, 80);
    const suppliedInvite = cleanText(body.invite_code || body.inviteCode, 80).toUpperCase();
    if ((suppliedUid && suppliedUid !== verifiedReferralClaims.distributor_uid) ||
        (suppliedInvite && suppliedInvite !== verifiedReferralClaims.invite_code)) {
      throw new Error('REFERRAL_TOKEN_CONTEXT_MISMATCH');
    }
    referralBody = {
      ...body,
      distributor_uid: verifiedReferralClaims.distributor_uid,
      invite_code: verifiedReferralClaims.invite_code,
    };
  }
  const distributor = await resolveDistributor(env, tenantSlug, referralBody);
  if (!distributor) {
    const hasInvite = cleanText(body.invite_code || body.inviteCode, 80);
    throw new Error(hasInvite ? 'INVITE_CODE_NOT_FOUND' : 'DISTRIBUTOR_NOT_FOUND');
  }

  const distributorUid = String(distributor.user_uid || '');
  const distributorName = String(distributor.display_name || '');

  const existingLineProfile = await env.DB.prepare(`
    SELECT id, customer_id, ref_uid, owner_uid
    FROM tenant_crm_profiles
    WHERE tenant_slug = ? AND line_user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, customerLineUid).first();

  const existingCustomerAttribution = await env.DB.prepare(`
    SELECT customer_id, customer_line_uid, ref_uid, owner_uid, owner_name
    FROM customers
    WHERE tenant_slug = ?
      AND COALESCE(NULLIF(contact_phone, ''), customer_phone) = ?
    LIMIT 1
  `).bind(tenantSlug, contactPhone).first();

  const existingCustomerLineUid = cleanText(existingCustomerAttribution?.customer_line_uid, 120);
  if (existingCustomerLineUid && existingCustomerLineUid !== customerLineUid) {
    throw new Error('CUSTOMER_LINE_IDENTITY_CONFLICT');
  }

  let firstTouch = await env.DB.prepare(`
    SELECT ref_uid, first_itinerary_id, first_share_id, referral_jti, source, captured_at
    FROM tenant_first_touch_attributions
    WHERE tenant_slug = ? AND line_user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, customerLineUid).first();

  const historicalRefUid = cleanText(
    existingCustomerAttribution?.ref_uid || existingLineProfile?.ref_uid,
    120,
  );

  if (!firstTouch && (historicalRefUid || verifiedReferralClaims)) {
    const firstRefUid = historicalRefUid || distributorUid;
    const firstSource = historicalRefUid
      ? (existingCustomerAttribution?.ref_uid ? 'customer_existing' : 'crm_existing')
      : 'booking_submit';
    await env.DB.prepare(`
      INSERT INTO tenant_first_touch_attributions (
        tenant_slug, line_user_uid, ref_uid, first_itinerary_id,
        first_share_id, referral_jti, source, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(tenant_slug, line_user_uid) DO NOTHING
    `).bind(
      tenantSlug,
      customerLineUid,
      firstRefUid,
      historicalRefUid ? '' : itineraryId,
      historicalRefUid ? '' : shareId,
      historicalRefUid ? '' : cleanText(verifiedReferralClaims?.jti, 80),
      firstSource,
    ).run();
    firstTouch = await env.DB.prepare(`
      SELECT ref_uid, first_itinerary_id, first_share_id, referral_jti, source, captured_at
      FROM tenant_first_touch_attributions
      WHERE tenant_slug = ? AND line_user_uid = ?
      LIMIT 1
    `).bind(tenantSlug, customerLineUid).first();
  }

  const canonicalFirstRefUid = cleanText(firstTouch?.ref_uid, 120);
  if (historicalRefUid && canonicalFirstRefUid && historicalRefUid !== canonicalFirstRefUid) {
    throw new Error('ATTRIBUTION_FIRST_TOUCH_CONFLICT');
  }

  const price = Math.max(0, Number(itinerary.price || 0));
  const totalAmount = Math.round(price * travelers);
  const paymentMode = String(itinerary.payment_mode || 'deposit').toLowerCase() === 'full' ? 'full' : 'deposit';
  const depositRatio = Math.max(0, Math.min(100, Number(itinerary.deposit_ratio || 20)));
  const depositPerTraveler = Math.max(0, Number(itinerary.deposit_amount || 0));
  const balanceCollect = paymentMode === 'full'
    ? 'not_required'
    : (String(itinerary.balance_collect || 'online').toLowerCase() === 'offline' ? 'offline' : 'online');
  const depositAmount = paymentMode === 'full'
    ? totalAmount
    : Math.min(totalAmount, depositPerTraveler > 0
      ? Math.round(depositPerTraveler * travelers)
      : Math.round(totalAmount * depositRatio / 100));
  const balanceAmount = paymentMode === 'full' ? 0 : Math.max(0, totalAmount - depositAmount);

  const commissionMode = String(itinerary.commission_mode || 'amount').toLowerCase();
  const commissionAmount = commissionMode === 'percent'
    ? Math.round(totalAmount * Number(itinerary.commission_percent || 0) / 100)
    : Math.max(0, Number(itinerary.commission_amount || 0));
  const createdAt = taipeiDateTime();
  const orderId = makeOrderId(tenantSlug);
  const balanceStatus = paymentMode === 'full' ? 'not_required' : 'unpaid';

  let initialRefUid = canonicalFirstRefUid || historicalRefUid || distributorUid;
  let initialOwnerUid = cleanText(existingCustomerAttribution?.owner_uid, 120) || distributorUid;
  let initialOwnerName = cleanText(existingCustomerAttribution?.owner_name, 200) || distributorName;

  const priorOwnerUid = cleanText(existingLineProfile?.owner_uid, 120);
  if (!existingCustomerAttribution?.owner_uid && priorOwnerUid) {
    const priorOwner = await resolveDistributor(env, tenantSlug, { distributor_uid: priorOwnerUid });
    if (priorOwner) {
      initialOwnerUid = String(priorOwner.user_uid || distributorUid);
      initialOwnerName = String(priorOwner.display_name || distributorName);
    }
  }

  if (!existingCustomerAttribution?.owner_uid && !priorOwnerUid && canonicalFirstRefUid) {
    const firstReferrer = await resolveDistributor(env, tenantSlug, { distributor_uid: canonicalFirstRefUid });
    if (firstReferrer) {
      initialOwnerUid = String(firstReferrer.user_uid || distributorUid);
      initialOwnerName = String(firstReferrer.display_name || distributorName);
    }
  }

  const customerWrite = await prepareCustomerWrite(env, {
    tenantSlug,
    contactPhone,
    customerName,
    customerLineUid,
    distributorUid,
    distributorName,
    initialRefUid,
    initialOwnerUid,
    initialOwnerName,
    totalAmount,
    source,
    createdAt,
  });

  if (canonicalFirstRefUid && customerWrite.refUid !== canonicalFirstRefUid) {
    throw new Error('ATTRIBUTION_FIRST_TOUCH_CONFLICT');
  }
  if (existingLineProfile?.customer_id && String(existingLineProfile.customer_id) !== customerWrite.customerId) {
    throw new Error('CUSTOMER_LINE_IDENTITY_CONFLICT');
  }

  const orderInsert = env.DB.prepare(`
    INSERT INTO orders (
      order_id, itinerary_id, itinerary_title, price, distributor_uid,
      customer_name, customer_phone, customer_id, contact_phone, customer_line_uid,
      travelers, travel_date, note, status, commission_amount, total_amount,
      deposit_amount, balance_amount, payment_mode, balance_collect, deposit_status,
      deposit_paid_at, deposit_method, deposit_trade_no, balance_status,
      balance_paid_at, balance_method, balance_trade_no, commission_status,
      commission_settled_at, commission_paid_out_at, source, created_at, updated_at,
      tenant_slug
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?,
      'unpaid', '', '', '', ?, '', '', '', 'pending', '', '', ?, ?, ?, ?
    )
  `).bind(
    orderId,
    itineraryId,
    String(itinerary.title || ''),
    price,
    distributorUid,
    customerName,
    customerWrite.customerKey,
    customerWrite.customerId,
    contactPhone,
    customerLineUid,
    travelers,
    travelDate,
    note,
    commissionAmount,
    totalAmount,
    depositAmount,
    balanceAmount,
    paymentMode,
    balanceCollect,
    balanceStatus,
    source,
    createdAt,
    createdAt,
    tenantSlug,
  );

  const crmLink = env.DB.prepare(`
    UPDATE tenant_crm_profiles
    SET customer_id = CASE WHEN customer_id = '' THEN ? ELSE customer_id END,
        ref_uid = ?,
        owner_uid = ?,
        display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END,
        phone = CASE WHEN phone = '' THEN ? ELSE phone END,
        updated_by = 'booking',
        updated_at = ?
    WHERE tenant_slug = ?
      AND line_user_uid = ?
      AND (customer_id = '' OR customer_id = ?)
  `).bind(
    customerWrite.customerId,
    customerWrite.refUid,
    customerWrite.ownerUid,
    customerName,
    contactPhone,
    createdAt,
    tenantSlug,
    customerLineUid,
    customerWrite.customerId,
  );

  // Customer owns canonical attribution; CRM is only the tenant-scoped projection.
  await env.DB.batch([customerWrite.statement, orderInsert, crmLink]);

  return json({
    success: true,
    data: {
      order_id: orderId,
      tenant_slug: tenantSlug,
      itinerary_id: itineraryId,
      itinerary_title: String(itinerary.title || ''),
      distributor_uid: distributorUid,
      distributor_name: distributorName,
      customer_id: customerWrite.customerId,
      customer_phone: contactPhone,
      customer_line_uid: customerLineUid,
      ref_uid: customerWrite.refUid,
      owner_uid: customerWrite.ownerUid,
      total_amount: totalAmount,
      deposit_amount: depositAmount,
      balance_amount: balanceAmount,
      payment_mode: paymentMode,
      balance_collect: balanceCollect,
    },
  }, 201);
}

async function createPayment(request, env, legacyWorker) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const tenantSlug = requestedTenantSlug(request, body);
  const customerLineUid = authenticatedUserUid(request);
  if (!customerLineUid) throw new Error('AUTH_REQUIRED');

  const orderId = cleanText(body.order_id || body.orderId, 120);
  const leg = String(body.leg || 'deposit').toLowerCase() === 'balance' ? 'balance' : 'deposit';
  if (!orderId) return json({ success: false, error: 'ORDER_NOT_FOUND' }, 404);

  const order = await env.DB.prepare(`
    SELECT order_id, tenant_slug, customer_line_uid, deposit_amount, balance_amount
    FROM orders
    WHERE tenant_slug = ? AND order_id = ?
    LIMIT 1
  `).bind(tenantSlug, orderId).first();
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (String(order.customer_line_uid || '') !== customerLineUid) {
    throw new Error('ORDER_CUSTOMER_MISMATCH');
  }

  const amount = leg === 'balance' ? Number(order.balance_amount || 0) : Number(order.deposit_amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('PAYMENT_AMOUNT_INVALID');

  // This legacy fallback remains demo-only. Tenant-aware payment modes are
  // handled before this route by worker-tenant.js.
  if (tenantSlug !== 'demo') {
    throw new Error('TENANT_PAYMENT_CONFIGURATION_REQUIRED');
  }

  const legacyUrl = new URL('/api/payment/create', request.url);
  const legacyRequest = new Request(legacyUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, leg, tenant_slug: tenantSlug }),
  });
  return legacyWorker.fetch(legacyRequest, env, {});
}

export function isTenantBookingApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/bookings' || path === '/api/v2/payments/create';
}

export async function routeTenantBookingApi(request, env, legacyWorker) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  try {
    if (request.method === 'POST' && path === '/api/v2/bookings') {
      return await createBooking(request, env);
    }
    if (request.method === 'POST' && path === '/api/v2/payments/create') {
      return await createPayment(request, env, legacyWorker);
    }
    return json({ success: false, error: 'TENANT_BOOKING_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_BOOKING_ERROR');
    return json({ success: false, error: code }, errorStatus(code));
  }
}
