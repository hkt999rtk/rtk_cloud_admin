import { translate } from './i18n/index.mjs';

export function providerKPIs(providers = []) {
  const published = providers.filter((provider) => provider.status === 'published');
  const successes = providers.map((provider) => provider.last_successful_refresh_at).filter(Boolean).sort();
  return {
    total: providers.length,
    published: published.length,
    publishedChipsets: published.reduce((sum, provider) => sum + Number(provider.chipset_count || 0), 0),
    publishedSDKs: published.reduce((sum, provider) => sum + Number(provider.sdk_release_count || 0), 0),
    lastSuccess: successes.at(-1) || '',
    needsAttention: providers.filter((provider) => provider.stale || provider.unavailable || provider.validation_error).length,
  };
}

export function filterProviders(providers = [], query = '', filter = 'all') {
  const needle = query.trim().toLowerCase();
  return providers.filter((provider) => {
    const matchesFilter = filter === 'all'
      || (filter === 'stale' ? provider.stale : provider.status === filter);
    const haystack = [provider.name, provider.id, provider.manifest_version, provider.manifest_url]
      .filter(Boolean).join(' ').toLowerCase();
    return matchesFilter && (!needle || haystack.includes(needle));
  });
}

export function providerSyncHealth(provider = {}) {
  if (provider.unavailable) return { key: 'unavailable', label: translate('Unavailable'), detail: translate('No valid synchronized snapshot is available.') };
  if (provider.stale) return { key: 'stale', label: translate('Stale'), detail: translate('The latest synchronization failed. The last valid snapshot remains available.') };
  if (provider.last_successful_refresh_at) return { key: 'healthy', label: translate('Healthy'), detail: '' };
  return { key: 'pending', label: translate('Pending'), detail: translate('Not synchronized') };
}

export function providerValidationErrorMessage(provider = {}) {
  if (!provider?.validation_error) return '';
  if (provider?.unavailable) return translate('Manifest validation failed and no valid synchronized snapshot is available.');
  return translate('Manifest validation failed. The last valid synchronized snapshot remains available.');
}

export function providerEndpointCount(chipsets = []) {
	return chipsets.reduce((total, chipset) => total
		+ (chipset.resources || []).length
		+ (chipset.sdk_releases || []).reduce((sum, release) => sum + (release.endpoints || []).length, 0), 0);
}

export function chipsetVendors(chipsets = []) {
  return Array.from(new Set(chipsets.map((chipset) => chipset.vendor).filter(Boolean))).sort();
}

export function filterChipsets(chipsets = [], query = '', vendor = 'all', recommendedOnly = false) {
  const needle = query.trim().toLowerCase();
  return chipsets.filter((chipset) => {
    const releases = chipset.sdk_releases || [];
    const haystack = [
		chipset.name, chipset.vendor, chipset.family, chipset.description,
		...(chipset.resources || []).flatMap((resource) => [resource.type, resource.title, resource.url, resource.summary, ...(resource.languages || [])]),
		...releases.flatMap((release) => [
			release.name, release.version, release.summary, ...(release.supported_models || []),
			...(release.endpoints || []).flatMap((endpoint) => [endpoint.type, endpoint.title, endpoint.url, endpoint.summary, ...(endpoint.languages || [])]),
		]),
    ].filter(Boolean).join(' ').toLowerCase();
    return (vendor === 'all' || chipset.vendor === vendor)
      && (!recommendedOnly || releases.some((release) => release.recommended))
      && (!needle || haystack.includes(needle));
  });
}

export function vendorInitials(chipset = {}) {
  const source = String(chipset.name || chipset.vendor || 'CS').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return source.slice(0, 3).toUpperCase() || 'CS';
}

export function compactHash(value = '') {
  const hash = String(value);
  return hash.length > 12 ? `${hash.slice(0, 8)}…` : hash || '—';
}

export function formatProviderTimestamp(value = '') {
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]} UTC` : value || '—';
}
