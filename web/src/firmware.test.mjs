import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firmwareCampaignActions,
  firmwareCampaignDetailRows,
  firmwareCampaignNeedsPolling,
  firmwareCampaignProgress,
  firmwareCampaignStatusLabel,
  firmwarePolicyLabel,
  firmwareRiskRows,
  firmwareRolloutStatusLabel,
  firmwareVersionFilterValue,
} from './firmware.mjs';

const campaign = {
  campaign_id: 'campaign-1',
  target_version: 'v1.2.4',
  rollouts: [
    { device_id: 'dev-a', device_name: 'Camera A', current_version: 'v1.2.4', rollout_status: 'applied', last_updated: '2026-04-03T00:00:00Z' },
    { device_id: 'dev-b', device_name: 'Camera B', current_version: 'v1.2.3', rollout_status: 'pending', reason: 'maintenance window', last_updated: '2026-04-02T00:00:00Z' },
    { device_id: 'dev-c', device_name: 'Camera C', current_version: '', rollout_status: 'skipped', last_updated: '2026-04-01T00:00:00Z' },
    { device_id: 'dev-d', device_name: 'Camera D', current_version: 'v1.2.2', rollout_status: 'failed', reason: 'checksum', last_updated: '2026-04-04T00:00:00Z' },
  ],
};

test('firmwareCampaignDetailRows maps rollouts into read-only detail rows', () => {
  const rows = firmwareCampaignDetailRows(campaign);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    device_id: 'dev-d',
    device_name: 'Camera D',
    current_version: 'v1.2.2',
    target_version: 'v1.2.4',
    rollout_status: 'failed',
    reason: 'checksum',
    last_updated: '2026-04-04T00:00:00Z',
  });
});

test('firmwareRiskRows includes unknown firmware as operational risk', () => {
  const rows = firmwareRiskRows([campaign], 10);
  assert.deepEqual(rows.map((row) => row.device_id), ['dev-d', 'dev-c', 'dev-b']);
});

test('firmwareRiskRows handles empty campaign data', () => {
  assert.deepEqual(firmwareRiskRows([], 10), []);
});

test('firmwareVersionFilterValue preserves unknown firmware filter', () => {
  assert.equal(firmwareVersionFilterValue(''), 'unknown');
  assert.equal(firmwareVersionFilterValue('Unknown'), 'unknown');
  assert.equal(firmwareVersionFilterValue('v1.2.4'), 'v1.2.4');
});

test('firmwarePolicyLabel marks unsupported policy values explicitly', () => {
  assert.equal(firmwarePolicyLabel('staged'), 'Staged');
  assert.equal(firmwarePolicyLabel('normal'), 'Normal');
  assert.equal(firmwarePolicyLabel('region_canary'), 'Unsupported policy: region_canary');
  assert.equal(firmwarePolicyLabel(''), 'Normal');
});

test('firmware status helpers use upgrade-specific English labels', () => {
  assert.equal(firmwareCampaignStatusLabel('active'), 'Updating');
  assert.equal(firmwareCampaignStatusLabel('completed'), 'Completed');
  assert.equal(firmwareRolloutStatusLabel('waiting_for_window'), 'Waiting for update window');
  assert.equal(firmwareRolloutStatusLabel('failed'), 'Update failed');
});

test('firmware campaign progress counts terminal device outcomes', () => {
  assert.deepEqual(firmwareCampaignProgress({ total: 10, applied: 6, failed: 1, skipped: 1 }), { total: 10, completed: 8, pct: 80 });
  assert.deepEqual(firmwareCampaignProgress({}), { total: 0, completed: 0, pct: 0 });
});

test('firmware campaign actions follow campaign state and permission', () => {
  assert.deepEqual(firmwareCampaignActions({ state: 'draft' }), ['start']);
  assert.deepEqual(firmwareCampaignActions({ state: 'active' }), ['pause', 'cancel']);
  assert.deepEqual(firmwareCampaignActions({ state: 'paused' }), ['resume', 'cancel']);
  assert.deepEqual(firmwareCampaignActions({ state: 'completed', failed: 2 }), ['retry']);
  assert.deepEqual(firmwareCampaignActions({ state: 'completed', failed: 0 }), []);
  assert.deepEqual(firmwareCampaignActions({ state: 'active' }, false), []);
});

test('only progressing firmware campaigns need polling', () => {
  assert.equal(firmwareCampaignNeedsPolling({ state: 'active' }), true);
  assert.equal(firmwareCampaignNeedsPolling({ state: 'scheduled' }), true);
  assert.equal(firmwareCampaignNeedsPolling({ state: 'paused' }), false);
  assert.equal(firmwareCampaignNeedsPolling({ state: 'completed' }), false);
});
