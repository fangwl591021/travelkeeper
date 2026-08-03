const ROUTE_SPECS = Object.freeze({
  orders: 'orders',
  pendingItineraries: 'review',
  customers: 'customers',
  promotions: 'promote',
  lineMonitor: ''
});

function validateBaseUrl(appBaseUrl) {
  if (typeof appBaseUrl !== 'string' || appBaseUrl.trim() === '') {
    throw new Error('APP_BASE_URL_REQUIRED');
  }
  if (!appBaseUrl.endsWith('/')) {
    throw new Error('APP_BASE_URL_MUST_END_WITH_SLASH');
  }

  let base;
  try {
    base = new URL(appBaseUrl);
  } catch {
    throw new Error('APP_BASE_URL_INVALID');
  }
  if (base.protocol !== 'https:') throw new Error('APP_BASE_URL_HTTPS_REQUIRED');
  if (base.username || base.password) throw new Error('APP_BASE_URL_CREDENTIALS_FORBIDDEN');
  if (base.search || base.hash) throw new Error('APP_BASE_URL_QUERY_HASH_FORBIDDEN');
  return base;
}

function validateTenantSlug(tenantSlug) {
  if (typeof tenantSlug !== 'string' || tenantSlug.trim() === '') {
    throw new Error('TENANT_SLUG_REQUIRED');
  }
  const value = tenantSlug.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error('TENANT_SLUG_INVALID');
  }
  return value;
}

function buildWorkspaceRouteRegistry({ appBaseUrl, tenantSlug } = {}) {
  const base = validateBaseUrl(appBaseUrl);
  const tenant = validateTenantSlug(tenantSlug);
  const registry = {};

  for (const [key, hash] of Object.entries(ROUTE_SPECS)) {
    const page = key === 'lineMonitor' ? 'line-oa-monitor.html' : 'dashboard.html';
    const url = new URL(page, base);
    url.searchParams.set('tenant', tenant);
    url.hash = hash;
    registry[key] = url.toString();
  }

  return registry;
}

export { buildWorkspaceRouteRegistry };
export default buildWorkspaceRouteRegistry;
