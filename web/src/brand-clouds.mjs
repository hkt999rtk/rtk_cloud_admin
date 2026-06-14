export function brandCloudStatusKey(brand) {
  const raw = String(brand?.status || brand?.metadata?.status || '').trim().toLowerCase();
  if (['active', 'enabled', 'ready'].includes(raw)) return 'active';
  if (['disabled', 'inactive', 'suspended'].includes(raw)) return 'disabled';
  if (['pending', 'pending_verification', 'setup_required', 'setup-required'].includes(raw)) return 'setup_required';
  if (['error', 'failed'].includes(raw)) return 'error';
  return raw || 'setup_required';
}

export function brandCloudStatusLabel(brand) {
  switch (brandCloudStatusKey(brand)) {
    case 'active':
      return 'Active';
    case 'disabled':
      return 'Disabled';
    case 'setup_required':
      return 'Setup Required';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

export function brandCloudTier(brand) {
  return brand?.tier || brand?.metadata?.tier || brand?.metadata?.commercial_tier || 'Evaluation';
}

export function brandCloudRegion(brand) {
  return brand?.metadata?.region || brand?.metadata?.cloud_region || brand?.metadata?.country || 'Unassigned';
}

export function brandCloudOwner(brand) {
  const candidates = [
    brand?.owner_email,
    brand?.admin_email,
    brand?.metadata?.owner_email,
    brand?.metadata?.admin_email,
    brand?.metadata?.primary_admin_email,
  ];
  return candidates.find((value) => String(value || '').trim()) || '';
}

export function brandCloudQuotaLabel(brand) {
  const used = brand?.device_count ?? brand?.metadata?.device_count ?? brand?.metadata?.devices;
  const quota = brand?.evaluation_device_quota ?? brand?.device_quota ?? brand?.metadata?.evaluation_device_quota ?? brand?.metadata?.device_quota;
  if (Number.isFinite(Number(used)) && Number.isFinite(Number(quota))) return `${Number(used)} / ${Number(quota)}`;
  if (Number.isFinite(Number(quota))) return `${Number(quota)} devices`;
  return 'Unavailable';
}

export function brandCloudKPIs(brands) {
  const list = Array.isArray(brands) ? brands : [];
  return {
    total: list.length,
    active: list.filter((brand) => brandCloudStatusKey(brand) === 'active').length,
    setupRequired: list.filter((brand) => brandCloudStatusKey(brand) === 'setup_required').length,
    disabled: list.filter((brand) => brandCloudStatusKey(brand) === 'disabled').length,
  };
}

export function filterBrandClouds(brands, filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const status = String(filters.status || 'all').trim().toLowerCase();
  const tier = String(filters.tier || 'all').trim().toLowerCase();
  return (Array.isArray(brands) ? brands : []).filter((brand) => {
    const matchesQuery = !query || [
      brand?.name,
      brand?.id,
      brandCloudOwner(brand),
      brand?.metadata?.brandname,
      brand?.metadata?.tenant_slug,
    ].some((value) => String(value || '').toLowerCase().includes(query));
    const matchesStatus = status === 'all' || brandCloudStatusKey(brand) === status;
    const matchesTier = tier === 'all' || String(brandCloudTier(brand)).toLowerCase() === tier;
    return matchesQuery && matchesStatus && matchesTier;
  });
}

export function brandCloudUserStatus(user) {
  if (user?.disabled_at) return { key: 'disabled', label: 'Disabled' };
  if (user?.signup_pending_verification) return { key: 'pending_verification', label: 'Pending Activation' };
  return { key: 'active', label: 'Active' };
}

export function userFacingBrandCloudError(error) {
  const message = String(error?.message || error || '');
  if (error?.status === 401) return 'Session expired. Sign in again to continue.';
  if (error?.status === 403) return 'This platform admin session cannot perform that Brand Clouds action.';
  if (/ACCOUNT_MANAGER_BASE_URL|not configured|missing upstream token/i.test(message)) return 'Brand Clouds requires Account Manager Platform Admin login.';
  if (/duplicate|already exists|unique/i.test(message)) return 'A Brand Cloud with those values already exists.';
  if (/email|user|member|role|validation|400|422/i.test(message)) return 'Check the Brand Clouds fields and try again.';
  if (/gateway|account manager|temporarily unavailable|timeout|network|502|503|504/i.test(message)) return 'Brand Clouds is temporarily unavailable. Please try again later.';
  if (/\{.*\}|access_token|refresh_token|authorization|password/i.test(message)) return 'Brand Clouds action failed. Please try again.';
  return message || 'Brand Clouds action failed. Please try again.';
}
