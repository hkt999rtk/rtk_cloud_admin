import assert from 'node:assert/strict';
import test from 'node:test';
import { productServiceAvailability, productServiceCapabilityLabel, productServiceChoices, productServiceWritePayload } from './product-service-catalog.mjs';

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
  assert.equal(productServiceAvailability({ selectable: false, unavailable_reason: 'service_unavailable' }), 'Service not ready');
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

test('Logger retention is sent only when the registered option is selected', () => {
  const withLogger = { ...catalog, options: [...catalog.options, { code: 'device_logging', display_name: 'Device Logs', selectable: true, requires: ['mqtt'] }] };
  const form = { name: 'Sensor', product_model: 'R1', category: 'mqtt_device', service_capabilities: ['mqtt', 'device_logging'], log_retention_days: 90 };
  assert.equal(productServiceWritePayload(form, null, withLogger).log_retention_days, 90);
  assert.equal(productServiceWritePayload({ ...form, service_capabilities: ['mqtt'] }, null, withLogger).log_retention_days, undefined);
  assert.equal(productServiceWritePayload({ ...form, log_retention_days: undefined }, null, withLogger).log_retention_days, 7);
});
