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

function requestUid(request) {
  return String(request.headers.get('x-user-uid') || '').trim();
}

const CORE_CHECKS = [
  {
    key: 'customer_first_touch_ref_mismatch',
    sql: `
      SELECT COUNT(*) AS count
      FROM customers c
      INNER JOIN tenant_first_touch_attributions f
        ON f.tenant_slug = c.tenant_slug
       AND f.line_user_uid = c.customer_line_uid
      WHERE c.tenant_slug = ?
        AND c.customer_line_uid <> ''
        AND c.ref_uid <> ''
        AND f.ref_uid <> c.ref_uid
    `,
  },
  {
    key: 'crm_customer_ref_mismatch',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_crm_profiles p
      INNER JOIN customers c
        ON c.tenant_slug = p.tenant_slug
       AND c.customer_id = p.customer_id
      WHERE p.tenant_slug = ?
        AND p.customer_id <> ''
        AND COALESCE(p.ref_uid, '') <> COALESCE(c.ref_uid, '')
    `,
  },
  {
    key: 'crm_customer_owner_mismatch',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_crm_profiles p
      INNER JOIN customers c
        ON c.tenant_slug = p.tenant_slug
       AND c.customer_id = p.customer_id
      WHERE p.tenant_slug = ?
        AND p.customer_id <> ''
        AND COALESCE(p.owner_uid, '') <> COALESCE(c.owner_uid, '')
    `,
  },
  {
    key: 'crm_customer_missing',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_crm_profiles p
      LEFT JOIN customers c
        ON c.tenant_slug = p.tenant_slug
       AND c.customer_id = p.customer_id
      WHERE p.tenant_slug = ?
        AND p.customer_id <> ''
        AND c.customer_id IS NULL
    `,
  },
  {
    key: 'duplicate_customer_line_identity',
    sql: `
      SELECT COUNT(*) AS count
      FROM (
        SELECT customer_line_uid
        FROM customers
        WHERE tenant_slug = ?
          AND customer_line_uid <> ''
        GROUP BY customer_line_uid
        HAVING COUNT(*) > 1
      ) duplicated
    `,
  },
  {
    key: 'crm_first_touch_ref_mismatch',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_crm_profiles p
      INNER JOIN tenant_first_touch_attributions f
        ON f.tenant_slug = p.tenant_slug
       AND f.line_user_uid = p.line_user_uid
      WHERE p.tenant_slug = ?
        AND p.customer_id = ''
        AND p.line_user_uid <> ''
        AND COALESCE(p.ref_uid, '') <> COALESCE(f.ref_uid, '')
    `,
  },
  {
    key: 'partner_self_referrer',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_distributor_profiles p
      WHERE p.tenant_slug = ?
        AND p.ref_uid <> ''
        AND p.ref_uid = p.user_uid
    `,
  },
];

const WARNING_CHECKS = [
  {
    key: 'customer_referrer_missing_first_touch',
    sql: `
      SELECT COUNT(*) AS count
      FROM customers c
      LEFT JOIN tenant_first_touch_attributions f
        ON f.tenant_slug = c.tenant_slug
       AND f.line_user_uid = c.customer_line_uid
      WHERE c.tenant_slug = ?
        AND c.customer_line_uid <> ''
        AND c.ref_uid <> ''
        AND f.line_user_uid IS NULL
    `,
  },
  {
    key: 'customer_owner_not_active',
    sql: `
      SELECT COUNT(*) AS count
      FROM customers c
      WHERE c.tenant_slug = ?
        AND c.owner_uid <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_memberships m
          WHERE m.tenant_slug = c.tenant_slug
            AND m.user_uid = c.owner_uid
            AND m.status = 'active'
            AND m.role IN ('sales', 'editor')
        )
    `,
  },
  {
    key: 'customer_referrer_membership_missing',
    sql: `
      SELECT COUNT(*) AS count
      FROM customers c
      WHERE c.tenant_slug = ?
        AND c.ref_uid <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_memberships m
          WHERE m.tenant_slug = c.tenant_slug
            AND m.user_uid = c.ref_uid
        )
    `,
  },
  {
    key: 'first_touch_referrer_membership_missing',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_first_touch_attributions f
      WHERE f.tenant_slug = ?
        AND f.ref_uid <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_memberships m
          WHERE m.tenant_slug = f.tenant_slug
            AND m.user_uid = f.ref_uid
        )
    `,
  },
  {
    key: 'crm_owner_not_active',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_crm_profiles p
      WHERE p.tenant_slug = ?
        AND p.owner_uid <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_memberships m
          WHERE m.tenant_slug = p.tenant_slug
            AND m.user_uid = p.owner_uid
            AND m.status = 'active'
            AND m.role IN ('sales', 'editor')
        )
    `,
  },
  {
    key: 'partner_referrer_membership_missing',
    sql: `
      SELECT COUNT(*) AS count
      FROM tenant_distributor_profiles p
      WHERE p.tenant_slug = ?
        AND p.ref_uid <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_memberships m
          WHERE m.tenant_slug = p.tenant_slug
            AND m.user_uid = p.ref_uid
        )
    `,
  },
  {
    key: 'order_distributor_membership_missing',
    sql: `
      SELECT COUNT(*) AS count
      FROM orders o
      WHERE o.tenant_slug = ?
        AND o.distributor_uid <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_memberships m
          WHERE m.tenant_slug = o.tenant_slug
            AND m.user_uid = o.distributor_uid
        )
    `,
  },
];

function isMigrationMissing(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('no such table: tenant_first_touch_attributions') ||
    message.includes('no such column: ref_uid');
}

async function countCheck(env, tenantSlug, check) {
  try {
    const row = await env.DB.prepare(check.sql).bind(tenantSlug).first();
    return Math.max(0, Number(row?.count || 0));
  } catch (error) {
    if (isMigrationMissing(error)) throw new Error('ATTRIBUTION_MIGRATION_REQUIRED');
    throw error;
  }
}

async function runChecks(env, tenantSlug, checks) {
  const result = {};
  for (const check of checks) {
    result[check.key] = await countCheck(env, tenantSlug, check);
  }
  return result;
}

function totalCounts(values) {
  return Object.values(values).reduce((sum, value) => sum + Number(value || 0), 0);
}

async function attributionIntegrity(request, env) {
  if (!env.DB) throw new Error('D1_REQUIRED');
  const tenantSlug = requestedTenantSlug(request);
  const userUid = requestUid(request);
  await requireTenantContext(env, {
    tenantSlug,
    userUid,
    allowedRoles: ['platform_admin', 'tenant_admin'],
  });

  const core = await runChecks(env, tenantSlug, CORE_CHECKS);
  const warnings = await runChecks(env, tenantSlug, WARNING_CHECKS);
  const coreMismatchCount = totalCounts(core);
  const warningCount = totalCounts(warnings);

  return json({
    success: true,
    tenantSlug,
    healthy: coreMismatchCount === 0,
    gate: {
      required_schema: '0116+',
      core_mismatch_count: coreMismatchCount,
      warning_count: warningCount,
    },
    core,
    warnings,
    checked_at: new Date().toISOString(),
  });
}

export function isTenantAttributionIntegrityRequest(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return path === '/api/v2/attribution/integrity';
}

export async function routeTenantAttributionIntegrity(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  try {
    if (request.method === 'GET' && path === '/api/v2/attribution/integrity') {
      return await attributionIntegrity(request, env);
    }
    return json({ success: false, error: 'TENANT_ATTRIBUTION_INTEGRITY_ROUTE_NOT_FOUND' }, 404);
  } catch (error) {
    const code = String(error?.message || error || 'TENANT_ATTRIBUTION_INTEGRITY_ERROR');
    const status = code === 'ATTRIBUTION_MIGRATION_REQUIRED'
      ? 503
      : statusForError(code, 400);
    return json({ success: false, error: code }, status);
  }
}
