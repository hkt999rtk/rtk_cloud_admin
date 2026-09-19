import assert from 'node:assert/strict';
import test from 'node:test';
import { productServiceCapabilityLabel, productServiceChoices, productServiceWritePayload } from './product-service-catalog.mjs';

const catalog = {
  catalog_revision: 7,
  product_writes_enabled: true,
  options: [
    { code: 'mqtt', display_name: 'MQTT', selectable: true },
    { code: 'iot_shadow', display_name: 'IoT Shadow', selectable: true, requires: ['mqtt'] },
  ],
};

test('registered service choices include plugin codes and preserve unavailable existing grants', () => {
  const choices = productServiceChoices(catalog, ['mqtt', 'custom_retired']);
  assert.deepEqual(choices.map((option) => option.code), ['mqtt', 'iot_shadow', 'custom_retired']);
  assert.equal(choices[2].selectable, false);
  assert.equal(productServiceCapabilityLabel('iot_shadow', catalog), 'IoT Shadow');
});

test('new Product sends observed catalog revision and exact plugin codes', () => {
  const payload = productServiceWritePayload({ name: 'Sensor', product_model: 'R1', category: 'mqtt_device', service_capabilities: ['mqtt', 'iot_shadow'] }, null, catalog);
  assert.deepEqual(payload.service_capabilities, ['mqtt', 'iot_shadow']);
  assert.equal(payload.catalog_revision, 7);
});

test('metadata-only Product edit does not rewrite grants when a plugin is unavailable', () => {
  const form = { name: 'Renamed', product_model: 'R1', category: 'mqtt_device', service_capabilities: ['mqtt', 'custom_retired'], original_services: ['custom_retired', 'mqtt'] };
  for (const currentCatalog of [catalog, null]) {
    const payload = productServiceWritePayload(form, { id: 'p1' }, currentCatalog);
    assert.equal(payload.service_capabilities, undefined);
    assert.equal(payload.catalog_revision, undefined);
  }
});

test('legacy write gate keeps legacy options and omits catalog revision', () => {
  const legacy = { ...catalog, product_writes_enabled: false };
  assert.deepEqual(productServiceChoices(legacy).map((option) => option.code), ['video_streaming', 'video_storage', 'mqtt']);
  const payload = productServiceWritePayload({ name: 'Sensor', product_model: 'R1', category: 'mqtt_device', service_capabilities: ['mqtt'] }, null, legacy);
  assert.equal(payload.catalog_revision, undefined);
});
