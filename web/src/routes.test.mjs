import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billingSubpaths,
  canAccessCustomerRoute,
  canonicalCustomerPath,
  customerNavGroups,
  customerNavItems,
  defaultBrandCloudRoute,
  devicesPathWithFilters,
  isCustomerNavItemActive,
  isPlatformRouteId,
  isPublicRouteId,
  navGroupsForCapabilities,
  navItemsForCapabilities,
  navItemsForRoute,
  platformNavGroups,
  platformNavItems,
  routeFromPath,
  cloudIdFromPath,
  titleFor,
} from './routes.mjs';

test('maps platform shell paths to platform routes', () => {
  assert.equal(routeFromPath('/admin'), 'platform-dashboard');
  assert.equal(routeFromPath('/admin/grafana'), 'platform-grafana');
  assert.equal(routeFromPath('/admin/resources'), 'platform-dashboard');
  assert.equal(routeFromPath('/admin/health'), 'platform-health');
  assert.equal(routeFromPath('/admin/brand-clouds'), 'platform-brand-clouds');
  assert.equal(routeFromPath('/admin/brand-clouds/brand-001'), 'platform-brand-clouds');
  assert.equal(routeFromPath('/admin/chipset-providers'), 'platform-chipset-providers');
  assert.equal(routeFromPath('/admin/sso'), 'platform-sso');
  assert.equal(routeFromPath('/admin/logs'), 'platform-logs');
  assert.equal(routeFromPath('/admin/ops'), 'platform-operations');
  assert.equal(routeFromPath('/admin/operations'), 'platform-operations');
  assert.equal(routeFromPath('/admin/audit'), 'platform-audit');
});

test('maps public signup paths to auth routes', () => {
  assert.equal(routeFromPath('/login'), 'login');
  assert.equal(routeFromPath('/login/'), 'login');
  assert.equal(routeFromPath('/login/check-email'), 'login-check-email');
  assert.equal(routeFromPath('/login/activate'), 'login-activate');
  assert.equal(routeFromPath('/brand-cloud/activate'), 'brand-cloud-activate');
  assert.equal(routeFromPath('/forgot-password'), 'forgot-password');
  assert.equal(routeFromPath('/reset-password'), 'reset-password');
  assert.equal(routeFromPath('/signup'), 'signup');
  assert.equal(routeFromPath('/signup/check-email'), 'signup-check-email');
  assert.equal(routeFromPath('/signup/check-email/inbox'), 'signup-check-email');
  assert.equal(routeFromPath('/signup/verification-expired'), 'signup-verification-expired');
  assert.equal(routeFromPath('/signup/verify'), 'verify');
  assert.equal(routeFromPath('/signup/verify/'), 'verify');
  assert.equal(routeFromPath('/verify'), 'verify');
  assert.equal(routeFromPath('/verify/token-1'), 'verify');
});

test('maps Brand Cloud membership invitation acceptance outside regular console navigation', () => {
  assert.equal(routeFromPath('/brand-cloud-member-invitation/accept'), 'brand-cloud-member-invitation-accept');
  assert.equal(titleFor('brand-cloud-member-invitation-accept'), 'Accept Brand Cloud invitation');
});

test('maps Product collaborator invitation acceptance outside regular console navigation', () => {
  assert.equal(routeFromPath('/product-collaborator-invitation/accept'), 'product-collaborator-invitation-accept');
  assert.equal(titleFor('product-collaborator-invitation-accept'), 'Accept Product collaboration invitation');
});

test('maps customer shell paths to customer routes', () => {
  assert.equal(routeFromPath('/console'), 'overview');
  assert.equal(routeFromPath('/console/overview'), 'overview');
  assert.equal(routeFromPath('/console/devices'), 'devices');
  assert.equal(routeFromPath('/console/cloud-123/devices'), 'devices');
  assert.equal(cloudIdFromPath('/console/cloud-123/devices'), 'cloud-123');
  assert.equal(routeFromPath('/console/product-services'), 'product-services');
  assert.equal(routeFromPath('/console/chipset-sdk'), 'chipset-sdk');
  assert.equal(routeFromPath('/console/customers'), 'overview');
  assert.equal(routeFromPath('/console/operations'), 'overview');
  assert.equal(routeFromPath('/console/operations/history'), 'overview');
  assert.equal(routeFromPath('/console/firmware-ota'), 'firmware-ota');
  assert.equal(routeFromPath('/console/stream-health'), 'stream-health');
  assert.equal(routeFromPath('/console/jobs'), 'firmware-ota');
  assert.equal(routeFromPath('/console/cloud-123/jobs'), 'firmware-ota');
  assert.equal(cloudIdFromPath('/console/cloud-123/jobs'), 'cloud-123');
  assert.equal(canonicalCustomerPath('/console/jobs'), '/console/firmware-ota');
  assert.equal(canonicalCustomerPath('/console/cloud-123/jobs'), '/console/cloud-123/firmware-ota');
  assert.equal(routeFromPath('/console/reports'), 'reports');
  assert.equal(routeFromPath('/console/groups'), 'groups');
  assert.equal(routeFromPath('/console/groups/legacy'), 'groups');
  assert.equal(routeFromPath('/console/access'), 'access');
  assert.equal(routeFromPath('/console/settings'), 'settings');
  assert.equal(routeFromPath('/console/cloud-123/settings'), 'settings');
  assert.equal(cloudIdFromPath('/console/cloud-123/settings'), 'cloud-123');
  assert.equal(routeFromPath('/console/billing'), 'billing');
  assert.equal(routeFromPath('/console/cloud-123/billing'), 'billing');
  assert.equal(cloudIdFromPath('/console/cloud-123/billing'), 'cloud-123');
});

test('billing subpaths remain addressable inside the tenant billing section', () => {
  assert.deepEqual(Object.values(billingSubpaths), [
    '/console/billing',
    '/console/billing/usage',
    '/console/billing/invoices',
    '/console/billing/activity',
    '/console/billing/settings',
    '/console/billing/profile',
  ]);
  for (const path of Object.values(billingSubpaths)) assert.equal(routeFromPath(path), 'billing');
  assert.equal(cloudIdFromPath('/console/billing/settings'), '');
});

test('customer nav follows the approved Customer View design order', () => {
  assert.deepEqual(
    customerNavItems.map((item) => item.labelKey),
    ['Brand Cloud Home', 'Devices', 'Products and Services', 'ChipSet & SDK', 'Firmware Updates', 'Video Streaming Health', 'Reports', 'Billing and Automatic Top-Up'],
  );
  assert.deepEqual(customerNavGroups.map((group) => group.labelKey), ['Brand Cloud', 'Device Operations', 'Products and Updates', 'Monitoring and Analytics', 'Account Management']);
});

test('customer nav is derived from active membership capabilities', () => {
  const labels = navItemsForCapabilities('overview', [
    'fleet.read',
    'customer.devices.read',
    'customer.stream.read',
  ]).map((item) => item.labelKey);
  assert.deepEqual(labels, ['Brand Cloud Home', 'Devices', 'ChipSet & SDK', 'Video Streaming Health']);
  assert.equal(navItemsForCapabilities('overview', ['team.read']).some((item) => item.id === 'overview'), true);
  assert.equal(navItemsForCapabilities('overview', ['team.read']).some((item) => item.id === 'access'), false);
  assert.equal(navItemsForCapabilities('overview', ['team.read']).some((item) => item.id === 'product-services'), false);
  assert.equal(navItemsForCapabilities('overview', ['billing_account.read']).some((item) => item.id === 'billing'), true);
});

test('Brand Cloud navigation and route access are evaluated independently', () => {
  const brandCloudItem = customerNavItems[0];
  assert.equal(isCustomerNavItemActive(brandCloudItem, 'overview'), true);
  assert.equal(isCustomerNavItemActive(brandCloudItem, 'access'), true);
  assert.equal(isCustomerNavItemActive(brandCloudItem, 'settings'), true);
  assert.equal(canAccessCustomerRoute('overview', ['team.read']), false);
  assert.equal(canAccessCustomerRoute('access', ['team.read']), true);
  assert.equal(canAccessCustomerRoute('settings', []), true);
  assert.equal(defaultBrandCloudRoute(['fleet.read']), 'overview');
  assert.equal(defaultBrandCloudRoute(['team.read']), 'access');
  assert.equal(defaultBrandCloudRoute([]), 'settings');
  assert.deepEqual(navGroupsForCapabilities('overview', ['team.read']).map((group) => group.labelKey), ['Brand Cloud', 'Products and Updates']);
});

test('retired customer pages are not exposed in section navigation', () => {
  const customerLabels = customerNavItems.map((item) => item.labelKey);
  const platformLabels = platformNavItems.map((item) => item.labelKey);

  assert.equal(customerLabels.includes('Groups'), false);
  assert.equal(customerLabels.includes('Customers'), false);
  assert.equal(customerLabels.includes('Operations'), false);
  assert.equal(platformLabels.includes('Groups'), false);
  assert.equal(platformLabels.includes('Customers'), false);
});

test('platform nav follows the unified shell group order', () => {
  assert.deepEqual(platformNavGroups.map((group) => group.labelKey), ['Platform Overview', 'Monitoring and Diagnostics', 'Organizations and Products', 'Operations and Audit']);
  assert.deepEqual(
    platformNavItems.map((item) => item.labelKey),
    ['Platform Home', 'Grafana', 'Service Health', 'Service Logs', 'Brand Cloud Management', 'ChipSet & SDK Providers', 'SSO Providers', 'Operations Log', 'Audit Log'],
  );
  assert.deepEqual(
    platformNavItems.map((item) => item.path),
    ['/admin', '/admin/grafana', '/admin/health', '/admin/logs', '/admin/brand-clouds', '/admin/chipset-providers', '/admin/sso', '/admin/ops', '/admin/audit'],
  );
});

test('route kind selects one capability-filtered navigation hierarchy', () => {
  assert.deepEqual(navGroupsForCapabilities('overview', []).map((group) => group.labelKey), ['Brand Cloud', 'Products and Updates']);
  assert.deepEqual(navGroupsForCapabilities('platform-dashboard', []).map((group) => group.labelKey), ['Platform Overview', 'Monitoring and Diagnostics', 'Organizations and Products', 'Operations and Audit']);
  assert.equal(navGroupsForCapabilities('platform-dashboard', [])[2].items.some((item) => item.id === 'platform-chipset-providers'), false);
  assert.equal(navGroupsForCapabilities('platform-dashboard', ['platform.chipset_sdk.read'])[2].items.some((item) => item.id === 'platform-chipset-providers'), true);
  assert.deepEqual(navGroupsForCapabilities('login', []), []);
});

test('public auth routes stay outside Customer and Platform section navigation', () => {
  for (const route of ['login', 'login-check-email', 'login-activate', 'forgot-password', 'reset-password', 'signup', 'signup-check-email', 'signup-verification-expired', 'verify']) {
    assert.equal(isPublicRouteId(route), true, route);
    assert.equal(isPlatformRouteId(route), false, route);
    assert.deepEqual(navItemsForRoute(route), []);
  }
});

test('route classification selects the separated view navigation', () => {
  assert.equal(isPublicRouteId('overview'), false);
  assert.equal(isPlatformRouteId('overview'), false);
  assert.deepEqual(navItemsForRoute('overview'), customerNavItems);

  assert.equal(isPublicRouteId('platform-sso'), false);
  assert.equal(isPlatformRouteId('platform-sso'), true);
  assert.deepEqual(navItemsForRoute('platform-sso'), platformNavItems);
});

test('builds devices URLs with supported filters only', () => {
  assert.equal(devicesPathWithFilters(), '/console/devices');
  assert.equal(devicesPathWithFilters({ deviceId: 'dev-001' }), '/console/devices?device=dev-001');
  assert.equal(
    devicesPathWithFilters({ health: 'warning', status: 'online', signal: 'poor', firmware: 'v1.2.4', productID: 'product-alpha', ignored: 'x' }),
    '/console/devices?health=warning&status=online&signal=poor&firmware=v1.2.4&product_id=product-alpha',
  );
});

test('uses the shared Brand Cloud title for integrated routes', () => {
  assert.equal(titleFor('overview'), 'Brand Cloud');
  assert.equal(titleFor('access'), 'Brand Cloud');
  assert.equal(titleFor('settings'), 'Brand Cloud');
});

test('uses English platform route titles in the unified shell', () => {
  assert.equal(titleFor('platform-dashboard'), 'Platform Home');
  assert.equal(titleFor('platform-health'), 'Service Health');
  assert.equal(titleFor('platform-brand-clouds'), 'Brand Cloud Management');
  assert.equal(titleFor('platform-operations'), 'Operations Log');
  assert.equal(titleFor('platform-audit'), 'Audit Log');
});

test('falls back unknown paths to the customer overview route', () => {
  assert.equal(routeFromPath('/'), 'overview');
  assert.equal(routeFromPath('/console/unknown'), 'overview');
  assert.equal(routeFromPath('/console/provisioning'), 'overview');
  assert.equal(routeFromPath('/console/cloud-123/provisioning'), 'overview');
});

test('falls back unknown platform paths inside Platform View', () => {
  assert.equal(routeFromPath('/admin/unknown'), 'platform-dashboard');
  assert.equal(routeFromPath('/admin/unknown/deep'), 'platform-dashboard');
});

test('provides titles for all public shell routes', () => {
  for (const route of [
    'signup',
    'signup-check-email',
    'verify',
    'login',
    'login-check-email',
    'login-activate',
    'forgot-password',
    'reset-password',
    'overview',
    'access',
    'settings',
    'devices',
    'billing',
    'product-services',
    'firmware-ota',
    'stream-health',
    'reports',
    'platform-dashboard',
    'platform-grafana',
    'platform-health',
    'platform-sso',
    'platform-logs',
    'platform-operations',
    'platform-audit',
  ]) {
    assert.equal(typeof titleFor(route), 'string', route);
    assert.notEqual(titleFor(route), '');
  }
});
