import { requestedTenantSlug, requireTenantContext } from './tenant-context.js';
import { loadTenantLineSecrets } from './tenant-line-channel-api.js';
import { statusForError } from './http-error-status.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function text(value, max = 5000) { return String(value || '').trim().slice(0, max); }
function uid(request) { return text(request.headers.get('x-user-uid'), 100); }
function parseJson(value, fallback) { try { return JSON.parse(String(value || '')); } catch (_) { return fallback; } }
function nowIso() { return new Date().toISOString(); }
function safeToken(value, max = 120) { return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, max); }

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function sanitizeOutboundText(value) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 2000);
  if (!cleaned) throw new Error('LINE_MESSAGE_TEXT_REQUIRED');
  return cleaned;
}

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
    text_content: row.text_content || row.content || '',
    send_status: row.send_status || '',
    line_message_id: row.line_message_id || '',
    error_code: row.error_code || '',
    error_message_safe: row.error_message_safe || '',
    sent_by_uid: row.sent_by_uid || '',
    sent_by_role: row.sent_by_role || '',
    sent_at: row.sent_at || '',
    client_request_id: row.client_request_id || '',
    retryable: !!Number(row.retryable || 0),
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

async function audit(env, ctx, action, threadId, messageId, status, errorCode = '') {
  await env.DB.prepare(`
    INSERT INTO audit_logs (
      id, tenant_slug, actor_uid, action, target_type, target_id,
      before_json, after_json, request_id, created_at
    ) VALUES (?, ?, ?, ?, 'tenant_crm_message', ?, '', ?, ?, datetime('now'))
  `).bind(
    `AUDIT-LINE-${(await sha256Hex(`${ctx.tenantSlug}:${threadId}:${messageId}:${status}:${Date.now()}`)).slice(0, 32).toUpperCase()}`,
    ctx.tenantSlug,
    ctx.userUid,
    action,
    messageId,
    JSON.stringify({ thread_id: threadId, status, error_code: errorCode }),
    messageId,
  ).run();
}

async function linePush(env, accessToken, lineUserUid, outboundText) {
  const endpoint = String(env.LINE_PUSH_API_URL || 'https://api.line.me/v2/bot/message/push').trim();
  const timeoutMs = Math.min(30000, Math.max(1000, Number(env.LINE_PUSH_TIMEOUT_MS || 8000)));
  const body = JSON.stringify({
    to: lineUserUid,
    messages: [{ type: 'text', text: outboundText }],
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    const lineMessageId = String(
      payload?.sentMessages?.[0]?.id ||
      response.headers.get('x-line-request-id') ||
      ''
    ).slice(0, 160);
    return {
      ok: response.ok,
      status: response.status,
      lineMessageId,
      retryable: response.status === 429 || response.status >= 500,
    };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      errorCode: aborted ? 'LINE_PUSH_TIMEOUT' : 'LINE_PUSH_FETCH_FAILED',
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function createOutboundMessage(request, env, threadId) {
  const ctx = await context(request, env);
  const thread = await getThread(env, ctx, threadId);
  if (!thread.line_user_uid) throw new Error('LINE_THREAD_RECIPIENT_REQUIRED');
  const body = await request.json().catch(() => ({}));
  if (text(body.type, 20) !== 'text') throw new Error('INVALID_LINE_MESSAGE_TYPE');
  const outboundText = sanitizeOutboundText(body.text);
  const clientRequestId = safeToken(body.client_request_id || request.headers.get('x-client-request-id') || '', 120);
  if (!clientRequestId) throw new Error('LINE_CLIENT_REQUEST_ID_REQUIRED');

  const duplicate = await env.DB.prepare(`
    SELECT * FROM tenant_crm_messages
    WHERE tenant_slug = ? AND thread_id = ? AND client_request_id = ?
    LIMIT 1
  `).bind(ctx.tenantSlug, threadId, clientRequestId).first();
  if (duplicate) {
    return json({ success: true, duplicate: true, data: { thread: threadView(thread), message: messageView(duplicate) } });
  }

  const messageId = `LINEMSG-${(await sha256Hex(`${ctx.tenantSlug}:${threadId}:${clientRequestId}`)).slice(0, 32).toUpperCase()}`;
  const eventFingerprint = `outbound:${messageId}`;
  const createdAt = nowIso();
  await env.DB.prepare(`
    INSERT INTO tenant_crm_messages (
      id, tenant_slug, profile_id, thread_id, webhook_event_id, event_fingerprint,
      direction, event_type, message_type, content, text_content, metadata_json,
      reply_token_present, event_timestamp, redelivery, processed_at, created_at,
      send_status, sent_by_uid, sent_by_role, client_request_id
    ) VALUES (?, ?, ?, ?, '', ?, 'outbound', 'message', 'text', ?, ?, '{}',
      0, ?, 0, ?, ?, 'pending', ?, ?, ?)
  `).bind(
    messageId, ctx.tenantSlug, thread.profile_id, thread.id, eventFingerprint,
    outboundText, outboundText, Date.now(), createdAt, createdAt,
    ctx.userUid, ctx.role, clientRequestId,
  ).run();

  let finalStatus = 'failed';
  let errorCode = '';
  let lineMessageId = '';
  let retryable = 0;
  try {
    const { secrets } = await loadTenantLineSecrets(env, ctx.tenantSlug);
    const result = await linePush(env, secrets.channel_access_token, thread.line_user_uid, outboundText);
    if (result.ok) {
      finalStatus = 'sent';
      lineMessageId = result.lineMessageId || '';
    } else {
      errorCode = result.errorCode || `LINE_PUSH_HTTP_${result.status}`;
      retryable = result.retryable ? 1 : 0;
    }
  } catch (error) {
    errorCode = String(error?.message || error || 'LINE_PUSH_FAILED');
    retryable = errorCode === 'TENANT_LINE_CHANNEL_NOT_CONFIGURED' || errorCode === 'TENANT_LINE_CHANNEL_DISABLED' ? 0 : 1;
  }

  await env.DB.prepare(`
    UPDATE tenant_crm_messages
    SET send_status = ?,
        line_message_id = ?,
        error_code = ?,
        error_message_safe = ?,
        retryable = ?,
        sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END,
        processed_at = datetime('now')
    WHERE tenant_slug = ? AND id = ?
  `).bind(
    finalStatus, lineMessageId, errorCode, errorCode, retryable, finalStatus,
    ctx.tenantSlug, messageId,
  ).run();

  if (finalStatus === 'sent') {
    await env.DB.prepare(`
      UPDATE tenant_crm_threads
      SET last_message_at = datetime('now'), last_outbound_at = datetime('now'), updated_by = ?, updated_at = datetime('now')
      WHERE tenant_slug = ? AND id = ?
    `).bind(ctx.userUid, ctx.tenantSlug, threadId).run();
    await env.DB.prepare(`
      UPDATE tenant_crm_profiles
      SET last_message_at = datetime('now'), updated_by = ?, updated_at = datetime('now')
      WHERE tenant_slug = ? AND id = ?
    `).bind(ctx.userUid, ctx.tenantSlug, thread.profile_id).run();
  }
  await audit(env, ctx, 'tenant.line.message.send', threadId, messageId, finalStatus, errorCode);

  const saved = await env.DB.prepare(`
    SELECT * FROM tenant_crm_messages WHERE tenant_slug = ? AND id = ? LIMIT 1
  `).bind(ctx.tenantSlug, messageId).first();
  const updatedThread = await getThread(env, ctx, threadId);
  return json({ success: finalStatus === 'sent', data: { thread: threadView(updatedThread), message: messageView(saved) }, error: errorCode || undefined }, finalStatus === 'sent' ? 200 : statusForError(errorCode, 502));
}

export function isTenantLineMonitorApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/line/threads' || /^\/api\/v2\/line\/threads\/[^/]+(?:\/messages)?$/.test(path);
}

export async function routeTenantLineMonitorApi(request, env) {
  try {
    if (!env.DB) throw new Error('D1_REQUIRED');
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (request.method === 'GET' && path === '/api/v2/line/threads') return await listThreads(request, env);
    const messages = path.match(/^\/api\/v2\/line\/threads\/([^/]+)\/messages$/);
    if (request.method === 'GET' && messages) return await listMessages(request, env, decodeURIComponent(messages[1]));
    if (request.method === 'POST' && messages) return await createOutboundMessage(request, env, decodeURIComponent(messages[1]));
    const thread = path.match(/^\/api\/v2\/line\/threads\/([^/]+)$/);
    if (request.method === 'POST' && thread) return await updateThread(request, env, decodeURIComponent(thread[1]));
    return json({ success: false, error: 'LINE_MONITOR_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'LINE_MONITOR_FAILED');
    return json({ success: false, error: code }, statusForError(code, 400));
  }
}
