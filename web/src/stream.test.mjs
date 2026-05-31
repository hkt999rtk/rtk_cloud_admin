import assert from 'node:assert/strict';
import test from 'node:test';
import { streamAttentionRows, streamModeRows, streamWorstDeviceRows } from './stream.mjs';

test('streamWorstDeviceRows sorts worst devices by failure priority', () => {
  const rows = streamWorstDeviceRows([
    { device_id: 'dev-a', device_name: 'A', success_rate_pct: 80, requests: 20 },
    { device_id: 'dev-b', device_name: 'B', success_rate_pct: 20, requests: 3 },
    { device_id: 'dev-c', device_name: 'C', success_rate_pct: 20, requests: 12 },
    { device_id: 'dev-d', device_name: 'D', success_rate_pct: 100, requests: 1 },
  ]);

  assert.deepEqual(rows.map((row) => row.device_id), ['dev-c', 'dev-b', 'dev-a', 'dev-d']);
});

test('streamWorstDeviceRows keeps customer-safe drawer target fields', () => {
  const [row] = streamWorstDeviceRows([{ device_id: 'dev-a', device_name: 'A', success_rate_pct: 0, requests: 1 }]);
  assert.equal(row.device_id, 'dev-a');
  assert.equal(row.device_name, 'A');
});

test('streamModeRows only shows source-backed modes', () => {
  const rows = streamModeRows({
    webrtc: { success_rate_pct: 90, requests: 10 },
    rtsp: { success_rate_pct: 40, requests: 2 },
    hls: null,
  });
  assert.deepEqual(rows.map((row) => row.mode), ['webrtc', 'rtsp']);
  assert.deepEqual(streamModeRows({}), []);
});

test('streamAttentionRows uses source-backed attention facts before worst-device fallback', () => {
  const rows = streamAttentionRows({
    attention_devices: [
      { device_id: 'dev-a', device_name: 'A', issue: 'Session failures', health: 'warning', priority: 20 },
      { device_id: 'dev-b', device_name: 'B', issue: 'Never streamed', health: 'critical', priority: 50 },
    ],
    worst_devices: [
      { device_id: 'dev-c', device_name: 'C', success_rate_pct: 0, requests: 10 },
    ],
  });
  assert.deepEqual(rows.map((row) => row.device_id), ['dev-b', 'dev-a']);
});

test('streamAttentionRows falls back to source-backed worst-device facts', () => {
  const rows = streamAttentionRows({
    worst_devices: [
      { device_id: 'dev-a', device_name: 'A', success_rate_pct: 100, requests: 3 },
      { device_id: 'dev-b', device_name: 'B', success_rate_pct: 20, requests: 8, failures: 6 },
    ],
  });
  assert.deepEqual(rows, [{
    device_id: 'dev-b',
    device_name: 'B',
    health: 'warning',
    issue: 'Low stream success rate',
    priority: 80,
  }]);
});
