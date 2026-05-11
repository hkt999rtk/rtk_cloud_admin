import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlatformOnlySSOSettingsRoute, shouldShowBreakGlass } from './auth-state.mjs';
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
