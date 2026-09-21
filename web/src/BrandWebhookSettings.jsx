import React, { useEffect, useState } from 'react';
import { brandWebhookRequest } from './brand-webhook.mjs';

function webhookError(error) {
  if (error?.status === 409) return 'Cloud ownership changed. Refresh the cloud before trying again.';
  if (error?.status === 400) return 'Check the HTTPS endpoint and signing secret. The endpoint must use public DNS and port 443.';
  if (error?.status === 503) return 'Brand event delivery is not configured for this environment.';
  if ([401, 403].includes(error?.status)) return 'You no longer have permission to manage this cloud’s webhook.';
  return 'The webhook service is temporarily unavailable. Please try again.';
}

export function BrandWebhookSettings({ cloudId, onAccessLost = () => {} }) {
  const [subscription, setSubscription] = useState(null);
  const [version, setVersion] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [secret, setSecret] = useState('');
  const [eventId, setEventId] = useState('');
  const [receipts, setReceipts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [error, setError] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setMessage('');
    brandWebhookRequest(cloudId, { signal: controller.signal })
      .then(({ data, version: currentVersion }) => {
        if (controller.signal.aborted) return;
        setSubscription(data);
        setVersion(currentVersion);
        setEndpoint(data?.endpoint_url || '');
        setConfirmDisable(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(webhookError(cause));
        if ([401, 403].includes(cause?.status)) onAccessLost(cause);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cloudId, reload]);

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await brandWebhookRequest(cloudId, {
        method: 'PUT', version,
        body: { endpoint_url: endpoint.trim(), secret },
      });
      setSubscription(result.data);
      setVersion(result.version);
      setEndpoint(result.data.endpoint_url);
      setSecret('');
      setConfirmDisable(false);
      setMessage('Webhook enabled. The signing secret will not be shown again.');
    } catch (cause) {
      setError(webhookError(cause));
      if ([401, 403].includes(cause?.status)) onAccessLost(cause);
    } finally { setBusy(false); }
  }

  async function disable() {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await brandWebhookRequest(cloudId, { method: 'DELETE', version });
      setVersion(result.version);
      setSubscription((current) => current ? { ...current, enabled: false } : null);
      setSecret('');
      setConfirmDisable(false);
      setMessage('Webhook disabled. A delivery already in flight may still finish.');
    } catch (cause) {
      setError(webhookError(cause));
      if ([401, 403].includes(cause?.status)) onAccessLost(cause);
    } finally { setBusy(false); }
  }

  async function inspect(event) {
    event.preventDefault();
    if (receiptBusy) return;
    setReceiptBusy(true); setReceiptError(''); setReceipts(null);
    try {
      const result = await brandWebhookRequest(cloudId, { eventId: eventId.trim() });
      setReceipts(result.data.receipts || []);
    } catch (cause) {
      setReceiptError(webhookError(cause));
      if ([401, 403].includes(cause?.status)) onAccessLost(cause);
    } finally { setReceiptBusy(false); }
  }

  return <section className="my-clouds-panel brand-webhook-settings" aria-labelledby="brand-webhook-heading">
    <h2 id="brand-webhook-heading">Brand event webhook</h2>
    <p>RTK sends signed event metadata to your HTTPS endpoint. Your brand decides which app users to notify and owns APNs/FCM delivery.</p>
    {loading ? <p role="status">Loading webhook settings…</p> : <>
      {error && <p role="alert" className="brand-webhook-error">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>Refresh</button></p>}
      {message && <p role="status">{message}</p>}
      {version && <>
        <p role="status">Status: <strong>{subscription?.enabled ? 'Enabled' : subscription ? 'Disabled' : 'Not configured'}</strong></p>
        <form onSubmit={save} autoComplete="off">
          <label>HTTPS endpoint
            <input type="url" required value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://hooks.example.com/events" disabled={busy} />
          </label>
          <label>New signing secret (32–256 characters)
            <input type="password" required minLength={32} maxLength={256} autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} disabled={busy} />
          </label>
          <p>The secret is required when saving or re-enabling the subscription; it is never displayed after submission.</p>
          <div className="my-clouds-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : subscription?.enabled ? 'Replace webhook' : 'Enable webhook'}</button>
            {subscription?.enabled && <button type="button" disabled={busy} onClick={() => setConfirmDisable(true)}>Disable delivery</button>}
          </div>
        </form>
        {confirmDisable && <div className="brand-webhook-confirm" role="group" aria-label="Confirm webhook disable"><p>Stop new webhook deliveries for this cloud? An in-flight request may still finish.</p><div className="my-clouds-actions"><button type="button" className="my-clouds-danger" disabled={busy} onClick={disable}>Confirm disable</button><button type="button" disabled={busy} onClick={() => setConfirmDisable(false)}>Cancel</button></div></div>}
        <div className="brand-webhook-receipts"><h3>Delivery receipts</h3><p>Look up an event ID received by your backend to see RTK delivery attempts, identified by device when an ID is reused. This does not confirm a mobile push was delivered.</p>
          <form onSubmit={inspect}><label>Event ID<input value={eventId} required maxLength={128} onChange={(event) => setEventId(event.target.value)} disabled={receiptBusy} /></label><button type="submit" disabled={receiptBusy}>{receiptBusy ? 'Checking…' : 'Check receipts'}</button></form>
          {receiptError && <p role="alert">{receiptError}</p>}
          {receipts && (receipts.length ? <div className="brand-webhook-receipt-list"><table><thead><tr><th>Device</th><th>Attempt</th><th>Outcome</th><th>HTTP</th><th>Observed at</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={`${receipt.device_id}-${receipt.event_id}-${receipt.attempt}`}><td>{receipt.device_id}</td><td>{receipt.attempt}</td><td>{receipt.outcome}</td><td>{receipt.status_code || '—'}</td><td>{receipt.observed_at || '—'}</td></tr>)}</tbody></table></div> : <p role="status">No delivery attempts recorded for this event.</p>)}
        </div>
      </>}
    </>}
  </section>;
}
