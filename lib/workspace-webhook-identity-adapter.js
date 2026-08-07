import { resolveWorkspaceIdentity } from './workspace-identity-resolver.js';

const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
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
  return INACTIVE_PROFILE_STATUSES.has(profileStatus(profile)) ? null : profile;
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

    return { membership, distributorProfile, customerProfile };
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
    customerProfile: usableCustomerProfile(facts.customerProfile),
  });
}

export { resolveWorkspaceWebhookIdentity };
export default resolveWorkspaceWebhookIdentity;
