// ============================================================
// TravelKeeper BFF Worker
// 職責：聚合 API、組裝 Flex Message、R2 圖片上傳、AI 解析、訂單建立
// 前端只需打一支 API 拿到所需全部資料
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const ADMIN_UIDS = new Set([
  'Uf729764dbb5b652a5a90a467320bea29',
  'U58eb5c1a747450140ce1335af709ae55',
]);
const R2_PUBLIC = 'https://pub-b644db8c22784d969cb4cc93b099d3df.r2.dev';
const ENDPOINT  = 'https://fangwl591021.github.io/travelkeeper/';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const gasGet  = (env, params) => fetch(`${env.GAS_WEBAPP_URL}?${new URLSearchParams(params)}`, { redirect: 'follow' }).then(r => r.json());
const gasPost = (env, body)   => fetch(env.GAS_WEBAPP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'follow' }).then(r => r.json());

async function d1GetConfig(env, slug = 'demo') {
  if (!env.DB) throw new Error('D1 binding missing');
  const row = await env.DB.prepare(
    `SELECT slug, name, liff_id FROM tenants WHERE slug = ?`
  ).bind(slug).first();

  if (!row) return { success: false, error: 'TENANT_NOT_FOUND' };
  return { success: true, data: row };
}

async function d1ResolveInviteCode(env, code) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return { success: false, error: 'MISSING_CODE' };

  const row = await env.DB.prepare(
    `SELECT uid, name, invite_code AS inviteCode
       FROM distributors
      WHERE invite_code = ?`
  ).bind(normalized).first();

  if (!row) return { success: false, error: 'INVITE_CODE_NOT_FOUND' };
  return { success: true, data: row };
}

async function readConfigWithFallback(env, slug = 'demo') {
  if (env.DB) {
    try {
      const result = await d1GetConfig(env, slug);
      if (result?.success) return result;
      console.warn('[D1->GAS fallback] getConfig miss:', result?.error || 'unknown');
    } catch (err) {
      console.warn('[D1->GAS fallback] getConfig error:', err.message);
    }
  }
  return gasGet(env, { action: 'getConfig', a: slug });
}

async function resolveInviteCodeWithFallback(env, code) {
  if (env.DB) {
    try {
      const result = await d1ResolveInviteCode(env, code);
      if (result?.success) return result;
      console.warn('[D1->GAS fallback] resolveInviteCode miss:', result?.error || 'unknown');
    } catch (err) {
      console.warn('[D1->GAS fallback] resolveInviteCode error:', err.message);
    }
  }
  return gasGet(env, { action: 'resolveInviteCode', code });
}

async function d1CheckUserStatus(env, uid) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return { success: false, error: 'MISSING_UID' };

  const row = await env.DB.prepare(
    `SELECT * FROM distributors WHERE uid = ?`
  ).bind(normalizedUid).first();

  const isAdmin = ADMIN_UIDS.has(normalizedUid);
  const status = String(row?.status || '').toLowerCase();
  const normalizedStatus = status === 'active' ? 'approved' : status;
  const distCanUpload = !!Number(row?.can_upload || 0);

  return {
    success: true,
    data: {
      isAdmin,
      canUpload: isAdmin || distCanUpload,
      role: row ? 'distributor' : 'guest',
      status: row ? normalizedStatus : null,
      distributorData: row ? {
        name: row.name || '',
        phone: row.phone || '',
        status: normalizedStatus || '',
        commission: row.commission_pct || '',
        canUpload: distCanUpload,
        inviteCode: row.invite_code || '',
        lineLink: row.line_link || '',
        lineAtLink: row.line_at_link || '',
        fbLink: row.fb_link || '',
        webLink: row.web_link || '',
        mapLink: row.map_link || '',
        tgToken: row.tg_token || '',
        tgChatId: row.tg_chat_id || '',
      } : null,
    },
  };
}

async function readCheckUserStatusWithFallback(env, uid) {
  if (env.DB) {
    try {
      return await d1CheckUserStatus(env, uid);
    } catch (err) {
      console.warn('[D1->GAS fallback] checkUserStatus error:', err.message);
    }
  }
  return gasGet(env, { action: 'checkUserStatus', uid });
}

async function d1GetAgentPublicProfile(env, { code = '', uid = '' } = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedUid = String(uid || '').trim();
  if (!normalizedCode && !normalizedUid) {
    return { success: false, error: 'MISSING_CODE_OR_UID' };
  }

  const row = normalizedCode
    ? await env.DB.prepare(
        `SELECT * FROM distributors WHERE invite_code = ?`
      ).bind(normalizedCode).first()
    : await env.DB.prepare(
        `SELECT * FROM distributors WHERE uid = ?`
      ).bind(normalizedUid).first();

  if (!row) return { success: false, error: 'AGENT_NOT_FOUND' };
  if (!['approved', 'active'].includes(String(row.status || '').toLowerCase())) {
    return { success: false, error: 'AGENT_NOT_APPROVED' };
  }

  return {
    success: true,
    data: {
      name: row.name || '',
      inviteCode: row.invite_code || '',
      phone: row.phone || '',
      avatar: row.avatar || '',
      bio: row.bio || '',
      oaIntro: row.oa_intro || '',
      agencySlug: row.agency_slug || '',
      lineLink: row.line_link || '',
      lineAtLink: row.line_at_link || '',
      lineAtId: row.line_at_id || '',
      fbLink: row.fb_link || '',
      igLink: row.ig_link || '',
      webLink: row.web_link || '',
      mapLink: row.map_link || '',
    },
  };
}

async function readAgentPublicProfileWithFallback(env, { code = '', uid = '' } = {}) {
  if (env.DB) {
    try {
      const result = await d1GetAgentPublicProfile(env, { code, uid });
      if (result?.success) return result;
      console.warn('[D1->GAS fallback] getAgentPublicProfile miss:', result?.error || 'unknown');
    } catch (err) {
      console.warn('[D1->GAS fallback] getAgentPublicProfile error:', err.message);
    }
  }

  const params = { action: 'getAgentPublicProfile' };
  if (code) params.code = code;
  if (uid) params.uid = uid;
  return gasGet(env, params);
}

function toSheetItinerary(row) {
  return {
    id: row.id,
    timestamp: row.id,
    title: row.title,
    region: row.region,
    price: row.price,
    days: row.days,
    image: row.image,
    description: row.description,
    notes: row.notes,
    owneruid: row.owner_uid,
    ownername: row.owner_name,
    reviewstatus: row.review_status,
    reviewnote: row.review_note,
    paymentmode: row.payment_mode,
    depositratio: row.deposit_ratio,
    balancecollect: row.balance_collect,
    created: row.created_at,
    updatedat: row.updated_at,
  };
}

async function d1GetItineraries(env, params = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const owner = String(params.owner || '').trim();
  const all = String(params.all || '') === '1';

  let query = `
    SELECT *
      FROM itineraries
     WHERE (deleted_at IS NULL OR deleted_at = '')
  `;
  const bind = [];

  if (owner) {
    query += ' AND owner_uid = ?';
    bind.push(owner);
  } else if (!all) {
    query += ` AND review_status = 'published'`;
  }

  query += ' ORDER BY created_at DESC';
  const { results } = await env.DB.prepare(query).bind(...bind).all();
  return results.map(toSheetItinerary);
}

async function readItinerariesWithFallback(env, params = {}) {
  const normalized = { ...params };
  delete normalized.action;

  if (env.DB) {
    try {
      return await d1GetItineraries(env, normalized);
    } catch (err) {
      console.warn('[D1->GAS fallback] getItineraries error:', err.message);
    }
  }
  return gasGet(env, { action: 'getItineraries', ...normalized });
}

function toSheetOrder(row) {
  return {
    orderid: row.order_id,
    itineraryid: row.itinerary_id,
    itinerarytitle: row.itinerary_title,
    price: row.price,
    distributoruid: row.distributor_uid,
    customername: row.customer_name,
    customerphone: row.customer_phone,
    customerlineuid: row.customer_line_uid,
    travelers: row.travelers,
    traveldate: row.travel_date,
    note: row.note,
    status: row.status,
    commissionamount: row.commission_amount,
    totalamount: row.total_amount,
    depositamount: row.deposit_amount,
    balanceamount: row.balance_amount,
    paymentmode: row.payment_mode,
    balancecollect: row.balance_collect,
    depositstatus: row.deposit_status,
    depositpaidat: row.deposit_paid_at,
    depositmethod: row.deposit_method,
    deposittradeno: row.deposit_trade_no,
    balancestatus: row.balance_status,
    balancepaidat: row.balance_paid_at,
    balancemethod: row.balance_method,
    balancetradeno: row.balance_trade_no,
    commissionstatus: row.commission_status,
    commissionsettledat: row.commission_settled_at,
    commissionpaidoutat: row.commission_paid_out_at,
    createdat: row.created_at,
    updatedat: row.updated_at,
  };
}

function toSheetCustomer(row) {
  return {
    customerphone: row.customer_phone,
    customername: row.customer_name,
    customerlineuid: row.customer_line_uid,
    owneruid: row.owner_uid,
    ownername: row.owner_name,
    firstorderat: row.first_order_at,
    lastorderat: row.last_order_at,
    totalorders: row.total_orders,
    totalamount: row.total_amount,
    source: row.source,
    note: row.note,
  };
}

function toSheetDistributor(row) {
  const status = String(row.status || '').toLowerCase() === 'active'
    ? 'approved'
    : String(row.status || 'pending').toLowerCase();

  return {
    uid: row.uid,
    name: row.name || '',
    phone: row.phone || '',
    companyname: row.company_name || '',
    taxid: row.tax_id || '',
    linelink: row.line_link || '',
    lineatlink: row.line_at_link || '',
    lineatid: row.line_at_id || '',
    fblink: row.fb_link || '',
    iglink: row.ig_link || '',
    weblink: row.web_link || '',
    maplink: row.map_link || '',
    tgtoken: row.tg_token || '',
    tgchatid: row.tg_chat_id || '',
    avatar: row.avatar || '',
    bio: row.bio || '',
    oaintro: row.oa_intro || '',
    bankaccount: row.bank_account || '',
    bankname: row.bank_name || '',
    bankbranch: row.bank_branch || '',
    bankholder: row.bank_holder || '',
    status,
    commission: row.commission_pct || 0,
    note: row.note || '',
    salesrevenue: row.sales_revenue || 0,
    joindate: row.joined_at || '',
    ref_uid: row.ref_uid || '',
    agencyslug: row.agency_slug || 'demo',
    canupload: Number(row.can_upload || 0) ? 'Y' : 'N',
    invitecode: row.invite_code || '',
    email: row.email || '',
  };
}

async function d1GetDistributors(env) {
  if (!env.DB) throw new Error('D1 binding missing');
  const { results } = await env.DB.prepare(
    `SELECT *
       FROM distributors
      ORDER BY created_at DESC`
  ).all();
  return results.map(toSheetDistributor);
}

const DISTRIBUTOR_EDITABLE_FIELDS = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  companyName: 'company_name',
  companyname: 'company_name',
  taxId: 'tax_id',
  taxid: 'tax_id',
  commission: 'commission_pct',
  note: 'note',
  lineLink: 'line_link',
  linelink: 'line_link',
  lineAtLink: 'line_at_link',
  lineatlink: 'line_at_link',
  fbLink: 'fb_link',
  fblink: 'fb_link',
  igLink: 'ig_link',
  iglink: 'ig_link',
  webLink: 'web_link',
  weblink: 'web_link',
  mapLink: 'map_link',
  maplink: 'map_link',
};

function buildDistributorUpdate(body = {}) {
  const updates = {};
  for (const [key, column] of Object.entries(DISTRIBUTOR_EDITABLE_FIELDS)) {
    if (body[key] !== undefined) updates[column] = body[key];
  }
  if (updates.commission_pct !== undefined) {
    updates.commission_pct = Number(updates.commission_pct) || 0;
  }
  for (const key of Object.keys(updates)) {
    if (updates[key] === null) updates[key] = '';
  }
  return updates;
}

async function syncDistributorToGas(env, uid, updates) {
  if (!env.GAS_WEBAPP_URL) return;
  const gasBody = { action: 'updateDistributorProfile', uid };
  const syncable = {
    phone: 'phone',
    email: 'email',
    line_link: 'lineLink',
    line_at_link: 'lineAtLink',
    fb_link: 'fbLink',
    ig_link: 'igLink',
    web_link: 'webLink',
    map_link: 'mapLink',
  };
  let hasSyncable = false;
  for (const [column, gasKey] of Object.entries(syncable)) {
    if (updates[column] !== undefined) {
      gasBody[gasKey] = updates[column];
      hasSyncable = true;
    }
  }
  if (!hasSyncable) return;
  try {
    await gasPost(env, gasBody);
  } catch (err) {
    console.warn('syncDistributorToGas failed:', err.message);
  }
}

async function d1UpdateDistributor(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const uid = String(body.uid || '').trim();
  if (!uid) return { success: false, error: 'MISSING_UID' };

  const updates = buildDistributorUpdate(body);
  if (Object.keys(updates).length === 0) {
    const row = await env.DB.prepare(`SELECT * FROM distributors WHERE uid = ?`).bind(uid).first();
    return row ? { success: true, data: toSheetDistributor(row) } : { success: false, error: 'DISTRIBUTOR_NOT_FOUND' };
  }

  const columns = Object.keys(updates);
  const sets = columns.map(column => `${column} = ?`);
  const values = columns.map(column => updates[column]);
  sets.push(`updated_at = datetime('now')`);

  const result = await env.DB.prepare(
    `UPDATE distributors SET ${sets.join(', ')} WHERE uid = ?`
  ).bind(...values, uid).run();

  if (!result.success) return { success: false, error: 'DISTRIBUTOR_UPDATE_FAILED' };

  const row = await env.DB.prepare(`SELECT * FROM distributors WHERE uid = ?`).bind(uid).first();
  if (!row) return { success: false, error: 'DISTRIBUTOR_NOT_FOUND' };

  await syncDistributorToGas(env, uid, updates);
  return { success: true, data: toSheetDistributor(row) };
}

async function readDistributorsWithFallback(env) {
  if (env.DB) {
    try {
      return await d1GetDistributors(env);
    } catch (err) {
      console.warn('[D1->GAS fallback] getDistributors error:', err.message);
    }
  }
  return gasGet(env, { action: 'getDistributors' });
}

async function d1GetAllOrders(env) {
  if (!env.DB) throw new Error('D1 binding missing');
  const { results } = await env.DB.prepare(
    `SELECT *
       FROM orders
      ORDER BY created_at DESC`
  ).all();
  return { success: true, data: results.map(toSheetOrder) };
}

async function readAllOrdersWithFallback(env) {
  if (env.DB) {
    try {
      return await d1GetAllOrders(env);
    } catch (err) {
      console.warn('[D1->GAS fallback] getAllOrders error:', err.message);
    }
  }
  return gasGet(env, { action: 'getAllOrders' });
}

async function d1GetPendingReviews(env) {
  if (!env.DB) throw new Error('D1 binding missing');
  const { results } = await env.DB.prepare(
    `SELECT *
       FROM itineraries
      WHERE (deleted_at IS NULL OR deleted_at = '')
        AND review_status = 'pending_review'
      ORDER BY created_at DESC`
  ).all();
  return { success: true, data: results.map(toSheetItinerary) };
}

async function readPendingReviewsWithFallback(env) {
  if (env.DB) {
    try {
      return await d1GetPendingReviews(env);
    } catch (err) {
      console.warn('[D1->GAS fallback] getPendingReviews error:', err.message);
    }
  }
  return gasGet(env, { action: 'getPendingReviews' });
}

async function d1GetCommissionSummary(env) {
  if (!env.DB) throw new Error('D1 binding missing');
  const { results } = await env.DB.prepare(
    `SELECT
       o.*,
       d.name AS distributor_name,
       d.phone AS distributor_phone,
       d.commission_pct AS distributor_commission_pct
     FROM orders o
     LEFT JOIN distributors d ON d.uid = o.distributor_uid
     WHERE o.distributor_uid <> ''
     ORDER BY o.created_at DESC`
  ).all();

  const groupBy = {};
  let totalPending = 0;
  let totalPayable = 0;
  let totalPaidOut = 0;

  for (const row of results) {
    const uid = String(row.distributor_uid || '');
    if (!uid) continue;
    const status = String(row.commission_status || 'pending').toLowerCase();
    const amt = Number(row.commission_amount || 0);

    if (!groupBy[uid]) {
      groupBy[uid] = {
        uid,
        name: row.distributor_name || '(未知)',
        phone: row.distributor_phone || '',
        commissionPct: Number(row.distributor_commission_pct || 0),
        payable: { count: 0, total: 0, orders: [] },
        pending: { count: 0, total: 0 },
        paid_out: { count: 0, total: 0 },
      };
    }

    const g = groupBy[uid];

    if (status === 'payable') {
      g.payable.count++;
      g.payable.total += amt;
      totalPayable += amt;
      g.payable.orders.push({
        order_id: row.order_id,
        itinerary_title: row.itinerary_title,
        customer_name: row.customer_name,
        total_amount: Number(row.total_amount || row.price || 0),
        commission_amount: amt,
        settled_at: row.commission_settled_at,
        deposit_paid_at: row.deposit_paid_at,
        balance_paid_at: row.balance_paid_at,
        balance_method: row.balance_method,
      });
    } else if (status === 'paid_out') {
      g.paid_out.count++;
      g.paid_out.total += amt;
      totalPaidOut += amt;
    } else {
      g.pending.count++;
      g.pending.total += amt;
      totalPending += amt;
    }
  }

  const groups = Object.values(groupBy)
    .filter(g => g.payable.count > 0 || g.pending.count > 0 || g.paid_out.count > 0)
    .sort((a, b) => b.payable.total - a.payable.total);

  return {
    success: true,
    data: {
      groups,
      totals: { pending: totalPending, payable: totalPayable, paid_out: totalPaidOut },
      generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    },
  };
}

async function readCommissionSummaryWithFallback(env, uid) {
  if (env.DB) {
    try {
      return await d1GetCommissionSummary(env);
    } catch (err) {
      console.warn('[D1->GAS fallback] getCommissionSummary error:', err.message);
    }
  }
  return gasGet(env, { action: 'getCommissionSummary', uid });
}

async function d1GetUserOrders(env, uid) {
  if (!env.DB) throw new Error('D1 binding missing');
  const { results } = await env.DB.prepare(
    `SELECT *
       FROM orders
      WHERE customer_line_uid = ?
         OR distributor_uid = ?
      ORDER BY created_at DESC`
  ).bind(uid, uid).all();

  return { success: true, data: results.map(toSheetOrder) };
}

async function readUserOrdersWithFallback(env, uid) {
  if (env.DB) {
    try {
      return await d1GetUserOrders(env, uid);
    } catch (err) {
      console.warn('[D1->GAS fallback] getUserOrders error:', err.message);
    }
  }
  return gasGet(env, { action: 'getUserOrders', uid });
}

async function d1GetMyCustomers(env, uid) {
  if (!env.DB) throw new Error('D1 binding missing');
  const { results } = await env.DB.prepare(
    `SELECT *
       FROM customers
      WHERE owner_uid = ?
      ORDER BY total_amount DESC`
  ).bind(uid).all();

  return { success: true, data: results.map(toSheetCustomer) };
}

async function readMyCustomersWithFallback(env, uid) {
  if (env.DB) {
    try {
      return await d1GetMyCustomers(env, uid);
    } catch (err) {
      console.warn('[D1->GAS fallback] getMyCustomers error:', err.message);
    }
  }
  return gasGet(env, { action: 'getMyCustomers', uid });
}

async function d1GetMyStats(env, uid) {
  if (!env.DB) throw new Error('D1 binding missing');
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartText = monthStart.toISOString().slice(0, 10);

  const total = await env.DB.prepare(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(total_amount), 0) AS revenue,
       COALESCE(SUM(commission_amount), 0) AS commission,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN commission_amount ELSE 0 END), 0) AS completedCommission
     FROM orders
     WHERE distributor_uid = ?
       AND status <> 'cancelled'`
  ).bind(uid).first();

  const month = await env.DB.prepare(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(total_amount), 0) AS revenue,
       COALESCE(SUM(commission_amount), 0) AS commission
     FROM orders
     WHERE distributor_uid = ?
       AND status <> 'cancelled'
       AND created_at >= ?`
  ).bind(uid, monthStartText).first();

  const customer = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM customers WHERE owner_uid = ?`
  ).bind(uid).first();

  return {
    success: true,
    data: {
      month: {
        count: Number(month?.count || 0),
        revenue: Number(month?.revenue || 0),
        commission: Number(month?.commission || 0),
      },
      total: {
        count: Number(total?.count || 0),
        revenue: Number(total?.revenue || 0),
        commission: Number(total?.commission || 0),
        completedCommission: Number(total?.completedCommission || 0),
      },
      customerCount: Number(customer?.count || 0),
    },
  };
}

async function readMyStatsWithFallback(env, uid) {
  if (env.DB) {
    try {
      return await d1GetMyStats(env, uid);
    } catch (err) {
      console.warn('[D1->GAS fallback] getMyStats error:', err.message);
    }
  }
  return gasGet(env, { action: 'getMyStats', uid });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    try {

      // ══════════════════════════════════════════════════════════
      // GET /api/app-init?uid=xxx
      // ★ 前端初始化一次打這支，拿到所有需要的資料
      //   回傳：{ itineraries, user, orders, distStats? }
      // ══════════════════════════════════════════════════════════
      if (path === '/api/app-init' && request.method === 'GET') {
        const uid = url.searchParams.get('uid');

        // 並行拉取：行程列表 + 用戶狀態
        const [itinRaw, userRaw] = await Promise.all([
          readItinerariesWithFallback(env, {}),
          uid ? readCheckUserStatusWithFallback(env, uid) : Promise.resolve(null),
        ]);

        const itineraries = Array.isArray(itinRaw) ? itinRaw : [];
        const user        = userRaw?.success ? userRaw.data : null;

        // 若是分銷商，額外拿業績；若是管理員，拿 CRM 名單
        let orders    = [];
        let distStats = null;
        let crmList   = [];

        if (uid && user) {
          const extras = await Promise.all([
            readUserOrdersWithFallback(env, uid),
            user.role === 'distributor'
              ? gasGet(env, { action: 'getDistributorPerformance', uid })
              : Promise.resolve(null),
            user.isAdmin
              ? readDistributorsWithFallback(env)
              : Promise.resolve(null),
          ]);
          orders    = extras[0]?.data || [];
          distStats = extras[1]?.success ? { users: extras[1].users || [], orders: extras[1].orders || [] } : null;
          crmList   = Array.isArray(extras[2]) ? extras[2] : [];
        }

        return json({ success: true, itineraries, user, orders, distStats, crmList });
      }

      // ══════════════════════════════════════════════════════════
      // POST /api/build-flex
      // POST /api/flex/build
      // ★ 前端傳入行程 IDs + 設定，Worker 回傳組裝好的 Flex JSON
      //   body: { ids / itineraryIds, mode, uid, ctaText, socFields, agencySlug, inviteCode }
      // ══════════════════════════════════════════════════════════
      if ((path === '/api/build-flex' || path === '/api/flex/build') && request.method === 'POST') {
        const body = await request.json();
        const {
          ids = [],
          itineraryIds = [],
          mode = 'single',
          uid = '',
          ctaText = '查看行程 / 立即報名',
          socFields = {},
          agencySlug = 'demo',
          inviteCode = '',
        } = body;
        const finalIds = (Array.isArray(itineraryIds) && itineraryIds.length > 0 ? itineraryIds : ids).map(String);

        // 拉取這幾筆行程
        const itinRaw = await readItinerariesWithFallback(env, {});
        const all     = Array.isArray(itinRaw) ? itinRaw : [];
        const items   = finalIds.map(id => all.find(i => String(i.id || i.timestamp || '') === String(id))).filter(Boolean);

        if (items.length === 0) return json({ success: false, error: '找不到指定行程' }, 400);

        // LIFF ID 從 config 拿，作為預約按鈕 URL 的一部分
        const cfgRes = await readConfigWithFallback(env, agencySlug);
        const liffId = cfgRes?.data?.liff_id || '';

        // 聯絡按鈕
        const SOC_DEFS = [
          { key: 'phone',      label: '電話',    prefix: 'tel:',  field: 'phone'      },
          { key: 'line',       label: 'LINE',    prefix: '',      field: 'lineLink'   },
          { key: 'lineAt',     label: 'LINE@',   prefix: '',      field: 'lineAtLink' },
          { key: 'fb',         label: 'Facebook',prefix: '',      field: 'fbLink'     },
          { key: 'web',        label: '網站',    prefix: '',      field: 'webLink'    },
          { key: 'map',        label: '地圖',    prefix: '',      field: 'mapLink'    },
          { key: 'tg',         label: 'Telegram',prefix: '',      field: 'tgToken'    },
        ];
        const socBtns = SOC_DEFS
          .filter(d => socFields[d.key] && socFields[d.field] !== undefined ? socFields[d.field] : socFields[d.field])
          .filter(d => {
            const val = socFields[d.field] || socFields[d.key];
            return !!val;
          })
          .map(d => {
            const raw = socFields[d.field] || socFields[d.key] || '';
            return { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: d.label, uri: d.prefix ? `${d.prefix}${raw}` : raw } };
          });

        // 預約按鈕 URL（LIFF）
        const inviteParam = inviteCode ? `&invite=${encodeURIComponent(inviteCode)}` : '';
        const buildBookingUri = (itineraryId) =>
          liffId
            ? `https://liff.line.me/${liffId}/booking.html?a=${agencySlug}&itinerary=${itineraryId}&ref=${uid}${inviteParam}`
            : `${ENDPOINT}booking.html?a=${agencySlug}&itinerary=${itineraryId}&ref=${uid}${inviteParam}`;

        // ★ 行程詳情頁 URL — 客戶瀏覽用 tour.html（純詳情頁，不是業務工具）
        const buildDetailUri = (itineraryId) =>
          `${ENDPOINT}tour.html?t=${itineraryId}&r=${uid}&a=${agencySlug}${inviteParam}`;

        // ── 單張 / 橫向輪播 用：完整大卡（hero 圖 + 詳細資訊 + 立即預約）
        const makeBubble = (tour) => {
          const id  = String(tour.id || tour.timestamp || '');
          const detailUri = buildDetailUri(id);
          const bookUri = buildBookingUri(id);
          return {
            type: 'bubble', size: 'mega',
            hero: { type: 'image', url: tour.image || 'https://via.placeholder.com/800x520', size: 'full', aspectRatio: '20:13', aspectMode: 'cover', action: { type: 'uri', uri: detailUri } },
            body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', contents: [
              { type: 'text', text: tour.title, weight: 'bold', size: 'lg', wrap: true, color: '#0f172a' },
              { type: 'text', text: `${tour.region || ''} · ${tour.days}天`, size: 'sm', color: '#64748b', margin: 'sm' },
              { type: 'text', text: `TWD ${Number(tour.price).toLocaleString()}`, weight: 'bold', size: 'xl', color: '#b82337', margin: 'md' },
            ]},
            footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
              { type: 'button', style: 'primary', color: '#b82337', height: 'md', action: { type: 'uri', label: '立即預約', uri: bookUri } },
              { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: ctaText, uri: detailUri } },
              ...socBtns
            ]}
          };
        };

        // ── 列表模式：完全照 LINE 官方 list bubble 範例結構
        //   每個行程 = 一個獨立的 box，內含：縮圖 + 標題 + 副資訊 + 價格
        //   ★ 方案 A：整塊點擊進「詳情頁」(model.html)，預約靠詳情頁裡的按鈕
        const makeListItem = (tour) => {
          const id  = String(tour.id || tour.timestamp || '');
          const detailUri = buildDetailUri(id);
          return {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            action: { type: 'uri', uri: detailUri },
            contents: [
              {
                type: 'image',
                url: tour.image || 'https://via.placeholder.com/200x150',
                size: 'sm',
                aspectRatio: '4:3',
                aspectMode: 'cover',
                flex: 2
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 5,
                contents: [
                  {
                    type: 'text',
                    text: tour.title || '行程',
                    weight: 'bold',
                    size: 'sm',
                    wrap: true,
                    color: '#0f172a'
                  },
                  {
                    type: 'text',
                    text: `${tour.region || ''}  ·  ${tour.days || ''}天`,
                    size: 'xs',
                    color: '#64748b',
                    margin: 'sm'
                  },
                  {
                    type: 'text',
                    text: `TWD ${Number(tour.price || 0).toLocaleString()}`,
                    weight: 'bold',
                    size: 'md',
                    color: '#b82337',
                    margin: 'sm'
                  }
                ]
              }
            ]
          };
        };

        let flex;
        if (mode === 'multi' || mode === 'list') {
          // ★ 列表模式：單一 bubble，每筆行程之間用 separator 分隔
          const itemContents = [];
          items.forEach((tour, idx) => {
            if (idx > 0) itemContents.push({ type: 'separator', margin: 'lg' });
            const wrapper = {
              type: 'box',
              layout: 'vertical',
              margin: idx === 0 ? 'none' : 'lg',
              contents: [makeListItem(tour)]
            };
            itemContents.push(wrapper);
          });

          const listBubble = {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#0f172a',
              paddingAll: '16px',
              contents: [
                { type: 'text', text: '✈️ 精選行程推薦', weight: 'bold', color: '#ffffff', size: 'lg' },
                { type: 'text', text: `共 ${items.length} 個行程`, color: '#94a3b8', size: 'sm', margin: 'xs' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'md',
              paddingAll: '16px',
              contents: itemContents
            }
          };

          if (socBtns.length) {
            listBubble.footer = {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '14px',
              contents: socBtns
            };
          }

          flex = {
            type: 'flex',
            altText: `精選行程推薦：${items[0].title} 等${items.length}條`,
            contents: listBubble
          };
        } else {
          const bubbles = items.map(makeBubble);
          flex = { type: 'flex', altText: `推薦行程：${items[0].title}`, contents: mode === 'carousel' ? { type: 'carousel', contents: bubbles } : bubbles[0] };
        }

        return json({ success: true, flex, message: flex, count: items.length });
      }

      // ══════════════════════════════════════════════════════════
      // POST /api/orders/create
      // ★ booking.html 送出預約 → 寫 Sheets → 發 Telegram 給分銷商
      //   body: { itinerary_id, distributor_uid, customer_*, travelers, travel_date, note }
      // ══════════════════════════════════════════════════════════
      if (path === '/api/orders/create' && request.method === 'POST') {
        const body       = await request.json();
        const agencySlug = url.searchParams.get('a') || 'demo';

        // 基本驗證
        const required = ['itinerary_id', 'distributor_uid', 'customer_name', 'customer_phone'];
        for (const f of required) {
          if (!body[f]) return json({ success: false, error: `缺少欄位：${f}` }, 400);
        }

        // 1. 呼叫 GAS 寫訂單（GAS 端會查行程、查分銷商、算佣金、寫 Orders）
        const result = await gasPost(env, {
          action: 'createOrder',
          agency_slug: agencySlug,
          itinerary_id: body.itinerary_id,
          distributor_uid: body.distributor_uid,
          customer_line_uid: body.customer_line_uid || '',
          customer_name: body.customer_name,
          customer_phone: body.customer_phone,
          travelers: Number(body.travelers) || 1,
          travel_date: body.travel_date || '',
          note: body.note || '',
        });

        if (!result.success) {
          return json({ success: false, error: result.error || '訂單建立失敗' }, 500);
        }

        // 2. 發 Telegram 通知（用該分銷商自己的 Bot；失敗不擋訂單）
        const dist  = result.data.distributor;
        const order = result.data.order;
        const tgToken  = dist?.tgToken  || dist?.tgtoken  || '';
        const tgChatId = dist?.tgChatId || dist?.tgchatid || '';
        if (tgToken && tgChatId) {
          try {
            await sendTelegramNotification(tgToken, tgChatId, order);
          } catch (tgErr) {
            console.error('Telegram notify failed:', tgErr.message);
            // 訂單已成立，通知失敗只記 log
          }
        }

        return json({
          success: true,
          data: { order_id: order.order_id }
        });
      }

      // ══════════════════════════════════════════════════════════
      // POST /api/upload-image  （R2 圖片上傳）
      // ══════════════════════════════════════════════════════════
      if (path === '/api/upload-image' && request.method === 'POST') {
        const { base64, filename } = await request.json();
        const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer     = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const ext        = (filename || 'image.jpg').split('.').pop().toLowerCase();
        const ctMap      = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
        const key        = `tours/${Date.now()}_${filename || 'image.jpg'}`;
        await env.TRAVEL.put(key, buffer, { httpMetadata: { contentType: ctMap[ext] || 'image/jpeg' } });
        return json({ success: true, url: `${R2_PUBLIC}/${key}` });
      }

      // ══════════════════════════════════════════════════════════
      // POST /api/upload-dm  （AI DM 解析）
      // ══════════════════════════════════════════════════════════
      if (path === '/api/upload-dm' && request.method === 'POST') {
        const { image } = await request.json();
        const gptResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: 'gpt-4o', response_format: { type: 'json_object' }, max_tokens: 4000, temperature: 0.7,
            messages: [{ role: 'user', content: [
              { type: 'text', text: `你是頂級旅行社行程總監。解析此 DM 並深度擴寫。回傳標準 JSON：
{"title":"...","region":"國旅/亞洲/歐洲/美洲/大洋洲/非洲","price":0,"days":0,"imageKeyword":"景點英文關鍵字","description":"每天200字以上，格式：第N天 標題\\n![圖片](景點英文關鍵字)\\n內文...","notes":""}
description 中圖片語法使用景點英文關鍵字而非URL，系統會自動替換。` },
              { type: 'image_url', image_url: { url: image } }
            ]}]
          })
        });
        const gptData = await gptResp.json();
        if (gptData.error) throw new Error(gptData.error.message);

        let content = gptData.choices[0].message.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('無法解析 GPT 回應');
        const parsed = JSON.parse(match[0]);

        // 封面圖：Unsplash → 上傳 R2
        const coverUrl = await fetchUnsplashUrl(parsed.imageKeyword || 'travel', env);
        parsed.image   = await uploadUrlToR2(coverUrl, `cover_${Date.now()}.jpg`, env);

        // 內文圖片關鍵字替換為 R2 URL
        if (parsed.description) {
          parsed.description = await replaceImageKeywords(parsed.description, env);
        }

        return json({ success: true, data: parsed });
      }

      // ══════════════════════════════════════════════════════════
      // POST /api/partner/register
      // ══════════════════════════════════════════════════════════
      if (path === '/api/partner/register' && request.method === 'POST') {
        const body       = await request.json();
        const agencySlug = url.searchParams.get('a') || 'demo';
        const result     = await gasPost(env, { action: 'registerDistributor', ...body, agency_slug: agencySlug });
        if (!result.success) {
          const msgMap = { already_approved: '您已是核准分銷商', already_pending: '申請已送出，請等待審核' };
          return json({ success: false, error: msgMap[result.error] || result.error });
        }
        return json(result);
      }

      // ══════════════════════════════════════════════════════════
      // GET /api/config
      // ══════════════════════════════════════════════════════════
      if (path === '/api/config' && request.method === 'GET') {
        const slug   = url.searchParams.get('a') || 'demo';
        const result = await readConfigWithFallback(env, slug);
        return json(result);
      }

      // ══════════════════════════════════════════════════════════
      // GET /api/resolve-invite?code=XXXXXX
      // ★ 優先讀 D1，沒有再 fallback GAS
      // ══════════════════════════════════════════════════════════
      if (path === '/api/resolve-invite' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        if (!code) return json({ success: false, error: '缺少 code' }, 400);
        const result = await resolveInviteCodeWithFallback(env, code);
        return json(result);
      }

      // ══════════════════════════════════════════════════════════
      // GET /api/agent/public?code=XXXXXX 或 ?uid=Uxxx
      // ★ 優先讀 D1，沒有再 fallback GAS
      // ══════════════════════════════════════════════════════════
      if (path === '/api/agent/public' && request.method === 'GET') {
        const code = url.searchParams.get('code') || '';
        const uid  = url.searchParams.get('uid')  || '';
        if (!code && !uid) return json({ success: false, error: '缺少 code 或 uid' }, 400);
        const result = await readAgentPublicProfileWithFallback(env, { code, uid });
        return json(result);
      }

      // ══════════════════════════════════════════════════════════
      // GET /api/my/customers?uid=Uxxx
      // ★ 優先讀 D1，沒有再 fallback GAS
      // ══════════════════════════════════════════════════════════
      if (path === '/api/my/customers' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '缺少 uid' }, 400);
        const result = await readMyCustomersWithFallback(env, uid);
        return json(result);
      }

      // ══════════════════════════════════════════════════════════
      // GET /api/my/stats?uid=Uxxx
      // ★ 優先讀 D1，沒有再 fallback GAS
      // ══════════════════════════════════════════════════════════
      if (path === '/api/my/stats' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '缺少 uid' }, 400);
        const result = await readMyStatsWithFallback(env, uid);
        return json(result);
      }

      // ══════════════════════════════════════════════════════════
      // GET /api/commission/summary?uid=管理員uid
      // ★ 優先讀 D1，沒有再 fallback GAS
      // ══════════════════════════════════════════════════════════
      if (path === '/api/commission/summary' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '缺少 uid' }, 400);
        const result = await readCommissionSummaryWithFallback(env, uid);
        return json(result);
      }

      // ══════════════════════════════════════════════════════════
      // GET/POST /api/itineraries  （GAS 通用代理 + 上稿後發 TG 通知管理員）
      // ══════════════════════════════════════════════════════════
      if (path === '/api/distributors/update' && request.method === 'POST') {
        const body = await request.json();
        if (!body?.uid) return json({ success: false, error: '缺少 uid' }, 400);
        const result = await d1UpdateDistributor(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/itineraries') {
        if (request.method === 'GET') {
          const params = Object.fromEntries(url.searchParams);
          const action = params.action || 'getItineraries';
          if (action === 'getItineraries') {
            const result = await readItinerariesWithFallback(env, params);
            return json(result);
          }
          if (action === 'checkUserStatus') {
            const uid = params.uid || '';
            if (!uid) return json({ success: false, error: '缺少 uid' }, 400);
            const result = await readCheckUserStatusWithFallback(env, uid);
            return json(result);
          }
          if (action === 'getDistributors') {
            const result = await readDistributorsWithFallback(env);
            return json(result);
          }
          if (action === 'getAllOrders') {
            const result = await readAllOrdersWithFallback(env);
            return json(result);
          }
          if (action === 'getPendingReviews') {
            const result = await readPendingReviewsWithFallback(env);
            return json(result);
          }
          const result = await gasGet(env, params);
          return json(result);
        }
        const body   = await request.json();
        const result = await gasPost(env, body);

        // ★ 如果是分銷商上稿/編輯造成 pending_review，通知管理員
        const isSubmitAction = body.action === 'addItinerary' || body.action === 'updateItinerary';
        if (isSubmitAction && result.success && result.reviewStatus === 'pending_review') {
          if (env.ADMIN_TG_TOKEN && env.ADMIN_TG_CHAT_ID) {
            try {
              const isUpdate = body.action === 'updateItinerary';
              const title = result.itinerary?.title || body.title || '(未提供)';
              const ownerName = result.itinerary?.ownerName || body.ownerName || '(未提供)';
              await sendAdminReviewNotify(
                env.ADMIN_TG_TOKEN,
                env.ADMIN_TG_CHAT_ID,
                {
                  type: isUpdate ? '修改待審' : '新行程待審',
                  title: title,
                  ownerName: ownerName,
                  region: body.region || '',
                  price: body.price || 0,
                  days: body.days || 0,
                }
              );
            } catch (tgErr) {
              console.error('Admin TG notify failed:', tgErr.message);
              // 不擋資料寫入
            }
          }
        }

        return json(result);
      }

      return json({ error: 'Not Found' }, 404);

    } catch (err) {
      console.error('Worker Error:', err);
      return json({ success: false, error: err.message, ts: new Date().toISOString() }, 500);
    }
  }
};

// ── Telegram 通知 ─────────────────────────────────────────────

async function sendTelegramNotification(token, chatId, order) {
  const text =
    `🎉 *新訂單通知*\n\n` +
    `📋 訂單：\`${order.order_id}\`\n` +
    `🏝️ 行程：${order.itinerary_title}\n` +
    `💰 金額：NT$ ${Number(order.price).toLocaleString()}\n` +
    `💵 您的佣金：NT$ ${Number(order.commission_amount).toLocaleString()}\n\n` +
    `👤 客戶：${order.customer_name}\n` +
    `📞 電話：${order.customer_phone}\n` +
    `👥 人數：${order.travelers} 人\n` +
    `📅 出發日：${order.travel_date || '未指定'}\n` +
    (order.note ? `📝 備註：${order.note}\n` : '') +
    `\n⏰ ${order.created_at}\n\n請盡快聯繫客戶 🙏`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) throw new Error(`Telegram API: ${await res.text()}`);
}

// ★ 新行程/修改待審 → 通知管理員
async function sendAdminReviewNotify(token, chatId, info) {
  const text =
    `📝 *${info.type}*\n\n` +
    `🏝️ 行程：${info.title}\n` +
    `👤 上稿者：${info.ownerName}\n` +
    (info.region ? `📍 地區：${info.region}\n` : '') +
    (info.days   ? `📅 天數：${info.days} 天\n` : '') +
    (info.price  ? `💰 售價：NT$ ${Number(info.price).toLocaleString()}\n` : '') +
    `\n請至 CRM 審核中心處理 → /admin.html`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) throw new Error(`Telegram API: ${await res.text()}`);
}

// ── 圖片工具 ─────────────────────────────────────────────────

async function fetchUnsplashUrl(keyword, env) {
  try {
    if (env.UNSPLASH_API_KEY) {
      const res  = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&orientation=landscape&per_page=1`, { headers: { Authorization: `Client-ID ${env.UNSPLASH_API_KEY}` } });
      const data = await res.json();
      if (data.results?.[0]?.urls?.raw) return `${data.results[0].urls.raw}&w=1600&h=900&fit=crop&q=80`;
    }
  } catch (e) { console.warn('Unsplash failed:', e.message); }
  return `https://loremflickr.com/1600/900/${encodeURIComponent(keyword)}`;
}

async function uploadUrlToR2(imageUrl, filename, env) {
  try {
    const res    = await fetch(imageUrl);
    if (!res.ok) throw new Error('fetch failed');
    const buffer = await res.arrayBuffer();
    const ct     = res.headers.get('content-type') || 'image/jpeg';
    const key    = `tours/${filename}`;
    await env.TRAVEL.put(key, buffer, { httpMetadata: { contentType: ct } });
    return `${R2_PUBLIC}/${key}`;
  } catch (e) {
    console.warn('R2 upload failed:', e.message);
    return imageUrl;
  }
}

async function replaceImageKeywords(text, env) {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const replacements = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const keyword = match[2];
    if (keyword.startsWith('http')) continue;
    const unsplashUrl = await fetchUnsplashUrl(keyword, env);
    const r2Url       = await uploadUrlToR2(unsplashUrl, `scene_${Date.now()}_${Math.random().toString(36).slice(2,6)}.jpg`, env);
    replacements.push({ original: match[0], replacement: `![${match[1]}](${r2Url})` });
  }
  let result = text;
  for (let i = replacements.length - 1; i >= 0; i--) result = result.replace(replacements[i].original, replacements[i].replacement);
  return result;
}
