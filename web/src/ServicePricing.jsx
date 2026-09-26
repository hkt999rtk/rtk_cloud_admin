import { activeLocale, formatDateTime, translate } from './i18n/index.mjs';
import React, { useEffect, useState } from 'react';
import { fetchEffectivePricing, fetchServicePricing, pricingGroups, pricingSources } from './service-pricing.mjs';
import './service-pricing.css';

const formatPrice = amount => `${translate('NT$')}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const formatEffectivePrice = rate => `${translate('NT$')}${(rate.unit_price_minor / 10 ** rate.unit_price_scale).toLocaleString('en-US', { maximumFractionDigits: 9 })}`;

export function BillingTabs({ active, onSelect }) {
  return <nav className="billing-tabs" aria-label={translate('Billing Pages')}>
    {[{ id: 'overview', label: 'Billing Overview' }, { id: 'pricing', label: 'Service Pricing' }, { id: 'usage', label: 'Usage and Forecast' }, { id: 'invoices', label: 'Invoices' }, { id: 'activity', label: 'Billing Activity' }, { id: 'settings', label: 'Payments and Automatic Top-Up' }, { id: 'profile', label: 'Billing Profile' }].map(({ id, label }) => <button key={id} type="button" className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>{translate(label)}</button>)}
  </nav>;
}

export function ServicePricing({ tabs, cloudId, ownershipVersion, onAccessLost }) {
  const [group, setGroup] = useState('All services');
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(false);
  const [effective, setEffective] = useState(null);
  const [effectiveError, setEffectiveError] = useState(false);
  const locale = activeLocale();
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setError(false);
    setEffective(null);
    setEffectiveError(false);
    fetchServicePricing(cloudId, ownershipVersion, locale, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setCatalog(result); })
      .catch(failure => {
        if (controller.signal.aborted) return;
        setCatalog(null);
        if ([401, 403, 409].includes(failure.status)) onAccessLost();
        else setError(true);
      });
    fetchEffectivePricing(cloudId, ownershipVersion, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setEffective(result); })
      .catch(failure => {
        if (controller.signal.aborted) return;
        setEffective(null);
        if ([401, 403, 409].includes(failure.status)) onAccessLost();
        else setEffectiveError(true);
      });
    return () => controller.abort();
  }, [cloudId, ownershipVersion, locale, onAccessLost]);
  const servicePricing = catalog?.rows || [];
  const rows = servicePricing.filter(row => group === 'All services' || row.group === group);
  const referenceDate = catalog && formatDateTime(`${catalog.referenceDate}T00:00:00Z`, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const currentRates = effective?.current?.rates || [];
  const otaIsEffective = currentRates.some(rate => rate.service_code === 'ota');
  const otaUpcoming = effective?.upcoming?.rates?.some(rate => rate.service_code === 'ota');
  const effectiveLoading = translate('Loading your effective Billing rates…');
  const effectiveUnavailable = translate('Your effective Billing rates cannot be verified right now. Reference prices below are not used for billing.');
  const otaProvisional = translate('OTA account eligibility is provisional for the current UTC month and is checked again at settlement. Only Products with OTA selected and verified usage can be charged.');
  const otaHeld = translate('OTA charges are held for review because paid-account eligibility could not be verified for this UTC month.');
  const otaActiveSummary = translate('OTA is included in the current effective rate card. Product selection, paid-account eligibility, and verified usage still control each charge.');
  const otaUpcomingSummary = translate('OTA is included in the next published rate card. Its listed UTC date controls when these prices can begin to apply.');
  const otaPendingSummary = translate('The four OTA customer unit prices are approved but have no effective date yet. OTA is not charged at these prices until an active Billing rate card includes them.');
  const otaActiveBadge = translate('Approved OTA baseline · see effective card above');
  const otaPendingBadge = translate('Approved OTA price · not effective');
  const otaUnknownBadge = translate('Approved OTA price · effective status unavailable');
  const otaUnknownSummary = translate('The four OTA unit prices are approved. Current effectiveness cannot be verified until Billing responds.');
  return <section className="page-content billing-page service-pricing-page" data-testid="billing-pricing-page">
    <div className="page-intro"><div><p className="eyebrow">{translate('Realtek Managed Cloud')}</p><h2>{translate('Service pricing')}</h2><p>{translate('Compare approved OTA unit prices with public references selected from the official sources inspected for this review.')}</p></div>{catalog && <span className="pricing-draft">{translate('Reference review')} · <time dateTime={catalog.referenceDate}>{referenceDate}</time></span>}</div>
    {tabs}
    <section className="panel pricing-effective" aria-label={translate('Current effective rate card')}>
      <h3>{translate('Current effective rate card')}</h3>
      {!effective ? <p role={effectiveError ? 'alert' : 'status'}>{effectiveError ? effectiveUnavailable : effectiveLoading}</p> : <>
        {effective.current ? <>
          <p>{translate('Version')} {effective.current.id} · {translate('Effective from')} <time dateTime={effective.current.effective_from}>{formatDateTime(effective.current.effective_from, { timeZone: 'UTC' })}</time> {translate('UTC')}</p>
          <div className="pricing-table-wrap"><table className="pricing-table" data-testid="pricing-effective-table"><caption>{translate('Current effective rate card')}</caption><thead><tr><th scope="col">{translate('Service')}</th><th scope="col">{translate('Meter')}</th><th scope="col">{translate('Effective unit price before tax')}</th><th scope="col">{translate('Billing unit and rounding')}</th></tr></thead><tbody>{currentRates.map(rate => <tr key={`${rate.service_code}:${rate.metric_code}:${rate.unit}`}><th scope="row">{rate.description}</th><td data-label={translate('Meter')}>{rate.service_code} · {rate.metric_code}</td><td data-label={translate('Effective unit price before tax')}>{formatEffectivePrice(rate)} / {rate.unit}</td><td data-label={translate('Billing unit and rounding')}>{rate.quantity_scale == null ? translate('Quantity precision pending review') : `${rate.quantity_scale} ${translate('decimal places')}`} · {rate.rounding_mode}</td></tr>)}</tbody></table></div>
          <p>{effective.current.tax_mode === 'invoice_total' && effective.current.invoice_tax_rate_basis_points === 500 ? translate('Taiwan business tax is 5% on the combined pre-tax subtotal of all services, rounded once per invoice. OTA has no separate tax or exemption.') : translate('This effective rate card uses its recorded historical tax policy; see each issued invoice for the exact tax amount.')}</p>
          {otaIsEffective && <p>{effective.ota_eligibility === 'provisional' ? otaProvisional : otaHeld}</p>}
        </> : <p>{translate('No effective TWD rate card is available for this Cloud. Approved and reference prices below do not create a charge.')}</p>}
        {effective.upcoming && <p>{translate('Next published rate card')}: {effective.upcoming.id} · {translate('Effective from')} <time dateTime={effective.upcoming.effective_from}>{formatDateTime(effective.upcoming.effective_from, { timeZone: 'UTC' })}</time> {translate('UTC')}{otaUpcoming ? ` · ${translate('Includes OTA rates')}` : ''}</p>}
      </>}
    </section>
    {!catalog ? <section className="panel" role={error ? 'alert' : 'status'}><p>{translate(error ? 'Billing information temporarily unavailable' : 'Loading owner-scoped Billing…')}</p></section> : <>
    <section className="pricing-status-summary" aria-label={translate('Price status')}>
      <div><strong>4</strong><h3>{translate('OTA prices approved')}</h3><p>{effectiveError ? otaUnknownSummary : effective ? otaIsEffective ? otaActiveSummary : otaUpcoming ? otaUpcomingSummary : otaPendingSummary : effectiveLoading}</p></div>
      <div><strong>11</strong><h3>{translate('Services with reference prices only')}</h3><p>{translate('The other 11 services have no newly approved RTK price in this review. All 15 rows show the highest eligible public reference among the official sources inspected. Existing customer charges follow the active rate card, contract and invoice.')}</p></div>
    </section>
    <section className="pricing-intro" aria-label={translate('Service rates and billing basis')}>
      <div><h3>{translate('How these prices work')}</h3><p>{translate('The current rate card above comes from Billing. The approved and public reference prices below are separate and never replace an effective rate.')}</p><p>{translate('For the approved OTA-inclusive TWD policy, each Product and meter’s usage × its unit price is rounded to a pre-tax line subtotal. All service line subtotals are added, then Taiwan business tax of 5% is calculated once on the invoice subtotal using half-up rounding. Subtotal plus tax is the total due. Tax shown on each line allocates that one invoice tax amount. Existing invoices keep their issued tax policy.')}</p><p>{translate('For paid Managed Cloud, a Product must select OTA before new OTA work is allowed. OTA billing also requires commercial status for the entire UTC month, an active Billing account at settlement, verified Product grants, measured usage and an effective OTA rate. No separate OTA contract selection is needed. Work authorized before OTA is turned off may finish, and existing firmware storage continues until the object is physically deleted.')}</p></div>
      <dl><div><dt>{translate('Currency')}</dt><dd>{catalog.currency} {translate('· NT$')}</dd></div><div><dt>{translate('Basis')}</dt><dd>{translate('Monthly usage')}</dd></div><div><dt>{translate('Reference checked')}</dt><dd><time dateTime={catalog.referenceDate}>{referenceDate}</time></dd></div></dl>
    </section>
    <div className="pricing-filter" role="group" aria-label={translate('Filter service prices')}>{pricingGroups.map(item => <button type="button" key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{translate(item)}<span>{item === 'All services' ? servicePricing.length : servicePricing.filter(row => row.group === item).length}</span></button>)}</div>
    <div className="pricing-table-wrap"><table className="pricing-table" data-testid="pricing-reference-table">
      <caption>{translate(group)} · {rows.length} {translate('service meters')}</caption>
      <thead><tr><th scope="col">{translate('Service')}</th><th scope="col">{translate('RTK price status')}</th><th scope="col">{translate('How usage is counted')}</th><th scope="col">{translate('Highest inspected public reference')}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} data-price-status={row.priceStatus}>
        <th scope="row"><strong>{translate(row.name)}</strong><p>{translate(row.description)}</p><span className={`pricing-readiness ${row.readiness === 'Metering pending' ? 'pending' : ''}`}>{translate(row.readiness)}</span></th>
        <td data-label={translate('RTK price status')} className="pricing-rate">{row.priceStatus === 'approved-pending' ? <><span className="pricing-price-status approved-pending">{effectiveError ? otaUnknownBadge : effective ? otaIsEffective ? otaActiveBadge : otaPendingBadge : otaUnknownBadge}</span><strong>{formatPrice(row.price)}</strong><span>/ {translate(row.unit)}{translate(', before tax')}</span></> : <><span className="pricing-price-status research">{translate('Research reference only')}</span><p>{translate('The effective customer rate, if any, is shown in the Billing card above.')}</p></>}</td>
        <td data-label={translate('How usage is counted')}>{translate(row.rule)}</td>
        <td data-label={translate('Highest inspected public reference')} className="pricing-reference"><strong>{formatPrice(row.referencePrice)} / {translate(row.referenceUnit || row.unit)}</strong><a href={pricingSources[row.source].url} target="_blank" rel="noopener noreferrer">{pricingSources[row.source].name} ↗</a><span>{row.benchmark}</span><p>{translate(row.comparison)}</p></td>
      </tr>)}</tbody>
    </table></div>
    <section className="panel pricing-included"><p className="eyebrow">{translate('No separate service charge')}</p><h3>{translate('Included activities')}</h3><p>{translate('Cloud and product setup, team access, device enrollment, MQTT connections and keep-alives, SDK documentation and console administration carry no separate fee.')}</p><p>{translate('WebRTC signaling has no extra channel or signaling surcharge. Its MQTT messages follow the MQTT rates; direct P2P media has no cloud transfer fee.')}</p></section>
    <section className="panel pricing-methodology"><h3>{translate('How to read this rate card')}</h3><ul>
      <li>{translate('Research references are not approved customer charges. The current Billing rate card above determines actual rates; an existing meter or an approved proposal alone does not enable charging.')}</li>
      <li>{translate('Per-million and per-thousand prices are display units. Charges, when effective, are proportional to actual usage; there is no whole-block minimum. Money is rounded after monthly aggregation.')}</li>
      <li>{translate('RTK storage and traffic use GiB (1,073,741,824 bytes); Shadow uses KiB (1,024 bytes). Provider byte units and counted events may differ, as noted in each row.')}</li>
      <li>{catalog.fxNote}</li>
      <li>{translate('References assume no free allowance or volume discount. Under the approved OTA-inclusive policy, Taiwan business tax is added to the combined invoice subtotal, not separately to OTA. Government electronic-invoice issuance is not handled in this phase. Private Cloud requires a separate quote.')}</li>
    </ul><details><summary>{translate('Research sources')}</summary><div className="pricing-source-links">{Object.values(pricingSources).map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>)}</div></details></section>
    </>}
  </section>;
}
