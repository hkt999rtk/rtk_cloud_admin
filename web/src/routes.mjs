export const customerNavGroups = [
  {
    id: 'brand-cloud',
    label: '品牌雲',
    items: [
      { id: 'overview', label: '品牌雲首頁', path: '/console/overview', icon: 'gauge-high', capabilities: ['fleet.read', 'customer.devices.read'], activeRoutes: ['overview', 'access', 'settings'], alwaysVisible: true },
    ],
  },
  {
    id: 'device-operations',
    label: '設備營運',
    items: [
      { id: 'devices', label: '設備', path: '/console/devices', icon: 'video', capabilities: ['fleet.read', 'customer.devices.read'] },
      { id: 'provisioning', label: '設備註冊', path: '/console/provisioning', icon: 'plug-circle-bolt', capabilities: ['provisioning.read', 'provisioning.create'] },
    ],
  },
  {
    id: 'product-updates',
    label: '產品與更新',
    items: [
      { id: 'sku-services', label: 'SKU 與服務', path: '/console/sku-services', icon: 'boxes-stacked', capabilities: ['sku.read', 'registry_device.read'] },
      { id: 'chipset-sdk', label: 'ChipSet & SDK', path: '/console/chipset-sdk', icon: 'code-branch' },
      { id: 'firmware-ota', label: '韌體更新', path: '/console/firmware-ota', icon: 'microchip', capabilities: ['firmware.release.read', 'ota.plan.read', 'customer.firmware.read'] },
    ],
  },
  {
    id: 'monitoring-analytics',
    label: '監控與分析',
    items: [
      { id: 'stream-health', label: '影像播放狀況', path: '/console/stream-health', icon: 'tower-broadcast', capabilities: ['customer.stream.read'] },
      { id: 'reports', label: '報表', path: '/console/reports', icon: 'chart-column', capabilities: ['reports.read', 'report.read', 'customer.reports.read'] },
    ],
  },
  {
    id: 'account-management',
    label: '帳號管理',
    items: [
      { id: 'billing', label: '帳務與自動加值', path: '/console/billing', icon: 'credit-card', capabilities: ['billing_account.read'] },
    ],
  },
];

export const customerNavItems = customerNavGroups.flatMap((group) => group.items);

export const billingSubpaths = Object.freeze({
  overview: '/console/billing',
  invoices: '/console/billing/invoices',
  activity: '/console/billing/activity',
  settings: '/console/billing/settings',
  profile: '/console/billing/profile',
});

export const platformNavGroups = [
  {
    id: 'platform-overview',
    label: '平台總覽',
    items: [
      { id: 'platform-dashboard', label: '平台首頁', path: '/admin', icon: 'gauge-high' },
    ],
  },
  {
    id: 'platform-observability',
    label: '監控與診斷',
    items: [
      { id: 'platform-grafana', label: 'Grafana', path: '/admin/grafana', icon: 'chart-simple' },
      { id: 'platform-health', label: '服務健康', path: '/admin/health', icon: 'heart-pulse' },
      { id: 'platform-logs', label: '服務日誌', path: '/admin/logs', icon: 'file-lines' },
    ],
  },
  {
    id: 'platform-organizations-products',
    label: '組織與產品',
    items: [
      { id: 'platform-brand-clouds', label: '品牌雲管理', path: '/admin/brand-clouds', icon: 'cloud' },
      { id: 'platform-chipset-providers', label: 'ChipSet & SDK 供應商', path: '/admin/chipset-providers', icon: 'code-branch', capabilities: ['platform.chipset_sdk.read', 'platform.chipset_sdk.edit', 'platform.chipset_sdk.publish'] },
      { id: 'platform-sso', label: 'SSO 供應商', path: '/admin/sso', icon: 'key' },
    ],
  },
  {
    id: 'platform-operations-audit',
    label: '營運與稽核',
    items: [
      { id: 'platform-operations', label: '營運紀錄', path: '/admin/ops', icon: 'list-check' },
      { id: 'platform-audit', label: '稽核紀錄', path: '/admin/audit', icon: 'shield-halved' },
    ],
  },
];

export const platformNavItems = platformNavGroups.flatMap((group) => group.items);

const publicRouteIds = new Set(['login', 'login-check-email', 'login-activate', 'brand-cloud-activate', 'forgot-password', 'reset-password', 'signup', 'signup-check-email', 'signup-verification-expired', 'verify']);

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
    'brand-cloud-activate': 'Activate brand account',
    'forgot-password': 'Forgot password',
    'reset-password': 'Reset password',
    signup: 'Sign up',
    'signup-check-email': 'Check your email',
    'signup-verification-expired': 'Verification link expired',
    verify: 'Verify email',
    'brand-cloud-member-invitation-accept': 'Accept Brand Cloud invitation',
    'sku-collaborator-invitation-accept': 'Accept SKU collaboration invitation',
    overview: '品牌雲',
    devices: '設備',
    'sku-services': 'SKU 與服務',
    'chipset-sdk': 'ChipSet & SDK',
    groups: '群組與標籤',
    access: '品牌雲',
    settings: '品牌雲',
    'firmware-ota': '韌體更新',
    'stream-health': '影像播放狀況',
    reports: '報表',
    provisioning: '設備註冊',
    billing: '帳務與自動加值',
    'platform-dashboard': '平台首頁',
    'platform-grafana': 'Grafana',
    'platform-health': '服務健康',
    'platform-brand-clouds': '品牌雲管理',
    'platform-chipset-providers': 'ChipSet & SDK 供應商',
    'platform-sso': 'SSO 供應商',
    'platform-logs': '服務日誌',
    'platform-operations': '營運紀錄',
    'platform-audit': '稽核紀錄',
  }[active];
}

export function routeFromPath(path) {
  if (path === '/login' || path === '/login/') return 'login';
  if (path === '/login/check-email' || path.startsWith('/login/check-email/')) return 'login-check-email';
  if (path === '/login/activate' || path.startsWith('/login/activate/')) return 'login-activate';
  if (path === '/brand-cloud/activate' || path.startsWith('/brand-cloud/activate/')) return 'brand-cloud-activate';
  if (path === '/forgot-password' || path.startsWith('/forgot-password/')) return 'forgot-password';
  if (path === '/reset-password' || path.startsWith('/reset-password/')) return 'reset-password';
  if (path === '/signup' || path === '/signup/') return 'signup';
  if (path === '/signup/check-email' || path.startsWith('/signup/check-email/')) return 'signup-check-email';
  if (path === '/signup/verification-expired' || path.startsWith('/signup/verification-expired/')) return 'signup-verification-expired';
  if (path === '/signup/verify' || path.startsWith('/signup/verify/')) return 'verify';
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify';
  if (path === '/brand-cloud-member-invitation/accept') return 'brand-cloud-member-invitation-accept';
  if (path === '/sku-collaborator-invitation/accept') return 'sku-collaborator-invitation-accept';
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
  const scoped = path.match(/^\/console\/([^/]+)\/(overview|devices|sku-services|chipset-sdk|groups|access|settings|firmware-ota|stream-health|jobs|reports|provisioning|billing)(?:\/|$)/);
  if (scoped) return scoped[2] === 'jobs' ? 'firmware-ota' : scoped[2];
  if (path === '/console/devices' || path.startsWith('/console/devices/')) return 'devices';
  if (path === '/console/sku-services' || path.startsWith('/console/sku-services/')) return 'sku-services';
  if (path === '/console/chipset-sdk' || path.startsWith('/console/chipset-sdk/')) return 'chipset-sdk';
  if (path === '/console/groups' || path.startsWith('/console/groups/')) return 'groups';
  if (path === '/console/access' || path.startsWith('/console/access/')) return 'access';
  if (path === '/console/settings' || path.startsWith('/console/settings/')) return 'settings';
  if (path === '/console/firmware-ota' || path.startsWith('/console/firmware-ota/')) return 'firmware-ota';
  if (path === '/console/stream-health' || path.startsWith('/console/stream-health/')) return 'stream-health';
  if (path === '/console/jobs' || path.startsWith('/console/jobs/')) return 'firmware-ota';
  if (path === '/console/reports' || path.startsWith('/console/reports/')) return 'reports';
  if (path === '/console/provisioning' || path.startsWith('/console/provisioning/')) return 'provisioning';
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
  if (/^\/console\/(?:overview|devices|sku-services|chipset-sdk|groups|access|settings|firmware-ota|stream-health|jobs|reports|provisioning|billing)(?:\/|$)/.test(String(path || ''))) return '';
  const match = String(path || '').match(/^\/console\/([^/]+)\/(?:overview|devices|sku-services|chipset-sdk|groups|access|settings|firmware-ota|stream-health|jobs|reports|provisioning|billing)(?:\/|$)/);
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

export function devicesPathWithFilters({ deviceId = '', health = '', status = '', signal = '', firmware = '', skuID = '', q = '', sort = '', direction = '', offset = '' } = {}) {
  const params = new URLSearchParams();
  if (deviceId) params.set('device', deviceId);
  if (health) params.set('health', health);
  if (status) params.set('status', status);
  if (signal) params.set('signal', signal);
  if (firmware) params.set('firmware', firmware);
  if (skuID) params.set('sku_id', skuID);
  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  if (direction) params.set('direction', direction);
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return query ? `/console/devices?${query}` : '/console/devices';
}
