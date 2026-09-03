const cloudPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function scopedCustomerAPI(path, cloudId) {
  if (!cloudId) return path;
  if (!cloudPattern.test(cloudId)) throw new Error('Invalid cloud ID');
  const input = String(path || '');
  const root = `/api/developer/brand-clouds/${encodeURIComponent(cloudId)}`;
  for (const prefix of ['/api/fleet', '/api/devices', '/api/groups', '/api/tags', '/api/jobs', '/api/reports', '/api/update-plans', '/api/provisioning', '/api/operations', '/api/audit']) {
    if (input === prefix || input.startsWith(`${prefix}/`) || input.startsWith(`${prefix}?`)) {
      return `${root}${input.slice('/api'.length)}`;
    }
  }
  if (input === '/api/products' || input.startsWith('/api/products/') || input.startsWith('/api/products?')) return `${root}/products${input.slice('/api/products'.length)}`;
  return input;
}

export function cloudConsolePath(cloudId, route = 'overview') {
  if (!cloudPattern.test(cloudId)) throw new Error('Invalid cloud ID');
  const suffix = {
    overview: '',
    devices: '/fleet',
    groups: '/fleet/groups',
    jobs: '/fleet/jobs',
    provisioning: '/fleet/provisioning',
    'product-services': '/products',
    'firmware-ota': '/firmware-ota',
    'stream-health': '/analytics',
    reports: '/analytics/reports',
    access: '/members',
    settings: '/settings',
    billing: '/billing',
  }[route];
  return `/console/clouds/${cloudId}${suffix ?? ''}`;
}
