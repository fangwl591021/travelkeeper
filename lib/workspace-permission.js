const WORKSPACE_ROLES = Object.freeze([
  'platform_admin',
  'tenant_admin',
  'partner',
  'traveler',
  'finance'
]);

function result(allowed, decision, targetIntent = '', reason = '') {
  return { allowed, decision, targetIntent, reason };
}

function authorizeWorkspaceIntent(input = {}) {
  const { intent, identity } = input && typeof input === 'object' ? input : {};
  if (identity?.authenticated !== true) {
    return result(false, 'login_required', '', 'authentication_required');
  }

  if (intent === 'unknown') {
    return result(false, 'unknown_intent', '', '');
  }

  const roles = new Set(
    (Array.isArray(identity.workspaceRoles) ? identity.workspaceRoles : identity.roles)
      ?.filter((role) => typeof role === 'string')
      .map((role) => role.trim().toLowerCase()) || []
  );

  if (identity.identityStatus === 'unassigned' || roles.size === 0) {
    return result(false, 'forbidden', '', 'no_workspace_role');
  }

  if (intent === 'generic_workspace') {
    if (roles.has('platform_admin')) return result(true, 'allow', 'admin_dashboard');
    if (roles.has('tenant_admin')) return result(true, 'allow', 'admin_dashboard');
    if (roles.has('partner')) return result(true, 'allow', 'partner_workspace');
    if (roles.has('traveler')) return result(true, 'allow', 'traveler_workspace');
    if (roles.has('finance')) return result(false, 'workspace_not_available', '', 'workspace_not_available');
    return result(false, 'forbidden', '', 'role_not_allowed');
  }

  if (intent === 'admin_dashboard') {
    return roles.has('platform_admin') || roles.has('tenant_admin')
      ? result(true, 'allow', 'admin_dashboard')
      : result(false, 'forbidden', '', 'role_not_allowed');
  }

  if (intent === 'partner_workspace') {
    return roles.has('partner')
      ? result(true, 'allow', 'partner_workspace')
      : result(false, 'forbidden', '', 'role_not_allowed');
  }

  if (intent === 'traveler_workspace') {
    return roles.has('traveler')
      ? result(true, 'allow', 'traveler_workspace')
      : result(false, 'forbidden', '', 'role_not_allowed');
  }

  return result(false, 'unknown_intent', '', '');
}

export { WORKSPACE_ROLES, authorizeWorkspaceIntent };
export default authorizeWorkspaceIntent;
