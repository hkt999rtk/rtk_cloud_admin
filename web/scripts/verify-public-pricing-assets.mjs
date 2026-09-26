import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isServerOnlyPricingSource } from '../localization/server-only-pricing.mjs';

const webRoot = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(resolve(webRoot, 'localization/catalog.json'), 'utf8'));
const locales = ['zh-TW', 'zh-CN'];
const translations = Object.fromEntries(await Promise.all(locales.map(async locale => [
  locale,
  JSON.parse(await readFile(resolve(webRoot, `localization/translations/${locale}.json`), 'utf8')),
])));
const protectedCopy = new Set();
for (const entry of catalog.strings.filter(entry => isServerOnlyPricingSource(entry.source))) {
  protectedCopy.add(entry.source);
  for (const locale of locales) protectedCopy.add(translations[locale].entries[entry.key].text);
}
const distDir = resolve(webRoot, 'dist');
const files = await readdir(distDir, { recursive: true });
const publicText = files.filter(name => /\.(?:js|json|html|css|map)$/.test(name));
if (!publicText.some(name => name.startsWith('assets/') && name.endsWith('.js')) || !protectedCopy.size) throw new Error('Public pricing asset audit has no scripts or protected copy');
if (files.some(name => name.endsWith('service-pricing-reference.json'))) throw new Error('Server-only pricing catalog copied to public dist');
for (const name of publicText) {
  const code = await readFile(resolve(distDir, name), 'utf8');
  for (const priceCopy of protectedCopy) {
    if (code.includes(priceCopy)) throw new Error(`Protected pricing copy found in public file ${name}`);
  }
}
console.log(`Verified ${publicText.length} public text assets omit ${protectedCopy.size} numeric pricing strings and server catalog.`);
