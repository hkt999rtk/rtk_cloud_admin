import React, { useEffect, useRef, useState } from 'react';
import { cloudURL, managedCloudRequest, cloudWriteIntent, blockerLabels } from './managed-clouds.mjs';
import { loginPathFor } from './auth-routing.mjs';
import { handoffAcceptPath, handoffRoute, handoffURL, handoffAPI, handoffError, snapshotKey, safeSnapshot, handoffConfirmable, handoffCancelable, handoffComplete, handoffTitle } from './owner-handoff.mjs';
import './my-clouds.css';
import './owner-handoff.css';

function SemanticIcon({ name, color }) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" style={color ? { color } : undefined} />;
}

const policy = 'Positive credit stays with this cloud. Old payment methods and automatic-charge consent do not transfer. Cost-producing actions may pause during settlement. The former owner loses all cloud and Product access after owner commit; existing other collaborators retain their grants.';

export function StartOwnerHandoff({ cloudId }) {
  const [email, setEmail] = useState(''), [ack, setAck] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const intent = useRef(null), locked = useRef(false), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function submit(event) {
    event.preventDefault(); if (!ack || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const next = cloudWriteIntent(intent.current, 'POST', handoffAPI(cloudId), { target_email: email.trim() }); intent.current = next;
    try { const data = await managedCloudRequest(next.path, { method: next.method, body: next.body, key: next.key }); if (alive.current) window.location.assign(handoffURL(data.owner_transfer.brand_cloud_id, data.owner_transfer.id)); }
    catch (err) { if (alive.current) setError(handoffError(err)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="my-clouds-panel owner-handoff"><h2><SemanticIcon name="right-left" />Transfer ownership</h2><p>The available balance must be nonnegative (zero is allowed), and Billing must confirm settlement with no unresolved financial work.</p><p>{policy}</p>{error && <p role="alert"><SemanticIcon name="triangle-exclamation" />{error}</p>}<form onSubmit={submit}><label><SemanticIcon name="envelope-circle-check" />New owner’s verified email<input type="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} /></label><label><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} /><SemanticIcon name="triangle-exclamation" color="#b42318" />I understand the ownership and Billing consequences.</label><button className="icon-text" disabled={busy || !ack}><SemanticIcon name="paper-plane" />{busy ? 'Requesting…' : 'Send ownership invitation'}</button></form><p><SemanticIcon name="circle-info" />Invitation acceptance starts the handoff. It does not complete ownership transfer.</p></section>;
}

export function OwnerHandoffPage() {
  const route = handoffRoute(window.location.pathname);
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [me, setMe] = useState(null), [view, setView] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [policyAck, setPolicyAck] = useState(false), [previewKey, setPreviewKey] = useState(''), [approval, setApproval] = useState(''), [cancelAck, setCancelAck] = useState(false);
  const locked = useRef(false), intent = useRef(null), alive = useRef(false);
  const loginNext = route?.accept ? `${handoffAcceptPath}${token ? `?token=${encodeURIComponent(token)}` : ''}` : window.location.pathname;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (route?.accept) window.history.replaceState({}, '', handoffAcceptPath);
    (async () => { try {
      const account = await managedCloudRequest('/api/me', { signal: controller.signal });
      if (!account.authenticated) { window.location.replace(loginPathFor(loginNext)); return; }
      if (controller.signal.aborted) return; setMe(account);
      if (route?.transferId) { const data = await managedCloudRequest(handoffAPI(route.cloudId, route.transferId), { signal: controller.signal }); if (!controller.signal.aborted) setView(data.owner_transfer); }
    } catch (err) { if (!controller.signal.aborted) setError(handoffError(err)); } })();
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!view || ['succeeded', 'canceled', 'expired'].includes(view.phase)) return;
    const controller = new AbortController(); let timer;
    const poll = async () => {
      try {
        const data = await managedCloudRequest(handoffAPI(view.brand_cloud_id, view.id), { signal: controller.signal });
        if (controller.signal.aborted) return;
        setView(data.owner_transfer);
        setError('');
        if (['succeeded', 'canceled', 'expired'].includes(data.owner_transfer.phase)) return;
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(handoffError(err)); setPreviewKey(''); setApproval('');
        if ([401, 403, 404].includes(err.status)) { setView(null); return; }
      }
      timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000); return () => { controller.abort(); clearTimeout(timer); };
  }, [view?.id]);
  const key = snapshotKey(view), ready = handoffConfirmable(view, me?.user_id);
  useEffect(() => { setApproval(''); setCancelAck(false); }, [key, ready]);

  async function command(action) {
    if (locked.current) return;
    if (action === 'confirm' && (!ready || previewKey !== key || approval !== key)) return;
    if (action === 'accept' && (!policyAck || !token)) return;
    if (action === 'cancel' && (!cancelAck || !handoffCancelable(view, me?.user_id))) return;
    locked.current = true; setBusy(true); setError('');
    const path = action === 'accept' ? '/api/developer/brand-cloud-owner-transfers/accept' : handoffAPI(view.brand_cloud_id, view.id, action);
    const method = action === 'preview' ? 'GET' : 'POST';
    const body = action === 'accept' ? { token } : action === 'confirm' ? { ...view.balance_snapshot } : method === 'GET' ? undefined : {};
    const next = method === 'GET' ? { path, method } : cloudWriteIntent(intent.current, method, path, body); if (method !== 'GET') intent.current = next;
    try {
      const data = await managedCloudRequest(path, { method, body, key: next.key }); if (!alive.current) return;
      if (action === 'accept') { window.location.replace(handoffURL(data.owner_transfer.brand_cloud_id, data.owner_transfer.id)); return; }
      setView(data.owner_transfer); setApproval(''); setCancelAck(false);
      setPreviewKey(action === 'preview' ? snapshotKey(data.owner_transfer) : '');
      if (action !== 'preview') intent.current = null;
    } catch (err) { if (alive.current) { setError(handoffError(err)); setPreviewKey(''); setApproval(''); if ([401,403,404].includes(err.status)) setView(null); } }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="my-clouds-shell owner-handoff"><header className="my-clouds-header"><a href="/console/clouds">Realtek Connect / My Clouds</a></header><main className="my-clouds-main">
    <h1>Ownership and Billing handoff</h1><p>{policy}</p>
    {error && <div role="alert"><p>{error} <a href={loginPathFor(loginNext)}>Sign in again</a></p><button disabled={busy} onClick={() => { setPreviewKey(''); setApproval(''); setReload(value => value + 1); }}>Retry account and handoff status</button></div>}
    {!me && !error && <p role="status">Loading account…</p>}
    {route?.accept && me && <section className="my-clouds-panel owner-handoff"><h2>Accept ownership invitation</h2><p>Signed in as {me.email}. Only the invited global account can accept. Acceptance begins settlement; each party must later confirm the same exact balance.</p>{!token && <p role="alert">The email link is missing its token. Open the original invitation link again.</p>}<label><input type="checkbox" checked={policyAck} disabled={busy} onChange={e => setPolicyAck(e.target.checked)} />I understand the handoff and payment responsibilities.</label><button disabled={busy || !token || !policyAck} onClick={() => command('accept')}>{busy ? 'Accepting…' : 'Accept invitation and begin settlement'}</button></section>}
    {view && <section className="my-clouds-panel owner-handoff" aria-live="polite"><h2>{handoffTitle(view)}</h2><dl><dt>Cloud</dt><dd>{view.brand_cloud_id}</dd><dt>Transfer</dt><dd>{view.id}</dd><dt>Source owner</dt><dd>{view.source_user_id}</dd><dt>New owner</dt><dd>{view.target_email || view.target_user_id}</dd><dt>Phase</dt><dd>{view.phase} / {view.operation_phase || 'invitation'}</dd></dl>
      <p>Transfer requires balance ≥ 0, settled usage and no unresolved payment, refund or dispute. A positive balance alone is insufficient.</p>
      <ul>{view.blockers.map((b,i) => <li key={`${b.code}-${i}`}>{blockerLabels[b.code] || b.code}</li>)}</ul>
      {safeSnapshot(view.balance_snapshot) ? <><h3>Settled balance snapshot</h3><p>{view.balance_snapshot.balance_minor} minor units ({view.balance_snapshot.currency}) · Ownership version {view.balance_snapshot.ownership_version} · Billing version {view.balance_snapshot.billing_snapshot_version}</p><p>Source confirmed: {view.source_confirmed ? 'Yes' : 'No'} · Target confirmed: {view.target_confirmed ? 'Yes' : 'No'}</p>{!ready && <p>This snapshot is historical or not currently confirmable. Do not treat it as permission to transfer.</p>}</> : <p>No exactly representable, confirmable settled snapshot is available.</p>}
      {ready && <><button disabled={busy} onClick={() => command('preview')}>Refresh settled balance</button>{previewKey === key && <><label><input type="checkbox" disabled={busy} checked={approval === key} onChange={e => setApproval(e.target.checked ? key : '')} />I confirm this exact balance and both versions, and accept the Billing handoff consequences.</label><button disabled={busy || approval !== key} onClick={() => command('confirm')}>Confirm exact balance</button></>}</>}
      {handoffCancelable(view,me?.user_id) && <><p>If blocked by debt, cancel first and wait for confirmed hold release before topping up. Do not pay inside a fenced handoff.</p><label><input type="checkbox" checked={cancelAck} disabled={busy} onChange={e => setCancelAck(e.target.checked)} />Request precommit cancellation; wait for all service holds to release.</label><button disabled={busy || !cancelAck} onClick={() => command('cancel')}>Request cancellation</button></>}
      {view.phase === 'finalizing' && <p>The unique owner has switched. Recovery must finish forward; there is no switch-back action. The new owner must set up their own payment method and consent after finalization.</p>}
      {handoffComplete(view) && (me?.user_id === view.target_user_id ? <a href={cloudURL(view.brand_cloud_id)}>Open your cloud</a> : <p>You no longer have access to this cloud or its Products.</p>)}
    </section>}
  </main></div>;
}
