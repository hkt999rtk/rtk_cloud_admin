import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonicalJSON = value => Array.isArray(value)
  ? value.map(canonicalJSON)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJSON(value[key])]))
    : value;

export const placeholders = text => [...new Set(String(text).match(/{{\s*[-\w.]+\s*}}/g) || [])].sort();

export function sourceHash(entry) {
  return digest({
    key: entry.key,
    source: entry.source,
    context: entry.context || '',
    placeholders: [...entry.placeholders].sort(),
  });
}

export function fingerprint(entry, locale, catalog) {
  return digest({
    key: entry.key,
    sourceHash: sourceHash(entry),
    locale,
    policyVersion: catalog.policyVersion,
    glossaryHash: digest(canonicalJSON(catalog.glossary || {})),
  });
}
