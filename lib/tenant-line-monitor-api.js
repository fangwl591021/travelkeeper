import { requestedTenantSlug, requireTenantContext } from './tenant-context.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function text(value, max = 5000) { return String(value || '').trim().slice(0, max); }
function uid(request) { return text(request.headers.get('x-user-uid'), 100); }
function parseJson(value, fallback) { try { return JSON.parse(String(value || '')); } catch (_) { return fallback; } }

async function context(request, env) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request),
    userUid: uid(request),
    allowedRoles: ['platform_admin', 'tenant_admin', 'sales', 'editor'],
  });
}

function canReadAll(ctx) { return ['platform_admin', 'tenant_admin'].includes(ctx.role); }

function threadView(row) {
  return {
    id: row.id,
    profile_id: row.profile_id,
    customer_id: row.customer_id || '',
    line_user_uid: row.line_user_uid || '',
    display_name: row.display_name || '',
    picture_url: row.picture_url || '',
    phone: row.phone || '',
    owner_uid: row.owner_uid || '',
    status: row.status || 'open',
    risk: row.risk || 'low',
    summary: row.summary || '',
    note: row.note || '',
    tags: parseJson(row.tags_json, []),
    last_message_at: row.last_message_at || '',
    last_inbound_at: row.last_inbound_at || '',
    last_outbound_at: row.last_outbound_at || '',
    last_message: row.last_message || '',
    message_count: Number(row.message_count || 0),
  };
}

function messageView(row) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    profile_id: row.profile_id,
    direction: row.direction,
    event_type: row.event_type,
    message_type: row.message_type,
    content: row.content || '',
    metadata: parseJson(row.metadata_json, {}),
    event_timestamp: Number(row.event_timestamp || 0),
    redelivery: !!Number(row.redelivery || 0),
    created_at: row.created_at || row.processed_at || '',
  };
}

async function getThread(env, ctx, threadId) {
  const row = await env.DB.prepare(`
    SELECT t.*, p.display_name, p.picture_url, p.phone, p.owner_uid
    FROM tenant_crm_threads t
    JOIN tenant_crm_profiles p ON p.tenant_slug = t.tenant_slug AND p.id = t.profile_id
    WHERE t.tenant_slug = ? AND t.id = ?
    LIMIT 1
  `).bind(ctx.tenantSlug, threadId).first();
  if (!row) throw new Error('LINE_THREAD_NOT_FOUND');
  if (!canReadAll(ctx) && row.owner_uid !== ctx.userUid) throw new Error('LINE_THREAD_ACCESS_DENIED');
  return row;
}

async function listThreads(request, env) {
  const ctx = await context(request, env);
  const url = new URL(request.url);
  const status = text(url.searchParams.get('status'), 20);
  const search = text(url.searchParams.get('search'), 200).toLowerCase();
  const limit = Math.min(300, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const args = [ctx.tenantSlug];
  const where = ['t.tenant_slug = ?'];
  if (!canReadAll(ctx)) { where.push('p.owner_uid = ?'); args.push(ctx.userUid); }
  if (status && status !== 'all') { where.push('t.status = ?'); args.push(status); }
  const rows = await env.DB.prepare(`
    SELECT t.*, p.display_name, p.picture_url, p.phone, p.owner_uid,
      (SELECT m.content FROM tenant_crm_messages m
       WHERE m.tenant_slug = t.tenant_slug AND m.thread_id = t.id
       ORDER BY m.event_timestamp DESC, m.created_at DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM tenant_crm_messages m
       WHERE m.tenant_slug = t.tenant_slug AND m.thread_id = t.id) AS message_count
    FROM tenant_crm_threads t
    JOIN tenant_crm_profiles p ON p.tenant_slug = t.tenant_slug AND p.id = t.profile_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(NULLIF(t.last_message_at, ''), t.updated_at) DESC
    LIMIT ?
  `).bind(...args, limit).all();
  let data = (rows.results || []).map(threadView);
  if (search) data = data.filter(row => [row.display_name, row.line_user_uid, row.phone, row.summary, row.note, ...(row.tags || [])].join(' ').toLowerCase().includes(search));
  return json({ success: true, data, tenant_slug: ctx.tenantSlug, role: ctx.role });
}

async function listMessages(request, env, threadId) {
  const ctx = await context(request, env);
  const thread = await getThread(env, ctx, threadId);
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
  const rows = await env.DB.prepare(`
    SELECT * FROM tenant_crm_messages
    WHERE tenant_slug = ? AND thread_id = ?
    ORDER BY event_timestamp ASC, created_at ASC
    LIMIT ?
  `).bind(ctx.tenantSlug, threadId, limit).all();
  return json({ success: true, data: { thread: threadView(thread), messages: (rows.results || []).map(messageView) } });
}

async function updateThread(request, env, threadId) {
  const ctx = await context(request, env);
  await getThread(env, ctx, threadId);
  const body = await request.json().catch(() => ({}));
  const status = text(body.status, 20);
  const risk = text(body.risk, 20);
  if (status && !['open', 'pending', 'closed'].includes(status)) throw new Error('INVALID_CRM_STATUS');
  if (risk && !['low', 'medium', 'high'].includes(risk)) throw new Error('INVALID_CRM_RISK');
  const tags = Array.isArray(body.tags) ? body.tags.map(item => text(item, 60)).filter(Boolean).slice(0, 30) : null;
  await env.DB.prepare(`
    UPDATE tenant_crm_threads SET
      status = CASE WHEN ? <> '' THEN ? ELSE status END,
      risk = CASE WHEN ? <> '' THEN ? ELSE risk END,
      summary = CASE WHEN ? IS NOT NULL THEN ? ELSE summary END,
      note = CASE WHEN ? IS NOT NULL THEN ? ELSE note END,
      tags_json = CASE WHEN ? IS NOT NULL THEN ? ELSE tags_json END,
      updated_by = ?, updated_at = datetime('now')
    WHERE tenant_slug = ? AND id = ?
  `).bind(
    status, status, risk, risk,
    body.summary === undefined ? null : text(body.summary, 5000), body.summary === undefined ? '' : text(body.summary, 5000),
    body.note === undefined ? null : text(body.note, 5000), body.note === undefined ? '' : text(body.note, 5000),
    tags === null ? null : JSON.stringify(tags), tags === null ? '' : JSON.stringify(tags),
    ctx.userUid, ctx.tenantSlug, threadId,
  ).run();
  return listMessages(request, env, threadId);
}

export function isTenantLineMonitorApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/line/threads' || /^\/api\/v2\/line\/threads\/[^/]+(?:\/messages)?$/.test(path);
}

export async function routeTenantLineMonitorApi(request, env) {
  try {
    if (!env.DB) throw new Error('D1_REQUIRED');
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (request.method === 'GET' && path === '/api/v2/line/threads') return listThreads(request, env);
    const messages = path.match(/^\/api\/v2\/line\/threads\/([^/]+)\/messages$/);
    if (request.method === 'GET' && messages) return listMessages(request, env, decodeURIComponent(messages[1]));
    const thread = path.match(/^\/api\/v2\/line\/threads\/([^/]+)$/);
    if (request.method === 'POST' && thread) return updateThread(request, env, decodeURIComponent(thread[1]));
    return json({ success: false, error: 'LINE_MONITOR_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'LINE_MONITOR_FAILED');
    const status = code === 'AUTH_REQUIRED' ? 401
      : code.includes('DENIED') ? 403
      : code.endsWith('_NOT_FOUND') ? 404
      : code.startsWith('INVALID_') ? 400
      : code === 'D1_REQUIRED' ? 503 : 400;
    return json({ success: false, error: code }, status);
  }
}
