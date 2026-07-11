import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';
import { routeTenantBookingApi } from './tenant-booking-api.js';
import { statusForError } from './http-error-status.js';

const CUSTOMER_EXPORT_PATHS = new Set([
  '/api/mother/export-customer',
  '/api/mother/export-customers',
]);
const ORDER_EXPORT_PATHS = new Set([
  '/api/mother/export-order',
  '/api/mother/export-orders',
  '/api/mother/export-commission',
  '/api/mother/export-commissions',
]);
const LEGACY_ACTIONS = new Set(['getMyCustomers', 'getUserOrders', 'getAllOrders']);
const MAX_BATCH = 100;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function requestUid(request, body = null) {
  const url = new URL(request.url);
  return cleanText(
    request.headers.get('x-user-uid') ||
    body?.user_uid || body?.userUid || body?.uid || body?.operatorUid || body?.adminUid ||
    url.searchParams.get('uid') || url.searchParams.get('user_uid'),
    100,
  );
}

function explicitTenantValue(request) {
  const url = new URL(request.url);
  const referer = String(request.headers.get('referer') || '').trim();
  let refererTenant = '';
  if (referer) {
    try {
      const ref = new URL(referer);
      refererTenant = ref.searchParams.get('tenant') || ref.searchParams.get('tenant_slug') || ref.searchParams.get('a') || '';
    } catch (_) {}
  }
  return cleanText(
    request.headers.get('x-tenant-slug') ||
    url.searchParams.get('tenant') || url.searchParams.get('tenant_slug') || url.searchParams.get('a') ||
    refererTenant,
    63,
  ).toLowerCase();
}

export function isLegacyCustomerCompatRequest(request) {
  const tenant = explicitTenantValue(request);
  if (!tenant || tenant === 'demo') return false;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/orders/create' && request.method === 'POST') return true;
  if (path === '/api/orders/status' && request.method === 'GET') return true;
  if (path === '/api/my/customers' && request.method === 'GET') return true;
  if (path === '/api/itineraries' && request.method === 'GET' && LEGACY_ACTIONS.has(url.searchParams.get('action') || '')) return true;
  if (request.method === 'POST' && (CUSTOMER_EXPORT_PATHS.has(path) || ORDER_EXPORT_PATHS.has(path))) return true;
  return false;
}

async function requireContext(request, env, roles = [], body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles: roles,
  });
}

function normalizePhone(value) {
  const source = cleanText(value, 40);
  if (!source) return '';
  const plus = source.startsWith('+') ? '+' : '';
  const digits = source.replace(/\D/g, '');
  return digits ? `${plus}${digits}` : source.toLowerCase();
}

export function toLegacyCustomerView(row = {}) {
  const contactPhone = row.contact_phone || row.customer_phone || '';
  return {
    ...row,
    customer_id: row.customer_id || '',
    customerid: row.customer_id || '',
    customer_key: row.customer_phone || '',
    customerkey: row.customer_phone || '',
    customer_phone: contactPhone,
    customerphone: contactPhone,
    contact_phone: contactPhone,
    contactphone: contactPhone,
    customer_name: row.customer_name || '',
    customername: row.customer_name || '',
    customer_line_uid: row.customer_line_uid || '',
    customerlineuid: row.customer_line_uid || '',
    owner_uid: row.owner_uid || '',
    owneruid: row.owner_uid || '',
    owner_name: row.owner_name || '',
    ownername: row.owner_name || '',
    total_orders: Number(row.total_orders || 0),
    totalorders: Number(row.total_orders || 0),
    total_amount: Number(row.total_amount || 0),
    totalamount: Number(row.total_amount || 0),
    first_order_at: row.first_order_at || '',
    firstorderat: row.first_order_at || '',
    last_order_at: row.last_order_at || '',
    lastorderat: row.last_order_at || '',
  };
}

export function toLegacyOrderView(row = {}) {
  const contactPhone = row.contact_phone || row.customer_phone || '';
  return {
    ...row,
    customer_id: row.customer_id || '',
    customerid: row.customer_id || '',
    customer_key: row.customer_phone || '',
    customerkey: row.customer_phone || '',
    customer_phone: contactPhone,
    customerphone: contactPhone,
    contact_phone: contactPhone,
    contactphone: contactPhone,
    customer_name: row.customer_name || '',
    customername: row.customer_name || '',
    customer_line_uid: row.customer_line_uid || '',
    customerlineuid: row.customer_line_uid || '',
    distributor_uid: row.distributor_uid || '',
    distributoruid: row.distributor_uid || '',
    order_id: row.order_id || '',
    orderid: row.order_id || '',
    total_amount: Number(row.total_amount || 0),
    totalamount: Number(row.total_amount || 0),
    commission_amount: Number(row.commission_amount || 0),
    commissionamount: Number(row.commission_amount || 0),
  };
}

export function buildTenantCustomerExportPayload(row = {}) {
  return {
    project: 'travelkeeper',
    entity_type: 'customer',
    tenant_slug: row.tenant_slug || '',
    local_id: row.customer_id || '',
    customer_id: row.customer_id || '',
    customer_phone: row.contact_phone || row.customer_phone || '',
    customer_name: row.customer_name || '',
    customer_line_uid: row.customer_line_uid || '',
    owner_uid: row.owner_uid || '',
    owner_name: row.owner_name || '',
    first_order_at: row.first_order_at || '',
    last_order_at: row.last_order_at || '',
    total_orders: Number(row.total_orders || 0),
    total_amount: Number(row.total_amount || 0),
    source: row.source || 'referral',
    note: row.note || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

export function buildTenantOrderExportPayload(row = {}, entityType = 'order') {
  const payload = {
    project: 'travelkeeper',
    entity_type: entityType,
    tenant_slug: row.tenant_slug || '',
    local_id: row.order_id || '',
    order_id: row.order_id || '',
    itinerary_id: row.itinerary_id || '',
    itinerary_title: row.itinerary_title || '',
    distributor_uid: row.distributor_uid || '',
    customer_id: row.customer_id || '',
    customer_name: row.customer_name || '',
    customer_phone: row.contact_phone || row.customer_phone || '',
    customer_line_uid: row.customer_line_uid || '',
    travelers: Number(row.travelers || 1),
    travel_date: row.travel_date || '',
    status: row.status || 'pending',
    total_amount: Number(row.total_amount || 0),
    commission_amount: Number(row.commission_amount || 0),
    commission_status: row.commission_status || 'pending',
    source: row.source || 'referral',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
  if (entityType === 'order') {
    Object.assign(payload, {
      price: Number(row.price || 0),
      note: row.note || '',
      deposit_amount: Number(row.deposit_amount || 0),
      balance_amount: Number(row.balance_amount || 0),
      payment_mode: row.payment_mode || 'deposit',
      balance_collect: row.balance_collect || 'online',
      deposit_status: row.deposit_status || 'unpaid',
      balance_status: row.balance_status || 'unpaid',
      commission_settled_at: row.commission_settled_at || '',
      commission_paid_out_at: row.commission_paid_out_at || '',
    });
  }
  return payload;
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')))));
}

async function hmac(key, value, output = 'bytes') {
  const imported = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(value)));
  return output === 'hex' ? bytesToHex(signed) : signed;
}

function amzTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodePath(path) {
  return String(path || '').split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function wasabiConfig(env) {
  return {
    endpoint: cleanText(env.WASABI_ENDPOINT || 'https://s3.us-west-1.wasabisys.com', 500).replace(/\/+$/, ''),
    region: cleanText(env.WASABI_REGION || 'us-west-1', 80),
    bucket: cleanText(env.WASABI_BUCKET, 200),
    prefix: cleanText(env.WASABI_PREFIX || 'travelkeeper', 200).replace(/^\/+|\/+$/g, ''),
    accessKey: cleanText(env.WASABI_ACCESS_KEY_ID || env.WASABI_ACCESS_KEY, 300),
    secretKey: String(env.WASABI_SECRET_ACCESS_KEY || env.WASABI_SECRET_KEY || ''),
    writeEnabled: String(env.MOTHER_STORAGE_WRITE_ENABLED || '') === '1',
  };
}

async function signedWasabiPut(env, key, text) {
  const cfg = wasabiConfig(env);
  if (!cfg.bucket || !cfg.accessKey || !cfg.secretKey) throw new Error('MOTHER_STORAGE_NOT_CONFIGURED');
  if (!cfg.writeEnabled) throw new Error('MOTHER_STORAGE_WRITE_DISABLED');
  const endpoint = new URL(cfg.endpoint);
  const now = new Date();
  const amzDate = amzTimestamp(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(text);
  const canonicalUri = `/${encodeURIComponent(cfg.bucket)}/${encodePath(key)}`;
  const canonicalHeaders = `content-type:application/json\nhost:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const kDate = await hmac(`AWS4${cfg.secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, cfg.region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = await hmac(kSigning, stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`${cfg.endpoint}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
    },
    body: text,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`MOTHER_STORAGE_WRITE_FAILED:${response.status}:${detail.slice(0, 200)}`);
  }
  return { key, checksum: payloadHash, status: response.status };
}

function exportKey(env, tenantSlug, entityType, localId) {
  const cfg = wasabiConfig(env);
  const prefix = cfg.prefix ? `${cfg.prefix}/` : '';
  return `${prefix}tenants/${encodeURIComponent(tenantSlug)}/${entityType}s/${encodeURIComponent(localId)}.json`;
}

async function loadCustomer(env, tenantSlug, id) {
  return env.DB.prepare(`
    SELECT * FROM customers
    WHERE tenant_slug = ?
      AND (customer_id = ? OR contact_phone = ? OR customer_line_uid = ? OR customer_phone = ?)
    LIMIT 1
  `).bind(tenantSlug, id, normalizePhone(id), id, id).first();
}

async function loadOrder(env, tenantSlug, id) {
  return env.DB.prepare(`
    SELECT * FROM orders
    WHERE tenant_slug = ? AND order_id = ?
    LIMIT 1
  `).bind(tenantSlug, id).first();
}

async function exportOne(env, tenantSlug, entityType, id, dryRun) {
  let row;
  let payload;
  if (entityType === 'customer') {
    row = await loadCustomer(env, tenantSlug, id);
    if (!row) throw new Error('CUSTOMER_NOT_FOUND');
    payload = buildTenantCustomerExportPayload(row);
  } else {
    row = await loadOrder(env, tenantSlug, id);
    if (!row) throw new Error('ORDER_NOT_FOUND');
    payload = buildTenantOrderExportPayload(row, entityType);
  }
  if (!payload.local_id) throw new Error('MISSING_EXPORT_LOCAL_ID');
  const key = exportKey(env, tenantSlug, entityType, payload.local_id);
  const text = JSON.stringify(payload, null, 2);
  const checksum = await sha256Hex(text);
  if (dryRun) return { success: true, id: payload.local_id, key, checksum, payload, dryRun: true };
  const write = await signedWasabiPut(env, key, text);
  return { success: true, id: payload.local_id, key, checksum: write.checksum, dryRun: false };
}

async function exportEntities(request, env, entityType) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';
  const batchPath = new URL(request.url).pathname.endsWith('s');
  let ids = [];
  if (Array.isArray(body.ids)) ids = body.ids.map(value => cleanText(value, 160)).filter(Boolean).slice(0, MAX_BATCH);
  const singleId = cleanText(
    body.customer_id || body.customerId || body.customer_phone || body.customerPhone ||
    body.order_id || body.orderId || body.id,
    160,
  );
  if (!batchPath && singleId) ids = [singleId];
  if (!ids.length && batchPath) {
    const limit = Math.max(1, Math.min(Number(body.limit || 20), MAX_BATCH));
    const table = entityType === 'customer' ? 'customers' : 'orders';
    const idColumn = entityType === 'customer' ? 'customer_id' : 'order_id';
    const { results } = await env.DB.prepare(`
      SELECT ${idColumn} AS id
      FROM ${table}
      WHERE tenant_slug = ? AND ${idColumn} <> ''
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).bind(context.tenantSlug, limit).all();
    ids = (results || []).map(row => String(row.id || '')).filter(Boolean);
  }
  if (!ids.length) throw new Error(entityType === 'customer' ? 'MISSING_CUSTOMER_ID' : 'MISSING_ORDER_ID');

  const results = [];
  for (const id of ids) {
    try {
      results.push(await exportOne(env, context.tenantSlug, entityType, id, dryRun));
    } catch (error) {
      results.push({ success: false, id, error: String(error?.message || error) });
    }
  }
  const success = results.every(item => item.success);
  return json({
    success,
    data: {
      tenant_slug: context.tenantSlug,
      entity_type: entityType,
      requested: ids.length,
      synced: results.filter(item => item.success).length,
      failed: results.filter(item => !item.success).length,
      dryRun,
      results,
    },
  }, success ? 200 : 207);
}

async function listLegacyCustomers(request, env) {
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'editor', 'sales', 'finance', 'support', 'member']);
  const url = new URL(request.url);
  const requestedUid = cleanText(url.searchParams.get('uid'), 100);
  const canReadAll = ['platform_admin', 'tenant_admin', 'support'].includes(context.role) || context.permissions.includes('*') || context.permissions.includes('customer.read.all');
  if (requestedUid && requestedUid !== context.userUid && !canReadAll) throw new Error('TENANT_ACCESS_DENIED');
  const binds = [context.tenantSlug];
  let where = 'tenant_slug = ?';
  const ownerUid = canReadAll ? requestedUid : context.userUid;
  if (ownerUid) {
    where += ' AND owner_uid = ?';
    binds.push(ownerUid);
  }
  const { results } = await env.DB.prepare(`
    SELECT * FROM customers
    WHERE ${where}
    ORDER BY last_order_at DESC, updated_at DESC
    LIMIT 500
  `).bind(...binds).all();
  return json({ success: true, data: (results || []).map(toLegacyCustomerView), tenantSlug: context.tenantSlug });
}

async function listLegacyOrders(request, env, action) {
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'editor', 'sales', 'finance', 'support', 'member']);
  const url = new URL(request.url);
  const requestedUid = cleanText(url.searchParams.get('uid'), 100);
  const canReadAll = ['platform_admin', 'tenant_admin', 'finance', 'support'].includes(context.role) || context.permissions.includes('*') || context.permissions.includes('order.read.all');
  if (action === 'getAllOrders' && !canReadAll) throw new Error('TENANT_ROLE_DENIED');
  if (requestedUid && requestedUid !== context.userUid && !canReadAll) throw new Error('TENANT_ACCESS_DENIED');
  const binds = [context.tenantSlug];
  let where = 'tenant_slug = ?';
  if (action === 'getUserOrders') {
    const uid = canReadAll && requestedUid ? requestedUid : context.userUid;
    where += ' AND (customer_line_uid = ? OR distributor_uid = ?)';
    binds.push(uid, uid);
  }
  const { results } = await env.DB.prepare(`
    SELECT * FROM orders
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT 500
  `).bind(...binds).all();
  return json({ success: true, data: (results || []).map(toLegacyOrderView), tenantSlug: context.tenantSlug });
}

async function legacyOrderStatus(request, env) {
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'editor', 'sales', 'finance', 'support', 'member']);
  const url = new URL(request.url);
  const orderId = cleanText(url.searchParams.get('order_id') || url.searchParams.get('orderId'), 160);
  if (!orderId) throw new Error('ORDER_NOT_FOUND');
  const row = await env.DB.prepare(`
    SELECT * FROM orders
    WHERE tenant_slug = ? AND order_id = ?
    LIMIT 1
  `).bind(context.tenantSlug, orderId).first();
  if (!row) throw new Error('ORDER_NOT_FOUND');
  const canReadAll = ['platform_admin', 'tenant_admin', 'finance', 'support'].includes(context.role);
  if (!canReadAll && row.customer_line_uid !== context.userUid && row.distributor_uid !== context.userUid) {
    throw new Error('TENANT_ACCESS_DENIED');
  }
  return json({ success: true, data: toLegacyOrderView(row), tenantSlug: context.tenantSlug });
}

async function legacyOrderCreate(request, env, legacyWorker) {
  const body = await request.json().catch(() => ({}));
  await requireContext(request, env, ['platform_admin', 'tenant_admin', 'editor', 'sales', 'finance', 'support', 'member'], body);
  const tenantSlug = requestedTenantSlug(request, body);
  const url = new URL('/api/v2/bookings', request.url);
  url.searchParams.set('tenant', tenantSlug);
  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Tenant-Slug', tenantSlug);
  const translated = new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      itinerary_id: body.itinerary_id || body.itineraryId,
      distributor_uid: body.distributor_uid || body.distributorUid,
      invite_code: body.invite_code || body.inviteCode,
      customer_name: body.customer_name || body.customerName,
      customer_phone: body.customer_phone || body.customerPhone,
      travelers: body.travelers,
      travel_date: body.travel_date || body.travelDate,
      note: body.note,
      source: body.source || 'legacy_order_create',
    }),
  });
  return routeTenantBookingApi(translated, env, legacyWorker);
}

export async function routeLegacyCustomerCompatApi(request, env, legacyWorker) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/api/orders/create' && request.method === 'POST') return legacyOrderCreate(request, env, legacyWorker);
    if (path === '/api/orders/status' && request.method === 'GET') return legacyOrderStatus(request, env);
    if (path === '/api/my/customers' && request.method === 'GET') return listLegacyCustomers(request, env);
    if (path === '/api/itineraries' && request.method === 'GET') {
      const action = url.searchParams.get('action') || '';
      if (action === 'getMyCustomers') return listLegacyCustomers(request, env);
      if (action === 'getUserOrders' || action === 'getAllOrders') return listLegacyOrders(request, env, action);
    }
    if (request.method === 'POST' && CUSTOMER_EXPORT_PATHS.has(path)) return exportEntities(request, env, 'customer');
    if (request.method === 'POST' && (path.endsWith('commission') || path.endsWith('commissions'))) return exportEntities(request, env, 'commission');
    if (request.method === 'POST' && ORDER_EXPORT_PATHS.has(path)) return exportEntities(request, env, 'order');
    return json({ success: false, error: 'LEGACY_CUSTOMER_COMPAT_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'LEGACY_CUSTOMER_COMPAT_ERROR');
    const status = code.startsWith('MOTHER_STORAGE_WRITE_FAILED') ? 502 : statusForError(code, 400);
    return json({ success: false, error: code }, status);
  }
}
