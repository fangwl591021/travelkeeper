(function (global) {
  'use strict';

  const tenantApi = global.TravelKeeperTenantApi;
  if (!tenantApi) throw new Error('TravelKeeperTenantApi is required before settlement-finance-client.js');

  const originalFriendlyError = tenantApi.friendlyError.bind(tenantApi);
  const financeErrors = {
    PAYOUT_ACCOUNT_NOT_FOUND: '找不到此租戶的收款帳戶。',
    PAYOUT_ACCOUNT_NOT_CONFIGURED: '此租戶尚未完成收款帳戶設定。',
    PAYOUT_ACCOUNT_NOT_VERIFIED: '此收款帳戶尚未通過平台驗證。',
    INVALID_PAYOUT_METHOD: '收款方式設定錯誤。',
    INVALID_BANK_ACCOUNT: '銀行代碼、戶名或帳號格式不正確。',
    INVALID_PAYOUT_ACCOUNT_STATUS: '收款帳戶驗證狀態不正確。',
    PAYOUT_ACCOUNT_REVEAL_REASON_REQUIRED: '查看完整帳號前必須填寫合理原因。',
    PAYOUT_ACCOUNT_DECRYPT_FAILED: '無法解密此收款帳戶，請聯絡平台管理員。',
    SETTLEMENT_BATCH_NOT_FOUND: '找不到此結算批次。',
    PROOF_NOT_FOUND: '找不到此匯款憑證，或憑證已刪除。',
    INVALID_PROOF_FILE: '憑證檔案內容無效。',
    INVALID_PROOF_FILE_TYPE: '憑證僅支援 PDF、JPG、PNG 或 WebP。',
    INVALID_PROOF_TYPE: '憑證分類不正確。',
    PROOF_FILE_TOO_LARGE: '憑證檔案不可超過 8MB。',
    INVALID_REPORT_DATE: '報表日期格式不正確。',
    R2_REQUIRED: '私有附件儲存服務尚未設定。',
  };

  tenantApi.friendlyError = function settlementFriendlyError(error) {
    const code = String(error?.code || error?.message || '');
    return financeErrors[code] || originalFriendlyError(error);
  };

  function resolveWorkerUrl() {
    const trustedGlobal = String(global.TRAVELKEEPER_WORKER_URL || '').trim();
    if (trustedGlobal) return trustedGlobal;
    const candidate = new URLSearchParams(global.location?.search || '').get('worker') || '';
    if (!candidate) return tenantApi.DEFAULT_WORKER_URL;
    try {
      const url = new URL(candidate);
      const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
      if (!localHosts.has(url.hostname)) return tenantApi.DEFAULT_WORKER_URL;
      if (!['http:', 'https:'].includes(url.protocol)) return tenantApi.DEFAULT_WORKER_URL;
      return url.origin;
    } catch (_) {
      return tenantApi.DEFAULT_WORKER_URL;
    }
  }

  const workerUrl = resolveWorkerUrl();

  // The settlement page loads this client before requesting tenant context.
  // Override only these two calls so local testing never touches the production Worker.
  tenantApi.getPublicTenant = function getPublicTenantForSettlement(tenantSlug) {
    return tenantApi.apiFetch('/api/v2/tenant/public', {
      tenantSlug,
      public: true,
      workerUrl,
    });
  };
  tenantApi.getContext = function getContextForSettlement(tenantSlug) {
    return tenantApi.apiFetch('/api/v2/tenant/context', { tenantSlug, workerUrl });
  };

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

  async function fetchProofBlob(proofId, tenantSlug, explicitWorkerUrl = workerUrl) {
    const tenant = tenantApi.normalizeTenantSlug(tenantSlug);
    const accessToken = token();
    if (!accessToken) {
      const error = new Error('AUTH_REQUIRED');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    const url = new URL(
      `/api/v2/settlement-finance/proofs/${encodeURIComponent(proofId)}/file`,
      explicitWorkerUrl.endsWith('/') ? explicitWorkerUrl : `${explicitWorkerUrl}/`,
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
    workerUrl,
    resolveWorkerUrl,

    getPayoutAccount(tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account', { tenantSlug, workerUrl });
    },

    updatePayoutAccount(data, tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account', {
        tenantSlug,
        workerUrl,
        method: 'POST',
        body: data || {},
      });
    },

    verifyPayoutAccount(status, note, tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account/verify', {
        tenantSlug,
        workerUrl,
        method: 'POST',
        body: { verification_status: status, verification_note: note || '' },
      });
    },

    revealPayoutAccount(reason, tenantSlug) {
      return tenantApi.apiFetch('/api/v2/settlement-finance/payout-account/reveal', {
        tenantSlug,
        workerUrl,
        method: 'POST',
        body: { reason },
      });
    },

    getReport(tenantSlug, params = {}) {
      return tenantApi.apiFetch(`/api/v2/settlement-finance/report${queryString(params)}`, {
        tenantSlug,
        workerUrl,
      });
    },

    listProofs(batchId, tenantSlug) {
      return tenantApi.apiFetch(
        `/api/v2/settlement-finance/batches/${encodeURIComponent(batchId)}/proofs`,
        { tenantSlug, workerUrl },
      );
    },

    uploadProof(batchId, data, tenantSlug) {
      return tenantApi.apiFetch(
        `/api/v2/settlement-finance/batches/${encodeURIComponent(batchId)}/proofs`,
        { tenantSlug, workerUrl, method: 'POST', body: data || {} },
      );
    },

    deleteProof(proofId, tenantSlug) {
      return tenantApi.apiFetch(
        `/api/v2/settlement-finance/proofs/${encodeURIComponent(proofId)}`,
        { tenantSlug, workerUrl, method: 'DELETE' },
      );
    },

    fetchProofBlob,
  };

  global.TravelKeeperSettlementFinance = client;
})(window);
