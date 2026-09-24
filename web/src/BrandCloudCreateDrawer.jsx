import { translate } from './i18n/index.mjs';
import React, { useState } from 'react';

export function BrandCloudCreateDrawer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '',
    region: '',
    tier: 'Evaluation',
    initialMode: 'none',
    email: '',
    displayName: '',
    role: 'owner',
  });
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    if (!form.name.trim()) {
      setMessage('Brand display name is required.');
      return;
    }
    if (step === 2 && form.initialMode === 'create' && !form.email.trim()) {
      setMessage('Initial owner email is required.');
      return;
    }
    if (step < 3) {
      setStep((current) => current + 1);
      return;
    }

    setSubmitting(true);
    try {
      const result = await onCreate({
        brandCloud: {
          name: form.name.trim(),
          metadata: {
            region: form.region.trim() || undefined,
            tier: form.tier,
          },
        },
        initialUser: form.initialMode === 'create' ? {
          email: form.email.trim(),
          display_name: form.displayName.trim() || undefined,
          role: form.role,
          activation_mode: 'email',
        } : null,
      });
      setMessage(result.memberError ? `Brand Cloud created. ${result.memberError}` : 'Brand Cloud created.');
    } catch (error) {
      setMessage(error?.message || 'Brand Cloud creation is temporarily unavailable.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer-panel brand-cloud-drawer" role="dialog" aria-modal="true" aria-label={translate("Create Brand Cloud")} onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h2>{translate("Create Brand Cloud")}</h2>
            <p>{translate("Creates an Account Manager")} <code>organization_kind=brand_cloud</code> {translate("record.")}</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label={translate("Close Brand Cloud drawer")}>x</button>
        </div>
        <div className="brand-cloud-stepper" aria-label={translate("Create Brand Cloud steps")}>
          {['Identity', 'Initial Admin', 'Review'].map((label, index) => <span className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''} key={label}>{index + 1}. {label}</span>)}
        </div>
        <form className="drawer-form" onSubmit={submit}>
          {step === 1 ? <>
            <label>{translate("Brand display name")}<input className="input" value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
            <div className="form-grid">
              <label>{translate("Region")}<input className="input" value={form.region} onChange={(event) => update('region', event.target.value)} placeholder={translate("Optional")} /></label>
              <label>{translate("Tier")}<select className="input" value={form.tier} onChange={(event) => update('tier', event.target.value)}><option>{translate("Evaluation")}</option><option>{translate("Commercial")}</option></select></label>
            </div>
            <p className="source-note">{translate("Organization kind is fixed as")} <code>brand_cloud</code>.</p>
          </> : null}
          {step === 2 ? <>
            <label>{translate("Initial admin mode")}<select className="input" value={form.initialMode} onChange={(event) => update('initialMode', event.target.value)}>
              <option value="none">{translate("Assign later")}</option>
              <option value="create">{translate("Invite global user by email")}</option>
            </select></label>
            {form.initialMode === 'create' ? <>
              <label>{translate("Email")}<input className="input" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
              <label>{translate("Display name")}<input className="input" value={form.displayName} onChange={(event) => update('displayName', event.target.value)} /></label>
              <p className="source-note">{translate("The owner receives the global account activation email; no tenant password is created.")}</p>
            </> : null}
            {form.initialMode !== 'none' ? <label>{translate("Role")}<select className="input" value={form.role} onChange={(event) => update('role', event.target.value)}><option value="owner">{translate("Owner")}</option><option value="admin">{translate("Admin")}</option><option value="member">{translate("Member")}</option></select></label> : null}
          </> : null}
          {step === 3 ? <section className="drawer-summary create-review-summary">
            <h3>{translate("Review")}</h3>
            <div><span>{translate("Brand")}</span><strong>{form.name}</strong></div>
            <div><span>{translate("Tier")}</span><strong>{form.tier}</strong></div>
            <div><span>{translate("Initial owner")}</span><strong>{form.initialMode === 'none' ? translate("Assign later") : form.email}</strong></div>
            <p className="source-note">{translate("Quota and SSO setup can be completed after creation.")}</p>
          </section> : null}
          {message ? <p className="form-message">{message}</p> : null}
          <div className="drawer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>{translate("Cancel")}</button>
            {step > 1 ? <button type="button" className="ghost-button" onClick={() => setStep((current) => current - 1)} disabled={submitting}>{translate("Back")}</button> : null}
            <button type="submit" className="primary-button" disabled={submitting}>{submitting ? translate("Creating...") : step < 3 ? translate("Continue") : translate("Create Brand Cloud")}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}
