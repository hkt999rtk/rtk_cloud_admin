import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceQuantity, SAMPLE_INVOICE } from './invoice-document.mjs';

test('sample invoice balances at 5 percent tax without an issued identity or payment document', () => {
  assert.equal(SAMPLE_INVOICE.currency, 'TWD');
  assert.equal(SAMPLE_INVOICE.lines.reduce((sum, line) => sum + line.subtotal_minor, 0), SAMPLE_INVOICE.subtotal_minor);
  assert.equal(SAMPLE_INVOICE.tax_minor, SAMPLE_INVOICE.subtotal_minor * .05);
  assert.equal(SAMPLE_INVOICE.total_minor, SAMPLE_INVOICE.subtotal_minor + SAMPLE_INVOICE.tax_minor);
  assert.equal(SAMPLE_INVOICE.id, undefined);
  assert.equal(SAMPLE_INVOICE.document, undefined);
  assert.equal(SAMPLE_INVOICE.invoice_number, undefined);
});

test('invoice usage respects the stored quantity scale and missing data', () => {
  assert.equal(invoiceQuantity({ quantity: 125, quantity_scale: 2 }), '1.25');
  assert.equal(invoiceQuantity({ quantity: 100000 }), '100,000');
  assert.equal(invoiceQuantity({ quantity: 0, quantity_scale: 3 }), '0');
  assert.equal(invoiceQuantity({}), 'Not available');
  assert.equal(invoiceQuantity({ quantity: 'invalid' }), 'Not available');
});
