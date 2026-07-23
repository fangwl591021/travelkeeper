import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';
import { statusForError } from './http-error-status.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
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

function toFlag(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0) === 1 ? 1 : 0;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' ? 1 : 0;
}

async function requireContext(request, env, allowedRoles, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles,
  });
}

export function normalizeSettlementPaymentControls(row = {}) {
  return {
    require_verified_account: Number(row.require_verified_account || 0) === 1,
    require_payout_proof: Number(row.require_payout_proof || 0) === 1,
  };
}

async function readControls(env, tenantSlug) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const row = await env.DB.prepare(`
    SELECT require_verified_account, require_payout_proof
    FROM platform_collection_settlement_rules
    WHERE tenant_slug = ?
    LIMIT 1
  `).bind(tenantSlug).first().catch(error => {
    const message = String(error?.message || '');
    if (message.includes('no such column')) {
      return { require_verified_account: 0, require_payout_proof: 0 };
    }
    throw error;
  });
  return normalizeSettlementPaymentControls(row || {});
}

async function getControlsResponse(request, env) {
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'finance']);
  return json({
    success: true,
    data: await readControls(env, context.tenantSlug),
    tenantSlug: context.tenantSlug,
  });
}

async function updateControlsResponse(request, env) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const current = await readControls(env, context.tenantSlug);
  const requireVerifiedAccount = toFlag(
    body.require_verified_account ?? body.requireVerifiedAccount,
    current.require_verified_account ? 1 : 0,
  );
  const requirePayoutProof = toFlag(
    body.require_payout_proof ?? body.requirePayoutProof,
    current.require_payout_proof ? 1 : 0,
  );

  await env.DB.prepare(`
    INSERT INTO platform_collection_settlement_rules (
      tenant_slug, require_verified_account, require_payout_proof,
      updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_slug) DO UPDATE SET
      require_verified_account = excluded.require_verified_account,
      require_payout_proof = excluded.require_payout_proof,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    context.tenantSlug,
    requireVerifiedAccount,
    requirePayoutProof,
    context.userUid,
  ).run();

  return json({
    success: true,
    data: await readControls(env, context.tenantSlug),
    tenantSlug: context.tenantSlug,
  });
}

async function loadBatch(env, tenantSlug, batchId) {
  return env.DB.prepare(`
    SELECT *
    FROM platform_collection_batches
    WHERE tenant_slug = ? AND id = ?
    LIMIT 1
  `).bind(tenantSlug, batchId).first();
}

async function loadVerifiedPayoutAccount(env, tenantSlug) {
  return env.DB.prepare(`
    SELECT
      tenant_slug,
      bank_code,
      bank_name,
      account_name,
      account_last4,
      verification_status,
      enabled
    FROM tenant_payout_accounts
    WHERE tenant_slug = ?
      AND enabled = 1
      AND verification_status = 'verified'
    LIMIT 1
  `).bind(tenantSlug).first().catch(error => {
    if (String(error?.message || '').includes('no such table')) return null;
    throw error;
  });
}

async function countActiveProofs(env, tenantSlug, batchId) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM platform_collection_batch_proofs
    WHERE tenant_slug = ?
      AND batch_id = ?
      AND (deleted_at IS NULL OR deleted_at = '')
  `).bind(tenantSlug, batchId).first().catch(error => {
    if (String(error?.message || '').includes('no such table')) return { count: 0 };
    throw error;
  });
  return Number(row?.count || 0);
}

export async function validateSettlementPaymentControls(env, tenantSlug, batchId) {
  const controls = await readControls(env, tenantSlug);
  const account = await loadVerifiedPayoutAccount(env, tenantSlug);
  const proofCount = await countActiveProofs(env, tenantSlug, batchId);

  if (controls.require_verified_account && !account) {
    throw new Error('PAYOUT_ACCOUNT_NOT_VERIFIED');
  }
  if (controls.require_payout_proof && proofCount < 1) {
    throw new Error('SETTLEMENT_PROOF_REQUIRED');
  }

  return { controls, account, proofCount };
}

async function markBatchPaidResponse(request, env, batchId) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const payoutReference = cleanText(body.payout_reference || body.payoutReference, 200);
  if (!payoutReference) throw new Error('PAYOUT_REFERENCE_REQUIRED');

  const batch = await loadBatch(env, context.tenantSlug, batchId);
  if (!batch) throw new Error('SETTLEMENT_BATCH_NOT_FOUND');
  if (batch.status === 'paid') throw new Error('SETTLEMENT_BATCH_ALREADY_PAID');
  if (batch.status !== 'approved') throw new Error('INVALID_SETTLEMENT_STATUS');

  const validation = await validateSettlementPaymentControls(env, context.tenantSlug, batchId);
  const account = validation.account || {};

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE platform_collection_batches
      SET status = 'paid',
          payout_reference = ?,
          paid_by = ?,
          paid_at = datetime('now'),
          payout_bank_code = COALESCE(NULLIF(?, ''), payout_bank_code),
          payout_bank_name = COALESCE(NULLIF(?, ''), payout_bank_name),
          payout_account_name = COALESCE(NULLIF(?, ''), payout_account_name),
          payout_account_last4 = COALESCE(NULLIF(?, ''), payout_account_last4),
          updated_at = datetime('now')
      WHERE tenant_slug = ? AND id = ? AND status = 'approved'
    `).bind(
      payoutReference,
      context.userUid,
      cleanText(account.bank_code, 20),
      cleanText(account.bank_name, 120),
      cleanText(account.account_name, 120),
      cleanText(account.account_last4, 4),
      context.tenantSlug,
      batchId,
    ),
    env.DB.prepare(`
      UPDATE platform_collection_payables
      SET status = 'paid', updated_at = datetime('now')
      WHERE tenant_slug = ? AND batch_id = ? AND status = 'batched'
    `).bind(context.tenantSlug, batchId),
  ]);

  return json({
    success: true,
    data: await loadBatch(env, context.tenantSlug, batchId),
    controls: validation.controls,
    proof_count: validation.proofCount,
  });
}

export function isSettlementPaymentControlApiRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return path === '/api/v2/platform-settlements/controls' ||
    /^\/api\/v2\/platform-settlements\/batches\/[^/]+\/paid$/.test(path);
}

export async function routeSettlementPaymentControlApi(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/api/v2/platform-settlements/controls' && request.method === 'GET') {
      return await getControlsResponse(request, env);
    }
    if (path === '/api/v2/platform-settlements/controls' && request.method === 'POST') {
      return await updateControlsResponse(request, env);
    }
    const paidMatch = path.match(/^\/api\/v2\/platform-settlements\/batches\/([^/]+)\/paid$/);
    if (paidMatch && request.method === 'POST') {
      return await markBatchPaidResponse(request, env, decodeURIComponent(paidMatch[1]));
    }
    return json({ success: false, error: 'SETTLEMENT_PAYMENT_CONTROL_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'SETTLEMENT_PAYMENT_CONTROL_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}
