import React from 'react';
import { formatMinorAmount } from './billing.mjs';
import { formatProviderTimestamp } from './chipset-sdk.mjs';
import { invoiceQuantity, SAMPLE_INVOICE } from './invoice-document.mjs';
import './billing-invoice.css';

export function BillingInvoiceDocument({ invoice = SAMPLE_INVOICE, preview = false }) {
  const money = (value) => value == null ? 'Not available' : formatMinorAmount(value, invoice.currency);
  const recipient = invoice.recipient || {};
  return <article className="billing-invoice-document" aria-label={preview ? 'Sample invoice' : 'Invoice document'} data-testid={preview ? 'invoice-preview' : 'invoice-document'}>
    {preview && <div className="invoice-sample-banner"><strong>Sample / Not issued</strong><span>Illustrative amounts only. Not a tax invoice or payment request. No charge is made by this preview.</span></div>}
    <header className="invoice-document-header">
      <div><p className="eyebrow">Cloud services / Billing</p><h3>Invoice</h3><p>{preview ? 'Format preview' : invoice.invoice_number}</p></div>
      <div className="invoice-document-amount"><span>{preview ? 'Example total' : 'Invoice total'} ({invoice.currency})</span><strong>{money(invoice.total_minor)}</strong><span>{preview ? 'Includes Taiwan tax (5%)' : 'Includes recorded tax'}</span></div>
    </header>
    <div className="invoice-document-meta">
      <section><h4>Bill to</h4><strong>{recipient.legal_name || 'Not provided'}</strong><p>Tax ID: {recipient.tax_identifier || (preview ? 'Your company tax ID' : 'Not provided')}</p><p>{recipient.billing_address || 'Address not provided'}</p>{recipient.contact_email && <p>{recipient.contact_email}</p>}</section>
      <dl><div><dt>Invoice number</dt><dd>{preview ? 'Not issued (sample)' : invoice.invoice_number}</dd></div><div><dt>Billing period</dt><dd>{preview ? 'Example monthly period' : `${formatProviderTimestamp(invoice.period_start)} - ${formatProviderTimestamp(invoice.period_end)}`}</dd></div><div><dt>Issue date</dt><dd>{preview ? 'Shown when issued' : formatProviderTimestamp(invoice.issued_at)}</dd></div><div><dt>Status</dt><dd>{preview ? 'Sample only' : invoice.state === 'settled' ? 'Paid' : invoice.state}</dd></div></dl>
    </div>
    <table className="invoice-document-lines">
      <caption>Service breakdown <span>Amounts in {invoice.currency}, before tax</span></caption>
      <thead><tr><th scope="col">Service / Description</th><th scope="col">Usage</th><th scope="col">Subtotal</th></tr></thead>
      <tbody>{(invoice.lines || []).map((line) => <tr key={line.id}><td><strong>{line.service_code}</strong><span>{line.description}</span></td><td>{invoiceQuantity(line)}<span>{line.unit}</span></td><td>{money(line.subtotal_minor)}</td></tr>)}</tbody>
    </table>
    {!invoice.lines?.length && <p className="notice">No line items are available for this invoice.</p>}
    <div className="invoice-document-summary">
      <div className="invoice-document-note"><h4>{preview ? 'About this preview' : 'About this invoice'}</h4><p>{preview ? 'Example quantities and prices demonstrate the layout, not your usage or current service rates. Taiwan tax is illustrated at 5% of the subtotal.' : 'Amounts and recipient details reflect the issued invoice snapshot. Updating your billing profile does not change this invoice.'}</p></div>
      <dl className="invoice-document-totals"><div><dt>Subtotal (before tax)</dt><dd>{money(invoice.subtotal_minor)}</dd></div><div><dt>{preview ? 'Taiwan tax (5%)' : 'Tax (as issued)'}</dt><dd>{money(invoice.tax_minor)}</dd></div><div className="invoice-document-grand-total"><dt>Total (incl. tax)</dt><dd>{money(invoice.total_minor)}</dd></div>{!preview && <><div><dt>Settled from balance</dt><dd>{money(invoice.amount_settled_minor)}</dd></div><div><dt>Amount due</dt><dd>{money(invoice.amount_due_minor)}</dd></div></>}</dl>
    </div>
    <footer className="invoice-document-footer">{preview ? 'Preview only. Issued invoices will appear here when available.' : invoice.state === 'settled' ? 'This invoice is settled from a prepaid balance; the payment-method top-up and invoice charge are separate accounting events.' : 'Payment-method top-ups and invoice charges are separate accounting events. Check Billing Activity for settlement progress.'}</footer>
  </article>;
}
