import { developerDocsVersions } from './developer-docs-version.generated.mjs';

const cacheLifetime = 24 * 60 * 60 * 1000;
const catalogs = new Map();
const pending = new Map();

export function peekDeveloperDocsCatalog(locale) {
  return catalogs.get(locale)?.value || null;
}

export function loadDeveloperDocsCatalog(locale, fetcher = fetch, now = Date.now()) {
  const version = developerDocsVersions[locale];
  if (!version) return Promise.reject(new Error('Unsupported documentation language.'));
  const cached = catalogs.get(locale);
  if (cached && now - cached.at < cacheLifetime) return Promise.resolve(cached.value);
  if (pending.has(locale)) return pending.get(locale);
  const request = fetcher(`/assets/developer-docs/index.${locale}.json?v=${version}`)
    .then((response) => {
      if (!response.ok) throw new Error('Documents are temporarily unavailable. Please reload the page.');
      return response.json();
    })
    .then((catalog) => {
      catalogs.set(locale, { value: catalog, at: now });
      return catalog;
    })
    .finally(() => { pending.delete(locale); });
  pending.set(locale, request);
  return request;
}
