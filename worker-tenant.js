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
  isLegacyCustomerCompatRequest,
  routeLegacyCustomerCompatApi,
} from './lib/legacy-customer-compat-api.js';
import { authenticateLineRequest } from './lib/line-auth.js';
import { requestedTenantSlug } from './lib/tenant-context.js';
import { statusForError } from './lib/http-error-status.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Slug, X-User-Uid',
  'Access-Control-Max-Age': '86400',
};

function withTenantHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-TravelKeeper-Tenant-Isolation', 'phase10');
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
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Gateway callbacks are public server-to-server requests. Process these
    // before current policy checks so an in-flight payment remains durable
    // even if an admin disables or changes the collection mode afterwards.
    if (isTenantGatewayCallbackRequest(request)) {
      const callbackResponse = await routeTenantGatewayCallback(request, env);
      if (callbackResponse) return withTenantHeaders(callbackResponse);
    }

    // Non-demo legacy booking, customer, order and mother-export routes must
    // use tenant-scoped customer_id/contact_phone handling before worker.js.
    // Calls without an explicit non-demo tenant continue to the demo legacy flow.
    if (isLegacyCustomerCompatRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeLegacyCustomerCompatApi(securedRequest, env, legacyWorker));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isSettlementFinanceApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeSettlementFinanceApi(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    // Controls and the guarded paid transition must run before the legacy
    // platform-settlement router so enabled safeguards cannot be bypassed.
    if (isSettlementPaymentControlApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeSettlementPaymentControlApi(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    // The customer-safe payable view must run before the older settlement
    // router so internal relation keys never appear as contact phone numbers.
    if (isPlatformSettlementCustomerViewRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routePlatformSettlementCustomerView(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isPlatformSettlementApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routePlatformSettlementApi(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isTenantGatewayApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        const gatewayResponse = await routeTenantGatewayApi(securedRequest, env);
        if (gatewayResponse) return withTenantHeaders(gatewayResponse);
        if (isTenantPaymentApiRequest(request)) {
          return withTenantHeaders(await routeTenantPaymentApi(securedRequest, env));
        }
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isTenantPaymentApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantPaymentApi(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isTenantOrderActionRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantOrderAction(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isTenantProfileApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantProfileApi(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isTenantDistributorApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantDistributorApi(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isTenantBookingApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantBookingApi(securedRequest, env, legacyWorker));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (isTenantApiRequest(request)) {
      try {
        const securedRequest = await authenticatedTenantRequest(request, env);
        return withTenantHeaders(await routeTenantApi(securedRequest, env));
      } catch (error) {
        return errorResponse(error);
      }
    }

    return withTenantHeaders(await legacyWorker.fetch(request, env, ctx));
  },
};
