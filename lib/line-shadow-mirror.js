import { insertEvent } from './tenant-line-webhook-api.js';

export const SHADOW_TENANT_SLUG = 'staging-line-shadow';
export const SHADOW_PATH = `/api/v2/internal/line-shadow/${SHADOW_TENANT_SLUG}`;
export const SHADOW_URL = `https://travelkeeper-staging.fangwl591021.workers.dev${SHADOW_PATH}`;
const SHADOW_MAX_AGE_SECONDS = 300;
const SHADOW_EVENT_LIMIT = 20;
const SHADOW_EVENT_TYPES = new Set(['follow', 'message', 'postback']);
const SHADOW_MESSAGE_TYPES = new Set(['text', 'sticker', 'image', 'location', 'file', 'video']);

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function parseUidAllowlist(value) {
  const values = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!values.length || values.some(item => item === '*' || item.includes('*') || item.length > 120)) return [];
  return [...new Set(values)];
}

export function shadowConfig(env = {}) {
  const url = String(env.LINE_STAGING_SHADOW_URL || '').trim();
  const uids = parseUidAllowlist(env.LINE_STAGING_SHADOW_UIDS);
  const secret = String(env.LINE_STAGING_SHADOW_SIGNING_SECRET || '');
  const enabled = String(env.LINE_STAGING_SHADOW_ENABLED || '').trim() === '1';
  return {
    enabled,
    url,
    uids,
    ready: enabled && url === SHADOW_URL && uids.length > 0 && secret.length >= 32,
  };
}

export function isShadowUidAllowed(uid, env = {}) {
  const values = parseUidAllowlist(env.LINE_STAGING_SHADOW_UIDS);
  return values.includes(String(uid || ''));
}

export function safeShadowEvent(event = {}) {
  const source = event.source || {};
  const message = event.message || {};
  const type = text(event.type, 40);
  if (!SHADOW_EVENT_TYPES.has(type)) return null;
  const userId = text(source.userId, 120);
  if (!userId) return null;
  const safe = {
    type,
    webhookEventId: text(event.webhookEventId, 160),
    timestamp: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : 0,
    source: {
      type: text(source.type, 40),
      userId,
      groupId: text(source.groupId, 120),
      roomId: text(source.roomId, 120),
    },
  };
  if (type === 'message') {
    const messageType = text(message.type, 40);
    if (!SHADOW_MESSAGE_TYPES.has(messageType)) return null;
    safe.message = { type: messageType, id: text(message.id, 160) };
    if (messageType === 'text') safe.message.text = text(message.text, 5000);
    if (messageType === 'sticker') {
      safe.message.packageId = text(message.packageId, 120);
      safe.message.stickerId = text(message.stickerId, 120);
    }
    if (messageType === 'location') {
      safe.message.title = text(message.title, 500);
      safe.message.address = text(message.address, 1000);
      safe.message.latitude = Number(message.latitude || 0);
      safe.message.longitude = Number(message.longitude || 0);
    }
    if (messageType === 'file') {
      safe.message.fileName = text(message.fileName, 500);
      safe.message.fileSize = Number(message.fileSize || 0);
    }
    if (messageType === 'video') safe.message.duration = Number(message.duration || 0);
  }
  if (type === 'postback') {
    safe.postback = { data: text(event.postback?.data, 5000), params: text(event.postback?.params, 1000) };
  }
  return safe;
}

export function createShadowEnvelope(event, now = new Date()) {
  const safeEvent = safeShadowEvent(event);
  if (!safeEvent) return null;
  return {
    source_environment: 'production',
    target_environment: 'staging',
    tenant_slug: SHADOW_TENANT_SLUG,
    mirrored_at: new Date(now).toISOString(),
    event: safeEvent,
  };
}

async function hmacHex(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

export async function signShadowPayload(rawBody, timestamp, secret) {
  if (!secret || String(secret).length < 32) return '';
  return `sha256=${await hmacHex(`${timestamp}.${rawBody}`, secret)}`;
}

export async function verifyShadowPayload(rawBody, timestamp, signature, secret, now = Date.now()) {
  const parsedTimestamp = Number(timestamp);
  if (!Number.isInteger(parsedTimestamp)) return false;
  if (Math.abs(Math.floor(Number(now) / 1000) - parsedTimestamp) > SHADOW_MAX_AGE_SECONDS) return false;
  const expected = await signShadowPayload(rawBody, parsedTimestamp, secret);
  const actual = String(signature || '').trim();
  return Boolean(expected) && constantTimeEqual(expected, actual);
}

export async function buildShadowRequest(event, env, now = new Date()) {
  const config = shadowConfig(env);
  const envelope = createShadowEnvelope(event, now);
  if (!config.ready || !envelope) return null;
  const rawBody = JSON.stringify(envelope);
  const timestamp = Math.floor(new Date(now).getTime() / 1000);
  const signature = await signShadowPayload(rawBody, timestamp, env.LINE_STAGING_SHADOW_SIGNING_SECRET);
  return new Request(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TravelKeeper-Shadow-Timestamp': String(timestamp),
      'X-TravelKeeper-Shadow-Signature': signature,
    },
    body: rawBody,
  });
}

function isShadowPath(request) {
  return new URL(request.url).pathname.replace(/\/+$/, '') === SHADOW_PATH;
}

export function isLineShadowEndpointRequest(request) {
  return request.method === 'POST' && isShadowPath(request);
}

function envelopeEvent(body) {
  if (!body || body.source_environment !== 'production' || body.target_environment !== 'staging') return null;
  if (body.tenant_slug !== SHADOW_TENANT_SLUG || !body.event || body.event.replyToken) return null;
  return safeShadowEvent(body.event);
}

export async function routeLineShadowEndpoint(request, env, now = Date.now()) {
  if (!isShadowPath(request)) return null;
  if (request.method !== 'POST') return json({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  if (String(env?.APP_ENV || '').toLowerCase() !== 'staging') return json({ success: false, error: 'SHADOW_ENDPOINT_DISABLED' }, 404);
  const config = shadowConfig(env);
  if (!config.ready) return json({ success: false, error: 'SHADOW_MIRROR_DISABLED' }, 404);
  const rawBody = await request.text();
  const validSignature = await verifyShadowPayload(
    rawBody,
    request.headers.get('X-TravelKeeper-Shadow-Timestamp'),
    request.headers.get('X-TravelKeeper-Shadow-Signature'),
    env.LINE_STAGING_SHADOW_SIGNING_SECRET,
    now,
  );
  if (!validSignature) return json({ success: false, error: 'SHADOW_SIGNATURE_INVALID' }, 401);
  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (_) { return json({ success: false, error: 'SHADOW_PAYLOAD_INVALID' }, 400); }
  const event = envelopeEvent(body);
  if (!event) return json({ success: false, error: 'SHADOW_PAYLOAD_INVALID' }, 400);
  if (!isShadowUidAllowed(event.source?.userId, env)) return json({ success: false, error: 'SHADOW_UID_NOT_ALLOWED' }, 403);
  const result = await insertEvent(env, SHADOW_TENANT_SLUG, event, { channel_access_token: '' });
  if (result.duplicate) return json({ success: false, error: 'SHADOW_REPLAY', tenant_slug: SHADOW_TENANT_SLUG, inserted: 0, duplicates: 1 }, 409);
  return json({ success: true, tenant_slug: SHADOW_TENANT_SLUG, inserted: result.inserted ? 1 : 0, duplicates: 0 });
}

export async function mirrorVerifiedWebhookRequest(request, env, fetchImpl = fetch, now = Date.now()) {
  const config = shadowConfig(env);
  if (!config.ready) return { mirrored: 0, skipped: 'disabled' };
  const body = JSON.parse(await request.text() || '{}');
  const events = Array.isArray(body.events) ? body.events.slice(0, SHADOW_EVENT_LIMIT) : [];
  let mirrored = 0;
  let failed = 0;
  for (const event of events) {
    if (!isShadowUidAllowed(event?.source?.userId, env)) continue;
    const outgoing = await buildShadowRequest(event, env, new Date(now));
    if (!outgoing) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetchImpl(outgoing.url, {
        method: 'POST',
        headers: outgoing.headers,
        body: await outgoing.text(),
        signal: controller.signal,
      });
      if (response.ok) mirrored += 1;
      else failed += 1;
    } catch (_) {
      failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }
  return { mirrored, failed };
}