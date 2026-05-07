import assert from 'node:assert/strict';
import test from 'node:test';
import { routeFromPath, titleFor } from './routes.mjs';

test('maps platform shell paths to platform routes', () => {
  assert.equal(routeFromPath('/admin'), 'platform-health');
  assert.equal(routeFromPath('/admin/ops'), 'platform-operations');
  assert.equal(routeFromPath('/admin/operations'), 'platform-operations');
  assert.equal(routeFromPath('/admin/audit'), 'platform-audit');
});

test('maps public signup paths to auth routes', () => {
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
  assert.equal(routeFromPath('/console/operations'), 'operations');
  assert.equal(routeFromPath('/console/firmware-ota'), 'firmware-ota');
  assert.equal(routeFromPath('/console/stream-health'), 'stream-health');
  assert.equal(routeFromPath('/console/groups'), 'groups');
});

test('uses fleet health overview title for the customer landing page', () => {
  assert.equal(titleFor('overview'), 'Fleet Health Overview');
});

test('falls back unknown paths to the customer overview route', () => {
  assert.equal(routeFromPath('/'), 'overview');
  assert.equal(routeFromPath('/console/unknown'), 'overview');
  assert.equal(routeFromPath('/admin/unknown'), 'overview');
});

test('provides titles for all public shell routes', () => {
  for (const route of [
    'signup',
    'signup-check-email',
    'verify',
    'overview',
    'devices',
    'operations',
    'firmware-ota',
    'stream-health',
    'groups',
    'platform-health',
    'platform-operations',
    'platform-audit',
  ]) {
    assert.equal(typeof titleFor(route), 'string', route);
    assert.notEqual(titleFor(route), '');
  }
});
