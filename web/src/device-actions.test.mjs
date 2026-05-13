import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceActionState, isReadOnlyRole } from './device-actions.mjs';

test('isReadOnlyRole recognizes observer-style customer roles', () => {
  assert.equal(isReadOnlyRole('viewer'), true);
  assert.equal(isReadOnlyRole('observer'), true);
  assert.equal(isReadOnlyRole('read_only'), true);
  assert.equal(isReadOnlyRole('manager'), false);
});

test('deviceActionState disables writes for read-only observers', () => {
  const state = deviceActionState({ readiness: 'registered' }, 'provision', { readOnly: true });
  assert.equal(state.enabled, false);
  assert.match(state.reason, /Read-only Observer/);
});

test('deviceActionState disables actions when telemetry source is unavailable', () => {
  const state = deviceActionState({ readiness: 'registered' }, 'provision', { telemetryStatus: 'unavailable' });
  assert.equal(state.enabled, false);
  assert.match(state.reason, /source is unavailable/);
});

test('deviceActionState keeps readiness-specific reasons for invalid actions', () => {
  assert.deepEqual(deviceActionState({ readiness: 'online' }, 'provision'), {
    enabled: false,
    reason: 'Device is already activated.',
  });
  assert.deepEqual(deviceActionState({ readiness: 'deactivated' }, 'deactivate'), {
    enabled: false,
    reason: 'Device is already deactivated.',
  });
});
