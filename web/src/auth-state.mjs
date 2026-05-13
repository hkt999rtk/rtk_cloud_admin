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
