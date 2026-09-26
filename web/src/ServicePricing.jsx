import { translate } from './i18n/index.mjs';
import React, { useState } from 'react';
import { pricingCurrency, pricingGroups, pricingReferenceDate, pricingSources, servicePricing } from './service-pricing.mjs';
import './service-pricing.css';

const formatPrice = amount => `${translate('NT$')}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export function BillingTabs({ active, onSelect }) {
  return <nav className="billing-tabs" aria-label={translate('Billing Pages')}>
    {[{ id: 'overview', label: 'Billing Overview' }, { id: 'pricing', label: 'Service Pricing' }, { id: 'usage', label: 'Usage and Forecast' }, { id: 'invoices', label: 'Invoices' }, { id: 'activity', label: 'Billing Activity' }, { id: 'settings', label: 'Payments and Automatic Top-Up' }, { id: 'profile', label: 'Billing Profile' }].map(({ id, label }) => <button key={id} type="button" className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>{translate(label)}</button>)}
  </nav>;
}

export function ServicePricing({ tabs }) {
  const [group, setGroup] = useState('All services');
  const rows = servicePricing.filter(row => group === 'All services' || row.group === group);
  return <section className="page-content billing-page service-pricing-page" data-testid="billing-pricing-page">
    <div className="page-intro"><div><p className="eyebrow">{translate('Realtek Managed Cloud')}</p><h2>{translate('Service pricing')}</h2><p>{translate('Compare approved OTA unit prices with the highest public research references for all services.')}</p></div><span className="pricing-draft">{translate('Reference review · 26 Sep 2026')}</span></div>
    {tabs}
    <section className="pricing-status-summary" aria-label={translate('Price status')}>
      <div><strong>4</strong><h3>{translate('OTA prices approved')}</h3><p>{translate('The four OTA customer unit prices are approved but have no effective date yet. OTA is not charged at these prices until an active Billing rate card includes them.')}</p></div>
      <div><strong>11</strong><h3>{translate('Services with reference prices only')}</h3><p>{translate('The other 11 services have no newly approved RTK price in this review. All 15 rows show a separate highest eligible public reference. Existing customer charges follow the active rate card, contract and invoice.')}</p></div>
    </section>
    <section className="pricing-intro" aria-label={translate('Service rates and billing basis')}>
      <div><h3>{translate('How these prices work')}</h3><p>{translate('This page does not verify your Cloud’s effective Billing rates. Your contract, active rate card and invoice determine actual charges; these references are not an invoice or spend forecast.')}</p><p>{translate('Monthly subtotal = measured usage × unit price ÷ the displayed unit size. Usage is aggregated by service and meter before the TWD amount is rounded; tax is handled by the effective Billing plan.')}</p></div>
      <dl><div><dt>{translate('Currency')}</dt><dd>{pricingCurrency} {translate('· NT$')}</dd></div><div><dt>{translate('Basis')}</dt><dd>{translate('Monthly usage')}</dd></div><div><dt>{translate('Reference checked')}</dt><dd><time dateTime={pricingReferenceDate}>{translate('26 Sep 2026')}</time></dd></div></dl>
    </section>
    <div className="pricing-filter" role="group" aria-label={translate('Filter service prices')}>{pricingGroups.map(item => <button type="button" key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{translate(item)}<span>{item === 'All services' ? servicePricing.length : servicePricing.filter(row => row.group === item).length}</span></button>)}</div>
    <div className="pricing-table-wrap"><table className="pricing-table">
      <caption>{translate(group)} · {rows.length} {translate('service meters')}</caption>
      <thead><tr><th scope="col">{translate('Service')}</th><th scope="col">{translate('RTK price status')}</th><th scope="col">{translate('How usage is counted')}</th><th scope="col">{translate('Highest public reference')}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} data-price-status={row.priceStatus}>
        <th scope="row"><strong>{translate(row.name)}</strong><p>{translate(row.description)}</p><span className={`pricing-readiness ${row.readiness === 'Metering pending' ? 'pending' : ''}`}>{translate(row.readiness)}</span></th>
        <td data-label={translate('RTK price status')} className="pricing-rate">{row.priceStatus === 'approved-pending' ? <><span className="pricing-price-status approved-pending">{translate('Approved OTA price · not effective')}</span><strong>{formatPrice(row.price)}</strong><span>/ {translate(row.unit)}</span></> : <><span className="pricing-price-status research">{translate('Research reference only')}</span><p>{translate('Your effective customer rate is not verified on this page. Check your active rate card, contract or invoice.')}</p></>}</td>
        <td data-label={translate('How usage is counted')}>{translate(row.rule)}</td>
        <td data-label={translate('Highest public reference')} className="pricing-reference"><strong>{formatPrice(row.referencePrice)} / {translate(row.referenceUnit || row.unit)}</strong><a href={pricingSources[row.source].url} target="_blank" rel="noopener noreferrer">{pricingSources[row.source].name} ↗</a><span>{translate(row.benchmark)}</span><p>{translate(row.comparison)}</p></td>
      </tr>)}</tbody>
    </table></div>
    <section className="panel pricing-included"><p className="eyebrow">{translate('No separate service charge')}</p><h3>{translate('Included activities')}</h3><p>{translate('Cloud and product setup, team access, device enrollment, MQTT connections and keep-alives, SDK documentation and console administration carry no separate fee.')}</p><p>{translate('WebRTC signaling has no extra channel or signaling surcharge. Its MQTT messages follow the MQTT rates; direct P2P media has no cloud transfer fee.')}</p></section>
    <section className="panel pricing-methodology"><h3>{translate('How to read this rate card')}</h3><ul>
      <li>{translate('Research references are not approved customer charges. OTA has four approved unit prices, but they are not effective yet. An existing meter does not mean charging is enabled.')}</li>
      <li>{translate('Per-million and per-thousand prices are display units. Charges, when effective, are proportional to actual usage; there is no whole-block minimum. Money is rounded after monthly aggregation.')}</li>
      <li>{translate('RTK storage and traffic use GiB (1,073,741,824 bytes); Shadow uses KiB (1,024 bytes). Provider byte units and counted events may differ, as noted in each row.')}</li>
      <li>{translate('The public benchmarks use native USD prices. Planning references use US$1 = NT$32 and round up to NT$0.01; no exchange conversion occurs when a TWD invoice is issued.')}</li>
      <li>{translate('No free usage allowance or volume discount is assumed in these references. Tax, validated metering, operating costs and margin require review before any new production rate is activated. Private Cloud requires a separate quote.')}</li>
    </ul><details><summary>{translate('Research sources')}</summary><div className="pricing-source-links">{Object.values(pricingSources).map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>)}</div></details></section>
  </section>;
}
