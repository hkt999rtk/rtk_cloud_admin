import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billingSubpaths,
  canAccessCustomerRoute,
  canonicalCustomerPath,
  cloudContextId,
  cloudConsolePath,
  cloudNavGroupsForCapabilities,
  cloudRouteForSwitch,
  cloudShellNavGroups,
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
  myCloudsPath,
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
  assert.equal(routeFromPath('/admin/chipset-providers'), 'platform-dashboard');
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
	assert.equal(routeFromPath('/brand-cloud/activate'), 'overview');
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
  const cloud = '11111111-1111-4111-8111-111111111111';
  assert.equal(routeFromPath('/console/clouds'), 'my-clouds');
  assert.equal(routeFromPath(`/console/clouds/${cloud}`), 'overview');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/products`), 'product-services');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/fleet`), 'devices');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/fleet/provisioning`), 'provisioning');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/analytics/reports`), 'reports');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/firmware-ota`), 'firmware-ota');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/analytics`), 'analytics');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/members`), 'access');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/billing/invoices`), 'billing');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/settings`), 'settings');
  assert.equal(routeFromPath(`/console/clouds/${cloud}/audit`), 'audit');
  assert.equal(cloudIdFromPath(`/console/clouds/${cloud}/fleet`), cloud);
  assert.equal(cloudIdFromPath('/console/clouds/not-a-uuid/fleet'), '');
  assert.equal(cloudIdFromPath('/console/clouds/%/fleet'), '');
  assert.equal(cloudIdFromPath(`/console/${cloud}/devices`), cloud);
  assert.equal(cloudIdFromPath('/unrelated'), '');
  assert.equal(cloudContextId('/console/chipset-sdk', `?cloudId=${cloud}`), cloud);
  assert.equal(cloudContextId('/console/chipset-sdk', '?cloudId=not-a-uuid'), '');
  assert.equal(canonicalCustomerPath('/console'), '/console/clouds');
  assert.equal(canonicalCustomerPath('/console/clouds'), '/console/clouds');
  assert.equal(canonicalCustomerPath(`/console/clouds/${cloud}/fleet`), `/console/clouds/${cloud}/fleet`);
  assert.equal(canonicalCustomerPath('/console/chipset-sdk'), '/console/chipset-sdk');
  assert.equal(canonicalCustomerPath('/console/chipset-sdk/pro2/firmware-burner'), '/console/chipset-sdk/pro2/firmware-burner');
  assert.equal(routeFromPath('/console/chipset-sdk/pro2/firmware-burner'), 'chipset-sdk');
  assert.equal(cloudIdFromPath('/console/chipset-sdk/pro2/firmware-burner'), '');
  assert.equal(canonicalCustomerPath('/console/jobs'), '/console/clouds');
  assert.equal(canonicalCustomerPath(`/console/${cloud}/overview`), `/console/clouds/${cloud}`);
  assert.equal(canonicalCustomerPath(`/console/${cloud}/jobs`), `/console/clouds/${cloud}/firmware-ota`);
  assert.equal(canonicalCustomerPath(`/console/${cloud}/chipset-sdk`), '/console/chipset-sdk');
  assert.equal(canonicalCustomerPath(`/console/${cloud}/devices`), `/console/clouds/${cloud}/fleet`);
  assert.equal(canonicalCustomerPath(`/console/${cloud}/reports`), `/console/clouds/${cloud}/analytics`);
  assert.equal(canonicalCustomerPath('/console/not-a-cloud/devices'), '/console/clouds');
  assert.equal(canonicalCustomerPath('/unrelated'), '/unrelated');
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
    ['My Clouds', 'Overview', 'Products', 'Cloud Test Lab', 'ChipSet & SDK', 'Developer Docs', 'Fleet Management', 'CSV Provisioning', 'Firmware & OTA', 'Analytics', 'Members & Access', 'Billing', 'Settings', 'Audit'],
  );
  assert.deepEqual(customerNavGroups.map((group) => group.labelKey), ['Clouds', 'Brand Cloud', 'Features', 'Management']);
});

test('customer nav is derived from active membership capabilities', () => {
  const cloud = '11111111-1111-4111-8111-111111111111';
  const labels = cloudNavGroupsForCapabilities(cloud, [
    'fleet.read',
    'customer.devices.read',
    'customer.stream.read',
  ]).flatMap((group) => group.items).map((item) => item.labelKey);
  assert.deepEqual(labels, ['My Clouds', 'Overview', 'ChipSet & SDK', 'Developer Docs', 'Fleet Management', 'Analytics', 'Settings', 'Audit']);
  assert.equal(cloudNavGroupsForCapabilities(cloud, ['team.read']).flatMap((group) => group.items).some((item) => item.id === 'access'), true);
  assert.equal(cloudNavGroupsForCapabilities(cloud, ['billing_account.read']).flatMap((group) => group.items).some((item) => item.id === 'billing'), false);
  assert.equal(cloudNavGroupsForCapabilities(cloud, ['billing_account.read'], { isOwner: true }).flatMap((group) => group.items).some((item) => item.id === 'billing'), true);
  assert.deepEqual(cloudNavGroupsForCapabilities('', null).flatMap((group) => group.items).map((item) => item.id), ['my-clouds', 'chipset-sdk', 'developer-docs']);
  const unscoped = cloudShellNavGroups('', null, { showOwnerOnly: true }).flatMap((group) => group.items);
  assert.deepEqual(unscoped.map((item) => item.labelKey), ['My Clouds', 'Overview', 'Products', 'Cloud Test Lab', 'ChipSet & SDK', 'Developer Docs', 'Fleet Management', 'CSV Provisioning', 'Firmware & OTA', 'Analytics', 'Members & Access', 'Billing', 'Settings', 'Audit']);
  assert.equal(unscoped.find((item) => item.id === 'my-clouds').disabled, false);
  assert.equal(unscoped.find((item) => item.id === 'chipset-sdk').disabled, false);
  assert.equal(unscoped.filter((item) => !item.global).every((item) => item.disabled), true);
  assert.equal(cloudShellNavGroups('', null).flatMap((group) => group.items).some((item) => item.id === 'billing'), false);
  assert.deepEqual(navItemsForCapabilities('login', null), []);
  assert.deepEqual(navItemsForCapabilities('overview', 'fleet.read').map((item) => item.id), ['my-clouds', 'overview', 'chipset-sdk', 'developer-docs', 'settings']);
  assert.equal(navItemsForCapabilities('overview', ['product.read']).some((item) => item.id === 'product-services'), true);
});

test('Brand Cloud navigation and route access are evaluated independently', () => {
  const brandCloudItem = customerNavItems.find((item) => item.id === 'overview');
  assert.equal(isCustomerNavItemActive(brandCloudItem, 'overview'), true);
  assert.equal(isCustomerNavItemActive(brandCloudItem, 'access'), false);
  assert.equal(canAccessCustomerRoute('overview', ['team.read']), true);
  assert.equal(canAccessCustomerRoute('access', ['team.read']), true);
  assert.equal(canAccessCustomerRoute('settings', []), true);
  assert.equal(defaultBrandCloudRoute(['fleet.read']), 'overview');
  assert.equal(defaultBrandCloudRoute(['team.read']), 'overview');
  assert.equal(defaultBrandCloudRoute([]), 'overview');
  assert.equal(cloudConsolePath('11111111-1111-4111-8111-111111111111', 'devices'), '/console/clouds/11111111-1111-4111-8111-111111111111/fleet');
  assert.equal(cloudConsolePath('', 'devices'), '/console/clouds');
  assert.equal(cloudConsolePath('11111111-1111-4111-8111-111111111111', 'my-clouds'), '/console/clouds?cloudId=11111111-1111-4111-8111-111111111111');
  assert.equal(cloudConsolePath('11111111-1111-4111-8111-111111111111', 'chipset-sdk'), '/console/chipset-sdk?cloudId=11111111-1111-4111-8111-111111111111');
  assert.equal(myCloudsPath('11111111-1111-4111-8111-111111111111'), '/console/clouds?cloudId=11111111-1111-4111-8111-111111111111');
  assert.equal(myCloudsPath('../not-a-cloud'), '/console/clouds');
  assert.equal(cloudConsolePath('11111111-1111-4111-8111-111111111111', 'missing'), '/console/clouds');
  assert.equal(isCustomerNavItemActive({ id: 'overview', activeRoutes: ['overview', 'access'] }, 'access'), true);
  assert.equal(canAccessCustomerRoute('my-clouds'), true);
  assert.equal(canAccessCustomerRoute('chipset-sdk'), true);
  assert.equal(canAccessCustomerRoute('missing', ['fleet.read']), false);
});

test('cloud switch keeps an authorized feature and falls back to overview otherwise', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  assert.equal(cloudRouteForSwitch({ id: first, role: 'viewer', capabilities: ['fleet.read'] }, 'devices'), `/console/clouds/${first}/fleet`);
  assert.equal(cloudRouteForSwitch({ id: first, role: 'viewer', capabilities: ['fleet.read'] }, 'my-clouds'), `/console/clouds/${first}`);
  assert.equal(cloudRouteForSwitch({ id: first, role: 'viewer', capabilities: ['fleet.read'] }, 'chipset-sdk'), `/console/chipset-sdk?cloudId=${first}`);
  assert.equal(cloudRouteForSwitch({ id: second, role: 'viewer', capabilities: ['product.read'] }, 'devices'), `/console/clouds/${second}`);
  assert.equal(cloudRouteForSwitch({ id: second, role: 'viewer', owner_user_id: 'owner', capabilities: ['billing_account.read'] }, 'billing', 'viewer'), `/console/clouds/${second}`);
  assert.equal(cloudRouteForSwitch({ id: second, role: 'owner', owner_user_id: 'owner', capabilities: ['billing_account.read'] }, 'billing', 'owner'), `/console/clouds/${second}/billing`);
  assert.equal(cloudRouteForSwitch({ organization_id: first, my_role: 'owner', capabilities: ['billing_account.read'] }, 'billing'), `/console/clouds/${first}/billing`);
  assert.equal(cloudRouteForSwitch(null, 'devices'), '/console/clouds');
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
    ['Platform Home', 'Grafana', 'Service Health', 'Service Logs', 'Brand Cloud Management', 'SSO Providers', 'Operations Log', 'Audit Log'],
  );
  assert.deepEqual(
    platformNavItems.map((item) => item.path),
    ['/admin', '/admin/grafana', '/admin/health', '/admin/logs', '/admin/brand-clouds', '/admin/sso', '/admin/ops', '/admin/audit'],
  );
});

test('route kind selects one capability-filtered navigation hierarchy', () => {
  assert.deepEqual(navGroupsForCapabilities('overview', []).map((group) => group.labelKey), ['Clouds', 'Brand Cloud', 'Features', 'Management']);
  assert.deepEqual(navGroupsForCapabilities('platform-dashboard', []).map((group) => group.labelKey), ['Platform Overview', 'Monitoring and Diagnostics', 'Organizations and Products', 'Operations and Audit']);
  assert.equal(navGroupsForCapabilities('platform-dashboard', [])[2].items.some((item) => item.id === 'platform-chipset-providers'), false);
  assert.equal(navGroupsForCapabilities('platform-dashboard', ['platform.chipset_sdk.read'])[2].items.some((item) => item.id === 'platform-chipset-providers'), false);
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
  const cloud = '11111111-1111-4111-8111-111111111111';
  assert.equal(devicesPathWithFilters(), '/console/clouds');
  assert.equal(devicesPathWithFilters({ cloudId: cloud, deviceId: 'dev-001' }), `/console/clouds/${cloud}/fleet?device=dev-001`);
  assert.equal(
    devicesPathWithFilters({ cloudId: cloud, health: 'warning', status: 'online', signal: 'poor', firmware: 'v1.2.4', productID: 'product-alpha', ignored: 'x' }),
    `/console/clouds/${cloud}/fleet?health=warning&status=online&signal=poor&firmware=v1.2.4&product_id=product-alpha`,
  );
  assert.equal(
    devicesPathWithFilters({ cloudId: cloud, q: 'camera', sort: 'status', direction: 'desc', offset: 20 }),
    `/console/clouds/${cloud}/fleet?q=camera&sort=status&direction=desc&offset=20`,
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

test('Developer Docs is a global peer immediately below ChipSet & SDK', () => {
  const items = customerNavGroups.find((group) => group.id === 'features').items;
  const sdk = items.findIndex((item) => item.id === 'chipset-sdk');
  assert.equal(items[sdk + 1].id, 'developer-docs');
  assert.equal(items[sdk + 2].id, 'devices');
  assert.equal(canAccessCustomerRoute('developer-docs', []), true);
  assert.equal(isPublicRouteId('developer-docs'), false);
  assert.equal(routeFromPath('/console/developer-docs/shadow-quickstart'), 'developer-docs');
  assert.equal(canonicalCustomerPath('/console/developer-docs/shadow-quickstart'), '/console/developer-docs/shadow-quickstart');
  const cloud = '11111111-1111-4111-8111-111111111111';
  assert.equal(cloudConsolePath(cloud, 'developer-docs'), `/console/developer-docs?cloudId=${cloud}`);
});
