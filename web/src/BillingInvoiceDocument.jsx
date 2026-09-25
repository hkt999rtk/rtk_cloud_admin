import { translate } from './i18n/index.mjs';
import React from 'react';
import { billingStatusLabel, formatMinorAmount } from './billing.mjs';
import { formatProviderTimestamp } from './chipset-sdk.mjs';
import { invoiceQuantity, SAMPLE_INVOICE } from './invoice-document.mjs';
import './billing-invoice.css';

export function BillingInvoiceDocument({ invoice = SAMPLE_INVOICE, preview = false }) {
  const money = (value) => value == null ? translate('Not available') : formatMinorAmount(value, invoice.currency);
  const recipient = invoice.recipient || {};
  return <article className="billing-invoice-document" aria-label={preview ? translate('Sample invoice') : translate('Invoice document')} data-testid={preview ? 'invoice-preview' : 'invoice-document'}>
    {preview && <div className="invoice-sample-banner"><strong>{translate("Sample / Not issued")}</strong><span>{translate("Illustrative amounts only. Not a tax invoice or payment request. No charge is made by this preview.")}</span></div>}
    <header className="invoice-document-header">
      <div><p className="eyebrow">{translate("Cloud services / Billing")}</p><h3>{translate("Invoice")}</h3><p>{preview ? translate("Format preview") : invoice.invoice_number}</p></div>
      <div className="invoice-document-amount"><span>{preview ? translate("Example total before tax") : translate("Invoice total")} ({invoice.currency})</span><strong>{money(invoice.total_minor)}</strong><span>{preview ? translate("Tax is calculated only when invoiced") : translate("Includes recorded tax")}</span></div>
    </header>
    <div className="invoice-document-meta">
      <section><h4>{translate("Bill to")}</h4><strong>{recipient.legal_name || translate("Not provided")}</strong><p>{translate("Tax ID:")} {recipient.tax_identifier || (preview ? translate("Your company tax ID") : translate("Not provided"))}</p><p>{recipient.billing_address || translate("Address not provided")}</p>{recipient.contact_email && <p>{recipient.contact_email}</p>}</section>
      <dl><div><dt>{translate("Invoice number")}</dt><dd>{preview ? translate("Not issued (sample)") : invoice.invoice_number}</dd></div><div><dt>{translate("Billing period")}</dt><dd>{preview ? translate("Example monthly period") : `${formatProviderTimestamp(invoice.period_start)} - ${formatProviderTimestamp(invoice.period_end)}`}</dd></div><div><dt>{translate("Issue date")}</dt><dd>{preview ? translate("Shown when issued") : formatProviderTimestamp(invoice.issued_at)}</dd></div><div><dt>{translate("Status")}</dt><dd>{preview ? translate("Sample only") : billingStatusLabel(invoice.state)}</dd></div></dl>
    </div>
    <table className="invoice-document-lines">
      <caption>{translate("Service breakdown")} <span>{translate("Amounts in")} {invoice.currency}{translate(", before tax")}</span></caption>
      <thead><tr><th scope="col">{translate("Service / Description")}</th><th scope="col">{translate("Usage")}</th><th scope="col">{translate("Subtotal")}</th></tr></thead>
      <tbody>{(invoice.lines || []).map((line) => <tr key={line.id}><td><strong>{line.service_code}</strong><span>{translate(line.description)}</span>{line.product_id && <span>{translate("Product:")} {line.product_id}</span>}</td><td>{invoiceQuantity(line)}<span>{translate(line.unit)}</span></td><td>{money(line.subtotal_minor)}</td></tr>)}</tbody>
    </table>
    {!invoice.lines?.length && <p className="notice">{translate("No line items are available for this invoice.")}</p>}
    <div className="invoice-document-summary">
      <div className="invoice-document-note"><h4>{preview ? translate("About this preview") : translate("About this invoice")}</h4><p>{preview ? translate("Example quantities and prices demonstrate the layout, not your usage or current service rates. Tax is not calculated in this preview.") : translate("Amounts and recipient details reflect the issued invoice snapshot. Updating your billing profile does not change this invoice.")}</p></div>
      <dl className="invoice-document-totals"><div><dt>{translate("Subtotal (before tax)")}</dt><dd>{money(invoice.subtotal_minor)}</dd></div>{!preview && <div><dt>{translate("Tax (as issued)")}</dt><dd>{money(invoice.tax_minor)}</dd></div>}<div className="invoice-document-grand-total"><dt>{preview ? translate("Example total before tax") : translate("Total (incl. tax)")}</dt><dd>{money(invoice.total_minor)}</dd></div>{!preview && <><div><dt>{translate("Settled from balance")}</dt><dd>{money(invoice.amount_settled_minor)}</dd></div><div><dt>{translate("Amount due")}</dt><dd>{money(invoice.amount_due_minor)}</dd></div></>}</dl>
    </div>
    <footer className="invoice-document-footer">{preview ? translate("Preview only. Issued invoices will appear here when available.") : invoice.state === 'settled' ? translate("This invoice is settled from a prepaid balance; the payment-method top-up and invoice charge are separate accounting events.") : translate("Payment-method top-ups and invoice charges are separate accounting events. Check Billing Activity for settlement progress.")}</footer>
  </article>;
}
