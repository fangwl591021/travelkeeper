from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_all(text, old, new, label, minimum=1):
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f'{label}: expected at least {minimum} matches, found {count}')
    return text.replace(old, new)


def sub_once(text, pattern, replacement, label, flags=re.S):
    result, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one regex match, found {count}')
    return result


# -----------------------------------------------------------------------------
# worker-tenant.js
# -----------------------------------------------------------------------------
worker = read('worker-tenant.js')
worker = replace_once(
    worker,
    "import {\n  isSettlementPaymentControlApiRequest,\n  routeSettlementPaymentControlApi,\n} from './lib/settlement-payment-control-api.js';\n",
    "import {\n  isSettlementPaymentControlApiRequest,\n  routeSettlementPaymentControlApi,\n} from './lib/settlement-payment-control-api.js';\nimport {\n  isTenantOrderActionRequest,\n  routeTenantOrderAction,\n} from './lib/tenant-order-actions-api.js';\nimport {\n  isTenantProfileApiRequest,\n  routeTenantProfileApi,\n} from './lib/tenant-profile-api.js';\nimport {\n  isTenantDistributorApiRequest,\n  routeTenantDistributorApi,\n} from './lib/tenant-distributor-api.js';\n",
    'worker imports',
)
worker = replace_once(worker, "'phase9'", "'phase10'", 'worker phase header')
route_anchor = "    if (isTenantBookingApiRequest(request)) {\n"
route_block = """    if (isTenantOrderActionRequest(request)) {
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

"""
worker = replace_once(worker, route_anchor, route_block + route_anchor, 'worker Phase 10 routes')
write('worker-tenant.js', worker)


# -----------------------------------------------------------------------------
# http error status
# -----------------------------------------------------------------------------
status = read('lib/http-error-status.js')
status = replace_once(status, "  ['ORDER_CUSTOMER_MISMATCH', 403],\n", "  ['ORDER_CUSTOMER_MISMATCH', 403],\n  ['ORDER_BALANCE_NOT_REQUIRED', 409],\n  ['ORDER_STATUS_CONFLICT', 409],\n", 'order action statuses')
status = replace_once(status, "  ['INVALID_COLLECTION_MODE', 400],\n", "  ['INVALID_COLLECTION_MODE', 400],\n  ['INVALID_DISTRIBUTOR_STATUS', 400],\n", 'distributor status error')
write('lib/http-error-status.js', status)


# -----------------------------------------------------------------------------
# shared browser page client
# -----------------------------------------------------------------------------
client = read('js/tenant-page-client.js')
normalize_marker = "  async function initLiffSession({ fallbackLiffId = '', requireContext = true } = {}) {\n"
normalize_distributor = """  function normalizeDistributor(row = {}) {
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

"""
client = replace_once(client, normalize_marker, normalize_distributor + normalize_marker, 'normalize distributor insertion')
method_marker = "    async listPublicItineraries(limit = 100) {\n"
extra_methods = """    async listItineraries(params = {}) {
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

"""
client = replace_once(client, method_marker, extra_methods + method_marker, 'tenant page methods')
write('js/tenant-page-client.js', client)


# -----------------------------------------------------------------------------
# Dashboard
# -----------------------------------------------------------------------------
dashboard = read('dashboard.html')
dashboard = replace_once(
    dashboard,
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n',
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n  <script src="./js/tenant-api-client.js"></script>\n  <script src="./js/tenant-page-client.js"></script>\n',
    'dashboard client scripts',
)
dashboard = replace_once(
    dashboard,
    "const LIFF_ID    = '2009367829-BDZCGti8';\n",
    "const LIFF_ID    = '2009367829-BDZCGti8';\nconst tenantPage = window.TravelKeeperTenantPage;\nconst tenantSlug = tenantPage.tenantSlug;\n",
    'dashboard tenant constants',
)
dashboard = sub_once(
    dashboard,
    r"  const fetchJson = \(url, fallback\) =>\s*fetch\(url\)\.then\(r => r\.json\(\)\)\.catch\(\(\) => fallback\);",
    """  const fetchJson = async (url, fallback) => {
    try {
      const parsed = new URL(url, WORKER_URL);
      return await tenantPage.legacyApi(`${parsed.pathname}${parsed.search}`);
    } catch (error) {
      console.warn('tenant legacy request failed:', error?.code || error?.message || error);
      return fallback;
    }
  };""",
    'dashboard fetchJson',
)

init_pattern = r"  // ── 初始化 ──\n  useEffect\(\(\) => \{\n    \(async \(\) => \{.*?\n  \}, \[\]\);"
init_replacement = """  // ── 初始化 ──
  useEffect(() => {
    (async () => {
      try {
        const session = await tenantPage.initLiffSession({ fallbackLiffId: LIFF_ID, requireContext: true });
        const p = session.profile;
        const ctx = session.context || {};
        const role = String(ctx.role || '');
        const permissions = Array.isArray(ctx.permissions) ? ctx.permissions : [];
        const _isAdmin = ['platform_admin', 'tenant_admin'].includes(role);
        const _canUpload = role === 'editor' || permissions.includes('*') || permissions.includes('itinerary.write');
        const _isDist = ['sales', 'editor'].includes(role);
        setProfile(p);
        setIsAdmin(_isAdmin);
        setCanUpload(_canUpload);
        setIsDistApproved(_isDist);
        setDistData(withDefaultSocialLinks(tenantPage.profileAliases(ctx.profile || {})));
        if (!_isAdmin && !_isDist) { setAuthState('denied'); return; }

        const initialView = readViewFromHash();
        const allowedViews = buildMenu({
          isAdmin: _isAdmin, canUpload: _canUpload,
          badges: { pendingOrders:0, pendingDist:0, pendingReview:0 }
        }).map(m => m.id);
        setView(initialView && allowedViews.includes(initialView) ? initialView : 'overview');
        setAuthState('ready');
        setLoading(false);
      } catch (e) {
        if (String(e?.message || '') === 'LIFF_LOGIN_REQUIRED') {
          setAuthState('login');
          setLoading(false);
          return;
        }
        console.error(e);
        setAuthState('denied');
        setLoading(false);
      }
    })();
  }, []);"""
dashboard = sub_once(dashboard, init_pattern, init_replacement, 'dashboard init')

replacements = {
    "fetchJson(`${WORKER_URL}/api/itineraries?action=getItineraries`, [])": "tenantPage.listPublicItineraries()",
    "fetchJson(`${WORKER_URL}/api/itineraries?action=getPendingReviews`, { data: [] })": "tenantPage.listItineraries({ status: 'pending' }).then(data => ({ data }))",
    "fetchJson(`${WORKER_URL}/api/itineraries?action=getItineraries&all=1`, [])": "tenantPage.listItineraries()",
    "fetchJson(`${WORKER_URL}/api/itineraries?action=getItineraries&owner=${userId}`, [])": "tenantPage.listItineraries({ owner: userId })",
    "fetchJson(`${WORKER_URL}/api/itineraries?action=getDistributors`, [])": "tenantPage.listDistributors()",
    "fetchJson(`${WORKER_URL}/api/itineraries?action=getAllOrders`, { data: [] })": "tenantPage.listOrders().then(data => ({ data }))",
    "fetchJson(`${WORKER_URL}/api/itineraries?action=getUserOrders&uid=${userId}`, { data: [] })": "tenantPage.listOrders().then(data => ({ data }))",
    "fetchJson(`${WORKER_URL}/api/my/customers?uid=${userId}`, { data: [] })": "tenantPage.listCustomers().then(data => ({ data }))",
    "fetch(`${WORKER_URL}/api/itineraries?action=getPendingReviews`).then(r=>r.json())": "tenantPage.listItineraries({ status: 'pending' }).then(data => ({ data }))",
    "fetch(`${WORKER_URL}/api/itineraries?action=getAllOrders`).then(r=>r.json())": "tenantPage.listOrders().then(data => ({ data }))",
    "fetch(`${WORKER_URL}/api/itineraries?action=getDistributors`).then(r=>r.json())": "tenantPage.listDistributors()",
    "fetch(`${WORKER_URL}/api/itineraries?action=getItineraries&all=1`).then(r=>r.json())": "tenantPage.listItineraries()",
    "fetch(`${WORKER_URL}/api/itineraries?action=getItineraries`).then(r=>r.json()).catch(()=>[])": "tenantPage.listPublicItineraries().catch(()=>[])",
    "fetch(`${WORKER_URL}/api/itineraries?action=getMyCustomers&uid=${profile.userId}`).then(r=>r.json()).catch(()=>({data:[]}))": "tenantPage.listCustomers().then(data => ({ data })).catch(()=>({data:[]}))",
    "fetch(`${WORKER_URL}/api/itineraries?action=getUserOrders&uid=${profile.userId}`).then(r=>r.json()).catch(()=>({data:[]}))": "tenantPage.listOrders().then(data => ({ data })).catch(()=>({data:[]}))",
    "fetch(`${WORKER_URL}/api/itineraries?action=getItineraries&owner=${profile.userId}`).then(r=>r.json()).catch(()=>[])": "tenantPage.listItineraries({ owner: profile.userId }).catch(()=>[])",
}
for old, new in replacements.items():
    if old in dashboard:
        dashboard = dashboard.replace(old, new)

status_pattern = r"  const handleUpdateOrderStatus = async \(orderId, newStatus\) => \{.*?\n  \};\n\n  // ★ v6"
status_replacement = """  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      await tenantPage.updateOrderStatus(orderId, newStatus);
      showToast(`✅ 已更新為「${ORDER_STATUS[newStatus]?.label || newStatus}」`);
      const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setOrders(prev => prev.map(o => o.orderid === orderId ? { ...o, status: newStatus, updatedat: nowIso } : o));
      setSelOrder(prev => prev && prev.orderid === orderId ? { ...prev, status: newStatus, updatedat: nowIso } : prev);
    } catch (e) { showToast('操作失敗：' + (e?.message || ''), 'error'); }
  };

  // ★ v6"""
dashboard = sub_once(dashboard, status_pattern, status_replacement, 'dashboard update order status')

balance_pattern = r"  const handleMarkBalancePaid = async \(orderId\) => \{.*?\n  \};\n\n  // ── 客戶"
balance_replacement = """  const handleMarkBalancePaid = async (orderId) => {
    try {
      const updated = await tenantPage.markBalancePaid(orderId);
      showToast('✅ 尾款已標記，佣金可請款');
      const normalized = tenantPage.normalizeOrder(updated);
      setOrders(prev => prev.map(o => o.orderid === orderId ? { ...o, ...normalized } : o));
      setSelOrder(prev => prev && prev.orderid === orderId ? { ...prev, ...normalized } : prev);
    } catch (e) { showToast('操作失敗：' + (e?.message || ''), 'error'); }
  };

  // ── 客戶"""
dashboard = sub_once(dashboard, balance_pattern, balance_replacement, 'dashboard mark balance')

customer_pattern = r"  const openCustomer = async \(customer\) => \{.*?\n  \};\n\n  // ── 推薦碼"
customer_replacement = """  const openCustomer = async (customer) => {
    setSelCustomer(customer);
    setLoadingCustOrders(true);
    setCustomerOrders([]);
    try {
      const data = await tenantPage.listOrders({ customer_phone: customer.customerphone });
      setCustomerOrders(data);
    } catch (e) { showToast('讀取訂單失敗', 'error'); }
    setLoadingCustOrders(false);
  };

  // ── 推薦碼"""
dashboard = sub_once(dashboard, customer_pattern, customer_replacement, 'dashboard customer orders')

profile_pattern = r"  const saveSocialProfile = async \(\) => \{.*?\n  \};\n\n  const copyInviteLink"
profile_replacement = """  const saveSocialProfile = async () => {
    if (!profile?.userId) return;
    setSocialSaving(true);
    try {
      const result = await tenantPage.updateProfile({
        phone: getSocialFieldValue('phone'),
        lineLink: getSocialFieldValue('lineLink'),
        lineAtLink: getSocialFieldValue('lineAtLink'),
        lineAtId: getSocialFieldValue('lineAtId'),
        fbLink: getSocialFieldValue('fbLink'),
        igLink: getSocialFieldValue('igLink'),
        webLink: getSocialFieldValue('webLink'),
        mapLink: getSocialFieldValue('mapLink'),
        bio: getSocialFieldValue('bio'),
      });
      setDistData(withDefaultSocialLinks(result));
      showToast('社群按鈕資料已更新');
    } catch (err) {
      showToast(err.message || '社群資料儲存失敗', 'error');
    } finally {
      setSocialSaving(false);
    }
  };

  const copyInviteLink"""
dashboard = sub_once(dashboard, profile_pattern, profile_replacement, 'dashboard social profile')

approve_pattern = r"  const handleApprove = async \(uid\) => \{.*?\n  \};\n\n  const handleReject"
approve_replacement = """  const handleApprove = async (uid) => {
    try {
      const updated = await tenantPage.updateDistributorStatus(uid, 'approved');
      setDistributors(prev => prev.map(d => d.uid === uid ? updated : d));
      setSelDist(null);
      showToast('✅ 已核准');
    } catch (e) { showToast('操作失敗：' + (e?.message || ''), 'error'); }
  };

  const handleReject"""
dashboard = sub_once(dashboard, approve_pattern, approve_replacement, 'dashboard approve distributor')

reject_pattern = r"  const handleReject = async \(uid\) => \{.*?\n  \};\n\n  const handleToggleUpload"
reject_replacement = """  const handleReject = async (uid) => {
    try {
      const updated = await tenantPage.updateDistributorStatus(uid, 'pending');
      setDistributors(prev => prev.map(d => d.uid === uid ? updated : d));
      setSelDist(null);
      showToast('已撤銷資格');
    } catch (e) { showToast('操作失敗：' + (e?.message || ''), 'error'); }
  };

  const handleToggleUpload"""
dashboard = sub_once(dashboard, reject_pattern, reject_replacement, 'dashboard reject distributor')

upload_pattern = r"  const handleToggleUpload = async \(uid, canUp\) => \{.*?\n  \};\n\n  // ── 訂單狀態"
upload_replacement = """  const handleToggleUpload = async (uid, canUp) => {
    try {
      const updated = await tenantPage.updateDistributorUpload(uid, canUp);
      setDistributors(prev => prev.map(d => d.uid === uid ? updated : d));
      showToast(canUp ? '✅ 已授權上稿' : '已撤銷上稿權');
    } catch(e) { showToast('操作失敗：' + (e?.message || ''), 'error'); }
  };

  // ── 訂單狀態"""
dashboard = sub_once(dashboard, upload_pattern, upload_replacement, 'dashboard upload permission')

menu_pattern = r"  const handleMenuClick = \(item\) => \{\n    if \(item\.href\) \{\n      location\.href = item\.href;\n      return;\n    \}"
menu_replacement = """  const handleMenuClick = (item) => {
    if (item.href) {
      const target = new URL(item.href, location.href);
      if (target.origin === location.origin && !target.searchParams.has('tenant')) target.searchParams.set('tenant', tenantSlug);
      location.href = target.toString();
      return;
    }"""
dashboard = sub_once(dashboard, menu_pattern, menu_replacement, 'dashboard menu tenant')

dashboard = dashboard.replace('agencySlug="demo"', 'agencySlug={tenantSlug}')
dashboard = dashboard.replace("agencySlug: 'demo'", 'agencySlug: tenantSlug')
dashboard = dashboard.replace("params.set('a', 'demo');", "params.set('a', tenantSlug);")
dashboard = dashboard.replace("const url = `${base}index.html?invite=${code}`;", "const url = `${base}index.html?tenant=${encodeURIComponent(tenantSlug)}&invite=${encodeURIComponent(code)}`;")
dashboard = dashboard.replace("const profileRes = await fetchJson(`${WORKER_URL}/api/dist/profile?uid=${encodeURIComponent(userId)}`, null);\n      if (profileRes?.success) setDistData(profileRes.data);", "const profileData = await tenantPage.getProfile();\n      setDistData(withDefaultSocialLinks(profileData));")
write('dashboard.html', dashboard)


# -----------------------------------------------------------------------------
# Old admin page becomes a safe redirect to the canonical dashboard.
# -----------------------------------------------------------------------------
admin = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>前往租戶儀表板 | 旅遊管家</title>
  <meta http-equiv="Cache-Control" content="no-store">
</head>
<body>
<script>
(() => {
  const target = new URL('dashboard.html', location.href);
  const current = new URLSearchParams(location.search);
  current.forEach((value, key) => target.searchParams.set(key, value));
  target.hash = location.hash || '';
  location.replace(target.toString());
})();
</script>
<noscript><a href="dashboard.html">前往儀表板</a></noscript>
</body>
</html>
"""
write('admin.html', admin)


# -----------------------------------------------------------------------------
# CRM
# -----------------------------------------------------------------------------
crm = read('crm.html')
crm = replace_once(
    crm,
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n',
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n  <script src="./js/tenant-api-client.js"></script>\n  <script src="./js/tenant-page-client.js"></script>\n',
    'crm scripts',
)
crm = replace_once(
    crm,
    "    const LIFF_ID = '2009367829-BDZCGti8';\n",
    "    const LIFF_ID = '2009367829-BDZCGti8';\n    const tenantPage = window.TravelKeeperTenantPage;\n    const tenantSlug = tenantPage.tenantSlug;\n",
    'crm constants',
)
crm = sub_once(
    crm,
    r"    async function fetchJson\(url, options, fallback = null\) \{.*?\n    \}",
    """    async function fetchJson(url, options, fallback = null) {
      try {
        const parsed = new URL(url, WORKER_URL);
        return await tenantPage.legacyApi(`${parsed.pathname}${parsed.search}`, options || {});
      } catch (error) {
        if (fallback !== null) return fallback;
        throw error;
      }
    }""",
    'crm fetchJson',
)
merge_marker = "    function mergeCustomers(lineThreads, orders, profiles = []) {\n"
tenant_customer_fn = """    function normalizeTenantCustomer(row) {
      return {
        id: row.customer_id || `tenant:${row.customer_phone}`,
        source: 'order',
        lineThreadId: '',
        profileId: row.customer_id || '',
        name: row.customer_name || '訂單客戶',
        pictureUrl: '',
        userId: row.customer_line_uid || '',
        phone: row.customer_phone || '',
        email: row.email || '',
        birthday: '', address: '', identityNote: '', preferenceNote: '', tabooNote: '', privacyConsent: '',
        refUid: row.owner_uid || '', inviteCode: '', referralNote: '',
        status: 'closed', risk: 'low', opportunityStage: Number(row.total_orders || 0) > 0 ? 'won' : 'new',
        opportunityValue: Number(row.total_amount || 0), opportunityNote: '', summary: '', note: row.note || '',
        tags: [], visitorRecords: [], latestRecord: null, lastMessageAt: row.last_order_at || '', orders: [],
      };
    }

    function mergeCustomers(lineThreads, orders, profiles = [], tenantCustomers = []) {
"""
crm = replace_once(crm, merge_marker, tenant_customer_fn, 'crm tenant customer function')
crm = replace_once(
    crm,
    "      profiles.forEach(profileData => {\n",
    "      tenantCustomers.forEach(row => {\n        const customer = normalizeTenantCustomer(row);\n        map.set(customer.id, customer);\n      });\n      profiles.forEach(profileData => {\n",
    'crm seed tenant customers',
)
load_pattern = r"    async function loadCrm\(\) \{.*?\n    \}\n\n    function applyFilters"
load_replacement = """    async function loadCrm() {
      if (!profile?.userId) throw new Error('尚未取得管理員身分');
      if (crmLoading) return;
      crmLoading = true;
      els.loadButton.disabled = true;
      els.loadButton.classList.add('opacity-60', 'cursor-not-allowed');
      try {
        els.loadState.textContent = '正在載入租戶客戶與訂單資料...';
        const [tenantCustomers, orderRows] = await Promise.all([
          tenantPage.listCustomers(),
          tenantPage.listOrders(),
        ]);
        let lineThreads = [];
        let profileRows = [];
        if (tenantSlug === 'demo') {
          const [crmPayload, profilePayload] = await Promise.all([
            fetchJson(`${WORKER_URL}/api/line-oa/crm?uid=${encodeURIComponent(profile.userId)}`, null, { data: [] }),
            fetchJson(`${WORKER_URL}/api/line-oa/customer-profiles?uid=${encodeURIComponent(profile.userId)}`, null, { data: [] }),
          ]);
          lineThreads = Array.isArray(crmPayload?.data) ? crmPayload.data : [];
          profileRows = Array.isArray(profilePayload?.data) ? profilePayload.data : [];
        }
        customers = mergeCustomers(lineThreads, orderRows, profileRows, tenantCustomers);
        applyFilters();
        els.loadState.textContent = `已載入 ${customers.length} 筆客戶、${orderRows.length} 筆訂單｜租戶 ${tenantSlug}`;
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

    function applyFilters"""
crm = sub_once(crm, load_pattern, load_replacement, 'crm load')
crm = replace_once(
    crm,
    "    async function saveCustomerProfile(customer) {\n      if (!profile?.userId) throw new Error('尚未取得管理員身分');\n",
    "    async function saveCustomerProfile(customer) {\n      if (!profile?.userId) throw new Error('尚未取得管理員身分');\n      if (tenantSlug !== 'demo') throw new Error('非 demo 租戶的 CRM 個資編輯將於下一階段啟用');\n",
    'crm profile guard',
)
crm = sub_once(
    crm,
    r"    async function init\(\) \{.*?\n    \}\n\n    \['input', 'change'\]",
    """    async function init() {
      const session = await tenantPage.initLiffSession({ fallbackLiffId: LIFF_ID, requireContext: true });
      profile = session.profile;
      const role = String(session.context?.role || '');
      if (!['platform_admin', 'tenant_admin', 'support'].includes(role)) throw new Error('TENANT_ROLE_DENIED');
      document.querySelectorAll('a[href="./dashboard.html"]').forEach(link => {
        link.href = `./dashboard.html?tenant=${encodeURIComponent(tenantSlug)}`;
      });
      await loadCrm();
    }

    ['input', 'change']""",
    'crm init',
)
write('crm.html', crm)


# -----------------------------------------------------------------------------
# Pay balance customer page
# -----------------------------------------------------------------------------
pay = read('Pay balance.html')
pay = replace_once(
    pay,
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n',
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n  <script src="./js/tenant-api-client.js"></script>\n  <script src="./js/tenant-page-client.js"></script>\n',
    'pay scripts',
)
pay = replace_once(
    pay,
    "  const LIFF_ID    = '2009367829-BDZCGti8';\n",
    "  const LIFF_ID    = '2009367829-BDZCGti8';\n  const tenantPage = window.TravelKeeperTenantPage;\n  const tenantSlug = tenantPage.tenantSlug;\n",
    'pay constants',
)
pay = sub_once(
    pay,
    r"    // 1\. LIFF init \+ login\n    let profile;\n    try \{.*?\n    \}\n\n    // 2\. 拿訂單",
    """    // 1. 租戶 LIFF init + login
    try {
      await tenantPage.initLiffSession({ fallbackLiffId: LIFF_ID, requireContext: false });
    } catch (e) {
      if (String(e?.message || '') === 'LIFF_LOGIN_REQUIRED') return;
      console.error('LIFF init/login failed:', e);
      render(pageError('LINE 登入失敗', e.message || '請使用 LINE 應用程式開啟此連結', true));
      return;
    }

    // 2. 拿訂單""",
    'pay liff',
)
pay = sub_once(
    pay,
    r"      const res = await fetch\(\n        `\$\{WORKER_URL\}/api/orders/status\?order_id=\$\{encodeURIComponent\(orderId\)\}&customer_line_uid=\$\{encodeURIComponent\(profile\.userId\)\}`\n      \);\n      const result = await res\.json\(\);\n      if \(!result\.success\) \{\n        if \(res\.status === 403\)",
    """      const result = await tenantPage.getOrderStatus(orderId);
      if (!result.success) {
        if (result.status === 403)""",
    'pay order status',
)
pay = pay.replace("} else if (res.status === 404) {", "} else if (result.status === 404) {")
pay = sub_once(
    pay,
    r"        const payRes = await fetch\(`\$\{WORKER_URL\}/api/payment/create`, \{.*?\n        \}\);\n        const payResult = await payRes\.json\(\);",
    "        const payResult = await tenantPage.createPayment(orderId, 'balance');",
    'pay create payment',
)
write('Pay balance.html', pay)


# -----------------------------------------------------------------------------
# Thank-you page now requires tenant LIFF authentication before polling.
# -----------------------------------------------------------------------------
thanks = read('Thank you.html')
thanks = replace_once(
    thanks,
    '  <script src="https://cdn.tailwindcss.com"></script>\n',
    '  <script src="https://cdn.tailwindcss.com"></script>\n  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n  <script src="./js/tenant-api-client.js"></script>\n  <script src="./js/tenant-page-client.js"></script>\n',
    'thank scripts',
)
thanks = replace_once(
    thanks,
    "const WORKER_URL = 'https://travelkeeper-worker.fangwl591021.workers.dev';\n",
    "const WORKER_URL = 'https://travelkeeper-worker.fangwl591021.workers.dev';\n  const LIFF_ID = '2009367829-BDZCGti8';\n  const tenantPage = window.TravelKeeperTenantPage;\n  const tenantSlug = tenantPage.tenantSlug;\n",
    'thank constants',
)
thanks = sub_once(
    thanks,
    r"      const res = await fetch\(`\$\{WORKER_URL\}/api/orders/status\?order_id=\$\{encodeURIComponent\(orderId\)\}`\);\n      const result = await res\.json\(\);",
    "      const result = await tenantPage.getOrderStatus(orderId);",
    'thank status',
)
thanks = replace_once(
    thanks,
    "  poll();\n",
    "  (async () => {\n    try {\n      await tenantPage.initLiffSession({ fallbackLiffId: LIFF_ID, requireContext: false });\n      poll();\n    } catch (error) {\n      if (String(error?.message || '') !== 'LIFF_LOGIN_REQUIRED') render(pageError(error?.message || 'LINE 登入失敗'));\n    }\n  })();\n",
    'thank init',
)
write('Thank you.html', thanks)


# -----------------------------------------------------------------------------
# model.html public/member page
# -----------------------------------------------------------------------------
model = read('model.html')
model = replace_once(
    model,
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n',
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n  <script src="./js/tenant-api-client.js"></script>\n  <script src="./js/tenant-page-client.js"></script>\n',
    'model scripts',
)
model = replace_once(
    model,
    "const LIFF_ID      = '2009367829-BDZCGti8';\n",
    "const LIFF_ID      = '2009367829-BDZCGti8';\nconst tenantPage = window.TravelKeeperTenantPage;\nconst tenantSlug = tenantPage.tenantSlug;\n",
    'model constants',
)
model = sub_once(
    model,
    r"  // ── 初始化 .*?\n  useEffect\(\(\) => \{.*?\n  \}, \[\]\);",
    """  // ── 初始化 ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const tenantResult = await tenantPage.apiCall('/api/v2/tenant/public', { public: true });
        await liff.init({ liffId: tenantResult.data?.liff_id || LIFF_ID, withLoginOnExternalBrowser: true });
        if (liff.isLoggedIn()) {
          const p = await liff.getProfile();
          setLiffProfile(p);
          await checkAuth(p.userId);
        }
      } catch(e) { console.error('LIFF', e); }
      await fetchData();
    })();
  }, []);""",
    'model init',
)
model = sub_once(
    model,
    r"  const checkAuth = async \(uid\) => \{.*?\n  \};\n\n  const fetchData",
    """  const checkAuth = async (uid) => {
    try {
      const response = await tenantPage.apiCall('/api/v2/tenant/context');
      const ctx = response.data || {};
      const role = String(ctx.role || '');
      if (['platform_admin', 'tenant_admin'].includes(role)) setIsAdmin(true);
      if (['sales', 'editor'].includes(role)) {
        setDistStatus('approved');
        const profileData = tenantPage.profileAliases(ctx.profile || {});
        setDistData(profileData);
        setProfileForm(profileData);
        fetchDistStats(uid);
      }
      fetchUserOrders(uid);
    } catch(e) { console.warn('tenant context unavailable', e?.message || e); }
  };

  const fetchData""",
    'model check auth',
)
model = sub_once(
    model,
    r"  const fetchData = async \(\) => \{.*?\n  \};\n\n  const fetchUserOrders",
    """  const fetchData = async () => {
    setIsLoading(true);
    try {
      const items = await tenantPage.listPublicItineraries();
      setItineraries(items);
      setFilteredResults(items);
    } catch(e) { showToast('資料讀取失敗', 'error'); }
    setIsLoading(false);
  };

  const fetchUserOrders""",
    'model public itineraries',
)
model = sub_once(
    model,
    r"  const fetchUserOrders = async \(uid\) => \{.*?\n  \};\n\n  const fetchDistStats",
    """  const fetchUserOrders = async (uid) => {
    try {
      const data = await tenantPage.legacyApi(`/api/itineraries?action=getUserOrders&uid=${encodeURIComponent(uid)}`);
      if (data.success) setMyOrders((data.data || []).map(tenantPage.normalizeOrder));
    } catch(e) {}
  };

  const fetchDistStats""",
    'model user orders',
)
model = sub_once(
    model,
    r"  const fetchDistStats = async \(uid\) => \{.*?\n  \};\n\n  const fetchCrmData",
    """  const fetchDistStats = async (uid) => {
    try {
      const [orders, users] = await Promise.all([tenantPage.listOrders(), tenantPage.listCustomers()]);
      setDistStats({ users, orders });
    } catch(e) {}
  };

  const fetchCrmData""",
    'model stats',
)
model = sub_once(
    model,
    r"  const fetchCrmData = async \(\) => \{.*?\n  \};\n\n  const handleApproval",
    """  const fetchCrmData = async () => {
    try { setCrmList(await tenantPage.listDistributors()); } catch(e) {}
  };

  const handleApproval""",
    'model distributor list',
)
model = sub_once(
    model,
    r"  const handleApproval = async \(uid, status\) => \{.*?\n  \};",
    """  const handleApproval = async (uid, status) => {
    try {
      await tenantPage.updateDistributorStatus(uid, status);
      showToast(status==='approved' ? '已核准' : '已撤銷');
      fetchCrmData();
    } catch(e) { showToast('操作失敗','error'); }
  };""",
    'model distributor approval',
)
model = sub_once(
    model,
    r"  const saveProfile = async \(\) => \{.*?\n  \};",
    """  const saveProfile = async () => {
    try {
      const saved = await tenantPage.updateProfile(profileForm);
      setDistData(saved);
      showToast('名片資料已儲存');
      setProfileModal(false);
    } catch(e) { showToast('儲存失敗','error'); }
  };""",
    'model profile save',
)
model = model.replace("`${ENDPOINT_URL}?t=${id}&r=${uid}`", "`${ENDPOINT_URL}?tenant=${encodeURIComponent(tenantSlug)}&t=${id}&r=${uid}`")
write('model.html', model)


# -----------------------------------------------------------------------------
# Static regression tests and docs
# -----------------------------------------------------------------------------
test = r"""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Phase 10 Worker routes tenant page APIs before the generic V2 router', async () => {
  const worker = await read('worker-tenant.js');
  assert.match(worker, /tenant-order-actions-api/);
  assert.match(worker, /tenant-profile-api/);
  assert.match(worker, /tenant-distributor-api/);
  assert.ok(worker.indexOf('isTenantOrderActionRequest(request)') < worker.indexOf('isTenantApiRequest(request)'));
  assert.match(worker, /X-TravelKeeper-Tenant-Isolation', 'phase10'/);
});

test('shared page client uses tenant Bearer APIs and normalizes legacy views', async () => {
  const source = await read('js/tenant-page-client.js');
  assert.match(source, /initLiffSession/);
  assert.match(source, /\/api\/v2\/orders/);
  assert.match(source, /\/api\/v2\/customers/);
  assert.match(source, /\/api\/v2\/tenant\/profile/);
  assert.match(source, /\/api\/v2\/distributors/);
  assert.match(source, /contact_phone \|\| row\.customer_phone/);
  assert.doesNotMatch(source, /dev_uid.*DEFAULT_WORKER_URL/s);
});

test('canonical dashboard loads tenant clients and no longer uses uid-only core customer/order calls', async () => {
  const page = await read('dashboard.html');
  assert.match(page, /tenant-api-client\.js/);
  assert.match(page, /tenant-page-client\.js/);
  assert.match(page, /tenantPage\.initLiffSession/);
  assert.match(page, /tenantPage\.listOrders/);
  assert.match(page, /tenantPage\.listCustomers/);
  assert.match(page, /tenantPage\.markBalancePaid/);
  assert.match(page, /tenantPage\.updateDistributorStatus/);
  assert.doesNotMatch(page, /api\/my\/customers\?uid=/);
  assert.doesNotMatch(page, /action=getUserOrders&uid=\$\{userId\}/);
  assert.doesNotMatch(page, /action:'updateOrderStatus'/);
});

test('old admin page redirects to the canonical tenant dashboard', async () => {
  const page = await read('admin.html');
  assert.match(page, /dashboard\.html/);
  assert.match(page, /location\.replace/);
  assert.doesNotMatch(page, /action=getAllOrders/);
});

test('CRM combines tenant customer/order APIs and keeps global LINE CRM demo-only', async () => {
  const page = await read('crm.html');
  assert.match(page, /tenantPage\.listCustomers/);
  assert.match(page, /tenantPage\.listOrders/);
  assert.match(page, /tenantSlug === 'demo'/);
  assert.match(page, /tenantPage\.initLiffSession/);
});

test('customer payment pages require tenant LIFF authentication', async () => {
  const balance = await read('Pay balance.html');
  const thanks = await read('Thank you.html');
  for (const page of [balance, thanks]) {
    assert.match(page, /tenant-api-client\.js/);
    assert.match(page, /tenant-page-client\.js/);
    assert.match(page, /tenantPage\.initLiffSession/);
    assert.match(page, /tenantPage\.getOrderStatus/);
  }
  assert.match(balance, /tenantPage\.createPayment\(orderId, 'balance'\)/);
  assert.doesNotMatch(thanks, /fetch\(`\$\{WORKER_URL\}\/api\/orders\/status/);
});

test('model page uses tenant public itineraries and tenant staff APIs', async () => {
  const page = await read('model.html');
  assert.match(page, /tenantPage\.listPublicItineraries/);
  assert.match(page, /tenantPage\.listDistributors/);
  assert.match(page, /tenantPage\.updateProfile/);
  assert.match(page, /tenant=\$\{encodeURIComponent\(tenantSlug\)\}/);
});

test('tenant order, profile and distributor modules are tenant scoped', async () => {
  const order = await read('lib/tenant-order-actions-api.js');
  const profile = await read('lib/tenant-profile-api.js');
  const distributors = await read('lib/tenant-distributor-api.js');
  assert.match(order, /WHERE tenant_slug = \? AND order_id = \?/);
  assert.match(profile, /ON CONFLICT\(tenant_slug, user_uid\)/);
  assert.match(distributors, /WHERE m\.tenant_slug = \?/);
});
"""
write('tests/tenant-page-migration.test.mjs', test)

docs = """# TravelKeeper Phase 10：租戶化頁面與 Bearer Token

## 完成範圍

- `dashboard.html`：身份與核心客戶／訂單／行程／分銷商資料改用租戶 V2 API。
- `admin.html`：改為保留 tenant/query/hash 的安全轉址，避免維護兩套後台。
- `crm.html`：客戶與訂單改讀 V2；全域 LINE CRM 僅保留 demo 使用。
- `model.html`：公開行程走 V2，登入後的訂單、名片與分銷商管理走租戶 API。
- `Pay balance.html`：租戶 LIFF 驗證後查訂單及建立尾款付款。
- `Thank you.html`：租戶 LIFF 驗證後才可輪詢付款狀態。

## 共用 Browser Client

`js/tenant-page-client.js` 統一處理：

- tenant slug
- localhost-only Worker override
- LINE Access Token / local dev UID
- 客戶與訂單欄位相容
- V2 訂單、客戶、付款、行程、個人資料及分銷商 API

## 新增後端 API

- `POST /api/v2/orders/{order_id}/balance-paid`
- `GET/POST /api/v2/tenant/profile`
- `GET /api/v2/distributors`
- `POST /api/v2/distributors/{uid}/status`
- `POST /api/v2/distributors/{uid}/upload`

## 安全邊界

- 顧客付款頁不再只靠 order id 讀取資料。
- 非 demo CRM 不讀全域 LINE OA CRM。
- Dashboard 核心資料不再以 uid query 作為身份依據。
- `admin.html` 不再保留另一套 uid-only 後台。

## 尚未完成

- 非 demo LINE OA 對話與 CRM profile 的 tenant schema。
- 行程寫入、審核與部分內部營運頁的全面 V2 化。
- 正式 CORS allowlist。
- 最終 customers 表重建及移除舊 phone primary key。
"""
write('docs/tenant-pages-phase10.md', docs)


# -----------------------------------------------------------------------------
# CI workflow
# -----------------------------------------------------------------------------
ci = read('.github/workflows/tenant-isolation-check.yml')
ci = replace_once(
    ci,
    "          node --check lib/legacy-customer-compat-api.js\n",
    "          node --check lib/legacy-customer-compat-api.js\n          node --check lib/tenant-order-actions-api.js\n          node --check lib/tenant-profile-api.js\n          node --check lib/tenant-distributor-api.js\n          node --check js/tenant-page-client.js\n",
    'ci syntax additions',
)
ci = replace_once(
    ci,
    "      - name: Run existing tenant tests\n",
    "      - name: Run Phase 10 page migration tests\n        run: node --test tests/tenant-page-migration.test.mjs\n\n      - name: Run existing tenant tests\n",
    'ci Phase 10 test step',
)
write('.github/workflows/tenant-isolation-check.yml', ci)

print('Phase 10 patches applied successfully')
