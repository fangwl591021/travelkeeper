import { buildWorkspaceRouteRegistry } from './workspace-route-registry.js';

const ALLOWED_INPUT_KEYS = new Set(['appBaseUrl', 'tenantSlug']);
const ADAPTER_ERROR = 'WORKSPACE_ROUTE_ADAPTER_UNAVAILABLE';

function validInput(input) {
  return input
    && typeof input === 'object'
    && !Array.isArray(input)
    && Object.keys(input).every((key) => ALLOWED_INPUT_KEYS.has(key));
}

function resolveWorkspaceWebhookRoutes(input = {}) {
  if (!validInput(input)) throw new Error(ADAPTER_ERROR);
  try {
    return buildWorkspaceRouteRegistry({
      appBaseUrl: input.appBaseUrl,
      tenantSlug: input.tenantSlug
    });
  } catch {
    throw new Error(ADAPTER_ERROR);
  }
}

export { ADAPTER_ERROR, resolveWorkspaceWebhookRoutes };
export default resolveWorkspaceWebhookRoutes;
