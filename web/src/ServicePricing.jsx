import React, { useState } from 'react';
import { pricingGroups, pricingResearchDate, pricingSources, servicePricing } from './service-pricing.mjs';
import './service-pricing.css';

export function BillingTabs({ active, onSelect }) {
  return <nav className="billing-tabs" aria-label="Billing Pages">
    {[['overview', 'Billing Overview'], ['pricing', 'Service Pricing'], ['usage', 'Usage and Forecast'], ['invoices', 'Invoices'], ['activity', 'Billing Activity'], ['settings', 'Payments and Automatic Top-Up'], ['profile', 'Billing Profile']].map(([id, label]) => <button key={id} type="button" className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>{label}</button>)}
  </nav>;
}

export function ServicePricing({ tabs }) {
  const [group, setGroup] = useState('All services');
  const examplePublish = servicePricing.find(row => row.id === 'mqtt-publish').price;
  const exampleDelivery = servicePricing.find(row => row.id === 'mqtt-delivery').price * 5;
  const exampleShadow = servicePricing.find(row => row.id === 'shadow').price;
  const rows = servicePricing.filter(row => group === 'All services' || row.group === group);
  return <section className="page-content billing-page service-pricing-page" data-testid="billing-pricing-page">
    <div className="page-intro"><div><p className="eyebrow">Realtek Managed Cloud</p><h2>Service pricing</h2><p>Explore proposed rates for messaging, device state, video and cloud operations.</p></div><span className="pricing-draft">Pricing proposal · v1</span></div>
    {tabs}
    <section className="pricing-cost-summary" aria-labelledby="pricing-cost-heading">
      <div className="pricing-cost-total"><p className="eyebrow">Example monthly total</p><h3 id="pricing-cost-heading">Your cost at a glance</h3><strong className="pricing-cost-value">US${(examplePublish + exampleDelivery + exampleShadow).toFixed(2)}</strong><span>USD / month · before tax</span><p>Illustrative estimate for the usage shown. This is not your Cloud’s actual spend or an invoice.</p></div>
      <div className="pricing-cost-breakdown"><h4>Usage behind this estimate</h4><dl><div><dt>1 million MQTT publishes</dt><dd>US${examplePublish.toFixed(2)}</dd></div><div><dt>5 million MQTT deliveries</dt><dd>US${exampleDelivery.toFixed(2)}</dd></div><div><dt>1 million Shadow units over HTTP</dt><dd>US${exampleShadow.toFixed(2)}</dd></div></dl><p>Includes these three usage items. Video, storage and other services are additional when used.</p></div>
    </section>
    <section className="pricing-intro" aria-label="Service rates and billing basis">
      <div><h3>Service rates &amp; billing basis</h3><p>Explore the unit prices and counting rules below. These USD rates are proposals for review, before tax.</p></div>
      <dl><div><dt>Currency</dt><dd>USD · US$</dd></div><div><dt>Basis</dt><dd>Monthly usage</dd></div><div><dt>Research date</dt><dd><time dateTime={pricingResearchDate}>6 Sep 2026</time></dd></div></dl>
    </section>
    <div className="pricing-filter" role="group" aria-label="Filter service prices">{pricingGroups.map(item => <button type="button" key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{item}<span>{item === 'All services' ? servicePricing.length : servicePricing.filter(row => row.group === item).length}</span></button>)}</div>
    <div className="pricing-table-wrap"><table className="pricing-table">
      <caption>{group} · {rows.length} proposed rates</caption>
      <thead><tr><th scope="col">Service</th><th scope="col">Proposed price</th><th scope="col">How usage is counted</th><th scope="col">Public price reference</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row"><strong>{row.name}</strong><p>{row.description}</p><span className={`pricing-readiness ${row.readiness === 'Metering pending' ? 'pending' : ''}`}>{row.readiness}</span></th>
        <td data-label="Proposed price" className="pricing-rate"><strong>US${row.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</strong><span>/ {row.unit}</span></td>
        <td data-label="How usage is counted">{row.rule}</td>
        <td data-label="Public price reference"><a href={pricingSources[row.source].url} target="_blank" rel="noopener noreferrer">{pricingSources[row.source].name} ↗</a><strong>{row.benchmark}</strong><p>{row.comparison}</p></td>
      </tr>)}</tbody>
    </table></div>
    <section className="panel pricing-included"><p className="eyebrow">Included in the proposal</p><h3>Start without a platform fee</h3><p>Cloud and product setup, team access, device enrollment, MQTT connections and keep-alives, SDK documentation and console administration carry no separate fee.</p><p>WebRTC signaling has no extra channel or signaling surcharge. Its MQTT messages follow the MQTT rates; direct P2P media has no cloud transfer fee.</p></section>
    <section className="panel pricing-methodology"><h3>How to read this rate card</h3><ul>
      <li>All rows are proposals. An existing usage meter does not mean charging is enabled. Items marked “Metering pending” need validated measurement before billing.</li>
      <li>Per-million and per-thousand prices are display units. Proposed charges are proportional to actual usage, not rounded up to whole million-request blocks. Monetary rounding is applied after monthly aggregation.</li>
      <li>RTK storage and traffic use GiB (1,073,741,824 bytes); Shadow uses KiB (1,024 bytes). Provider GB/KB units are retained as published and may differ.</li>
      <li>Public rates are regional examples before tax and discounts. All proposed rates are denominated in USD. RTK prices are independent proposals, not provider invoices.</li>
      <li>No free usage allowance or volume discount is assumed. Shared hosting costs, support, retention and measured operating margins must be reviewed before a production rate is approved. Private Cloud requires a separate quote.</li>
    </ul><details><summary>Research sources</summary><div className="pricing-source-links">{Object.values(pricingSources).map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>)}</div></details></section>
  </section>;
}
