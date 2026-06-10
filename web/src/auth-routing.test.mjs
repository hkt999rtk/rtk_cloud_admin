import assert from 'node:assert/strict';
import test from 'node:test';
import {
  destinationForSession,
  isSafeLoginNext,
  loginNextFromLocation,
  loginPathFor,
  normalizeLoginNext,
} from './auth-routing.mjs';

test('login next accepts only admin and console paths', () => {
  assert.equal(normalizeLoginNext('/admin/health?window=1#top'), '/admin/health?window=1#top');
  assert.equal(normalizeLoginNext('/console/devices?health=warning'), '/console/devices?health=warning');
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
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin' }, '/admin/health'), '/admin/health');
  assert.equal(destinationForSession({ authenticated: true, kind: 'platform_admin' }, '/console/devices'), '/admin');
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer' }, '/console/devices'), '/console/devices');
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer' }, '/admin'), '/console/overview');
  assert.equal(destinationForSession({ authenticated: false }, '/admin'), '/login?next=%2Fadmin');
});
