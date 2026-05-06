export const customerNavItems = [
  { id: 'overview', label: 'Overview', path: '/console/overview' },
  { id: 'devices', label: 'Devices', path: '/console/devices' },
  { id: 'operations', label: 'Operations', path: '/console/operations' },
  { id: 'firmware-ota', label: 'Firmware & OTA', path: '/console/firmware-ota' },
  { id: 'stream-health', label: 'Stream Health', path: '/console/stream-health' },
  { id: 'groups', label: 'Groups', path: '/console/groups' },
];

export const platformNavItems = [
  { id: 'platform-health', label: 'Service Health', path: '/admin' },
  { id: 'platform-operations', label: 'Operations Log', path: '/admin/ops' },
  { id: 'platform-audit', label: 'Audit Log', path: '/admin/audit' },
];

export function titleFor(active) {
  return {
    signup: 'Sign up',
    'signup-check-email': 'Check your email',
    verify: 'Verify email',
    overview: 'Fleet Health Overview',
    devices: 'Devices',
    operations: 'Operations',
    'firmware-ota': 'Firmware & OTA',
    'stream-health': 'Stream Health',
    groups: 'Groups',
    'platform-health': 'Service Health',
    'platform-operations': 'Operations',
    'platform-audit': 'Audit Log',
  }[active];
}

export function routeFromPath(path) {
  if (path === '/signup' || path === '/signup/') return 'signup';
  if (path === '/signup/check-email' || path.startsWith('/signup/check-email/')) return 'signup-check-email';
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify';
  if (path === '/admin' || path === '/admin/') return 'platform-health';
  if (path === '/admin/ops' || path.startsWith('/admin/ops/')) return 'platform-operations';
  if (path === '/admin/operations' || path.startsWith('/admin/operations/')) return 'platform-operations';
  if (path === '/admin/audit' || path.startsWith('/admin/audit/')) return 'platform-audit';
  if (path === '/console' || path === '/console/' || path === '/console/overview' || path.startsWith('/console/overview/')) return 'overview';
  if (path === '/console/devices' || path.startsWith('/console/devices/')) return 'devices';
  if (path === '/console/operations' || path.startsWith('/console/operations/')) return 'operations';
  if (path === '/console/firmware-ota' || path.startsWith('/console/firmware-ota/')) return 'firmware-ota';
  if (path === '/console/stream-health' || path.startsWith('/console/stream-health/')) return 'stream-health';
  if (path === '/console/groups' || path.startsWith('/console/groups/')) return 'groups';
  if (path === '/console/customers' || path === '/console/audit') return 'overview';
  return 'overview';
}

export function routeFromLocation() {
  return routeFromPath(window.location.pathname);
}
