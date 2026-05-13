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

function numeric(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
