import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceAvailable, sourceMessage } from './source-state.mjs';

test('sourceAvailable only treats available source status as available', () => {
  assert.equal(sourceAvailable({ source_status: 'available' }), true);
  assert.equal(sourceAvailable({ source_status: 'no_data' }), false);
  assert.equal(sourceAvailable({ source_status: 'not_configured' }), false);
  assert.equal(sourceAvailable({ source_status: 'unavailable' }), false);
  assert.equal(sourceAvailable(null), false);
});

test('sourceMessage returns specific customer-safe copy for unavailable states', () => {
  assert.equal(sourceMessage({ source_status: 'not_configured' }, 'Fallback'), 'Fallback');
  assert.equal(sourceMessage({ source_status: 'no_data' }, 'Fallback'), 'No data in selected window.');
  assert.equal(sourceMessage({ source_status: 'unavailable' }, 'Fallback'), 'Source is unavailable.');
  assert.equal(sourceMessage({ source_status: 'unauthorized' }, 'Fallback'), 'Session expired; please sign in again.');
  assert.equal(sourceMessage({ source_status: 'unavailable', source_message: 'Stream source is unavailable.' }, 'Fallback'), 'Stream source is unavailable.');
});
