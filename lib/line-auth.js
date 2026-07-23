function bearerToken(request) {
  const value = String(request.headers.get('authorization') || '').trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requestUid(request, body = null) {
  const url = new URL(request.url);
  return String(
    request.headers.get('x-user-uid') ||
    body?.user_uid ||
    body?.userUid ||
    body?.uid ||
    body?.operatorUid ||
    url.searchParams.get('uid') ||
    url.searchParams.get('user_uid') ||
    ''
  ).trim();
}

function channelIdFromLiffId(value) {
  const liffId = String(value || '').trim();
  const match = liffId.match(/^(\d+)-/);
  return match ? match[1] : '';
}

async function expectedChannelId(env, tenantSlug) {
  if (env.LINE_LOGIN_CHANNEL_ID) return String(env.LINE_LOGIN_CHANNEL_ID).trim();
  if (!env.DB || !tenantSlug) return '';
  const row = await env.DB.prepare(
    `SELECT liff_id FROM tenants WHERE slug = ? LIMIT 1`
  ).bind(tenantSlug).first();
  return channelIdFromLiffId(row?.liff_id || '');
}

async function verifyAccessToken(accessToken, expectedClientId = '') {
  const verifyUrl = new URL('https://api.line.me/oauth2/v2.1/verify');
  verifyUrl.searchParams.set('access_token', accessToken);
  const response = await fetch(verifyUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.client_id) throw new Error('LINE_ACCESS_TOKEN_INVALID');
  if (expectedClientId && String(data.client_id) !== String(expectedClientId)) {
    throw new Error('LINE_ACCESS_TOKEN_CHANNEL_MISMATCH');
  }
  return data;
}

async function getLineProfile(accessToken) {
  const response = await fetch('https://api.line.me/v2/profile', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.userId) throw new Error('LINE_PROFILE_AUTH_FAILED');
  return data;
}

export async function authenticateLineRequest(request, env, {
  tenantSlug = '',
  body = null,
} = {}) {
  const accessToken = bearerToken(request);
  if (accessToken) {
    const clientId = await expectedChannelId(env, tenantSlug);
    const [verification, profile] = await Promise.all([
      verifyAccessToken(accessToken, clientId),
      getLineProfile(accessToken),
    ]);
    return {
      authMode: 'line_access_token',
      userUid: String(profile.userId),
      displayName: profile.displayName || '',
      pictureUrl: profile.pictureUrl || '',
      clientId: String(verification.client_id || ''),
      scope: String(verification.scope || ''),
      expiresIn: Number(verification.expires_in || 0),
    };
  }

  if (String(env.ALLOW_LEGACY_UID_AUTH || '') === '1') {
    const uid = requestUid(request, body);
    if (!uid) throw new Error('AUTH_REQUIRED');
    return {
      authMode: 'legacy_uid',
      userUid: uid,
      displayName: '',
      pictureUrl: '',
      clientId: '',
      scope: '',
      expiresIn: 0,
    };
  }

  throw new Error('AUTH_REQUIRED');
}
