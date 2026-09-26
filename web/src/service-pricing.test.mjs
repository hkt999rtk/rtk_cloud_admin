import test from 'node:test';
import assert from 'node:assert/strict';
import { pricingCurrency, servicePricing } from './service-pricing.mjs';

test('research references stay separate from approved but inactive OTA prices', () => {
  assert.equal(pricingCurrency, 'TWD');
  assert.deepEqual(Object.fromEntries(servicePricing.map(({ id, price }) => [id, price])), {
    'mqtt-publish': null,
    'mqtt-delivery': null,
    shadow: null,
    turn: null,
    storage: null,
    'object-write': null,
    'object-read': null,
    download: null,
    ota: 96,
    'ota-successful-download': 0.96,
    'ota-artifact-storage': 0.96,
    'ota-artifact-write': 144,
    'log-ingest': null,
    'log-retention': null,
    api: null,
  });
  assert.deepEqual(Object.fromEntries(servicePricing.map(({ id, referencePrice }) => [id, referencePrice])), {
    'mqtt-publish': 48,
    'mqtt-delivery': 48,
    shadow: 60,
    turn: 4.8,
    storage: 1.3,
    'object-write': 224,
    'object-read': 17.92,
    download: 4.8,
    ota: 144,
    'ota-successful-download': 3.84,
    'ota-artifact-storage': 1.3,
    'ota-artifact-write': 224,
    'log-ingest': 28.8,
    'log-retention': 1.31,
    api: 136,
  });
  assert.equal(servicePricing.filter(row => row.priceStatus === 'approved-pending').length, 4);
  assert.equal(servicePricing.filter(row => row.priceStatus === 'research').length, 11);
  assert.ok(servicePricing.filter(row => row.price !== null).every(row => row.referencePrice >= row.price));
  assert.equal(servicePricing.find(row => row.id === 'shadow').referenceUnit, '1 million AWS 1 KB operation units');
  assert.ok(servicePricing.every(row => row.source && row.benchmark && row.comparison));
  assert.match(servicePricing.find(row => row.id === 'object-read').rule, /OTA origin reads.*not customer read fees/);
});
