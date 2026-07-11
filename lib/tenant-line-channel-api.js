import { requestedTenantSlug, requireTenantContext } from './tenant-context.js';
import { encryptTenantGatewaySecrets, decryptTenantGatewaySecrets } from './tenant-gateway-api.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function requestUid(request) {
  return text(request.headers.get('x-user-uid'), 100);
}

function masked(last4) {
  const suffix = text(last4, 8);
  return suffix ? `••••${suffix}` : '';
}

function publicView(row) {
  if (!row) return { configured: false, enabled: false };
  return {
    configured: !!row.secrets_ciphertext,
    tenant_slug: row.tenant_slug,
    channel_id: row.channel_id || '',
    bot_basic_id: row.bot_basic_id || '',
    bot_display_name: row.bot_display_name || '',
    enabled: !!Number(row.enabled || 0),
    has_channel_secret: !!row.channel_secret_last4,
    has_access_token: !!row.access_token_last4,
    channel_secret_masked: masked(row.channel_secret_last4),
    access_token_masked: masked(row.access_token_last4),
    key_version: row.key_version || 'v1',
    verified_at: row.verified_at || '',
    verified_by: row.verified_by || '',
    last_webhook_at: row.last_webhook_at || '',
    last_error: row.last_error || '',
    updated_at: row.updated_at || '',
  };
}

async function context(request, env, write = false) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request),
    userUid: requestUid(request),
    allowedRoles: write ? ['platform_admin', 'tenant_admin'] : ['platform_admin', 'tenant_admin'],
  });
}

async function getRow(env, tenantSlug) {
  return env.DB.prepare(`SELECT * FROM tenant_line_channels WHERE tenant_slug = ? LIMIT 1`)
    .bind(tenantSlug).first();
}

async function getConfig(request, env) {
  const ctx = await context(request, env, false);
  return json({ success: true, data: publicView(await getRow(env, ctx.tenantSlug)) });
}

async function saveConfig(request, env) {
  const ctx = await context(request, env, true);
  const body = await request.json().catch(() => ({}));
  const existing = await getRow(env, ctx.tenantSlug);
  const channelSecret = text(body.channel_secret ?? body.channelSecret, 500);
  const accessToken = text(body.channel_access_token ?? body.channelAccessToken ?? body.access_token, 4000);
  let encrypted = null;
  if (channelSecret || accessToken) {
    let old = {};
    if (existing?.secrets_ciphertext) {
      old = await decryptTenantGatewaySecrets(env, ctx.tenantSlug, 'line', {
        secrets_ciphertext: existing.secrets_ciphertext,
        secrets_iv: existing.secrets_iv,
        key_version: existing.key_version,
      });
    }
    const secrets = {
      channel_secret: channelSecret || old.channel_secret || '',
      channel_access_token: accessToken || old.channel_access_token || '',
    };
    if (!secrets.channel_secret || !secrets.channel_access_token) throw new Error('TENANT_LINE_CHANNEL_SECRET_REQUIRED');
    encrypted = await encryptTenantGatewaySecrets(env, ctx.tenantSlug, 'line', secrets);
  } else if (!existing?.secrets_ciphertext) {
    throw new Error('TENANT_LINE_CHANNEL_SECRET_REQUIRED');
  }

  const now = new Date().toISOString();
  const values = {
    channelId: text(body.channel_id ?? body.channelId ?? existing?.channel_id, 100),
    botBasicId: text(body.bot_basic_id ?? body.botBasicId ?? existing?.bot_basic_id, 100),
    botDisplayName: text(body.bot_display_name ?? body.botDisplayName ?? existing?.bot_display_name, 200),
    enabled: body.enabled === true || body.enabled === 1 || body.enabled === '1' ? 1 : 0,
    ciphertext: encrypted?.ciphertext || existing?.secrets_ciphertext || '',
    iv: encrypted?.iv || existing?.secrets_iv || '',
    keyVersion: encrypted?.keyVersion || existing?.key_version || 'v1',
    secretLast4: channelSecret ? channelSecret.slice(-4) : existing?.channel_secret_last4 || '',
    tokenLast4: accessToken ? accessToken.slice(-4) : existing?.access_token_last4 || '',
  };
  if (!values.channelId) throw new Error('TENANT_LINE_CHANNEL_ID_REQUIRED');

  await env.DB.prepare(`
    INSERT INTO tenant_line_channels (
      tenant_slug, channel_id, bot_basic_id, bot_display_name, enabled,
      secrets_ciphertext, secrets_iv, key_version, channel_secret_last4, access_token_last4,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_slug) DO UPDATE SET
      channel_id = excluded.channel_id,
      bot_basic_id = excluded.bot_basic_id,
      bot_display_name = excluded.bot_display_name,
      enabled = excluded.enabled,
      secrets_ciphertext = excluded.secrets_ciphertext,
      secrets_iv = excluded.secrets_iv,
      key_version = excluded.key_version,
      channel_secret_last4 = excluded.channel_secret_last4,
      access_token_last4 = excluded.access_token_last4,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).bind(
    ctx.tenantSlug, values.channelId, values.botBasicId, values.botDisplayName, values.enabled,
    values.ciphertext, values.iv, values.keyVersion, values.secretLast4, values.tokenLast4,
    ctx.userUid, ctx.userUid, existing?.created_at || now, now,
  ).run();

  return json({ success: true, data: publicView(await getRow(env, ctx.tenantSlug)) });
}

export async function loadTenantLineSecrets(env, tenantSlug, { allowDisabled = false } = {}) {
  const row = await getRow(env, tenantSlug);
  if (!row?.secrets_ciphertext) throw new Error('TENANT_LINE_CHANNEL_NOT_CONFIGURED');
  if (!allowDisabled && !Number(row.enabled || 0)) throw new Error('TENANT_LINE_CHANNEL_DISABLED');
  const secrets = await decryptTenantGatewaySecrets(env, tenantSlug, 'line', {
    secrets_ciphertext: row.secrets_ciphertext,
    secrets_iv: row.secrets_iv,
    key_version: row.key_version,
  });
  return { row, secrets };
}

export function isTenantLineChannelApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/v2/line/channel';
}

export async function routeTenantLineChannelApi(request, env) {
  try {
    if (!env.DB) throw new Error('D1_REQUIRED');
    if (request.method === 'GET') return getConfig(request, env);
    if (request.method === 'POST') return saveConfig(request, env);
    return json({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  } catch (error) {
    const code = String(error?.message || error || 'INVALID_LINE_CHANNEL_CONFIG');
    const status = code.includes('DENIED') || code.includes('REQUIRED') && code.includes('ADMIN') ? 403
      : code.includes('NOT_FOUND') ? 404
      : code.includes('DISABLED') ? 409
      : code.startsWith('TENANT_PAYMENT_') || code === 'D1_REQUIRED' ? 503
      : 400;
    return json({ success: false, error: code }, status);
  }
}
