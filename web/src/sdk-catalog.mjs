const FORMATS = Object.freeze({
  native: 'Static-library archive',
  android: 'Android AAR package',
  javascript: 'npm-compatible tarball',
  ios: 'SwiftPM source archive',
  'freertos-pro2': 'Device-demo source bundle',
  all: 'Complete release bundle',
});

export function sdkArtifactFormat(slug) {
  return FORMATS[slug] || 'SDK package';
}

export function formatSDKBytes(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value < 0) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = value;
  for (const unit of units) {
    amount /= 1024;
    if (amount < 1024 || unit === 'GB') return `${amount.toFixed(1)} ${unit}`;
  }
  return `${value} B`;
}

export function sdkArtifacts(catalog) {
  if (!catalog) return [];
  return [...(catalog.packages || []), ...(catalog.complete_bundle ? [catalog.complete_bundle] : [])];
}

export function sdkDocumentationURL(portalURL, slug) {
  const root = String(portalURL || '').replace(/\/$/, '');
  if (!root) return '';
  return slug === 'all' ? root : `${root}/packages/${encodeURIComponent(slug)}`;
}
