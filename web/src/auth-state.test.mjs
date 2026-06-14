import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlatformOnlySSOSettingsRoute, quotaRaiseErrorMessage, quotaUsageLabel } from './auth-state.mjs';
import { customerNavItems, platformNavItems } from './routes.mjs';

test('customer navigation does not expose platform SSO provider controls', () => {
  assert.equal(customerNavItems.some((item) => isPlatformOnlySSOSettingsRoute(item.id)), false);
  assert.equal(platformNavItems.some((item) => isPlatformOnlySSOSettingsRoute(item.id)), true);
});

test('quota usage copy includes current usage and configured cap', () => {
  assert.equal(quotaUsageLabel(4, 5), 'Current usage: 4 / 5 devices.');
  assert.equal(quotaUsageLabel(undefined, 10), 'Current usage unavailable. Current evaluation cap: 10 devices.');
});

test('quota raise errors use stable user-facing messages', () => {
  assert.equal(
    quotaRaiseErrorMessage(new Error('requested_quota validation failed with 400')),
    'Quota request needs a valid requested quota and use case.',
  );
  assert.equal(
    quotaRaiseErrorMessage(new Error('Account Manager gateway failed with 503')),
    'Quota service is temporarily unavailable. Please try again later.',
  );
  assert.equal(
    quotaRaiseErrorMessage(new Error('video_cloud_devid=vc-1 raw_payload={"error":"boom"}')),
    'Quota request failed. Please try again.',
  );
});
