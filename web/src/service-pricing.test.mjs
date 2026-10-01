import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayEffectiveRate, effectiveRateLabel, fetchEffectivePricing, fetchServicePricing, mergeServicePricingCatalog, servicePricing, validateEffectivePricing, watchEffectivePricing } from './service-pricing.mjs';
import { resources } from './i18n/resources.generated.mjs';

const cloud = '11111111-1111-4111-8111-111111111111';
const catalog = JSON.parse(readFileSync(new URL('../../internal/app/service-pricing-reference.json', import.meta.url), 'utf8'));
const payload = { cloud_id: cloud, catalog };

test('effective rates use readable proportional units without changing the Billing price', () => {
  assert.deepEqual(displayEffectiveRate({ unit: 'requests', unit_price_minor: 48, unit_price_scale: 6 }), { amount: 48, unit: '1 million requests' });
  assert.deepEqual(displayEffectiveRate({ unit: 'requests', unit_price_minor: 1792, unit_price_scale: 8 }), { amount: 17.92, unit: '1 million requests' });
  assert.deepEqual(displayEffectiveRate({ unit: 'tasks', unit_price_minor: 96, unit_price_scale: 3 }), { amount: 96, unit: '1,000 device tasks' });
  assert.deepEqual(displayEffectiveRate({ unit: 'GiB', unit_price_minor: 96, unit_price_scale: 2 }), { amount: 0.96, unit: 'GiB' });
  assert.equal(effectiveRateLabel({ service_code: 'storage', metric_code: 'clip_object_read' }), 'Video object reads');
  assert.equal(effectiveRateLabel({ service_code: 'logger', metric_code: 'retained_gib_month' }), 'Log retention');
  assert.equal(effectiveRateLabel({ service_code: 'logger', metric_code: 'retention_gib_month' }), 'Log retention');
});

test('log retention explains UTC-month allocation and fixed thirty-day normalization in every locale', () => {
  const ingest = servicePricing.find(row => row.id === 'log-ingest');
  const retention = servicePricing.find(row => row.id === 'log-retention');
  assert.match(retention.rule, /within each UTC month \/ 30 days/);
  assert.match(retention.rule, /month boundary is split between months/);
  assert.match(retention.rule, /Rejected logs/);
  assert.match(ingest.rule, /Rejected logs are not charged/);
  for (const [locale, resource] of Object.entries(resources)) {
    assert.ok(resource.translation[ingest.rule], `missing log ingestion rule in ${locale}`);
    assert.ok(resource.translation[retention.rule], `missing retention rule in ${locale}`);
    assert.ok(resource.translation[retention.comparison], `missing retention comparison in ${locale}`);
    assert.ok(resource.translation['Log ingestion counts only accepted uncompressed bytes; rejected logs are not charged. Retention runs from acceptance to recorded expiry, split across UTC months and normalized by a fixed 30 days. Log charges for a month require frozen source records, Billing acknowledgments for every fact, and a verified monthly source seal. Missing evidence is not zero usage and prevents invoice close.'], `missing monthly Logger charging explanation in ${locale}`);
  }
});

test('effective pricing refreshes at a published boundary, UTC month turnover, and return to the page', () => {
  let now = Date.parse('2026-10-01T00:00:00Z');
  let timeout;
  let delay;
  let refreshes = 0;
  const listeners = new Map();
  const visibilityListeners = new Map();
  const browser = {
    Date: { now: () => now },
    setTimeout: (callback, millis) => { timeout = callback; delay = millis; return 1; },
    clearTimeout: id => { assert.equal(id, 1); timeout = null; },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    document: {
      visibilityState: 'visible',
      addEventListener: (name, callback) => visibilityListeners.set(name, callback),
      removeEventListener: name => visibilityListeners.delete(name),
    },
  };
  let dispose = watchEffectivePricing({ upcoming: { effective_from: '2026-10-02T00:00:00Z' } }, () => refreshes++, browser);
  assert.equal(delay, 24 * 60 * 60 * 1000 + 1);
  now += delay;
  timeout();
  assert.equal(refreshes, 1);
  browser.document.visibilityState = 'hidden';
  visibilityListeners.get('visibilitychange')();
  assert.equal(refreshes, 1);
  browser.document.visibilityState = 'visible';
  visibilityListeners.get('visibilitychange')();
  listeners.get('focus')();
  assert.equal(refreshes, 3);
  const removedCallback = listeners.get('focus');
  dispose();
  removedCallback();
  assert.equal(refreshes, 3);
  assert.equal(timeout, null);
  assert.equal(listeners.size, 0);
  assert.equal(visibilityListeners.size, 0);
  now = Date.parse('2026-10-31T23:59:58Z');
  dispose = watchEffectivePricing(null, () => refreshes++, browser);
  assert.equal(delay, 2001);
  now += delay;
  timeout();
  assert.equal(refreshes, 4);
  dispose();
  now = Date.parse('2026-10-01T00:00:00Z');
  dispose = watchEffectivePricing({ current: { effective_until: '2026-10-01T00:00:01Z' }, upcoming: { effective_from: '2026-10-02T00:00:00Z' } }, () => refreshes++, browser);
  assert.equal(delay, 1001);
  dispose();
  dispose = watchEffectivePricing(null, () => refreshes++, browser);
  assert.equal(delay, 2_147_483_647);
  dispose();
});

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
  assert.equal(merged.referenceDate, catalog.reference_date);
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
  assert.throws(() => mergeServicePricingCatalog({ ...payload, catalog: { ...catalog, reference_date: '2026-13-01' } }, cloud), /Invalid service pricing/);
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

test('effective price book is owner scoped and never inferred from reference prices', async () => {
  const book = { currency: 'TWD', as_of: '2026-11-05T12:00:00Z', ota_eligibility: 'provisional',
    current: { id: 'published', currency: 'TWD', effective_from: '2026-11-01T00:00:00Z',
      tax_mode: 'invoice_total', invoice_tax_rate_basis_points: 500, invoice_tax_rounding_mode: 'half_up',
      rates: [{ service_code: 'ota', metric_code: 'device_task', unit: 'tasks', description: 'Firmware OTA device tasks',
        unit_price_minor: 96, unit_price_scale: 3, rounding_mode: 'half_up' }] }, upcoming: null };
  const response = { cloud_id: cloud, price_book: book };
  assert.equal(validateEffectivePricing(response, cloud), book);
  assert.throws(() => validateEffectivePricing({ ...response, cloud_id: 'other' }, cloud), /Invalid service pricing/);
  assert.throws(() => validateEffectivePricing({ ...response, price_book: { ...book, current: null, ota_eligibility: 'active' } }, cloud), /Invalid service pricing/);
  assert.throws(() => validateEffectivePricing({ ...response, price_book: { ...book, current: { ...book.current, rates: [...book.current.rates, book.current.rates[0]] } } }, cloud), /Invalid service pricing/);
  const fetcher = async (url, options) => {
    assert.match(url, /\/billing\/pricing-effective$/);
    assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(response), { status: 200, headers: { 'X-Cloud-Ownership-Version': '7' } });
  };
  assert.equal((await fetchEffectivePricing(cloud, '7', { fetcher })).current.id, 'published');
  await assert.rejects(fetchEffectivePricing(cloud, '8', { fetcher }), { status: 409 });
  await assert.rejects(fetchEffectivePricing(cloud, '7', { fetcher: async () => new Response('unavailable', { status: 503 }) }), { status: 503 });
});
