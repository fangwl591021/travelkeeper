// ============================================================
// TravelKeeper BFF Worker
// ?瑁痊嚗???API??鋆?Flex Message?2 ??銝?I 閫?????桀遣蝡?
// ?垢?芷?????API ?踹???券鞈?
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
const WASABI_IMPORT_STATUSES = new Set(['staged', 'reviewed', 'ready', 'ignored']);
const WASABI_IMPORT_TABLES = new Set(['', 'distributors', 'customers', 'itineraries', 'orders', 'legacy_reference']);
const WASABI_APPLY_TABLES = new Set(['distributors', 'customers', 'legacy_reference']);
const R2_PUBLIC = 'https://pub-06a94bc2edd3405491c7b3f741fa54f2.r2.dev';
const ENDPOINT  = 'https://fangwl591021.github.io/travelkeeper/';
const LINE_NEGATIVE_KEYWORDS = ['退款', '退費', '取消', '生氣', '客訴', '抱怨', '不滿', '失望', '負評', '建議'];
const LINE_URGENT_KEYWORDS = ['立即', '現在', '趕快', '今天', '急件', '盡快', '馬上', '立刻'];

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
    commissionamount: row.commission_amount,
    commissionmode: row.commission_mode,
    commissionpercent: row.commission_percent,
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

function toItineraryManageModel(row) {
  return {
    id: row.id,
    title: row.title || '',
    region: row.region || '',
    price: Number(row.price || 0),
    days: Number(row.days || 0),
    image: row.image || '',
    description: row.description || '',
    notes: row.notes || '',
    ownerUid: row.owner_uid || '',
    ownerName: row.owner_name || '',
    reviewStatus: row.review_status || 'published',
    reviewNote: row.review_note || '',
    commissionAmount: Number(row.commission_amount || 0),
    commissionMode: row.commission_mode || 'amount',
    commissionPercent: Number(row.commission_percent || 0),
    paymentMode: row.payment_mode || 'deposit',
    depositRatio: Number(row.deposit_ratio || 20),
    balanceCollect: row.balance_collect || 'online',
    seatLimit: Number(row.seat_limit || 0),
    minGroupSize: Number(row.min_group_size || 0),
    allowedPaymentMethods: String(row.allowed_payment_methods || 'credit_card,linepay,atm')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean),
    shareEnabled: Number(row.share_enabled ?? 1) === 1,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function normalizeAllowedPaymentMethods(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
  const allowed = ['credit_card', 'linepay', 'atm'];
  const normalized = [...new Set(list.filter(v => allowed.includes(v)))];
  return normalized.join(',');
}

async function d1GetItineraryDetail(env, id) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  return env.DB.prepare(`SELECT * FROM itineraries WHERE id = ?`).bind(normalizedId).first();
}

function normalizeGasItinerary(item = {}) {
  const id = String(item.id || item.timestamp || '').trim();
  if (!id) return null;
  const description = String(
    item.description ||
    item.desc ||
    item.detail ||
    item.details ||
    item.content ||
    item.itineraryDescription ||
    item.itinerary_description ||
    item.schedule ||
    ''
  ).trim();
  return {
    id,
    title: String(item.title || '').trim(),
    region: String(item.region || '').trim(),
    price: Number(item.price || 0),
    days: Number(item.days || 0),
    image: String(item.image || '').trim(),
    description,
    notes: String(item.notes || item.note || '').trim(),
    owner_uid: String(item.owneruid || item.ownerUid || '').trim(),
    owner_name: String(item.ownername || item.ownerName || '').trim(),
    review_status: String(item.reviewstatus || item.reviewStatus || 'published').trim() || 'published',
    review_note: String(item.reviewnote || item.reviewNote || '').trim(),
    payment_mode: String(item.paymentmode || item.paymentMode || 'deposit').trim() || 'deposit',
    deposit_ratio: Number(item.depositratio || item.depositRatio || 20),
    balance_collect: String(item.balancecollect || item.balanceCollect || 'online').trim() || 'online',
    commission_amount: Number(item.commissionamount || item.commissionAmount || 0),
    commission_mode: String(item.commissionmode || item.commissionMode || 'amount').trim() || 'amount',
    commission_percent: Number(item.commissionpercent || item.commissionPercent || 0),
    seat_limit: Number(item.seatlimit || item.seatLimit || 0),
    min_group_size: Number(item.mingroupsize || item.minGroupSize || 0),
    allowed_payment_methods: normalizeAllowedPaymentMethods(
      item.allowedpaymentmethods || item.allowedPaymentMethods || 'credit_card,linepay,atm'
    ),
    share_enabled: Number(item.shareenabled ?? item.shareEnabled ?? 1) === 1 ? 1 : 0,
  };
}

function pickGasItinerary(items = [], body = {}, gasResult = {}) {
  const normalized = items.map(normalizeGasItinerary).filter(Boolean);
  if (!normalized.length) return null;

  const preferredId = String(
    gasResult?.itinerary?.id ||
    gasResult?.itinerary?.timestamp ||
    gasResult?.id ||
    body.id ||
    body.timestamp ||
    ''
  ).trim();
  if (preferredId) {
    const exact = normalized.find(item => item.id === preferredId);
    if (exact) return exact;
  }

  const ownerUid = String(body.ownerUid || body.owneruid || '').trim();
  const title = String(body.title || '').trim();
  const region = String(body.region || '').trim();
  const price = Number(body.price || 0);

  const sameOwner = ownerUid
    ? normalized.filter(item => item.owner_uid === ownerUid)
    : normalized;

  const sameTitle = title
    ? sameOwner.filter(item => item.title === title)
    : sameOwner;

  const sameRegion = region
    ? sameTitle.filter(item => item.region === region)
    : sameTitle;

  const samePrice = price
    ? sameRegion.filter(item => Number(item.price || 0) === price)
    : sameRegion;

  return samePrice[0] || sameRegion[0] || sameTitle[0] || sameOwner[0] || normalized[0];
}

async function d1BackfillMissingItineraryTextFromGas(env, row) {
  if (!env.DB || !env.GAS_WEBAPP_URL || !row?.id) return row;
  const hasDescription = String(row.description || '').trim();
  const hasImage = String(row.image || '').trim();
  if (hasDescription && hasImage) return row;

  try {
    const allItems = await gasGet(env, { action: 'getItineraries', all: '1' });
    const items = Array.isArray(allItems) ? allItems : [];
    const picked = items
      .map(normalizeGasItinerary)
      .filter(Boolean)
      .find(item => String(item.id) === String(row.id));
    if (!picked) return row;

    const merged = {
      ...row,
      title: String(row.title || '').trim() || picked.title,
      region: String(row.region || '').trim() || picked.region,
      price: Number(row.price || 0) || picked.price,
      days: Number(row.days || 0) || picked.days,
      image: hasImage || picked.image,
      description: hasDescription || picked.description,
      notes: String(row.notes || '').trim() || picked.notes,
    };

    if (String(merged.description || '').trim() || String(merged.image || '').trim()) {
      await env.DB.prepare(`
        UPDATE itineraries
           SET title = ?,
               region = ?,
               price = ?,
               days = ?,
               image = ?,
               description = ?,
               notes = ?,
               updated_at = datetime('now')
         WHERE id = ?
      `).bind(
        merged.title,
        merged.region,
        merged.price,
        merged.days,
        merged.image,
        merged.description,
        merged.notes,
        merged.id
      ).run();
    }
    return merged;
  } catch (err) {
    console.warn('backfill itinerary text from GAS failed:', err.message);
    return row;
  }
}

async function d1UpsertGasItinerary(env, itinerary) {
  if (!env.DB || !itinerary?.id) return;
  await env.DB.prepare(`
    INSERT INTO itineraries (
      id, title, region, price, days, image, description, notes,
      owner_uid, owner_name, review_status, review_note,
      payment_mode, deposit_ratio, balance_collect,
      commission_amount, commission_mode, commission_percent,
      seat_limit, min_group_size, allowed_payment_methods, share_enabled,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      COALESCE((SELECT created_at FROM itineraries WHERE id = ?), datetime('now')),
      datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      region = excluded.region,
      price = excluded.price,
      days = excluded.days,
      image = excluded.image,
      description = excluded.description,
      notes = excluded.notes,
      owner_uid = excluded.owner_uid,
      owner_name = excluded.owner_name,
      review_status = excluded.review_status,
      review_note = excluded.review_note,
      payment_mode = excluded.payment_mode,
      deposit_ratio = excluded.deposit_ratio,
      balance_collect = excluded.balance_collect,
      commission_amount = excluded.commission_amount,
      commission_mode = excluded.commission_mode,
      commission_percent = excluded.commission_percent,
      seat_limit = excluded.seat_limit,
      min_group_size = excluded.min_group_size,
      allowed_payment_methods = excluded.allowed_payment_methods,
      share_enabled = excluded.share_enabled,
      updated_at = datetime('now')
  `).bind(
    itinerary.id,
    itinerary.title,
    itinerary.region,
    itinerary.price,
    itinerary.days,
    itinerary.image,
    itinerary.description,
    itinerary.notes,
    itinerary.owner_uid,
    itinerary.owner_name,
    itinerary.review_status,
    itinerary.review_note,
    itinerary.payment_mode,
    itinerary.deposit_ratio,
    itinerary.balance_collect,
    itinerary.commission_amount,
    itinerary.commission_mode,
    itinerary.commission_percent,
    itinerary.seat_limit,
    itinerary.min_group_size,
    itinerary.allowed_payment_methods,
    itinerary.share_enabled,
    itinerary.id
  ).run();
}

async function d1SyncItineraryFromGas(env, body = {}, gasResult = {}) {
  if (!env.DB || !env.GAS_WEBAPP_URL) return;
  const allItems = await gasGet(env, { action: 'getItineraries', all: '1' });
  const picked = pickGasItinerary(Array.isArray(allItems) ? allItems : [], body, gasResult);
  if (!picked) throw new Error('Unable to find itinerary from GAS after submit');
  await d1UpsertGasItinerary(env, picked);
}

async function d1SyncItineraryReviewStatus(env, body = {}) {
  if (!env.DB) return;
  const itineraryId = String(body.id || '').trim();
  const reviewStatus = String(body.status || body.reviewStatus || '').trim();
  if (!itineraryId || !reviewStatus) return;
  await env.DB.prepare(`
    UPDATE itineraries
       SET review_status = ?, review_note = ?, updated_at = datetime('now')
     WHERE id = ?
  `).bind(
    reviewStatus,
    String(body.reviewNote || '').trim(),
    itineraryId
  ).run();
}

async function d1HideItinerary(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const itineraryId = String(body.id || body.itinerary_id || '').trim();
  const operatorUid = String(body.uid || body.operatorUid || '').trim();
  if (!itineraryId) return { success: false, error: 'Missing itinerary id' };
  if (!operatorUid) return { success: false, error: 'Missing operator uid' };

  const existing = await env.DB.prepare(`
    SELECT id, owner_uid
      FROM itineraries
     WHERE id = ?
  `).bind(itineraryId).first();

  if (!existing) {
    return { success: false, error: 'Itinerary not found' };
  }

  const isAdmin = operatorUid ? ADMIN_UIDS.has(operatorUid) : false;
  const isOwner = operatorUid && String(existing.owner_uid || '') === operatorUid;
  if (!isAdmin && !isOwner) {
    return { success: false, error: 'No permission to hide itinerary' };
  }

  await env.DB.prepare(`
    UPDATE itineraries
       SET deleted_at = datetime('now'),
           review_status = 'deleted',
           updated_at = datetime('now')
     WHERE id = ?
  `).bind(itineraryId).run();

  return { success: true, id: itineraryId, hidden: true };
}

async function d1SaveItineraryDetail(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const itineraryId = String(body.id || '').trim();
  const operatorUid = String(body.uid || body.operatorUid || '').trim();
  if (!itineraryId) return { success: false, error: '蝻箏? id' };
  if (!operatorUid) return { success: false, error: '蝻箏? uid' };

  const existing = await d1GetItineraryDetail(env, itineraryId);
  if (!existing) return { success: false, error: '?曆??唳迨銵?' };

  const isAdmin = ADMIN_UIDS.has(operatorUid);
  const isOwner = String(existing.owner_uid || '') === operatorUid;
  if (!isAdmin && !isOwner) return { success: false, error: '?⊥??楊頛舀迨銵?' };

  const basicUpdates = {
    title: body.title ?? existing.title ?? '',
    region: body.region ?? existing.region ?? '',
    price: Number(body.price ?? existing.price ?? 0),
    days: Number(body.days ?? existing.days ?? 0),
    image: body.image ?? existing.image ?? '',
    description: body.description ?? existing.description ?? '',
    notes: body.notes ?? existing.notes ?? '',
    payment_mode: body.paymentMode ?? body.paymentmode ?? existing.payment_mode ?? 'deposit',
    deposit_ratio: Number(body.depositRatio ?? body.depositratio ?? existing.deposit_ratio ?? 20),
    balance_collect: body.balanceCollect ?? body.balancecollect ?? existing.balance_collect ?? 'online',
  };

  const adminUpdates = isAdmin
    ? {
        commission_amount: Number(body.commissionAmount ?? body.commissionamount ?? existing.commission_amount ?? 0),
        commission_mode: String(body.commissionMode ?? body.commissionmode ?? existing.commission_mode ?? 'amount'),
        commission_percent: Number(body.commissionPercent ?? body.commissionpercent ?? existing.commission_percent ?? 0),
        seat_limit: Number(body.seatLimit ?? body.seatlimit ?? existing.seat_limit ?? 0),
        min_group_size: Number(body.minGroupSize ?? body.mingroupsize ?? existing.min_group_size ?? 0),
        allowed_payment_methods: normalizeAllowedPaymentMethods(
          body.allowedPaymentMethods ?? body.allowedpaymentmethods ?? existing.allowed_payment_methods ?? 'credit_card,linepay,atm'
        ),
        share_enabled: body.shareEnabled === undefined && body.shareenabled === undefined
          ? Number(existing.share_enabled ?? 1)
          : ((body.shareEnabled ?? body.shareenabled) ? 1 : 0),
      }
    : {};

  const d1Updates = { ...basicUpdates, ...adminUpdates };
  const d1Columns = Object.keys(d1Updates);
  const d1Sets = d1Columns.map(column => `${column} = ?`);
  const d1Values = d1Columns.map(column => d1Updates[column]);
  d1Sets.push(`updated_at = datetime('now')`);

  const updateRes = await env.DB.prepare(
    `UPDATE itineraries SET ${d1Sets.join(', ')} WHERE id = ?`
  ).bind(...d1Values, itineraryId).run();

  if (!updateRes.success) return { success: false, error: '銵??湔憭望?' };

  if (env.GAS_WEBAPP_URL) {
    const gasBody = {
      action: 'updateItinerary',
      id: itineraryId,
      operatorUid,
      title: basicUpdates.title,
      region: basicUpdates.region,
      price: basicUpdates.price,
      days: basicUpdates.days,
      image: basicUpdates.image,
      description: basicUpdates.description,
      notes: basicUpdates.notes,
      paymentMode: basicUpdates.payment_mode,
      depositRatio: basicUpdates.deposit_ratio,
      balanceCollect: basicUpdates.balance_collect,
    };
    if (isAdmin && adminUpdates.commission_amount !== undefined) {
      gasBody.commissionAmount = adminUpdates.commission_amount;
      gasBody.commissionMode = adminUpdates.commission_mode;
      gasBody.commissionPercent = adminUpdates.commission_percent;
    }
    try {
      await gasPost(env, gasBody);
    } catch (err) {
      console.warn('sync updateItinerary to GAS failed:', err.message);
    }
  }

  const fresh = await d1GetItineraryDetail(env, itineraryId);
  return { success: true, data: toItineraryManageModel(fresh) };
}

function formatTaipeiDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function normalizePhoneValue(value) {
  return String(value || '').trim();
}

async function d1CreateOrder(env, body = {}, agencySlug = 'demo') {
  if (!env.DB) throw new Error('D1 binding missing');

  const itineraryId = String(body.itinerary_id || '').trim();
  const distributorUid = String(body.distributor_uid || '').trim();
  const customerName = String(body.customer_name || '').trim();
  const customerPhone = normalizePhoneValue(body.customer_phone);
  const customerLineUid = String(body.customer_line_uid || '').trim();
  const travelers = Math.max(1, Number(body.travelers) || 1);
  const travelDate = String(body.travel_date || '').trim();
  const note = String(body.note || '').trim();
  const source = String(body.source || 'referral').trim() || 'referral';

  if (!itineraryId || !distributorUid || !customerName || !customerPhone) {
    return { success: false, error: '蝻箏?撱箇?閮??甈?' };
  }

  const itinerary = await env.DB.prepare(
    `SELECT * FROM itineraries WHERE id = ? AND (deleted_at IS NULL OR deleted_at = '')`
  ).bind(itineraryId).first();
  if (!itinerary) return { success: false, error: '?曆??唳迨銵?' };

  const distributor = await env.DB.prepare(
    `SELECT * FROM distributors WHERE uid = ?`
  ).bind(distributorUid).first();
  if (!distributor) return { success: false, error: '找不到分銷商資料' };

  const price = Number(itinerary.price || 0);
  const totalAmount = price * travelers;
  const paymentMode = String(itinerary.payment_mode || 'deposit').toLowerCase();
  const depositRatio = Number(itinerary.deposit_ratio || 20);
  const balanceCollect = paymentMode === 'full'
    ? 'not_required'
    : String(itinerary.balance_collect || 'online').toLowerCase();

  const depositAmount = paymentMode === 'full'
    ? totalAmount
    : Math.round(totalAmount * depositRatio / 100);
  const balanceAmount = paymentMode === 'full'
    ? 0
    : Math.max(0, totalAmount - depositAmount);

  const commissionMode = String(itinerary.commission_mode || 'amount').toLowerCase();
  const commissionAmount = commissionMode === 'percent'
    ? Math.round(totalAmount * Number(itinerary.commission_percent || 0) / 100)
    : Number(itinerary.commission_amount || 0);
  const createdAt = formatTaipeiDateTime(new Date());
  const orderId = 'ORD' + Date.now() + Math.floor(1000 + Math.random() * 9000);
  const initBalanceStatus = paymentMode === 'full' ? 'not_required' : 'unpaid';

  const insertResult = await env.DB.prepare(`
    INSERT INTO orders (
      order_id, itinerary_id, itinerary_title, price, distributor_uid, customer_name, customer_phone, customer_line_uid,
      travelers, travel_date, note, status, commission_amount, total_amount, deposit_amount, balance_amount, payment_mode,
      balance_collect, deposit_status, deposit_paid_at, deposit_method, deposit_trade_no, balance_status, balance_paid_at,
      balance_method, balance_trade_no, commission_status, commission_settled_at, commission_paid_out_at, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'unpaid', '', '', '', ?, '', '', '', 'pending', '', '', ?, ?, ?)
  `).bind(
    orderId,
    itineraryId,
    String(itinerary.title || ''),
    price,
    distributorUid,
    customerName,
    customerPhone,
    customerLineUid,
    travelers,
    travelDate,
    note,
    commissionAmount,
    totalAmount,
    depositAmount,
    balanceAmount,
    paymentMode,
    balanceCollect,
    initBalanceStatus,
    source,
    createdAt,
    createdAt
  ).run();

  if (!insertResult.success) return { success: false, error: '閮撱箇?憭望?' };

  await env.DB.prepare(`
    INSERT INTO customers (
      customer_phone, customer_name, customer_line_uid, owner_uid, owner_name,
      first_order_at, last_order_at, total_orders, total_amount, source, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, '', ?, ?)
    ON CONFLICT(customer_phone) DO UPDATE SET
      customer_name = CASE WHEN customers.customer_name = '' THEN excluded.customer_name ELSE customers.customer_name END,
      customer_line_uid = CASE WHEN customers.customer_line_uid = '' THEN excluded.customer_line_uid ELSE customers.customer_line_uid END,
      last_order_at = excluded.last_order_at,
      total_orders = customers.total_orders + 1,
      total_amount = customers.total_amount + excluded.total_amount,
      updated_at = excluded.updated_at
  `).bind(
    customerPhone,
    customerName,
    customerLineUid,
    distributorUid,
    String(distributor.name || ''),
    createdAt,
    createdAt,
    totalAmount,
    source,
    createdAt,
    createdAt
  ).run();

  return {
    success: true,
    data: {
      order: {
        order_id: orderId,
        itinerary_title: String(itinerary.title || ''),
        price,
        customer_name: customerName,
        customer_phone: customerPhone,
        travelers,
        travel_date: travelDate,
        note,
        commission_amount: commissionAmount,
        created_at: createdAt,
        total_amount: totalAmount,
        deposit_amount: depositAmount,
        balance_amount: balanceAmount,
        payment_mode: paymentMode,
        balance_collect: balanceCollect,
      },
      distributor: {
        name: distributor.name || '',
        tgToken: distributor.tg_token || '',
        tgChatId: distributor.tg_chat_id || '',
      },
    },
  };
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
      WHERE COALESCE(TRIM(name), '') <> ''
         OR COALESCE(TRIM(phone), '') <> ''
         OR COALESCE(TRIM(company_name), '') <> ''
         OR COALESCE(TRIM(email), '') <> ''
      ORDER BY created_at DESC`
  ).all();
  return results.map(toSheetDistributor);
}

const DISTRIBUTOR_PROFILE_FIELDS = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  lineLink: 'line_link',
  linelink: 'line_link',
  lineAtLink: 'line_at_link',
  lineatlink: 'line_at_link',
  lineAtId: 'line_at_id',
  lineatid: 'line_at_id',
  fbLink: 'fb_link',
  fblink: 'fb_link',
  igLink: 'ig_link',
  iglink: 'ig_link',
  webLink: 'web_link',
  weblink: 'web_link',
  mapLink: 'map_link',
  maplink: 'map_link',
  tgToken: 'tg_token',
  tgtoken: 'tg_token',
  tgChatId: 'tg_chat_id',
  tgchatid: 'tg_chat_id',
  avatar: 'avatar',
  bio: 'bio',
  oaIntro: 'oa_intro',
  oaintro: 'oa_intro',
  bankAccount: 'bank_account',
  bankaccount: 'bank_account',
  bankName: 'bank_name',
  bankname: 'bank_name',
  bankBranch: 'bank_branch',
  bankbranch: 'bank_branch',
  bankHolder: 'bank_holder',
  bankholder: 'bank_holder',
};

function pickDistributorProfileUpdates(body = {}) {
  const updates = {};
  for (const [key, column] of Object.entries(DISTRIBUTOR_PROFILE_FIELDS)) {
    if (body[key] !== undefined) updates[column] = body[key] ?? '';
  }
  return updates;
}

async function d1GetDistributorProfile(env, uid) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return { success: false, error: '蝻箏? uid' };

  const row = await env.DB.prepare(`SELECT * FROM distributors WHERE uid = ?`).bind(normalizedUid).first();
  if (!row) return { success: false, error: '????????' };

  return {
    success: true,
    data: {
      uid: row.uid,
      name: row.name || '',
      phone: row.phone || '',
      email: row.email || '',
      agencySlug: row.agency_slug || '',
      inviteCode: row.invite_code || '',
      status: row.status || '',
      commission: Number(row.commission_pct || 0),
      canUpload: !!Number(row.can_upload || 0),
      lineLink: row.line_link || '',
      lineAtLink: row.line_at_link || '',
      lineAtId: row.line_at_id || '',
      fbLink: row.fb_link || '',
      igLink: row.ig_link || '',
      webLink: row.web_link || '',
      mapLink: row.map_link || '',
      tgToken: row.tg_token || '',
      tgChatId: row.tg_chat_id || '',
      avatar: row.avatar || '',
      bio: row.bio || '',
      oaIntro: row.oa_intro || '',
      bankAccount: row.bank_account || '',
      bankName: row.bank_name || '',
      bankBranch: row.bank_branch || '',
      bankHolder: row.bank_holder || '',
    },
  };
}

async function d1UpdateDistributorProfile(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedUid = String(body.uid || '').trim();
  if (!normalizedUid) return { success: false, error: '蝻箏? uid' };

  const updates = pickDistributorProfileUpdates(body);
  if (Object.keys(updates).length === 0) {
    return d1GetDistributorProfile(env, normalizedUid);
  }

  const columns = Object.keys(updates);
  const sets = columns.map(column => `${column} = ?`);
  const values = columns.map(column => updates[column]);
  sets.push(`updated_at = datetime('now')`);

  const result = await env.DB.prepare(
    `UPDATE distributors SET ${sets.join(', ')} WHERE uid = ?`
  ).bind(...values, normalizedUid).run();

  if (!result.success) return { success: false, error: '?????????' };

  if (env.GAS_WEBAPP_URL) {
    const gasBody = { action: 'updateDistributorProfile', uid: normalizedUid };
    for (const [key, column] of Object.entries(DISTRIBUTOR_PROFILE_FIELDS)) {
      if (updates[column] !== undefined && gasBody[key] === undefined) {
        gasBody[key] = updates[column];
      }
    }
    try {
      await gasPost(env, gasBody);
    } catch (err) {
      console.warn('sync updateDistributorProfile to GAS failed:', err.message);
    }
  }

  return d1GetDistributorProfile(env, normalizedUid);
}

async function d1UpsertRegisteredDistributor(env, body = {}, gasResult = {}) {
  if (!env.DB) throw new Error('D1 binding missing');

  const uid = String(body.uid || '').trim();
  if (!uid) return { success: false, error: 'MISSING_UID' };

  const name = String(body.name || '').trim();
  const phone = normalizePhoneValue(body.phone);
  const companyName = String(body.company_name || body.companyName || '').trim();
  const refUid = String(body.ref_uid || '').trim();
  const agencySlug = String(body.agency_slug || body.agencySlug || 'demo').trim() || 'demo';
  const inviteCode = String(gasResult.inviteCode || '').trim().toUpperCase();
  const now = formatTaipeiDateTime(new Date());

  const existing = await env.DB.prepare(
    `SELECT uid, invite_code, status, joined_at, created_at
       FROM distributors
      WHERE uid = ?`
  ).bind(uid).first();

  const existingStatus = String(existing?.status || '').toLowerCase();
  const preservedStatus = ['approved', 'active', 'suspended', 'rejected'].includes(existingStatus)
    ? existingStatus
    : 'pending';
  const finalInviteCode = String(existing?.invite_code || '').trim().toUpperCase() || inviteCode;
  const joinedAt = existing?.joined_at || now;
  const createdAt = existing?.created_at || now;

  const result = await env.DB.prepare(`
    INSERT INTO distributors (
      uid, name, phone, company_name, status, commission_pct, note, sales_revenue,
      joined_at, ref_uid, agency_slug, can_upload, invite_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, '', 0, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      company_name = excluded.company_name,
      ref_uid = excluded.ref_uid,
      agency_slug = excluded.agency_slug,
      invite_code = CASE
        WHEN COALESCE(distributors.invite_code, '') = '' THEN excluded.invite_code
        ELSE distributors.invite_code
      END,
      updated_at = excluded.updated_at
  `).bind(
    uid,
    name,
    phone,
    companyName,
    preservedStatus,
    joinedAt,
    refUid,
    agencySlug,
    finalInviteCode,
    createdAt,
    now
  ).run();

  if (!result.success) {
    return { success: false, error: 'FAILED_TO_SYNC_D1_DISTRIBUTOR' };
  }

  return { success: true };
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

async function d1UpdateOrderStatus(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const orderId = String(body.order_id || body.orderId || '').trim();
  const nextStatus = String(body.status || '').trim().toLowerCase();
  if (!orderId) return { success: false, error: 'MISSING_ORDER_ID' };
  if (!nextStatus) return { success: false, error: 'MISSING_STATUS' };

  const existing = await env.DB.prepare(
    `SELECT order_id FROM orders WHERE order_id = ?`
  ).bind(orderId).first();
  if (!existing) return { success: false, error: 'ORDER_NOT_FOUND' };

  const now = formatTaipeiDateTime(new Date());
  const result = await env.DB.prepare(
    `UPDATE orders
        SET status = ?,
            updated_at = ?
      WHERE order_id = ?`
  ).bind(nextStatus, now, orderId).run();

  if (!result.success) return { success: false, error: 'FAILED_TO_UPDATE_ORDER_STATUS' };

  if (env.GAS_WEBAPP_URL) {
    try {
      await gasPost(env, { action: 'updateOrderStatus', order_id: orderId, status: nextStatus });
    } catch (err) {
      console.warn('sync updateOrderStatus to GAS failed:', err.message);
    }
  }

  return { success: true, updatedAt: now };
}

async function d1MarkBalancePaid(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const orderId = String(body.order_id || body.orderId || '').trim();
  const operatorUid = String(body.operatorUid || body.uid || '').trim();
  if (!orderId) return { success: false, error: 'MISSING_ORDER_ID' };
  if (!ADMIN_UIDS.has(operatorUid)) return { success: false, error: 'FORBIDDEN' };

  const existing = await env.DB.prepare(
    `SELECT order_id, balance_collect, commission_status
       FROM orders
      WHERE order_id = ?`
  ).bind(orderId).first();
  if (!existing) return { success: false, error: 'ORDER_NOT_FOUND' };
  if (String(existing.balance_collect || '').toLowerCase() !== 'offline') {
    return { success: false, error: 'BALANCE_COLLECT_NOT_OFFLINE' };
  }

  const now = formatTaipeiDateTime(new Date());
  const shouldSetCommissionPayable = String(existing.commission_status || 'pending').toLowerCase() === 'pending';

  const sets = [
    `balance_status = ?`,
    `balance_paid_at = ?`,
    `balance_method = ?`,
    `status = ?`,
    `updated_at = ?`,
  ];
  const values = ['paid_offline', now, 'offline', 'completed', now];

  if (shouldSetCommissionPayable) {
    sets.push(`commission_status = ?`);
    sets.push(`commission_settled_at = ?`);
    values.push('payable', now);
  }

  const result = await env.DB.prepare(
    `UPDATE orders
        SET ${sets.join(', ')}
      WHERE order_id = ?`
  ).bind(...values, orderId).run();

  if (!result.success) return { success: false, error: 'FAILED_TO_MARK_BALANCE_PAID' };

  if (env.GAS_WEBAPP_URL) {
    try {
      await gasPost(env, { action: 'markBalancePaid', order_id: orderId, operatorUid });
    } catch (err) {
      console.warn('sync markBalancePaid to GAS failed:', err.message);
    }
  }

  return { success: true, updatedAt: now };
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
        name: row.distributor_name || '(?芰)',
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


function getGasWebhookUrl(env) {
  return env.GAS_URL || env.GAS_WEBAPP_URL || '';
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function verifyLineSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const digest = bytesToBase64(new Uint8Array(mac));
  return digest === signature;
}

async function replyLineMessage(env, replyPayload) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN missing');
  }
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(replyPayload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE reply failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

function resolveLinePushTarget(thread = {}) {
  const threadId = String(thread.id || '').trim();
  const userId = String(thread.source_user_id || '').trim();
  const groupOrRoomId = String(thread.source_group_id || '').trim();
  if (threadId.startsWith('user:') && userId) return { type: 'user', to: userId };
  if (threadId.startsWith('group:') && groupOrRoomId) return { type: 'group', to: groupOrRoomId };
  if (threadId.startsWith('room:') && groupOrRoomId) return { type: 'room', to: groupOrRoomId };
  if (userId) return { type: 'user', to: userId };
  if (groupOrRoomId) return { type: 'group_or_room', to: groupOrRoomId };
  return null;
}

function decodeBase64DataUrl(value = '') {
  const input = String(value || '').trim();
  if (!input) return null;
  const match = input.match(/^data:([^;,]+);base64,(.+)$/i);
  const contentType = match ? match[1] : 'image/png';
  const base64 = match ? match[2] : input;
  const normalized = base64.replace(/\s+/g, '');
  if (!normalized) return null;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { contentType, bytes };
}

async function pushLineTextMessage(env, to, text) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN missing');
  }
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`LINE push failed (${res.status}): ${responseText.slice(0, 300)}`);
  }
  return { status: res.status, body: responseText };
}

async function forwardWebhookToSecondary(env, rawBody, signature) {
  const forwardUrl = String(env.FORWARD_WEBHOOK_URL || '').trim();
  if (!forwardUrl) return { forwarded: false, skipped: true };
  const res = await fetch(forwardUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'x-line-signature': signature } : {}),
      'x-travelkeeper-forwarded-by': 'travelkeeper-worker',
    },
    body: rawBody,
  });
  return { forwarded: true, status: res.status };
}

async function postToGasWebhook(env, payload) {
  const gasUrl = getGasWebhookUrl(env);
  if (!gasUrl) throw new Error('GAS_URL missing');
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'LINE_WEBHOOK', payload }),
    redirect: 'follow',
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`GAS non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`GAS response ${res.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

async function handleLineWebhookGateway(request, env, ctx) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature') || '';
  if (!env.LINE_CHANNEL_SECRET) {
    return json({ success: false, error: 'LINE_CHANNEL_SECRET missing' }, 500);
  }
  const valid = await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET);
  if (!valid) {
    return new Response('Invalid Signature', { status: 403, headers: CORS });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  ctx.waitUntil((async () => {
    try {
      await storeLineWebhookEvents(env, payload);
    } catch (err) {
      console.warn('store line webhook events failed:', err.message);
    }

    if (env.FORWARD_WEBHOOK_URL) {
      try {
        await forwardWebhookToSecondary(env, rawBody, signature);
      } catch (err) {
        console.warn('secondary webhook forward failed:', err.message);
      }
    }

    try {
      const gasResult = await postToGasWebhook(env, payload);
      const replyPayload = gasResult?.data?.replyPayload || gasResult?.replyPayload || null;
      if (replyPayload?.replyToken && Array.isArray(replyPayload?.messages) && replyPayload.messages.length > 0) {
        await replyLineMessage(env, replyPayload);
      }
    } catch (err) {
      console.error('line webhook background processing failed:', err.message);
    }
  })());

  return json({
    success: true,
    events: Array.isArray(payload?.events) ? payload.events.length : 0,
    queued: true,
    forwarded: !!env.FORWARD_WEBHOOK_URL,
  });
}

function getLineThreadId(source = {}) {
  const type = String(source?.type || 'user');
  if (type === 'group' && source?.groupId) return `group:${source.groupId}`;
  if (type === 'room' && source?.roomId) return `room:${source.roomId}`;
  if (source?.userId) return `user:${source.userId}`;
  return `unknown:${crypto.randomUUID()}`;
}

function getLineDisplayName(source = {}) {
  if (source?.userId) return `?冽 ${String(source.userId).slice(-6)}`;
  if (source?.groupId) return `蝢斤? ${String(source.groupId).slice(-6)}`;
  if (source?.roomId) return `?予摰?${String(source.roomId).slice(-6)}`;
  return '?芸??憭拙恕';
}

async function fetchLineSourceProfile(env, source = {}) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return null;
  const headers = { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` };
  let endpoint = '';
  if (source?.type === 'user' && source?.userId) {
    endpoint = `https://api.line.me/v2/bot/profile/${encodeURIComponent(source.userId)}`;
  } else if (source?.type === 'group' && source?.groupId && source?.userId) {
    endpoint = `https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(source.userId)}`;
  } else if (source?.type === 'room' && source?.roomId && source?.userId) {
    endpoint = `https://api.line.me/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(source.userId)}`;
  } else {
    return null;
  }
  try {
    const res = await fetch(endpoint, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      displayName: String(data.displayName || '').trim(),
      pictureUrl: String(data.pictureUrl || '').trim(),
    };
  } catch (_err) {
    return null;
  }
}

async function debugLineSourceProfile(env, source = {}) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    return { ok: false, status: 'missing', detail: 'LINE_CHANNEL_ACCESS_TOKEN missing', source };
  }
  const headers = { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` };
  let endpoint = '';
  if (source?.type === 'user' && source?.userId) {
    endpoint = `https://api.line.me/v2/bot/profile/${encodeURIComponent(source.userId)}`;
  } else if (source?.type === 'group' && source?.groupId && source?.userId) {
    endpoint = `https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(source.userId)}`;
  } else if (source?.type === 'room' && source?.roomId && source?.userId) {
    endpoint = `https://api.line.me/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(source.userId)}`;
  } else {
    return { ok: false, status: 'invalid_source', detail: 'source missing ids', source };
  }
  try {
    const res = await fetch(endpoint, { headers });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_err) { data = null; }
    return {
      ok: res.ok,
      status: res.status,
      endpoint,
      source,
      detail: res.ok ? 'ok' : text.slice(0, 300),
      data,
    };
  } catch (err) {
    return { ok: false, status: 'error', endpoint, source, detail: err.message };
  }
}

function isPlaceholderLineDisplayName(name = '', sourceId = '') {
  const value = String(name || '').trim();
  const id = String(sourceId || '').trim();
  if (!value) return true;
  if (value === 'Unknown user' || value === '?芰?冽') return true;
  if (!id) return false;
  const suffix = id.slice(-6);
  if (!suffix) return false;
  if ((value.startsWith('?冽 ') || value.startsWith('User ')) && value.endsWith(suffix)) return true;
  if ((value.startsWith('蝢斤? ') || value.startsWith('?予摰?')) && value.endsWith(suffix)) return true;
  if (value.includes(id) && value.length <= id.length + 8) return true;
  return false;
}

async function enrichStoredLineThreadProfile(env, row = {}) {
  const sourceUserId = String(row?.source_user_id || '').trim();
  const sourceGroupId = String(row?.source_group_id || '').trim();
  const currentName = String(row?.display_name || '').trim();
  const currentPicture = String(row?.picture_url || '').trim();
  if (!sourceUserId || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    return {
      ...row,
      display_name: currentName,
      picture_url: currentPicture,
    };
  }

  let profile = null;
  if (!sourceGroupId) {
    profile = await fetchLineSourceProfile(env, { type: 'user', userId: sourceUserId });
  } else {
    profile = await fetchLineSourceProfile(env, { type: 'group', groupId: sourceGroupId, userId: sourceUserId });
    if (!profile) {
      profile = await fetchLineSourceProfile(env, { type: 'room', roomId: sourceGroupId, userId: sourceUserId });
    }
  }

  if (!profile?.displayName && !profile?.pictureUrl) {
    return {
      ...row,
      display_name: currentName,
      picture_url: currentPicture,
    };
  }

  const displayName = String(profile?.displayName || '').trim() || currentName;
  const pictureUrl = String(profile?.pictureUrl || '').trim() || currentPicture;
  if ((displayName && displayName !== currentName) || (pictureUrl && pictureUrl !== currentPicture)) {
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE line_threads
      SET
        display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
        picture_url = CASE WHEN ? <> '' THEN ? ELSE picture_url END,
        updated_at = ?
      WHERE id = ?
    `).bind(
      displayName,
      displayName,
      pictureUrl,
      pictureUrl,
      now,
      String(row?.id || '')
    ).run();
  }

  return {
    ...row,
    display_name: displayName,
    picture_url: pictureUrl,
  };
}

function summarizeLineRisk(text = '') {
  const haystack = String(text || '');
  const hits = [
    ...LINE_NEGATIVE_KEYWORDS.filter(k => haystack.includes(k)),
    ...LINE_URGENT_KEYWORDS.filter(k => haystack.includes(k)),
  ];
  const uniqueHits = [...new Set(hits)];
  const riskLevel = uniqueHits.some(k => LINE_URGENT_KEYWORDS.includes(k))
    ? 'high'
    : uniqueHits.length > 0
      ? 'medium'
      : 'low';
  return { riskLevel, hits: uniqueHits };
}

function lineMessageCreatedAt(event = {}) {
  if (event.timestamp) {
    try {
      return new Date(Number(event.timestamp)).toISOString();
    } catch (_err) {}
  }
  return new Date().toISOString();
}

async function storeLineWebhookEvents(env, payload = {}) {
  if (!env.DB) return;
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const event of events) {
    const source = event?.source || {};
    const threadId = getLineThreadId(source);
    const messageType = String(event?.message?.type || event?.type || 'event');
    const messageText = messageType === 'text'
      ? String(event?.message?.text || '').trim()
      : `[${messageType}]`;
    const createdAt = lineMessageCreatedAt(event);
    const { riskLevel, hits } = summarizeLineRisk(messageText);
    const tagsText = hits.join(',');
    const remoteProfile = await fetchLineSourceProfile(env, source);
    const displayName = remoteProfile?.displayName || getLineDisplayName(source);
    const pictureUrl = remoteProfile?.pictureUrl || '';
    const summary = messageText || `[${messageType}]`;

    await env.DB.prepare(`
      INSERT INTO line_threads (
        id, source_type, source_user_id, source_group_id, display_name, picture_url, status,
        risk_level, summary, unread_count, tags, last_message_at, created_at, updated_at
      ) VALUES (?, 'line_oa', ?, ?, ?, ?, 'open', ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_user_id = excluded.source_user_id,
        source_group_id = excluded.source_group_id,
        display_name = CASE
          WHEN excluded.display_name <> '' THEN excluded.display_name
          ELSE line_threads.display_name
        END,
        picture_url = CASE
          WHEN excluded.picture_url <> '' THEN excluded.picture_url
          ELSE line_threads.picture_url
        END,
        status = CASE
          WHEN line_threads.status = 'closed' THEN line_threads.status
          ELSE 'open'
        END,
        risk_level = CASE
          WHEN line_threads.risk_level = 'high' OR excluded.risk_level = 'high' THEN 'high'
          WHEN line_threads.risk_level = 'medium' OR excluded.risk_level = 'medium' THEN 'medium'
          ELSE 'low'
        END,
        summary = excluded.summary,
        unread_count = line_threads.unread_count + 1,
        tags = CASE
          WHEN excluded.tags = '' THEN line_threads.tags
          WHEN line_threads.tags = '' THEN excluded.tags
          ELSE line_threads.tags || ',' || excluded.tags
        END,
        last_message_at = excluded.last_message_at,
        updated_at = excluded.updated_at
    `).bind(
      threadId,
      String(source?.userId || ''),
      String(source?.groupId || source?.roomId || ''),
      displayName,
      pictureUrl,
      riskLevel,
      summary,
      tagsText,
      createdAt,
      createdAt,
      createdAt
    ).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO line_messages (
        id, thread_id, line_event_id, reply_token, message_type, sender_role,
        sender_id, sender_name, message_text, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      threadId,
      String(event?.webhookEventId || ''),
      String(event?.replyToken || ''),
      messageType,
      String(source?.userId || source?.groupId || source?.roomId || ''),
      displayName,
      summary,
      JSON.stringify(event),
      createdAt
    ).run();
  }
}

async function d1GetLineThreads(env) {
  if (!env.DB) throw new Error('D1 binding missing');
  await ensureLineVisitorRequirementsTable(env);
  const { results } = await env.DB.prepare(`
    SELECT
      id,
      display_name,
      picture_url,
      source_user_id,
      source_group_id,
      status,
      risk_level,
      assigned_to,
      summary,
      unread_count,
      tags,
      note,
      (
        SELECT COUNT(*)
        FROM line_visitor_requirements req
        WHERE req.thread_id = line_threads.id
          AND req.archived_at = ''
      ) AS important_count,
      (
        SELECT req.content
        FROM line_visitor_requirements req
        WHERE req.thread_id = line_threads.id
          AND req.archived_at = ''
        ORDER BY req.updated_at DESC, req.created_at DESC
        LIMIT 1
      ) AS latest_important_note,
      last_message_at
    FROM line_threads
    ORDER BY COALESCE(last_message_at, created_at) DESC
    LIMIT 200
  `).all();
  const enrichedResults = [];
  for (const row of results) {
    enrichedResults.push(await enrichStoredLineThreadProfile(env, row));
  }
  return {
    success: true,
    data: enrichedResults.map(row => ({
      id: row.id,
      name: row.display_name || '????',
      pictureUrl: row.picture_url || '',
      userId: row.source_user_id || row.source_group_id || '',
      summary: row.summary || '',
      unread: Number(row.unread_count || 0),
      risk: row.risk_level || 'low',
      status: row.status || 'open',
      assignedTo: row.assigned_to || '',
      tags: String(row.tags || '').split(',').map(v => v.trim()).filter(Boolean),
      note: row.note || '',
      importantCount: Number(row.important_count || 0),
      latestImportantNote: row.latest_important_note || '',
      lastMessageAt: row.last_message_at || '',
    })),
  };
}

async function ensureLineVisitorRequirementsTable(env) {
  if (!env.DB) throw new Error('D1 binding missing');
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS line_visitor_requirements (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      source_user_id TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      picture_url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '需求',
      content TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high')),
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'follow_up', 'done')),
      follow_up_at TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (thread_id) REFERENCES line_threads(id)
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_line_visitor_requirements_thread_id
    ON line_visitor_requirements(thread_id, archived_at, updated_at)
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_line_visitor_requirements_source_user_id
    ON line_visitor_requirements(source_user_id, archived_at, updated_at)
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_line_visitor_requirements_status
    ON line_visitor_requirements(status, priority, archived_at)
  `).run();
}

function normalizeLineVisitorRequirement(row = {}) {
  return {
    id: row.id || '',
    threadId: row.thread_id || '',
    userId: row.source_user_id || '',
    customerName: row.customer_name || '',
    pictureUrl: row.picture_url || '',
    category: row.category || '需求',
    content: row.content || '',
    priority: row.priority || 'normal',
    status: row.status || 'open',
    followUpAt: row.follow_up_at || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

async function d1GetLineVisitorRequirements(env, threadId) {
  if (!env.DB) throw new Error('D1 binding missing');
  await ensureLineVisitorRequirementsTable(env);
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM line_visitor_requirements
    WHERE thread_id = ?
      AND archived_at = ''
    ORDER BY
      CASE priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      updated_at DESC,
      created_at DESC
  `).bind(threadId).all();
  return (results || []).map(normalizeLineVisitorRequirement);
}

async function d1GetLineThread(env, threadId) {
  if (!env.DB) throw new Error('D1 binding missing');
  await ensureLineVisitorRequirementsTable(env);
  const threadRow = await env.DB.prepare(`
    SELECT
      id,
      display_name,
      picture_url,
      source_user_id,
      source_group_id,
      status,
      risk_level,
      assigned_to,
      summary,
      unread_count,
      tags,
      note,
      (
        SELECT COUNT(*)
        FROM line_visitor_requirements req
        WHERE req.thread_id = line_threads.id
          AND req.archived_at = ''
      ) AS important_count,
      (
        SELECT req.content
        FROM line_visitor_requirements req
        WHERE req.thread_id = line_threads.id
          AND req.archived_at = ''
        ORDER BY req.updated_at DESC, req.created_at DESC
        LIMIT 1
      ) AS latest_important_note,
      last_message_at
    FROM line_threads
    WHERE id = ?
  `).bind(threadId).first();
  if (!threadRow) return { success: false, error: 'THREAD_NOT_FOUND' };
  const thread = await enrichStoredLineThreadProfile(env, threadRow);
  const visitorRecords = await d1GetLineVisitorRequirements(env, threadId);
  const { results } = await env.DB.prepare(`
    SELECT id, message_type, sender_role, sender_id, sender_name, message_text, created_at
    FROM line_messages
    WHERE thread_id = ?
    ORDER BY created_at ASC, inserted_at ASC
    LIMIT 500
  `).bind(threadId).all();
  return {
    success: true,
    data: {
      id: thread.id,
      name: thread.display_name || '????',
      pictureUrl: thread.picture_url || '',
      userId: thread.source_user_id || thread.source_group_id || '',
      summary: thread.summary || '',
      unread: Number(thread.unread_count || 0),
      risk: thread.risk_level || 'low',
      status: thread.status || 'open',
      assignedTo: thread.assigned_to || '',
      tags: String(thread.tags || '').split(',').map(v => v.trim()).filter(Boolean),
      note: thread.note || '',
      importantCount: Number(thread.important_count || visitorRecords.length || 0),
      latestImportantNote: thread.latest_important_note || visitorRecords[0]?.content || '',
      visitorRecords,
      lastMessageAt: thread.last_message_at || '',
      messages: results.map(msg => ({
        id: msg.id,
        type: msg.message_type || 'text',
        senderRole: msg.sender_role || 'user',
        senderId: msg.sender_id || '',
        senderName: msg.sender_role === 'user'
          ? (thread.display_name || msg.sender_name || '????')
          : (msg.sender_name || '??'),
        text: msg.message_text || '',
        createdAt: msg.created_at || '',
      })),
    },
  };
}

async function d1DebugLineThreadProfile(env, threadId) {
  if (!env.DB) throw new Error('D1 binding missing');
  const row = await env.DB.prepare(`
    SELECT id, display_name, picture_url, source_user_id, source_group_id, summary, updated_at
    FROM line_threads
    WHERE id = ?
  `).bind(threadId).first();
  if (!row) return { success: false, error: 'THREAD_NOT_FOUND' };

  const sourceUserId = String(row.source_user_id || '').trim();
  const sourceGroupId = String(row.source_group_id || '').trim();
  const direct = sourceUserId && !sourceGroupId
    ? await debugLineSourceProfile(env, { type: 'user', userId: sourceUserId })
    : null;
  const asGroup = sourceUserId && sourceGroupId
    ? await debugLineSourceProfile(env, { type: 'group', groupId: sourceGroupId, userId: sourceUserId })
    : null;
  const asRoom = sourceUserId && sourceGroupId
    ? await debugLineSourceProfile(env, { type: 'room', roomId: sourceGroupId, userId: sourceUserId })
    : null;

  return {
    success: true,
    data: {
      thread: row,
      placeholderDetected: isPlaceholderLineDisplayName(row.display_name, sourceUserId || sourceGroupId),
      profileChecks: {
        direct,
        asGroup,
        asRoom,
      },
    },
  };
}

async function d1BackfillLineThreadProfiles(env, limit = 100) {
  if (!env.DB) throw new Error('D1 binding missing');
  const size = Math.max(1, Math.min(Number(limit) || 100, 500));
  const { results } = await env.DB.prepare(`
    SELECT id, display_name, picture_url, source_user_id, source_group_id
    FROM line_threads
    WHERE source_user_id <> ''
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT ?
  `).bind(size).all();

  let scanned = 0;
  let updated = 0;
  const changed = [];

  for (const row of results) {
    scanned += 1;
    const beforeName = String(row.display_name || '').trim();
    const beforePic = String(row.picture_url || '').trim();
    const enriched = await enrichStoredLineThreadProfile(env, row);
    const afterName = String(enriched.display_name || '').trim();
    const afterPic = String(enriched.picture_url || '').trim();
    if (afterName !== beforeName || afterPic !== beforePic) {
      updated += 1;
      changed.push({
        id: row.id,
        beforeName,
        afterName,
      });
    }
  }

  return {
    success: true,
    data: { scanned, updated, changed },
  };
}

async function d1UpdateLineThread(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const threadId = String(body.id || '').trim();
  if (!threadId) return { success: false, error: '蝻箏??予摰?id' };
  const tags = Array.isArray(body.tags)
    ? body.tags.map(v => String(v || '').trim()).filter(Boolean)
    : String(body.tags || '').split(',').map(v => v.trim()).filter(Boolean);
  const status = ['open', 'pending', 'closed'].includes(String(body.status || ''))
    ? String(body.status)
    : null;
  const note = body.note === undefined ? null : String(body.note || '');
  const sets = [];
  const values = [];
  if (status !== null) {
    sets.push('status = ?');
    values.push(status);
  }
  if (note !== null) {
    sets.push('note = ?');
    values.push(note);
  }
  if (body.tags !== undefined) {
    sets.push('tags = ?');
    values.push(tags.join(','));
  }
  if (!sets.length) return { success: false, error: '????????' };
  sets.push("updated_at = datetime('now')");
  const result = await env.DB.prepare(`
    UPDATE line_threads
    SET ${sets.join(', ')}
    WHERE id = ?
  `).bind(...values, threadId).run();
  if (!result.success) return { success: false, error: '?湔憭望?' };
  return d1GetLineThread(env, threadId);
}

async function d1SendLineOaReply(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const uid = String(body.uid || '').trim();
  const threadId = String(body.threadId || body.thread_id || body.id || '').trim();
  const text = String(body.text || '').trim();
  const dryRun = body.dryRun === true;
  if (!uid) return { success: false, error: 'MISSING_UID' };
  if (!threadId) return { success: false, error: 'MISSING_THREAD_ID' };
  if (!text) return { success: false, error: 'MISSING_TEXT' };
  if (text.length > 5000) return { success: false, error: 'TEXT_TOO_LONG' };

  const thread = await env.DB.prepare(`
    SELECT id, display_name, source_user_id, source_group_id
    FROM line_threads
    WHERE id = ?
  `).bind(threadId).first();
  if (!thread) return { success: false, error: 'THREAD_NOT_FOUND' };

  const target = resolveLinePushTarget(thread);
  if (!target?.to) return { success: false, error: 'LINE_TARGET_NOT_FOUND' };

  if (dryRun) {
    return {
      success: true,
      data: {
        dryRun: true,
        threadId,
        targetType: target.type,
        targetPreview: `${target.to.slice(0, 6)}...${target.to.slice(-6)}`,
        hasLineToken: !!env.LINE_CHANNEL_ACCESS_TOKEN,
      },
    };
  }

  let lineResult = null;
  try {
    lineResult = await pushLineTextMessage(env, target.to, text);
  } catch (err) {
    return { success: false, error: 'LINE_PUSH_FAILED', detail: err.message || String(err) };
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO line_messages (
      id, thread_id, line_event_id, reply_token, message_type, sender_role,
      sender_id, sender_name, message_text, raw_json, created_at
    ) VALUES (?, ?, '', '', 'text', 'guide', ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    threadId,
    uid,
    '客服',
    text,
    JSON.stringify({ kind: 'manual_reply', targetType: target.type, line: lineResult }),
    now
  ).run();

  await env.DB.prepare(`
    UPDATE line_threads
    SET status = 'pending',
        summary = ?,
        unread_count = 0,
        last_message_at = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(text, now, now, threadId).run();

  const updated = await d1GetLineThread(env, threadId);
  return {
    ...updated,
    sent: true,
    line: { status: lineResult.status },
  };
}

async function publishLineRichMenu(env, body = {}) {
  const richMenu = body.richMenu || body.linePayload || body.rendered?.linePayload || body.rendered?.richMenu || null;
  const image = decodeBase64DataUrl(body.imageBase64 || body.image || '');
  const setDefault = body.setDefault === true;

  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { success: false, error: 'LINE_CHANNEL_ACCESS_TOKEN_MISSING' };
  if (!richMenu || typeof richMenu !== 'object') return { success: false, error: 'MISSING_RICH_MENU_JSON' };
  if (!richMenu.size || !Array.isArray(richMenu.areas)) return { success: false, error: 'INVALID_RICH_MENU_JSON' };
  if (!image?.bytes?.length) return { success: false, error: 'MISSING_IMAGE_BASE64' };
  if (!/^image\/(png|jpeg|jpg)$/i.test(image.contentType)) return { success: false, error: 'UNSUPPORTED_IMAGE_TYPE' };

  const auth = { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` };
  const createRes = await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(richMenu),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    return { success: false, error: 'LINE_CREATE_RICH_MENU_FAILED', status: createRes.status, detail: created };
  }

  const richMenuId = created.richMenuId;
  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': image.contentType === 'image/jpg' ? 'image/jpeg' : image.contentType },
    body: image.bytes,
  });
  const uploadText = await uploadRes.text().catch(() => '');
  if (!uploadRes.ok) {
    await fetch(`https://api.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`, {
      method: 'DELETE',
      headers: auth,
    }).catch(() => null);
    return { success: false, error: 'LINE_UPLOAD_RICH_MENU_IMAGE_FAILED', status: uploadRes.status, detail: uploadText };
  }

  let defaultResult = null;
  if (setDefault) {
    const defaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`, {
      method: 'POST',
      headers: auth,
    });
    defaultResult = { ok: defaultRes.ok, status: defaultRes.status, detail: await defaultRes.text().catch(() => '') };
    if (!defaultRes.ok) {
      return { success: false, error: 'LINE_SET_DEFAULT_RICH_MENU_FAILED', richMenuId, defaultResult };
    }
  }

  return { success: true, data: { richMenuId, setDefault, defaultResult } };
}

async function d1UpsertLineVisitorRequirement(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  await ensureLineVisitorRequirementsTable(env);
  const threadId = String(body.threadId || body.thread_id || body.id || '').trim();
  const recordId = String(body.recordId || body.record_id || '').trim();
  const content = String(body.content || '').trim();
  if (!threadId) return { success: false, error: 'MISSING_THREAD_ID' };
  if (!content) return { success: false, error: 'MISSING_CONTENT' };

  const thread = await env.DB.prepare(`
    SELECT id, source_user_id, display_name, picture_url
    FROM line_threads
    WHERE id = ?
  `).bind(threadId).first();
  if (!thread) return { success: false, error: 'THREAD_NOT_FOUND' };

  const category = String(body.category || '需求').trim() || '需求';
  const priority = ['low', 'normal', 'high'].includes(String(body.priority || ''))
    ? String(body.priority)
    : 'normal';
  const status = ['open', 'follow_up', 'done'].includes(String(body.status || ''))
    ? String(body.status)
    : 'open';
  const followUpAt = String(body.followUpAt || body.follow_up_at || '').trim();
  const createdBy = String(body.createdBy || body.created_by || body.uid || '').trim();
  const now = new Date().toISOString();

  if (recordId) {
    const result = await env.DB.prepare(`
      UPDATE line_visitor_requirements
      SET category = ?,
          content = ?,
          priority = ?,
          status = ?,
          follow_up_at = ?,
          updated_at = ?
      WHERE id = ?
        AND thread_id = ?
        AND archived_at = ''
    `).bind(category, content, priority, status, followUpAt, now, recordId, threadId).run();
    if (!result.success) return { success: false, error: 'UPDATE_FAILED' };
  } else {
    await env.DB.prepare(`
      INSERT INTO line_visitor_requirements (
        id, thread_id, source_user_id, customer_name, picture_url,
        category, content, priority, status, follow_up_at, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      threadId,
      String(thread.source_user_id || ''),
      String(thread.display_name || ''),
      String(thread.picture_url || ''),
      category,
      content,
      priority,
      status,
      followUpAt,
      createdBy,
      now,
      now
    ).run();
  }

  return d1GetLineThread(env, threadId);
}

async function d1ArchiveLineVisitorRequirement(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  await ensureLineVisitorRequirementsTable(env);
  const threadId = String(body.threadId || body.thread_id || '').trim();
  const recordId = String(body.recordId || body.record_id || '').trim();
  if (!threadId) return { success: false, error: 'MISSING_THREAD_ID' };
  if (!recordId) return { success: false, error: 'MISSING_RECORD_ID' };
  const result = await env.DB.prepare(`
    UPDATE line_visitor_requirements
    SET archived_at = ?,
        updated_at = ?
    WHERE id = ?
      AND thread_id = ?
      AND archived_at = ''
  `).bind(new Date().toISOString(), new Date().toISOString(), recordId, threadId).run();
  if (!result.success) return { success: false, error: 'ARCHIVE_FAILED' };
  return d1GetLineThread(env, threadId);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function wasabiRecordPreview(record) {
  const data = safeJsonParse(record.record_json || '{}', {});
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
  const nestedDataKeys = data && typeof data === 'object' && data.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? Object.keys(data.data)
    : [];
  return {
    id: record.id,
    objectKey: record.object_key || '',
    sourceGroup: record.source_group || '',
    sourceId: record.source_id || '',
    mappedTable: record.mapped_table || '',
    mappedKey: record.mapped_key || '',
    status: record.status || 'staged',
    note: record.note || '',
    importedAt: record.imported_at || '',
    keys,
    nestedDataKeys,
    record: data,
  };
}

async function d1GetWasabiImportSummary(env) {
  if (!env.DB) throw new Error('D1 binding missing');
  const records = await env.DB.prepare(`
    SELECT source_group, COUNT(*) AS records
    FROM wasabi_import_records
    GROUP BY source_group
    ORDER BY source_group
  `).all();
  const objects = await env.DB.prepare(`
    SELECT source_group, COUNT(*) AS objects, SUM(size) AS bytes
    FROM wasabi_import_objects
    GROUP BY source_group
    ORDER BY source_group
  `).all();
  const statuses = await env.DB.prepare(`
    SELECT status, COUNT(*) AS records
    FROM wasabi_import_records
    GROUP BY status
    ORDER BY status
  `).all();
  const totals = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM wasabi_import_objects) AS objects,
      (SELECT COUNT(*) FROM wasabi_import_records) AS records,
      (SELECT COUNT(*) FROM orders) AS productionOrders,
      (SELECT COUNT(*) FROM itineraries) AS productionItineraries,
      (SELECT COUNT(*) FROM distributors) AS productionDistributors
  `).first();
  return {
    success: true,
    data: {
      totals: {
        objects: Number(totals?.objects || 0),
        records: Number(totals?.records || 0),
        productionOrders: Number(totals?.productionOrders || 0),
        productionItineraries: Number(totals?.productionItineraries || 0),
        productionDistributors: Number(totals?.productionDistributors || 0),
      },
      records: records.results || [],
      objects: objects.results || [],
      statuses: statuses.results || [],
    },
  };
}

async function d1GetWasabiImportRecords(env, params = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const group = String(params.group || '').trim();
  const search = String(params.search || '').trim();
  const limit = Math.max(1, Math.min(200, Number(params.limit || 80)));
  const offset = Math.max(0, Number(params.offset || 0));
  const where = [];
  const binds = [];
  if (group && group !== 'all') {
    where.push('source_group = ?');
    binds.push(group);
  }
  if (search) {
    where.push('(id LIKE ? OR source_id LIKE ? OR object_key LIKE ? OR record_json LIKE ? OR mapped_table LIKE ? OR mapped_key LIKE ? OR note LIKE ?)');
    const like = `%${search}%`;
    binds.push(like, like, like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM wasabi_import_records ${whereSql}`
  ).bind(...binds).first();
  const { results } = await env.DB.prepare(`
    SELECT id, object_key, source_group, source_id, record_json,
           mapped_table, mapped_key, status, note, imported_at
    FROM wasabi_import_records
    ${whereSql}
    ORDER BY source_group, object_key, source_id
    LIMIT ? OFFSET ?
  `).bind(...binds, limit, offset).all();
  return {
    success: true,
    data: {
      total: Number(countRow?.total || 0),
      limit,
      offset,
      items: (results || []).map(wasabiRecordPreview),
    },
  };
}

async function d1GetWasabiImportRecordById(env, id) {
  const record = await env.DB.prepare(`
    SELECT id, object_key, source_group, source_id, record_json,
           mapped_table, mapped_key, status, note, imported_at
    FROM wasabi_import_records
    WHERE id = ?
  `).bind(id).first();
  return record ? wasabiRecordPreview(record) : null;
}

async function d1ClassifyWasabiImportRecord(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const id = String(body.id || '').trim();
  const status = String(body.status || 'staged').trim();
  const mappedTable = String(body.mappedTable || body.mapped_table || '').trim();
  const mappedKey = String(body.mappedKey || body.mapped_key || '').trim().slice(0, 240);
  const note = String(body.note || '').trim().slice(0, 1200);

  if (!id) return { success: false, error: 'MISSING_ID' };
  if (!WASABI_IMPORT_STATUSES.has(status)) return { success: false, error: 'INVALID_STATUS' };
  if (!WASABI_IMPORT_TABLES.has(mappedTable)) return { success: false, error: 'INVALID_MAPPED_TABLE' };

  const existing = await d1GetWasabiImportRecordById(env, id);
  if (!existing) return { success: false, error: 'NOT_FOUND' };

  await env.DB.prepare(`
    UPDATE wasabi_import_records
    SET status = ?,
        mapped_table = ?,
        mapped_key = ?,
        note = ?
    WHERE id = ?
  `).bind(status, mappedTable, mappedKey, note, id).run();

  return { success: true, data: await d1GetWasabiImportRecordById(env, id) };
}

function pickWasabiValue(data, paths = []) {
  for (const path of paths) {
    const parts = path.split('.');
    let current = data;
    for (const part of parts) {
      if (!current || typeof current !== 'object') {
        current = null;
        break;
      }
      current = current[part];
    }
    if (current !== undefined && current !== null && String(current).trim()) {
      return String(current).trim();
    }
  }
  return '';
}

function inferWasabiImportKey(item) {
  if (item.mapped_key) return String(item.mapped_key).trim();
  const data = safeJsonParse(item.record_json || '{}', {});
  const target = String(item.mapped_table || '').trim();
  if (target === 'distributors') {
    return pickWasabiValue(data, ['uid', 'userId', 'line_user_id', 'owner_user_id', 'data.uid', 'data.userId', 'data.line_user_id']);
  }
  if (target === 'customers') {
    return pickWasabiValue(data, ['customer_phone', 'phone', 'mobile', 'tel', 'data.customer_phone', 'data.phone', 'data.mobile']);
  }
  if (target === 'itineraries') {
    return pickWasabiValue(data, ['id', 'itinerary_id', 'course_id', 'tour_id', 'data.id', 'data.course_id', 'data.tour_id']);
  }
  if (target === 'orders') {
    return pickWasabiValue(data, ['order_id', 'id', 'orderNo', 'data.order_id', 'data.id', 'data.orderNo']);
  }
  return '';
}

function normalizeWasabiImportKey(target, key) {
  const value = String(key || '').trim();
  if ((target === 'distributors' || target === 'customers') && /^line_U/i.test(value)) {
    return value.replace(/^line_/i, '');
  }
  return value;
}

async function d1CheckWasabiTargetExists(env, target, key) {
  if (!target || !key) return false;
  if (target === 'distributors') {
    return !!(await env.DB.prepare('SELECT uid FROM distributors WHERE uid = ?').bind(key).first());
  }
  if (target === 'customers') {
    return !!(await env.DB.prepare('SELECT customer_phone FROM customers WHERE customer_phone = ? OR customer_line_uid = ?').bind(key, key).first());
  }
  if (target === 'itineraries') {
    return !!(await env.DB.prepare('SELECT id FROM itineraries WHERE id = ?').bind(key).first());
  }
  if (target === 'orders') {
    return !!(await env.DB.prepare('SELECT order_id FROM orders WHERE order_id = ?').bind(key).first());
  }
  return false;
}

async function d1DryRunWasabiProductionImport(env, params = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const targetFilter = String(params.target || '').trim();
  const limit = Math.max(1, Math.min(500, Number(params.limit || 200)));
  const where = ["status = 'ready'"];
  const binds = [];
  if (targetFilter && targetFilter !== 'all') {
    where.push('mapped_table = ?');
    binds.push(targetFilter);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM wasabi_import_records ${whereSql}`
  ).bind(...binds).first();
  const { results } = await env.DB.prepare(`
    SELECT id, object_key, source_group, source_id, record_json,
           mapped_table, mapped_key, status, note, imported_at
    FROM wasabi_import_records
    ${whereSql}
    ORDER BY mapped_table, source_group, object_key
    LIMIT ?
  `).bind(...binds, limit).all();

  const items = [];
  const summary = { ready: Number(totalRow?.total || 0), create: 0, update: 0, blocked: 0, reference: 0 };
  for (const row of results || []) {
    const target = String(row.mapped_table || '').trim();
    const key = inferWasabiImportKey(row);
    const reasons = [];
    let action = 'blocked';
    let exists = false;
    if (!target) {
      reasons.push('尚未指定目標資料');
    } else if (target === 'legacy_reference') {
      action = 'reference';
      reasons.push('保留為舊系統參照，不寫入正式表');
    } else if (!WASABI_IMPORT_TABLES.has(target)) {
      reasons.push('目標資料類型不允許');
    } else if (!WASABI_APPLY_TABLES.has(target)) {
      reasons.push('此目標資料尚未開放正式套用，避免影響上架、訂單或佣金資料');
    } else if (!key) {
      reasons.push('缺少對應鍵值，無法判斷新增或更新');
    } else if (target === 'customers' && !pickWasabiValue(safeJsonParse(row.record_json || '{}', {}), ['customer_phone', 'phone', 'mobile', 'tel', 'data.customer_phone', 'data.phone', 'data.mobile'])) {
      reasons.push('客戶資料缺少電話，不能寫入以電話為主鍵的 customers');
    } else if (target === 'customers' && !(await d1ResolveWasabiCustomerOwner(env))) {
      reasons.push('找不到可歸屬的管理員 owner，不能新增 customers');
    } else {
      const normalizedKey = normalizeWasabiImportKey(target, key);
      exists = await d1CheckWasabiTargetExists(env, target, normalizedKey);
      action = exists ? 'update' : 'create';
      reasons.push(exists ? '正式表已有相同鍵值，匯入時會更新' : '正式表沒有相同鍵值，匯入時會新增');
    }
    summary[action] += 1;
    items.push({
      id: row.id,
      sourceGroup: row.source_group || '',
      sourceId: row.source_id || '',
      objectKey: row.object_key || '',
      target,
      key: normalizeWasabiImportKey(target, key),
      sourceKey: key,
      action,
      exists,
      note: row.note || '',
      reasons,
    });
  }
  return { success: true, data: { summary, items, limited: summary.ready > limit, limit } };
}

function appendWasabiNote(existing, addition) {
  const left = String(existing || '').trim();
  const right = String(addition || '').trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}\n${right}`;
}

function wasabiImportLabel(row) {
  return `Wasabi import ${row.source_group || ''}/${row.source_id || row.id || ''}`.trim();
}

async function d1EnsureWasabiInviteCodeAvailable(env, uid, inviteCode) {
  const code = String(inviteCode || '').trim();
  if (!code) return { ok: true };
  const row = await env.DB.prepare(`
    SELECT uid
    FROM distributors
    WHERE invite_code = ?
      AND uid <> ?
  `).bind(code, uid).first();
  if (row) return { ok: false, error: `INVITE_CODE_CONFLICT:${code}` };
  return { ok: true };
}

async function d1ApplyWasabiDistributor(env, row, dryItem) {
  const data = safeJsonParse(row.record_json || '{}', {});
  const key = normalizeWasabiImportKey('distributors', dryItem.key || inferWasabiImportKey(row));
  if (!key) return { ok: false, error: 'MISSING_DISTRIBUTOR_UID' };

  const name = pickWasabiValue(data, ['name', 'displayName', 'display_name', 'user_name', 'data.name', 'data.displayName', 'data.display_name']);
  const phone = pickWasabiValue(data, ['phone', 'mobile', 'tel', 'data.phone', 'data.mobile', 'data.tel']);
  const email = pickWasabiValue(data, ['email', 'data.email']);
  const company = pickWasabiValue(data, ['company_name', 'company', 'brand', 'data.company_name', 'data.company', 'data.brand']);
  const avatar = pickWasabiValue(data, ['pictureUrl', 'picture_url', 'avatar', 'data.pictureUrl', 'data.picture_url', 'data.avatar']);
  const inviteCode = row.source_group === 'referral_code'
    ? pickWasabiValue(data, ['ref_code'])
    : pickWasabiValue(data, ['invite_code', 'ref_code', 'data.invite_code', 'data.ref_code']);
  const inviteCheck = await d1EnsureWasabiInviteCodeAvailable(env, key, inviteCode);
  if (!inviteCheck.ok) return inviteCheck;

  const now = new Date().toISOString();
  const importNote = appendWasabiNote(row.note, `${wasabiImportLabel(row)} applied to distributors`);
  await env.DB.prepare(`
    INSERT INTO distributors (
      uid, name, phone, email, company_name, status, note, sales_revenue,
      joined_at, ref_uid, agency_slug, can_upload, invite_code, avatar, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, '', 'demo', 0, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE distributors.name END,
      phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE distributors.phone END,
      email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE distributors.email END,
      company_name = CASE WHEN excluded.company_name <> '' THEN excluded.company_name ELSE distributors.company_name END,
      invite_code = CASE WHEN excluded.invite_code <> '' THEN excluded.invite_code ELSE distributors.invite_code END,
      avatar = CASE WHEN excluded.avatar <> '' THEN excluded.avatar ELSE distributors.avatar END,
      note = CASE
        WHEN distributors.note = '' THEN excluded.note
        WHEN excluded.note = '' THEN distributors.note
        ELSE distributors.note || char(10) || excluded.note
      END,
      updated_at = excluded.updated_at
  `).bind(key, name, phone, email, company, importNote, now, inviteCode, avatar, now, now).run();

  return { ok: true, target: 'distributors', key };
}

async function d1ResolveWasabiCustomerOwner(env) {
  for (const uid of ADMIN_UIDS) {
    const owner = await env.DB.prepare('SELECT uid, name FROM distributors WHERE uid = ?').bind(uid).first();
    if (owner?.uid) return { uid: owner.uid, name: owner.name || '' };
  }
  return null;
}

async function d1ApplyWasabiCustomer(env, row, dryItem) {
  const data = safeJsonParse(row.record_json || '{}', {});
  const phone = pickWasabiValue(data, ['customer_phone', 'phone', 'mobile', 'tel', 'data.customer_phone', 'data.phone', 'data.mobile']);
  if (!phone) return { ok: false, error: 'MISSING_CUSTOMER_PHONE' };

  const name = pickWasabiValue(data, [
    'customer_name',
    'name',
    'displayName',
    'display_name',
    'data.customer_name',
    'data.name',
    'data.displayName',
    'data.display_name',
  ]);
  const lineUid = normalizeWasabiImportKey('customers', pickWasabiValue(data, [
    'customer_line_uid',
    'line_user_id',
    'userId',
    'data.customer_line_uid',
    'data.line_user_id',
    'data.userId',
  ]));
  const owner = await d1ResolveWasabiCustomerOwner(env);
  if (!owner) return { ok: false, error: 'MISSING_CUSTOMER_OWNER' };
  const now = new Date().toISOString();
  const sourceNote = appendWasabiNote(row.note, `${wasabiImportLabel(row)} applied to customers`);

  await env.DB.prepare(`
    INSERT INTO customers (
      customer_phone, customer_name, customer_line_uid, owner_uid, owner_name,
      first_order_at, last_order_at, total_orders, total_amount, source, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', '', 0, 0, 'wasabi_member_import', ?, ?, ?)
    ON CONFLICT(customer_phone) DO UPDATE SET
      customer_name = CASE WHEN excluded.customer_name <> '' THEN excluded.customer_name ELSE customers.customer_name END,
      customer_line_uid = CASE WHEN excluded.customer_line_uid <> '' THEN excluded.customer_line_uid ELSE customers.customer_line_uid END,
      source = CASE WHEN customers.source = '' OR customers.source = 'referral' THEN excluded.source ELSE customers.source END,
      note = CASE
        WHEN customers.note = '' THEN excluded.note
        WHEN excluded.note = '' THEN customers.note
        ELSE customers.note || char(10) || excluded.note
      END,
      updated_at = excluded.updated_at
  `).bind(phone, name, lineUid, owner.uid, owner.name, sourceNote, now, now).run();

  return { ok: true, target: 'customers', key: phone };
}

async function d1MarkWasabiRecordApplied(env, row, result) {
  const now = new Date().toISOString();
  const appliedNote = appendWasabiNote(row.note, `[${now}] applied: ${result.target || 'legacy_reference'} ${result.key || ''}`.trim());
  await env.DB.prepare(`
    UPDATE wasabi_import_records
    SET status = 'reviewed',
        mapped_key = CASE WHEN mapped_key = '' THEN ? ELSE mapped_key END,
        note = ?
    WHERE id = ?
  `).bind(result.key || '', appliedNote, row.id).run();
}

async function d1ApplyWasabiProductionImport(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const confirm = String(body.confirm || '').trim();
  if (confirm !== 'APPLY_WASABI_READY') {
    return { success: false, error: 'CONFIRMATION_REQUIRED' };
  }

  const dry = await d1DryRunWasabiProductionImport(env, { target: 'all', limit: 500 });
  const dryData = dry.data || {};
  if (dryData.limited) return { success: false, error: 'TOO_MANY_READY_RECORDS', data: dryData };
  if ((dryData.summary?.blocked || 0) > 0) return { success: false, error: 'DRY_RUN_HAS_BLOCKED_ITEMS', data: dryData };
  if ((dryData.summary?.ready || 0) <= 0) return { success: true, data: { applied: 0, skipped: 0, errors: [], dryRun: dryData } };

  const { results } = await env.DB.prepare(`
    SELECT id, object_key, source_group, source_id, record_json,
           mapped_table, mapped_key, status, note, imported_at
    FROM wasabi_import_records
    WHERE status = 'ready'
    ORDER BY mapped_table, source_group, object_key
    LIMIT 500
  `).all();

  const dryItemsById = new Map((dryData.items || []).map(item => [item.id, item]));
  const applied = [];
  const skipped = [];
  const errors = [];

  for (const row of results || []) {
    const dryItem = dryItemsById.get(row.id);
    if (!dryItem) {
      errors.push({ id: row.id, error: 'MISSING_DRY_RUN_ITEM' });
      continue;
    }
    try {
      if (row.mapped_table === 'legacy_reference') {
        const result = { ok: true, target: 'legacy_reference', key: dryItem.key || '' };
        await d1MarkWasabiRecordApplied(env, row, result);
        skipped.push({ id: row.id, target: result.target, key: result.key });
      } else if (row.mapped_table === 'distributors') {
        const result = await d1ApplyWasabiDistributor(env, row, dryItem);
        if (!result.ok) {
          errors.push({ id: row.id, error: result.error || 'APPLY_DISTRIBUTOR_FAILED' });
          continue;
        }
        await d1MarkWasabiRecordApplied(env, row, result);
        applied.push({ id: row.id, target: result.target, key: result.key });
      } else if (row.mapped_table === 'customers') {
        const result = await d1ApplyWasabiCustomer(env, row, dryItem);
        if (!result.ok) {
          errors.push({ id: row.id, error: result.error || 'APPLY_CUSTOMER_FAILED' });
          continue;
        }
        await d1MarkWasabiRecordApplied(env, row, result);
        applied.push({ id: row.id, target: result.target, key: result.key });
      } else {
        errors.push({ id: row.id, error: `TARGET_NOT_ENABLED:${row.mapped_table || ''}` });
      }
    } catch (err) {
      errors.push({ id: row.id, error: err.message || String(err) });
    }
  }

  return {
    success: errors.length === 0,
    data: {
      applied: applied.length,
      skipped: skipped.length,
      errors,
      appliedItems: applied,
      skippedItems: skipped,
    },
  };
}

async function checkEndpoint(url, options = {}) {
  if (!url) return { ok: false, status: 'missing', detail: 'not configured' };
  try {
    const res = await fetch(url, options);
    return { ok: res.ok, status: res.status, detail: res.ok ? 'ok' : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 'error', detail: err.message };
  }
}

async function checkLineBotInfo(env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    return { ok: false, status: 'missing', detail: 'LINE_CHANNEL_ACCESS_TOKEN missing' };
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { 'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    return {
      ok: res.ok,
      status: res.status,
      detail: res.ok ? (data?.displayName || 'ok') : text.slice(0, 120),
      data,
    };
  } catch (err) {
    return { ok: false, status: 'error', detail: err.message };
  }
}

async function buildHubTestStatus(env) {
  const gasUrl = getGasWebhookUrl(env);
  const gas = await checkEndpoint(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'GET_SETTINGS' }),
  });
  const forward = env.FORWARD_WEBHOOK_URL
    ? await checkEndpoint(env.FORWARD_WEBHOOK_URL, { method: 'GET' })
    : { ok: false, status: 'disabled', detail: 'FORWARD_WEBHOOK_URL not configured' };
  const line = await checkLineBotInfo(env);
  return {
    gas,
    forward,
    line,
    config: {
      hasGasUrl: !!gasUrl,
      hasLineSecret: !!env.LINE_CHANNEL_SECRET,
      hasLineToken: !!env.LINE_CHANNEL_ACCESS_TOKEN,
      hasForwardWebhook: !!env.FORWARD_WEBHOOK_URL,
    },
  };
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(message) {
  const bytes = typeof message === 'string'
    ? new TextEncoder().encode(message)
    : message;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function encodeS3Key(key) {
  return String(key || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

function getWasabiStorageConfig(env) {
  const region = String(env.WASABI_REGION || 'us-west-1').trim();
  const endpoint = String(env.WASABI_ENDPOINT || `https://s3.${region}.wasabisys.com`).trim().replace(/\/+$/, '');
  const bucket = String(env.WASABI_BUCKET || '').trim();
  const prefix = String(env.WASABI_PREFIX || 'travelkeeper').trim().replace(/^\/+|\/+$/g, '') || 'travelkeeper';
  return {
    endpoint,
    region,
    bucket,
    prefix,
    hasAccessKey: !!env.WASABI_ACCESS_KEY_ID,
    hasSecretKey: !!env.WASABI_SECRET_ACCESS_KEY,
    writeEnabled: String(env.MOTHER_STORAGE_WRITE_ENABLED || '0') === '1',
  };
}

function buildWasabiObjectUrl(config, key, query = '') {
  const url = `${config.endpoint}/${config.bucket}/${encodeS3Key(key)}`;
  return query ? `${url}?${query}` : url;
}

async function deriveAwsSigningKey(secret, dateStamp, region, service) {
  const encoder = new TextEncoder();
  const sign = async (key, value) => {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)));
  };
  const kDate = await sign(encoder.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await sign(kDate, region);
  const kService = await sign(kRegion, service);
  return await sign(kService, 'aws4_request');
}

async function signWasabiRequest(env, method, key, { query = '', body = '', contentType = 'application/json' } = {}) {
  const config = getWasabiStorageConfig(env);
  if (!config.bucket) throw new Error('WASABI_BUCKET not configured');
  if (!env.WASABI_ACCESS_KEY_ID) throw new Error('WASABI_ACCESS_KEY_ID not configured');
  if (!env.WASABI_SECRET_ACCESS_KEY) throw new Error('WASABI_SECRET_ACCESS_KEY not configured');

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const host = new URL(config.endpoint).host;
  const canonicalUri = `/${config.bucket}/${encodeS3Key(key)}`;
  const payloadHash = await sha256Hex(body || '');
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${config.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = await deriveAwsSigningKey(env.WASABI_SECRET_ACCESS_KEY, dateStamp, config.region, service);
  const signature = await hmacSha256HexBytes(signingKey, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.WASABI_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: buildWasabiObjectUrl(config, key, query),
    headers: {
      'Authorization': authorization,
      'Content-Type': contentType,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
    },
  };
}

async function hmacSha256HexBytes(rawKey, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function wasabiFetch(env, method, key, options = {}) {
  const signed = await signWasabiRequest(env, method, key, options);
  const res = await fetch(signed.url, {
    method,
    headers: signed.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : options.body,
  });
  const text = method === 'HEAD' ? '' : await res.text();
  return {
    ok: res.ok,
    status: res.status,
    detail: res.ok ? 'ok' : text.slice(0, 200),
    text,
  };
}

async function checkWasabiTravelKeeperStorage(env) {
  const config = getWasabiStorageConfig(env);
  const missing = [];
  if (!config.bucket) missing.push('WASABI_BUCKET');
  if (!config.hasAccessKey) missing.push('WASABI_ACCESS_KEY_ID');
  if (!config.hasSecretKey) missing.push('WASABI_SECRET_ACCESS_KEY');
  if (missing.length) {
    return {
      ok: false,
      status: 'missing',
      detail: `${missing.join(', ')} not configured`,
      config: redactWasabiConfig(config),
    };
  }

  try {
    const probeKey = `${config.prefix}/_diagnostics/health.json`;
    const result = await wasabiFetch(env, 'HEAD', probeKey, { contentType: 'application/json' });
    const ok = result.ok || result.status === 404;
    return {
      ok,
      status: result.status,
      detail: ok ? `TravelKeeper prefix reachable: ${config.prefix}` : result.detail,
      config: redactWasabiConfig(config),
    };
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      detail: err.message || String(err),
      config: redactWasabiConfig(config),
    };
  }
}

function redactWasabiConfig(config) {
  return {
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: config.prefix,
    hasAccessKey: config.hasAccessKey,
    hasSecretKey: config.hasSecretKey,
    writeEnabled: config.writeEnabled,
  };
}

async function runWasabiTravelKeeperProbe(env, body = {}) {
  const config = getWasabiStorageConfig(env);
  if (!config.writeEnabled) return { success: false, error: 'MOTHER_STORAGE_WRITE_DISABLED' };
  if (String(body.confirm || '') !== 'PROBE_TRAVELKEEPER_WASABI') {
    return { success: false, error: 'CONFIRMATION_REQUIRED' };
  }

  const key = `${config.prefix}/_diagnostics/probe-${Date.now()}.json`;
  const payload = JSON.stringify({
    project: 'travelkeeper',
    type: 'storage_probe',
    created_at: new Date().toISOString(),
  });

  const write = await wasabiFetch(env, 'PUT', key, { body: payload, contentType: 'application/json' });
  if (!write.ok) return { success: false, error: 'WRITE_FAILED', data: { key, write } };

  const read = await wasabiFetch(env, 'GET', key, { contentType: 'application/json' });
  if (!read.ok) return { success: false, error: 'READ_FAILED', data: { key, write, read } };

  const remove = await wasabiFetch(env, 'DELETE', key, { contentType: 'application/json' });
  return {
    success: remove.ok,
    error: remove.ok ? '' : 'DELETE_FAILED',
    data: {
      key,
      write: { ok: write.ok, status: write.status },
      read: { ok: read.ok, status: read.status, matches: read.text === payload },
      delete: { ok: remove.ok, status: remove.status },
    },
  };
}

function safeStorageId(value) {
  return encodeURIComponent(String(value || '').trim()).replace(/%2F/gi, '-');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value), null, 2);
}

function buildMotherItineraryPayload(row) {
  const methods = String(row.allowed_payment_methods || 'credit_card,linepay,atm')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  return {
    project: 'travelkeeper',
    entity_type: 'itinerary',
    local_id: row.id || '',
    title: row.title || '',
    region: row.region || '',
    price: Number(row.price || 0),
    days: Number(row.days || 0),
    image: row.image || '',
    description: row.description || '',
    notes: row.notes || '',
    owner_uid: row.owner_uid || '',
    owner_name: row.owner_name || '',
    review_status: row.review_status || 'published',
    review_note: row.review_note || '',
    payment_mode: row.payment_mode || 'deposit',
    deposit_ratio: Number(row.deposit_ratio || 20),
    balance_collect: row.balance_collect || 'online',
    commission_mode: row.commission_mode || 'amount',
    commission_amount: Number(row.commission_amount || 0),
    commission_percent: Number(row.commission_percent || 0),
    seat_limit: Number(row.seat_limit || 0),
    min_group_size: Number(row.min_group_size || 0),
    allowed_payment_methods: methods,
    share_enabled: Number(row.share_enabled ?? 1) === 1,
    deleted_at: row.deleted_at || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function validateTravelKeeperStoragePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'INVALID_PAYLOAD';
  if (payload.project !== 'travelkeeper') return 'INVALID_PROJECT';
  if (!payload.entity_type) return 'MISSING_ENTITY_TYPE';
  if (!payload.local_id) return 'MISSING_LOCAL_ID';
  if (!payload.updated_at) return 'MISSING_UPDATED_AT';
  if (['product', 'course', 'point', 'line_card'].includes(payload.entity_type)) return 'UNRELATED_ENTITY_TYPE';
  return '';
}

function buildMotherDistributorPayload(row) {
  const status = String(row.status || 'pending').toLowerCase() === 'active'
    ? 'approved'
    : String(row.status || 'pending').toLowerCase();
  return {
    project: 'travelkeeper',
    entity_type: 'distributor',
    local_id: row.uid || '',
    uid: row.uid || '',
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    company_name: row.company_name || '',
    tax_id: row.tax_id || '',
    invite_code: row.invite_code || '',
    status,
    can_upload: Number(row.can_upload || 0) === 1,
    commission_pct: Number(row.commission_pct || 0),
    sales_revenue: Number(row.sales_revenue || 0),
    note: row.note || '',
    ref_uid: row.ref_uid || '',
    agency_slug: row.agency_slug || 'demo',
    profile: {
      avatar: row.avatar || '',
      bio: row.bio || '',
      oa_intro: row.oa_intro || '',
      line_link: row.line_link || '',
      line_at_link: row.line_at_link || '',
      line_at_id: row.line_at_id || '',
      fb_link: row.fb_link || '',
      ig_link: row.ig_link || '',
      web_link: row.web_link || '',
      map_link: row.map_link || '',
    },
    bank: {
      bank_name: row.bank_name || '',
      bank_branch: row.bank_branch || '',
      bank_account: row.bank_account || '',
      bank_holder: row.bank_holder || '',
    },
    joined_at: row.joined_at || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function buildMotherCustomerPayload(row) {
  return {
    project: 'travelkeeper',
    entity_type: 'customer',
    local_id: row.customer_phone || '',
    customer_phone: row.customer_phone || '',
    customer_name: row.customer_name || '',
    customer_line_uid: row.customer_line_uid || '',
    owner_uid: row.owner_uid || '',
    owner_name: row.owner_name || '',
    first_order_at: row.first_order_at || '',
    last_order_at: row.last_order_at || '',
    total_orders: Number(row.total_orders || 0),
    total_amount: Number(row.total_amount || 0),
    source: row.source || 'referral',
    note: row.note || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function buildMotherOrderPayload(row) {
  return {
    project: 'travelkeeper',
    entity_type: 'order',
    local_id: row.order_id || '',
    order_id: row.order_id || '',
    itinerary_id: row.itinerary_id || '',
    itinerary_title: row.itinerary_title || '',
    price: Number(row.price || 0),
    distributor_uid: row.distributor_uid || '',
    customer_name: row.customer_name || '',
    customer_phone: row.customer_phone || '',
    customer_line_uid: row.customer_line_uid || '',
    travelers: Number(row.travelers || 1),
    travel_date: row.travel_date || '',
    note: row.note || '',
    status: row.status || 'pending',
    commission_amount: Number(row.commission_amount || 0),
    total_amount: Number(row.total_amount || 0),
    deposit_amount: Number(row.deposit_amount || 0),
    balance_amount: Number(row.balance_amount || 0),
    payment_mode: row.payment_mode || 'deposit',
    balance_collect: row.balance_collect || 'online',
    deposit_status: row.deposit_status || 'unpaid',
    deposit_paid_at: row.deposit_paid_at || '',
    deposit_method: row.deposit_method || '',
    deposit_trade_no: row.deposit_trade_no || '',
    balance_status: row.balance_status || 'unpaid',
    balance_paid_at: row.balance_paid_at || '',
    balance_method: row.balance_method || '',
    balance_trade_no: row.balance_trade_no || '',
    commission_status: row.commission_status || 'pending',
    commission_settled_at: row.commission_settled_at || '',
    commission_paid_out_at: row.commission_paid_out_at || '',
    source: row.source || 'referral',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function buildMotherPaymentPayload(row) {
  return {
    project: 'travelkeeper',
    entity_type: 'payment',
    local_id: row.merchant_order_no || row.id || '',
    id: row.id || '',
    order_id: row.order_id || '',
    leg: row.leg || '',
    merchant_order_no: row.merchant_order_no || '',
    amount: Number(row.amount || 0),
    status: row.status || 'created',
    method: row.method || '',
    trade_no: row.trade_no || '',
    raw_notify_json: row.raw_notify_json || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function buildMotherCommissionPayload(row) {
  return {
    project: 'travelkeeper',
    entity_type: 'commission',
    local_id: row.order_id || '',
    order_id: row.order_id || '',
    itinerary_id: row.itinerary_id || '',
    itinerary_title: row.itinerary_title || '',
    distributor_uid: row.distributor_uid || '',
    customer_name: row.customer_name || '',
    customer_phone: row.customer_phone || '',
    order_status: row.status || 'pending',
    total_amount: Number(row.total_amount || 0),
    commission_amount: Number(row.commission_amount || 0),
    commission_status: row.commission_status || 'pending',
    commission_settled_at: row.commission_settled_at || '',
    commission_paid_out_at: row.commission_paid_out_at || '',
    source: row.source || 'referral',
    created_at: row.created_at || '',
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

async function d1UpsertMotherSyncMap(env, { entityType, localId, motherId = '', status, checksum = '', error = '' }) {
  const now = new Date().toISOString();
  const id = `${entityType}:${localId}`;
  await env.DB.prepare(`
    INSERT INTO mother_sync_map (
      id, entity_type, local_id, mother_id, direction, status, checksum,
      last_pushed_at, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'push', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, local_id) DO UPDATE SET
      mother_id = excluded.mother_id,
      direction = 'push',
      status = excluded.status,
      checksum = excluded.checksum,
      last_pushed_at = excluded.last_pushed_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).bind(id, entityType, localId, motherId, status, checksum, now, error, now, now).run();
}

async function exportItineraryToWasabiStorage(env, body = {}) {
  const id = String(body.id || body.itineraryId || '').trim();
  if (!id) return { success: false, error: 'MISSING_ITINERARY_ID' };
  const row = await d1GetItineraryDetail(env, id);
  if (!row) return { success: false, error: 'ITINERARY_NOT_FOUND' };

  const payload = buildMotherItineraryPayload(row);
  const validationError = validateTravelKeeperStoragePayload(payload);
  if (validationError) return { success: false, error: validationError };

  const config = getWasabiStorageConfig(env);
  const key = `${config.prefix}/itineraries/${safeStorageId(id)}.json`;
  const jsonBody = stableJson(payload);
  const checksum = await sha256Hex(jsonBody);
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';

  if (dryRun) {
    return { success: true, data: { dryRun: true, key, checksum, payload } };
  }
  if (!config.writeEnabled) return { success: false, error: 'MOTHER_STORAGE_WRITE_DISABLED' };

  const write = await wasabiFetch(env, 'PUT', key, { body: jsonBody, contentType: 'application/json' });
  if (!write.ok) {
    await d1UpsertMotherSyncMap(env, {
      entityType: 'itinerary',
      localId: id,
      motherId: key,
      status: 'failed',
      checksum,
      error: write.detail || `HTTP ${write.status}`,
    });
    return { success: false, error: 'WRITE_FAILED', data: { key, write } };
  }

  const read = await wasabiFetch(env, 'GET', key, { contentType: 'application/json' });
  const verified = read.ok && read.text === jsonBody;
  await d1UpsertMotherSyncMap(env, {
    entityType: 'itinerary',
    localId: id,
    motherId: key,
    status: verified ? 'synced' : 'failed',
    checksum,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
  });

  return {
    success: verified,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
    data: {
      key,
      checksum,
      write: { ok: write.ok, status: write.status },
      verify: { ok: read.ok, status: read.status, matches: verified },
    },
  };
}

async function d1GetPaymentDetail(env, id) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  return env.DB.prepare(
    'SELECT * FROM payment_attempts WHERE merchant_order_no = ? OR id = ?'
  ).bind(normalizedId, normalizedId).first();
}

async function exportPaymentToWasabiStorage(env, body = {}) {
  const id = String(body.merchantOrderNo || body.merchant_order_no || body.paymentId || body.id || '').trim();
  if (!id) return { success: false, error: 'MISSING_PAYMENT_ID' };
  const row = await d1GetPaymentDetail(env, id);
  if (!row) return { success: false, error: 'PAYMENT_NOT_FOUND' };

  const payload = buildMotherPaymentPayload(row);
  const validationError = validateTravelKeeperStoragePayload(payload);
  if (validationError) return { success: false, error: validationError };

  const config = getWasabiStorageConfig(env);
  const key = `${config.prefix}/payments/${safeStorageId(payload.local_id)}.json`;
  const jsonBody = stableJson(payload);
  const checksum = await sha256Hex(jsonBody);
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';

  if (dryRun) {
    return { success: true, data: { dryRun: true, key, checksum, payload } };
  }
  if (!config.writeEnabled) return { success: false, error: 'MOTHER_STORAGE_WRITE_DISABLED' };

  const write = await wasabiFetch(env, 'PUT', key, { body: jsonBody, contentType: 'application/json' });
  if (!write.ok) {
    await d1UpsertMotherSyncMap(env, {
      entityType: 'payment',
      localId: payload.local_id,
      motherId: key,
      status: 'failed',
      checksum,
      error: write.detail || `HTTP ${write.status}`,
    });
    return { success: false, error: 'WRITE_FAILED', data: { key, write } };
  }

  const read = await wasabiFetch(env, 'GET', key, { contentType: 'application/json' });
  const verified = read.ok && read.text === jsonBody;
  await d1UpsertMotherSyncMap(env, {
    entityType: 'payment',
    localId: payload.local_id,
    motherId: key,
    status: verified ? 'synced' : 'failed',
    checksum,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
  });

  return {
    success: verified,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
    data: {
      key,
      checksum,
      write: { ok: write.ok, status: write.status },
      verify: { ok: read.ok, status: read.status, matches: verified },
    },
  };
}

async function d1ListPaymentIdsForMotherExport(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';
  const maxBatch = dryRun ? 100 : 20;
  if (Array.isArray(body.ids) && body.ids.length) {
    return body.ids
      .map(id => String(id || '').trim())
      .filter(Boolean)
      .slice(0, maxBatch);
  }

  const limit = Math.min(Math.max(Number(body.limit || maxBatch), 1), maxBatch);
  const offset = Math.max(Number(body.offset || 0), 0);
  const orderId = String(body.orderId || body.order_id || '').trim();
  const status = String(body.status || '').trim();
  let query = "SELECT COALESCE(NULLIF(merchant_order_no, ''), id) AS id FROM payment_attempts WHERE id <> ''";
  const bind = [];
  if (orderId) {
    query += ' AND order_id = ?';
    bind.push(orderId);
  }
  if (status) {
    query += ' AND status = ?';
    bind.push(status);
  }
  query += ' ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?';
  bind.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...bind).all();
  return results.map(row => String(row.id || '').trim()).filter(Boolean);
}

async function exportPaymentsToWasabiStorage(env, body = {}) {
  const ids = await d1ListPaymentIdsForMotherExport(env, body);
  const results = [];
  for (const id of ids) {
    try {
      const result = await exportPaymentToWasabiStorage(env, { ...body, id });
      results.push({
        id,
        success: !!result.success,
        key: result.data?.key || '',
        checksum: result.data?.checksum || '',
        error: result.error || '',
      });
    } catch (err) {
      results.push({
        id,
        success: false,
        key: '',
        checksum: '',
        error: err?.message || 'EXPORT_FAILED',
      });
    }
  }

  return {
    success: results.every(item => item.success),
    data: {
      dryRun: body.dryRun === true || String(body.dryRun || '') === '1',
      requested: ids.length,
      synced: results.filter(item => item.success).length,
      failed: results.filter(item => !item.success).length,
      results,
    },
  };
}

async function exportCommissionToWasabiStorage(env, body = {}) {
  const id = String(body.orderId || body.order_id || body.id || '').trim();
  if (!id) return { success: false, error: 'MISSING_ORDER_ID' };
  const row = await d1GetOrderDetail(env, id);
  if (!row) return { success: false, error: 'ORDER_NOT_FOUND' };

  const payload = buildMotherCommissionPayload(row);
  const validationError = validateTravelKeeperStoragePayload(payload);
  if (validationError) return { success: false, error: validationError };

  const config = getWasabiStorageConfig(env);
  const key = `${config.prefix}/commissions/${safeStorageId(payload.local_id)}.json`;
  const jsonBody = stableJson(payload);
  const checksum = await sha256Hex(jsonBody);
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';

  if (dryRun) {
    return { success: true, data: { dryRun: true, key, checksum, payload } };
  }
  if (!config.writeEnabled) return { success: false, error: 'MOTHER_STORAGE_WRITE_DISABLED' };

  const write = await wasabiFetch(env, 'PUT', key, { body: jsonBody, contentType: 'application/json' });
  if (!write.ok) {
    await d1UpsertMotherSyncMap(env, {
      entityType: 'commission',
      localId: payload.local_id,
      motherId: key,
      status: 'failed',
      checksum,
      error: write.detail || `HTTP ${write.status}`,
    });
    return { success: false, error: 'WRITE_FAILED', data: { key, write } };
  }

  const read = await wasabiFetch(env, 'GET', key, { contentType: 'application/json' });
  const verified = read.ok && read.text === jsonBody;
  await d1UpsertMotherSyncMap(env, {
    entityType: 'commission',
    localId: payload.local_id,
    motherId: key,
    status: verified ? 'synced' : 'failed',
    checksum,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
  });

  return {
    success: verified,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
    data: {
      key,
      checksum,
      write: { ok: write.ok, status: write.status },
      verify: { ok: read.ok, status: read.status, matches: verified },
    },
  };
}

async function exportCommissionsToWasabiStorage(env, body = {}) {
  const ids = await d1ListOrderIdsForMotherExport(env, body);
  const results = [];
  for (const id of ids) {
    try {
      const result = await exportCommissionToWasabiStorage(env, { ...body, id });
      results.push({
        id,
        success: !!result.success,
        key: result.data?.key || '',
        checksum: result.data?.checksum || '',
        error: result.error || '',
      });
    } catch (err) {
      results.push({
        id,
        success: false,
        key: '',
        checksum: '',
        error: err?.message || 'EXPORT_FAILED',
      });
    }
  }

  return {
    success: results.every(item => item.success),
    data: {
      dryRun: body.dryRun === true || String(body.dryRun || '') === '1',
      requested: ids.length,
      synced: results.filter(item => item.success).length,
      failed: results.filter(item => !item.success).length,
      results,
    },
  };
}

async function d1GetOrderDetail(env, id) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  return env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(normalizedId).first();
}

async function exportOrderToWasabiStorage(env, body = {}) {
  const id = String(body.orderId || body.order_id || body.id || '').trim();
  if (!id) return { success: false, error: 'MISSING_ORDER_ID' };
  const row = await d1GetOrderDetail(env, id);
  if (!row) return { success: false, error: 'ORDER_NOT_FOUND' };

  const payload = buildMotherOrderPayload(row);
  const validationError = validateTravelKeeperStoragePayload(payload);
  if (validationError) return { success: false, error: validationError };

  const config = getWasabiStorageConfig(env);
  const key = `${config.prefix}/orders/${safeStorageId(payload.local_id)}.json`;
  const jsonBody = stableJson(payload);
  const checksum = await sha256Hex(jsonBody);
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';

  if (dryRun) {
    return { success: true, data: { dryRun: true, key, checksum, payload } };
  }
  if (!config.writeEnabled) return { success: false, error: 'MOTHER_STORAGE_WRITE_DISABLED' };

  const write = await wasabiFetch(env, 'PUT', key, { body: jsonBody, contentType: 'application/json' });
  if (!write.ok) {
    await d1UpsertMotherSyncMap(env, {
      entityType: 'order',
      localId: payload.local_id,
      motherId: key,
      status: 'failed',
      checksum,
      error: write.detail || `HTTP ${write.status}`,
    });
    return { success: false, error: 'WRITE_FAILED', data: { key, write } };
  }

  const read = await wasabiFetch(env, 'GET', key, { contentType: 'application/json' });
  const verified = read.ok && read.text === jsonBody;
  await d1UpsertMotherSyncMap(env, {
    entityType: 'order',
    localId: payload.local_id,
    motherId: key,
    status: verified ? 'synced' : 'failed',
    checksum,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
  });

  return {
    success: verified,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
    data: {
      key,
      checksum,
      write: { ok: write.ok, status: write.status },
      verify: { ok: read.ok, status: read.status, matches: verified },
    },
  };
}

async function d1ListOrderIdsForMotherExport(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';
  const maxBatch = dryRun ? 100 : 20;
  if (Array.isArray(body.ids) && body.ids.length) {
    return body.ids
      .map(id => String(id || '').trim())
      .filter(Boolean)
      .slice(0, maxBatch);
  }

  const limit = Math.min(Math.max(Number(body.limit || maxBatch), 1), maxBatch);
  const offset = Math.max(Number(body.offset || 0), 0);
  const distributorUid = String(body.distributorUid || body.distributor_uid || '').trim();
  const status = String(body.status || '').trim();
  let query = "SELECT order_id FROM orders WHERE order_id <> ''";
  const bind = [];
  if (distributorUid) {
    query += ' AND distributor_uid = ?';
    bind.push(distributorUid);
  }
  if (status) {
    query += ' AND status = ?';
    bind.push(status);
  }
  query += ' ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?';
  bind.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...bind).all();
  return results.map(row => String(row.order_id || '').trim()).filter(Boolean);
}

async function exportOrdersToWasabiStorage(env, body = {}) {
  const ids = await d1ListOrderIdsForMotherExport(env, body);
  const results = [];
  for (const id of ids) {
    try {
      const result = await exportOrderToWasabiStorage(env, { ...body, id });
      results.push({
        id,
        success: !!result.success,
        key: result.data?.key || '',
        checksum: result.data?.checksum || '',
        error: result.error || '',
      });
    } catch (err) {
      results.push({
        id,
        success: false,
        key: '',
        checksum: '',
        error: err?.message || 'EXPORT_FAILED',
      });
    }
  }

  return {
    success: results.every(item => item.success),
    data: {
      dryRun: body.dryRun === true || String(body.dryRun || '') === '1',
      requested: ids.length,
      synced: results.filter(item => item.success).length,
      failed: results.filter(item => !item.success).length,
      results,
    },
  };
}

async function d1GetCustomerDetail(env, id) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  return env.DB.prepare(
    `SELECT * FROM customers WHERE customer_phone = ? OR customer_line_uid = ?`
  ).bind(normalizedId, normalizedId).first();
}

async function exportCustomerToWasabiStorage(env, body = {}) {
  const id = String(body.customerPhone || body.customer_phone || body.id || '').trim();
  if (!id) return { success: false, error: 'MISSING_CUSTOMER_ID' };
  const row = await d1GetCustomerDetail(env, id);
  if (!row) return { success: false, error: 'CUSTOMER_NOT_FOUND' };

  const payload = buildMotherCustomerPayload(row);
  const validationError = validateTravelKeeperStoragePayload(payload);
  if (validationError) return { success: false, error: validationError };

  const config = getWasabiStorageConfig(env);
  const key = `${config.prefix}/customers/${safeStorageId(payload.local_id)}.json`;
  const jsonBody = stableJson(payload);
  const checksum = await sha256Hex(jsonBody);
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';

  if (dryRun) {
    return { success: true, data: { dryRun: true, key, checksum, payload } };
  }
  if (!config.writeEnabled) return { success: false, error: 'MOTHER_STORAGE_WRITE_DISABLED' };

  const write = await wasabiFetch(env, 'PUT', key, { body: jsonBody, contentType: 'application/json' });
  if (!write.ok) {
    await d1UpsertMotherSyncMap(env, {
      entityType: 'customer',
      localId: payload.local_id,
      motherId: key,
      status: 'failed',
      checksum,
      error: write.detail || `HTTP ${write.status}`,
    });
    return { success: false, error: 'WRITE_FAILED', data: { key, write } };
  }

  const read = await wasabiFetch(env, 'GET', key, { contentType: 'application/json' });
  const verified = read.ok && read.text === jsonBody;
  await d1UpsertMotherSyncMap(env, {
    entityType: 'customer',
    localId: payload.local_id,
    motherId: key,
    status: verified ? 'synced' : 'failed',
    checksum,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
  });

  return {
    success: verified,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
    data: {
      key,
      checksum,
      write: { ok: write.ok, status: write.status },
      verify: { ok: read.ok, status: read.status, matches: verified },
    },
  };
}

async function d1ListCustomerIdsForMotherExport(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';
  const maxBatch = dryRun ? 100 : 20;
  if (Array.isArray(body.ids) && body.ids.length) {
    return body.ids
      .map(id => String(id || '').trim())
      .filter(Boolean)
      .slice(0, maxBatch);
  }

  const limit = Math.min(Math.max(Number(body.limit || maxBatch), 1), maxBatch);
  const offset = Math.max(Number(body.offset || 0), 0);
  const ownerUid = String(body.ownerUid || body.owner_uid || '').trim();
  let query = "SELECT customer_phone FROM customers WHERE customer_phone <> ''";
  const bind = [];
  if (ownerUid) {
    query += ' AND owner_uid = ?';
    bind.push(ownerUid);
  }
  query += ' ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?';
  bind.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...bind).all();
  return results.map(row => String(row.customer_phone || '').trim()).filter(Boolean);
}

async function exportCustomersToWasabiStorage(env, body = {}) {
  const ids = await d1ListCustomerIdsForMotherExport(env, body);
  const results = [];
  for (const id of ids) {
    try {
      const result = await exportCustomerToWasabiStorage(env, { ...body, id });
      results.push({
        id,
        success: !!result.success,
        key: result.data?.key || '',
        checksum: result.data?.checksum || '',
        error: result.error || '',
      });
    } catch (err) {
      results.push({
        id,
        success: false,
        key: '',
        checksum: '',
        error: err?.message || 'EXPORT_FAILED',
      });
    }
  }

  return {
    success: results.every(item => item.success),
    data: {
      dryRun: body.dryRun === true || String(body.dryRun || '') === '1',
      requested: ids.length,
      synced: results.filter(item => item.success).length,
      failed: results.filter(item => !item.success).length,
      results,
    },
  };
}

async function d1GetDistributorDetail(env, uid) {
  if (!env.DB) throw new Error('D1 binding missing');
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return null;
  return env.DB.prepare('SELECT * FROM distributors WHERE uid = ?').bind(normalizedUid).first();
}

async function exportDistributorToWasabiStorage(env, body = {}) {
  const uid = String(body.uid || body.id || '').trim();
  if (!uid) return { success: false, error: 'MISSING_DISTRIBUTOR_UID' };
  const row = await d1GetDistributorDetail(env, uid);
  if (!row) return { success: false, error: 'DISTRIBUTOR_NOT_FOUND' };

  const payload = buildMotherDistributorPayload(row);
  const validationError = validateTravelKeeperStoragePayload(payload);
  if (validationError) return { success: false, error: validationError };

  const config = getWasabiStorageConfig(env);
  const key = `${config.prefix}/distributors/${safeStorageId(uid)}.json`;
  const jsonBody = stableJson(payload);
  const checksum = await sha256Hex(jsonBody);
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';

  if (dryRun) {
    return { success: true, data: { dryRun: true, key, checksum, payload } };
  }
  if (!config.writeEnabled) return { success: false, error: 'MOTHER_STORAGE_WRITE_DISABLED' };

  const write = await wasabiFetch(env, 'PUT', key, { body: jsonBody, contentType: 'application/json' });
  if (!write.ok) {
    await d1UpsertMotherSyncMap(env, {
      entityType: 'distributor',
      localId: uid,
      motherId: key,
      status: 'failed',
      checksum,
      error: write.detail || `HTTP ${write.status}`,
    });
    return { success: false, error: 'WRITE_FAILED', data: { key, write } };
  }

  const read = await wasabiFetch(env, 'GET', key, { contentType: 'application/json' });
  const verified = read.ok && read.text === jsonBody;
  await d1UpsertMotherSyncMap(env, {
    entityType: 'distributor',
    localId: uid,
    motherId: key,
    status: verified ? 'synced' : 'failed',
    checksum,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
  });

  return {
    success: verified,
    error: verified ? '' : 'VERIFY_READ_MISMATCH',
    data: {
      key,
      checksum,
      write: { ok: write.ok, status: write.status },
      verify: { ok: read.ok, status: read.status, matches: verified },
    },
  };
}

async function d1ListDistributorIdsForMotherExport(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';
  const maxBatch = dryRun ? 100 : 20;
  if (Array.isArray(body.ids) && body.ids.length) {
    return body.ids
      .map(id => String(id || '').trim())
      .filter(Boolean)
      .slice(0, maxBatch);
  }

  const limit = Math.min(Math.max(Number(body.limit || maxBatch), 1), maxBatch);
  const offset = Math.max(Number(body.offset || 0), 0);
  const status = String(body.status || '').trim();
  let query = 'SELECT uid FROM distributors WHERE 1 = 1';
  const bind = [];
  if (status) {
    query += ' AND status = ?';
    bind.push(status);
  }
  query += ' ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?';
  bind.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...bind).all();
  return results.map(row => String(row.uid || '').trim()).filter(Boolean);
}

async function exportDistributorsToWasabiStorage(env, body = {}) {
  const ids = await d1ListDistributorIdsForMotherExport(env, body);
  const results = [];
  for (const uid of ids) {
    try {
      const result = await exportDistributorToWasabiStorage(env, { ...body, uid });
      results.push({
        uid,
        success: !!result.success,
        key: result.data?.key || '',
        checksum: result.data?.checksum || '',
        error: result.error || '',
      });
    } catch (err) {
      results.push({
        uid,
        success: false,
        key: '',
        checksum: '',
        error: err?.message || 'EXPORT_FAILED',
      });
    }
  }

  return {
    success: results.every(item => item.success),
    data: {
      dryRun: body.dryRun === true || String(body.dryRun || '') === '1',
      requested: ids.length,
      synced: results.filter(item => item.success).length,
      failed: results.filter(item => !item.success).length,
      results,
    },
  };
}

async function d1ListItineraryIdsForMotherExport(env, body = {}) {
  if (!env.DB) throw new Error('D1 binding missing');
  const dryRun = body.dryRun === true || String(body.dryRun || '') === '1';
  const maxBatch = dryRun ? 100 : 20;
  if (Array.isArray(body.ids) && body.ids.length) {
    return body.ids
      .map(id => String(id || '').trim())
      .filter(Boolean)
      .slice(0, maxBatch);
  }

  const limit = Math.min(Math.max(Number(body.limit || maxBatch), 1), maxBatch);
  const offset = Math.max(Number(body.offset || 0), 0);
  const includeDeleted = body.includeDeleted === true || String(body.includeDeleted || '') === '1';
  const status = String(body.status || '').trim();
  let query = 'SELECT id FROM itineraries WHERE 1 = 1';
  const bind = [];

  if (!includeDeleted) query += " AND (deleted_at IS NULL OR deleted_at = '')";
  if (status) {
    query += ' AND review_status = ?';
    bind.push(status);
  }
  query += ' ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?';
  bind.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...bind).all();
  return results.map(row => String(row.id || '').trim()).filter(Boolean);
}

async function exportItinerariesToWasabiStorage(env, body = {}) {
  const ids = await d1ListItineraryIdsForMotherExport(env, body);
  const results = [];
  for (const id of ids) {
    try {
      const result = await exportItineraryToWasabiStorage(env, { ...body, id });
      results.push({
        id,
        success: !!result.success,
        key: result.data?.key || '',
        checksum: result.data?.checksum || '',
        error: result.error || '',
      });
    } catch (err) {
      results.push({
        id,
        success: false,
        key: '',
        checksum: '',
        error: err?.message || 'EXPORT_FAILED',
      });
    }
  }

  return {
    success: results.every(item => item.success),
    data: {
      dryRun: body.dryRun === true || String(body.dryRun || '') === '1',
      requested: ids.length,
      synced: results.filter(item => item.success).length,
      failed: results.filter(item => !item.success).length,
      results,
    },
  };
}

function getMotherApiBaseUrl(env) {
  return String(env.MOTHER_API_BASE_URL || '').trim().replace(/\/+$/, '');
}

function buildMotherConfig(env) {
  return {
    enabled: String(env.MOTHER_SYNC_ENABLED || '0') === '1',
    hasBaseUrl: !!getMotherApiBaseUrl(env),
    hasApiKey: !!env.MOTHER_API_KEY,
    hasHmacSecret: !!env.MOTHER_HMAC_SECRET,
  };
}

async function signedMotherFetch(env, path, options = {}) {
  const baseUrl = getMotherApiBaseUrl(env);
  if (!baseUrl) return { ok: false, status: 'missing', detail: 'MOTHER_API_BASE_URL not configured' };
  if (!env.MOTHER_API_KEY) return { ok: false, status: 'missing', detail: 'MOTHER_API_KEY not configured' };
  if (!env.MOTHER_HMAC_SECRET) return { ok: false, status: 'missing', detail: 'MOTHER_HMAC_SECRET not configured' };

  const method = options.method || 'GET';
  const body = options.body || '';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Hex(env.MOTHER_HMAC_SECRET, `${timestamp}.${body}`);
  const headers = {
    'Authorization': `Bearer ${env.MOTHER_API_KEY}`,
    'X-TK-Timestamp': timestamp,
    'X-TK-Signature': `sha256=${signature}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    return {
      ok: res.ok,
      status: res.status,
      detail: res.ok ? 'ok' : text.slice(0, 160),
      data,
    };
  } catch (err) {
    return { ok: false, status: 'error', detail: err.message || String(err) };
  }
}

async function buildMotherHealthStatus(env) {
  const config = buildMotherConfig(env);
  const db = env.DB
    ? await checkMotherSyncTable(env)
    : { ok: false, status: 'missing', detail: 'D1 binding missing' };
  const mother = config.hasBaseUrl && config.hasApiKey && config.hasHmacSecret
    ? await signedMotherFetch(env, '/health')
    : { ok: false, status: 'missing', detail: 'Mother API env vars not fully configured' };
  const storage = await checkWasabiTravelKeeperStorage(env);

  return {
    db,
    mother,
    storage,
    config,
    endpoints: {
      health: config.hasBaseUrl ? `${getMotherApiBaseUrl(env)}/health` : '',
    },
  };
}

async function checkMotherSyncTable(env) {
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM mother_sync_map`).first();
    return { ok: true, status: 'ok', detail: `${Number(row?.count || 0)} sync records` };
  } catch (err) {
    return { ok: false, status: 'error', detail: err.message || String(err) };
  }
}

function renderHubTestHtml(status, origin) {
  const row = (label, item) => {
    const color = item.ok ? '#16a34a' : '#dc2626';
    return       `
      <div style="display:flex;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid #e2e8f0;">
        <div>
          <div style="font-weight:900;font-size:18px;">${label}</div>
          <div style="color:#64748b;font-size:14px;margin-top:4px;">${item.detail || '-'}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:900;color:${color};">${item.ok ? 'OK' : 'FAIL'}</div>
          <div style="color:#64748b;font-size:13px;margin-top:4px;">${item.status}</div>
        </div>
      </div>
    `;
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Webhook Diagnostics | TravelKeeper</title>
  <style>
    body { font-family: Arial, sans-serif; background:#f8fafc; color:#0f172a; margin:0; }
    .wrap { max-width: 1040px; margin:0 auto; padding:32px 20px 60px; }
    .card { background:#fff; border:1px solid #e2e8f0; border-radius:24px; padding:28px; box-shadow:0 10px 30px rgba(15,23,42,.04); }
    .pill { display:inline-block; padding:8px 12px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-weight:700; font-size:13px; margin-right:8px; margin-bottom:8px; }
    code { background:#f1f5f9; padding:2px 6px; border-radius:8px; }
    a { color:#2563eb; }
  </style>
</head>
<body>
  <div class="wrap">
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:20px;">
      <div>
        <div style="font-size:12px;font-weight:900;color:#94a3b8;letter-spacing:.18em;text-transform:uppercase;">Webhook Diagnostics</div>
        <h1 style="font-size:40px;line-height:1.1;margin:10px 0 8px;font-weight:900;">Dual Webhook Diagnostics</h1>
        <p style="margin:0;color:#64748b;font-size:16px;">Check Worker, GAS, secondary system, and LINE reply connectivity.</p>
      </div>
      <a href="${origin}/ai-guide-system.html" style="display:inline-block;padding:12px 16px;border-radius:14px;background:#0f172a;color:#fff;text-decoration:none;font-weight:800;">Open AI Guide System</a>
    </div>
    <div class="card">
      ${row('GAS backend', status.gas)}
      ${row('Secondary system', status.forward)}
      ${row('LINE Bot Token', status.line)}
      <div style="padding-top:18px;">
        <div style="font-weight:900;font-size:18px;margin-bottom:12px;">Environment flags</div>
        <div>
          <span class="pill">GAS_URL: ${status.config.hasGasUrl ? 'configured' : 'missing'}</span>
          <span class="pill">LINE_CHANNEL_SECRET: ${status.config.hasLineSecret ? 'configured' : 'missing'}</span>
          <span class="pill">LINE_CHANNEL_ACCESS_TOKEN: ${status.config.hasLineToken ? 'configured' : 'missing'}</span>
          <span class="pill">FORWARD_WEBHOOK_URL: ${status.config.hasForwardWebhook ? 'configured' : 'missing'}</span>
        </div>
      </div>
      <div style="padding-top:18px;">
        <div style="font-weight:900;font-size:18px;margin-bottom:12px;">Deployment notes</div>
        <ul style="margin:0;padding-left:18px;color:#475569;line-height:1.8;">
          <li>Set LINE Webhook URL to <code>${origin}/line-webhook</code></li>
          <li>Set <code>FORWARD_WEBHOOK_URL</code> if a second system should receive the same event</li>
          <li>GAS should return <code>{ replyPayload: { replyToken, messages } }</code> or <code>{ data: { replyPayload } }</code></li>
        </ul>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    try {

      if (path === '/line-webhook' && request.method === 'POST') {
        return await handleLineWebhookGateway(request, env, ctx);
      }

      if (path === '/hub-test' && request.method === 'GET') {
        const status = await buildHubTestStatus(env);
        return new Response(renderHubTestHtml(status, url.origin), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=UTF-8', ...CORS },
        });
      }

      if (path === '/api/hub-test' && request.method === 'GET') {
        const status = await buildHubTestStatus(env);
        return json({ success: true, data: status });
      }

      if (path === '/api/mother/health' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const status = await buildMotherHealthStatus(env);
        return json({ success: true, data: status });
      }

      if (path === '/api/mother/storage-probe' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await runWasabiTravelKeeperProbe(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/mother/export-itinerary' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportItineraryToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/mother/export-itineraries' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportItinerariesToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 207);
      }

      if (path === '/api/mother/export-distributor' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportDistributorToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/mother/export-distributors' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportDistributorsToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 207);
      }

      if (path === '/api/mother/export-customer' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportCustomerToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/mother/export-customers' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportCustomersToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 207);
      }

      if (path === '/api/mother/export-order' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportOrderToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/mother/export-orders' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportOrdersToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 207);
      }

      if (path === '/api/mother/export-payment' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportPaymentToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/mother/export-payments' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportPaymentsToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 207);
      }

      if (path === '/api/mother/export-commission' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportCommissionToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/mother/export-commissions' && request.method === 'POST') {
        const body = await request.json();
        const operatorUid = String(body.operatorUid || body.adminUid || '').trim();
        if (!operatorUid) return json({ success: false, error: 'MISSING_OPERATOR_UID' }, 400);
        if (!ADMIN_UIDS.has(operatorUid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await exportCommissionsToWasabiStorage(env, body);
        return json(result, result.success ? 200 : 207);
      }

      if (path === '/api/wasabi/imports/summary' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        return json(await d1GetWasabiImportSummary(env));
      }

      if (path === '/api/wasabi/imports' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        return json(await d1GetWasabiImportRecords(env, {
          group: url.searchParams.get('group') || '',
          search: url.searchParams.get('search') || '',
          limit: url.searchParams.get('limit') || '80',
          offset: url.searchParams.get('offset') || '0',
        }));
      }

      if (path === '/api/wasabi/imports/classify' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await d1ClassifyWasabiImportRecord(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/wasabi/imports/dry-run' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        return json(await d1DryRunWasabiProductionImport(env, {
          target: url.searchParams.get('target') || '',
          limit: url.searchParams.get('limit') || '200',
        }));
      }

      if (path === '/api/wasabi/imports/apply' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await d1ApplyWasabiProductionImport(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/line-oa/threads' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: '???' }, 403);
        return json(await d1GetLineThreads(env));
      }

      if (path === '/api/line-oa/thread' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        const threadId = url.searchParams.get('id') || '';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        if (!threadId) return json({ success: false, error: '蝻箏??予摰?id' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: '???' }, 403);
        const result = await d1GetLineThread(env, threadId);
        return json(result, result.success ? 200 : 404);
      }

      if (path === '/api/line-oa/profile-debug' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        const threadId = url.searchParams.get('id') || '';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        if (!threadId) return json({ success: false, error: '蝻箏? thread id' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: '???' }, 403);
        const result = await d1DebugLineThreadProfile(env, threadId);
        return json(result, result.success ? 200 : 404);
      }

      if (path === '/api/line-oa/backfill-names' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        const limit = url.searchParams.get('limit') || '100';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: '???' }, 403);
        const result = await d1BackfillLineThreadProfiles(env, limit);
        return json(result);
      }

      if (path === '/api/line-oa/thread' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: '???' }, 403);
        const result = await d1UpdateLineThread(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/line-oa/reply' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await d1SendLineOaReply(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/line-oa/rich-menu/publish' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await publishLineRichMenu(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/line-oa/visitor-record' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await d1UpsertLineVisitorRequirement(env, body);
        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/line-oa/visitor-record/archive' && request.method === 'POST') {
        const body = await request.json();
        const uid = String(body.uid || '').trim();
        if (!uid) return json({ success: false, error: 'MISSING_UID' }, 400);
        if (!ADMIN_UIDS.has(uid)) return json({ success: false, error: 'FORBIDDEN' }, 403);
        const result = await d1ArchiveLineVisitorRequirement(env, body);
        return json(result, result.success ? 200 : 400);
      }

      // ??????????????????????????????????????????????????????????
      // GET /api/app-init?uid=xxx
      // ???垢????甈⊥??嚗?唳???閬?鞈?
      //   ?嚗 itineraries, user, orders, distStats? }
      // ??????????????????????????????????????????????????????????
      if (path === '/api/app-init' && request.method === 'GET') {
        const uid = url.searchParams.get('uid');

        // 銝西???嚗?蝔?銵?+ ?冽???
        const [itinRaw, userRaw] = await Promise.all([
          readItinerariesWithFallback(env, {}),
          uid ? readCheckUserStatusWithFallback(env, uid) : Promise.resolve(null),
        ]);

        const itineraries = Array.isArray(itinRaw) ? itinRaw : [];
        const user        = userRaw?.success ? userRaw.data : null;

        // ?交???憿??踵平蝮橘??交蝞∠??∴???CRM ?
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

      // ??????????????????????????????????????????????????????????
      // POST /api/build-flex
      // POST /api/flex/build
      // ???垢?喳銵? IDs + 閮剖?嚗orker ?蝯?憟賜? Flex JSON
      //   body: { ids / itineraryIds, mode, uid, ctaText, socFields, agencySlug, inviteCode }
      // ??????????????????????????????????????????????????????????
      if ((path === '/api/build-flex' || path === '/api/flex/build') && request.method === 'POST') {
        const body = await request.json();
        const {
          ids = [],
          itineraryIds = [],
          mode = 'single',
          uid = '',
          ctaText = '查看完整行程',
          centerText = '心動就要行動！回饋都在這',
          socFields = {},
          agencySlug = 'demo',
          inviteCode = '',
        } = body;
        const finalIds = (Array.isArray(itineraryIds) && itineraryIds.length > 0 ? itineraryIds : ids).map(String);

        // ???嗾蝑?蝔?
        const itinRaw = await readItinerariesWithFallback(env, {});
        const all     = Array.isArray(itinRaw) ? itinRaw : [];
        const items   = finalIds.map(id => all.find(i => String(i.id || i.timestamp || '') === String(id))).filter(Boolean);

        if (items.length === 0) return json({ success: false, error: '???????' }, 400);
        if (mode === 'travel6' && items.length !== 6) {
          return json({ success: false, error: '旅遊六宮格需要剛好 6 個行程' }, 400);
        }

        // LIFF ID 敺?config ?選?雿???? URL ???典?
        const cfgRes = await readConfigWithFallback(env, agencySlug);
        const liffId = cfgRes?.data?.liff_id || '';

        // ?舐窗??
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

        // ???? URL嚗IFF嚗?
        const inviteParam = inviteCode ? `&invite=${encodeURIComponent(inviteCode)}` : '';
        const buildBookingUri = (itineraryId) =>
          liffId
            ? `https://liff.line.me/${liffId}/booking.html?a=${agencySlug}&itinerary=${itineraryId}&ref=${uid}${inviteParam}`
            : `${ENDPOINT}booking.html?a=${agencySlug}&itinerary=${itineraryId}&ref=${uid}${inviteParam}`;

        // ??銵?閰單???URL ??摰Ｘ?汗??tour.html嚗?閰單???銝璆剖?撌亙嚗?
        const buildDetailUri = (itineraryId) =>
          `${ENDPOINT}tour.html?t=${itineraryId}&r=${uid}&a=${agencySlug}${inviteParam}`;

        const safeImageUrl = (url, fallback = 'https://via.placeholder.com/1040x1040') => {
          const value = String(url || '').trim();
          return /^https:\/\//i.test(value) ? value : fallback;
        };

        const shortText = (value, fallback = '') => {
          const text = String(value || fallback || '').replace(/\s+/g, ' ').trim();
          return text.length > 34 ? `${text.slice(0, 33)}…` : text;
        };

        const actionLabel = (value, fallback = '查看完整行程') => {
          const text = String(value || fallback || '').replace(/\s+/g, ' ').trim();
          return text.length > 20 ? `${text.slice(0, 19)}…` : text;
        };

        // ?? ?桀撐 / 璈怠?頛芣 ?剁?摰憭批嚗ero ??+ 閰喟敦鞈? + 蝡??嚗?
        const makeBubble = (tour) => {
          const id  = String(tour.id || tour.timestamp || '');
          const detailUri = buildDetailUri(id);
          const bookUri = buildBookingUri(id);
          return {
            type: 'bubble', size: 'mega',
            hero: { type: 'image', url: tour.image || 'https://via.placeholder.com/800x520', size: 'full', aspectRatio: '20:13', aspectMode: 'cover', gravity: 'top', action: { type: 'uri', uri: detailUri } },
            body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', contents: [
              { type: 'text', text: tour.title, weight: 'bold', size: 'lg', wrap: true, color: '#0f172a' },
              { type: 'text', text: `${tour.region || ''} · ${tour.days || ''}天`, size: 'sm', color: '#64748b', margin: 'sm' },
              { type: 'text', text: `TWD ${Number(tour.price).toLocaleString()}`, weight: 'bold', size: 'xl', color: '#b82337', margin: 'md' },
            ]},
            footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
              { type: 'button', style: 'primary', color: '#b82337', height: 'md', action: { type: 'uri', label: '立即預約', uri: bookUri } },
              { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: ctaText, uri: detailUri } },
              ...socBtns
            ]}
          };
        };

        // ?? ?”璅∪?嚗??函 LINE 摰 list bubble 蝭?蝯?
        //   瘥?蝔?= 銝?蝡? box嚗?恬?蝮桀? + 璅? + ?航?閮?+ ?寞
        //   ???寞? A嚗憛??脯底????model.html)嚗?蝝?閰單??ㄐ????
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
                gravity: 'top',
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
                    text: [tour.region || '', tour.days ? `${tour.days}天` : ''].filter(Boolean).join('  ·  '),
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

        const makeTravelSixTile = (tour) => {
          const id = String(tour.id || tour.timestamp || '');
          const detailUri = buildDetailUri(id);
          const price = Number(tour.price || 0);
          const caption = [
            shortText(tour.title || '精選行程'),
            price > 0 ? `NT$${price.toLocaleString()}` : ''
          ].filter(Boolean).join('｜');
          return {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            cornerRadius: '10px',
            backgroundColor: '#ffffff',
            action: { type: 'uri', uri: detailUri },
            contents: [
              {
                type: 'image',
                url: safeImageUrl(tour.image),
                size: 'full',
                aspectRatio: '1:1',
                aspectMode: 'cover',
                gravity: 'top'
              },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#fffbe6',
                paddingAll: '6px',
                contents: [
                  {
                    type: 'text',
                    text: caption || '查看行程',
                    size: 'xxs',
                    weight: 'bold',
                    color: '#334155',
                    align: 'center',
                    wrap: true,
                    maxLines: 2
                  }
                ]
              }
            ]
          };
        };

        const makeTravelSixRow = (rowItems) => ({
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          contents: rowItems.map(makeTravelSixTile)
        });

        let flex;
        if (mode === 'travel6') {
          const titleText = shortText(centerText, '心動就要行動！回饋都在這');
          const firstId = String(items[0]?.id || items[0]?.timestamp || '');
          const shareText = [
            titleText,
            buildDetailUri(firstId)
          ].join('\n');
          const footerButtons = [
            {
              type: 'button',
              style: 'primary',
              color: '#06c755',
              height: 'sm',
              action: {
                type: 'uri',
                label: '分享行程清單',
                uri: `https://line.me/R/share?text=${encodeURIComponent(shareText)}`
              }
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: {
                type: 'uri',
                label: actionLabel(ctaText, '查看完整行程'),
                uri: buildDetailUri(firstId)
              }
            },
            ...socBtns
          ];
          const travelBubble = {
            type: 'bubble',
            size: 'giga',
            body: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#15569a',
              paddingAll: '18px',
              spacing: 'lg',
              contents: [
                makeTravelSixRow(items.slice(0, 3)),
                {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'sm',
                  paddingAll: '6px',
                  contents: [
                    { type: 'text', text: 'LINE 旅遊', color: '#ffffff', weight: 'bold', size: 'lg', align: 'center' },
                    { type: 'text', text: titleText, color: '#ffffff', weight: 'bold', size: 'xl', align: 'center', wrap: true }
                  ]
                },
                makeTravelSixRow(items.slice(3, 6))
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '14px',
              contents: footerButtons
            }
          };
          flex = {
            type: 'flex',
            altText: `精選 6 款旅遊行程：${titleText}`,
            contents: travelBubble
          };
        } else if (mode === 'multi' || mode === 'list') {
          // ???”璅∪?嚗銝 bubble嚗?蝑?蝔?? separator ??
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
                { type: 'text', text: '精選行程推薦', weight: 'bold', color: '#ffffff', size: 'lg' },
                { type: 'text', text: `共 ${items.length} 筆行程`, color: '#94a3b8', size: 'sm', margin: 'xs' }
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
            altText: `精選行程：${items[0].title} 等 ${items.length} 筆`,
            contents: listBubble
          };
        } else {
          const bubbles = items.map(makeBubble);
          flex = { type: 'flex', altText: `行程推薦：${items[0].title}`, contents: mode === 'carousel' ? { type: 'carousel', contents: bubbles } : bubbles[0] };
        }

        return json({ success: true, flex, message: flex, count: items.length });
      }

      // ??????????????????????????????????????????????????????????
      // POST /api/orders/create
      // ??booking.html ??? ??撖?Sheets ????Telegram 蝯血??瑕?
      //   body: { itinerary_id, distributor_uid, customer_*, travelers, travel_date, note }
      // ??????????????????????????????????????????????????????????
      if (path === '/api/orders/create' && request.method === 'POST') {
        const body       = await request.json();
        const agencySlug = url.searchParams.get('a') || 'demo';

        // ?箸撽?
        const required = ['itinerary_id', 'distributor_uid', 'customer_name', 'customer_phone'];
        for (const f of required) {
          if (!body[f]) return json({ success: false, error: `蝻箏?甈?嚗?{f}` }, 400);
        }

        // 1. ?澆 GAS 撖怨??殷?GAS 蝡舀??亥?蝔???雿???神 Orders嚗?
        const result = env.DB
          ? await d1CreateOrder(env, body, agencySlug)
          : await gasPost(env, {
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
              source: body.source || 'referral',
            });

        if (!result.success) {
          return json({ success: false, error: result.error || '閮撱箇?憭望?' }, 500);
        }

        // 2. ??Telegram ?嚗閰脣??瑕??芸楛??Bot嚗仃?????殷?
        const dist  = result.data.distributor;
        const order = result.data.order;
        const tgToken  = dist?.tgToken  || dist?.tgtoken  || '';
        const tgChatId = dist?.tgChatId || dist?.tgchatid || '';
        if (tgToken && tgChatId) {
          try {
            await sendTelegramNotification(tgToken, tgChatId, order);
          } catch (tgErr) {
            console.error('Telegram notify failed:', tgErr.message);
            // 閮撌脫?蝡??憭望??芾? log
          }
        }

        return json({
          success: true,
          data: { order_id: order.order_id }
        });
      }

      // ??????????????????????????????????????????????????????????
      // POST /api/upload-image  嚗2 ??銝嚗?
      // ??????????????????????????????????????????????????????????
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

      if (path === '/api/itinerary/fix-section-image' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const searchPlan = await buildSectionImageSearchPlan(body, env);
        const fixed = await createFixedSectionImage(searchPlan.queries, env);
        if (!fixed?.url) return json({ success: false, error: '圖片修補失敗' }, 500);
        return json({
          success: true,
          url: fixed.url,
          keyword: searchPlan.keyword,
          queries: searchPlan.queries,
          sourceQuery: fixed.sourceQuery || '',
          sourceUrl: fixed.sourceUrl || '',
        });
      }

      // ??????????????????????????????????????????????????????????
      // POST /api/upload-dm  嚗I DM 閫??嚗?
      // ??????????????????????????????????????????????????????????
      if (path === '/api/upload-dm' && request.method === 'POST') {
        const { image, images } = await request.json();
        const imageInputs = [
          ...(Array.isArray(images) ? images : []),
          ...(image ? [image] : []),
        ].filter(Boolean).slice(0, 8);
        if (!imageInputs.length) return json({ success: false, error: '蝻箏? DM ????PDF ?鞈?' }, 400);
        const sourceSceneUrls = await uploadSourceImagesToR2(imageInputs, env);
        const gptResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: 'gpt-4o', response_format: { type: 'json_object' }, max_tokens: 4000, temperature: 0.7,
            messages: [{ role: 'user', content: [
              { type: 'text', text: `你是頂級旅行社行程總監。解析此 DM 或 PDF 頁面並深度擴寫。回傳標準 JSON：
{"title":"...","region":"國旅/亞洲/歐洲/美洲/大洋洲/非洲","price":0,"days":0,"imageKeyword":"景點英文關鍵字","description":"每天200字以上，格式：第N天 標題\\n![圖片](景點英文關鍵字)\\n內文...","notes":""}
description 中圖片語法只放每日對應頁面或景點關鍵字，不要輸出 placehold.co、loremflickr、via.placeholder 這類暫示圖網址；若收到多頁 PDF，請綜合所有頁面整理成同一筆行程。` },
              ...imageInputs.map(url => ({ type: 'image_url', image_url: { url } }))
            ]}]
          })
        });
        const gptData = await gptResp.json();
        if (gptData.error) throw new Error(gptData.error.message);

        let content = gptData.choices[0].message.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('?⊥?閫?? GPT ??');
        const parsed = JSON.parse(match[0]);

        // 封面圖優先使用原始 DM 圖 / PDF 第一頁，避免外部示意圖失效
        if (sourceSceneUrls[0]) {
          parsed.image = sourceSceneUrls[0];
        } else {
          const coverUrl = await fetchUnsplashUrl(parsed.imageKeyword || 'travel', env);
          parsed.image   = await uploadUrlToR2(coverUrl, `cover_${Date.now()}.jpg`, env);
        }

        // ?扳????摮? R2 URL
        if (parsed.description) {
          parsed.description = await replaceImageKeywords(parsed.description, env, sourceSceneUrls);
        }

        return json({ success: true, data: parsed });
      }

      // ??????????????????????????????????????????????????????????
      // POST /api/partner/register
      // ??????????????????????????????????????????????????????????
      if (path === '/api/partner/register' && request.method === 'POST') {
        const body       = await request.json();
        const agencySlug = url.searchParams.get('a') || 'demo';
        const result     = await gasPost(env, { action: 'registerDistributor', ...body, agency_slug: agencySlug });
        if (!result.success) {
          const msgMap = { already_approved: '?典歇?舀???瑕?', already_pending: '?唾?撌脤嚗?蝑?撖拇' };
          return json({ success: false, error: msgMap[result.error] || result.error });
        }
        if (env.DB) {
          try {
            const syncResult = await d1UpsertRegisteredDistributor(
              env,
              { ...body, agency_slug: agencySlug },
              result
            );
            if (!syncResult.success) {
              console.warn('registerDistributor D1 sync failed:', syncResult.error);
            }
          } catch (err) {
            console.warn('registerDistributor D1 sync error:', err.message);
          }
        }
        return json(result);
      }

      // ??????????????????????????????????????????????????????????
      // GET /api/config
      // ??????????????????????????????????????????????????????????
      if (path === '/api/dist/profile' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);

        const result = env.DB
          ? await d1GetDistributorProfile(env, uid)
          : await gasPost(env, { action: 'getDistributorProfile', uid });

        return json(result, result.success ? 200 : 404);
      }

      if (path === '/api/dist/profile' && request.method === 'POST') {
        const body = await request.json();
        if (!body?.uid) return json({ success: false, error: '蝻箏? uid' }, 400);

        const result = env.DB
          ? await d1UpdateDistributorProfile(env, body)
          : await gasPost(env, { action: 'updateDistributorProfile', ...body });

        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/dist/test-tg' && request.method === 'POST') {
        const body = await request.json();
        const { tgToken, tgChatId, msg } = body || {};
        if (!tgToken || !tgChatId) {
          return json({ success: false, error: '蝻箏? tgToken ??tgChatId' }, 400);
        }

        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: tgChatId,
              text: msg || 'Telegram 測試通知：連線成功。',
            }),
          });
          const tgResult = await tgRes.json();
          if (tgResult.ok) {
            return json({ success: true, message: '皜祈岫閮撌脤??函? Telegram' });
          }
          return json({
            success: false,
            error: 'TG ?????' + (tgResult.description || JSON.stringify(tgResult)),
          });
        } catch (err) {
          return json({ success: false, error: 'Telegram ?????' + err.message }, 500);
        }
      }

      if (path === '/api/config' && request.method === 'GET') {
        const slug   = url.searchParams.get('a') || 'demo';
        const result = await readConfigWithFallback(env, slug);
        return json(result);
      }

      // ??????????????????????????????????????????????????????????
      // GET /api/resolve-invite?code=XXXXXX
      // ???芸?霈 D1嚗??? fallback GAS
      // ??????????????????????????????????????????????????????????
      if (path === '/api/resolve-invite' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        if (!code) return json({ success: false, error: '蝻箏? code' }, 400);
        const result = await resolveInviteCodeWithFallback(env, code);
        return json(result);
      }

      // ??????????????????????????????????????????????????????????
      // GET /api/agent/public?code=XXXXXX ???uid=Uxxx
      // ???芸?霈 D1嚗??? fallback GAS
      // ??????????????????????????????????????????????????????????
      if (path === '/api/agent/public' && request.method === 'GET') {
        const code = url.searchParams.get('code') || '';
        const uid  = url.searchParams.get('uid')  || '';
        if (!code && !uid) return json({ success: false, error: '蝻箏? code ??uid' }, 400);
        const result = await readAgentPublicProfileWithFallback(env, { code, uid });
        return json(result);
      }

      // ??????????????????????????????????????????????????????????
      // GET /api/my/customers?uid=Uxxx
      // ???芸?霈 D1嚗??? fallback GAS
      // ??????????????????????????????????????????????????????????
      if (path === '/api/itinerary/detail' && request.method === 'GET') {
        const itineraryId = url.searchParams.get('id') || '';
        const uid = url.searchParams.get('uid') || '';
        if (!itineraryId) return json({ success: false, error: '蝻箏? id' }, 400);
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);

        if (env.DB) {
          let row = await d1GetItineraryDetail(env, itineraryId);
          if (!row) return json({ success: false, error: '?曆??唳迨銵?' }, 404);

          const isAdmin = ADMIN_UIDS.has(uid);
          const isOwner = String(row.owner_uid || '') === String(uid);
          if (!isAdmin && !isOwner) {
            return json({ success: false, error: '?⊥???迨銵?' }, 403);
          }
          row = await d1BackfillMissingItineraryTextFromGas(env, row);
          return json({ success: true, data: toItineraryManageModel(row) });
        }

        const allItems = await gasGet(env, { action: 'getItineraries', all: '1' });
        const items = Array.isArray(allItems) ? allItems : [];
        const item = items.find(i => String(i.id || i.timestamp || '') === String(itineraryId));
        if (!item) return json({ success: false, error: '?曆??唳迨銵?' }, 404);
        const isAdmin = ADMIN_UIDS.has(uid);
        const isOwner = String(item.owneruid || '') === String(uid);
        if (!isAdmin && !isOwner) return json({ success: false, error: '?⊥???迨銵?' }, 403);
        return json({ success: true, data: item });
      }

      if (path === '/api/itinerary/detail' && request.method === 'POST') {
        const body = await request.json();
        const result = env.DB
          ? await d1SaveItineraryDetail(env, body)
          : await gasPost(env, {
              action: 'updateItinerary',
              id: body.id,
              operatorUid: body.uid || body.operatorUid || '',
              title: body.title,
              region: body.region,
              price: body.price,
              days: body.days,
              image: body.image,
              description: body.description,
              notes: body.notes,
              paymentMode: body.paymentMode,
              depositRatio: body.depositRatio,
              balanceCollect: body.balanceCollect,
            });

        return json(result, result.success ? 200 : 400);
      }

      if (path === '/api/my/customers' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        const result = await readMyCustomersWithFallback(env, uid);
        return json(result);
      }

      // ??????????????????????????????????????????????????????????
      // GET /api/my/stats?uid=Uxxx
      // ???芸?霈 D1嚗??? fallback GAS
      // ??????????????????????????????????????????????????????????
      if (path === '/api/my/stats' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        const result = await readMyStatsWithFallback(env, uid);
        return json(result);
      }

      // ??????????????????????????????????????????????????????????
      // GET /api/commission/summary?uid=蝞∠??「id
      // ???芸?霈 D1嚗??? fallback GAS
      // ??????????????????????????????????????????????????????????
      if (path === '/api/commission/summary' && request.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
        const result = await readCommissionSummaryWithFallback(env, uid);
        return json(result);
      }

      // ??????????????????????????????????????????????????????????
      // GET/POST /api/itineraries  嚗AS ?隞?? + 銝阮敺 TG ?蝞∠??∴?
      // ??????????????????????????????????????????????????????????
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
            if (!uid) return json({ success: false, error: '蝻箏? uid' }, 400);
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
        if (body.action === 'updateOrderStatus' && env.DB) {
          const result = await d1UpdateOrderStatus(env, body);
          return json(result, result.success ? 200 : 400);
        }
        if (body.action === 'markBalancePaid' && env.DB) {
          const result = await d1MarkBalancePaid(env, body);
          return json(result, result.success ? 200 : 400);
        }
        if ((body.action === 'hideItinerary' || body.action === 'deleteItinerary') && env.DB) {
          const result = await d1HideItinerary(env, body);
          return json(result, result.success ? 200 : 400);
        }
        const result = await gasPost(env, body);
        if (env.DB) {
          try {
            if (body.action === 'addItinerary' || body.action === 'updateItinerary') {
              await d1SyncItineraryFromGas(env, body, result);
            } else if (body.action === 'reviewItinerary') {
              await d1SyncItineraryReviewStatus(env, body);
            }
          } catch (syncErr) {
            console.warn('sync itinerary to D1 failed:', syncErr.message);
          }
        }

        // ??憒??臬??瑕?銝阮/蝺刻摩?? pending_review嚗蝞∠???
        const isSubmitAction = body.action === 'addItinerary' || body.action === 'updateItinerary';
        if (isSubmitAction && result.success && result.reviewStatus === 'pending_review') {
          if (env.ADMIN_TG_TOKEN && env.ADMIN_TG_CHAT_ID) {
            try {
              const isUpdate = body.action === 'updateItinerary';
              const title = result.itinerary?.title || body.title || '(未命名)';
              const ownerName = result.itinerary?.ownerName || body.ownerName || '(未填寫)';
              await sendAdminReviewNotify(
                env.ADMIN_TG_TOKEN,
                env.ADMIN_TG_CHAT_ID,
                {
                  type: isUpdate ? '更新行程' : '新增行程',
                  title: title,
                  ownerName: ownerName,
                  region: body.region || '',
                  price: body.price || 0,
                  days: body.days || 0,
                }
              );
            } catch (tgErr) {
              console.error('Admin TG notify failed:', tgErr.message);
              // 銝?鞈?撖怠
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

// ?? Telegram ? ?????????????????????????????????????????????

async function sendTelegramNotification(token, chatId, order) {
  const text =
    `*新增訂單通知*\n\n` +
    `訂單：${order.order_id}\n` +
    `行程：${order.itinerary_title}\n` +
    `金額：NT$ ${Number(order.price || 0).toLocaleString()}\n` +
    `佣金：NT$ ${Number(order.commission_amount || 0).toLocaleString()}\n\n` +
    `客戶：${order.customer_name}\n` +
    `電話：${order.customer_phone}\n` +
    `人數：${order.travelers}\n` +
    `出發日：${order.travel_date || '未填寫'}\n` +
    (order.note ? `備註：${order.note}\n` : '') +
    `\n建立時間：${order.created_at}\n\n請至後台處理。`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) throw new Error(`Telegram API: ${await res.text()}`);
}

// ???啗?蝔?靽格敺祟 ???蝞∠???
async function sendAdminReviewNotify(token, chatId, info) {
  const text =
    `*${info.type}*\n\n` +
    `行程：${info.title}\n` +
    `建立者：${info.ownerName}\n` +
    (info.region ? `地區：${info.region}\n` : '') +
    (info.days ? `天數：${info.days} 天\n` : '') +
    (info.price ? `價格：NT$ ${Number(info.price).toLocaleString()}\n` : '') +
    `\n請至後台審核。`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) throw new Error(`Telegram API: ${await res.text()}`);
}

// ?? ??撌亙 ?????????????????????????????????????????????????

function normalizeSectionImageKeyword(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/第\s*(?:\d+|[一二三四五六七八九十百]+)\s*天/g, ' ')
    .replace(/[|｜:：,，.。;；()（）【】\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEnglishSearchKeyword(value) {
  const english = String(value || '')
    .replace(/[^a-zA-Z0-9\s&'-]/g, ' ')
    .replace(/\b(photo|photos|picture|pictures|image|images|scenery|scenic|spot|attraction|travel)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return english.length >= 3 ? english.slice(0, 80) : '';
}

function buildSectionImageKeyword(body = {}) {
  const title = normalizeSectionImageKeyword(body.title);
  const firstBodyLine = normalizeSectionImageKeyword(
    String(body.body || '').split(/\r?\n/).find(line => String(line || '').trim()) || ''
  );
  const cleaned = title || firstBodyLine || 'travel itinerary scenic spot';
  return (cleaned || 'travel itinerary scenic spot').slice(0, 80);
}

async function translateSectionImageKeyword(keyword, body, env) {
  if (!env.OPENAI_API_KEY) return '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 60,
        messages: [{
          role: 'user',
          content: `把這個旅遊行程段落標題轉成最適合找真實旅遊照片的英文地點搜尋詞。若是知名地標，輸出官方英文名稱加城市；只輸出 ASCII 英文關鍵字，不要中文、日文、句子、標點，也不要 photo/image/scenery 這類泛詞。\n標題：${keyword}\n內文參考：${String(body?.body || '').slice(0, 160)}`
        }],
      }),
    });
    const data = await res.json();
    const raw = normalizeSectionImageKeyword(data?.choices?.[0]?.message?.content || '').slice(0, 80);
    return extractEnglishSearchKeyword(raw) || raw;
  } catch (e) {
    console.warn('section keyword translation failed:', e.message);
    return '';
  }
}

async function buildSectionImageSearchPlan(body = {}, env) {
  const keyword = buildSectionImageKeyword(body);
  const translated = await translateSectionImageKeyword(keyword, body, env);
  const translatedEnglish = extractEnglishSearchKeyword(translated);
  const keywordEnglish = extractEnglishSearchKeyword(keyword);
  const queries = [translatedEnglish, translated, keywordEnglish, keyword]
    .concat(String(body.body || '').split(/\r?\n/).slice(0, 2).map(normalizeSectionImageKeyword))
    .map(q => String(q || '').trim())
    .filter(Boolean);
  return {
    keyword,
    queries: [...new Set(queries)].slice(0, 5),
  };
}

function seededPhotoUrl(keyword) {
  const seed = encodeURIComponent(String(keyword || 'travel').replace(/\s+/g, '-').slice(0, 80));
  return `https://picsum.photos/seed/${seed}/1600/900`;
}

function encodeSvgDataUrl(svg) {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function buildFallbackSectionSvg(keyword) {
  const safeText = String(keyword || 'TravelKeeper').replace(/[<>&"]/g, '').slice(0, 36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dbeafe"/>
      <stop offset="0.52" stop-color="#ecfeff"/>
      <stop offset="1" stop-color="#dcfce7"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="#94a3b8" stroke-opacity=".22"/>
    </pattern>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <rect width="1600" height="900" fill="url(#grid)"/>
  <circle cx="1260" cy="170" r="160" fill="#38bdf8" opacity=".18"/>
  <circle cx="260" cy="720" r="220" fill="#22c55e" opacity=".14"/>
  <text x="110" y="150" font-size="42" font-weight="700" fill="#0f766e" font-family="Arial, sans-serif">TravelKeeper</text>
  <text x="110" y="455" font-size="92" font-weight="800" fill="#0f172a" font-family="Arial, sans-serif">${safeText}</text>
  <text x="112" y="545" font-size="34" font-weight="500" fill="#475569" font-family="Arial, sans-serif">行程圖片待替換，已先建立可顯示備用圖</text>
</svg>`;
  return encodeSvgDataUrl(svg);
}

function imageQueryTokens(keyword) {
  return String(keyword || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token && token.length >= 2 && !['and', 'the', 'with', 'tour', 'trip', 'day'].includes(token));
}

function scoreCommonsImageTitle(title, keyword) {
  const haystack = String(title || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  const tokens = imageQueryTokens(keyword);
  if (!tokens.length) return 0;
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function fetchCommonsImageUrl(keyword) {
  try {
    const query = String(keyword || 'travel scenic').slice(0, 80);
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url&iiurlwidth=1600&format=json&origin=*`;
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'TravelKeeper/1.0' } });
    if (!res.ok) return '';
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});
    const candidates = [];
    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      const url = info?.thumburl || info?.url || '';
      if (/^https?:\/\//i.test(url) && /\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(url.split('?')[0])) {
        const score = scoreCommonsImageTitle(page?.title || '', query);
        if (score > 0) candidates.push({ url, score, width: Number(info?.thumbwidth || 0), height: Number(info?.thumbheight || 0) });
      }
    }
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aRatio = a.width && a.height ? Math.abs((a.width / a.height) - (16 / 9)) : 9;
      const bRatio = b.width && b.height ? Math.abs((b.width / b.height) - (16 / 9)) : 9;
      return aRatio - bRatio;
    });
    return candidates[0]?.url || '';
  } catch (e) {
    console.warn('Commons image lookup failed:', e.message);
  }
  return '';
}

async function fetchRepairImageSource(keyword, env) {
  if (env.UNSPLASH_API_KEY) {
    const unsplashUrl = await fetchUnsplashUrl(keyword, env);
    if (unsplashUrl && !isGeneratedPlaceholderImageUrl(unsplashUrl)) return unsplashUrl;
  }
  const commonsUrl = await fetchCommonsImageUrl(keyword);
  if (commonsUrl) return commonsUrl;
  return '';
}

async function generateSectionImageWithOpenAI(keyword, env) {
  if (!env.OPENAI_API_KEY) return '';
  try {
    const prompt = [
      'Create a realistic horizontal travel editorial image for this itinerary section.',
      `Place or theme: ${String(keyword || 'travel destination').slice(0, 120)}.`,
      'Style: natural daylight, professional travel photography, no text, no watermark, no logos, no poster layout.',
      'Composition: landmark or street scene clearly matching the place, suitable as a 16:9 itinerary cover.'
    ].join(' ');
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1536x1024',
      }),
    });
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json || '';
    if (!res.ok || !b64) {
      console.warn('OpenAI image generation failed:', data?.error?.message || res.status);
      return '';
    }
    return `data:image/png;base64,${b64}`;
  } catch (e) {
    console.warn('OpenAI image generation failed:', e.message);
    return '';
  }
}

async function createFixedSectionImage(queries, env) {
  const list = Array.isArray(queries) && queries.length ? queries : [queries || 'travel itinerary scenic spot'];
  const filename = `fix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
  for (const query of list) {
    const sourceUrl = await fetchRepairImageSource(query, env);
    if (!sourceUrl) continue;
    let url = await uploadUrlToR2(sourceUrl, filename, env);
    if (url && url.startsWith(R2_PUBLIC)) return { url, sourceQuery: query, sourceUrl };
    if (url && /^https?:\/\//i.test(url) && !isGeneratedPlaceholderImageUrl(url)) {
      return { url, sourceQuery: query, sourceUrl, stored: false };
    }
    if (/^https?:\/\//i.test(sourceUrl) && !isGeneratedPlaceholderImageUrl(sourceUrl)) {
      return { url: sourceUrl, sourceQuery: query, sourceUrl, stored: false };
    }
  }

  const fallbackKeyword = list[0] || 'travel itinerary scenic spot';
  const generatedDataUrl = await generateSectionImageWithOpenAI(fallbackKeyword, env);
  if (generatedDataUrl) {
    const generatedUrl = await uploadDataUrlToR2(generatedDataUrl, filename.replace(/\.jpg$/i, '.png'), env);
    if (generatedUrl) return { url: generatedUrl, sourceQuery: fallbackKeyword, sourceUrl: 'openai-image-generation' };
  }

  const fallbackUrl = await uploadDataUrlToR2(buildFallbackSectionSvg(fallbackKeyword), filename.replace(/\.jpg$/i, '.svg'), env);
  return { url: fallbackUrl, sourceQuery: fallbackKeyword, sourceUrl: 'generated-fallback-svg' };
}

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

async function uploadDataUrlToR2(dataUrl, filename, env) {
  try {
    const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error('invalid data url');
    const contentType = match[1] || 'image/jpeg';
    const base64Data = match[2];
    const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const key = `tours/${filename}`;
    await env.TRAVEL.put(key, buffer, { httpMetadata: { contentType } });
    return `${R2_PUBLIC}/${key}`;
  } catch (e) {
    console.warn('R2 data-url upload failed:', e.message);
    return '';
  }
}

function isGeneratedPlaceholderImageUrl(url) {
  return /(?:placehold\.co|placeholder\.com|via\.placeholder|loremflickr\.com)/i.test(String(url || ''));
}

async function uploadSourceImagesToR2(imageInputs, env) {
  const urls = [];
  for (let i = 0; i < imageInputs.length; i++) {
    const input = imageInputs[i];
    let url = '';
    if (typeof input === 'string' && input.startsWith('data:image/')) {
      url = await uploadDataUrlToR2(input, `scene_${Date.now()}_${i + 1}.jpg`, env);
    } else if (typeof input === 'string' && /^https?:\/\//i.test(input)) {
      url = await uploadUrlToR2(input, `scene_${Date.now()}_${i + 1}.jpg`, env);
    }
    if (url) urls.push(url);
  }
  return urls;
}

async function replaceImageKeywords(text, env, sourceImageUrls = []) {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const replacements = [];
  let match;
  let sourceIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    const keyword = String(match[2] || '').trim();
    let r2Url = '';
    if (sourceImageUrls.length) {
      r2Url = sourceImageUrls[Math.min(sourceIndex, sourceImageUrls.length - 1)];
      sourceIndex++;
    } else if (/^https?:\/\//i.test(keyword) && !isGeneratedPlaceholderImageUrl(keyword)) {
      continue;
    } else {
      const lookupKeyword = isGeneratedPlaceholderImageUrl(keyword)
        ? (match[1] || 'travel')
        : keyword;
      const unsplashUrl = await fetchUnsplashUrl(lookupKeyword, env);
      r2Url = await uploadUrlToR2(unsplashUrl, `scene_${Date.now()}_${Math.random().toString(36).slice(2,6)}.jpg`, env);
    }
    if (!r2Url) continue;
    replacements.push({ original: match[0], replacement: `![${match[1]}](${r2Url})` });
  }
  let result = text;
  for (let i = replacements.length - 1; i >= 0; i--) result = result.replace(replacements[i].original, replacements[i].replacement);
  return result;
}


