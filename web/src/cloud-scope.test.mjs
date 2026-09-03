import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudConsolePath, scopedCustomerAPI } from './cloud-scope.mjs';

const cloud = '11111111-1111-4111-8111-111111111111';

test('scopedCustomerAPI keeps functional requests inside the URL cloud', () => {
  assert.equal(scopedCustomerAPI('/api/fleet/devices?limit=25', cloud), `/api/developer/brand-clouds/${cloud}/fleet/devices?limit=25`);
  assert.equal(scopedCustomerAPI('/api/update-plans/plan-1/start', cloud), `/api/developer/brand-clouds/${cloud}/update-plans/plan-1/start`);
  assert.equal(scopedCustomerAPI('/api/products?limit=25', cloud), `/api/developer/brand-clouds/${cloud}/products?limit=25`);
  assert.equal(scopedCustomerAPI('/api/me', cloud), '/api/me');
});

test('cloudConsolePath emits canonical multi-cloud URLs', () => {
  assert.equal(cloudConsolePath(cloud, 'devices'), `/console/clouds/${cloud}/fleet`);
  assert.equal(cloudConsolePath(cloud, 'reports'), `/console/clouds/${cloud}/analytics/reports`);
  assert.equal(cloudConsolePath(cloud, 'billing'), `/console/clouds/${cloud}/billing`);
});
