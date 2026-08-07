import { normalizeTenantSlug } from './tenant-context.js';
import { loadTenantLineSecrets } from './tenant-line-channel-api.js';
import { DEFAULT_SLA_SETTINGS, normalizeSlaSettings, startWaitingCycle } from './tenant-line-sla.js';
import { emitLineReceipt } from './tenant-line-receipt.js';
import { selectEligibleWorkspaceWebhookEvent } from './workspace-webhook-event-eligibility.js';
import { resolveWorkspaceWebhookRoutes } from './workspace-webhook-route-adapter.js';
import { planWorkspaceWebhookReply } from './workspace-webhook-reply-planner.js';
import { resolveWorkspaceWebhookIdentity } from './workspace-webhook-identity-adapter.js';

const WORKSPACE_PLAN_OUTCOMES = new Set([
  'not_workspace_intent', 'login_required', 'forbidden', 'allowed', 'configuration_error'
]);

function safeWorkspacePlanOutcome(plan) {
  return WORKSPACE_PLAN_OUTCOMES.has(plan?.outcome) ? plan.outcome : 'configuration_error';
}

const MEMBERSHIP_ROLE_LABELS = Object.freeze({
  platform_admin: '平台管理員',
  tenant_admin: '租戶管理員',
  finance: '財務人員',
  partner: '合作夥伴',
  traveler: '一般會員'
});

function isMembershipQueryText(value) {
  const query = text(value, 120).replace(/\s+/g, '');
  return /^(?:會員查詢|查詢會員|我的會員(?:資料|狀態|資格)?|會員(?:資料|狀態|資格)?)$/.test(query);
}

export function membershipReplyText(identity) {
  const role = MEMBERSHIP_ROLE_LABELS[identity?.primaryRole];
  return role
    ? `您已完成會員綁定，目前身分：${role}。`
    : '目前查無您的會員綁定資料。';
}

async function sendTenantLineReply(accessToken, replyToken, message) {
  if (!accessToken || !replyToken || !message) return false;
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: message }] }),
    });
    return response.ok;
  } catch (_) {
    return false;
  }
}

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

function base64ToBytes(value) {
  try {
    const binary = atob(String(value || ''));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch (_) {
    return new Uint8Array();
  }
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || ''))));
  return Array.from(bytes, item => item.toString(16).padStart(2, '0')).join('');
}

async function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const actual = base64ToBytes(signature);
  if (expected.length !== actual.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ actual[index];
  return mismatch === 0;
}

function sourceUid(event) { return text(event?.source?.userId, 120); }
function eventType(event) { return text(event?.type || 'unknown', 40); }
function messageType(event) { return event?.type === 'message' ? text(event?.message?.type || 'unknown', 40) : ''; }

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
  if (String(globalThis?.TRAVELKEEPER_TENANT_LINE_PROFILE_FETCH_DISABLED || '').trim() === '1') return null;
  if (!accessToken || !userUid) return null;
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userUid)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.ok ? response.json() : null;
  } catch (_) { return null; }
}

async function getSlaSettings(env, tenantSlug) {
  const row = await env.DB.prepare(`
    SELECT first_response_sla_minutes, followup_response_sla_minutes, due_soon_percentage, pause_sla_on_pending
    FROM tenant_line_sla_settings
    WHERE tenant_slug = ?
    LIMIT 1
  `).bind(tenantSlug).first();
  return normalizeSlaSettings(row || DEFAULT_SLA_SETTINGS);
}
function flagEnabled(env, name) {
  const value = String(env?.[name] ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'enabled'].includes(value);
}

async function existingProfile(env, tenantSlug, lineUid) {
  return env.DB.prepare(`SELECT * FROM tenant_crm_profiles WHERE tenant_slug = ? AND line_user_uid = ? LIMIT 1`)
    .bind(tenantSlug, lineUid).first();
}

async function ensureProfile(env, tenantSlug, lineUid, accessToken) {
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
        updated_by = 'line-webhook', updated_at = excluded.updated_at
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

async function ensureThread(env, tenantSlug, profile, lineUid) {
  const now = new Date().toISOString();
  const id = `CRMTHREAD-${(await sha256Hex(`${tenantSlug}:${lineUid}`)).slice(0, 32).toUpperCase()}`;
  await env.DB.prepare(`
    INSERT INTO tenant_crm_threads (
      id, tenant_slug, profile_id, customer_id, line_user_uid, channel_key,
      status, risk, last_message_at, last_inbound_at,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'line', 'open', 'low', ?, ?, 'line-webhook', 'line-webhook', ?, ?)
    ON CONFLICT(tenant_slug, line_user_uid) WHERE line_user_uid <> '' DO UPDATE SET
      profile_id = excluded.profile_id, customer_id = excluded.customer_id,
      last_message_at = excluded.last_message_at, last_inbound_at = excluded.last_inbound_at,
      status = CASE WHEN tenant_crm_threads.status = 'closed' THEN 'open' ELSE tenant_crm_threads.status END,
      queue_status = CASE WHEN tenant_crm_threads.queue_status = 'closed' THEN 'open' ELSE tenant_crm_threads.queue_status END,
      closed_at = CASE WHEN tenant_crm_threads.queue_status = 'closed' THEN '' ELSE tenant_crm_threads.closed_at END,
      updated_by = 'line-webhook', updated_at = excluded.updated_at
  `).bind(id, tenantSlug, profile.id, profile.customer_id || '', lineUid, now, now, now, now).run();
  return env.DB.prepare(`SELECT * FROM tenant_crm_threads WHERE tenant_slug = ? AND line_user_uid = ? LIMIT 1`)
    .bind(tenantSlug, lineUid).first();
}

async function auditWebhookSla(env, tenantSlug, threadId, action, before = {}, after = {}) {
  const id = `AUDIT-LINE-WEBHOOK-${(await sha256Hex(`${tenantSlug}:${threadId}:${action}:${Date.now()}`)).slice(0, 32).toUpperCase()}`;
  await env.DB.prepare(`
    INSERT INTO audit_logs (
      id, tenant_slug, actor_uid, action, target_type, target_id,
      before_json, after_json, request_id, created_at
    ) VALUES (?, ?, 'line-webhook', ?, 'tenant_crm_thread', ?, ?, ?, ?, datetime('now'))
  `).bind(id, tenantSlug, action, threadId, JSON.stringify(before || {}), JSON.stringify(after || {}), threadId).run();
}
export async function insertEvent(env, tenantSlug, event, secrets) {
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

  const profile = await ensureProfile(env, tenantSlug, lineUid, secrets.channel_access_token);
  const thread = await ensureThread(env, tenantSlug, profile, lineUid);
  const settings = await getSlaSettings(env, tenantSlug);
  const slaStart = flagEnabled(env, 'TENANT_LINE_SLA_ENABLED')
    ? startWaitingCycle(thread, settings)
    : null;
  const storageHash = await sha256Hex(`${tenantSlug}:${webhookEventId || fingerprint}`);
  const id = `LINEMSG-${storageHash.slice(0, 32).toUpperCase()}`;
  await env.DB.prepare(`
    INSERT INTO tenant_crm_messages (
      id, tenant_slug, profile_id, thread_id, webhook_event_id, event_fingerprint,
      direction, event_type, message_type, content, metadata_json,
      reply_token_present, event_timestamp, redelivery, processed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    id, tenantSlug, profile.id, thread.id, webhookEventId, fingerprint,
    eventType(event), messageType(event), contentFor(event), JSON.stringify(metadataFor(event)),
    event?.replyToken ? 1 : 0, Number(event?.timestamp || 0), event?.deliveryContext?.isRedelivery ? 1 : 0,
  ).run();
  await env.DB.prepare(`
    UPDATE tenant_crm_threads
    SET unread_count = unread_count + 1,
        last_inbound_at = datetime('now'),
        last_message_at = datetime('now'),
        status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
        queue_status = CASE WHEN queue_status = 'closed' THEN 'open' ELSE queue_status END,
        closed_at = CASE WHEN queue_status = 'closed' THEN '' ELSE closed_at END,
        waiting_since = CASE WHEN ? <> '' THEN ? ELSE waiting_since END,
        sla_started_at = CASE WHEN ? <> '' THEN ? ELSE sla_started_at END,
        sla_due_at = CASE WHEN ? <> '' THEN ? ELSE sla_due_at END,
        sla_paused_at = CASE WHEN ? <> '' THEN ? ELSE sla_paused_at END,
        sla_remaining_seconds = CASE WHEN ? >= 0 THEN ? ELSE sla_remaining_seconds END,
        sla_status = CASE WHEN ? <> '' THEN ? ELSE sla_status END,
        updated_by = 'line-webhook', updated_at = datetime('now')
    WHERE tenant_slug = ? AND id = ?
  `).bind(
    slaStart?.waiting_since || '', slaStart?.waiting_since || '',
    slaStart?.sla_started_at || '', slaStart?.sla_started_at || '',
    slaStart?.sla_due_at || '', slaStart?.sla_due_at || '',
    slaStart?.sla_paused_at || '', slaStart?.sla_paused_at || '',
    slaStart ? Number(slaStart.sla_remaining_seconds || 0) : -1, slaStart ? Number(slaStart.sla_remaining_seconds || 0) : 0,
    slaStart?.sla_status || '', slaStart?.sla_status || '',
    tenantSlug, thread.id,
  ).run();
  if (slaStart) {
    await auditWebhookSla(env, tenantSlug, thread.id, 'tenant.line.sla.waiting_start', {
      waiting_since: thread.waiting_since || '',
      sla_due_at: thread.sla_due_at || '',
    }, slaStart);
  }
  if (thread.queue_status === 'closed' || thread.status === 'closed') {
    await auditWebhookSla(env, tenantSlug, thread.id, 'tenant.line.thread.reopen', {
      status: thread.status || '',
      queue_status: thread.queue_status || '',
      closed_at: thread.closed_at || '',
    }, { status: 'open', queue_status: 'open', closed_at: '' });
  }
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
  await emitLineReceipt({ env, sourcePath: 'tenant-v2', stage: 'RECEIVED', result: 'success' });
  const requestFingerprint = await sha256Hex(`${tenantSlug}:${rawBody}`);
  try {
    if (!env.DB) throw new Error('D1_REQUIRED');
    const { secrets } = await loadTenantLineSecrets(env, tenantSlug);
    const signature = text(request.headers.get('x-line-signature'), 500);
    if (!await verifyLineSignature(rawBody, signature, secrets.channel_secret)) {
      await emitLineReceipt({ env, sourcePath: 'tenant-v2', stage: 'FAILED', result: 'failed', safeErrorCode: 'SIGNATURE_INVALID' });
      throw new Error('LINE_WEBHOOK_SIGNATURE_INVALID');
    }
    const body = JSON.parse(rawBody || '{}');
    const events = Array.isArray(body.events) ? body.events : [];
    await emitLineReceipt({ env, eventKey: events[0]?.webhookEventId || '', tenantSlug, sourcePath: 'tenant-v2', stage: 'SIGNATURE_VERIFIED', result: 'success' });
    let inserted = 0;
    let duplicates = 0;
    let workspaceEligible = 0;
    let workspacePlanEvaluated = false;
    let workspacePlanOutcome = 'not_attempted';
    let membershipReplyEvaluated = false;
    let membershipReplyOutcome = 'not_attempted';
    let membershipReply = null;
    for (const event of events) {
      const result = await insertEvent(env, tenantSlug, event, secrets);
      if (result.inserted) {
        inserted += 1;
        const selected = selectEligibleWorkspaceWebhookEvent({ events: [event] });
        if (!membershipReplyEvaluated && selected.eligible && isMembershipQueryText(selected.event.text)) {
          membershipReplyEvaluated = true;
          if (!flagEnabled(env, 'TENANT_LINE_MEMBER_REPLY_ENABLED')) {
            membershipReplyOutcome = 'disabled';
          } else {
            const replyToken = typeof event?.replyToken === 'string' ? event.replyToken.trim() : '';
            if (!replyToken) {
              membershipReplyOutcome = 'skipped_no_reply_token';
            } else {
            try {
              const identity = await resolveWorkspaceWebhookIdentity({
                env, tenantSlug, verifiedUserUid: selected.event.verifiedUserUid,
              });
              membershipReply = { replyToken, text: membershipReplyText(identity) };
            } catch (_) {
              membershipReply = { replyToken, text: '會員資料目前無法查詢，請稍後再試。' };
            }
            }
          }
        }
        if (!workspacePlanEvaluated && selected.eligible) {
          workspaceEligible = 1;
          workspacePlanEvaluated = true;
          const appBaseUrl = typeof env?.WORKSPACE_APP_BASE_URL === 'string'
            ? env.WORKSPACE_APP_BASE_URL.trim()
            : '';
          if (!appBaseUrl) {
            workspacePlanOutcome = 'not_configured';
          } else {
            try {
              const routes = resolveWorkspaceWebhookRoutes({ appBaseUrl, tenantSlug });
              const plan = await planWorkspaceWebhookReply({
                env, tenantSlug, verifiedUserUid: selected.event.verifiedUserUid,
                text: selected.event.text, routes,
              });
              workspacePlanOutcome = safeWorkspacePlanOutcome(plan);
            } catch (_) {
              workspacePlanOutcome = 'configuration_error';
            }
          }
        }
      }
      if (result.duplicate) duplicates += 1;
    }
        await emitLineReceipt({ env, eventKey: events[0]?.webhookEventId || '', tenantSlug, sourcePath: 'tenant-v2', stage: 'LEGACY_STORED', result: duplicates > 0 && inserted === 0 ? 'duplicate' : 'success' });
    if (membershipReply) {
      membershipReplyOutcome = await sendTenantLineReply(
        secrets.channel_access_token, membershipReply.replyToken, membershipReply.text,
      ) ? 'sent' : 'failed';
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
    return json({
      success: true, tenant_slug: tenantSlug, events: events.length, inserted, duplicates,
      workspace_eligible: workspaceEligible,
      workspace_plan_outcome: workspacePlanOutcome,
      membership_reply_outcome: membershipReplyOutcome,
    });
  } catch (error) {
    const code = String(error?.message || error || 'LINE_WEBHOOK_PROCESSING_FAILED');
    if (env.DB) {
      try {
        await env.DB.prepare(`UPDATE tenant_line_channels SET last_error = ?, updated_at = datetime('now') WHERE tenant_slug = ?`)
          .bind(code, tenantSlug).run();
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
