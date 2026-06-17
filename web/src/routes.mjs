export const customerNavItems = [
  { id: 'overview', label: 'Overview', path: '/console/overview', icon: 'gauge-high' },
  { id: 'devices', label: 'Devices', path: '/console/devices', icon: 'video' },
  { id: 'firmware-ota', label: 'Firmware & OTA', path: '/console/firmware-ota', icon: 'microchip' },
  { id: 'stream-health', label: 'Stream Health', path: '/console/stream-health', icon: 'tower-broadcast' },
];

export const platformNavItems = [
  { id: 'platform-dashboard', label: 'Platform Dashboard', path: '/admin', icon: 'gauge-high' },
  { id: 'platform-grafana', label: 'Grafana', path: '/admin/grafana', icon: 'chart-simple' },
  { id: 'platform-resources', label: 'Resource Trends', path: '/admin/resources', icon: 'chart-line' },
  { id: 'platform-health', label: 'Service Health', path: '/admin/health', icon: 'heart-pulse' },
  { id: 'platform-brand-clouds', label: 'Brand Clouds', path: '/admin/brand-clouds', icon: 'cloud' },
  { id: 'platform-sso', label: 'SSO Providers', path: '/admin/sso', icon: 'key' },
  { id: 'platform-logs', label: 'Service Logs', path: '/admin/logs', icon: 'file-lines' },
  { id: 'platform-operations', label: 'Operations Log', path: '/admin/ops', icon: 'list-check' },
  { id: 'platform-audit', label: 'Audit Log', path: '/admin/audit', icon: 'shield-halved' },
];

const publicRouteIds = new Set(['login', 'login-check-email', 'login-activate', 'forgot-password', 'reset-password', 'signup', 'signup-check-email', 'verify']);

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
    login: 'Sign in',
    'login-check-email': 'Check your email',
    'login-activate': 'Activate sign-in',
    'forgot-password': 'Forgot password',
    'reset-password': 'Reset password',
    signup: 'Sign up',
    'signup-check-email': 'Check your email',
    verify: 'Verify email',
    overview: 'Fleet Health Overview',
    devices: 'Devices',
    'firmware-ota': 'Firmware & OTA',
    'stream-health': 'Stream Health',
    'platform-dashboard': 'Platform Dashboard',
    'platform-grafana': 'Grafana',
    'platform-resources': 'Resource Trends',
    'platform-health': 'Service Health',
    'platform-brand-clouds': 'Brand Clouds',
    'platform-sso': 'SSO Providers',
    'platform-logs': 'Service Logs',
    'platform-operations': 'Operations',
    'platform-audit': 'Audit Log',
  }[active];
}

export function routeFromPath(path) {
  if (path === '/login' || path === '/login/') return 'login';
  if (path === '/login/check-email' || path.startsWith('/login/check-email/')) return 'login-check-email';
  if (path === '/login/activate' || path.startsWith('/login/activate/')) return 'login-activate';
  if (path === '/forgot-password' || path.startsWith('/forgot-password/')) return 'forgot-password';
  if (path === '/reset-password' || path.startsWith('/reset-password/')) return 'reset-password';
  if (path === '/signup' || path === '/signup/') return 'signup';
  if (path === '/signup/check-email' || path.startsWith('/signup/check-email/')) return 'signup-check-email';
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify';
  if (path === '/admin' || path === '/admin/') return 'platform-dashboard';
  if (path === '/admin/grafana' || path.startsWith('/admin/grafana/')) return 'platform-grafana';
  if (path === '/admin/resources' || path.startsWith('/admin/resources/')) return 'platform-resources';
  if (path === '/admin/health' || path.startsWith('/admin/health/')) return 'platform-health';
  if (path === '/admin/brand-clouds' || path.startsWith('/admin/brand-clouds/')) return 'platform-brand-clouds';
  if (path === '/admin/sso' || path.startsWith('/admin/sso/')) return 'platform-sso';
  if (path === '/admin/logs' || path.startsWith('/admin/logs/')) return 'platform-logs';
  if (path === '/admin/ops' || path.startsWith('/admin/ops/')) return 'platform-operations';
  if (path === '/admin/operations' || path.startsWith('/admin/operations/')) return 'platform-operations';
  if (path === '/admin/audit' || path.startsWith('/admin/audit/')) return 'platform-audit';
  if (path.startsWith('/admin/')) return 'platform-dashboard';
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
