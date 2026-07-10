import legacyWorker from './worker.js';
import { isTenantApiRequest, routeTenantApi } from './lib/tenant-api.js';
import { authenticateLineRequest } from './lib/line-auth.js';
import { requestedTenantSlug } from './lib/tenant-context.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Slug, X-User-Uid',
  'Access-Control-Max-Age': '86400',
};

function withTenantHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-TravelKeeper-Tenant-Isolation', 'phase1');
  Object.entries(CORS).forEach(([key, value]) => {
    if (!headers.has(key)) headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isPublicTenantRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/api/v2/itineraries' || /^\/api\/v2\/itineraries\/[^/]+$/.test(path)) {
    return String(url.searchParams.get('scope') || 'public').toLowerCase() === 'public';
  }
  return false;
}

async function authenticatedTenantRequest(request, env) {
  if (isPublicTenantRequest(request)) return request;
  const tenantSlug = requestedTenantSlug(request);
  const auth = await authenticateLineRequest(request, env, { tenantSlug });
  const headers = new Headers(request.headers);
  headers.set('X-User-Uid', auth.userUid);
  headers.set('X-Tenant-Slug', tenantSlug);
  headers.set('X-Tenant-Auth-Mode', auth.authMode);
  return new Request(request, { headers });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (isTenantApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantApi(securedRequest, env));
      } catch (error) {
        const code = String(error?.message || error || 'AUTH_REQUIRED');
        const status = code === 'LINE_ACCESS_TOKEN_CHANNEL_MISMATCH' ? 403 : 401;
        return withTenantHeaders(new Response(JSON.stringify({ success: false, error: code }), {
          status,
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
        }));
      }
    }

    return withTenantHeaders(await legacyWorker.fetch(request, env, ctx));
  },
};
