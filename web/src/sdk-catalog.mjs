import { translate } from './i18n/index.mjs';

const FORMATS = Object.freeze({
  native: 'Static-library archive',
  android: 'Android AAR package',
  javascript: 'npm-compatible tarball',
  ios: 'SwiftPM source archive',
  'freertos-pro2': 'Device-demo source bundle',
  all: 'Complete release bundle',
});

export function sdkArtifactFormat(slug) {
  return translate(FORMATS[slug] || 'SDK package');
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

export function localizedSDKPortalURL(portalURL, locale = 'en') {
  const root = String(portalURL || '').replace(/\/$/, '');
  const prefix = { 'zh-TW': '/zh-tw', 'zh-CN': '/zh-cn' }[locale] || '';
  if (!root || !prefix) return root;
  const url = new URL(root);
  if (!url.pathname.startsWith(`${prefix}/`)) url.pathname = `${prefix}${url.pathname}`;
  return url.toString();
}

export function sdkDocumentationURL(portalURL, slug, locale = 'en') {
  const root = localizedSDKPortalURL(portalURL, locale);
  if (!root) return '';
  return slug === 'all' ? root : `${root}/packages/${encodeURIComponent(slug)}`;
}

export function sdkDownloadURL(portalURL, locale = 'en') {
  const root = localizedSDKPortalURL(portalURL, locale);
  return root ? `${root}#downloads` : '';
}
