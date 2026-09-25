import { translate } from './i18n/index.mjs';
import React, { useState } from 'react';
import { pricingCurrency, pricingGroups, pricingProposalDate, pricingSources, servicePricing } from './service-pricing.mjs';
import './service-pricing.css';

export function BillingTabs({ active, onSelect }) {
  return <nav className="billing-tabs" aria-label={translate("Billing Pages")}>
    {[{ id: 'overview', label: 'Billing Overview' }, { id: 'pricing', label: 'Service Pricing' }, { id: 'usage', label: 'Usage and Forecast' }, { id: 'invoices', label: 'Invoices' }, { id: 'activity', label: 'Billing Activity' }, { id: 'settings', label: 'Payments and Automatic Top-Up' }, { id: 'profile', label: 'Billing Profile' }].map(({ id, label }) => <button key={id} type="button" className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>{translate(label)}</button>)}
  </nav>;
}

export function ServicePricing({ tabs }) {
  const [group, setGroup] = useState('All services');
  const examplePublish = servicePricing.find(row => row.id === 'mqtt-publish').price;
  const exampleDelivery = servicePricing.find(row => row.id === 'mqtt-delivery').price * 5;
  const exampleShadow = servicePricing.find(row => row.id === 'shadow').price;
  const rows = servicePricing.filter(row => group === 'All services' || row.group === group);
  return <section className="page-content billing-page service-pricing-page" data-testid="billing-pricing-page">
    <div className="page-intro"><div><p className="eyebrow">{translate("Realtek Managed Cloud")}</p><h2>{translate("Service pricing")}</h2><p>{translate("Explore proposed rates for messaging, device state, video and cloud operations.")}</p></div><span className="pricing-draft">{translate("TWD pricing proposal · 24 Sep 2026")}</span></div>
    {tabs}
    <section className="pricing-cost-summary" aria-labelledby="pricing-cost-heading">
      <div className="pricing-cost-total"><p className="eyebrow">{translate("Example monthly total")}</p><h3 id="pricing-cost-heading">{translate("Your cost at a glance")}</h3><strong className="pricing-cost-value">{translate("NT$")}{(examplePublish + exampleDelivery + exampleShadow).toLocaleString('en-US')}</strong><span>{translate("TWD / month · before tax")}</span><p>{translate("Illustrative estimate for the usage shown. This is not your Cloud’s actual spend or an invoice.")}</p></div>
      <div className="pricing-cost-breakdown"><h4>{translate("Usage behind this estimate")}</h4><dl><div><dt>{translate("1 million MQTT publishes")}</dt><dd>{translate("NT$")}{examplePublish}</dd></div><div><dt>{translate("5 million MQTT deliveries")}</dt><dd>{translate("NT$")}{exampleDelivery}</dd></div><div><dt>{translate("1 million Shadow units over HTTP")}</dt><dd>{translate("NT$")}{exampleShadow}</dd></div></dl><p>{translate("Includes these three usage items. Video, storage and other services are additional when used.")}</p></div>
    </section>
    <section className="pricing-intro" aria-label={translate("Service rates and billing basis")}>
      <div><h3>{translate("Service rates & billing basis")}</h3><p>{translate("Explore the unit prices and counting rules below. These TWD rates are proposals for review, before tax.")}</p></div>
      <dl><div><dt>{translate("Currency")}</dt><dd>{pricingCurrency} {translate("· NT$")}</dd></div><div><dt>{translate("Basis")}</dt><dd>{translate("Monthly usage")}</dd></div><div><dt>{translate("Proposal date")}</dt><dd><time dateTime={pricingProposalDate}>{translate("24 Sep 2026")}</time></dd></div></dl>
    </section>
    <div className="pricing-filter" role="group" aria-label={translate("Filter service prices")}>{pricingGroups.map(item => <button type="button" key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{translate(item)}<span>{item === 'All services' ? servicePricing.length : servicePricing.filter(row => row.group === item).length}</span></button>)}</div>
    <div className="pricing-table-wrap"><table className="pricing-table">
      <caption>{translate(group)} · {rows.length} {translate("proposed rates")}</caption>
      <thead><tr><th scope="col">{translate("Service")}</th><th scope="col">{translate("Proposed price")}</th><th scope="col">{translate("How usage is counted")}</th><th scope="col">{translate("Public price reference")}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row"><strong>{translate(row.name)}</strong><p>{translate(row.description)}</p><span className={`pricing-readiness ${row.readiness === 'Metering pending' ? 'pending' : ''}`}>{translate(row.readiness)}</span></th>
        <td data-label={translate("Proposed price")} className="pricing-rate"><strong>{translate("NT$")}{row.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong><span>/ {translate(row.unit)}</span></td>
        <td data-label={translate("How usage is counted")}>{translate(row.rule)}</td>
        <td data-label={translate("Public price reference")}><a href={pricingSources[row.source].url} target="_blank" rel="noopener noreferrer">{pricingSources[row.source].name} ↗</a><strong>{translate(row.benchmark)}</strong><p>{translate(row.comparison)}</p></td>
      </tr>)}</tbody>
    </table></div>
    <section className="panel pricing-included"><p className="eyebrow">{translate("Included in the proposal")}</p><h3>{translate("Start without a platform fee")}</h3><p>{translate("Cloud and product setup, team access, device enrollment, MQTT connections and keep-alives, SDK documentation and console administration carry no separate fee.")}</p><p>{translate("WebRTC signaling has no extra channel or signaling surcharge. Its MQTT messages follow the MQTT rates; direct P2P media has no cloud transfer fee.")}</p></section>
    <section className="panel pricing-methodology"><h3>{translate("How to read this rate card")}</h3><ul>
      <li>{translate("All rows are proposals. An existing usage meter does not mean charging is enabled. Items marked “Metering pending” need validated measurement before billing.")}</li>
      <li>{translate("Per-million and per-thousand prices are display units. Proposed charges are proportional to actual usage, not rounded up to whole million-request blocks. Monetary rounding is applied after monthly aggregation.")}</li>
      <li>{translate("RTK storage and traffic use GiB (1,073,741,824 bytes); Shadow uses KiB (1,024 bytes). Provider GB/KB units are retained as published and may differ.")}</li>
      <li>{translate("Public benchmarks retain their source currency, usually USD. RTK's proposed customer rates are in TWD and are not provider invoices. The planning conversion is fixed at US$1 = NT$32; no exchange conversion occurs when invoicing.")}</li>
      <li>{translate("No free usage allowance or volume discount is assumed. Shared hosting costs, support, retention and measured operating margins must be reviewed before a production rate is approved. Private Cloud requires a separate quote.")}</li>
    </ul><details><summary>{translate("Research sources")}</summary><div className="pricing-source-links">{Object.values(pricingSources).map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>)}</div></details></section>
  </section>;
}
