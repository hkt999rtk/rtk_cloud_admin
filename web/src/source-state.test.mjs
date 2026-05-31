import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sourceAvailable,
  sourceMessage,
  sourceStateForPanel,
  sourceUnavailableFromError,
  telemetrySourceState,
} from './source-state.mjs';

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

test('sourceMessage suppresses raw upstream and platform-only details', () => {
  assert.equal(
    sourceMessage(
      { source_status: 'unavailable', source_message: 'video_cloud_devid=vc-123 operation_id=op-9 raw_payload={"dead_lettered":true}' },
      'Telemetry source is unavailable.',
    ),
    'Telemetry source is unavailable.',
  );
  assert.equal(
    sourceMessage({ source_status: 'unavailable', source_message: 'Gateway returned 502 for device stream.' }, 'Fallback'),
    'Gateway returned 502 for device stream.',
  );
});

test('sourceStateForPanel covers loading, empty, filtered-empty, unavailable, gateway-error, and ready states', () => {
  assert.deepEqual(
    sourceStateForPanel({ loading: true, source: null, hasData: false, category: 'telemetry' }),
    { kind: 'loading', title: 'Loading telemetry data', message: 'Loading telemetry data.' },
  );
  assert.equal(sourceStateForPanel({ source: { source_status: 'available' }, hasData: true }).kind, 'ready');
  assert.equal(sourceStateForPanel({ source: { source_status: 'available' }, hasData: false }).kind, 'empty');
  assert.equal(sourceStateForPanel({ source: { source_status: 'available' }, hasData: false, filtered: true }).kind, 'filtered-empty');
  assert.equal(sourceStateForPanel({ source: { source_status: 'no_data' }, hasData: false }).kind, 'empty');
  assert.equal(sourceStateForPanel({ source: { source_status: 'unavailable' }, hasData: false }).kind, 'source-unavailable');
  assert.equal(sourceStateForPanel({ error: 'GET /api/fleet/health-summary failed with 502', hasData: false }).kind, 'gateway-error');
});

test('sourceUnavailableFromError creates customer-safe gateway source objects', () => {
  const source = sourceUnavailableFromError('stream', new Error('/api/fleet/stream-stats failed with 502 and video_cloud_devid=vc-secret'));
  assert.equal(source.source_status, 'unavailable');
  assert.equal(source.source_kind, 'stream');
  assert.equal(sourceMessage(source, 'Fallback'), 'Stream source could not be reached.');
});

test('telemetrySourceState preserves drawer identity context during telemetry failures', () => {
  assert.deepEqual(
    telemetrySourceState({
      telemetry: null,
      loading: false,
      error: 'operation_id=op-1 video_cloud_devid=vc-1 upstream failed',
    }),
    {
      kind: 'gateway-error',
      title: 'Telemetry gateway error',
      message: 'Telemetry source could not be reached.',
    },
  );
  assert.equal(
    telemetrySourceState({ telemetry: { telemetry_status: 'unavailable', unavailable_reason: 'No sample found.' } }).message,
    'No sample found.',
  );
});
