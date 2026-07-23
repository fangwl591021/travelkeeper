import { requestedTenantSlug, requireTenantContext } from './tenant-context.js';
import { statusForError } from './http-error-status.js';

const READ_ROLES = ['platform_admin', 'tenant_admin', 'sales', 'editor'];
const MANAGE_ALL_ROLES = new Set(['platform_admin', 'tenant_admin']);
const PROFILE_STATUS = new Set(['open', 'pending', 'closed']);
const RISK_LEVELS = new Set(['low', 'medium', 'high']);
const OPPORTUNITY_STAGES = new Set(['new', 'qualified', 'quoted', 'payment', 'won', 'lost']);
const RECORD_STATUS = new Set(['open', 'follow_up', 'done', 'cancelled']);
const RECORD_PRIORITY = new Set(['low', 'normal', 'high']);
const PROFILE_SOURCES = new Set(['order', 'line', 'manual', 'import']);

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

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : safeJsonArray(value);
  return [...new Set(source.map(item => text(item, 80)).filter(Boolean))].slice(0, 30);
}

function enumValue(value, allowed, fallback, errorCode) {
  const normalized = text(value, 64).toLowerCase() || fallback;
  if (!allowed.has(normalized)) throw new Error(errorCode);
  return normalized;
}

function userUid(request) {
  return text(request.headers.get('x-user-uid'), 120);
}

async function crmContext(request, env) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request),
    userUid: userUid(request),
    allowedRoles: READ_ROLES,
  });
}

function canManageAll(context) {
  return MANAGE_ALL_ROLES.has(context.role);
}

function ownerAllowed(context, ownerUid) {
  return canManageAll(context) || text(ownerUid, 120) === context.userUid;
}

async function assertAssignableOwner(env, tenantSlug, ownerUid) {
  const uid = text(ownerUid, 120);
  if (!uid) return;
  const row = await env.DB.prepare(`
    SELECT user_uid
    FROM tenant_memberships
    WHERE tenant_slug = ? AND user_uid = ?
      AND status = 'active' AND role IN ('sales', 'editor')
    LIMIT 1
  `).bind(tenantSlug, uid).first();
  if (!row) throw new Error('CRM_PROFILE_ACCESS_DENIED');
}

function newId(prefix) {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
}

function orderView(row = {}) {
  return {
    id: row.order_id || '',
    order_id: row.order_id || '',
    customer_id: row.customer_id || '',
    customerName: row.customer_name || '',
    customer_name: row.customer_name || '',
    phone: row.contact_phone || row.customer_phone || '',
    customer_phone: row.contact_phone || row.customer_phone || '',
    email: row.customer_email || '',
    lineUid: row.customer_line_uid || '',
    customer_line_uid: row.customer_line_uid || '',
    title: row.itinerary_title || '未命名行程',
    itinerary_title: row.itinerary_title || '',
    status: row.status || 'pending',
    amount: Number(row.total_amount || row.price || 0),
    total_amount: Number(row.total_amount || 0),
    createdAt: row.created_at || '',
    created_at: row.created_at || '',
    distributor_uid: row.distributor_uid || '',
  };
}

function recordView(row = {}) {
  return {
    id: row.id || '',
    profileId: row.profile_id || '',
    profile_id: row.profile_id || '',
    threadId: row.thread_id || '',
    thread_id: row.thread_id || '',
    category: row.category || 'note',
    content: row.content || '',
    status: row.status || 'open',
    priority: row.priority || 'normal',
    dueAt: row.due_at || '',
    due_at: row.due_at || '',
    createdBy: row.created_by || '',
    created_by: row.created_by || '',
    createdAt: row.created_at || '',
    created_at: row.created_at || '',
    updatedAt: row.updated_at || '',
    updated_at: row.updated_at || '',
  };
}

function profileResponse(profile = {}, customer = {}, thread = {}, records = [], orders = []) {
  const profileId = profile.id || customer.customer_id || '';
  const lineUid = profile.line_user_uid || customer.customer_line_uid || thread.line_user_uid || '';
  const phone = profile.phone || customer.contact_phone || customer.customer_phone || '';
  const displayName = profile.display_name || customer.customer_name || '未命名客戶';
  const ownerUid = profile.owner_uid || customer.owner_uid || '';
  const tags = normalizeTags(profile.tags_json || thread.tags_json || []);
  const sortedRecords = [...records].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const sortedOrders = [...orders].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map(orderView);
  const totalAmount = customer.total_amount !== undefined
    ? Number(customer.total_amount || 0)
    : sortedOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const totalOrders = customer.total_orders !== undefined ? Number(customer.total_orders || 0) : sortedOrders.length;
  const lastMessageAt = profile.last_message_at || thread.last_message_at || customer.last_order_at || '';
  return {
    id: profileId,
    profileId,
    profile_id: profileId,
    customerId: customer.customer_id || profile.customer_id || '',
    customer_id: customer.customer_id || profile.customer_id || '',
    source: profile.source || (lineUid ? 'line' : 'order'),
    lineThreadId: thread.id || '',
    line_thread_id: thread.id || '',
    name: displayName,
    displayName,
    pictureUrl: profile.picture_url || '',
    picture_url: profile.picture_url || '',
    userId: lineUid,
    line_user_uid: lineUid,
    phone,
    email: profile.email || '',
    birthday: profile.birthday || '',
    address: profile.address || '',
    identityNote: profile.identity_note || '',
    preferenceNote: profile.preference_note || '',
    tabooNote: profile.taboo_note || '',
    privacyConsent: profile.privacy_consent || '',
    refUid: profile.ref_uid || ownerUid,
    inviteCode: profile.invite_code || '',
    referralNote: profile.referral_note || '',
    ownerUid,
    owner_uid: ownerUid,
    status: profile.status || thread.status || (totalOrders > 0 ? 'closed' : 'open'),
    risk: profile.risk || thread.risk || 'low',
    opportunityStage: profile.opportunity_stage || (totalOrders > 0 ? 'won' : 'new'),
    opportunity_stage: profile.opportunity_stage || (totalOrders > 0 ? 'won' : 'new'),
    opportunityValue: Number(profile.opportunity_value || totalAmount || 0),
    opportunity_value: Number(profile.opportunity_value || totalAmount || 0),
    opportunityNote: profile.opportunity_note || '',
    summary: profile.summary || thread.summary || '',
    note: profile.note || thread.note || customer.note || '',
    tags,
    visitorRecords: sortedRecords.map(recordView),
    latestRecord: sortedRecords.length ? recordView(sortedRecords[0]) : null,
    lastMessageAt,
    firstOrderAt: customer.first_order_at || '',
    lastOrderAt: customer.last_order_at || '',
    orderCount: totalOrders,
    totalOrders,
    totalAmount,
    orders: sortedOrders,
    hasIdentity: Boolean(phone || profile.email || lineUid),
    createdAt: profile.created_at || customer.created_at || '',
    updatedAt: profile.updated_at || customer.updated_at || '',
  };
}

async function loadCrm(request, env) {
  const context = await crmContext(request, env);
  const ownerFilter = canManageAll(context) ? '' : ' AND (c.owner_uid = ? OR p.owner_uid = ?)';
  const ownerBinds = canManageAll(context) ? [] : [context.userUid, context.userUid];

  const customersResult = await env.DB.prepare(`
    SELECT
      c.*,
      p.id AS p_id, p.customer_id AS p_customer_id, p.line_user_uid AS p_line_user_uid,
      p.display_name AS p_display_name, p.picture_url AS p_picture_url, p.phone AS p_phone,
      p.email AS p_email, p.birthday AS p_birthday, p.address AS p_address,
      p.identity_note AS p_identity_note, p.preference_note AS p_preference_note,
      p.taboo_note AS p_taboo_note, p.privacy_consent AS p_privacy_consent,
      p.ref_uid AS p_ref_uid, p.invite_code AS p_invite_code, p.referral_note AS p_referral_note,
      p.owner_uid AS p_owner_uid, p.source AS p_source, p.status AS p_status,
      p.risk AS p_risk, p.opportunity_stage AS p_opportunity_stage,
      p.opportunity_value AS p_opportunity_value, p.opportunity_note AS p_opportunity_note,
      p.summary AS p_summary, p.note AS p_note, p.tags_json AS p_tags_json,
      p.last_message_at AS p_last_message_at, p.created_at AS p_created_at, p.updated_at AS p_updated_at
    FROM customers c
    LEFT JOIN tenant_crm_profiles p
      ON p.tenant_slug = c.tenant_slug AND p.customer_id = c.customer_id
    WHERE c.tenant_slug = ?${ownerFilter}
    ORDER BY COALESCE(NULLIF(p.updated_at, ''), c.updated_at) DESC
    LIMIT 1000
  `).bind(context.tenantSlug, ...ownerBinds).all();

  const standaloneFilter = canManageAll(context) ? '' : ' AND owner_uid = ?';
  const standaloneProfiles = await env.DB.prepare(`
    SELECT * FROM tenant_crm_profiles
    WHERE tenant_slug = ? AND customer_id = ''${standaloneFilter}
    ORDER BY updated_at DESC
    LIMIT 500
  `).bind(context.tenantSlug, ...(canManageAll(context) ? [] : [context.userUid])).all();

  const ordersResult = await env.DB.prepare(`
    SELECT * FROM orders
    WHERE tenant_slug = ?${canManageAll(context) ? '' : ' AND distributor_uid = ?'}
    ORDER BY created_at DESC
    LIMIT 3000
  `).bind(context.tenantSlug, ...(canManageAll(context) ? [] : [context.userUid])).all();

  const profiles = [];
  const profileIds = new Set();
  const customerByProfile = new Map();
  for (const row of customersResult.results || []) {
    const profile = {
      id: row.p_id || row.customer_id,
      customer_id: row.p_customer_id || row.customer_id,
      line_user_uid: row.p_line_user_uid || row.customer_line_uid,
      display_name: row.p_display_name || row.customer_name,
      picture_url: row.p_picture_url || '', phone: row.p_phone || row.contact_phone,
      email: row.p_email || '', birthday: row.p_birthday || '', address: row.p_address || '',
      identity_note: row.p_identity_note || '', preference_note: row.p_preference_note || '',
      taboo_note: row.p_taboo_note || '', privacy_consent: row.p_privacy_consent || '',
      ref_uid: row.p_ref_uid || row.owner_uid, invite_code: row.p_invite_code || '',
      referral_note: row.p_referral_note || '', owner_uid: row.p_owner_uid || row.owner_uid,
      source: row.p_source || 'order', status: row.p_status || '', risk: row.p_risk || '',
      opportunity_stage: row.p_opportunity_stage || '', opportunity_value: row.p_opportunity_value || 0,
      opportunity_note: row.p_opportunity_note || '', summary: row.p_summary || '', note: row.p_note || '',
      tags_json: row.p_tags_json || '[]', last_message_at: row.p_last_message_at || '',
      created_at: row.p_created_at || row.created_at, updated_at: row.p_updated_at || row.updated_at,
    };
    profiles.push(profile);
    profileIds.add(profile.id);
    customerByProfile.set(profile.id, row);
  }
  for (const profile of standaloneProfiles.results || []) {
    profiles.push(profile);
    profileIds.add(profile.id);
  }

  const profileIdList = [...profileIds];
  let threads = [];
  let records = [];
  if (profileIdList.length) {
    const placeholders = profileIdList.map(() => '?').join(',');
    const threadResult = await env.DB.prepare(`
      SELECT * FROM tenant_crm_threads
      WHERE tenant_slug = ? AND profile_id IN (${placeholders})
      ORDER BY updated_at DESC
    `).bind(context.tenantSlug, ...profileIdList).all();
    threads = threadResult.results || [];
    const recordResult = await env.DB.prepare(`
      SELECT * FROM tenant_crm_records
      WHERE tenant_slug = ? AND profile_id IN (${placeholders})
        AND (deleted_at IS NULL OR deleted_at = '')
      ORDER BY created_at DESC
      LIMIT 5000
    `).bind(context.tenantSlug, ...profileIdList).all();
    records = recordResult.results || [];
  }

  const ordersByCustomer = new Map();
  const ordersByPhone = new Map();
  for (const order of ordersResult.results || []) {
    const customerId = order.customer_id || '';
    const phone = order.contact_phone || order.customer_phone || '';
    if (customerId) {
      if (!ordersByCustomer.has(customerId)) ordersByCustomer.set(customerId, []);
      ordersByCustomer.get(customerId).push(order);
    }
    if (phone) {
      if (!ordersByPhone.has(phone)) ordersByPhone.set(phone, []);
      ordersByPhone.get(phone).push(order);
    }
  }
  const threadByProfile = new Map();
  for (const thread of threads) if (!threadByProfile.has(thread.profile_id)) threadByProfile.set(thread.profile_id, thread);
  const recordsByProfile = new Map();
  for (const record of records) {
    if (!recordsByProfile.has(record.profile_id)) recordsByProfile.set(record.profile_id, []);
    recordsByProfile.get(record.profile_id).push(record);
  }

  const data = profiles.map(profile => {
    const customer = customerByProfile.get(profile.id) || {};
    const customerId = customer.customer_id || profile.customer_id || '';
    const phone = profile.phone || customer.contact_phone || customer.customer_phone || '';
    const orders = ordersByCustomer.get(customerId) || ordersByPhone.get(phone) || [];
    return profileResponse(profile, customer, threadByProfile.get(profile.id) || {}, recordsByProfile.get(profile.id) || [], orders);
  });

  return json({
    success: true,
    tenantSlug: context.tenantSlug,
    role: context.role,
    data,
    summary: {
      customer_count: data.length,
      order_count: data.reduce((sum, item) => sum + Number(item.orderCount || 0), 0),
      total_amount: data.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0),
      follow_up_count: data.filter(item => item.risk === 'high' || item.visitorRecords.some(record => record.status === 'follow_up' || record.priority === 'high')).length,
    },
  });
}

async function findProfile(env, tenantSlug, id) {
  return env.DB.prepare(`
    SELECT * FROM tenant_crm_profiles
    WHERE tenant_slug = ? AND id = ?
    LIMIT 1
  `).bind(tenantSlug, id).first();
}

async function profileCustomer(env, tenantSlug, customerId) {
  if (!customerId) return null;
  return env.DB.prepare(`
    SELECT * FROM customers
    WHERE tenant_slug = ? AND customer_id = ?
    LIMIT 1
  `).bind(tenantSlug, customerId).first();
}

async function resolveProfile(env, tenantSlug, body = {}, forcedId = '') {
  const customerId = text(body.customer_id ?? body.customerId, 120);
  const lineUid = text(body.line_user_uid ?? body.lineUserUid ?? body.userId, 120);
  const requestedId = text(forcedId || body.id || body.profile_id || body.profileId, 160);
  if (requestedId) {
    const byId = await findProfile(env, tenantSlug, requestedId);
    if (byId) return byId;
  }
  if (customerId) {
    const byCustomer = await env.DB.prepare(`
      SELECT * FROM tenant_crm_profiles WHERE tenant_slug = ? AND customer_id = ? LIMIT 1
    `).bind(tenantSlug, customerId).first();
    if (byCustomer) return byCustomer;
  }
  if (lineUid) {
    const byLine = await env.DB.prepare(`
      SELECT * FROM tenant_crm_profiles WHERE tenant_slug = ? AND line_user_uid = ? LIMIT 1
    `).bind(tenantSlug, lineUid).first();
    if (byLine) return byLine;
  }
  return null;
}

async function saveProfile(request, env, forcedId = '') {
  const context = await crmContext(request, env);
  const body = await request.json().catch(() => ({}));
  const existing = await resolveProfile(env, context.tenantSlug, body, forcedId);
  const explicitProfileId = text(forcedId || body.id || body.profile_id || body.profileId, 160);
  const requestedCustomerId = text(body.customer_id ?? body.customerId, 120);
  const requestedLineUid = text(body.line_user_uid ?? body.lineUserUid ?? body.userId, 120);
  if (!explicitProfileId && !requestedCustomerId && requestedLineUid && existing?.line_user_uid === requestedLineUid) {
    throw new Error('CRM_LINE_UID_CONFLICT');
  }
  const customerId = text(body.customer_id ?? body.customerId ?? existing?.customer_id, 120);
  const customer = await profileCustomer(env, context.tenantSlug, customerId);
  if (customerId && !customer) throw new Error('CRM_CUSTOMER_NOT_FOUND');
  const requestedOwnerUid = body.owner_uid ?? body.ownerUid;
  const requestedRefUid = body.ref_uid ?? body.refUid;
  const ownerUid = text(requestedOwnerUid ?? existing?.owner_uid ?? customer?.owner_uid ?? context.userUid, 120);
  if (!ownerAllowed(context, ownerUid)) throw new Error('CRM_PROFILE_ACCESS_DENIED');
  if (canManageAll(context) && requestedOwnerUid !== undefined) await assertAssignableOwner(env, context.tenantSlug, requestedOwnerUid);

  const refUid = canManageAll(context)
    ? text(requestedRefUid ?? existing?.ref_uid ?? ownerUid, 120)
    : text(existing?.ref_uid || context.userUid, 120);
  if (!canManageAll(context) && requestedRefUid !== undefined && text(requestedRefUid, 120) && text(requestedRefUid, 120) !== refUid) {
    throw new Error('CRM_PROFILE_ACCESS_DENIED');
  }
  if (canManageAll(context) && requestedRefUid !== undefined) await assertAssignableOwner(env, context.tenantSlug, requestedRefUid);

  const id = existing?.id || text(forcedId || body.id, 160) || customerId || newId('CRM');
  const source = enumValue(body.source ?? existing?.source ?? (customer ? 'order' : 'manual'), PROFILE_SOURCES, 'manual', 'INVALID_CRM_SOURCE');
  const status = enumValue(body.status ?? existing?.status, PROFILE_STATUS, customer?.total_orders > 0 ? 'closed' : 'open', 'INVALID_CRM_STATUS');
  const risk = enumValue(body.risk ?? existing?.risk, RISK_LEVELS, 'low', 'INVALID_CRM_RISK');
  const stage = enumValue(body.opportunity_stage ?? body.opportunityStage ?? existing?.opportunity_stage, OPPORTUNITY_STAGES, customer?.total_orders > 0 ? 'won' : 'new', 'INVALID_CRM_STAGE');
  const tags = normalizeTags(body.tags ?? body.tags_json ?? existing?.tags_json);
  const values = {
    id,
    tenant_slug: context.tenantSlug,
    customer_id: customerId,
    line_user_uid: text(body.line_user_uid ?? body.lineUserUid ?? body.userId ?? existing?.line_user_uid ?? customer?.customer_line_uid, 120),
    display_name: text(body.display_name ?? body.displayName ?? body.name ?? existing?.display_name ?? customer?.customer_name, 200),
    picture_url: text(body.picture_url ?? body.pictureUrl ?? existing?.picture_url, 1000),
    phone: text(body.phone ?? existing?.phone ?? customer?.contact_phone, 80),
    email: text(body.email ?? existing?.email, 200),
    birthday: text(body.birthday ?? existing?.birthday, 30),
    address: text(body.address ?? existing?.address, 500),
    identity_note: text(body.identity_note ?? body.identityNote ?? existing?.identity_note, 4000),
    preference_note: text(body.preference_note ?? body.preferenceNote ?? existing?.preference_note, 4000),
    taboo_note: text(body.taboo_note ?? body.tabooNote ?? existing?.taboo_note, 4000),
    privacy_consent: text(body.privacy_consent ?? body.privacyConsent ?? existing?.privacy_consent, 40),
    ref_uid: refUid,
    invite_code: text(body.invite_code ?? body.inviteCode ?? existing?.invite_code, 80).toUpperCase(),
    referral_note: text(body.referral_note ?? body.referralNote ?? existing?.referral_note, 2000),
    owner_uid: ownerUid,
    source,
    status,
    risk,
    opportunity_stage: stage,
    opportunity_value: Math.max(0, integer(body.opportunity_value ?? body.opportunityValue ?? existing?.opportunity_value ?? customer?.total_amount, 0)),
    opportunity_note: text(body.opportunity_note ?? body.opportunityNote ?? existing?.opportunity_note, 4000),
    summary: text(body.summary ?? existing?.summary, 4000),
    note: text(body.note ?? existing?.note, 4000),
    tags_json: JSON.stringify(tags),
    last_message_at: text(body.last_message_at ?? body.lastMessageAt ?? existing?.last_message_at, 40),
  };

  await env.DB.prepare(`
    INSERT INTO tenant_crm_profiles (
      id, tenant_slug, customer_id, line_user_uid, display_name, picture_url, phone, email,
      birthday, address, identity_note, preference_note, taboo_note, privacy_consent,
      ref_uid, invite_code, referral_note, owner_uid, source, status, risk,
      opportunity_stage, opportunity_value, opportunity_note, summary, note, tags_json,
      last_message_at, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      line_user_uid = excluded.line_user_uid,
      display_name = excluded.display_name,
      picture_url = excluded.picture_url,
      phone = excluded.phone,
      email = excluded.email,
      birthday = excluded.birthday,
      address = excluded.address,
      identity_note = excluded.identity_note,
      preference_note = excluded.preference_note,
      taboo_note = excluded.taboo_note,
      privacy_consent = excluded.privacy_consent,
      ref_uid = excluded.ref_uid,
      invite_code = excluded.invite_code,
      referral_note = excluded.referral_note,
      owner_uid = excluded.owner_uid,
      source = excluded.source,
      status = excluded.status,
      risk = excluded.risk,
      opportunity_stage = excluded.opportunity_stage,
      opportunity_value = excluded.opportunity_value,
      opportunity_note = excluded.opportunity_note,
      summary = excluded.summary,
      note = excluded.note,
      tags_json = excluded.tags_json,
      last_message_at = excluded.last_message_at,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).bind(
    values.id, values.tenant_slug, values.customer_id, values.line_user_uid, values.display_name,
    values.picture_url, values.phone, values.email, values.birthday, values.address,
    values.identity_note, values.preference_note, values.taboo_note, values.privacy_consent,
    values.ref_uid, values.invite_code, values.referral_note, values.owner_uid, values.source,
    values.status, values.risk, values.opportunity_stage, values.opportunity_value,
    values.opportunity_note, values.summary, values.note, values.tags_json,
    values.last_message_at, context.userUid, context.userUid
  ).run();

  const saved = await findProfile(env, context.tenantSlug, id);
  return json({ success: true, tenantSlug: context.tenantSlug, data: profileResponse(saved, customer || {}, {}, [], []) }, existing ? 200 : 201);
}

async function getProfile(request, env, id) {
  const context = await crmContext(request, env);
  const profile = await findProfile(env, context.tenantSlug, id);
  if (!profile) return json({ success: false, error: 'CRM_PROFILE_NOT_FOUND' }, 404);
  if (!ownerAllowed(context, profile.owner_uid)) throw new Error('CRM_PROFILE_ACCESS_DENIED');
  const customer = await profileCustomer(env, context.tenantSlug, profile.customer_id);
  const thread = await env.DB.prepare(`
    SELECT * FROM tenant_crm_threads WHERE tenant_slug = ? AND profile_id = ? ORDER BY updated_at DESC LIMIT 1
  `).bind(context.tenantSlug, id).first();
  const records = await env.DB.prepare(`
    SELECT * FROM tenant_crm_records
    WHERE tenant_slug = ? AND profile_id = ? AND (deleted_at IS NULL OR deleted_at = '')
    ORDER BY created_at DESC
  `).bind(context.tenantSlug, id).all();
  const orders = customer?.customer_id
    ? await env.DB.prepare(`SELECT * FROM orders WHERE tenant_slug = ? AND customer_id = ? ORDER BY created_at DESC`).bind(context.tenantSlug, customer.customer_id).all()
    : { results: [] };
  return json({ success: true, tenantSlug: context.tenantSlug, data: profileResponse(profile, customer || {}, thread || {}, records.results || [], orders.results || []) });
}

async function saveThread(request, env) {
  const context = await crmContext(request, env);
  const body = await request.json().catch(() => ({}));
  const profileId = text(body.profile_id ?? body.profileId, 160);
  if (!profileId) throw new Error('CRM_PROFILE_REQUIRED');
  const profile = await findProfile(env, context.tenantSlug, profileId);
  if (!profile) throw new Error('CRM_PROFILE_NOT_FOUND');
  if (!ownerAllowed(context, profile.owner_uid)) throw new Error('CRM_PROFILE_ACCESS_DENIED');
  const id = text(body.id ?? body.thread_id ?? body.threadId, 160) || newId('THR');
  const status = enumValue(body.status, PROFILE_STATUS, profile.status || 'open', 'INVALID_CRM_STATUS');
  const risk = enumValue(body.risk, RISK_LEVELS, profile.risk || 'low', 'INVALID_CRM_RISK');
  const tags = normalizeTags(body.tags ?? body.tags_json);
  await env.DB.prepare(`
    INSERT INTO tenant_crm_threads (
      id, tenant_slug, profile_id, customer_id, line_user_uid, channel_key,
      status, risk, summary, note, tags_json, last_message_at, last_inbound_at,
      last_outbound_at, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      customer_id = excluded.customer_id,
      line_user_uid = excluded.line_user_uid,
      channel_key = excluded.channel_key,
      status = excluded.status,
      risk = excluded.risk,
      summary = excluded.summary,
      note = excluded.note,
      tags_json = excluded.tags_json,
      last_message_at = excluded.last_message_at,
      last_inbound_at = excluded.last_inbound_at,
      last_outbound_at = excluded.last_outbound_at,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).bind(
    id, context.tenantSlug, profileId, profile.customer_id || '',
    text(body.line_user_uid ?? body.lineUserUid ?? profile.line_user_uid, 120),
    text(body.channel_key ?? body.channelKey, 160), status, risk,
    text(body.summary, 4000), text(body.note, 4000), JSON.stringify(tags),
    text(body.last_message_at ?? body.lastMessageAt, 40),
    text(body.last_inbound_at ?? body.lastInboundAt, 40),
    text(body.last_outbound_at ?? body.lastOutboundAt, 40),
    context.userUid, context.userUid
  ).run();
  const saved = await env.DB.prepare(`SELECT * FROM tenant_crm_threads WHERE tenant_slug = ? AND id = ?`).bind(context.tenantSlug, id).first();
  return json({ success: true, tenantSlug: context.tenantSlug, data: saved }, 201);
}

async function listThreads(request, env) {
  const context = await crmContext(request, env);
  const rows = await env.DB.prepare(`
    SELECT t.* FROM tenant_crm_threads t
    JOIN tenant_crm_profiles p ON p.tenant_slug = t.tenant_slug AND p.id = t.profile_id
    WHERE t.tenant_slug = ?${canManageAll(context) ? '' : ' AND p.owner_uid = ?'}
    ORDER BY t.updated_at DESC LIMIT 1000
  `).bind(context.tenantSlug, ...(canManageAll(context) ? [] : [context.userUid])).all();
  return json({ success: true, tenantSlug: context.tenantSlug, data: rows.results || [] });
}

async function saveRecord(request, env, forcedId = '') {
  const context = await crmContext(request, env);
  const body = await request.json().catch(() => ({}));
  const profileId = text(body.profile_id ?? body.profileId, 160);
  if (!profileId) throw new Error('CRM_PROFILE_REQUIRED');
  const profile = await findProfile(env, context.tenantSlug, profileId);
  if (!profile) throw new Error('CRM_PROFILE_NOT_FOUND');
  if (!ownerAllowed(context, profile.owner_uid)) throw new Error('CRM_PROFILE_ACCESS_DENIED');
  const id = text(forcedId || body.id, 160) || newId('REC');
  const existing = await env.DB.prepare(`SELECT * FROM tenant_crm_records WHERE tenant_slug = ? AND id = ?`).bind(context.tenantSlug, id).first();
  const status = enumValue(body.status ?? existing?.status, RECORD_STATUS, 'open', 'INVALID_CRM_RECORD_STATUS');
  const priority = enumValue(body.priority ?? existing?.priority, RECORD_PRIORITY, 'normal', 'INVALID_CRM_PRIORITY');
  const content = text(body.content ?? existing?.content, 10000);
  if (!content) throw new Error('CRM_RECORD_CONTENT_REQUIRED');
  await env.DB.prepare(`
    INSERT INTO tenant_crm_records (
      id, tenant_slug, profile_id, thread_id, category, content, status, priority,
      due_at, created_by, updated_by, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      thread_id = excluded.thread_id,
      category = excluded.category,
      content = excluded.content,
      status = excluded.status,
      priority = excluded.priority,
      due_at = excluded.due_at,
      updated_by = excluded.updated_by,
      deleted_at = '',
      updated_at = excluded.updated_at
  `).bind(
    id, context.tenantSlug, profileId, text(body.thread_id ?? body.threadId ?? existing?.thread_id, 160),
    text(body.category ?? existing?.category, 120) || 'note', content, status, priority,
    text(body.due_at ?? body.dueAt ?? existing?.due_at, 40),
    existing?.created_by || context.userUid, context.userUid
  ).run();
  const saved = await env.DB.prepare(`SELECT * FROM tenant_crm_records WHERE tenant_slug = ? AND id = ?`).bind(context.tenantSlug, id).first();
  return json({ success: true, tenantSlug: context.tenantSlug, data: recordView(saved) }, existing ? 200 : 201);
}

async function listRecords(request, env) {
  const context = await crmContext(request, env);
  const url = new URL(request.url);
  const profileId = text(url.searchParams.get('profile_id') || url.searchParams.get('profileId'), 160);
  const binds = [context.tenantSlug];
  let where = 'r.tenant_slug = ? AND (r.deleted_at IS NULL OR r.deleted_at = \'\')';
  if (profileId) { where += ' AND r.profile_id = ?'; binds.push(profileId); }
  if (!canManageAll(context)) { where += ' AND p.owner_uid = ?'; binds.push(context.userUid); }
  const rows = await env.DB.prepare(`
    SELECT r.* FROM tenant_crm_records r
    JOIN tenant_crm_profiles p ON p.tenant_slug = r.tenant_slug AND p.id = r.profile_id
    WHERE ${where}
    ORDER BY r.created_at DESC LIMIT 2000
  `).bind(...binds).all();
  return json({ success: true, tenantSlug: context.tenantSlug, data: (rows.results || []).map(recordView) });
}

async function deleteRecord(request, env, id) {
  const context = await crmContext(request, env);
  const row = await env.DB.prepare(`
    SELECT r.*, p.owner_uid FROM tenant_crm_records r
    JOIN tenant_crm_profiles p ON p.tenant_slug = r.tenant_slug AND p.id = r.profile_id
    WHERE r.tenant_slug = ? AND r.id = ? LIMIT 1
  `).bind(context.tenantSlug, id).first();
  if (!row) return json({ success: false, error: 'CRM_RECORD_NOT_FOUND' }, 404);
  if (!ownerAllowed(context, row.owner_uid)) throw new Error('CRM_PROFILE_ACCESS_DENIED');
  await env.DB.prepare(`
    UPDATE tenant_crm_records SET deleted_at = datetime('now'), updated_by = ?, updated_at = datetime('now')
    WHERE tenant_slug = ? AND id = ?
  `).bind(context.userUid, context.tenantSlug, id).run();
  return json({ success: true, tenantSlug: context.tenantSlug, id });
}

export function isTenantCrmApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/crm' || path.startsWith('/api/v2/crm/');
}

export async function routeTenantCrmApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (request.method === 'GET' && path === '/api/v2/crm') return await loadCrm(request, env);
    if (request.method === 'POST' && path === '/api/v2/crm/profiles') return await saveProfile(request, env);
    const profileMatch = path.match(/^\/api\/v2\/crm\/profiles\/([^/]+)$/);
    if (profileMatch && request.method === 'GET') return await getProfile(request, env, decodeURIComponent(profileMatch[1]));
    if (profileMatch && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
      return await saveProfile(request, env, decodeURIComponent(profileMatch[1]));
    }
    if (request.method === 'GET' && path === '/api/v2/crm/threads') return await listThreads(request, env);
    if (request.method === 'POST' && path === '/api/v2/crm/threads') return await saveThread(request, env);
    if (request.method === 'GET' && path === '/api/v2/crm/records') return await listRecords(request, env);
    if (request.method === 'POST' && path === '/api/v2/crm/records') return await saveRecord(request, env);
    const recordMatch = path.match(/^\/api\/v2\/crm\/records\/([^/]+)$/);
    if (recordMatch && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
      return await saveRecord(request, env, decodeURIComponent(recordMatch[1]));
    }
    if (recordMatch && request.method === 'DELETE') return await deleteRecord(request, env, decodeURIComponent(recordMatch[1]));
    return json({ success: false, error: 'CRM_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'CRM_REQUEST_FAILED');
    return json({ success: false, error: code }, statusForError(code, 400));
  }
}
