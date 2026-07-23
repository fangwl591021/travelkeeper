import {
  requestedTenantSlug,
  requireTenantContext,
} from './tenant-context.js';

const COLLECTION_MODES = new Set(['platform_collect', 'tenant_gateway', 'offline']);
const PROVIDERS = new Set(['newebpay', 'linepay', 'none']);

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
    ''
  ).trim();
}

export function normalizeCollectionMode(value, fallback = 'offline') {
  const mode = String(value || '').trim().toLowerCase();
  return COLLECTION_MODES.has(mode) ? mode : fallback;
}

export function normalizePaymentProvider(value, fallback = 'none') {
  const provider = String(value || '').trim().toLowerCase();
  return PROVIDERS.has(provider) ? provider : fallback;
}

export async function getTenantPaymentPolicy(env, tenantSlug) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const tenant = String(tenantSlug || 'demo').trim().toLowerCase() || 'demo';

  const row = await env.DB.prepare(`
    SELECT
      tenant_slug,
      collection_mode,
      provider,
      enabled,
      display_label,
      settlement_note,
      updated_by,
      created_at,
      updated_at
    FROM tenant_payment_settings
    WHERE tenant_slug = ?
    LIMIT 1
  `).bind(tenant).first().catch(error => {
    if (String(error?.message || '').includes('no such table')) return null;
    throw error;
  });

  if (row) {
    return {
      tenantSlug: tenant,
      collectionMode: normalizeCollectionMode(row.collection_mode),
      provider: normalizePaymentProvider(row.provider),
      enabled: Number(row.enabled || 0) === 1,
      displayLabel: row.display_label || '',
      settlementNote: row.settlement_note || '',
      updatedBy: row.updated_by || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      source: 'tenant_payment_settings',
    };
  }

  // Backward-compatible safe defaults before migration is applied.
  return tenant === 'demo'
    ? {
        tenantSlug: tenant,
        collectionMode: 'platform_collect',
        provider: 'newebpay',
        enabled: true,
        displayLabel: '平台代收',
        settlementNote: '沿用既有平台藍新金流設定',
        source: 'legacy_default',
      }
    : {
        tenantSlug: tenant,
        collectionMode: 'offline',
        provider: 'none',
        enabled: true,
        displayLabel: '人工收款',
        settlementNote: '由業務或客服另行確認付款方式',
        source: 'safe_default',
      };
}

export function paymentPolicyMessage(policy) {
  if (!policy?.enabled) return '此業者目前未啟用收款功能，訂單已建立，客服將另行聯絡。';
  if (policy.collectionMode === 'offline') {
    return policy.settlementNote || '此合作業務採人工收款，訂單已建立，業務將另行確認付款方式。';
  }
  if (policy.collectionMode === 'tenant_gateway') {
    return '此業者採自有金流，付款參數尚未完成設定，訂單已建立，客服將協助處理。';
  }
  return policy.settlementNote || '此筆訂單由平台代收。';
}

export async function getPaymentPolicyResponse(request, env) {
  const tenantSlug = requestedTenantSlug(request);
  const context = await requireTenantContext(env, {
    tenantSlug,
    userUid: requestUid(request),
    allowedRoles: ['platform_admin', 'tenant_admin', 'finance'],
  });
  const policy = await getTenantPaymentPolicy(env, context.tenantSlug);
  return json({ success: true, data: policy });
}

export async function updatePaymentPolicyResponse(request, env) {
  const body = await request.json().catch(() => ({}));
  const tenantSlug = requestedTenantSlug(request, body);
  const context = await requireTenantContext(env, {
    tenantSlug,
    userUid: requestUid(request, body),
    allowedRoles: ['platform_admin', 'tenant_admin'],
  });

  const collectionMode = normalizeCollectionMode(body.collection_mode || body.collectionMode, '');
  if (!collectionMode) throw new Error('INVALID_COLLECTION_MODE');

  if (collectionMode === 'platform_collect' && context.role !== 'platform_admin') {
    throw new Error('PLATFORM_COLLECTION_APPROVAL_REQUIRED');
  }

  let provider = normalizePaymentProvider(body.provider, 'none');
  if (collectionMode === 'offline') provider = 'none';
  if (collectionMode === 'platform_collect' && provider === 'none') provider = 'newebpay';
  if (collectionMode === 'tenant_gateway' && provider === 'none') {
    throw new Error('PAYMENT_PROVIDER_REQUIRED');
  }

  const enabled = body.enabled === undefined
    ? 1
    : (body.enabled === true || body.enabled === 1 || body.enabled === '1' || body.enabled === 'true' ? 1 : 0);
  const displayLabel = String(body.display_label || body.displayLabel || '').trim().slice(0, 120);
  const settlementNote = String(body.settlement_note || body.settlementNote || '').trim().slice(0, 1000);

  await env.DB.prepare(`
    INSERT INTO tenant_payment_settings (
      tenant_slug, collection_mode, provider, enabled,
      display_label, settlement_note, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(tenant_slug) DO UPDATE SET
      collection_mode = excluded.collection_mode,
      provider = excluded.provider,
      enabled = excluded.enabled,
      display_label = excluded.display_label,
      settlement_note = excluded.settlement_note,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    context.tenantSlug,
    collectionMode,
    provider,
    enabled,
    displayLabel,
    settlementNote,
    context.userUid,
  ).run();

  const policy = await getTenantPaymentPolicy(env, context.tenantSlug);
  return json({ success: true, data: policy });
}
