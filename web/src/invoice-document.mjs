import { FORMAT_LOCALE } from './i18n/index.mjs';

// Illustrative amounts only. Never submit this document to the billing API.
export const SAMPLE_INVOICE = {
  currency: 'TWD',
  recipient: { legal_name: 'Example Company', billing_address: 'Taipei, Taiwan (example)' },
  subtotal_minor: 1000,
  tax_minor: 50,
  total_minor: 1050,
  lines: [
    { id: 'sample-video', service_code: 'Video streaming', description: 'Example streaming usage', quantity: 300, unit: 'minutes', subtotal_minor: 600 },
    { id: 'sample-storage', service_code: 'Cloud storage', description: 'Example recording storage', quantity: 100, unit: 'GB-month', subtotal_minor: 300 },
    { id: 'sample-mqtt', service_code: 'Device messaging', description: 'Example message delivery', quantity: 100000, unit: 'messages', subtotal_minor: 100 },
  ],
};

export function invoiceQuantity(line) {
  if (line.quantity == null) return 'Not available';
  const quantity = Number(line.quantity) / (10 ** (line.quantity_scale || 0));
  if (!Number.isFinite(quantity)) return 'Not available';
  return new Intl.NumberFormat(FORMAT_LOCALE, { maximumFractionDigits: 10 }).format(quantity);
}
