(function (global) {
  'use strict';

  const DEFAULT_WORKER_URL = 'https://travelkeeper-worker.fangwl591021.workers.dev';
  const DEFAULT_TENANT = 'demo';

  function normalizeTenantSlug(value, fallback = DEFAULT_TENANT) {
    const slug = String(value || '').trim().toLowerCase();
    if (!slug) return fallback;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
      throw new Error('INVALID_TENANT_SLUG');
    }
    return slug;
  }

  function resolveTenantSlug(search = global.location?.search || '') {
    const params = new URLSearchParams(search);
    return normalizeTenantSlug(
      params.get('tenant') ||
      params.get('tenant_slug') ||
      params.get('a') ||
      DEFAULT_TENANT
    );
  }

  function getLiffAccessToken() {
    if (!global.liff || typeof global.liff.getAccessToken !== 'function') return '';
    return String(global.liff.getAccessToken() || '').trim();
  }

  async function parseResponse(response) {
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_) {
      payload = { success: false, error: text || `HTTP_${response.status}` };
    }

    if (!response.ok || payload?.success === false) {
      const code = String(payload?.error || `HTTP_${response.status}`);
      const error = new Error(code);
      error.code = code;
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function friendlyError(error) {
    const payloadMessage = String(error?.payload?.message || '').trim();
    if (payloadMessage) return payloadMessage;

    const code = String(error?.code || error?.message || 'UNKNOWN_ERROR');
    const map = {
      AUTH_REQUIRED: 'LINE 登入已失效，請重新登入。',
      LINE_ACCESS_TOKEN_INVALID: 'LINE 登入憑證無效，請重新登入。',
      LINE_PROFILE_AUTH_FAILED: '無法取得 LINE 身分，請重新登入。',
      LINE_ACCESS_TOKEN_CHANNEL_MISMATCH: '目前 LINE Login Channel 不屬於此業者。',
      TENANT_ACCESS_DENIED: '此帳號沒有該業者平台的使用權限。',
      TENANT_ROLE_DENIED: '目前角色沒有執行此操作的權限。',
      TENANT_PERMISSION_DENIED: '目前帳號缺少所需權限。',
      TENANT_NOT_FOUND: '找不到指定的業者平台。',
      ITINERARY_NOT_FOUND: '找不到此行程，可能已下架。',
      INVITE_CODE_NOT_FOUND: '找不到此推薦碼，請重新取得業務分享連結。',
      DISTRIBUTOR_NOT_FOUND: '找不到此業務人員或該帳號已停用。',
      INVALID_TENANT_SLUG: '業者識別碼格式錯誤。',
      INVALID_BOOKING_PAYLOAD: '預約資料不完整，請確認姓名、電話與行程。',
      CUSTOMER_PHONE_TENANT_CONFLICT: '此電話已存在於另一個業者空間，暫時無法建立預約，請聯絡客服協助。',
      ORDER_NOT_FOUND: '找不到此訂單。',
      ORDER_CUSTOMER_MISMATCH: '此訂單不屬於目前登入的 LINE 帳號。',
      PAYMENT_AMOUNT_INVALID: '付款金額不正確，請聯絡業務人員。',
      PAYMENT_AMOUNT_MISMATCH: '金流回傳金額與訂單不符，請聯絡平台管理員。',
      PAYMENT_ALREADY_COMPLETED: '此筆款項已完成付款。',
      TENANT_PAYMENT_CONFIGURATION_REQUIRED: '此業者目前採人工收款或金流尚未完成設定，訂單已建立，客服將協助確認付款方式。',
      PLATFORM_PAYMENT_DISABLED: '平台代收目前未啟用，訂單已建立，客服將協助確認付款方式。',
      PLATFORM_PAYMENT_SECRET_MISSING: '平台代收參數尚未完成，訂單已建立，客服將協助確認付款方式。',
      PLATFORM_PAYMENT_SECRET_LENGTH_INVALID: '平台代收參數格式錯誤，訂單已建立，客服將協助確認付款方式。',
      PLATFORM_COLLECTION_APPROVAL_REQUIRED: '平台代收必須由平台總管理員核准。',
      PAYMENT_PROVIDER_REQUIRED: '選擇自有金流時必須指定金流服務商。',
      INVALID_COLLECTION_MODE: '收款模式設定錯誤。',
      TENANT_GATEWAY_POLICY_MISMATCH: '請先將此租戶的收款模式設定為自有金流。',
      TENANT_GATEWAY_PROVIDER_UNSUPPORTED: '目前自有金流只支援藍新金流。',
      TENANT_GATEWAY_NOT_CONFIGURED: '自有金流參數尚未完成設定。',
      TENANT_GATEWAY_DISABLED: '此租戶的自有金流目前未啟用。',
      TENANT_PAYMENT_MASTER_KEY_MISSING: '平台尚未設定租戶金流加密主密鑰。',
      TENANT_PAYMENT_MASTER_KEY_WEAK: '租戶金流加密主密鑰長度不足。',
      TENANT_PAYMENT_KEY_VERSION_MISMATCH: '找不到此金流密文對應的加密金鑰版本。',
      TENANT_GATEWAY_SECRET_INVALID: 'Hash Key 與 Hash IV 必須同時提供。',
      TENANT_GATEWAY_SECRET_DECRYPT_FAILED: '無法解密此租戶的金流參數。',
      INVALID_MERCHANT_ID: '請輸入有效的藍新 Merchant ID。',
      INVALID_HASH_KEY_LENGTH: '藍新 Hash Key 必須為 32 個字元。',
      INVALID_HASH_IV_LENGTH: '藍新 Hash IV 必須為 16 個字元。',
      INVALID_GATEWAY_URL: '金流網址必須是有效的 HTTPS 網址。',
    };
    return map[code] || code;
  }

  async function recoverLogin(error) {
    const code = String(error?.code || error?.message || '');
    if (!['AUTH_REQUIRED', 'LINE_ACCESS_TOKEN_INVALID', 'LINE_PROFILE_AUTH_FAILED'].includes(code)) return false;
    if (!global.liff || typeof global.liff.login !== 'function') return false;
    global.liff.login({ redirectUri: global.location.href });
    return true;
  }

  async function apiFetch(path, options = {}) {
    const {
      tenantSlug = resolveTenantSlug(),
      workerUrl = DEFAULT_WORKER_URL,
      public: isPublic = false,
      headers: customHeaders = {},
      body,
      ...fetchOptions
    } = options;

    const tenant = normalizeTenantSlug(tenantSlug);
    const headers = new Headers(customHeaders);
    headers.set('X-Tenant-Slug', tenant);
    headers.set('Accept', 'application/json');

    let requestBody = body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
      headers.set('Content-Type', 'application/json');
      requestBody = JSON.stringify({ ...body, tenant_slug: tenant });
    }

    if (!isPublic) {
      const accessToken = getLiffAccessToken();
      if (!accessToken) {
        const error = new Error('AUTH_REQUIRED');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const url = new URL(path, workerUrl.endsWith('/') ? workerUrl : `${workerUrl}/`);
    if (!url.searchParams.has('tenant') && !url.searchParams.has('tenant_slug') && !url.searchParams.has('a')) {
      url.searchParams.set('tenant', tenant);
    }

    try {
      const response = await fetch(url.toString(), {
        ...fetchOptions,
        headers,
        body: requestBody,
      });
      return await parseResponse(response);
    } catch (error) {
      await recoverLogin(error);
      throw error;
    }
  }

  const client = {
    DEFAULT_WORKER_URL,
    normalizeTenantSlug,
    resolveTenantSlug,
    getLiffAccessToken,
    friendlyError,
    apiFetch,

    getPublicTenant(tenantSlug) {
      return apiFetch('/api/v2/tenant/public', { tenantSlug, public: true });
    },

    getContext(tenantSlug) {
      return apiFetch('/api/v2/tenant/context', { tenantSlug });
    },

    getPaymentPolicy(tenantSlug) {
      return apiFetch('/api/v2/tenant/payment-policy', { tenantSlug });
    },

    updatePaymentPolicy(data, tenantSlug) {
      return apiFetch('/api/v2/tenant/payment-policy', {
        tenantSlug,
        method: 'POST',
        body: data,
      });
    },

    getPaymentGateway(tenantSlug) {
      return apiFetch('/api/v2/tenant/payment-gateway', { tenantSlug });
    },

    updatePaymentGateway(data, tenantSlug) {
      return apiFetch('/api/v2/tenant/payment-gateway', {
        tenantSlug,
        method: 'POST',
        body: data,
      });
    },

    getPublicItinerary(itineraryId, tenantSlug) {
      return apiFetch(`/api/v2/itineraries/${encodeURIComponent(itineraryId)}?scope=public`, {
        tenantSlug,
        public: true,
      });
    },

    listPublicItineraries(tenantSlug, limit = 100) {
      return apiFetch(`/api/v2/itineraries?scope=public&limit=${encodeURIComponent(limit)}`, {
        tenantSlug,
        public: true,
      });
    },

    resolveInvite(code, tenantSlug) {
      return apiFetch(`/api/v2/invites/${encodeURIComponent(String(code || '').trim().toUpperCase())}`, {
        tenantSlug,
        public: true,
      });
    },

    createBooking(data, tenantSlug) {
      return apiFetch('/api/v2/bookings', {
        tenantSlug,
        method: 'POST',
        body: data,
      });
    },

    createPayment(orderId, leg = 'deposit', tenantSlug) {
      return apiFetch('/api/v2/payments/create', {
        tenantSlug,
        method: 'POST',
        body: { order_id: orderId, leg },
      });
    },

    listOrders(tenantSlug, params = {}) {
      const query = new URLSearchParams(params);
      return apiFetch(`/api/v2/orders?${query.toString()}`, { tenantSlug });
    },

    listCustomers(tenantSlug, params = {}) {
      const query = new URLSearchParams(params);
      return apiFetch(`/api/v2/customers?${query.toString()}`, { tenantSlug });
    },

    listPayments(tenantSlug, params = {}) {
      const query = new URLSearchParams(params);
      return apiFetch(`/api/v2/payments?${query.toString()}`, { tenantSlug });
    },

    updateOrderStatus(orderId, status, tenantSlug) {
      return apiFetch(`/api/v2/orders/${encodeURIComponent(orderId)}/status`, {
        tenantSlug,
        method: 'POST',
        body: { status },
      });
    },
  };

  global.TravelKeeperTenantApi = client;
})(window);
