const cloudPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Keep the compatibility export while the canonical URL mapping lives in one place.
export { cloudConsolePath } from './routes.mjs';

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
