import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customerNavItems,
  devicesPathWithFilters,
  isPlatformRouteId,
  isPublicRouteId,
  navItemsForRoute,
  platformNavItems,
  routeFromPath,
  titleFor,
} from './routes.mjs';

test('maps platform shell paths to platform routes', () => {
  assert.equal(routeFromPath('/admin'), 'platform-dashboard');
  assert.equal(routeFromPath('/admin/resources'), 'platform-resources');
  assert.equal(routeFromPath('/admin/health'), 'platform-health');
  assert.equal(routeFromPath('/admin/brand-clouds'), 'platform-brand-clouds');
  assert.equal(routeFromPath('/admin/brand-clouds/brand-001'), 'platform-brand-clouds');
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
  assert.equal(routeFromPath('/forgot-password'), 'forgot-password');
  assert.equal(routeFromPath('/reset-password'), 'reset-password');
  assert.equal(routeFromPath('/signup'), 'signup');
  assert.equal(routeFromPath('/signup/check-email'), 'signup-check-email');
  assert.equal(routeFromPath('/signup/check-email/inbox'), 'signup-check-email');
  assert.equal(routeFromPath('/verify'), 'verify');
  assert.equal(routeFromPath('/verify/token-1'), 'verify');
});

test('maps customer shell paths to customer routes', () => {
  assert.equal(routeFromPath('/console'), 'overview');
  assert.equal(routeFromPath('/console/overview'), 'overview');
  assert.equal(routeFromPath('/console/devices'), 'devices');
  assert.equal(routeFromPath('/console/customers'), 'overview');
  assert.equal(routeFromPath('/console/operations'), 'overview');
  assert.equal(routeFromPath('/console/operations/history'), 'overview');
  assert.equal(routeFromPath('/console/firmware-ota'), 'firmware-ota');
  assert.equal(routeFromPath('/console/stream-health'), 'stream-health');
  assert.equal(routeFromPath('/console/groups'), 'overview');
  assert.equal(routeFromPath('/console/groups/legacy'), 'overview');
});

test('customer nav follows the approved Customer View design order', () => {
  assert.deepEqual(
    customerNavItems.map((item) => item.label),
    ['Overview', 'Devices', 'Firmware & OTA', 'Stream Health'],
  );
});

test('retired customer pages are not exposed in section navigation', () => {
  const customerLabels = customerNavItems.map((item) => item.label);
  const platformLabels = platformNavItems.map((item) => item.label);

  assert.equal(customerLabels.includes('Groups'), false);
  assert.equal(customerLabels.includes('Customers'), false);
  assert.equal(customerLabels.includes('Operations'), false);
  assert.equal(platformLabels.includes('Groups'), false);
  assert.equal(platformLabels.includes('Customers'), false);
});

test('platform nav follows the Platform Dashboard landing order', () => {
  assert.deepEqual(
    platformNavItems.map((item) => item.label),
    ['Platform Dashboard', 'Resource Trends', 'Service Health', 'Brand Clouds', 'SSO Providers', 'Service Logs', 'Operations Log', 'Audit Log'],
  );
  assert.deepEqual(
    platformNavItems.map((item) => item.path),
    ['/admin', '/admin/resources', '/admin/health', '/admin/brand-clouds', '/admin/sso', '/admin/logs', '/admin/ops', '/admin/audit'],
  );
});

test('public auth routes stay outside Customer and Platform section navigation', () => {
  for (const route of ['login', 'login-check-email', 'login-activate', 'forgot-password', 'reset-password', 'signup', 'signup-check-email', 'verify']) {
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
    devicesPathWithFilters({ health: 'warning', status: 'online', signal: 'poor', firmware: 'v1.2.4', ignored: 'x' }),
    '/console/devices?health=warning&status=online&signal=poor&firmware=v1.2.4',
  );
});

test('uses fleet health overview title for the customer landing page', () => {
  assert.equal(titleFor('overview'), 'Fleet Health Overview');
});

test('falls back unknown paths to the customer overview route', () => {
  assert.equal(routeFromPath('/'), 'overview');
  assert.equal(routeFromPath('/console/unknown'), 'overview');
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
    'devices',
    'firmware-ota',
    'stream-health',
    'platform-dashboard',
    'platform-resources',
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
