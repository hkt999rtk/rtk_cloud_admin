export const customerNavItems = [
  { id: 'overview', label: 'Overview', path: '/console/overview' },
  { id: 'devices', label: 'Devices', path: '/console/devices' },
  { id: 'firmware-ota', label: 'Firmware & OTA', path: '/console/firmware-ota' },
  { id: 'stream-health', label: 'Stream Health', path: '/console/stream-health' },
];

export const platformNavItems = [
  { id: 'platform-health', label: 'Service Health', path: '/admin' },
  { id: 'platform-sso', label: 'SSO Providers', path: '/admin/sso' },
  { id: 'platform-operations', label: 'Operations Log', path: '/admin/ops' },
  { id: 'platform-audit', label: 'Audit Log', path: '/admin/audit' },
];

const publicRouteIds = new Set(['signup', 'signup-check-email', 'verify']);

export function isPublicRouteId(route) {
  return publicRouteIds.has(route);
}

export function isPlatformRouteId(route) {
  return String(route || '').startsWith('platform');
}

export function navItemsForRoute(route) {
  if (isPublicRouteId(route)) return [];
  return isPlatformRouteId(route) ? platformNavItems : customerNavItems;
}

export function titleFor(active) {
  return {
    signup: 'Sign up',
    'signup-check-email': 'Check your email',
    verify: 'Verify email',
    overview: 'Fleet Health Overview',
    devices: 'Devices',
    'firmware-ota': 'Firmware & OTA',
    'stream-health': 'Stream Health',
    'platform-health': 'Service Health',
    'platform-sso': 'SSO Providers',
    'platform-operations': 'Operations',
    'platform-audit': 'Audit Log',
  }[active];
}

export function routeFromPath(path) {
  if (path === '/signup' || path === '/signup/') return 'signup';
  if (path === '/signup/check-email' || path.startsWith('/signup/check-email/')) return 'signup-check-email';
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify';
  if (path === '/admin' || path === '/admin/') return 'platform-health';
  if (path === '/admin/sso' || path.startsWith('/admin/sso/')) return 'platform-sso';
  if (path === '/admin/ops' || path.startsWith('/admin/ops/')) return 'platform-operations';
  if (path === '/admin/operations' || path.startsWith('/admin/operations/')) return 'platform-operations';
  if (path === '/admin/audit' || path.startsWith('/admin/audit/')) return 'platform-audit';
  if (path.startsWith('/admin/')) return 'platform-health';
  if (path === '/console' || path === '/console/' || path === '/console/overview' || path.startsWith('/console/overview/')) return 'overview';
  if (path === '/console/devices' || path.startsWith('/console/devices/')) return 'devices';
  if (path === '/console/firmware-ota' || path.startsWith('/console/firmware-ota/')) return 'firmware-ota';
  if (path === '/console/stream-health' || path.startsWith('/console/stream-health/')) return 'stream-health';
  if (
    path === '/console/customers' ||
    path === '/console/audit' ||
    path === '/console/groups' ||
    path.startsWith('/console/groups/') ||
    path === '/console/operations' ||
    path.startsWith('/console/operations/')
  ) return 'overview';
  return 'overview';
}

export function routeFromLocation() {
  return routeFromPath(window.location.pathname);
}

export function devicesPathWithFilters({ deviceId = '', health = '', status = '', signal = '', firmware = '' } = {}) {
  const params = new URLSearchParams();
  if (deviceId) params.set('device', deviceId);
  if (health) params.set('health', health);
  if (status) params.set('status', status);
  if (signal) params.set('signal', signal);
  if (firmware) params.set('firmware', firmware);
  const query = params.toString();
  return query ? `/console/devices?${query}` : '/console/devices';
}
