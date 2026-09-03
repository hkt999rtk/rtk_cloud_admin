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
      <aside className="drawer-panel brand-cloud-drawer" role="dialog" aria-modal="true" aria-label="Create Brand Cloud" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h2>Create Brand Cloud</h2>
            <p>Creates an Account Manager <code>organization_kind=brand_cloud</code> record.</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close Brand Cloud drawer">x</button>
        </div>
        <div className="brand-cloud-stepper" aria-label="Create Brand Cloud steps">
          {['Identity', 'Initial Admin', 'Review'].map((label, index) => <span className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''} key={label}>{index + 1}. {label}</span>)}
        </div>
        <form className="drawer-form" onSubmit={submit}>
          {step === 1 ? <>
            <label>Brand display name<input className="input" value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
            <div className="form-grid">
              <label>Region<input className="input" value={form.region} onChange={(event) => update('region', event.target.value)} placeholder="Optional" /></label>
              <label>Tier<select className="input" value={form.tier} onChange={(event) => update('tier', event.target.value)}><option>Evaluation</option><option>Commercial</option></select></label>
            </div>
            <p className="source-note">Organization kind is fixed as <code>brand_cloud</code>.</p>
          </> : null}
          {step === 2 ? <>
            <label>Initial admin mode<select className="input" value={form.initialMode} onChange={(event) => update('initialMode', event.target.value)}>
              <option value="none">Assign later</option>
              <option value="create">Invite global user by email</option>
            </select></label>
            {form.initialMode === 'create' ? <>
              <label>Email<input className="input" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
              <label>Display name<input className="input" value={form.displayName} onChange={(event) => update('displayName', event.target.value)} /></label>
              <p className="source-note">The owner receives the global account activation email; no tenant password is created.</p>
            </> : null}
            {form.initialMode !== 'none' ? <label>Role<select className="input" value={form.role} onChange={(event) => update('role', event.target.value)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label> : null}
          </> : null}
          {step === 3 ? <section className="drawer-summary create-review-summary">
            <h3>Review</h3>
            <div><span>Brand</span><strong>{form.name}</strong></div>
            <div><span>Tier</span><strong>{form.tier}</strong></div>
            <div><span>Initial owner</span><strong>{form.initialMode === 'none' ? 'Assign later' : form.email}</strong></div>
            <p className="source-note">Quota and SSO setup can be completed after creation.</p>
          </section> : null}
          {message ? <p className="form-message">{message}</p> : null}
          <div className="drawer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            {step > 1 ? <button type="button" className="ghost-button" onClick={() => setStep((current) => current - 1)} disabled={submitting}>Back</button> : null}
            <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Creating...' : step < 3 ? 'Continue' : 'Create Brand Cloud'}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}
