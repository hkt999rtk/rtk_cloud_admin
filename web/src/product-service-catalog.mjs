export const LEGACY_PRODUCT_SERVICE_CAPABILITIES = Object.freeze([
  { code: 'video_streaming', display_name: 'Live View', selectable: true },
  { code: 'video_storage', display_name: 'Recording and Storage', selectable: true },
  { code: 'mqtt', display_name: 'Device Telemetry', selectable: true },
]);

export function normalizeProductServiceCapability(value) {
  const aliases = {
    '即時觀看': 'video_streaming',
    '影像服務': 'video_streaming',
    '錄影與保存': 'video_storage',
    '設備回報': 'mqtt',
    '韌體更新': 'ota',
  };
  return aliases[value] || value;
}

export function productServiceCapabilityLabel(value, catalog) {
  const code = normalizeProductServiceCapability(value);
  return catalog?.options?.find((item) => item.code === code)?.display_name
    || LEGACY_PRODUCT_SERVICE_CAPABILITIES.find((item) => item.code === code)?.display_name
    || (code === 'ota' ? 'Firmware OTA' : code);
}

export function productServiceChoices(catalog, selected = []) {
  if (!catalog) return [];
  const available = catalog.product_writes_enabled ? catalog.options : LEGACY_PRODUCT_SERVICE_CAPABILITIES;
  return [
    ...available,
    ...selected.filter((code) => !available.some((option) => option.code === code))
      .map((code) => ({ code, display_name: productServiceCapabilityLabel(code, catalog), selectable: false, unavailable_reason: catalog.options.some((option) => option.code === code) ? 'product_writes_disabled' : 'not_registered' })),
  ];
}

export function productServiceWritePayload(form, editingProduct, catalog) {
  const payload = { name: form.name, product_model: form.product_model, category: form.category };
  const selected = [...new Set(form.service_capabilities.map(normalizeProductServiceCapability))];
  const original = (form.original_services || []).map(normalizeProductServiceCapability);
  const changed = !editingProduct || selected.length !== original.length
    || selected.some((code) => !original.includes(code));
  if (changed) {
    payload.service_capabilities = selected;
    if (catalog?.product_writes_enabled) payload.catalog_revision = catalog.catalog_revision;
  }
  return payload;
}
