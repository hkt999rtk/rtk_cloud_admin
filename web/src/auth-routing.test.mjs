import assert from 'node:assert/strict';
import test from 'node:test';
import {
  destinationForSession,
  isSafeLoginNext,
  isPlatformLoginNext,
  loginNextFromLocation,
  loginPathFor,
  normalizeLoginNext,
  removeQueryParameterFromAddress,
} from './auth-routing.mjs';

test('login next accepts only admin and console paths', () => {
  assert.equal(normalizeLoginNext('/admin/health?window=1#top'), '/admin/health?window=1#top');
  assert.equal(normalizeLoginNext('/console/devices?health=warning'), '/console/devices?health=warning');
  assert.equal(normalizeLoginNext('/brand-cloud-member-invitation/accept?token=invite-token'), '/brand-cloud-member-invitation/accept?token=invite-token');
  assert.equal(isSafeLoginNext('/admin'), true);
  assert.equal(isSafeLoginNext('/console'), true);
});

test('login next rejects open redirects and unrelated app paths', () => {
  assert.equal(normalizeLoginNext('https://evil.example/admin'), '');
  assert.equal(normalizeLoginNext('//evil.example/admin'), '');
  assert.equal(normalizeLoginNext('/signup'), '');
  assert.equal(normalizeLoginNext('/api/admin'), '');
  assert.equal(normalizeLoginNext('/administrator'), '');
});

test('login path preserves safe protected destination', () => {
  assert.equal(loginPathFor('/admin/health'), '/login?next=%2Fadmin%2Fhealth');
  assert.equal(loginPathFor('/signup'), '/login');
});

test('login page reads safe next from location search', () => {
  assert.equal(
    loginNextFromLocation({ search: '?next=%2Fconsole%2Fdevices%3Fdevice%3Ddev-1' }),
    '/console/devices?device=dev-1',
  );
  assert.equal(loginNextFromLocation({ search: '?next=https%3A%2F%2Fevil.example' }), '');
});

test('session destination respects session kind and next path', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const customer = { authenticated: true, kind: 'customer', memberships: [{ organization_id: id }] };
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin' }, '/admin/health'), '/admin/health');
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin' }, '/console/devices'), '/admin');
  assert.equal(destinationForSession(customer, '/console/devices'), `/console/clouds/${id}`);
  assert.equal(destinationForSession(customer, '/admin'), `/console/clouds/${id}`);
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer' }, '/brand-cloud-member-invitation/accept?token=invite-token'), '/brand-cloud-member-invitation/accept?token=invite-token');
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin' }, '/brand-cloud-member-invitation/accept?token=invite-token'), '/brand-cloud-member-invitation/accept?token=invite-token');
  assert.equal(destinationForSession({ authenticated: false }, '/admin'), '/login?next=%2Fadmin');
});

test('password login prefers the destination view', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin' }, '/admin?tab=health#status'), '/admin?tab=health#status');
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer', memberships: [{ organization_id: id }] }, '/console?cloud=brand-1#status'), `/console/clouds/${id}`);
});

test('platform login context requires a safe admin destination', () => {
  assert.equal(isPlatformLoginNext('/admin'), true);
  assert.equal(isPlatformLoginNext('/admin/health?window=1#status'), true);
  assert.equal(isPlatformLoginNext('/console/overview'), false);
  assert.equal(isPlatformLoginNext('/administrator'), false);
  assert.equal(isPlatformLoginNext('https://evil.example/admin'), false);
  assert.equal(isPlatformLoginNext('//evil.example/admin'), false);
  assert.equal(isPlatformLoginNext(''), false);
});

test('explicit My Clouds is preserved; scoped next requires membership', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const next = `/console/clouds/${id}?operation=22222222-2222-4222-8222-222222222222`;
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer', memberships: [] }, ''), '/console/clouds');
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin' }, '/console/clouds'), '/console/clouds');
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer', memberships: [] }, next), '/console/clouds');
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer', memberships: [{ organization_id: id }] }, next), next);
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin', memberships: [{ id }] }, ''), `/console/clouds/${id}`);
});

test('global developer resources preserve a safe login next without cloud context', () => {
  const sdkPath = '/console/chipset-sdk';
  const burnerPath = '/console/chipset-sdk/pro2/firmware-burner';
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin', memberships: [] }, sdkPath), sdkPath);
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer', memberships: [] }, sdkPath), sdkPath);
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin', memberships: [] }, burnerPath), burnerPath);
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer', memberships: [] }, burnerPath), burnerPath);
});

test('login opens a valid remembered cloud or the first ordered membership', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const remembered = '22222222-2222-4222-8222-222222222222';
  const stale = '33333333-3333-4333-8333-333333333333';
  const me = { authenticated: true, kind: 'customer', memberships: [{ organization_id: first }, { organization_id: remembered }] };
  assert.equal(destinationForSession(me, '', remembered), `/console/clouds/${remembered}`);
  assert.equal(destinationForSession(me, '', stale), `/console/clouds/${first}`);
  assert.equal(destinationForSession(me, '/console/clouds', remembered), '/console/clouds');
});

test('sensitive query parameters are removed without changing the rest of the address', () => {
  const calls = [];
  const history = {
    state: { source: 'email' },
    replaceState: (...args) => calls.push(args),
  };
  const location = {
    pathname: '/reset-password',
    search: '?token=secret&campaign=welcome',
    hash: '#form',
  };

  assert.equal(removeQueryParameterFromAddress(location, history, 'token'), true);
  assert.deepEqual(calls, [[history.state, '', '/reset-password?campaign=welcome#form']]);
  assert.equal(removeQueryParameterFromAddress({ pathname: '/reset-password', search: '' }, history, 'token'), false);
  assert.equal(calls.length, 1);
});
