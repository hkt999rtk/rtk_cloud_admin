import assert from 'node:assert/strict';
import test from 'node:test';
import { streamWorstDeviceRows } from './stream.mjs';

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
