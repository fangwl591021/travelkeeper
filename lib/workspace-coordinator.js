import { routeWorkspaceIntent } from './workspace-intent-router.js';
import { resolveWorkspaceIdentity } from './workspace-identity-resolver.js';
import { authorizeWorkspaceIntent } from './workspace-permission.js';
import { buildWorkspaceFlex } from './workspace-flex.js';

const LOGIN_REQUIRED_TEXT = '請先完成 LINE 登入，再開啟工作台。';
const FORBIDDEN_TEXT = '目前沒有權限使用此工作台。';
const CONFIGURATION_ERROR_TEXT = '工作台目前無法開啟，請稍後再試。';
const RESOLVED_IDENTITY_ROLES = new Set([
  'platform_admin',
  'tenant_admin',
  'finance',
  'partner',
  'traveler'
]);
const RESOLVED_IDENTITY_STATUSES = new Set(['guest', 'unassigned']);

function configurationError() {
  return {
    handled: true,
    outcome: 'configuration_error',
    responseText: CONFIGURATION_ERROR_TEXT
  };
}

function validateResolvedIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_RESOLVED_IDENTITY');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !['tenantSlug', 'roles', 'primaryRole'].includes(key))) {
    throw new Error('INVALID_RESOLVED_IDENTITY');
  }
  if (typeof value.tenantSlug !== 'string' || value.tenantSlug.trim() === '') {
    throw new Error('INVALID_RESOLVED_IDENTITY');
  }
  if (!Array.isArray(value.roles) || value.roles.some((role) => !RESOLVED_IDENTITY_ROLES.has(role))) {
    throw new Error('INVALID_RESOLVED_IDENTITY');
  }
  if (new Set(value.roles).size !== value.roles.length) {
    throw new Error('INVALID_RESOLVED_IDENTITY');
  }

  const primaryRole = value.primaryRole;
  if (value.roles.length === 0) {
    if (!RESOLVED_IDENTITY_STATUSES.has(primaryRole)) throw new Error('INVALID_RESOLVED_IDENTITY');
  } else if (primaryRole !== value.roles[0]) {
    throw new Error('INVALID_RESOLVED_IDENTITY');
  }

  return {
    tenantSlug: value.tenantSlug,
    roles: [...value.roles],
    primaryRole
  };
}

function coordinateWorkspaceRequest(input = {}) {
  const request = input && typeof input === 'object' ? input : {};
  const { text, identityInput, resolvedIdentity, routes } = request;
  const routed = routeWorkspaceIntent(text);
  if (!routed.matched) {
    return { handled: false, outcome: 'not_workspace_intent' };
  }

  if (Object.hasOwn(request, 'identityInput') && Object.hasOwn(request, 'resolvedIdentity')) {
    return configurationError();
  }

  let identity;
  let authenticated;
  try {
    if (Object.hasOwn(request, 'resolvedIdentity')) {
      identity = validateResolvedIdentity(resolvedIdentity);
      authenticated = identity.primaryRole !== 'guest';
    } else {
      identity = resolveWorkspaceIdentity(identityInput);
      authenticated = typeof identityInput?.verifiedUserUid === 'string'
        && identityInput.verifiedUserUid.trim() !== '';
    }
  } catch {
    return configurationError();
  }
  const authorization = authorizeWorkspaceIntent({
    intent: routed.intent,
    identity: { ...identity, authenticated }
  });

  if (authorization.decision === 'login_required') {
    return { handled: true, outcome: 'login_required', responseText: LOGIN_REQUIRED_TEXT };
  }

  if (!authorization.allowed) {
    return { handled: true, outcome: 'forbidden', responseText: FORBIDDEN_TEXT };
  }

  try {
    const flex = buildWorkspaceFlex({ targetIntent: authorization.targetIntent, routes });
    return {
      handled: true,
      outcome: 'allowed',
      targetIntent: authorization.targetIntent,
      message: flex.message,
      fallbackText: flex.fallbackText
    };
  } catch {
    return configurationError();
  }
}

export { coordinateWorkspaceRequest };
export default coordinateWorkspaceRequest;
