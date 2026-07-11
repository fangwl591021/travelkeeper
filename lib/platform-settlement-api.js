import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';
import { getTenantPaymentPolicy } from './tenant-payment-policy.js';
import { statusForError } from './http-error-status.js';

const MAX_LIMIT = 500;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function requestUid(request, body = null) {
  const url = new URL(request.url);
  return String(
    request.headers.get('x-user-uid') ||
    body?.user_uid ||
    body?.userUid ||
    body?.uid ||
    body?.operatorUid ||
    url.searchParams.get('uid') ||
    '',
  ).trim();
}

function parseLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_LIMIT));
}

function boundedNumber(value, min, max, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function cleanText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function tenantCode(tenantSlug) {
  return String(tenantSlug || 'tenant')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 6) || 'TENANT';
}

function makeBatchId(tenantSlug) {
  const random = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return `PCB${tenantCode(tenantSlug)}${Date.now()}${random}`;
}

function makePayableId(paymentAttemptId) {
  const value = String(paymentAttemptId || '').replace(/[^a-z0-9]/gi, '').slice(-40);
  return `PCP${value || crypto.randomUUID().replaceAll('-', '')}`;
}

function defaultRule(tenantSlug) {
  const isPlatform = tenantSlug === 'demo';
  return {
    tenant_slug: tenantSlug,
    beneficiary_type: isPlatform ? 'platform' : 'tenant',
    gateway_fee_rate: 0,
    gateway_fee_fixed: 0,
    platform_fee_rate: 0,
    platform_fee_fixed: 0,
    reserve_rate: 0,
    hold_days: isPlatform ? 0 : 7,
    minimum_payout: 0,
    enabled: 1,
    payout_note: isPlatform ? '平台自有訂單' : '平台代收後撥付租戶',
  };
}

export function calculateSettlementAmounts(grossAmount, rule = {}) {
  const gross = Math.max(0, Math.round(Number(grossAmount || 0)));
  const gatewayRate = boundedNumber(rule.gateway_fee_rate, 0, 100, 0);
  const platformRate = boundedNumber(rule.platform_fee_rate, 0, 100, 0);
  const reserveRate = boundedNumber(rule.reserve_rate, 0, 100, 0);
  const gatewayFixed = Math.max(0, Math.round(Number(rule.gateway_fee_fixed || 0)));
  const platformFixed = Math.max(0, Math.round(Number(rule.platform_fee_fixed || 0)));

  const gatewayFee = Math.min(gross, Math.round(gross * gatewayRate / 100) + gatewayFixed);
  const afterGateway = Math.max(0, gross - gatewayFee);
  const platformFee = Math.min(afterGateway, Math.round(gross * platformRate / 100) + platformFixed);
  const afterFees = Math.max(0, afterGateway - platformFee);
  const reserve = Math.min(afterFees, Math.round(gross * reserveRate / 100));
  const payable = Math.max(0, afterFees - reserve);

  return {
    grossAmount: gross,
    gatewayFeeAmount: gatewayFee,
    platformFeeAmount: platformFee,
    reserveAmount: reserve,
    payableAmount: payable,
  };
}

export function settlementEligibleAt(baseDate, holdDays = 0) {
  const base = new Date(baseDate || Date.now());
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  safeBase.setUTCDate(safeBase.getUTCDate() + Math.max(0, Math.floor(Number(holdDays || 0))));
  return safeBase.toISOString();
}

async function requireContext(request, env, allowedRoles, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles,
  });
}

async function readRule(env, tenantSlug) {
  const row = await env.DB.prepare(`
    SELECT *
    FROM platform_collection_settlement_rules
    WHERE tenant_slug = ?
    LIMIT 1
  `).bind(tenantSlug).first().catch(error => {
    if (String(error?.message || '').includes('no such table')) throw new Error('D1_REQUIRED');
    throw error;
  });
  return row || defaultRule(tenantSlug);
}

function normalizeRule(body, current) {
  const beneficiaryType = String(body.beneficiary_type || body.beneficiaryType || current.beneficiary_type || 'tenant').trim().toLowerCase();
  if (!['tenant', 'platform'].includes(beneficiaryType)) throw new Error('INVALID_SETTLEMENT_RULE');

  return {
    beneficiary_type: beneficiaryType,
    gateway_fee_rate: boundedNumber(body.gateway_fee_rate ?? body.gatewayFeeRate ?? current.gateway_fee_rate, 0, 100, 0),
    gateway_fee_fixed: Math.max(0, Math.round(Number(body.gateway_fee_fixed ?? body.gatewayFeeFixed ?? current.gateway_fee_fixed ?? 0))),
    platform_fee_rate: boundedNumber(body.platform_fee_rate ?? body.platformFeeRate ?? current.platform_fee_rate, 0, 100, 0),
    platform_fee_fixed: Math.max(0, Math.round(Number(body.platform_fee_fixed ?? body.platformFeeFixed ?? current.platform_fee_fixed ?? 0))),
    reserve_rate: boundedNumber(body.reserve_rate ?? body.reserveRate ?? current.reserve_rate, 0, 100, 0),
    hold_days: Math.max(0, Math.min(365, Math.floor(Number(body.hold_days ?? body.holdDays ?? current.hold_days ?? 7)))),
    minimum_payout: Math.max(0, Math.round(Number(body.minimum_payout ?? body.minimumPayout ?? current.minimum_payout ?? 0))),
    enabled: body.enabled === undefined
      ? Number(current.enabled ?? 1)
      : (body.enabled === true || body.enabled === 1 || body.enabled === '1' || body.enabled === 'true' ? 1 : 0),
    payout_note: cleanText(body.payout_note ?? body.payoutNote ?? current.payout_note, 1000),
  };
}

async function getRuleResponse(request, env) {
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'finance']);
  const rule = await readRule(env, context.tenantSlug);
  return json({ success: true, data: rule, tenantSlug: context.tenantSlug });
}

async function updateRuleResponse(request, env) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const current = await readRule(env, context.tenantSlug);
  const next = normalizeRule(body, current);

  await env.DB.prepare(`
    INSERT INTO platform_collection_settlement_rules (
      tenant_slug, beneficiary_type, gateway_fee_rate, gateway_fee_fixed,
      platform_fee_rate, platform_fee_fixed, reserve_rate, hold_days,
      minimum_payout, enabled, payout_note, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_slug) DO UPDATE SET
      beneficiary_type = excluded.beneficiary_type,
      gateway_fee_rate = excluded.gateway_fee_rate,
      gateway_fee_fixed = excluded.gateway_fee_fixed,
      platform_fee_rate = excluded.platform_fee_rate,
      platform_fee_fixed = excluded.platform_fee_fixed,
      reserve_rate = excluded.reserve_rate,
      hold_days = excluded.hold_days,
      minimum_payout = excluded.minimum_payout,
      enabled = excluded.enabled,
      payout_note = excluded.payout_note,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    context.tenantSlug,
    next.beneficiary_type,
    next.gateway_fee_rate,
    next.gateway_fee_fixed,
    next.platform_fee_rate,
    next.platform_fee_fixed,
    next.reserve_rate,
    next.hold_days,
    next.minimum_payout,
    next.enabled,
    next.payout_note,
    context.userUid,
  ).run();

  return json({ success: true, data: await readRule(env, context.tenantSlug) });
}

async function promoteEligible(env, tenantSlug) {
  await env.DB.prepare(`
    UPDATE platform_collection_payables
    SET status = 'eligible', updated_at = datetime('now')
    WHERE tenant_slug = ?
      AND status = 'pending'
      AND eligible_at <> ''
      AND eligible_at <= datetime('now')
  `).bind(tenantSlug).run();
}

async function syncPayables(request, env) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const policy = await getTenantPaymentPolicy(env, context.tenantSlug);
  if (!policy.enabled || policy.collectionMode !== 'platform_collect') {
    throw new Error('TENANT_PAYMENT_CONFIGURATION_REQUIRED');
  }

  const rule = await readRule(env, context.tenantSlug);
  if (!Number(rule.enabled || 0)) throw new Error('TENANT_PAYMENT_CONFIGURATION_REQUIRED');

  await promoteEligible(env, context.tenantSlug);
  const limit = parseLimit(body.limit, 500);
  const rows = await env.DB.prepare(`
    SELECT
      p.id AS payment_attempt_id,
      p.order_id,
      p.leg,
      p.amount,
      p.updated_at AS paid_at,
      o.distributor_uid
    FROM payment_attempts p
    INNER JOIN orders o
      ON o.tenant_slug = p.tenant_slug
     AND o.order_id = p.order_id
    WHERE p.tenant_slug = ?
      AND p.status = 'paid'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_collection_payables pc
        WHERE pc.tenant_slug = p.tenant_slug
          AND pc.payment_attempt_id = p.id
      )
    ORDER BY p.updated_at ASC
    LIMIT ?
  `).bind(context.tenantSlug, limit).all();

  let created = 0;
  let retained = 0;
  let eligible = 0;
  let pending = 0;
  const now = new Date();

  for (const row of rows.results || []) {
    const amounts = calculateSettlementAmounts(row.amount, rule);
    const eligibleAt = settlementEligibleAt(row.paid_at, rule.hold_days);
    const beneficiaryType = String(rule.beneficiary_type || 'tenant');
    const status = beneficiaryType === 'platform'
      ? 'retained'
      : (new Date(eligibleAt).getTime() <= now.getTime() ? 'eligible' : 'pending');
    const beneficiaryKey = beneficiaryType === 'platform' ? 'platform' : context.tenantSlug;

    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO platform_collection_payables (
        id, tenant_slug, payment_attempt_id, order_id, leg,
        beneficiary_type, beneficiary_key, gross_amount,
        gateway_fee_amount, platform_fee_amount, reserve_amount,
        payable_amount, status, eligible_at, batch_id, note,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, datetime('now'), datetime('now'))
    `).bind(
      makePayableId(row.payment_attempt_id),
      context.tenantSlug,
      row.payment_attempt_id,
      row.order_id,
      String(row.leg || 'deposit').toLowerCase() === 'balance' ? 'balance' : 'deposit',
      beneficiaryType,
      beneficiaryKey,
      amounts.grossAmount,
      amounts.gatewayFeeAmount,
      amounts.platformFeeAmount,
      amounts.reserveAmount,
      amounts.payableAmount,
      status,
      eligibleAt,
      cleanText(rule.payout_note, 1000),
    ).run();

    if (Number(result.meta?.changes || 0) > 0) {
      created += 1;
      if (status === 'retained') retained += 1;
      if (status === 'eligible') eligible += 1;
      if (status === 'pending') pending += 1;
    }
  }

  return json({
    success: true,
    data: { created, retained, eligible, pending, scanned: (rows.results || []).length },
    tenantSlug: context.tenantSlug,
  });
}

async function listPayables(request, env) {
  const url = new URL(request.url);
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'finance']);
  await promoteEligible(env, context.tenantSlug);

  const status = cleanText(url.searchParams.get('status'), 30).toLowerCase();
  const allowedStatuses = new Set(['pending', 'eligible', 'batched', 'paid', 'retained', 'void', 'disputed']);
  if (status && !allowedStatuses.has(status)) throw new Error('INVALID_SETTLEMENT_STATUS');

  const binds = [context.tenantSlug];
  let where = 'pc.tenant_slug = ?';
  if (status) {
    where += ' AND pc.status = ?';
    binds.push(status);
  }
  const limit = parseLimit(url.searchParams.get('limit'));

  const rows = await env.DB.prepare(`
    SELECT
      pc.*,
      o.itinerary_title,
      o.customer_name,
      o.customer_phone,
      o.distributor_uid,
      p.method AS payment_method,
      p.trade_no
    FROM platform_collection_payables pc
    INNER JOIN orders o
      ON o.tenant_slug = pc.tenant_slug
     AND o.order_id = pc.order_id
    INNER JOIN payment_attempts p
      ON p.tenant_slug = pc.tenant_slug
     AND p.id = pc.payment_attempt_id
    WHERE ${where}
    ORDER BY pc.created_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({ success: true, data: rows.results || [], tenantSlug: context.tenantSlug });
}

async function listBatches(request, env) {
  const url = new URL(request.url);
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'finance']);
  const status = cleanText(url.searchParams.get('status'), 30).toLowerCase();
  const allowed = new Set(['draft', 'approved', 'paid', 'cancelled']);
  if (status && !allowed.has(status)) throw new Error('INVALID_SETTLEMENT_STATUS');

  const binds = [context.tenantSlug];
  let where = 'tenant_slug = ?';
  if (status) {
    where += ' AND status = ?';
    binds.push(status);
  }
  const limit = parseLimit(url.searchParams.get('limit'));
  const rows = await env.DB.prepare(`
    SELECT *
    FROM platform_collection_batches
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();
  return json({ success: true, data: rows.results || [], tenantSlug: context.tenantSlug });
}

async function createBatch(request, env) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  await promoteEligible(env, context.tenantSlug);
  const rule = await readRule(env, context.tenantSlug);
  if (String(rule.beneficiary_type || '') !== 'tenant') throw new Error('SETTLEMENT_BATCH_EMPTY');

  const ids = Array.isArray(body.payable_ids || body.payableIds)
    ? [...new Set((body.payable_ids || body.payableIds).map(value => cleanText(value, 120)).filter(Boolean))].slice(0, 500)
    : [];

  const binds = [context.tenantSlug];
  let where = `tenant_slug = ? AND status = 'eligible' AND beneficiary_type = 'tenant' AND batch_id = ''`;
  if (ids.length) {
    where += ` AND id IN (${ids.map(() => '?').join(',')})`;
    binds.push(...ids);
  }

  const rows = await env.DB.prepare(`
    SELECT *
    FROM platform_collection_payables
    WHERE ${where}
    ORDER BY eligible_at ASC, created_at ASC
    LIMIT 500
  `).bind(...binds).all();
  const items = rows.results || [];
  if (!items.length) throw new Error('SETTLEMENT_BATCH_EMPTY');
  if (ids.length && items.length !== ids.length) throw new Error('SETTLEMENT_PAYABLE_ALREADY_BATCHED');

  const totals = items.reduce((acc, item) => {
    acc.gross += Number(item.gross_amount || 0);
    acc.gateway += Number(item.gateway_fee_amount || 0);
    acc.platform += Number(item.platform_fee_amount || 0);
    acc.reserve += Number(item.reserve_amount || 0);
    acc.payable += Number(item.payable_amount || 0);
    return acc;
  }, { gross: 0, gateway: 0, platform: 0, reserve: 0, payable: 0 });

  if (totals.payable < Number(rule.minimum_payout || 0)) {
    throw new Error('SETTLEMENT_MINIMUM_NOT_REACHED');
  }

  const batchId = makeBatchId(context.tenantSlug);
  const periodStart = items.reduce((value, item) => !value || item.created_at < value ? item.created_at : value, '');
  const periodEnd = items.reduce((value, item) => !value || item.created_at > value ? item.created_at : value, '');
  const statements = [
    env.DB.prepare(`
      INSERT INTO platform_collection_batches (
        id, tenant_slug, status, period_start, period_end, item_count,
        total_gross, total_gateway_fee, total_platform_fee, total_reserve,
        total_payable, payout_reference, note, created_by,
        created_at, updated_at
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, datetime('now'), datetime('now'))
    `).bind(
      batchId,
      context.tenantSlug,
      periodStart,
      periodEnd,
      items.length,
      totals.gross,
      totals.gateway,
      totals.platform,
      totals.reserve,
      totals.payable,
      cleanText(body.note, 1000),
      context.userUid,
    ),
  ];

  for (const item of items) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO platform_collection_batch_items (batch_id, payable_id, tenant_slug)
        VALUES (?, ?, ?)
      `).bind(batchId, item.id, context.tenantSlug),
    );
    statements.push(
      env.DB.prepare(`
        UPDATE platform_collection_payables
        SET status = 'batched', batch_id = ?, updated_at = datetime('now')
        WHERE tenant_slug = ? AND id = ? AND status = 'eligible' AND batch_id = ''
      `).bind(batchId, context.tenantSlug, item.id),
    );
  }
  await env.DB.batch(statements);

  const batch = await env.DB.prepare(`
    SELECT * FROM platform_collection_batches WHERE tenant_slug = ? AND id = ?
  `).bind(context.tenantSlug, batchId).first();
  return json({ success: true, data: batch }, 201);
}

async function loadBatch(env, tenantSlug, batchId) {
  return env.DB.prepare(`
    SELECT *
    FROM platform_collection_batches
    WHERE tenant_slug = ? AND id = ?
    LIMIT 1
  `).bind(tenantSlug, batchId).first();
}

async function approveBatch(request, env, batchId) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const batch = await loadBatch(env, context.tenantSlug, batchId);
  if (!batch) throw new Error('SETTLEMENT_BATCH_NOT_FOUND');
  if (batch.status === 'paid') throw new Error('SETTLEMENT_BATCH_ALREADY_PAID');
  if (batch.status === 'approved') throw new Error('SETTLEMENT_BATCH_ALREADY_APPROVED');
  if (batch.status !== 'draft') throw new Error('INVALID_SETTLEMENT_STATUS');

  await env.DB.prepare(`
    UPDATE platform_collection_batches
    SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
    WHERE tenant_slug = ? AND id = ? AND status = 'draft'
  `).bind(context.userUid, context.tenantSlug, batchId).run();
  return json({ success: true, data: await loadBatch(env, context.tenantSlug, batchId) });
}

async function markBatchPaid(request, env, batchId) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const payoutReference = cleanText(body.payout_reference || body.payoutReference, 200);
  if (!payoutReference) throw new Error('PAYOUT_REFERENCE_REQUIRED');

  const batch = await loadBatch(env, context.tenantSlug, batchId);
  if (!batch) throw new Error('SETTLEMENT_BATCH_NOT_FOUND');
  if (batch.status === 'paid') throw new Error('SETTLEMENT_BATCH_ALREADY_PAID');
  if (batch.status !== 'approved') throw new Error('INVALID_SETTLEMENT_STATUS');

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE platform_collection_batches
      SET status = 'paid', payout_reference = ?, paid_by = ?, paid_at = datetime('now'), updated_at = datetime('now')
      WHERE tenant_slug = ? AND id = ? AND status = 'approved'
    `).bind(payoutReference, context.userUid, context.tenantSlug, batchId),
    env.DB.prepare(`
      UPDATE platform_collection_payables
      SET status = 'paid', updated_at = datetime('now')
      WHERE tenant_slug = ? AND batch_id = ? AND status = 'batched'
    `).bind(context.tenantSlug, batchId),
  ]);
  return json({ success: true, data: await loadBatch(env, context.tenantSlug, batchId) });
}

export function isPlatformSettlementApiRequest(request) {
  return new URL(request.url).pathname.startsWith('/api/v2/platform-settlements');
}

export async function routePlatformSettlementApi(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/api/v2/platform-settlements/rule' && request.method === 'GET') {
      return await getRuleResponse(request, env);
    }
    if (path === '/api/v2/platform-settlements/rule' && request.method === 'POST') {
      return await updateRuleResponse(request, env);
    }
    if (path === '/api/v2/platform-settlements/sync' && request.method === 'POST') {
      return await syncPayables(request, env);
    }
    if (path === '/api/v2/platform-settlements/payables' && request.method === 'GET') {
      return await listPayables(request, env);
    }
    if (path === '/api/v2/platform-settlements/batches' && request.method === 'GET') {
      return await listBatches(request, env);
    }
    if (path === '/api/v2/platform-settlements/batches' && request.method === 'POST') {
      return await createBatch(request, env);
    }
    const approveMatch = path.match(/^\/api\/v2\/platform-settlements\/batches\/([^/]+)\/approve$/);
    if (approveMatch && request.method === 'POST') {
      return await approveBatch(request, env, decodeURIComponent(approveMatch[1]));
    }
    const paidMatch = path.match(/^\/api\/v2\/platform-settlements\/batches\/([^/]+)\/paid$/);
    if (paidMatch && request.method === 'POST') {
      return await markBatchPaid(request, env, decodeURIComponent(paidMatch[1]));
    }
    return json({ success: false, error: 'PLATFORM_SETTLEMENT_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'PLATFORM_SETTLEMENT_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}
