const ENABLED_VALUES = new Set(['1', 'true', 'on', 'yes', 'enabled']);
const STAGES = new Set(['RECEIVED', 'SIGNATURE_VERIFIED', 'LEGACY_STORED', 'SHADOW_DISPATCHED', 'SHADOW_STORED', 'FAILED']);
const RESULTS = new Set(['success', 'skipped', 'failed', 'duplicate']);
const SAFE_ERRORS = new Set([
  'SIGNATURE_INVALID',
  'LEGACY_STORE_FAILED',
  'SHADOW_DISABLED',
  'SHADOW_DISPATCH_FAILED',
  'SHADOW_STORE_FAILED',
  'SHADOW_DUPLICATE',
  'RECEIPT_WRITE_FAILED',
  'UNKNOWN_SAFE_FAILURE',
]);

export function receiptEnabled(env = {}) {
  return ENABLED_VALUES.has(String(env.TENANT_LINE_RECEIPT_ENABLED ?? '').trim().toLowerCase());
}

function safeStage(value) {
  const stage = String(value || '').trim().toUpperCase();
  return STAGES.has(stage) ? stage : 'FAILED';
}

function safeResult(value) {
  const result = String(value || '').trim().toLowerCase();
  return RESULTS.has(result) ? result : 'failed';
}

function safeErrorCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return '';
  return SAFE_ERRORS.has(code) ? code : 'UNKNOWN_SAFE_FAILURE';
}

function safeReleaseSha(value) {
  const sha = String(value || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : 'unknown';
}

function safeDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? Math.min(Math.floor(duration), 2147483647) : 0;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function receiptId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function emitLineReceipt({
  env = {},
  eventKey = '',
  tenantSlug = '',
  sourcePath = 'unknown',
  stage = 'FAILED',
  result = 'failed',
  safeErrorCode: errorCode = '',
  durationMs = 0,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!receiptEnabled(env)) return null;
  const hasVerifiedIdentity = Boolean(eventKey && tenantSlug);
  const receipt = {
    type: 'tenant_line_delivery_receipt',
    receipt_version: 1,
    receipt_id: receiptId(),
    event_key_hash: hasVerifiedIdentity ? await sha256Hex(`${tenantSlug}:${eventKey}`) : '',
    tenant_slug: hasVerifiedIdentity ? String(tenantSlug).trim().slice(0, 80) : '',
    source_path: ['legacy', 'shadow', 'tenant-v2'].includes(sourcePath) ? sourcePath : 'unknown',
    stage: safeStage(stage),
    result: safeResult(result),
    safe_error_code: safeErrorCode(errorCode),
    release_sha: safeReleaseSha(env.TRAVELKEEPER_RELEASE_SHA),
    duration_ms: safeDuration(durationMs),
    created_at: String(createdAt || new Date().toISOString()),
  };
  try {
    console.log(JSON.stringify(receipt));
  } catch (_) {
    // Receipt logging is best effort and must never affect webhook response handling.
  }
  return receipt;
}

export async function emitShadowReceipt({ env = {}, eventKey = '', tenantSlug = '', result = {}, durationMs = 0 } = {}) {
  if (result?.skipped === 'disabled') {
    return emitLineReceipt({ env, eventKey, tenantSlug, sourcePath: 'shadow', stage: 'SHADOW_DISPATCHED', result: 'skipped', safeErrorCode: 'SHADOW_DISABLED', durationMs });
  }
  if (Number(result?.duplicate || 0) > 0) {
    return emitLineReceipt({ env, eventKey, tenantSlug, sourcePath: 'shadow', stage: 'SHADOW_STORED', result: 'duplicate', safeErrorCode: 'SHADOW_DUPLICATE', durationMs });
  }
  if (Number(result?.failed || 0) > 0) {
    return emitLineReceipt({ env, eventKey, tenantSlug, sourcePath: 'shadow', stage: 'SHADOW_DISPATCHED', result: 'failed', safeErrorCode: 'SHADOW_DISPATCH_FAILED', durationMs });
  }
  if (Number(result?.mirrored || 0) > 0) {
    return emitLineReceipt({ env, eventKey, tenantSlug, sourcePath: 'shadow', stage: 'SHADOW_STORED', result: 'success', durationMs });
  }
  return emitLineReceipt({ env, eventKey, tenantSlug, sourcePath: 'shadow', stage: 'SHADOW_DISPATCHED', result: 'skipped', safeErrorCode: 'SHADOW_DISABLED', durationMs });
}