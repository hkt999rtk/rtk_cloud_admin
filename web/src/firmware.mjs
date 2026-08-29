import { translate } from './i18n/index.mjs';

const statusPriority = {
  failed: 0,
  skipped: 1,
  pending: 2,
  eligible: 3,
  downloading: 4,
  applied: 5,
};

const supportedPolicies = new Set(['normal', 'staged', 'maintenance_window', 'manual']);

const campaignStatusLabels = {
  draft: 'Not started',
  scheduled: 'Scheduled',
  active: 'Updating',
  paused: 'Paused',
  completed: 'Completed',
  canceled: 'Canceled',
};

const rolloutStatusLabels = {
  pending: 'Waiting for update',
  eligible: 'Eligible for update',
  downloading: 'Downloading',
  waiting_for_window: 'Waiting for update window',
  waiting_for_user: 'Waiting for user confirmation',
  applied: 'Update completed',
  failed: 'Update failed',
  canceled: 'Canceled',
  skipped: 'Skipped',
};

export function firmwareVersionFilterValue(version) {
  const normalized = String(version || '').trim();
  return normalized && normalized.toLowerCase() !== 'unknown' ? normalized : 'unknown';
}

export function firmwarePolicyLabel(policy) {
  const normalized = String(policy || 'normal').trim().toLowerCase();
  if (!normalized) return 'Normal';
  if (!supportedPolicies.has(normalized)) return `Unsupported policy: ${policy}`;
  return normalized
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function firmwareCampaignStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return translate(campaignStatusLabels[normalized] || (normalized ? 'Unknown status ({{status}})' : 'Unknown status'), { status: normalized });
}

export function firmwareRolloutStatusLabel(status) {
  const normalized = String(status || 'pending').trim().toLowerCase();
  return translate(rolloutStatusLabels[normalized] || 'Unknown status ({{status}})', { status: normalized });
}

export function firmwareCampaignProgress(campaign = {}) {
  const total = Number(campaign.total || 0);
  const completed = Number(campaign.applied || 0) + Number(campaign.failed || 0) + Number(campaign.skipped || 0);
  return { total, completed, pct: total ? completed / total * 100 : 0 };
}

export function firmwareCampaignActions(campaign = {}, canManage = true) {
  if (!canManage) return [];
  const state = String(campaign.state || '').trim().toLowerCase();
  if (state === 'draft') return ['start'];
  if (state === 'scheduled' || state === 'active') return ['pause', 'cancel'];
  if (state === 'paused') return ['resume', 'cancel'];
  if (state === 'completed' && Number(campaign.failed || 0) > 0) return ['retry'];
  return [];
}

export function firmwareCampaignNeedsPolling(campaign = {}) {
  return ['scheduled', 'active'].includes(String(campaign.state || '').trim().toLowerCase());
}

export function firmwareCampaignDetailRows(campaign = {}) {
  return [...(campaign.rollouts || [])]
    .map((rollout) => ({
      device_id: rollout.device_id || '',
      device_name: rollout.device_name || rollout.device_id || '',
      current_version: firmwareVersionFilterValue(rollout.current_version),
      target_version: rollout.target_version || campaign.target_version || '',
      rollout_status: rollout.rollout_status || 'pending',
      reason: rollout.failure_reason || rollout.reason || '',
      last_updated: rollout.last_updated || '',
    }))
    .sort(compareFirmwareRows);
}

export function firmwareRiskRows(campaigns = [], limit = 6) {
  return campaigns
    .flatMap((campaign) => firmwareCampaignDetailRows(campaign).map((rollout) => ({ ...rollout, campaign })))
    .filter((rollout) => {
      const status = String(rollout.rollout_status || '').toLowerCase();
      return !['applied', 'skipped'].includes(status) || rollout.current_version === 'unknown';
    })
    .sort(compareFirmwareRows)
    .slice(0, limit);
}

function compareFirmwareRows(left, right) {
  const leftStatus = String(left.rollout_status || '').toLowerCase();
  const rightStatus = String(right.rollout_status || '').toLowerCase();
  const leftUnknown = left.current_version === 'unknown' ? 0 : 1;
  const rightUnknown = right.current_version === 'unknown' ? 0 : 1;
  const leftRank = Math.min(statusPriority[leftStatus] ?? 4, leftUnknown);
  const rightRank = Math.min(statusPriority[rightStatus] ?? 4, rightUnknown);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.last_updated !== right.last_updated) return String(right.last_updated).localeCompare(String(left.last_updated));
  return String(left.device_name || left.device_id).localeCompare(String(right.device_name || right.device_id));
}
