export const customerNavGroups = [
  {
    id: 'brand-cloud',
    labelKey: 'Brand Cloud',
    items: [
      { id: 'overview', labelKey: 'Brand Cloud Home', path: '/console/overview', icon: 'gauge-high', capabilities: ['fleet.read', 'customer.devices.read'], activeRoutes: ['overview', 'access', 'settings'], alwaysVisible: true },
    ],
  },
  {
    id: 'device-operations',
    labelKey: 'Device Operations',
    items: [
      { id: 'devices', labelKey: 'Devices', path: '/console/devices', icon: 'video', capabilities: ['fleet.read', 'customer.devices.read'] },
    ],
  },
  {
    id: 'product-updates',
    labelKey: 'Products and Updates',
    items: [
      { id: 'product-services', labelKey: 'Products and Services', path: '/console/product-services', icon: 'boxes-stacked', capabilities: ['product.read', 'registry_device.read'] },
      { id: 'chipset-sdk', labelKey: 'ChipSet & SDK', path: '/console/chipset-sdk', icon: 'code-branch' },
      { id: 'firmware-ota', labelKey: 'Firmware OTA', path: '/console/firmware-ota', icon: 'microchip', capabilities: ['firmware.release.read', 'ota.plan.read', 'customer.firmware.read'] },
    ],
  },
  {
    id: 'monitoring-analytics',
    labelKey: 'Monitoring and Analytics',
    items: [
      { id: 'stream-health', labelKey: 'Video Streaming Health', path: '/console/stream-health', icon: 'tower-broadcast', capabilities: ['customer.stream.read'] },
      { id: 'reports', labelKey: 'Reports', path: '/console/reports', icon: 'chart-column', capabilities: ['reports.read', 'report.read', 'customer.reports.read'] },
    ],
  },
  {
    id: 'account-management',
    labelKey: 'Account Management',
    items: [
      { id: 'billing', labelKey: 'Billing and Automatic Top-Up', path: '/console/billing', icon: 'credit-card', capabilities: ['billing_account.read'] },
    ],
  },
];

export const customerNavItems = customerNavGroups.flatMap((group) => group.items);

export const billingSubpaths = Object.freeze({
  overview: '/console/billing',
  usage: '/console/billing/usage',
  invoices: '/console/billing/invoices',
  activity: '/console/billing/activity',
  settings: '/console/billing/settings',
  profile: '/console/billing/profile',
});

export const platformNavGroups = [
  {
    id: 'platform-overview',
    labelKey: 'Platform Overview',
    items: [
      { id: 'platform-dashboard', labelKey: 'Platform Home', path: '/admin', icon: 'gauge-high' },
    ],
  },
  {
    id: 'platform-observability',
    labelKey: 'Monitoring and Diagnostics',
    items: [
      { id: 'platform-grafana', labelKey: 'Grafana', path: '/admin/grafana', icon: 'chart-simple' },
      { id: 'platform-health', labelKey: 'Service Health', path: '/admin/health', icon: 'heart-pulse' },
      { id: 'platform-logs', labelKey: 'Service Logs', path: '/admin/logs', icon: 'file-lines' },
    ],
  },
  {
    id: 'platform-organizations-products',
    labelKey: 'Organizations and Products',
    items: [
      { id: 'platform-brand-clouds', labelKey: 'Brand Cloud Management', path: '/admin/brand-clouds', icon: 'cloud' },
      { id: 'platform-chipset-providers', labelKey: 'ChipSet & SDK Providers', path: '/admin/chipset-providers', icon: 'code-branch', capabilities: ['platform.chipset_sdk.read', 'platform.chipset_sdk.edit', 'platform.chipset_sdk.publish'] },
      { id: 'platform-sso', labelKey: 'SSO Providers', path: '/admin/sso', icon: 'key' },
    ],
  },
  {
    id: 'platform-operations-audit',
    labelKey: 'Operations and Audit',
    items: [
      { id: 'platform-operations', labelKey: 'Operations Log', path: '/admin/ops', icon: 'list-check' },
      { id: 'platform-audit', labelKey: 'Audit Log', path: '/admin/audit', icon: 'shield-halved' },
    ],
  },
];

export const platformNavItems = platformNavGroups.flatMap((group) => group.items);

const publicRouteIds = new Set(['login', 'login-check-email', 'login-activate', 'forgot-password', 'reset-password', 'signup', 'signup-check-email', 'signup-verification-expired', 'verify']);

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

export function navItemsForCapabilities(route, capabilities) {
  const items = navItemsForRoute(route);
  const values = new Set(Array.isArray(capabilities) ? capabilities : []);
  return items.filter((item) => item.alwaysVisible || !item.capabilities?.length || item.capabilities.some((capability) => values.has(capability)));
}

export function navGroupsForCapabilities(route, capabilities) {
  if (isPublicRouteId(route)) return [];
  const groups = isPlatformRouteId(route) ? platformNavGroups : customerNavGroups;
  const values = new Set(Array.isArray(capabilities) ? capabilities : []);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.alwaysVisible || !item.capabilities?.length || item.capabilities.some((capability) => values.has(capability))),
    }))
    .filter((group) => group.items.length > 0);
}

export function isCustomerNavItemActive(item, route) {
  return (item.activeRoutes || [item.id]).includes(route);
}

export function canAccessCustomerRoute(route, capabilities) {
  const values = new Set(Array.isArray(capabilities) ? capabilities : []);
  if (route === 'settings') return true;
  if (route === 'access') return ['team.read', 'role_assignment.read'].some((capability) => values.has(capability));
  const item = customerNavItems.find((candidate) => candidate.id === route);
  return Boolean(item && (!item.capabilities?.length || item.capabilities.some((capability) => values.has(capability))));
}

export function defaultBrandCloudRoute(capabilities) {
  if (canAccessCustomerRoute('overview', capabilities)) return 'overview';
  if (canAccessCustomerRoute('access', capabilities)) return 'access';
  return 'settings';
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
    'signup-verification-expired': 'Verification link expired',
    verify: 'Verify email',
    'brand-cloud-member-invitation-accept': 'Accept Brand Cloud invitation',
    'product-collaborator-invitation-accept': 'Accept Product collaboration invitation',
    overview: 'Brand Cloud',
    devices: 'Devices',
    'product-services': 'Products and Services',
    'chipset-sdk': 'ChipSet & SDK',
    groups: 'Groups and Tags',
    access: 'Brand Cloud',
    settings: 'Brand Cloud',
    'firmware-ota': 'Firmware OTA',
    'stream-health': 'Video Streaming Health',
    reports: 'Reports',
    billing: 'Billing and Automatic Top-Up',
    'platform-dashboard': 'Platform Home',
    'platform-grafana': 'Grafana',
    'platform-health': 'Service Health',
    'platform-brand-clouds': 'Brand Cloud Management',
    'platform-chipset-providers': 'ChipSet & SDK Providers',
    'platform-sso': 'SSO Providers',
    'platform-logs': 'Service Logs',
    'platform-operations': 'Operations Log',
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
  if (path === '/signup/verification-expired' || path.startsWith('/signup/verification-expired/')) return 'signup-verification-expired';
  if (path === '/signup/verify' || path.startsWith('/signup/verify/')) return 'verify';
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify';
  if (path === '/brand-cloud-member-invitation/accept') return 'brand-cloud-member-invitation-accept';
  if (path === '/product-collaborator-invitation/accept') return 'product-collaborator-invitation-accept';
  if (path === '/admin' || path === '/admin/') return 'platform-dashboard';
  if (path === '/admin/grafana' || path.startsWith('/admin/grafana/')) return 'platform-grafana';
  if (path === '/admin/resources' || path.startsWith('/admin/resources/')) return 'platform-dashboard';
  if (path === '/admin/health' || path.startsWith('/admin/health/')) return 'platform-health';
  if (path === '/admin/brand-clouds' || path.startsWith('/admin/brand-clouds/')) return 'platform-brand-clouds';
  if (path === '/admin/chipset-providers' || path.startsWith('/admin/chipset-providers/')) return 'platform-chipset-providers';
  if (path === '/admin/sso' || path.startsWith('/admin/sso/')) return 'platform-sso';
  if (path === '/admin/logs' || path.startsWith('/admin/logs/')) return 'platform-logs';
  if (path === '/admin/ops' || path.startsWith('/admin/ops/')) return 'platform-operations';
  if (path === '/admin/operations' || path.startsWith('/admin/operations/')) return 'platform-operations';
  if (path === '/admin/audit' || path.startsWith('/admin/audit/')) return 'platform-audit';
  if (path.startsWith('/admin/')) return 'platform-dashboard';
  if (path === '/console' || path === '/console/' || path === '/console/overview' || path.startsWith('/console/overview/')) return 'overview';
  if (path === '/console/billing' || path.startsWith('/console/billing/')) return 'billing';
  const scoped = path.match(/^\/console\/([^/]+)\/(overview|devices|product-services|chipset-sdk|groups|access|settings|firmware-ota|stream-health|jobs|reports|billing)(?:\/|$)/);
  if (scoped) return scoped[2] === 'jobs' ? 'firmware-ota' : scoped[2];
  if (path === '/console/devices' || path.startsWith('/console/devices/')) return 'devices';
  if (path === '/console/product-services' || path.startsWith('/console/product-services/')) return 'product-services';
  if (path === '/console/chipset-sdk' || path.startsWith('/console/chipset-sdk/')) return 'chipset-sdk';
  if (path === '/console/groups' || path.startsWith('/console/groups/')) return 'groups';
  if (path === '/console/access' || path.startsWith('/console/access/')) return 'access';
  if (path === '/console/settings' || path.startsWith('/console/settings/')) return 'settings';
  if (path === '/console/firmware-ota' || path.startsWith('/console/firmware-ota/')) return 'firmware-ota';
  if (path === '/console/stream-health' || path.startsWith('/console/stream-health/')) return 'stream-health';
  if (path === '/console/jobs' || path.startsWith('/console/jobs/')) return 'firmware-ota';
  if (path === '/console/reports' || path.startsWith('/console/reports/')) return 'reports';
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

export function cloudIdFromPath(path) {
  if (/^\/console\/(?:overview|devices|product-services|chipset-sdk|groups|access|settings|firmware-ota|stream-health|jobs|reports|provisioning|billing)(?:\/|$)/.test(String(path || ''))) return '';
  const match = String(path || '').match(/^\/console\/([^/]+)\/(?:overview|devices|product-services|chipset-sdk|groups|access|settings|firmware-ota|stream-health|jobs|reports|provisioning|billing)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function routeFromLocation() {
  return routeFromPath(window.location.pathname);
}

export function canonicalCustomerPath(path) {
  const scoped = String(path || '').match(/^\/console\/([^/]+)\/jobs(?:\/.*)?$/);
  if (scoped) return `/console/${scoped[1]}/firmware-ota`;
  if (path === '/console/jobs' || String(path || '').startsWith('/console/jobs/')) return '/console/firmware-ota';
  return path;
}

export function devicesPathWithFilters({ deviceId = '', health = '', status = '', signal = '', firmware = '', productID = '', q = '', sort = '', direction = '', offset = '' } = {}) {
  const params = new URLSearchParams();
  if (deviceId) params.set('device', deviceId);
  if (health) params.set('health', health);
  if (status) params.set('status', status);
  if (signal) params.set('signal', signal);
  if (firmware) params.set('firmware', firmware);
  if (productID) params.set('product_id', productID);
  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  if (direction) params.set('direction', direction);
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return query ? `/console/devices?${query}` : '/console/devices';
}
