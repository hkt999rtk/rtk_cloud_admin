import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firmwareCampaignActions,
  firmwareCampaignDetailRows,
  firmwareCampaignNeedsPolling,
  firmwareCampaignProgress,
  firmwareCampaignWaitingProgress,
  firmwareCampaignStatusLabel,
  firmwareDashboardAction,
  firmwarePolicyLabel,
  firmwareRiskRows,
  firmwareRolloutStatusLabel,
  firmwareVersionFilterValue,
  sortFirmwareCampaignsByStartTime,
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

test('firmware dashboard reports waiting devices against the campaign total', () => {
  assert.deepEqual(firmwareCampaignWaitingProgress({ total: 10, pending: 3 }), { total: 10, waiting: 3, pct: 30 });
  assert.deepEqual(firmwareCampaignWaitingProgress({ total: 0, pending: 2 }), { total: 0, waiting: 2, pct: 0 });
});

test('firmware dashboard orders campaigns by newest start time', () => {
  const sorted = sortFirmwareCampaignsByStartTime([
    { campaign_id: 'older', started_at: '2026-08-28T01:00:00Z' },
    { campaign_id: 'not-started', started_at: '' },
    { campaign_id: 'newer', started_at: '2026-08-29T01:00:00Z' },
  ]);
  assert.deepEqual(sorted.map((item) => item.campaign_id), ['newer', 'older', 'not-started']);
});

test('firmware dashboard exposes reversible start and stop controls', () => {
  assert.deepEqual(firmwareDashboardAction({ state: 'draft' }), { action: 'start', label: 'Start OTA' });
  assert.deepEqual(firmwareDashboardAction({ state: 'paused' }), { action: 'resume', label: 'Start OTA' });
  assert.deepEqual(firmwareDashboardAction({ state: 'active' }), { action: 'pause', label: 'Stop OTA' });
  assert.equal(firmwareDashboardAction({ state: 'completed' }), null);
  assert.equal(firmwareDashboardAction({ state: 'active' }, false), null);
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
