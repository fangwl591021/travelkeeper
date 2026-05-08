export async function getConfig(db, slug = 'demo') {
  const row = await db.prepare(
    `SELECT slug, name, liff_id FROM tenants WHERE slug = ?`
  ).bind(slug).first();

  if (!row) return { success: false, error: 'TENANT_NOT_FOUND' };
  return { success: true, data: row };
}

export async function resolveInviteCode(db, code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return { success: false, error: 'MISSING_CODE' };

  const row = await db.prepare(
    `SELECT uid, name, invite_code AS inviteCode
       FROM distributors
      WHERE invite_code = ?`
  ).bind(normalized).first();

  if (!row) return { success: false, error: 'INVITE_CODE_NOT_FOUND' };
  return { success: true, data: row };
}

export async function getAgentPublicProfile(db, { code = '', uid = '' } = {}) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedUid = String(uid || '').trim();
  if (!normalizedCode && !normalizedUid) {
    return { success: false, error: 'MISSING_CODE_OR_UID' };
  }

  const row = normalizedCode
    ? await db.prepare(
        `SELECT * FROM distributors WHERE invite_code = ?`
      ).bind(normalizedCode).first()
    : await db.prepare(
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

export async function getPublishedItineraries(db) {
  const { results } = await db.prepare(
    `SELECT *
       FROM itineraries
      WHERE review_status = 'published'
        AND deleted_at IS NULL
      ORDER BY created_at DESC`
  ).all();

  return results.map(toSheetItinerary);
}

export async function getAllItineraries(db) {
  const { results } = await db.prepare(
    `SELECT *
       FROM itineraries
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC`
  ).all();

  return results.map(toSheetItinerary);
}

export async function getItinerariesByOwner(db, ownerUid) {
  const { results } = await db.prepare(
    `SELECT *
       FROM itineraries
      WHERE owner_uid = ?
        AND deleted_at IS NULL
      ORDER BY created_at DESC`
  ).bind(ownerUid).all();

  return results.map(toSheetItinerary);
}

export async function getOrderById(db, orderId) {
  const row = await db.prepare(
    `SELECT * FROM orders WHERE order_id = ?`
  ).bind(orderId).first();

  return row ? toSheetOrder(row) : null;
}

export async function getUserOrders(db, uid) {
  const { results } = await db.prepare(
    `SELECT *
       FROM orders
      WHERE customer_line_uid = ?
         OR distributor_uid = ?
      ORDER BY created_at DESC`
  ).bind(uid, uid).all();

  return { success: true, data: results.map(toSheetOrder) };
}

export async function getMyCustomers(db, uid) {
  const { results } = await db.prepare(
    `SELECT *
       FROM customers
      WHERE owner_uid = ?
      ORDER BY total_amount DESC`
  ).bind(uid).all();

  return { success: true, data: results.map(toSheetCustomer) };
}

export async function getCustomerOrders(db, { uid, phone, isAdmin = false }) {
  if (!uid || !phone) return { success: false, error: 'MISSING_PARAMS' };

  if (!isAdmin) {
    const customer = await db.prepare(
      `SELECT owner_uid FROM customers WHERE customer_phone = ?`
    ).bind(phone).first();

    if (!customer || String(customer.owner_uid) !== String(uid)) {
      return { success: false, error: 'FORBIDDEN_CUSTOMER' };
    }
  }

  const { results } = await db.prepare(
    `SELECT *
       FROM orders
      WHERE customer_phone = ?
      ORDER BY created_at DESC`
  ).bind(phone).all();

  return { success: true, data: results.map(toSheetOrder) };
}

export async function getMyStats(db, uid) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartText = monthStart.toISOString().slice(0, 10);

  const total = await db.prepare(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(total_amount), 0) AS revenue,
       COALESCE(SUM(commission_amount), 0) AS commission,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN commission_amount ELSE 0 END), 0) AS completedCommission
     FROM orders
     WHERE distributor_uid = ?
       AND status <> 'cancelled'`
  ).bind(uid).first();

  const month = await db.prepare(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(total_amount), 0) AS revenue,
       COALESCE(SUM(commission_amount), 0) AS commission
     FROM orders
     WHERE distributor_uid = ?
       AND status <> 'cancelled'
       AND created_at >= ?`
  ).bind(uid, monthStartText).first();

  const customer = await db.prepare(
    `SELECT COUNT(*) AS count FROM customers WHERE owner_uid = ?`
  ).bind(uid).first();

  return {
    success: true,
    data: {
      month: {
        count: Number(month.count || 0),
        revenue: Number(month.revenue || 0),
        commission: Number(month.commission || 0),
      },
      total: {
        count: Number(total.count || 0),
        revenue: Number(total.revenue || 0),
        commission: Number(total.commission || 0),
        completedCommission: Number(total.completedCommission || 0),
      },
      customerCount: Number(customer.count || 0),
    },
  };
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
