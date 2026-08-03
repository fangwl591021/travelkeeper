import { routeWorkspaceIntent } from './workspace-intent-router.js';
import { resolveWorkspaceIdentity } from './workspace-identity-resolver.js';
import { authorizeWorkspaceIntent } from './workspace-permission.js';
import { buildWorkspaceFlex } from './workspace-flex.js';

const LOGIN_REQUIRED_TEXT = '請先完成 LINE 登入，再開啟工作台。';
const FORBIDDEN_TEXT = '目前沒有權限使用此工作台。';
const CONFIGURATION_ERROR_TEXT = '工作台目前無法開啟，請稍後再試。';

function coordinateWorkspaceRequest(input = {}) {
  const { text, identityInput, routes } = input && typeof input === 'object' ? input : {};
  const routed = routeWorkspaceIntent(text);
  if (!routed.matched) {
    return { handled: false, outcome: 'not_workspace_intent' };
  }

  const identity = resolveWorkspaceIdentity(identityInput);
  const authenticated = typeof identityInput?.verifiedUserUid === 'string'
    && identityInput.verifiedUserUid.trim() !== '';
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
    return {
      handled: true,
      outcome: 'configuration_error',
      responseText: CONFIGURATION_ERROR_TEXT
    };
  }
}

export { coordinateWorkspaceRequest };
export default coordinateWorkspaceRequest;
