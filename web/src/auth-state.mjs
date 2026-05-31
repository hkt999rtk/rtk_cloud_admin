export function shouldShowBreakGlass(me) {
  return Boolean(me?.break_glass_enabled);
}

export function isPlatformOnlySSOSettingsRoute(route) {
  return route === 'platform-sso';
}

export function quotaUsageLabel(currentUsage, currentQuota) {
  const quota = Number.isFinite(Number(currentQuota)) ? Number(currentQuota) : 0;
  if (!Number.isFinite(Number(currentUsage))) {
    return `Current usage unavailable. Current evaluation cap: ${quota} devices.`;
  }
  return `Current usage: ${Number(currentUsage)} / ${quota} devices.`;
}

export function quotaRaiseErrorMessage(error) {
  const message = String(error?.message || error || '');
  if (/validation|requested_quota|use case|400|422/i.test(message)) {
    return 'Quota request needs a valid requested quota and use case.';
  }
  if (/gateway|account manager|temporarily unavailable|timeout|502|503|504/i.test(message)) {
    return 'Quota service is temporarily unavailable. Please try again later.';
  }
  return 'Quota request failed. Please try again.';
}
