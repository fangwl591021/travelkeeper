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

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(value));
}

function safeClaim(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

export function referralTokenSecret(env) {
  return String(env?.REFERRAL_SIGNING_SECRET || '').trim();
}

export async function signReferralToken(secret, claims, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    v: 1,
    tenant_slug: safeClaim(claims.tenant_slug, 80),
    itinerary_id: safeClaim(claims.itinerary_id, 120),
    distributor_uid: safeClaim(claims.distributor_uid, 120),
    invite_code: safeClaim(claims.invite_code, 80).toUpperCase(),
    iat: issuedAt,
    exp: issuedAt + Math.max(300, Math.min(60 * 60 * 24 * 30, Number(claims.ttl_seconds || 60 * 60 * 24 * 7))),
    jti: safeClaim(claims.jti || crypto.randomUUID(), 80),
  };
  if (!secret || !payload.tenant_slug || !payload.itinerary_id || !payload.distributor_uid) {
    throw new Error('REFERRAL_SIGNING_NOT_CONFIGURED');
  }
  const encoded = encodeJson(payload);
  const signature = base64UrlEncode(new Uint8Array(await hmac(secret, encoded)));
  return `${encoded}.${signature}`;
}

export async function verifyReferralToken(secret, token, expected = {}, now = Date.now()) {
  try {
    if (!secret) return { ok: false, error: 'REFERRAL_SIGNING_NOT_CONFIGURED' };
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'INVALID_REFERRAL_TOKEN' };
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(parts[1]), encoder.encode(parts[0]));
    if (!valid) return { ok: false, error: 'INVALID_REFERRAL_TOKEN' };
    const payload = decodeJson(parts[0]);
    const nowSeconds = Math.floor(now / 1000);
    if (payload.v !== 1 || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= nowSeconds || payload.iat > nowSeconds + 60) {
      return { ok: false, error: 'EXPIRED_REFERRAL_TOKEN' };
    }
    for (const [keyName, expectedValue] of Object.entries(expected)) {
      if (expectedValue !== undefined && expectedValue !== null && String(payload[keyName] || '') !== String(expectedValue)) {
        return { ok: false, error: 'REFERRAL_TOKEN_CONTEXT_MISMATCH' };
      }
    }
    return { ok: true, claims: payload };
  } catch {
    return { ok: false, error: 'INVALID_REFERRAL_TOKEN' };
  }
}