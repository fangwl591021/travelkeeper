import { resolveWorkspaceIdentity } from './workspace-identity-resolver.js';

const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const INACTIVE_PROFILE_STATUSES = new Set(['deleted', 'blocked', 'inactive']);
const APPROVED_PROFILE_STATUSES = new Set(['approved', 'active']);

function safeInputError() {
  return new Error('WORKSPACE_IDENTITY_ADAPTER_INVALID_INPUT');
}

function unavailableError() {
  return new Error('WORKSPACE_IDENTITY_ADAPTER_UNAVAILABLE');
}

function normalizeTenantSlug(value) {
  if (typeof value !== 'string') throw safeInputError();
  const tenantSlug = value.trim();
  if (!TENANT_SLUG_PATTERN.test(tenantSlug)) throw safeInputError();
  return tenantSlug;
}

function normalizeUid(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function profileStatus(profile) {
  if (!profile || typeof profile !== 'object') return '';
  return String(profile.status ?? profile.approval_status ?? profile.state ?? '')
    .trim()
    .toLowerCase();
}

function usableDistributorProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return APPROVED_PROFILE_STATUSES.has(profileStatus(profile)) ? profile : null;
}

function usableCustomerProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  if (INACTIVE_PROFILE_STATUSES.has(profileStatus(profile))) return null;
  const customerId = typeof profile.customer_id === 'string' ? profile.customer_id.trim() : '';
  return customerId ? profile : null;
}

function usableCustomerRecord(customer) {
  if (!customer || typeof customer !== 'object') return null;
  const customerId = typeof customer.customer_id === 'string' ? customer.customer_id.trim() : '';
  const lineUid = typeof customer.customer_line_uid === 'string' ? customer.customer_line_uid.trim() : '';
  return customerId && lineUid ? customer : null;
}

function assertAllowedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw safeInputError();
  const keys = Object.keys(input);
  if (keys.some((key) => !['env', 'tenantSlug', 'verifiedUserUid'].includes(key))) {
    throw safeInputError();
  }
}

async function loadIdentityFacts(env, tenantSlug, verifiedUserUid) {
  if (!env?.DB || typeof env.DB.prepare !== 'function') throw unavailableError();

  try {
    const membership = await env.DB.prepare(`
      SELECT tenant_slug, user_uid, role, status, permissions_json
      FROM tenant_memberships
      WHERE tenant_slug = ? AND user_uid = ? AND status = 'active'
      LIMIT 1
    `).bind(tenantSlug, verifiedUserUid).first();

    const distributorProfile = await env.DB.prepare(`
      SELECT *
      FROM tenant_distributor_profiles
      WHERE tenant_slug = ? AND user_uid = ?
      LIMIT 1
    `).bind(tenantSlug, verifiedUserUid).first();

    const customerProfile = await env.DB.prepare(`
      SELECT *
      FROM tenant_crm_profiles
      WHERE tenant_slug = ? AND line_user_uid = ?
      LIMIT 1
    `).bind(tenantSlug, verifiedUserUid).first();

    const customer = await env.DB.prepare(`
      SELECT tenant_slug, customer_id, customer_line_uid, owner_uid
      FROM customers
      WHERE tenant_slug = ? AND customer_line_uid = ?
      LIMIT 1
    `).bind(tenantSlug, verifiedUserUid).first();

    return { membership, distributorProfile, customerProfile, customer };
  } catch (_) {
    throw unavailableError();
  }
}

async function resolveWorkspaceWebhookIdentity(input = {}) {
  assertAllowedInput(input);
  const tenantSlug = normalizeTenantSlug(input.tenantSlug);
  const verifiedUserUid = normalizeUid(input.verifiedUserUid);

  if (!verifiedUserUid) {
    return resolveWorkspaceIdentity({ verifiedUserUid: '', tenantSlug });
  }

  const facts = await loadIdentityFacts(input.env, tenantSlug, verifiedUserUid);
  return resolveWorkspaceIdentity({
    verifiedUserUid,
    tenantSlug,
    membership: facts.membership,
    distributorProfile: usableDistributorProfile(facts.distributorProfile),
    customerProfile: usableCustomerRecord(facts.customer) || usableCustomerProfile(facts.customerProfile),
  });
}

export { resolveWorkspaceWebhookIdentity };
export default resolveWorkspaceWebhookIdentity;