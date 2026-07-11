from pathlib import Path
import re

path = Path('crm.html')
text = path.read_text(encoding='utf-8')

if 'window.TravelKeeperTenantCrm' in text and 'crmApi.load()' in text:
    print('Phase 11 CRM page already applied')
    raise SystemExit(0)

needle = '  <script src="./js/tenant-page-client.js"></script>'
replacement = needle + '\n  <script src="./js/tenant-crm-client.js"></script>'
if needle not in text:
    raise SystemExit('tenant page client script tag not found')
text = text.replace(needle, replacement, 1)

needle = "    const tenantPage = window.TravelKeeperTenantPage;\n    const tenantSlug = tenantPage.tenantSlug;"
replacement = needle + "\n    const crmApi = window.TravelKeeperTenantCrm;"
if needle not in text:
    raise SystemExit('tenant page constants not found')
text = text.replace(needle, replacement, 1)

load_pattern = re.compile(r"    async function loadCrm\(\) \{.*?\n    \}\n\n    function applyFilters", re.S)
load_replacement = r'''    function prepareCrmCustomer(customer = {}) {
      const orders = Array.isArray(customer.orders) ? customer.orders.map(normalizeOrder) : [];
      const records = Array.isArray(customer.visitorRecords) ? customer.visitorRecords : [];
      const normalized = {
        ...customer,
        id: customer.id || customer.profileId || customer.customer_id || '',
        profileId: customer.profileId || customer.profile_id || customer.id || '',
        source: customer.source || (customer.userId ? 'line' : 'order'),
        name: customer.name || customer.displayName || '未命名客戶',
        userId: customer.userId || customer.line_user_uid || '',
        phone: customer.phone || '',
        email: customer.email || '',
        status: customer.status || 'open',
        risk: customer.risk || 'low',
        opportunityStage: customer.opportunityStage || customer.opportunity_stage || 'new',
        opportunityValue: Number(customer.opportunityValue ?? customer.opportunity_value ?? customer.totalAmount ?? 0),
        opportunityNote: customer.opportunityNote || '',
        orders,
        visitorRecords: records,
        latestRecord: customer.latestRecord || records[0] || null,
        orderCount: Number(customer.orderCount ?? customer.totalOrders ?? orders.length),
        totalAmount: Number(customer.totalAmount ?? orders.reduce((sum, order) => sum + order.amount, 0)),
        lastOrderAt: customer.lastOrderAt || '',
        lastMessageAt: customer.lastMessageAt || '',
        hasIdentity: Boolean(customer.phone || customer.email || customer.userId),
      };
      normalized.searchBlob = [
        normalized.name, normalized.userId, normalized.phone, normalized.email,
        normalized.summary, normalized.note, normalized.birthday, normalized.address,
        normalized.identityNote, normalized.preferenceNote, normalized.tabooNote,
        normalized.opportunityNote, normalized.inviteCode, normalized.refUid,
        normalized.referralNote, ...(normalized.tags || []),
        ...records.flatMap(record => [record.category, record.content, record.status, record.priority]),
        ...orders.flatMap(order => [order.customerName, order.phone, order.email, order.title, order.status]),
      ].join(' ').toLowerCase();
      return normalized;
    }

    async function loadCrm() {
      if (!profile?.userId) throw new Error('尚未取得管理員身分');
      if (crmLoading) return;
      crmLoading = true;
      els.loadButton.disabled = true;
      els.loadButton.classList.add('opacity-60', 'cursor-not-allowed');
      try {
        els.loadState.textContent = '正在載入租戶 CRM 主檔、對話與訂單資料...';
        const result = await crmApi.load();
        customers = (result.data || []).map(prepareCrmCustomer);
        applyFilters();
        els.loadState.textContent = `已載入 ${customers.length} 筆 CRM 客戶｜租戶 ${tenantSlug}`;
        if (targetThreadId) {
          const found = customers.find(customer => customer.id === targetThreadId || customer.lineThreadId === targetThreadId);
          if (found) selectCustomer(found.id);
        }
      } finally {
        crmLoading = false;
        els.loadButton.disabled = false;
        els.loadButton.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }

    function applyFilters'''
text, count = load_pattern.subn(load_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'loadCrm replacement count={count}')

save_pattern = re.compile(r"    async function saveCustomerProfile\(customer\) \{.*?\n    \}\n\n    function downloadCsv", re.S)
save_replacement = r'''    async function saveCustomerProfile(customer) {
      if (!profile?.userId) throw new Error('尚未取得管理員身分');
      if (!customer) throw new Error('請先選擇客戶');
      const button = document.getElementById('save-customer-profile');
      button.disabled = true;
      button.classList.add('opacity-60');
      try {
        const payload = {
          customer_id: customer.customerId || customer.customer_id || '',
          line_user_uid: customer.userId || '',
          display_name: document.getElementById('profile-name')?.value || '',
          phone: document.getElementById('profile-phone')?.value || '',
          email: document.getElementById('profile-email')?.value || '',
          birthday: document.getElementById('profile-birthday')?.value || '',
          address: document.getElementById('profile-address')?.value || '',
          identity_note: document.getElementById('profile-identity-note')?.value || '',
          preference_note: document.getElementById('profile-preference-note')?.value || '',
          taboo_note: document.getElementById('profile-taboo-note')?.value || '',
          privacy_consent: document.getElementById('profile-privacy-consent')?.value || '',
          invite_code: document.getElementById('profile-invite-code')?.value || '',
          ref_uid: document.getElementById('profile-ref-uid')?.value || '',
          referral_note: document.getElementById('profile-referral-note')?.value || '',
          owner_uid: customer.ownerUid || customer.owner_uid || customer.refUid || '',
          source: customer.source || 'manual',
          status: customer.status || 'open',
          risk: customer.risk || 'low',
          opportunity_stage: customer.opportunityStage || 'new',
          opportunity_value: customer.opportunityValue || 0,
          opportunity_note: customer.opportunityNote || '',
          summary: customer.summary || '',
          note: customer.note || '',
          tags: customer.tags || [],
          last_message_at: customer.lastMessageAt || '',
        };
        const result = await crmApi.saveProfile(payload, customer.profileId || customer.id || '');
        const saved = prepareCrmCustomer({ ...customer, ...(result.data || {}) });
        const index = customers.findIndex(item => item.id === customer.id);
        if (index >= 0) customers[index] = saved;
        applyFilters();
        selectCustomer(saved.id);
        showToast('客戶 CRM 主檔已儲存');
      } finally {
        button.disabled = false;
        button.classList.remove('opacity-60');
      }
    }

    function downloadCsv'''
text, count = save_pattern.subn(save_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'saveCustomerProfile replacement count={count}')

# Preserve the active tenant in navigation links.
text = text.replace('href="./dashboard.html"', 'href="./dashboard.html" id="dashboard-link"', 1)
text = text.replace('href="./line-oa-monitor.html"', 'href="./line-oa-monitor.html" id="line-monitor-link"', 1)
init_marker = "      profile = session.profile;\n      await loadCrm();"
init_replacement = "      profile = session.profile;\n      const keep = new URLSearchParams(location.search);\n      const dashboardLink = document.getElementById('dashboard-link');\n      const monitorLink = document.getElementById('line-monitor-link');\n      if (dashboardLink) dashboardLink.href = `./dashboard.html?${keep.toString()}`;\n      if (monitorLink) monitorLink.href = `./line-oa-monitor.html?${keep.toString()}`;\n      await loadCrm();"
if init_marker not in text:
    raise SystemExit('CRM init marker not found')
text = text.replace(init_marker, init_replacement, 1)

path.write_text(text, encoding='utf-8')
print('Phase 11 CRM page applied')
