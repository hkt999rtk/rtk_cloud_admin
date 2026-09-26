import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchServicePricing, mergeServicePricingCatalog, servicePricing } from './service-pricing.mjs';
import { resources } from './i18n/resources.generated.mjs';

const cloud = '11111111-1111-4111-8111-111111111111';
const catalog = JSON.parse(readFileSync(new URL('../../internal/app/service-pricing-reference.json', import.meta.url), 'utf8'));
const payload = { cloud_id: cloud, catalog };

test('price amounts and provider benchmarks stay out of public client data and translations', () => {
  assert.equal(servicePricing.length, 15);
  assert.ok(servicePricing.every(row => !('price' in row) && !('referencePrice' in row) && !('benchmark' in row)));
  for (const benchmark of new Set(catalog.rows.map(row => row.benchmark))) {
    for (const locale of Object.values(resources)) assert.ok(!(benchmark in locale.translation), `${benchmark} leaked into public ${locale} resources`);
  }
  assert.ok(catalog.rows.filter(row => row.price !== null).length === 4);
  assert.ok(catalog.rows.every(row => row.reference_price > 0));
});

test('owner-scoped catalog is complete and keeps approved OTA prices separate from research references', () => {
  const merged = mergeServicePricingCatalog(payload, cloud);
  assert.equal(merged.currency, 'TWD');
  assert.equal(merged.rows.length, 15);
  assert.deepEqual(merged.rows.filter(row => row.price !== null).map(row => row.id), [
    'ota', 'ota-successful-download', 'ota-artifact-storage', 'ota-artifact-write',
  ]);
  assert.equal(merged.rows.find(row => row.id === 'ota').price, 96);
  assert.equal(merged.rows.find(row => row.id === 'ota').referencePrice, 144);
  assert.equal(merged.rows.find(row => row.id === 'shadow').price, null);
  assert.equal(merged.rows.find(row => row.id === 'shadow').referencePrice, 60);
  assert.throws(() => mergeServicePricingCatalog({ ...payload, cloud_id: '33333333-3333-4333-8333-333333333333' }, cloud), /Invalid service pricing/);
  assert.throws(() => mergeServicePricingCatalog({ ...payload, catalog: { ...catalog, rows: catalog.rows.slice(1) } }, cloud), /Invalid service pricing/);
});

test('pricing fetch requires the current ownership version and fails closed on API errors', async () => {
  let options;
  const fetcher = async (url, request) => {
    assert.match(url, /\/billing\/pricing-references$/);
    options = request;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'X-Cloud-Ownership-Version': '7' } });
  };
  const result = await fetchServicePricing(cloud, '7', 'en', { fetcher });
  assert.equal(result.rows.length, 15);
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers['X-RTK-Locale'], 'en');
  await assert.rejects(fetchServicePricing(cloud, '8', 'en', { fetcher }), { status: 409 });
  await assert.rejects(fetchServicePricing(cloud, '7', 'en', { fetcher: async () => new Response('denied', { status: 403 }) }), { status: 403 });
});
