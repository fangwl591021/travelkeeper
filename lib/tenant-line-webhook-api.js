import { normalizeTenantSlug } from './tenant-context.js';
import { loadTenantLineSecrets } from './tenant-line-channel-api.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function text(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || ''))));
  return Array.from(bytes, item => item.toString(16).padStart(2, '0')).join('');
}

async function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return bytesToBase64(new Uint8Array(digest)) === signature;
}

function sourceUid(event) {
  return text(event?.source?.userId, 120);
}

function eventType(event) {
  return text(event?.type || 'unknown', 40);
}

function messageType(event) {
  return event?.type === 'message' ? text(event?.message?.type || 'unknown', 40) : '';
}

function contentFor(event) {
  if (event?.type === 'message') {
    const message = event.message || {};
    if (message.type === 'text') return text(message.text, 5000);
    if (message.type === 'location') return text(`${message.title || ''} ${message.address || ''}`.trim(), 5000);
    if (message.type === 'sticker') return text(`sticker:${message.packageId || ''}:${message.stickerId || ''}`, 500);
    if (message.type === 'file') return text(message.fileName || 'file', 500);
    return text(`[${message.type || 'message'}]`, 200);
  }
  if (event?.type === 'postback') return text(event?.postback?.data, 5000);
  return text(`[${event?.type || 'event'}]`, 200);
}

function metadataFor(event) {
  const source = event?.source || {};
  const message = event?.message || {};
  return {
    source_type: source.type || '',
    group_id: source.groupId || '',
    room_id: source.roomId || '',
    message_id: message.id || '',
    quote_token: message.quoteToken || '',
    postback_params: event?.postback?.params || null,
    beacon: event?.beacon || null,
    delivery_context: event?.deliveryContext || null,
  };
}

async function fetchLineProfile(accessToken, userUid) {
  if (!accessToken || !userUid) return null;
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userUid)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  }
}

async function existingProfile(env, tenantSlug, lineUid) {
  return env.DB.prepare(`
    SELECT * FROM tenant_crm_profiles
    WHERE tenant_slug = ? AND line_user_uid = ?
    LIMIT 1
  `).bind(tenantSlug, lineUid).first();
}

async function ensureProfile(env, tenantSlug, lineUid, accessToken, event) {
  let row = await existingProfile(env, tenantSlug, lineUid);
  const lineProfile = await fetchLineProfile(accessToken, lineUid);
  const now = new Date().toISOString();
  if (!row) {
    const id = `CRMLINE-${(await sha256Hex(`${tenantSlug}:${lineUid}`)).slice(0, 32).toUpperCase()}`;
    await env.DB.prepare(`
      INSERT INTO tenant_crm_profiles (
        id, tenant_slug, customer_id, line_user_uid, display_name, picture_url,
        source, status, risk, opportunity_stage, last_message_at,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, '', ?, ?, ?, 'line', 'open', 'low', 'new', ?, 'line-webhook', 'line-webhook', ?, ?)
      ON CONFLICT(tenant_slug, line_user_uid) WHERE line_user_uid <> '' DO UPDATE SET
        display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE tenant_crm_profiles.display_name END,
        picture_url = CASE WHEN excluded.picture_url <> '' THEN excluded.picture_url ELSE tenant_crm_profiles.picture_url END,
        last_message_at = excluded.last_message_at,
        updated_by = 'line-webhook',
        updated_at = excluded.updated_at
    `).bind(
      id, tenantSlug, lineUid,
      text(lineProfile?.displayName || '', 200), text(lineProfile?.pictureUrl || '', 1000),
      now, now, now,
    ).run();
  } else {
    await env.DB.prepare(`
      UPDATE tenant_crm_profiles
      SET display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
          picture_url = CASE WHEN ? <> '' THEN ? ELSE picture_url END,
          last_message_at = ?, updated_by = 'line-webhook', updated_at = ?
      WHERE tenant_slug = ? AND id = ?
    `).bind(
      text(lineProfile?.displayName || '', 200), text(lineProfile?.displayName || '', 200),
      text(lineProfile?.pictureUrl || '', 1000), text(lineProfile?.pictureUrl || '', 1000),
      now, now, tenantSlug, row.id,
    ).run();
  }
  row = await existingProfile(env, tenantSlug, lineUid);
  return row;
}

async function ensureThread(env, tenantSlug, profile, lineUid, event) {
  const now = new Date().toISOString();
  const id = `CRMTHREAD-${(await sha256Hex(`${tenantSlug}:${lineUid}`)).slice(0, 32).toUpperCase()}`;
  await env.DB.prepare(`
    INSERT INTO tenant_crm_threads (
      id, tenant_slug, profile_id, customer_id, line_user_uid, channel_key,
      status, risk, last_message_at, last_inbound_at,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'line', 'open', 'low', ?, ?, 'line-webhook', 'line-webhook', ?, ?)
    ON CONFLICT(tenant_slug, line_user_uid) WHERE line_user_uid <> '' DO UPDATE SET
      profile_id = excluded.profile_id,
      customer_id = excluded.customer_id,
      last_message_at = excluded.last_message_at,
      last_inbound_at = excluded.last_inbound_at,
      updated_by = 'line-webhook',
      updated_at = excluded.updated_at
  `).bind(
    id, tenantSlug, profile.id, profile.customer_id || '', lineUid,
    now, now, now, now,
  ).run();
  return env.DB.prepare(`SELECT * FROM tenant_crm_threads WHERE tenant_slug = ? AND line_user_uid = ? LIMIT 1`)
    .bind(tenantSlug, lineUid).first();
}

async function insertEvent(env, tenantSlug, event, secrets) {
  const lineUid = sourceUid(event);
  if (!lineUid) return { inserted: false, skipped: true, reason: 'NO_USER_ID' };
  const webhookEventId = text(event?.webhookEventId, 160);
  const fingerprint = await sha256Hex(JSON.stringify({ tenantSlug, event }));
  const duplicate = await env.DB.prepare(`
    SELECT id FROM tenant_crm_messages
    WHERE tenant_slug = ? AND (event_fingerprint = ? OR (? <> '' AND webhook_event_id = ?))
    LIMIT 1
  `).bind(tenantSlug, fingerprint, webhookEventId, webhookEventId).first();
  if (duplicate) return { inserted: false, duplicate: true };

  const profile = await ensureProfile(env, tenantSlug, lineUid, secrets.channel_access_token, event);
  const thread = await ensureThread(env, tenantSlug, profile, lineUid, event);
  const id = webhookEventId ? `LINEMSG-${webhookEventId}` : `LINEMSG-${fingerprint.slice(0, 32).toUpperCase()}`;
  await env.DB.prepare(`
    INSERT INTO tenant_crm_messages (
      id, tenant_slug, profile_id, thread_id, webhook_event_id, event_fingerprint,
      direction, event_type, message_type, content, metadata_json,
      reply_token_present, event_timestamp, redelivery, processed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    id, tenantSlug, profile.id, thread.id, webhookEventId, fingerprint,
    eventType(event), messageType(event), contentFor(event), JSON.stringify(metadataFor(event)),
    event?.replyToken ? 1 : 0,
    Number(event?.timestamp || 0),
    event?.deliveryContext?.isRedelivery ? 1 : 0,
  ).run();
  return { inserted: true, profile_id: profile.id, thread_id: thread.id, message_id: id };
}

function webhookTenant(path) {
  const match = path.match(/^\/api\/v2\/line\/webhook\/([a-z0-9][a-z0-9-]{0,62})$/);
  return match ? normalizeTenantSlug(match[1]) : '';
}

export function isTenantLineWebhookRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return request.method === 'POST' && !!webhookTenant(path);
}

export async function routeTenantLineWebhook(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const tenantSlug = webhookTenant(path);
  if (!tenantSlug) return null;
  const rawBody = await request.text();
  const requestFingerprint = await sha256Hex(rawBody);
  try {
    if (!env.DB) throw new Error('D1_REQUIRED');
    const { row, secrets } = await loadTenantLineSecrets(env, tenantSlug);
    const signature = text(request.headers.get('x-line-signature'), 500);
    const valid = await verifyLineSignature(rawBody, signature, secrets.channel_secret);
    if (!valid) throw new Error('LINE_WEBHOOK_SIGNATURE_INVALID');
    const body = JSON.parse(rawBody || '{}');
    const events = Array.isArray(body.events) ? body.events : [];
    let inserted = 0;
    let duplicates = 0;
    for (const event of events) {
      const result = await insertEvent(env, tenantSlug, event, secrets);
      if (result.inserted) inserted += 1;
      if (result.duplicate) duplicates += 1;
    }
    const logId = `LINEHOOK-${requestFingerprint.slice(0, 32).toUpperCase()}`;
    await env.DB.prepare(`
      INSERT INTO tenant_line_webhook_logs (
        id, tenant_slug, request_fingerprint, event_count, inserted_count,
        duplicate_count, status, received_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'processed', datetime('now'), datetime('now'))
      ON CONFLICT(tenant_slug, request_fingerprint) DO UPDATE SET
        duplicate_count = tenant_line_webhook_logs.duplicate_count + excluded.event_count,
        completed_at = datetime('now')
    `).bind(logId, tenantSlug, requestFingerprint, events.length, inserted, duplicates).run();
    await env.DB.prepare(`
      UPDATE tenant_line_channels
      SET last_webhook_at = datetime('now'), last_error = '', updated_at = datetime('now')
      WHERE tenant_slug = ?
    `).bind(tenantSlug).run();
    return json({ success: true, tenant_slug: tenantSlug, events: events.length, inserted, duplicates });
  } catch (error) {
    const code = String(error?.message || error || 'LINE_WEBHOOK_PROCESSING_FAILED');
    if (env.DB) {
      try {
        await env.DB.prepare(`
          UPDATE tenant_line_channels SET last_error = ?, updated_at = datetime('now') WHERE tenant_slug = ?
        `).bind(code, tenantSlug).run();
      } catch (_) {}
    }
    const status = code === 'LINE_WEBHOOK_SIGNATURE_INVALID' ? 401
      : code === 'TENANT_LINE_CHANNEL_NOT_CONFIGURED' ? 404
      : code === 'TENANT_LINE_CHANNEL_DISABLED' ? 409
      : code === 'D1_REQUIRED' || code.startsWith('TENANT_PAYMENT_') ? 503
      : 400;
    return json({ success: false, error: code }, status);
  }
}
