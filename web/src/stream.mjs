export function streamWorstDeviceRows(devices = []) {
  return [...devices].sort((left, right) => {
    const leftRate = numeric(left.success_rate_pct, 100);
    const rightRate = numeric(right.success_rate_pct, 100);
    if (leftRate !== rightRate) return leftRate - rightRate;
    const leftRequests = numeric(left.requests, 0);
    const rightRequests = numeric(right.requests, 0);
    if (leftRequests !== rightRequests) return rightRequests - leftRequests;
    return String(left.device_name || left.device_id).localeCompare(String(right.device_name || right.device_id));
  });
}

export function streamModeRows(byMode = {}) {
  return Object.entries(byMode || {})
    .filter(([, stats]) => stats && (Number.isFinite(Number(stats.requests)) || Number.isFinite(Number(stats.success_rate_pct))))
    .map(([mode, stats]) => ({
      mode,
      success_rate_pct: numeric(stats.success_rate_pct, 0),
      requests: numeric(stats.requests, 0),
    }))
    .sort((left, right) => {
      if (left.mode === 'webrtc') return -1;
      if (right.mode === 'webrtc') return 1;
      if (left.requests !== right.requests) return right.requests - left.requests;
      return left.mode.localeCompare(right.mode);
    });
}

export function streamAttentionRows(stats = {}, limit = 5) {
  const attentionDevices = Array.isArray(stats.attention_devices) ? stats.attention_devices : [];
  if (attentionDevices.length) {
    return attentionDevices
      .map((device) => ({
        device_id: device.device_id || '',
        device_name: device.device_name || device.device_id || '',
        health: device.health || 'warning',
        issue: device.issue || 'Stream attention required',
        priority: numeric(device.priority, 0),
      }))
      .sort((left, right) => right.priority - left.priority || left.device_name.localeCompare(right.device_name))
      .slice(0, limit);
  }
  return streamWorstDeviceRows(stats.worst_devices || [])
    .filter((device) => numeric(device.success_rate_pct, 100) < 100 || numeric(device.failures, 0) > 0)
    .map((device) => ({
      device_id: device.device_id || '',
      device_name: device.device_name || device.device_id || '',
      health: numeric(device.success_rate_pct, 100) <= 50 ? 'warning' : 'unknown',
      issue: numeric(device.requests, 0) === 0 ? 'No stream sessions reported' : 'Low stream success rate',
      priority: 100 - numeric(device.success_rate_pct, 100),
    }))
    .slice(0, limit);
}

function numeric(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
