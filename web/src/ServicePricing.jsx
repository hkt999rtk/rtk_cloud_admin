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
  const rows = servicePricing.filter(row => group === 'All services' || row.group === group);
  return <section className="page-content billing-page service-pricing-page" data-testid="billing-pricing-page">
    <div className="page-intro"><div><p className="eyebrow">Realtek Managed Cloud</p><h2>Service pricing</h2><p>Explore proposed rates for messaging, device state, video and cloud operations.</p></div><span className="pricing-draft">Pricing proposal · v1</span></div>
    {tabs}
    <section className="pricing-intro" aria-label="Pricing proposal terms">
      <div><h3>Pay for the services you use.</h3><p>Proposed prices in New Taiwan dollars, before tax. This rate card is for review and is not an active billing plan.</p></div>
      <dl><div><dt>Currency</dt><dd>TWD · NT$</dd></div><div><dt>Basis</dt><dd>Monthly usage</dd></div><div><dt>Research date</dt><dd><time dateTime={pricingResearchDate}>6 Sep 2026</time></dd></div></dl>
    </section>
    <div className="pricing-filter" role="group" aria-label="Filter service prices">{pricingGroups.map(item => <button type="button" key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{item}<span>{item === 'All services' ? servicePricing.length : servicePricing.filter(row => row.group === item).length}</span></button>)}</div>
    <div className="pricing-table-wrap"><table className="pricing-table">
      <caption>{group} · {rows.length} proposed rates</caption>
      <thead><tr><th scope="col">Service</th><th scope="col">Proposed price</th><th scope="col">How usage is counted</th><th scope="col">Public price reference</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row"><strong>{row.name}</strong><p>{row.description}</p><span className={`pricing-readiness ${row.readiness === 'Metering pending' ? 'pending' : ''}`}>{row.readiness}</span></th>
        <td data-label="Proposed price" className="pricing-rate"><strong>NT${row.price.toLocaleString('en-US')}</strong><span>/ {row.unit}</span></td>
        <td data-label="How usage is counted">{row.rule}</td>
        <td data-label="Public price reference"><a href={pricingSources[row.source].url} target="_blank" rel="noopener noreferrer">{pricingSources[row.source].name} ↗</a><strong>{row.benchmark}</strong><p>{row.comparison}</p></td>
      </tr>)}</tbody>
    </table></div>
    <div className="pricing-notes-grid">
      <section className="panel"><p className="eyebrow">Included in the proposal</p><h3>Start without a platform fee</h3><p>Cloud and product setup, team access, device enrollment, MQTT connections and keep-alives, SDK documentation and console administration carry no separate fee.</p><p>WebRTC signaling has no extra channel or signaling surcharge. Its MQTT messages follow the MQTT rates; direct P2P media has no cloud transfer fee.</p></section>
      <section className="panel pricing-example"><p className="eyebrow">Illustrative monthly usage</p><h3>One publish, five subscribers</h3><dl><div><dt>1 million publishes</dt><dd>NT$30</dd></div><div><dt>5 million deliveries</dt><dd>NT$150</dd></div><div><dt>1 million Shadow units over HTTP</dt><dd>NT$40</dd></div></dl><div className="pricing-example-total"><span>Proposed subtotal, before tax</span><strong>NT$220</strong></div><p>Example inputs, not usage from this Cloud. Video, storage and other operations are additional when used.</p></section>
    </div>
    <section className="panel pricing-methodology"><h3>How to read this rate card</h3><ul>
      <li>All rows are proposals. An existing usage meter does not mean charging is enabled. Items marked “Metering pending” need validated measurement before billing.</li>
      <li>Per-million and per-thousand prices are display units. Proposed charges are proportional to actual usage, not rounded up to whole million-request blocks. Monetary rounding is applied after monthly aggregation.</li>
      <li>RTK storage and traffic use GiB (1,073,741,824 bytes); Shadow uses KiB (1,024 bytes). Provider GB/KB units are retained as published and may differ.</li>
      <li>Public rates are regional examples before tax and discounts. Planning conversion: US$1 ≈ NT$32, not a live exchange rate. RTK prices are independent proposals, not currency-converted provider invoices.</li>
      <li>No free usage allowance or volume discount is assumed. Shared hosting costs, support, retention and measured operating margins must be reviewed before a production rate is approved. Private Cloud requires a separate quote.</li>
    </ul><details><summary>Research sources</summary><div className="pricing-source-links">{Object.values(pricingSources).map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>)}</div></details></section>
  </section>;
}
