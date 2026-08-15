const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeJson(value) {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
}

function safe(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

async function importKey(secret, usages) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

export function partnerInviteSecret(env) {
  return String(env?.PARTNER_INVITE_SIGNING_SECRET || env?.REFERRAL_SIGNING_SECRET || '').trim();
}

export async function signPartnerInviteToken(secret, claims = {}, now = Date.now()) {
  const tenantSlug = safe(claims.tenant_slug, 80);
  const refUid = safe(claims.ref_uid, 120);
  if (!secret || !tenantSlug || !refUid) throw new Error('PARTNER_INVITE_SIGNING_NOT_CONFIGURED');

  const issuedAt = Math.floor(now / 1000);
  const ttl = Math.max(300, Math.min(60 * 60 * 24 * 30, Number(claims.ttl_seconds || 60 * 60 * 24 * 30)));
  const payload = {
    v: 1,
    purpose: 'partner_invite',
    tenant_slug: tenantSlug,
    ref_uid: refUid,
    invite_code: safe(claims.invite_code, 80).toUpperCase(),
    iat: issuedAt,
    exp: issuedAt + ttl,
    jti: safe(claims.jti || crypto.randomUUID(), 80),
  };
  const encoded = encodeJson(payload);
  const key = await importKey(secret, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(encoded)));
  return `${encoded}.${base64UrlEncode(signature)}`;
}

export async function verifyPartnerInviteToken(secret, token, expected = {}, now = Date.now()) {
  try {
    if (!secret) return { ok: false, error: 'PARTNER_INVITE_SIGNING_NOT_CONFIGURED' };
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'INVALID_PARTNER_INVITE_TOKEN' };
    const key = await importKey(secret, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(parts[1]), encoder.encode(parts[0]));
    if (!valid) return { ok: false, error: 'INVALID_PARTNER_INVITE_TOKEN' };

    const payload = decodeJson(parts[0]);
    const nowSeconds = Math.floor(now / 1000);
    if (payload.v !== 1 || payload.purpose !== 'partner_invite' ||
        !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
        payload.exp <= nowSeconds || payload.iat > nowSeconds + 60) {
      return { ok: false, error: 'EXPIRED_PARTNER_INVITE_TOKEN' };
    }

    for (const [keyName, expectedValue] of Object.entries(expected)) {
      if (expectedValue !== undefined && expectedValue !== null && String(payload[keyName] || '') !== String(expectedValue)) {
        return { ok: false, error: 'PARTNER_INVITE_CONTEXT_MISMATCH' };
      }
    }
    if (!safe(payload.tenant_slug, 80) || !safe(payload.ref_uid, 120)) {
      return { ok: false, error: 'INVALID_PARTNER_INVITE_TOKEN' };
    }
    return { ok: true, claims: payload };
  } catch (_) {
    return { ok: false, error: 'INVALID_PARTNER_INVITE_TOKEN' };
  }
}
