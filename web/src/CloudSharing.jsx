import React, { useEffect, useRef, useState } from 'react';
import { managedCloudRequest, cloudWriteIntent } from './managed-clouds.mjs';
import { sharingPath, sharingBody, sharingScopeLabel, sharingError } from './cloud-sharing.mjs';
import { SharingProducts } from './SharingProducts.jsx';
import './cloud-sharing.css';

export function CloudSharing({ cloudId, onAccessLost }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const intent = useRef(null), busyRef = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setData(null); setError('');
    Promise.all([
      managedCloudRequest(`${sharingPath(cloudId, 'members')}?limit=25&offset=${offset}`, { signal: controller.signal }),
      managedCloudRequest(sharingPath(cloudId, 'members/invitations'), { signal: controller.signal }),
    ]).then(([members, invitations]) => { if (!controller.signal.aborted) setData({ ...members, ...invitations }); })
      .catch(err => { if (!controller.signal.aborted) { setError(sharingError(err)); setForm(null); setConfirm(null); if ([401,403,404].includes(err.status)) onAccessLost?.(err); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cloudId, offset, refresh]);

  async function write(method, path, body) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const next = cloudWriteIntent(intent.current, method, path, body); intent.current = next;
    try {
      await managedCloudRequest(path, { method, body, key: next.key });
      if (mounted.current) { intent.current = null; setForm(null); setConfirm(null); setNotice('Request completed. Reloading current invitations and membership scopes.'); setRefresh(v => v + 1); }
    } catch (err) {
      if (mounted.current) {
        setError(sharingError(err));
        if ([401, 403, 404].includes(err.status)) { setData(null); setForm(null); setConfirm(null); onAccessLost?.(err); }
      }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function edit(member) {
    intent.current = null; setConfirm(null);
    setForm({ userId: member?.user_id || '', email: member?.email || '', role: member?.role || 'viewer', kind: member?.access_scope?.kind || 'selected_products', productIds: member?.access_scope?.product_ids || [], confirmAll: false });
  }
  function submit(event) {
    event.preventDefault();
    try { const body = sharingBody(form); write(form.userId ? 'PATCH' : 'POST', sharingPath(cloudId, form.userId ? 'members' : 'members/invitations', form.userId), body); }
    catch (err) { setError(err.message); }
  }
  return <section className="my-clouds-panel cloud-sharing" aria-label="Cloud sharing">
    <h2>Members and sharing</h2>
    <p>Start with read-only access to selected Products. Choose entire-cloud access only when the collaborator should also see every current and future Product.</p>
    {error && <p role="alert">{error} <button disabled={busy} onClick={() => setRefresh(v => v + 1)}>Refresh sharing</button></p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">Loading current grants…</p>}
    {data && <>
      <button disabled={busy} onClick={() => edit(null)}>Share cloud</button>
      {form && <form onSubmit={submit}><h3>{form.userId ? 'Change access' : 'Invite verified developer'}</h3>
        {!form.userId && <label>Developer email<input type="email" required value={form.email} disabled={busy} onChange={e => setForm({ ...form, email: e.target.value })} /></label>}
        <label>Role<select value={form.role} disabled={busy} onChange={e => setForm({ ...form, role: e.target.value })}><option value="viewer">Viewer — read-only</option><option value="admin">Admin — existing management permissions</option><option value="member">Member — existing member permissions</option></select></label>
        {form.role === 'viewer' ? <>
          <label>Access scope<select value={form.kind} disabled={busy} onChange={e => setForm({ ...form, kind: e.target.value, confirmAll: false })}><option value="selected_products">Selected Products (default)</option><option value="all_products">Entire cloud — current and future Products</option></select></label>
          {form.kind === 'all_products' ? <label><input type="checkbox" checked={form.confirmAll} disabled={busy} onChange={e => setForm({ ...form, confirmAll: e.target.checked })} />I authorize read-only access to every current and future Product in this cloud.</label> : <SharingProducts cloudId={cloudId} selectedIds={form.productIds} disabled={busy} onChange={productIds => setForm(current => current && { ...current, productIds })} onAccessLost={onAccessLost} />}
        </> : <p>This is not a read-only role. Its existing cloud permissions apply; it still does not grant ownership or Billing access.</p>}
        <p>New invitations require acceptance by the matching global account and expire after 30 minutes. Changing a pending invitation requires canceling it and creating another.</p>
        <div className="my-clouds-actions"><button type="submit" disabled={busy}>{busy ? 'Submitting…' : form.userId ? 'Save access' : 'Send invitation'}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel form</button></div>
      </form>}
      <h3>Current members</h3>
      {(data.members || []).map(m => <article key={m.user_id}><h4>{m.display_name || m.email || m.user_id} · {m.role}</h4><p>{sharingScopeLabel(m)}{m.disabled_at ? ' · Disabled' : ''}</p>{m.role !== 'owner' && <div className="my-clouds-actions"><button disabled={busy} onClick={() => edit(m)}>Change access</button><button disabled={busy} onClick={() => { setForm(null); setConfirm({ method: 'DELETE', path: sharingPath(cloudId, 'members', m.user_id), label: `Remove ${m.email || m.user_id}? All Product grants become invalid; rejoining will not restore them.` }); }}>Remove access</button><button disabled={busy} onClick={() => { setForm(null); setConfirm({ method: 'PATCH', path: sharingPath(cloudId, 'members', m.user_id, m.disabled_at ? 'enable' : 'disable'), body: {}, label: `${m.disabled_at ? 'Enable' : 'Disable'} ${m.email || m.user_id}? Current authority is rechecked by the server.` }); }}>{m.disabled_at ? 'Enable' : 'Disable'}</button></div>}</article>)}
      <nav aria-label="Member pages"><button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous members</button><span>Members: {data.pagination?.total || 0}</span><button disabled={busy || offset + 25 >= (data.pagination?.total || 0)} onClick={() => setOffset(offset + 25)}>Next members</button></nav>
      <h3>Invitations</h3>
      {data.invitations?.length === 0 && <p>No invitations.</p>}
      {(data.invitations || []).map(i => <article key={i.id}><h4>{i.target_email} · {i.status}</h4><p>{sharingScopeLabel(i)} · Expires: {i.expires_at}</p>{i.status === 'pending' && <div className="my-clouds-actions"><button disabled={busy} onClick={() => write('POST', sharingPath(cloudId, 'members/invitations', i.id, 'resend'), {})}>Resend unchanged invitation</button><button disabled={busy} onClick={() => { setForm(null); setConfirm({ method: 'POST', path: sharingPath(cloudId, 'members/invitations', i.id, 'cancel'), body: {}, label: `Cancel the invitation for ${i.target_email}? Its old email token will no longer grant access.` }); }}>Cancel invitation</button></div>}</article>)}
      {confirm && <div role="group" aria-label="Confirm access change"><p>{confirm.label}</p><button disabled={busy} onClick={() => write(confirm.method, confirm.path, confirm.body)}>Confirm access change</button><button disabled={busy} onClick={() => setConfirm(null)}>Keep existing access</button></div>}
    </>}
  </section>;
}
