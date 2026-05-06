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
  assert.equal(routeFromPath('/verify'), 'verify');
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
