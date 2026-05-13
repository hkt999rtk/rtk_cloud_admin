import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlatformOnlySSOSettingsRoute, quotaUsageLabel, shouldShowBreakGlass } from './auth-state.mjs';
import { customerNavItems, platformNavItems } from './routes.mjs';

test('break-glass UI is visible only when backend policy enables it', () => {
  assert.equal(shouldShowBreakGlass(null), false);
  assert.equal(shouldShowBreakGlass({ break_glass_enabled: false }), false);
  assert.equal(shouldShowBreakGlass({ break_glass_enabled: true }), true);
});

test('customer navigation does not expose platform SSO provider controls', () => {
  assert.equal(customerNavItems.some((item) => isPlatformOnlySSOSettingsRoute(item.id)), false);
  assert.equal(platformNavItems.some((item) => isPlatformOnlySSOSettingsRoute(item.id)), true);
});

test('quota usage copy includes current usage and configured cap', () => {
  assert.equal(quotaUsageLabel(4, 5), 'Current usage: 4 / 5 devices.');
  assert.equal(quotaUsageLabel(undefined, 10), 'Current usage unavailable. Current evaluation cap: 10 devices.');
});
