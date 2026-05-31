const statusPriority = {
  failed: 0,
  skipped: 1,
  pending: 2,
  eligible: 3,
  downloading: 4,
  applied: 5,
};

const supportedPolicies = new Set(['normal', 'staged', 'maintenance_window', 'manual']);

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
