export const customerNavGroups = [
  {
    id: 'global',
    labelKey: 'Clouds',
    items: [
      { id: 'my-clouds', labelKey: 'My Clouds', path: '/console/clouds', icon: 'cloud', global: true, alwaysVisible: true },
    ],
  },
  {
    id: 'brand-cloud',
    labelKey: 'Brand Cloud',
    items: [
      { id: 'overview', labelKey: 'Overview', segment: '', icon: 'gauge-high', capabilities: ['fleet.read', 'customer.devices.read'], alwaysVisible: true },
    ],
  },
  {
    id: 'features',
    labelKey: 'Features',
    items: [
      { id: 'product-services', labelKey: 'Products', segment: 'products', icon: 'boxes-stacked', capabilities: ['product.read', 'registry_device.read'] },
      { id: 'test-lab', labelKey: 'Cloud Test Lab', segment: 'test-lab', icon: 'flask', capabilities: ['product.read'] },
      { id: 'chipset-sdk', labelKey: 'ChipSet & SDK', path: '/console/chipset-sdk', icon: 'code-branch', global: true, alwaysVisible: true },
      { id: 'developer-docs', labelKey: 'Developer Docs', path: '/console/developer-docs', icon: 'book-open', global: true, alwaysVisible: true },
      { id: 'devices', labelKey: 'Fleet Management', segment: 'fleet', icon: 'video', capabilities: ['fleet.read', 'customer.devices.read'] },
      { id: 'provisioning', labelKey: 'CSV Provisioning', segment: 'fleet/provisioning', icon: 'file-csv', capabilities: ['provisioning.read', 'provisioning.create'] },
      { id: 'firmware-ota', labelKey: 'Firmware & OTA', segment: 'firmware-ota', icon: 'microchip', capabilities: ['firmware.release.read', 'ota.plan.read', 'customer.firmware.read'] },
      { id: 'analytics', labelKey: 'Analytics', segment: 'analytics', icon: 'chart-column', capabilities: ['reports.read', 'report.read', 'customer.reports.read', 'customer.stream.read', 'fleet.read'] },
    ],
  },
  {
    id: 'management',
    labelKey: 'Management',
    items: [
      { id: 'access', labelKey: 'Members & Access', segment: 'members', icon: 'users', capabilities: ['team.read', 'role_assignment.read'] },
      { id: 'billing', labelKey: 'Billing', segment: 'billing', icon: 'credit-card', capabilities: ['billing_account.read'], ownerOnly: true },
      { id: 'settings', labelKey: 'Settings', segment: 'settings', icon: 'gear', alwaysVisible: true },
      { id: 'audit', labelKey: 'Audit', segment: 'audit', icon: 'shield-halved', capabilities: ['audit.read', 'customer.audit.read', 'fleet.read'] },
    ],
  },
];

export const customerNavItems = customerNavGroups.flatMap((group) => group.items);

const cloudRouteSegments = Object.freeze({
  overview: '',
  'test-lab': 'test-lab',
  'product-services': 'products',
  devices: 'fleet',
  groups: 'fleet/groups',
  provisioning: 'fleet/provisioning',
  jobs: 'fleet/jobs',
  'firmware-ota': 'firmware-ota',
  analytics: 'analytics',
  'stream-health': 'analytics',
  reports: 'analytics/reports',
  access: 'members',
  billing: 'billing',
  settings: 'settings',
  audit: 'audit',
});

// Page-level meaning is separate from sidebar navigation so headings can stay
// semantic without changing the existing navigation structure.
export const pageIcons = Object.freeze({
  'test-lab': 'flask',
  'my-clouds': 'cloud', overview: 'gauge-high', devices: 'video',
  'product-services': 'boxes-stacked', 'chipset-sdk': 'code-branch', 'developer-docs': 'book-open',
  groups: 'tags', provisioning: 'file-csv', access: 'user-shield', settings: 'gear', billing: 'credit-card',
  'firmware-ota': 'microchip', 'stream-health': 'tower-broadcast', reports: 'chart-column', analytics: 'chart-column', audit: 'shield-halved',
  'platform-dashboard': 'gauge-high', 'platform-grafana': 'chart-simple', 'platform-health': 'heart-pulse',
  'platform-logs': 'file-lines', 'platform-brand-clouds': 'cloud',
  'platform-sso': 'key', 'platform-operations': 'list-check', 'platform-audit': 'shield-halved',
  login: 'right-to-bracket', 'login-check-email': 'envelope', 'login-activate': 'right-to-bracket',
  signup: 'user-plus', 'signup-check-email': 'envelope', 'signup-verification-expired': 'clock-rotate-left', verify: 'envelope-circle-check',
  'forgot-password': 'key', 'reset-password': 'lock', 'brand-cloud-member-invitation-accept': 'user-plus', 'product-collaborator-invitation-accept': 'handshake',
});

export function pageIconFor(route) {
  return pageIcons[route] || 'circle-info';
}
const cloudUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodedCloudID(value) {
  try {
    const decoded = decodeURIComponent(String(value || ''));
    return cloudUUID.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

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
  return items.filter((item) => {
    return item.alwaysVisible || !item.capabilities?.length || item.capabilities.some((capability) => values.has(capability));
  });
}

export function navGroupsForCapabilities(route, capabilities) {
  if (isPublicRouteId(route)) return [];
  const groups = isPlatformRouteId(route) ? platformNavGroups : customerNavGroups;
  const values = new Set(Array.isArray(capabilities) ? capabilities : []);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        return item.alwaysVisible || !item.capabilities?.length || item.capabilities.some((capability) => values.has(capability));
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function cloudConsolePath(cloudId, route = 'overview') {
  if (route === 'my-clouds') return myCloudsPath(cloudId);
  const item = customerNavItems.find((candidate) => candidate.id === route);
  if (item?.global) {
    const context = decodedCloudID(cloudId);
    return context ? `${item.path}?cloudId=${encodeURIComponent(context)}` : item.path;
  }
  const segment = cloudRouteSegments[route];
  if (!cloudId || segment === undefined) return '/console/clouds';
  const root = `/console/clouds/${encodeURIComponent(cloudId)}`;
  return segment ? `${root}/${segment}` : root;
}

export function myCloudsPath(cloudId = '') {
  const context = decodedCloudID(cloudId);
  return context ? `/console/clouds?cloudId=${encodeURIComponent(context)}` : '/console/clouds';
}

export function cloudNavGroupsForCapabilities(cloudId, capabilities, { isOwner = false } = {}) {
  const values = new Set(Array.isArray(capabilities) ? capabilities : []);
  return customerNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!cloudId && !item.global) return false;
        if (item.ownerOnly && !isOwner) return false;
        return item.alwaysVisible || !item.capabilities?.length || item.capabilities.some((capability) => values.has(capability));
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function cloudShellNavGroups(cloudId, capabilities, options = {}) {
  if (cloudId) return cloudNavGroupsForCapabilities(cloudId, capabilities, options);
  return customerNavGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => !item.ownerOnly || options.showOwnerOnly)
        .map((item) => ({ ...item, disabled: !item.global })),
    }))
    .filter((group) => group.items.length > 0);
}

export function cloudRouteForSwitch(cloud, route, userId = '') {
  const cloudId = cloud?.id || cloud?.organization_id || '';
  const role = cloud?.my_role || cloud?.role || '';
  const isOwner = role === 'owner' && (!userId || !cloud?.owner_user_id || cloud.owner_user_id === userId);
  const targetRoute = route === 'my-clouds' ? 'overview' : route;
  const available = cloudNavGroupsForCapabilities(cloudId, cloud?.capabilities || [], { isOwner })
    .some((group) => group.items.some((item) => item.id === targetRoute));
  return cloudConsolePath(cloudId, available ? targetRoute : 'overview');
}

export function isCustomerNavItemActive(item, route) {
  return (item.activeRoutes || [item.id]).includes(route);
}

export function canAccessCustomerRoute(route, capabilities) {
  const values = new Set(Array.isArray(capabilities) ? capabilities : []);
  if (route === 'my-clouds') return true;
  // ChipSet & SDK is a global developer resource rather than a Brand Cloud
  // feature. Keep its established URL available without deriving a cloud from
  // the active-org compatibility session.
  if (['chipset-sdk', 'developer-docs'].includes(route)) return true;
  const item = customerNavItems.find((candidate) => candidate.id === route);
  return Boolean(item && (item.alwaysVisible || !item.capabilities?.length || item.capabilities.some((capability) => values.has(capability))));
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
    'my-clouds': 'My Clouds',
    overview: 'Brand Cloud',
    devices: 'Fleet Management',
    'product-services': 'Products',
    'test-lab': 'Cloud Test Lab',
    'chipset-sdk': 'ChipSet & SDK',
    'developer-docs': 'Developer Docs',
    groups: 'Groups and Tags',
    access: 'Brand Cloud',
    settings: 'Brand Cloud',
    'firmware-ota': 'Firmware OTA',
    'stream-health': 'Video Streaming Health',
    reports: 'Reports',
    provisioning: 'CSV Provisioning',
    analytics: 'Analytics',
    audit: 'Audit',
    billing: 'Billing',
    'platform-dashboard': 'Platform Home',
    'platform-grafana': 'Grafana',
    'platform-health': 'Service Health',
    'platform-brand-clouds': 'Brand Cloud Management',
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
  if (path === '/admin/chipset-providers' || path.startsWith('/admin/chipset-providers/')) return 'platform-dashboard';
  if (path === '/admin/sso' || path.startsWith('/admin/sso/')) return 'platform-sso';
  if (path === '/admin/logs' || path.startsWith('/admin/logs/')) return 'platform-logs';
  if (path === '/admin/ops' || path.startsWith('/admin/ops/')) return 'platform-operations';
  if (path === '/admin/operations' || path.startsWith('/admin/operations/')) return 'platform-operations';
  if (path === '/admin/audit' || path.startsWith('/admin/audit/')) return 'platform-audit';
  if (path.startsWith('/admin/')) return 'platform-dashboard';
  if (path === '/console/clouds' || path === '/console/clouds/') return 'my-clouds';
  const canonicalCloud = String(path || '').match(/^\/console\/clouds\/([^/]+)(?:\/(.*))?\/?$/);
  if (canonicalCloud) {
    const suffix = String(canonicalCloud[2] || '').replace(/\/$/, '');
    if (!suffix) return 'overview';
    if (suffix === 'test-lab') return 'test-lab';
    if (suffix === 'fleet/groups') return 'groups';
    if (suffix === 'fleet/provisioning') return 'provisioning';
    if (suffix === 'fleet/jobs') return 'firmware-ota';
    if (suffix === 'analytics/reports') return 'reports';
    if (suffix === 'products' || suffix.startsWith('products/')) return 'product-services';
    if (suffix === 'fleet' || suffix.startsWith('fleet/')) return 'devices';
    if (suffix === 'firmware-ota' || suffix.startsWith('firmware-ota/')) return 'firmware-ota';
    if (suffix === 'analytics' || suffix.startsWith('analytics/')) return 'analytics';
    if (suffix === 'members' || suffix.startsWith('members/')) return 'access';
    if (suffix === 'billing' || suffix.startsWith('billing/')) return 'billing';
    if (suffix === 'settings' || suffix.startsWith('settings/')) return 'settings';
    if (suffix === 'audit' || suffix.startsWith('audit/')) return 'audit';
    return 'overview';
  }
  if (path === '/console' || path === '/console/' || path === '/console/overview' || path.startsWith('/console/overview/')) return 'overview';
  if (path === '/console/billing' || path.startsWith('/console/billing/')) return 'billing';
  // Global documentation slugs (including overview) are not tenant routes.
  if (path === '/console/developer-docs' || path.startsWith('/console/developer-docs/')) return 'developer-docs';
  const scoped = path.match(/^\/console\/([^/]+)\/(overview|devices|product-services|chipset-sdk|developer-docs|groups|access|settings|firmware-ota|stream-health|jobs|reports|billing)(?:\/|$)/);
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
  const canonical = String(path || '').match(/^\/console\/clouds\/([^/]+)(?:\/|$)/);
  if (canonical) return decodedCloudID(canonical[1]);
  if (/^\/console\/(?:overview|devices|product-services|chipset-sdk|developer-docs|groups|access|settings|firmware-ota|stream-health|jobs|reports|provisioning|billing)(?:\/|$)/.test(String(path || ''))) return '';
  const match = String(path || '').match(/^\/console\/([^/]+)\/(?:overview|devices|product-services|chipset-sdk|developer-docs|groups|access|settings|firmware-ota|stream-health|jobs|reports|provisioning|billing)(?:\/|$)/);
  return match ? decodedCloudID(match[1]) : '';
}

export function cloudContextId(path, search = '') {
  const pathID = cloudIdFromPath(path);
  if (pathID) return pathID;
  try {
    return decodedCloudID(new URLSearchParams(search).get('cloudId'));
  } catch {
    return '';
  }
}

export function routeFromLocation() {
  return routeFromPath(window.location.pathname);
}

export function canonicalCustomerPath(path) {
  if (path === '/console' || path === '/console/') return '/console/clouds';
  if (path === '/console/clouds' || String(path || '').startsWith('/console/clouds/')) return path;
  if (path === '/console/chipset-sdk' || String(path || '').startsWith('/console/chipset-sdk/')) return path;
  if (path === '/console/developer-docs' || String(path || '').startsWith('/console/developer-docs/')) return path;
  const explicit = String(path || '').match(/^\/console\/([^/]+)\/(overview|devices|product-services|chipset-sdk|developer-docs|groups|provisioning|access|settings|firmware-ota|stream-health|jobs|reports|billing|audit)(?:\/.*)?$/);
  if (explicit) {
    const cloudId = decodedCloudID(explicit[1]);
    if (!cloudId) return '/console/clouds';
    if (['chipset-sdk', 'developer-docs'].includes(explicit[2])) return `/console/${explicit[2]}`;
    const mapped = {
      overview: '',
      devices: 'fleet',
      'product-services': 'products',
      groups: 'fleet',
      provisioning: 'fleet/provisioning',
      access: 'members',
      settings: 'settings',
      'firmware-ota': 'firmware-ota',
      'stream-health': 'analytics',
      jobs: 'firmware-ota',
      reports: 'analytics',
      billing: 'billing',
      audit: 'audit',
    }[explicit[2]];
    const root = `/console/clouds/${encodeURIComponent(cloudId)}`;
    return mapped ? `${root}/${mapped}` : root;
  }
  if (/^\/console\/(?:overview|devices|product-services|groups|provisioning|access|settings|firmware-ota|stream-health|jobs|reports|billing|audit)(?:\/|$)/.test(String(path || ''))) return '/console/clouds';
  const scoped = String(path || '').match(/^\/console\/([^/]+)\/jobs(?:\/.*)?$/);
  if (scoped) return `/console/${scoped[1]}/firmware-ota`;
  if (path === '/console/jobs' || String(path || '').startsWith('/console/jobs/')) return '/console/firmware-ota';
  return path;
}

export function devicesPathWithFilters({ cloudId = '', deviceId = '', health = '', status = '', signal = '', firmware = '', productID = '', q = '', sort = '', direction = '', offset = '' } = {}) {
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
  const root = cloudId ? cloudConsolePath(cloudId, 'devices') : '/console/clouds';
  return query ? `${root}?${query}` : root;
}
