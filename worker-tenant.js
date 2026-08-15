import legacyWorker from './worker.js';
import { isTenantApiRequest, routeTenantApi } from './lib/tenant-api.js';
import { isTenantBookingApiRequest, routeTenantBookingApi } from './lib/tenant-booking-api.js';
import { isTenantAttributionApiRequest, routeTenantAttributionApi } from './lib/tenant-attribution-api.js';
import { isTenantAttributionIntegrityRequest, routeTenantAttributionIntegrity } from './lib/tenant-attribution-integrity-api.js';
import {
  isTenantPaymentApiRequest,
  isPublicTenantPaymentRequest,
  routeTenantPaymentApi,
} from './lib/tenant-payment-api.js';
import {
  isTenantGatewayApiRequest,
  isPublicTenantGatewayRequest,
  routeTenantGatewayApi,
} from './lib/tenant-gateway-api.js';
import {
  isTenantGatewayCallbackRequest,
  routeTenantGatewayCallback,
} from './lib/tenant-gateway-callback-api.js';
import { isPlatformSettlementApiRequest, routePlatformSettlementApi } from './lib/platform-settlement-api.js';
import { isPlatformSettlementCustomerViewRequest, routePlatformSettlementCustomerView } from './lib/platform-settlement-customer-view-api.js';
import { isSettlementFinanceApiRequest, routeSettlementFinanceApi } from './lib/settlement-finance-api.js';
import { isSettlementPaymentControlApiRequest, routeSettlementPaymentControlApi } from './lib/settlement-payment-control-api.js';
import { isTenantOrderActionRequest, routeTenantOrderAction } from './lib/tenant-order-actions-api.js';
import { isTenantProfileApiRequest, routeTenantProfileApi } from './lib/tenant-profile-api.js';
import { isTenantDistributorApiRequest, routeTenantDistributorApi } from './lib/tenant-distributor-api.js';
import { isTenantCrmApiRequest, routeTenantCrmApi } from './lib/tenant-crm-api.js';
import { isTenantLineChannelApiRequest, routeTenantLineChannelApi } from './lib/tenant-line-channel-api.js';
import { isTenantLineWebhookRequest, routeTenantLineWebhook } from './lib/tenant-line-webhook-api.js';
import { isTenantLineMonitorApiRequest, routeTenantLineMonitorApi } from './lib/tenant-line-monitor-api.js';
import { isLegacyCustomerCompatRequest, routeLegacyCustomerCompatApi } from './lib/legacy-customer-compat-api.js';
import { authenticateLineRequest } from './lib/line-auth.js';
import { requestedTenantSlug } from './lib/tenant-context.js';
import { statusForError } from './lib/http-error-status.js';
import { isLineShadowEndpointRequest, mirrorVerifiedWebhookRequest, routeLineShadowEndpoint } from './lib/line-shadow-mirror.js';
import { emitLineReceipt, emitShadowReceipt } from './lib/tenant-line-receipt.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Slug, X-User-Uid, X-Line-Signature',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(request, env) {
  const headers = { ...CORS };
  if (String(env?.APP_ENV || '').toLowerCase() === 'staging') {
    const allowed = String(env?.STAGING_ALLOWED_ORIGIN || '').trim();
    const requestOrigin = String(request?.headers?.get('Origin') || '').trim();
    headers['Access-Control-Allow-Origin'] = allowed && !allowed.includes('<') && requestOrigin === allowed ? allowed : 'null';
  }
  return headers;
}

function withTenantHeaders(response, request = null, env = null) {
  const headers = new Headers(response.headers);
  headers.set('X-TravelKeeper-Tenant-Isolation', 'phase13');
  if (String(env?.APP_ENV || '').toLowerCase() === 'staging') headers.set('X-TravelKeeper-Environment', 'staging');
  Object.entries(corsHeaders(request, env)).forEach(([key, value]) => { if (!headers.has(key)) headers.set(key, value); });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isPublicTenantRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/api/v2/tenant/public') return true;
  if (/^\/api\/v2\/invites\/[^/]+$/.test(path)) return true;
  if (path === '/api/v2/itineraries' || /^\/api\/v2\/itineraries\/[^/]+$/.test(path)) {
    return String(url.searchParams.get('scope') || 'public').toLowerCase() === 'public';
  }
  return false;
}

async function authenticatedTenantRequest(request, env) {
  if (isPublicTenantRequest(request) || isPublicTenantPaymentRequest(request) || isPublicTenantGatewayRequest(request)) return request;
  const tenantSlug = requestedTenantSlug(request);
  const auth = await authenticateLineRequest(request, env, { tenantSlug });
  const headers = new Headers(request.headers);
  headers.set('X-User-Uid', auth.userUid);
  headers.set('X-Tenant-Slug', tenantSlug);
  headers.set('X-Tenant-Auth-Mode', auth.authMode);
  return new Request(request, { headers });
}

function errorResponse(error, request = null, env = null) {
  const code = String(error?.message || error || 'AUTH_REQUIRED');
  return withTenantHeaders(new Response(JSON.stringify({ success: false, error: code }), {
    status: statusForError(code, 400),
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  }), request, env);
}

function requireBearerAuthorization(request) {
  const value = String(request.headers.get('authorization') || '').trim();
  if (!/^Bearer\s+\S+$/i.test(value)) throw new Error('AUTH_REQUIRED');
}

async function securedRoute(request, env, router) {
  try {
    const securedRequest = await authenticatedTenantRequest(request, env);
    return withTenantHeaders(await router(securedRequest, env), request, env);
  } catch (error) {
    return errorResponse(error, request, env);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    if (isTenantGatewayCallbackRequest(request)) {
      const response = await routeTenantGatewayCallback(request, env);
      if (response) return withTenantHeaders(response, request, env);
    }
    if (isLineShadowEndpointRequest(request)) {
      const response = await routeLineShadowEndpoint(request, env);
      if (response) return withTenantHeaders(response, request, env);
    }
    if (isTenantLineWebhookRequest(request)) {
      const mirrorRequest = request.clone();
      const response = await routeTenantLineWebhook(request, env);
      if (response?.ok && typeof ctx?.waitUntil === 'function') {
        const startedAt = Date.now();
        ctx.waitUntil(mirrorVerifiedWebhookRequest(mirrorRequest, env)
          .then((result) => emitShadowReceipt({ env, sourcePath: 'shadow', result, durationMs: Date.now() - startedAt }))
          .catch(() => emitLineReceipt({ env, sourcePath: 'shadow', stage: 'SHADOW_DISPATCHED', result: 'failed', safeErrorCode: 'SHADOW_DISPATCH_FAILED', durationMs: Date.now() - startedAt })));
      }
      if (response) return withTenantHeaders(response, request, env);
    }

    try {
      if (isLegacyCustomerCompatRequest(request)) {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeLegacyCustomerCompatApi(securedRequest, env, legacyWorker), request, env);
      }
      if (isSettlementFinanceApiRequest(request)) return securedRoute(request, env, routeSettlementFinanceApi);
      if (isSettlementPaymentControlApiRequest(request)) return securedRoute(request, env, routeSettlementPaymentControlApi);
      if (isPlatformSettlementCustomerViewRequest(request)) return securedRoute(request, env, routePlatformSettlementCustomerView);
      if (isPlatformSettlementApiRequest(request)) return securedRoute(request, env, routePlatformSettlementApi);
      if (isTenantGatewayApiRequest(request)) {
        const securedRequest = await authenticatedTenantRequest(request, env);
        const response = await routeTenantGatewayApi(securedRequest, env);
        if (response) return withTenantHeaders(response, request, env);
        if (isTenantPaymentApiRequest(request)) return withTenantHeaders(await routeTenantPaymentApi(securedRequest, env), request, env);
      }
      if (isTenantPaymentApiRequest(request)) return securedRoute(request, env, routeTenantPaymentApi);
      if (isTenantOrderActionRequest(request)) return securedRoute(request, env, routeTenantOrderAction);
      if (isTenantProfileApiRequest(request)) return securedRoute(request, env, routeTenantProfileApi);
      if (isTenantDistributorApiRequest(request)) return securedRoute(request, env, routeTenantDistributorApi);
      if (isTenantLineChannelApiRequest(request)) return securedRoute(request, env, routeTenantLineChannelApi);
      if (isTenantLineMonitorApiRequest(request)) {
        try {
          requireBearerAuthorization(request);
        } catch (error) {
          return errorResponse(error, request, env);
        }
        return securedRoute(request, env, routeTenantLineMonitorApi);
      }
      if (isTenantCrmApiRequest(request)) return securedRoute(request, env, routeTenantCrmApi);
      if (isTenantAttributionIntegrityRequest(request)) return securedRoute(request, env, routeTenantAttributionIntegrity);
      if (isTenantAttributionApiRequest(request)) return securedRoute(request, env, routeTenantAttributionApi);
      if (isTenantBookingApiRequest(request)) {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantBookingApi(securedRequest, env, legacyWorker), request, env);
      }
      if (isTenantApiRequest(request)) return securedRoute(request, env, routeTenantApi);
    } catch (error) { return errorResponse(error, request, env); }

    return withTenantHeaders(await legacyWorker.fetch(request, env, ctx), request, env);
  },
};
