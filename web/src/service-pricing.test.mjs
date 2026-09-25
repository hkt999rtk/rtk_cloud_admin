import test from 'node:test';
import assert from 'node:assert/strict';
import { pricingCurrency, servicePricing } from './service-pricing.mjs';

test('TWD proposal uses the reviewed fixed planning conversion', () => {
  assert.equal(pricingCurrency, 'TWD');
  assert.deepEqual(Object.fromEntries(servicePricing.map(({ id, price }) => [id, price])), {
    'mqtt-publish': 32,
    'mqtt-delivery': 32,
    shadow: 40,
    turn: 0.96,
    storage: 0.96,
    'object-write': 144,
    'object-read': 12.8,
    download: 0.96,
    ota: 96,
    'ota-successful-download': 0.96,
    'ota-artifact-storage': 0.96,
    'ota-artifact-write': 144,
    'log-ingest': 9.6,
    'log-retention': 0.96,
    api: 32,
  });
  assert.equal(servicePricing.find(row => row.id === 'mqtt-publish').price +
    5 * servicePricing.find(row => row.id === 'mqtt-delivery').price +
    servicePricing.find(row => row.id === 'shadow').price, 232);
  assert.equal(servicePricing.filter(row => row.id.startsWith('ota')).length, 4);
  assert.match(servicePricing.find(row => row.id === 'object-read').rule, /OTA origin reads.*not customer read fees/);
});
