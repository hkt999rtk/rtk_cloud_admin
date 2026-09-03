import React, { useEffect, useRef, useState } from 'react';
import { cloudIdFromPath } from './routes.mjs';
import { scopedCustomerAPI } from './cloud-scope.mjs';

function api(path) { return scopedCustomerAPI(path, cloudIdFromPath(window.location.pathname)); }

export function ProvisioningPage({ products = [], canCreate = false }) {
  const [file, setFile] = useState(null);
  const [productId, setProductId] = useState('');
  const [productionRun, setProductionRun] = useState('');
  const [source, setSource] = useState(null);
  const [validation, setValidation] = useState(null);
  const [execution, setExecution] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [itemFilter, setItemFilter] = useState('all');
  const intent = useRef(crypto.randomUUID());

  useEffect(() => {
    const job = execution || validation;
    if (!job || ['completed', 'partial_failed', 'failed', 'cancelled', 'expired'].includes(job.state)) return undefined;
    const timer = window.setInterval(async () => {
      const response = await fetch(api(`/api/jobs/${encodeURIComponent(job.id)}`), { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json();
      if (execution) setExecution(body.job); else setValidation(body.job);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [execution, validation]);

  useEffect(() => {
    const job = execution || validation;
    if (!job?.id) { setItems([]); return undefined; }
    const query = itemFilter === 'retryable' ? '?retryable=true' : itemFilter === 'failed' ? '?state=failed' : '';
    let active = true;
    fetch(api(`/api/jobs/${encodeURIComponent(job.id)}/items${query}`), { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('items unavailable')))
      .then((body) => { if (active) setItems(body.items || []); })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [execution?.id, execution?.state, validation?.id, validation?.state, itemFilter]);

  async function upload(event) {
    event.preventDefault();
    if (!file || !productId) return;
    setBusy(true); setMessage('');
    const form = new FormData();
    form.set('file', file); form.set('product_id', productId); form.set('production_run', productionRun);
    const response = await fetch(api('/api/provisioning/sources'), { method: 'POST', headers: { 'Idempotency-Key': intent.current }, body: form });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage('CSV source could not be uploaded. Check the device_id column, duplicates, Product, and file size.'); return; }
    setSource(body.source); setValidation(null); setExecution(null); setMessage('Immutable CSV source uploaded. Run validation before execution.');
  }

  async function start(kind) {
    setBusy(true); setMessage('');
    const path = kind === 'validation' ? '/api/provisioning/validate' : '/api/provisioning/jobs';
    const payload = kind === 'validation' ? { source_id: source.id } : { source_id: source.id, validation_job_id: validation.id };
    const response = await fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(kind === 'validation' ? 'Validation could not start.' : 'Execution requires a completed validation for the same unexpired source.'); return; }
    if (kind === 'validation') setValidation(body.job); else setExecution(body.job);
  }

  async function act(job, action, setter) {
    setBusy(true); setMessage('');
    const response = await fetch(api(`/api/jobs/${encodeURIComponent(job.id)}/${action}`), { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(body.message || `The ${action} action could not be applied.`); return; }
    setter(body.job);
  }

  async function retry(job, setter) {
    setBusy(true); setMessage('');
    const response = await fetch(api(`/api/jobs/${encodeURIComponent(job.id)}/retry`), { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(body.message || 'Only recoverable failed rows can be retried.'); return; }
    setter(body.job);
  }

  const validationReady = validation?.state === 'completed' && validation?.scope?.validation?.valid === true;
  const resultJob = execution || validation;
  return <section className="page-content">
    <div className="page-intro"><div><p className="eyebrow">Fleet Operations</p><h2>CSV Provisioning</h2><p>Upload an immutable, checksum-bound source; validate every row; then explicitly confirm execution.</p></div></div>
    {!canCreate ? <section className="panel"><h3>Read-only access</h3><p>provisioning.create is required to upload or execute a source.</p></section> : <section className="panel"><form className="report-builder" onSubmit={upload}>
      <select required value={productId} onChange={(event) => { setProductId(event.target.value); setSource(null); intent.current = crypto.randomUUID(); }}><option value="">Select Product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
      <input value={productionRun} onChange={(event) => setProductionRun(event.target.value)} placeholder="Production run (optional)" />
      <input required type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setSource(null); intent.current = crypto.randomUUID(); }} />
      <button className="primary-button" disabled={busy || !file || !productId}>Upload source</button>
    </form></section>}
    {source ? <section className="panel"><h3>Source</h3><p>{source.filename} · {source.row_count} rows · expires {source.expires_at}</p><code>{source.checksum}</code><div className="report-builder-actions"><button disabled={busy || Boolean(validation)} onClick={() => start('validation')}>Validate rows</button>{validationReady ? <button className="primary-button" disabled={busy || Boolean(execution)} onClick={() => start('execution')}>Confirm provisioning</button> : null}</div></section> : null}
    {validation ? <JobState title="Validation" job={validation} busy={busy} onAction={(action) => action === 'retry' ? retry(validation, setValidation) : act(validation, action, setValidation)} /> : null}
    {execution ? <JobState title="Execution" job={execution} busy={busy} onAction={(action) => action === 'retry' ? retry(execution, setExecution) : act(execution, action, setExecution)} /> : null}
    {resultJob ? <section className="panel"><div className="report-builder-actions"><button aria-pressed={itemFilter === 'all'} onClick={() => setItemFilter('all')}>All rows</button><button aria-pressed={itemFilter === 'failed'} onClick={() => setItemFilter('failed')}>Failed rows</button><button aria-pressed={itemFilter === 'retryable'} onClick={() => setItemFilter('retryable')}>Retryable rows</button></div>{items.length ? <div className="table-wrap"><table><thead><tr><th>Device</th><th>State</th><th>Attempt</th><th>Failure</th></tr></thead><tbody>{items.map((item) => <tr key={item.item_key}><td>{item.item_key}</td><td>{item.state}</td><td>{item.attempt}</td><td>{item.failure_code || '—'}</td></tr>)}</tbody></table></div> : <p>No rows match this filter.</p>}</section> : null}
    {resultJob && ['completed', 'partial_failed', 'failed', 'cancelled'].includes(resultJob.state) ? <p><a href={api(`/api/jobs/${encodeURIComponent(resultJob.id)}/result?format=csv`)}>Download CSV result</a> · <a href={api(`/api/jobs/${encodeURIComponent(resultJob.id)}/result?format=json`)}>Download JSON result</a></p> : null}
    {message ? <p className="notice" role="status">{message}</p> : null}
  </section>;
}

function JobState({ title, job, busy, onAction }) {
  return <section className="panel" aria-live="polite"><h3>{title}</h3><p>{job.state} · {job.completed || 0}/{job.total || 0} completed · {job.failed || 0} failed · {job.skipped || 0} skipped</p>{job.failure_code ? <p className="error-text">{job.failure_code}: {job.failure_reason || 'The job stopped safely.'}</p> : null}<div className="report-builder-actions">{(job.allowed_actions || []).map((action) => <button key={action} disabled={busy} onClick={() => onAction(action)}>{action[0].toUpperCase() + action.slice(1)}</button>)}</div></section>;
}
