(function (global) {
  'use strict';

  const tenantApi = global.TravelKeeperTenantApi;
  if (!tenantApi) throw new Error('TravelKeeperTenantApi is required before tenant-page-client.js');

  function isLocalWorkerUrl(value) {
    try {
      const url = new URL(value);
      return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
    } catch (_) {
      return false;
    }
  }

  function resolveWorkerUrl() {
    const trusted = String(global.TRAVELKEEPER_WORKER_URL || '').trim();
    if (trusted) return trusted;
    const candidate = new URLSearchParams(global.location?.search || '').get('worker') || '';
    return isLocalWorkerUrl(candidate) ? new URL(candidate).origin : tenantApi.DEFAULT_WORKER_URL;
  }

  const workerUrl = resolveWorkerUrl();
  const tenantSlug = tenantApi.resolveTenantSlug(global.location?.search || '');
  const localDev = isLocalWorkerUrl(workerUrl);
  const devUid = localDev
    ? String(new URLSearchParams(global.location?.search || '').get('dev_uid') || '').trim().slice(0, 100)
    : '';

  async function parseResponse(response) {
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; }
    catch (_) { payload = { success: false, error: text || `HTTP_${response.status}` }; }
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

  async function localApiFetch(path, options = {}) {
    const tenant = tenantApi.normalizeTenantSlug(options.tenantSlug || tenantSlug);
    if (!devUid && !options.public) {
      const error = new Error('AUTH_REQUIRED');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('X-Tenant-Slug', tenant);
    if (devUid) headers.set('X-User-Uid', devUid);
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify({ ...body, tenant_slug: tenant });
    }
    const url = new URL(path, workerUrl.endsWith('/') ? workerUrl : `${workerUrl}/`);
    if (!url.searchParams.has('tenant') && !url.searchParams.has('tenant_slug') && !url.searchParams.has('a')) {
      url.searchParams.set('tenant', tenant);
    }
    return parseResponse(await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body,
    }));
  }

  function apiCall(path, options = {}) {
    if (localDev && devUid) return localApiFetch(path, options);
    return tenantApi.apiFetch(path, {
      ...options,
      tenantSlug: options.tenantSlug || tenantSlug,
      workerUrl,
    });
  }

  function profileAliases(profile = {}) {
    return {
      ...profile,
      displayName: profile.displayName || profile.display_name || '',
      inviteCode: profile.inviteCode || profile.invite_code || '',
      companyName: profile.companyName || profile.company_name || '',
      commissionPct: Number(profile.commissionPct ?? profile.commission_pct ?? 0),
      lineLink: profile.lineLink || profile.line_link || '',
      lineAtLink: profile.lineAtLink || profile.line_at_link || '',
      lineAtId: profile.lineAtId || profile.line_at_id || '',
      fbLink: profile.fbLink || profile.fb_link || '',
      igLink: profile.igLink || profile.ig_link || '',
      webLink: profile.webLink || profile.web_link || '',
      mapLink: profile.mapLink || profile.map_link || '',
    };
  }

  function normalizeOrder(row = {}) {
    const orderId = row.order_id || row.orderId || row.orderid || '';
    const itineraryId = row.itinerary_id || row.itineraryId || row.itineraryid || '';
    const itineraryTitle = row.itinerary_title || row.itineraryTitle || row.itinerarytitle || '';
    const distributorUid = row.distributor_uid || row.distributorUid || row.distributoruid || '';
    const customerName = row.customer_name || row.customerName || row.customername || '';
    const customerPhone = row.contact_phone || row.customer_phone || row.customerPhone || row.customerphone || '';
    const customerLineUid = row.customer_line_uid || row.customerLineUid || row.customerlineuid || '';
    const travelDate = row.travel_date || row.travelDate || row.traveldate || '';
    const totalAmount = Number(row.total_amount ?? row.totalAmount ?? row.totalamount ?? row.price ?? 0);
    const depositAmount = Number(row.deposit_amount ?? row.depositAmount ?? row.depositamount ?? 0);
    const balanceAmount = Number(row.balance_amount ?? row.balanceAmount ?? row.balanceamount ?? 0);
    const createdAt = row.created_at || row.createdAt || row.createdat || '';
    return {
      ...row,
      order_id: orderId, orderId, orderid: orderId,
      itinerary_id: itineraryId, itineraryId, itineraryid: itineraryId,
      itinerary_title: itineraryTitle, itineraryTitle, itinerarytitle: itineraryTitle,
      distributor_uid: distributorUid, distributorUid, distributoruid: distributorUid,
      customer_name: customerName, customerName, customername: customerName,
      customer_phone: customerPhone, customerPhone, customerphone: customerPhone,
      customer_line_uid: customerLineUid, customerLineUid, customerlineuid: customerLineUid,
      travel_date: travelDate, travelDate, traveldate: travelDate,
      total_amount: totalAmount, totalAmount, totalamount: totalAmount,
      deposit_amount: depositAmount, depositAmount, depositamount: depositAmount,
      balance_amount: balanceAmount, balanceAmount, balanceamount: balanceAmount,
      deposit_status: row.deposit_status || row.depositStatus || row.depositstatus || 'unpaid',
      depositstatus: row.deposit_status || row.depositStatus || row.depositstatus || 'unpaid',
      balance_status: row.balance_status || row.balanceStatus || row.balancestatus || 'unpaid',
      balancestatus: row.balance_status || row.balanceStatus || row.balancestatus || 'unpaid',
      balance_collect: row.balance_collect || row.balanceCollect || row.balancecollect || 'online',
      balancecollect: row.balance_collect || row.balanceCollect || row.balancecollect || 'online',
      commission_amount: Number(row.commission_amount ?? row.commissionAmount ?? row.commissionamount ?? 0),
      commissionamount: Number(row.commission_amount ?? row.commissionAmount ?? row.commissionamount ?? 0),
      commission_status: row.commission_status || row.commissionStatus || row.commissionstatus || 'pending',
      commissionstatus: row.commission_status || row.commissionStatus || row.commissionstatus || 'pending',
      created_at: createdAt, createdAt, createdat: createdAt,
      price: Number(row.price ?? totalAmount),
    };
  }

  function normalizeCustomer(row = {}) {
    const phone = row.contact_phone || row.customer_phone || row.customerPhone || row.customerphone || '';
    const name = row.customer_name || row.customerName || row.customername || '';
    const lineUid = row.customer_line_uid || row.customerLineUid || row.customerlineuid || '';
    const firstOrderAt = row.first_order_at || row.firstOrderAt || row.firstorderat || '';
    const lastOrderAt = row.last_order_at || row.lastOrderAt || row.lastorderat || '';
    const totalOrders = Number(row.total_orders ?? row.totalOrders ?? row.totalorders ?? 0);
    const totalAmount = Number(row.total_amount ?? row.totalAmount ?? row.totalamount ?? 0);
    return {
      ...row,
      customer_id: row.customer_id || row.customerId || '',
      customerId: row.customer_id || row.customerId || '',
      customer_key: row.customer_key || row.customer_phone || '',
      customer_phone: phone, customerPhone: phone, customerphone: phone,
      contact_phone: phone,
      customer_name: name, customerName: name, customername: name,
      customer_line_uid: lineUid, customerLineUid: lineUid, customerlineuid: lineUid,
      first_order_at: firstOrderAt, firstOrderAt, firstorderat: firstOrderAt,
      last_order_at: lastOrderAt, lastOrderAt, lastorderat: lastOrderAt,
      total_orders: totalOrders, totalOrders, totalorders: totalOrders,
      total_amount: totalAmount, totalAmount, totalamount: totalAmount,
      owner_uid: row.owner_uid || row.ownerUid || row.owneruid || '',
      owneruid: row.owner_uid || row.ownerUid || row.owneruid || '',
    };
  }

  function normalizeDistributor(row = {}) {
    const uid = row.uid || row.user_uid || row.userUid || '';
    const displayName = row.displayName || row.display_name || row.name || '';
    const inviteCode = row.inviteCode || row.invite_code || row.invitecode || '';
    const canUpload = row.canUpload === true || row.canupload === 'Y' || row.role === 'editor';
    return {
      ...row,
      uid,
      user_uid: uid,
      displayName,
      display_name: displayName,
      name: displayName,
      inviteCode,
      invite_code: inviteCode,
      invitecode: inviteCode,
      commission: Number(row.commission ?? row.commission_pct ?? 0),
      commissionPct: Number(row.commissionPct ?? row.commission_pct ?? 0),
      canUpload,
      canupload: canUpload ? 'Y' : 'N',
    };
  }

  async function initLiffSession({ fallbackLiffId = '', requireContext = true } = {}) {
    const tenantResult = await apiCall('/api/v2/tenant/public', { public: true });
    const tenant = tenantResult.data || {};
    const liffId = String(tenant.liff_id || fallbackLiffId || '').trim();
    if (!liffId) throw new Error('TENANT_LIFF_NOT_CONFIGURED');

    if (localDev && devUid) {
      const contextResult = requireContext ? await apiCall('/api/v2/tenant/context') : null;
      return {
        tenant,
        tenantSlug,
        profile: { userId: devUid, displayName: 'Local Dev', pictureUrl: '' },
        context: contextResult?.data || null,
        authMode: 'legacy_uid',
      };
    }

    if (!global.liff) throw new Error('LIFF_NOT_READY');
    await global.liff.init({ liffId, withLoginOnExternalBrowser: true });
    if (!global.liff.isLoggedIn()) {
      global.liff.login({ redirectUri: global.location.href });
      throw new Error('LIFF_LOGIN_REQUIRED');
    }
    const profile = await global.liff.getProfile();
    const contextResult = requireContext ? await apiCall('/api/v2/tenant/context') : null;
    return {
      tenant,
      tenantSlug,
      profile,
      context: contextResult?.data || null,
      authMode: 'line_access_token',
    };
  }

  async function legacyApi(path, options = {}) {
    return apiCall(path, options);
  }

  const client = {
    tenantSlug,
    workerUrl,
    localDev,
    devUid,
    apiCall,
    legacyApi,
    initLiffSession,
    profileAliases,
    normalizeOrder,
    normalizeCustomer,
    friendlyError: tenantApi.friendlyError,

    async listOrders(params = {}) {
      const query = new URLSearchParams(params);
      const response = await apiCall(`/api/v2/orders?${query.toString()}`);
      return (response.data || []).map(normalizeOrder);
    },

    async listCustomers(params = {}) {
      const query = new URLSearchParams(params);
      const response = await apiCall(`/api/v2/customers?${query.toString()}`);
      return (response.data || []).map(normalizeCustomer);
    },

    async listPayments(params = {}) {
      const query = new URLSearchParams(params);
      return apiCall(`/api/v2/payments?${query.toString()}`);
    },

    async getOrderStatus(orderId) {
      return apiCall(`/api/v2/orders/${encodeURIComponent(orderId)}`);
    },

    async createPayment(orderId, leg = 'deposit') {
      return apiCall('/api/v2/payments/create', {
        method: 'POST',
        body: { order_id: orderId, leg },
      });
    },

    async updateOrderStatus(orderId, status) {
      return apiCall(`/api/v2/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'POST',
        body: { status },
      });
    },

    async listItineraries(params = {}) {
      const query = new URLSearchParams({ scope: 'internal', ...params });
      const response = await apiCall(`/api/v2/itineraries?${query.toString()}`);
      return response.data || [];
    },

    async getProfile() {
      const response = await apiCall('/api/v2/tenant/profile');
      return profileAliases(response.data || {});
    },

    async updateProfile(data = {}) {
      const response = await apiCall('/api/v2/tenant/profile', { method: 'POST', body: data });
      return profileAliases(response.data || {});
    },

    async listDistributors() {
      const response = await apiCall('/api/v2/distributors');
      return (response.data || []).map(normalizeDistributor);
    },

    async updateDistributorStatus(userUid, status) {
      const response = await apiCall(`/api/v2/distributors/${encodeURIComponent(userUid)}/status`, {
        method: 'POST', body: { status },
      });
      return normalizeDistributor(response.data || {});
    },

    async updateDistributorUpload(userUid, canUpload) {
      const response = await apiCall(`/api/v2/distributors/${encodeURIComponent(userUid)}/upload`, {
        method: 'POST', body: { can_upload: !!canUpload },
      });
      return normalizeDistributor(response.data || {});
    },

    async markBalancePaid(orderId) {
      const response = await apiCall(`/api/v2/orders/${encodeURIComponent(orderId)}/balance-paid`, {
        method: 'POST', body: {},
      });
      return normalizeOrder(response.data || {});
    },

    async listPublicItineraries(limit = 100) {
      const response = await apiCall(`/api/v2/itineraries?scope=public&limit=${encodeURIComponent(limit)}`, { public: true });
      return response.data || [];
    },
  };

  global.TravelKeeperTenantPage = client;
})(window);
