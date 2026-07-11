(function (global) {
  'use strict';

  const tenantApi = global.TravelKeeperTenantApi;
  if (!tenantApi) throw new Error('TravelKeeperTenantApi is required before settlement-finance-client.js');

  function queryString(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value));
    });
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  function token() {
    return tenantApi.getLiffAccessToken();
  }

  async function fetchProofBlob(proofId, tenantSlug, workerUrl = tenantApi.DEFAULT_WORKER_URL) {
    const tenant = tenantApi.normalizeTenantSlug(tenantSlug);
    const accessToken = token();
    if (!accessToken) {
      const error = new Error('AUTH_REQUIRED');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    const url = new URL(
      `/api/v2/settlement-finance/proofs/${encodeURIComponent(proofId)}/file`,
      workerUrl.endsWith('/') ? workerUrl : `${workerUrl}/`,
    );
    url.searchParams.set('tenant', tenant);
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Tenant-Slug': tenant,
      },
    });
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch (_) {}
      const code = String(payload?.error || `HTTP_${response.status}`);
      const error = new Error(code);
      error.code = code;
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return {
      blob: await response.blob(),
      filename: response.headers.get('content-disposition') || '',
      contentType: response.headers.get('content-type') || 'application/octet-stream',
    };
  }

  const client = {
    getPayoutAccount(tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account', { tenantSlug });
    },

    updatePayoutAccount(data, tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account', {
        tenantSlug,
        method: 'POST',
        body: data || {},
      });
    },

    verifyPayoutAccount(status, note, tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account/verify', {
        tenantSlug,
        method: 'POST',
        body: { verification_status: status, verification_note: note || '' },
      });
    },

    revealPayoutAccount(reason, tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account/reveal', {
        tenantSlug,
        method: 'POST',
        body: { reason },
      });
    },

    getReport(tenantSlug, params = {}) {
      return tenantApi.apiFetch(`/api/v2/settlement-finance/report${queryString(params)}`, { tenantSlug });
    },

    listProofs(batchId, tenantSlug) {
      return tenantApi.apiFetch(
        `/api/v2/settlement-finance/batches/${encodeURIComponent(batchId)}/proofs`,
        { tenantSlug },
      );
    },

    uploadProof(batchId, data, tenantSlug) {
      return tenantApi.apiFetch(
        `/api/v2/settlement-finance/batches/${encodeURIComponent(batchId)}/proofs`,
        { tenantSlug, method: 'POST', body: data || {} },
      );
    },

    deleteProof(proofId, tenantSlug) {
      return tenantApi.apiFetch(
        `/api/v2/settlement-finance/proofs/${encodeURIComponent(proofId)}`,
        { tenantSlug, method: 'DELETE' },
      );
    },

    fetchProofBlob,
  };

  global.TravelKeeperSettlementFinance = client;
})(window);
