import { resolveWorkspaceWebhookIdentity } from './workspace-webhook-identity-adapter.js';
import { coordinateWorkspaceRequest } from './workspace-coordinator.js';

const CONFIGURATION_ERROR_TEXT = '工作台目前無法開啟，請稍後再試。';
const ALLOWED_INPUT_KEYS = new Set([
  'env',
  'tenantSlug',
  'verifiedUserUid',
  'text',
  'routes'
]);

function configurationErrorPlan() {
  return {
    handled: true,
    outcome: 'configuration_error',
    replyPlan: {
      messages: [{ type: 'text', text: CONFIGURATION_ERROR_TEXT }]
    }
  };
}

function validInput(input) {
  return input
    && typeof input === 'object'
    && !Array.isArray(input)
    && Object.keys(input).every((key) => ALLOWED_INPUT_KEYS.has(key));
}

function toReplyPlan(coordinated) {
  if (!coordinated?.handled) {
    return { handled: false, outcome: 'not_workspace_intent', replyPlan: null };
  }

  if (coordinated.outcome === 'allowed' && coordinated.message) {
    return {
      handled: true,
      outcome: 'allowed',
      targetIntent: coordinated.targetIntent,
      replyPlan: {
        messages: [coordinated.message],
        fallbackText: coordinated.fallbackText
      }
    };
  }

  if (typeof coordinated.responseText === 'string' && coordinated.responseText) {
    return {
      handled: true,
      outcome: coordinated.outcome,
      replyPlan: {
        messages: [{ type: 'text', text: coordinated.responseText }]
      }
    };
  }

  return configurationErrorPlan();
}

async function planWorkspaceWebhookReply(input = {}) {
  if (!validInput(input)) return configurationErrorPlan();

  const intentProbe = coordinateWorkspaceRequest({ text: input.text });
  if (!intentProbe.handled) return toReplyPlan(intentProbe);

  let resolvedIdentity;
  try {
    resolvedIdentity = await resolveWorkspaceWebhookIdentity({
      env: input.env,
      tenantSlug: input.tenantSlug,
      verifiedUserUid: input.verifiedUserUid
    });
  } catch {
    return configurationErrorPlan();
  }

  return toReplyPlan(coordinateWorkspaceRequest({
    text: input.text,
    resolvedIdentity,
    routes: input.routes
  }));
}

export { planWorkspaceWebhookReply };
export default planWorkspaceWebhookReply;
