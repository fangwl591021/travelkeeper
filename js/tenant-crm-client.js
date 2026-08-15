(function (global) {
  'use strict';

  const page = global.TravelKeeperTenantPage;
  if (!page) throw new Error('TravelKeeperTenantPage is required before tenant-crm-client.js');

  const apiCall = (path, options = {}) => page.apiCall(path, options);
  const adminRoles = new Set(['platform_admin', 'tenant_admin']);
  let lastCrmResult = null;
  let distributorCache = null;
  let observerStarted = false;

  const client = {
    tenantSlug: page.tenantSlug,

    async load() {
      const result = await apiCall('/api/v2/crm');
      lastCrmResult = result || null;
      scheduleAttributionRender();
      return result;
    },

    async getProfile(profileId) {
      return apiCall(`/api/v2/crm/profiles/${encodeURIComponent(profileId)}`);
    },

    async saveProfile(data = {}, profileId = '') {
      const path = profileId
        ? `/api/v2/crm/profiles/${encodeURIComponent(profileId)}`
        : '/api/v2/crm/profiles';
      return apiCall(path, { method: 'POST', body: data });
    },

    async listDistributors({ refresh = false } = {}) {
      if (!refresh && distributorCache) return distributorCache;
      const result = await apiCall('/api/v2/distributors');
      distributorCache = result || { data: [] };
      return distributorCache;
    },

    async transferOwner(customerId, ownerUid) {
      if (!customerId) throw new Error('CUSTOMER_NOT_FOUND');
      if (!ownerUid) throw new Error('OWNER_TRANSFER_TARGET_REQUIRED');
      return apiCall(`/api/v2/customers/${encodeURIComponent(customerId)}/owner-transfer`, {
        method: 'POST',
        body: { owner_uid: ownerUid },
      });
    },

    async listThreads() {
      return apiCall('/api/v2/crm/threads');
    },

    async saveThread(data = {}) {
      return apiCall('/api/v2/crm/threads', { method: 'POST', body: data });
    },

    async listRecords(profileId = '') {
      const query = profileId ? `?profile_id=${encodeURIComponent(profileId)}` : '';
      return apiCall(`/api/v2/crm/records${query}`);
    },

    async saveRecord(data = {}, recordId = '') {
      const path = recordId
        ? `/api/v2/crm/records/${encodeURIComponent(recordId)}`
        : '/api/v2/crm/records';
      return apiCall(path, { method: 'POST', body: data });
    },

    async deleteRecord(recordId) {
      return apiCall(`/api/v2/crm/records/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    },
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function customerIdOf(customer = {}) {
    return String(customer.customerId || customer.customer_id || customer.id || '').trim();
  }

  function refUidOf(customer = {}) {
    return String(customer.refUid || customer.ref_uid || '').trim();
  }

  function ownerUidOf(customer = {}) {
    return String(customer.ownerUid || customer.owner_uid || '').trim();
  }

  function selectedCustomer() {
    const detail = document.getElementById('detail');
    if (!detail || !lastCrmResult?.data) return null;
    const displayedId = String(detail.querySelector('.font-mono')?.textContent || '').trim();
    if (!displayedId) return null;
    return (lastCrmResult.data || []).find(item => String(item.id || '').trim() === displayedId) || null;
  }

  function distributorLabel(distributor = {}) {
    const uid = String(distributor.uid || distributor.user_uid || '').trim();
    const name = String(distributor.name || distributor.displayName || distributor.display_name || '').trim();
    return name ? `${name}（${uid}）` : uid;
  }

  function ownerNameFromCache(uid) {
    if (!uid || !distributorCache?.data) return '';
    const row = distributorCache.data.find(item => String(item.uid || item.user_uid || '').trim() === uid);
    return row ? distributorLabel(row) : '';
  }

  function attributionPanelHtml(customer) {
    const refUid = refUidOf(customer);
    const ownerUid = ownerUidOf(customer);
    const role = String(lastCrmResult?.role || '').trim();
    const canTransfer = adminRoles.has(role) && Boolean(customerIdOf(customer));
    const refLabel = ownerNameFromCache(refUid) || refUid || '尚未建立';
    const ownerLabel = ownerNameFromCache(ownerUid) || ownerUid || '尚未指派';

    return `
      <section id="attribution-panel" data-customer-id="${escapeHtml(customerIdOf(customer))}" class="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-black tracking-[0.16em] text-indigo-400">ATTRIBUTION</p>
            <h3 class="mt-1 font-black text-slate-900">歸屬關係</h3>
          </div>
          <span class="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-indigo-700">租戶內鎖定</span>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="rounded-xl border border-indigo-100 bg-white p-3">
            <p class="text-[11px] font-bold text-slate-400">原始介紹人 · 永久鎖定</p>
            <p class="mt-1 break-all font-black text-slate-800">${escapeHtml(refLabel)}</p>
            <p class="mt-1 text-[11px] text-slate-400">後續交接與訂單不會改變此歸屬</p>
          </div>
          <div class="rounded-xl border border-indigo-100 bg-white p-3">
            <p class="text-[11px] font-bold text-slate-400">目前服務負責人</p>
            <p class="mt-1 break-all font-black text-slate-800">${escapeHtml(ownerLabel)}</p>
            <p class="mt-1 text-[11px] text-slate-400">可透過正式交接流程變更</p>
          </div>
        </div>
        ${canTransfer ? `
          <div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p class="text-xs font-bold text-amber-800">移交只會改變服務負責人；原始介紹人與歷史訂單歸屬保持不變。</p>
            <button id="open-owner-transfer" type="button" class="mt-3 w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-white hover:bg-amber-600">移交負責人</button>
            <div id="owner-transfer-controls" hidden class="mt-3 space-y-2">
              <select id="owner-transfer-target" class="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm"></select>
              <button id="confirm-owner-transfer" type="button" class="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white">確認移交</button>
            </div>
          </div>` : ''}
      </section>`;
  }

  async function hydrateTransferControls(customer) {
    const controls = document.getElementById('owner-transfer-controls');
    const select = document.getElementById('owner-transfer-target');
    const openButton = document.getElementById('open-owner-transfer');
    if (!controls || !select || !openButton) return;

    openButton.disabled = true;
    openButton.textContent = '讀取可指派業務…';
    try {
      const result = await client.listDistributors();
      const currentOwner = ownerUidOf(customer);
      const options = (result.data || []).filter(item => {
        const uid = String(item.uid || item.user_uid || '').trim();
        return uid && uid !== currentOwner && ['approved', 'active'].includes(String(item.status || '').toLowerCase());
      });
      select.innerHTML = options.length
        ? `<option value="">請選擇新的服務負責人</option>${options.map(item => {
            const uid = String(item.uid || item.user_uid || '').trim();
            return `<option value="${escapeHtml(uid)}">${escapeHtml(distributorLabel(item))}</option>`;
          }).join('')}`
        : '<option value="">目前沒有其他可指派業務</option>';
      controls.hidden = false;
      openButton.hidden = true;
      renderAttributionPanel();
    } catch (error) {
      openButton.disabled = false;
      openButton.textContent = '移交負責人';
      global.alert(page.friendlyError ? page.friendlyError(error) : String(error?.message || error));
    }
  }

  async function confirmTransfer(customer) {
    const select = document.getElementById('owner-transfer-target');
    const button = document.getElementById('confirm-owner-transfer');
    const targetUid = String(select?.value || '').trim();
    if (!targetUid) {
      global.alert('請先選擇新的服務負責人。');
      return;
    }
    const targetLabel = distributorLabel((distributorCache?.data || []).find(item => String(item.uid || item.user_uid || '').trim() === targetUid) || { uid: targetUid });
    const refUid = refUidOf(customer) || '尚未建立';
    const confirmed = global.confirm(`確定將服務負責人移交給 ${targetLabel}？\n\n原始介紹人 ${refUid} 不會改變，歷史訂單歸屬也不會改變。`);
    if (!confirmed) return;

    if (button) {
      button.disabled = true;
      button.textContent = '移交中…';
    }
    try {
      await client.transferOwner(customerIdOf(customer), targetUid);
      global.alert('服務負責人已完成移交。原始介紹人與歷史訂單未變更。');
      const result = await client.load();
      lastCrmResult = result || lastCrmResult;
      global.location.reload();
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = '確認移交';
      }
      global.alert(page.friendlyError ? page.friendlyError(error) : String(error?.message || error));
    }
  }

  function bindAttributionActions(customer) {
    const openButton = document.getElementById('open-owner-transfer');
    if (openButton && !openButton.dataset.bound) {
      openButton.dataset.bound = '1';
      openButton.addEventListener('click', () => hydrateTransferControls(customer));
    }
    const confirmButton = document.getElementById('confirm-owner-transfer');
    if (confirmButton && !confirmButton.dataset.bound) {
      confirmButton.dataset.bound = '1';
      confirmButton.addEventListener('click', () => confirmTransfer(customer));
    }
  }

  function renderAttributionPanel() {
    const detail = document.getElementById('detail');
    const customer = selectedCustomer();
    if (!detail || !customer) return;

    const existing = document.getElementById('attribution-panel');
    if (existing) existing.remove();
    const header = detail.firstElementChild;
    if (!header) return;
    header.insertAdjacentHTML('afterend', attributionPanelHtml(customer));
    bindAttributionActions(customer);
  }

  function scheduleAttributionRender() {
    global.setTimeout(renderAttributionPanel, 0);
  }

  function startObserver() {
    if (observerStarted) return;
    const detail = document.getElementById('detail');
    if (!detail) return;
    observerStarted = true;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      global.setTimeout(() => {
        queued = false;
        const existing = document.getElementById('attribution-panel');
        if (!existing) renderAttributionPanel();
      }, 0);
    });
    observer.observe(detail, { childList: true, subtree: false });
  }

  function initAttributionUi() {
    startObserver();
    scheduleAttributionRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAttributionUi, { once: true });
  } else {
    initAttributionUi();
  }

  global.TravelKeeperTenantCrm = client;
})(window);