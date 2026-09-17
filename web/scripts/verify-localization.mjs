import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const locales = ['zh-TW', 'zh-CN'];
const here = new URL('.', import.meta.url);
const placeholderPattern = /{{\s*[-\w.]+\s*}}/g;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonBlankString = value => typeof value === 'string' && value.trim().length > 0;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonicalJSON = value => Array.isArray(value)
  ? value.map(canonicalJSON)
  : isObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJSON(value[key])]))
    : value;
const placeholders = text => typeof text === 'string'
  ? [...new Set(text.match(placeholderPattern) || [])].sort()
  : [];
const sameStrings = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
const sourceHash = entry => digest({
  key: entry.key,
  source: entry.source,
  context: entry.context || '',
  placeholders: [...entry.placeholders].sort(),
});
const fingerprint = (entry, locale, catalog) => digest({
  key: entry.key,
  sourceHash: sourceHash(entry),
  locale,
  policyVersion: catalog.policyVersion,
  glossaryHash: digest(canonicalJSON(catalog.glossary || {})),
});

async function readJSON(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, here), 'utf8'));
}

function requireExactKeys(actual, expected, label, errors) {
  const actualKeys = Object.keys(actual || {}).sort();
  const expectedKeys = [...expected].sort();
  if (!sameStrings(actualKeys, expectedKeys)) errors.push(`${label} keys do not match the English catalog`);
}

function validateCatalog(catalog, errors) {
  if (!isObject(catalog) || catalog.schemaVersion !== 1 || catalog.sourceLocale !== 'en' || !Number.isInteger(catalog.policyVersion) || catalog.policyVersion < 1 || !Array.isArray(catalog.strings) || (catalog.glossary !== undefined && !isObject(catalog.glossary))) {
    errors.push('catalog has an invalid header');
    return new Map();
  }
  const entries = new Map();
  for (const entry of catalog.strings) {
    if (!isObject(entry) || !isNonBlankString(entry.key) || !isNonBlankString(entry.source) || typeof entry.context !== 'string' || !Array.isArray(entry.placeholders) || entry.placeholders.some(value => !isNonBlankString(value)) || !sameStrings([...entry.placeholders].sort(), placeholders(entry.source))) {
      errors.push(`invalid English source entry ${entry?.key || '(unknown)'}`);
      continue;
    }
    if (entries.has(entry.key)) errors.push(`duplicate English source key ${entry.key}`);
    entries.set(entry.key, entry);
  }
  return entries;
}

async function main() {
  const errors = [];
  const catalog = await readJSON('../localization/catalog.json');
  const entries = validateCatalog(catalog, errors);
  const resources = await import(pathToFileURL(fileURLToPath(new URL('../src/i18n/resources.generated.mjs', here))).href);
  const runtime = { en: resources.en, 'zh-TW': resources.zhTW, 'zh-CN': resources.zhCN };
  const sourceKeys = [...entries.keys()];

  for (const [key, entry] of entries) {
    if (runtime.en?.translation?.[key] !== entry.source) errors.push(`generated English resource differs for ${key}`);
  }
  requireExactKeys(runtime.en?.translation, sourceKeys, 'generated English resource', errors);

  for (const locale of locales) {
    const translation = await readJSON(`../localization/translations/${locale}.json`);
    if (!isObject(translation) || translation.schemaVersion !== 1 || translation.locale !== locale || !isObject(translation.entries)) {
      errors.push(`${locale} translation artifact has an invalid header`);
      continue;
    }
    requireExactKeys(translation.entries, sourceKeys, `${locale} translation artifact`, errors);
    for (const [key, entry] of entries) {
      const value = translation.entries[key];
      if (!isObject(value) || value.status !== 'approved' || !isNonBlankString(value.text) || value.sourceHash !== sourceHash(entry) || value.fingerprint !== fingerprint(entry, locale, catalog) || !sameStrings(placeholders(value.text), placeholders(entry.source))) {
        errors.push(`${locale} translation artifact is invalid for ${key}`);
        continue;
      }
      if (runtime[locale]?.translation?.[key] !== value.text) errors.push(`generated ${locale} resource differs for ${key}`);
    }
    requireExactKeys(runtime[locale]?.translation, sourceKeys, `generated ${locale} resource`, errors);
  }

  if (errors.length) throw new Error(`Localization validation failed:\n${errors.join('\n')}`);
  console.log(`Validated ${entries.size} approved Admin strings for ${locales.join(', ')}.`);
}

await main();
