import React, { useEffect, useRef, useState } from 'react';
import { cloudRoot, cloudURL, cloudAPI, cloudError, managedCloudRoute, managedCloudRequest, cloudWriteIntent, cloudOperationFromSearch, blockerLabels } from './managed-clouds.mjs';
import './my-clouds.css';
import { CloudSharing } from './CloudSharing.jsx';

export function MyCloudsApp() {
  const route = managedCloudRoute(window.location.pathname);
  const cloudId = route?.cloudId || '';
  const productId = route?.productId || '';
  const savedOperationId = cloudId ? cloudOperationFromSearch(window.location.search) : '';
  const [products, setProducts] = useState(null);
  const [productError, setProductError] = useState('');
  const [me, setMe] = useState(null);
  const [page, setPage] = useState(null);
  const [cloud, setCloud] = useState(null);
  const [view, setView] = useState('all');
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [operation, setOperation] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const intent = useRef(null);
  const alive = useRef(true);
  const loginURL = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setPage(null); setCloud(null); setPreflight(null); setProducts(null); setProductError('');
    (async () => {
      try {
        if (!route) throw Object.assign(new Error(), { status: 404 });
        const account = await managedCloudRequest('/api/me', { signal: controller.signal });
        if (!account.authenticated) { window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
        if (savedOperationId) {
          const result = await managedCloudRequest(`${cloudAPI(cloudId)}/operations/${savedOperationId}`, { signal: controller.signal });
          if (!controller.signal.aborted) { setMe(account); setOperation(result.operation); }
          return;
        }
        const result = await managedCloudRequest(cloudId ? cloudAPI(cloudId) : `${cloudAPI()}?view=${view}&limit=25&offset=${offset}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setMe(account); setPage(cloudId ? null : result); setCloud(result.brand_cloud || null);
        if (cloudId && result.brand_cloud?.capabilities.includes('product.read')) {
          try {
            const response = await managedCloudRequest(`${cloudAPI(cloudId)}/products${productId ? `/${productId}` : ''}`, { signal: controller.signal });
            if (!controller.signal.aborted) setProducts(productId ? [response.product] : response.products);
          } catch (err) { if (!controller.signal.aborted) setProductError(cloudError(err)); }
        }
      } catch (err) { if (!controller.signal.aborted) { setError(cloudError(err)); if ([401,403,404].includes(err.status)) { setForm(null); setOperation(null); } } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [cloudId, productId, view, offset, reload]);
  useEffect(() => {
    if (!operation || ['succeeded', 'canceled', 'failed'].includes(operation.state)) return;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      try {
        const result = await managedCloudRequest(`${cloudAPI(operation.brand_cloud_id)}/operations/${operation.id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setOperation(result.operation); setError('');
        if (['succeeded', 'canceled', 'failed'].includes(result.operation.state)) return;
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(cloudError(err));
          if ([401,403,404].includes(err.status)) { setOperation(null); setCloud(null); setProducts(null); setForm(null); return; }
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [operation?.id, operation?.state]);

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    const body = { name: form.name, description: form.description };
    const next = cloudWriteIntent(intent.current, form.id ? 'PATCH' : 'POST', cloudAPI(form.id), body);
    intent.current = next;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await managedCloudRequest(next.path, { method: next.method, body: next.body, key: next.key });
      if (alive.current) { intent.current = null; setForm(null); setReload((v) => v + 1); }
    } catch (err) { if (alive.current) showRequestError(err); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function checkDeletion() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setPreflight(null); setError('');
    try { const result = await managedCloudRequest(`${cloudAPI(cloud.id)}/deletion-preflight`); if (alive.current) setPreflight(result); }
    catch (err) { if (alive.current) showRequestError(err); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function deleteCloud() {
    if (busyRef.current || !preflight?.eligible) return;
    const next = cloudWriteIntent(intent.current, 'DELETE', cloudAPI(cloud.id)); intent.current = next;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await managedCloudRequest(next.path, { method: next.method, key: next.key });
      if (alive.current) { window.history.replaceState({}, '', `${cloudURL(cloud.id)}?operation=${result.operation.id}`); setOperation(result.operation); setPreflight(null); intent.current = null; }
    } catch (err) { if (alive.current) showRequestError(err); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  function showRequestError(err) {
    setError(cloudError(err));
    if ([401,403,404].includes(err.status)) {
      setPage(null); setCloud(null); setProducts(null); setForm(null); setPreflight(null); setOperation(null);
    }
  }
  async function accountAction(view) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(view ? '/api/me/view' : '/api/auth/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(view ? { view } : {}),
      });
      if (!response.ok) throw Object.assign(new Error(), { status: response.status });
      window.location.assign(view ? '/admin' : '/login');
    } catch (err) { if (alive.current) showRequestError(err); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  const canManage = cloud?.capabilities?.includes('cloud.update');
  const canCreate = page && page.owned_count + page.reserved_count < page.owned_limit;
  return <div className="my-clouds-shell">
    <header className="my-clouds-header"><a href={cloudRoot} className="my-clouds-brand">Realtek Connect <span>/ My Clouds</span></a><nav><a href={cloudRoot}>My Clouds</a>{me?.platform_capabilities?.length > 0 && <button disabled={busy} onClick={() => accountAction('platform')}>Platform view</button>}<button disabled={busy} onClick={() => accountAction()}>Logout</button></nav></header>
    <main className="my-clouds-main">
      <div className="my-clouds-heading"><div><p className="my-clouds-eyebrow">DEVELOPER CONSOLE</p><h1>{cloudId ? cloud?.name || 'Cloud management' : 'My Clouds'}</h1><p>{cloudId ? 'Products and collaborators belong to this cloud. Billing remains the sole owner’s responsibility.' : 'Manage the clouds you own and those shared with you.'}</p></div>{!cloudId && page && <button disabled={!canCreate || busy} onClick={() => { intent.current = null; setForm({ id: '', name: '', description: '' }); }}>Create cloud</button>}</div>
      {error && <div role="alert" className="my-clouds-error">{error} <button onClick={() => setReload((v) => v + 1)}>Refresh</button>{error.includes('Sign in') && <a href={loginURL}>Sign in</a>}</div>}
      {form && <section className="my-clouds-panel"><h2>{form.id ? 'Edit cloud' : 'Create cloud'}</h2><form onSubmit={submit}><label>Name<input required maxLength={255} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={busy} /></label><label>Description<textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={busy} /></label><p>The cloud ID and tenant slug do not change when renamed.</p><div className="my-clouds-actions"><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save cloud'}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div></form></section>}
      {!cloudId && <><div className="my-clouds-tabs" role="group" aria-label="Cloud visibility">{[['all', 'All clouds'], ['owned', 'I own'], ['shared', 'Shared with me']].map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => { setView(id); setOffset(0); }}>{label}</button>)}</div>{page && <p className="my-clouds-quota">Owned: {page.owned_count} / {page.owned_limit} · Reserved for transfers: {page.reserved_count} · Matching clouds: {page.pagination.total}</p>}{loading ? <p role="status">Loading clouds…</p> : page && <>{page.brand_clouds.length === 0 ? <section className="my-clouds-panel"><h2>No clouds in this view</h2><p>Create a cloud or accept an owner’s invitation. Shared clouds do not use your ownership quota.</p></section> : <div className="my-clouds-grid">{page.brand_clouds.map((item) => <article className="my-clouds-panel" key={item.id}><div className="my-clouds-card-head"><h2><a href={cloudURL(item.id)}>{item.name}</a></h2><span className="my-clouds-role">{item.my_role}</span></div><p>{item.description || 'No description'}</p><dl><dt>Owner</dt><dd>{item.owner_user_id}</dd><dt>Status</dt><dd>{item.status}</dd></dl><div className="my-clouds-actions"><a href={cloudURL(item.id)}>Open cloud →</a>{item.capabilities.includes('cloud.update') && <button onClick={() => { intent.current = null; setForm({ id: item.id, name: item.name, description: item.description }); }}>Edit</button>}</div></article>)}</div>}<nav className="my-clouds-pagination" aria-label="Cloud pages"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><span>Page {Math.floor(offset / 25) + 1}</span><button disabled={offset + 25 >= page.pagination.total} onClick={() => setOffset(offset + 25)}>Next</button></nav></>}</>}
      {cloudId && loading && <p role="status">Loading cloud…</p>}
      {cloud && !productId && !operation && cloud.my_role === 'owner' && cloud.capabilities?.includes('team.manage') && <CloudSharing key={cloudId} cloudId={cloudId} products={products || []} onAccessLost={showRequestError} />}
      {cloud && !operation && <><section className="my-clouds-panel"><h2>Cloud overview</h2><p>{cloud.description || 'No description'}</p><dl><dt>Owner</dt><dd>{cloud.owner_user_id}</dd><dt>My role</dt><dd>{cloud.my_role}</dd><dt>Cloud ID</dt><dd>{cloud.id}</dd><dt>Tenant slug</dt><dd>{cloud.tenant_slug}</dd><dt>Status</dt><dd>{cloud.status}</dd></dl>{canManage && <div className="my-clouds-actions"><button disabled={busy} onClick={() => { intent.current = null; setForm({ id: cloud.id, name: cloud.name, description: cloud.description }); }}>Edit cloud</button><button className="my-clouds-danger" disabled={busy} onClick={checkDeletion}>Check deletion</button></div>}</section><section className="my-clouds-panel"><h2>{productId ? 'Product overview' : 'Products'}</h2>{productError && <p role="alert">{productError}</p>}{products?.length === 0 && <p>No Products in your authorized scope.</p>}{products?.map((item) => <article key={item.id}><h3>{productId ? item.name : <a href={`${cloudURL(cloudId)}/products/${item.id}`}>{item.name}</a>}</h3><p>{item.profile_key} · {item.status}</p></article>)}{productId && <a href={cloudURL(cloudId)}>Back to this cloud</a>}</section></>}
      {preflight && <section className="my-clouds-panel"><h2>Delete this cloud?</h2><p>Only an empty, fully settled cloud with zero balance can be deleted. Audit and Billing history are retained. Ownership transfer has a different rule: balance must be nonnegative.</p><Blockers items={preflight.blockers} />{preflight.eligible ? <button className="my-clouds-danger" disabled={busy} onClick={deleteCloud}>{busy ? 'Submitting…' : 'Confirm cloud deletion'}</button> : <p>Deletion is blocked. Resolve the reasons above, then check again.</p>}</section>}
      {operation && <section className="my-clouds-panel" aria-live="polite"><h2>{operation.state === 'succeeded' ? 'Cloud deleted' : operation.state === 'canceled' ? 'Deletion canceled' : 'Deletion in progress'}</h2><p>{operation.phase} · {operation.id}</p><Blockers items={operation.blockers} />{operation.state !== 'succeeded' && <p>Do not treat a submitted request as completion. Recovery continues on the server.</p>}<a href={cloudRoot}>Return to My Clouds</a></section>}
    </main>
  </div>;
}
function Blockers({ items = [] }) { return <ul>{items.map((item, index) => <li key={`${item.code}-${index}`}>{blockerLabels[item.code] || item.code}{item.count != null ? ` (${item.count})` : ''}{item.balance_minor != null ? ` · balance (minor units): ${item.balance_minor}` : ''}</li>)}</ul>; }
