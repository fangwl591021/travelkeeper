import legacyWorker from './worker.js';
import { isTenantApiRequest, routeTenantApi } from './lib/tenant-api.js';
import { isTenantBookingApiRequest, routeTenantBookingApi } from './lib/tenant-booking-api.js';
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
import {
  isPlatformSettlementApiRequest,
  routePlatformSettlementApi,
} from './lib/platform-settlement-api.js';
import {
  isPlatformSettlementCustomerViewRequest,
  routePlatformSettlementCustomerView,
} from './lib/platform-settlement-customer-view-api.js';
import {
  isSettlementFinanceApiRequest,
  routeSettlementFinanceApi,
} from './lib/settlement-finance-api.js';
import {
  isSettlementPaymentControlApiRequest,
  routeSettlementPaymentControlApi,
} from './lib/settlement-payment-control-api.js';
import {
  isTenantOrderActionRequest,
  routeTenantOrderAction,
} from './lib/tenant-order-actions-api.js';
import {
  isTenantProfileApiRequest,
  routeTenantProfileApi,
} from './lib/tenant-profile-api.js';
import {
  isTenantDistributorApiRequest,
  routeTenantDistributorApi,
} from './lib/tenant-distributor-api.js';
import {
  isTenantCrmApiRequest,
  routeTenantCrmApi,
} from './lib/tenant-crm-api.js';
import {
  isTenantLineChannelApiRequest,
  routeTenantLineChannelApi,
} from './lib/tenant-line-channel-api.js';
import {
  isTenantLineWebhookRequest,
  routeTenantLineWebhook,
} from './lib/tenant-line-webhook-api.js';
import {
  isLegacyCustomerCompatRequest,
  routeLegacyCustomerCompatApi,
} from './lib/legacy-customer-compat-api.js';
import { authenticateLineRequest } from './lib/line-auth.js';
import { requestedTenantSlug } from './lib/tenant-context.js';
import { statusForError } from './lib/http-error-status.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Slug, X-User-Uid, X-Line-Signature',
  'Access-Control-Max-Age': '86400',
};

function withTenantHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-TravelKeeper-Tenant-Isolation', 'phase12');
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
  if (path === '/api/v2/tenant/public') return true;
  if (/^\/api\/v2\/invites\/[^/]+$/.test(path)) return true;
  if (path === '/api/v2/itineraries' || /^\/api\/v2\/itineraries\/[^/]+$/.test(path)) {
    return String(url.searchParams.get('scope') || 'public').toLowerCase() === 'public';
  }
  return false;
}

async function authenticatedTenantRequest(request, env) {
  if (
    isPublicTenantRequest(request) ||
    isPublicTenantPaymentRequest(request) ||
    isPublicTenantGatewayRequest(request)
  ) return request;
  const tenantSlug = requestedTenantSlug(request);
  const auth = await authenticateLineRequest(request, env, { tenantSlug });
  const headers = new Headers(request.headers);
  headers.set('X-User-Uid', auth.userUid);
  headers.set('X-Tenant-Slug', tenantSlug);
  headers.set('X-Tenant-Auth-Mode', auth.authMode);
  return new Request(request, { headers });
}

function errorResponse(error) {
  const code = String(error?.message || error || 'AUTH_REQUIRED');
  return withTenantHeaders(new Response(JSON.stringify({ success: false, error: code }), {
    status: statusForError(code, 400),
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  }));
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (isTenantGatewayCallbackRequest(request)) {
      const callbackResponse = await routeTenantGatewayCallback(request, env);
      if (callbackResponse) return withTenantHeaders(callbackResponse);
    }

    // LINE webhooks are public server-to-server calls. The tenant comes only
    // from the URL and the raw request body is authenticated with that tenant's
    // encrypted Channel Secret before any event is accepted.
    if (isTenantLineWebhookRequest(request)) {
      const response = await routeTenantLineWebhook(request, env);
      if (response) return withTenantHeaders(response);
    }

    if (isLegacyCustomerCompatRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeLegacyCustomerCompatApi(securedRequest, env, legacyWorker));
      } catch (error) { return errorResponse(error); }
    }

    if (isSettlementFinanceApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeSettlementFinanceApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isSettlementPaymentControlApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeSettlementPaymentControlApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isPlatformSettlementCustomerViewRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routePlatformSettlementCustomerView(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isPlatformSettlementApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routePlatformSettlementApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantGatewayApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        const gatewayResponse = await routeTenantGatewayApi(securedRequest, env);
        if (gatewayResponse) return withTenantHeaders(gatewayResponse);
        if (isTenantPaymentApiRequest(request)) {
          return withTenantHeaders(await routeTenantPaymentApi(securedRequest, env));
        }
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantPaymentApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantPaymentApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantOrderActionRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantOrderAction(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantProfileApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantProfileApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantDistributorApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantDistributorApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantLineChannelApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantLineChannelApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantCrmApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantCrmApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantBookingApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantBookingApi(securedRequest, env, legacyWorker));
      } catch (error) { return errorResponse(error); }
    }

    if (isTenantApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantApi(securedRequest, env));
      } catch (error) { return errorResponse(error); }
    }

    return withTenantHeaders(await legacyWorker.fetch(request, env, ctx));
  },
};
