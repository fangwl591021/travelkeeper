import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';
import {
  encryptTenantGatewaySecrets,
  decryptTenantGatewaySecrets,
} from './tenant-gateway-api.js';
import { statusForError } from './http-error-status.js';

const ACCOUNT_SECRET_SCOPE = 'payout_account';
const MAX_PROOF_BYTES = 8 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const PROOF_TYPES = new Set(['bank_transfer', 'receipt', 'statement', 'other']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function requestUid(request, body = null) {
  const url = new URL(request.url);
  return cleanText(
    request.headers.get('x-user-uid') ||
      body?.user_uid ||
      body?.userUid ||
      body?.uid ||
      body?.operatorUid ||
      url.searchParams.get('uid'),
    100,
  );
}

async function requireContext(request, env, allowedRoles, body = null) {
  return requireTenantContext(env, {
    tenantSlug: requestedTenantSlug(request, body),
    userUid: requestUid(request, body),
    allowedRoles,
  });
}

function asEnabled(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' ? 1 : 0;
}

export function maskBankAccount(accountNumber) {
  const digits = String(accountNumber || '').replace(/\D/g, '');
  if (!digits) return '';
  const last4 = digits.slice(-4);
  return `${'•'.repeat(Math.max(4, Math.min(12, digits.length - 4)))}${last4}`;
}

function publicAccount(row) {
  if (!row) return null;
  return {
    tenant_slug: row.tenant_slug,
    payout_method: row.payout_method || 'bank_transfer',
    bank_code: row.bank_code || '',
    bank_name: row.bank_name || '',
    branch_code: row.branch_code || '',
    branch_name: row.branch_name || '',
    account_name: row.account_name || '',
    account_last4: row.account_last4 || '',
    account_masked: row.account_last4 ? `••••••••${row.account_last4}` : '',
    configured: Boolean(row.account_ciphertext || row.payout_method === 'manual'),
    enabled: Number(row.enabled || 0) === 1,
    verification_status: row.verification_status || 'pending',
    verification_note: row.verification_note || '',
    verified_by: row.verified_by || '',
    verified_at: row.verified_at || '',
    updated_by: row.updated_by || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

async function readPayoutAccount(env, tenantSlug) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  return env.DB.prepare(`
    SELECT *
    FROM tenant_payout_accounts
    WHERE tenant_slug = ?
    LIMIT 1
  `).bind(tenantSlug).first();
}

async function getPayoutAccountResponse(request, env) {
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'finance']);
  const row = await readPayoutAccount(env, context.tenantSlug);
  return json({ success: true, data: publicAccount(row), tenantSlug: context.tenantSlug });
}

function validateBankAccount(body) {
  const payoutMethod = cleanText(body.payout_method || body.payoutMethod || 'bank_transfer', 30).toLowerCase();
  if (!['bank_transfer', 'manual'].includes(payoutMethod)) throw new Error('INVALID_PAYOUT_METHOD');

  const bankCode = cleanText(body.bank_code || body.bankCode, 20);
  const bankName = cleanText(body.bank_name || body.bankName, 120);
  const branchCode = cleanText(body.branch_code || body.branchCode, 30);
  const branchName = cleanText(body.branch_name || body.branchName, 120);
  const accountName = cleanText(body.account_name || body.accountName, 160);
  const accountNumber = String(body.account_number || body.accountNumber || '').replace(/[\s-]/g, '');

  if (payoutMethod === 'bank_transfer') {
    if (!bankCode && !bankName) throw new Error('INVALID_BANK_ACCOUNT');
    if (!accountName) throw new Error('INVALID_BANK_ACCOUNT');
    if (!/^\d{6,20}$/.test(accountNumber)) throw new Error('INVALID_BANK_ACCOUNT');
  }

  return {
    payoutMethod,
    bankCode,
    bankName,
    branchCode,
    branchName,
    accountName,
    accountNumber,
  };
}

async function updatePayoutAccountResponse(request, env) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin'], body);
  const account = validateBankAccount(body);
  const enabled = asEnabled(body.enabled, 1);

  let encrypted = { ciphertext: '', iv: '', keyVersion: cleanText(env.TENANT_PAYMENT_KEY_VERSION || 'v1', 40) || 'v1' };
  if (account.payoutMethod === 'bank_transfer') {
    encrypted = await encryptTenantGatewaySecrets(
      env,
      context.tenantSlug,
      ACCOUNT_SECRET_SCOPE,
      { accountNumber: account.accountNumber },
    );
  }

  await env.DB.prepare(`
    INSERT INTO tenant_payout_accounts (
      tenant_slug, payout_method, bank_code, bank_name, branch_code, branch_name,
      account_name, account_last4, account_ciphertext, account_iv, key_version,
      enabled, verification_status, verification_note, verified_by, verified_at,
      updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', '', ?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_slug) DO UPDATE SET
      payout_method = excluded.payout_method,
      bank_code = excluded.bank_code,
      bank_name = excluded.bank_name,
      branch_code = excluded.branch_code,
      branch_name = excluded.branch_name,
      account_name = excluded.account_name,
      account_last4 = excluded.account_last4,
      account_ciphertext = excluded.account_ciphertext,
      account_iv = excluded.account_iv,
      key_version = excluded.key_version,
      enabled = excluded.enabled,
      verification_status = 'pending',
      verification_note = '',
      verified_by = '',
      verified_at = '',
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    context.tenantSlug,
    account.payoutMethod,
    account.bankCode,
    account.bankName,
    account.branchCode,
    account.branchName,
    account.accountName,
    account.accountNumber.slice(-4),
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.keyVersion,
    enabled,
    context.userUid,
  ).run();

  return json({
    success: true,
    data: publicAccount(await readPayoutAccount(env, context.tenantSlug)),
    tenantSlug: context.tenantSlug,
  });
}

async function verifyPayoutAccountResponse(request, env) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const verificationStatus = cleanText(body.verification_status || body.verificationStatus, 30).toLowerCase();
  if (!['verified', 'rejected', 'disabled'].includes(verificationStatus)) {
    throw new Error('INVALID_PAYOUT_ACCOUNT_STATUS');
  }
  const note = cleanText(body.verification_note || body.verificationNote, 1000);
  const result = await env.DB.prepare(`
    UPDATE tenant_payout_accounts
    SET verification_status = ?,
        verification_note = ?,
        verified_by = ?,
        verified_at = datetime('now'),
        enabled = CASE WHEN ? = 'disabled' THEN 0 ELSE enabled END,
        updated_at = datetime('now')
    WHERE tenant_slug = ?
  `).bind(
    verificationStatus,
    note,
    context.userUid,
    verificationStatus,
    context.tenantSlug,
  ).run();
  if (!Number(result.meta?.changes || 0)) throw new Error('PAYOUT_ACCOUNT_NOT_FOUND');
  return json({ success: true, data: publicAccount(await readPayoutAccount(env, context.tenantSlug)) });
}

async function revealPayoutAccountResponse(request, env) {
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const reason = cleanText(body.reason, 500);
  if (reason.length < 5) throw new Error('PAYOUT_ACCOUNT_REVEAL_REASON_REQUIRED');
  const row = await readPayoutAccount(env, context.tenantSlug);
  if (!row) throw new Error('PAYOUT_ACCOUNT_NOT_FOUND');
  if (row.payout_method !== 'bank_transfer' || !row.account_ciphertext || !row.account_iv) {
    throw new Error('PAYOUT_ACCOUNT_NOT_CONFIGURED');
  }
  const secrets = await decryptTenantGatewaySecrets(env, context.tenantSlug, ACCOUNT_SECRET_SCOPE, {
    key_version: row.key_version,
    secrets_ciphertext: row.account_ciphertext,
    secrets_iv: row.account_iv,
  });
  const accountNumber = String(secrets.accountNumber || '').replace(/\D/g, '');
  if (!accountNumber) throw new Error('PAYOUT_ACCOUNT_DECRYPT_FAILED');

  await env.DB.prepare(`
    INSERT INTO audit_logs (
      id, tenant_slug, actor_uid, action, target_type, target_id,
      before_json, after_json, request_id, created_at
    ) VALUES (?, ?, ?, 'payout_account.reveal', 'tenant_payout_account', ?, '', ?, '', datetime('now'))
  `).bind(
    crypto.randomUUID(),
    context.tenantSlug,
    context.userUid,
    context.tenantSlug,
    JSON.stringify({ reason }).slice(0, 2000),
  ).run();

  return json({
    success: true,
    data: {
      ...publicAccount(row),
      account_number: accountNumber,
      reveal_reason: reason,
    },
  });
}

function proofId() {
  return `SPF${Date.now()}${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

function safeFilename(value) {
  const normalized = cleanText(value || 'proof', 180)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-');
  return normalized || 'proof';
}

function decodeBase64Payload(body) {
  let contentType = cleanText(body.content_type || body.contentType, 120).toLowerCase();
  let encoded = String(body.base64 || body.data || '').trim();
  const dataUrl = encoded.match(/^data:([^;,]+);base64,(.+)$/is);
  if (dataUrl) {
    contentType = contentType || dataUrl[1].toLowerCase();
    encoded = dataUrl[2];
  }
  if (!encoded || !/^[a-z0-9+/=\s]+$/i.test(encoded)) throw new Error('INVALID_PROOF_FILE');
  if (!ALLOWED_PROOF_TYPES.has(contentType)) throw new Error('INVALID_PROOF_FILE_TYPE');
  const binary = atob(encoded.replace(/\s+/g, ''));
  if (!binary.length) throw new Error('INVALID_PROOF_FILE');
  if (binary.length > MAX_PROOF_BYTES) throw new Error('PROOF_FILE_TOO_LARGE');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, contentType };
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

async function loadBatch(env, tenantSlug, batchId) {
  return env.DB.prepare(`
    SELECT *
    FROM platform_collection_batches
    WHERE tenant_slug = ? AND id = ?
    LIMIT 1
  `).bind(tenantSlug, batchId).first();
}

function proofPublic(row) {
  return {
    id: row.id,
    tenant_slug: row.tenant_slug,
    batch_id: row.batch_id,
    proof_type: row.proof_type,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes || 0),
    checksum_sha256: row.checksum_sha256,
    reference_no: row.reference_no,
    note: row.note,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
    file_api: `/api/v2/settlement-finance/proofs/${encodeURIComponent(row.id)}/file`,
  };
}

async function listProofsResponse(request, env, batchId) {
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'finance']);
  const batch = await loadBatch(env, context.tenantSlug, batchId);
  if (!batch) throw new Error('SETTLEMENT_BATCH_NOT_FOUND');
  const rows = await env.DB.prepare(`
    SELECT *
    FROM platform_collection_batch_proofs
    WHERE tenant_slug = ? AND batch_id = ? AND deleted_at = ''
    ORDER BY created_at DESC
  `).bind(context.tenantSlug, batchId).all();
  return json({ success: true, data: (rows.results || []).map(proofPublic), tenantSlug: context.tenantSlug });
}

async function uploadProofResponse(request, env, batchId) {
  if (!env.TRAVEL) throw new Error('R2_REQUIRED');
  const body = await request.json().catch(() => ({}));
  const context = await requireContext(request, env, ['platform_admin'], body);
  const batch = await loadBatch(env, context.tenantSlug, batchId);
  if (!batch) throw new Error('SETTLEMENT_BATCH_NOT_FOUND');

  const proofType = cleanText(body.proof_type || body.proofType || 'bank_transfer', 30).toLowerCase();
  if (!PROOF_TYPES.has(proofType)) throw new Error('INVALID_PROOF_TYPE');
  const filename = safeFilename(body.filename || `settlement-${batchId}`);
  const { bytes, contentType } = decodeBase64Payload(body);
  const id = proofId();
  const storageKey = `private/settlement-proofs/${context.tenantSlug}/${batchId}/${id}-${filename}`;
  const checksum = await sha256Hex(bytes);
  const referenceNo = cleanText(body.reference_no || body.referenceNo, 200);
  const note = cleanText(body.note, 1000);

  await env.TRAVEL.put(storageKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      tenantSlug: context.tenantSlug,
      batchId,
      proofId: id,
      uploadedBy: context.userUid,
      checksumSha256: checksum,
    },
  });

  try {
    await env.DB.prepare(`
      INSERT INTO platform_collection_batch_proofs (
        id, tenant_slug, batch_id, proof_type, storage_key, filename,
        content_type, size_bytes, checksum_sha256, reference_no, note,
        uploaded_by, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), '')
    `).bind(
      id,
      context.tenantSlug,
      batchId,
      proofType,
      storageKey,
      filename,
      contentType,
      bytes.length,
      checksum,
      referenceNo,
      note,
      context.userUid,
    ).run();
  } catch (error) {
    await env.TRAVEL.delete(storageKey).catch(() => null);
    throw error;
  }

  const account = await readPayoutAccount(env, context.tenantSlug);
  if (account && !batch.payout_account_last4) {
    await env.DB.prepare(`
      UPDATE platform_collection_batches
      SET payout_bank_code = ?, payout_bank_name = ?, payout_account_name = ?,
          payout_account_last4 = ?, updated_at = datetime('now')
      WHERE tenant_slug = ? AND id = ?
    `).bind(
      account.bank_code || '',
      account.bank_name || '',
      account.account_name || '',
      account.account_last4 || '',
      context.tenantSlug,
      batchId,
    ).run();
  }

  const row = await env.DB.prepare(`
    SELECT * FROM platform_collection_batch_proofs
    WHERE tenant_slug = ? AND id = ?
  `).bind(context.tenantSlug, id).first();
  return json({ success: true, data: proofPublic(row) }, 201);
}

async function loadProofForContext(request, env, proofIdValue, roles) {
  const context = await requireContext(request, env, roles);
  const row = await env.DB.prepare(`
    SELECT *
    FROM platform_collection_batch_proofs
    WHERE tenant_slug = ? AND id = ? AND deleted_at = ''
    LIMIT 1
  `).bind(context.tenantSlug, proofIdValue).first();
  if (!row) throw new Error('PROOF_NOT_FOUND');
  return { context, row };
}

async function downloadProofResponse(request, env, proofIdValue) {
  if (!env.TRAVEL) throw new Error('R2_REQUIRED');
  const { row } = await loadProofForContext(
    request,
    env,
    proofIdValue,
    ['platform_admin', 'tenant_admin', 'finance'],
  );
  const object = await env.TRAVEL.get(row.storage_key);
  if (!object) throw new Error('PROOF_NOT_FOUND');
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set('Content-Type', row.content_type || headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${safeFilename(row.filename)}"`);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

async function deleteProofResponse(request, env, proofIdValue) {
  if (!env.TRAVEL) throw new Error('R2_REQUIRED');
  const { context, row } = await loadProofForContext(request, env, proofIdValue, ['platform_admin']);
  await env.DB.prepare(`
    UPDATE platform_collection_batch_proofs
    SET deleted_at = datetime('now')
    WHERE tenant_slug = ? AND id = ? AND deleted_at = ''
  `).bind(context.tenantSlug, proofIdValue).run();
  await env.TRAVEL.delete(row.storage_key).catch(() => null);
  return json({ success: true, data: { id: proofIdValue, deleted: true } });
}

function normalizeDate(value) {
  const date = cleanText(value, 10);
  if (!date) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_REPORT_DATE');
  return date;
}

async function reportResponse(request, env) {
  const url = new URL(request.url);
  const context = await requireContext(request, env, ['platform_admin', 'tenant_admin', 'finance']);
  const from = normalizeDate(url.searchParams.get('from'));
  const to = normalizeDate(url.searchParams.get('to'));
  const binds = [context.tenantSlug];
  let payableWhere = 'tenant_slug = ?';
  let batchWhere = 'b.tenant_slug = ?';
  if (from) {
    payableWhere += ' AND date(created_at) >= date(?)';
    batchWhere += ' AND date(b.created_at) >= date(?)';
    binds.push(from);
  }
  if (to) {
    payableWhere += ' AND date(created_at) <= date(?)';
    batchWhere += ' AND date(b.created_at) <= date(?)';
    binds.push(to);
  }

  const payableBinds = [...binds];
  const batchBinds = [...binds];
  const payables = await env.DB.prepare(`
    SELECT
      status,
      COUNT(*) AS item_count,
      COALESCE(SUM(gross_amount), 0) AS gross_amount,
      COALESCE(SUM(gateway_fee_amount), 0) AS gateway_fee_amount,
      COALESCE(SUM(platform_fee_amount), 0) AS platform_fee_amount,
      COALESCE(SUM(reserve_amount), 0) AS reserve_amount,
      COALESCE(SUM(payable_amount), 0) AS payable_amount
    FROM platform_collection_payables
    WHERE ${payableWhere}
    GROUP BY status
    ORDER BY status
  `).bind(...payableBinds).all();

  const batches = await env.DB.prepare(`
    SELECT
      b.*,
      COUNT(DISTINCT p.id) AS proof_count
    FROM platform_collection_batches b
    LEFT JOIN platform_collection_batch_proofs p
      ON p.tenant_slug = b.tenant_slug
     AND p.batch_id = b.id
     AND p.deleted_at = ''
    WHERE ${batchWhere}
    GROUP BY b.id
    ORDER BY b.created_at DESC
    LIMIT 200
  `).bind(...batchBinds).all();

  const summary = {
    item_count: 0,
    gross_amount: 0,
    gateway_fee_amount: 0,
    platform_fee_amount: 0,
    reserve_amount: 0,
    payable_amount: 0,
    paid_amount: 0,
    pending_amount: 0,
  };
  for (const row of payables.results || []) {
    const count = Number(row.item_count || 0);
    const payable = Number(row.payable_amount || 0);
    summary.item_count += count;
    summary.gross_amount += Number(row.gross_amount || 0);
    summary.gateway_fee_amount += Number(row.gateway_fee_amount || 0);
    summary.platform_fee_amount += Number(row.platform_fee_amount || 0);
    summary.reserve_amount += Number(row.reserve_amount || 0);
    summary.payable_amount += payable;
    if (row.status === 'paid') summary.paid_amount += payable;
    if (['pending', 'eligible', 'batched'].includes(row.status)) summary.pending_amount += payable;
  }

  return json({
    success: true,
    data: {
      tenant_slug: context.tenantSlug,
      period: { from, to },
      account: publicAccount(await readPayoutAccount(env, context.tenantSlug)),
      summary,
      payable_statuses: payables.results || [],
      batches: batches.results || [],
      generated_at: new Date().toISOString(),
    },
  });
}

export function settlementProofStorageKey(tenantSlug, batchId, id, filename) {
  return `private/settlement-proofs/${cleanText(tenantSlug, 63)}/${cleanText(batchId, 120)}/${cleanText(id, 120)}-${safeFilename(filename)}`;
}

export function validateProofMetadata(contentType, sizeBytes) {
  if (!ALLOWED_PROOF_TYPES.has(String(contentType || '').toLowerCase())) return false;
  return Number(sizeBytes || 0) > 0 && Number(sizeBytes || 0) <= MAX_PROOF_BYTES;
}

export function isSettlementFinanceApiRequest(request) {
  return new URL(request.url).pathname.startsWith('/api/v2/settlement-finance');
}

export async function routeSettlementFinanceApi(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/api/v2/settlement-finance/payout-account' && request.method === 'GET') {
      return await getPayoutAccountResponse(request, env);
    }
    if (path === '/api/v2/settlement-finance/payout-account' && request.method === 'POST') {
      return await updatePayoutAccountResponse(request, env);
    }
    if (path === '/api/v2/settlement-finance/payout-account/verify' && request.method === 'POST') {
      return await verifyPayoutAccountResponse(request, env);
    }
    if (path === '/api/v2/settlement-finance/payout-account/reveal' && request.method === 'POST') {
      return await revealPayoutAccountResponse(request, env);
    }
    if (path === '/api/v2/settlement-finance/report' && request.method === 'GET') {
      return await reportResponse(request, env);
    }
    const proofsMatch = path.match(/^\/api\/v2\/settlement-finance\/batches\/([^/]+)\/proofs$/);
    if (proofsMatch && request.method === 'GET') {
      return await listProofsResponse(request, env, decodeURIComponent(proofsMatch[1]));
    }
    if (proofsMatch && request.method === 'POST') {
      return await uploadProofResponse(request, env, decodeURIComponent(proofsMatch[1]));
    }
    const fileMatch = path.match(/^\/api\/v2\/settlement-finance\/proofs\/([^/]+)\/file$/);
    if (fileMatch && request.method === 'GET') {
      return await downloadProofResponse(request, env, decodeURIComponent(fileMatch[1]));
    }
    const proofMatch = path.match(/^\/api\/v2\/settlement-finance\/proofs\/([^/]+)$/);
    if (proofMatch && request.method === 'DELETE') {
      return await deleteProofResponse(request, env, decodeURIComponent(proofMatch[1]));
    }
    return json({ success: false, error: 'SETTLEMENT_FINANCE_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'SETTLEMENT_FINANCE_ERROR');
    return json({ success: false, error: code }, statusForError(code));
  }
}
