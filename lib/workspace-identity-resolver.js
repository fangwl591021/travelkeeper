const ROLE_ORDER = Object.freeze([
  'platform_admin',
  'tenant_admin',
  'finance',
  'partner',
  'traveler'
]);

const MEMBERSHIP_ROLE_MAP = Object.freeze({
  platform_admin: 'platform_admin',
  tenant_admin: 'tenant_admin',
  finance: 'finance',
  sales: 'partner',
  editor: 'partner',
  member: 'traveler'
});

function normalizedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function profileIsApproved(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const status = normalizedString(profile.status || profile.approval_status || profile.state).toLowerCase();
  return status === 'approved' || status === 'active';
}

function resolveWorkspaceIdentity(input = {}) {
  const {
    verifiedUserUid,
    tenantSlug,
    membership,
    distributorProfile,
    customerProfile
  } = input && typeof input === 'object' ? input : {};
  const uid = normalizedString(verifiedUserUid);
  const resolvedTenantSlug = normalizedString(tenantSlug);

  if (!uid) {
    return { tenantSlug: resolvedTenantSlug, roles: [], primaryRole: 'guest' };
  }

  const roles = new Set();
  if (membership?.status === 'active') {
    const membershipRoles = Array.isArray(membership.roles)
      ? membership.roles
      : [membership.role];
    for (const rawRole of membershipRoles) {
      const role = normalizedString(rawRole).toLowerCase();
      const mappedRole = MEMBERSHIP_ROLE_MAP[role];
      if (mappedRole) roles.add(mappedRole);
    }
  }

  if (profileIsApproved(distributorProfile)) roles.add('partner');
  if (customerProfile && typeof customerProfile === 'object') roles.add('traveler');

  const orderedRoles = ROLE_ORDER.filter((role) => roles.has(role));
  return {
    tenantSlug: resolvedTenantSlug,
    roles: orderedRoles,
    primaryRole: orderedRoles[0] || 'unassigned'
  };
}

export { resolveWorkspaceIdentity };
export default resolveWorkspaceIdentity;
