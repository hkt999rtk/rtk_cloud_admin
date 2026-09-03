import React, { useEffect, useRef, useState } from 'react';
import { cloudRoot, cloudURL, cloudAPI, cloudError, managedCloudRoute, managedCloudRequest, cloudWriteIntent, cloudOperationFromSearch, cloudContextFromSearch, blockerLabels, isCloudID } from './managed-clouds.mjs';
import './my-clouds.css';
import { CloudSharing } from './CloudSharing.jsx';
import { StartOwnerHandoff } from './OwnerHandoff.jsx';
import { CloudProducts } from './CloudProducts.jsx';
import { ProductDevices } from './ProductDevices.jsx';
import { CloudConsoleShell } from './CloudConsoleShell.jsx';
import { rememberCloudPreference } from './cloud-preference.mjs';

function SemanticIcon({ name }) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" />;
}

function ownerAccountEmail(item, me) {
  if (item?.owner_email) return item.owner_email;
  if (item?.owner_user_id && item.owner_user_id === me?.user_id && me?.email) return me.email;
  return 'Owner account unavailable';
}

function lifecycleWarning(status) {
  if (!status || status === 'active') return '';
  if (status === 'pending_activation') return 'Owner activation is required before this cloud can be used.';
  if (status === 'disabled') return 'This cloud is disabled and its features are unavailable.';
  return 'This cloud is unavailable.';
}

function cloudIntroduction(section) {
  if (section === 'products') {
    return 'Products organize the device models you build and sell in this Brand Cloud. A Product usually represents one SKU—a sellable model or variant—or a group of SKUs that share the same technical configuration, firmware, cloud services, and update policy. This keeps devices, releases, and OTA updates separated so changes reach only the intended models. Create a separate Product whenever a SKU needs different firmware, services, or lifecycle rules.';
  }
  if (section === 'members') {
    return 'Members & Access controls who can work in this Brand Cloud and what they can see or change. The owner can invite a verified developer: choose Admin or Member for management work, or Viewer for read-only access to selected Products or the entire cloud. Entire-cloud Viewer access also includes Products created later. Removing access stops both cloud and Product access; Billing, payment methods, private keys, and video playback are never shared.';
  }
  if (section === 'settings') {
    return 'Settings is where you review and update this Brand Cloud’s basic information, transfer ownership, and check whether the cloud can be deleted. Changing its name or description does not change the Cloud ID, tenant slug, Products, or devices. Ownership transfer also moves Billing responsibility, so the current and new owner must complete the handoff checks before the transfer takes effect.';
  }
  return 'This Brand Cloud keeps its Products, devices, team access, and service settings together. Billing is managed separately by the cloud owner.';
}

export function MyCloudsApp() {
  const route = managedCloudRoute(window.location.pathname);
  const cloudId = route?.cloudId || '';
  const navigationCloudId = cloudId ? '' : cloudContextFromSearch(window.location.search);
  const section = route?.section || (cloudId ? 'overview' : 'my-clouds');
  const productId = route?.productId || '';
  const deviceId = route?.deviceId || '';
  const savedOperationId = cloudId ? cloudOperationFromSearch(window.location.search) : '';
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
    setLoading(true); setError(''); setPage(null); setCloud(null); setPreflight(null);
    (async () => {
      try {
        if (!route) throw Object.assign(new Error(), { status: 404 });
        const account = await managedCloudRequest('/api/me', { signal: controller.signal });
        if (!account.authenticated) { window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
        if (!controller.signal.aborted) setMe(account);
        if (account.kind === 'platform_admin') return;
        if (savedOperationId) {
          const result = await managedCloudRequest(`${cloudAPI(cloudId)}/operations/${savedOperationId}`, { signal: controller.signal });
          if (!controller.signal.aborted) setOperation(result.operation);
          return;
        }
        const result = await managedCloudRequest(cloudId ? cloudAPI(cloudId) : `${cloudAPI()}?view=${view}&limit=25&offset=${offset}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!cloudId) {
          const validClouds = (result.brand_clouds || []).filter((item) => isCloudID(item?.id));
          if (validClouds.length !== (result.brand_clouds || []).length) setError('Some clouds could not be displayed because the service returned an invalid cloud ID.');
          setPage({ ...result, brand_clouds: validClouds });
          if (navigationCloudId) {
            try {
              const context = await managedCloudRequest(cloudAPI(navigationCloudId), { signal: controller.signal });
              if (!controller.signal.aborted) {
                if (context.brand_cloud?.id === navigationCloudId) rememberCloudPreference(navigationCloudId);
                setCloud(context.brand_cloud || null);
              }
            } catch (contextError) {
              if (contextError.status === 401) throw contextError;
              if (!controller.signal.aborted) window.history.replaceState({}, '', cloudRoot);
            }
          }
        } else {
          setPage(null);
          if (result.brand_cloud?.id === cloudId) rememberCloudPreference(cloudId);
          setCloud(result.brand_cloud || null);
        }
      } catch (err) { if (!controller.signal.aborted) { setError(cloudError(err)); if ([401,403,404].includes(err.status)) { setForm(null); setOperation(null); } } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [cloudId, navigationCloudId, productId, deviceId, view, offset, reload]);
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
          if ([401,403,404].includes(err.status)) { setOperation(null); setCloud(null); setForm(null); return; }
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
      setPage(null); setCloud(null); setForm(null); setPreflight(null); setOperation(null);
    }
  }
  const canManage = cloud?.capabilities?.includes('cloud.update');
  const canCreate = page && page.owned_count + page.reserved_count < page.owned_limit;
  const shellActive = section === 'products' ? 'product-services' : section === 'members' ? 'access' : section === 'settings' ? 'settings' : 'my-clouds';
  return <CloudConsoleShell me={me} cloud={cloud} clouds={page?.brand_clouds || me?.memberships || []} active={shellActive} title={cloudId ? cloud?.name || 'Brand Cloud' : 'My Clouds'} onError={setError}>
    <div className="my-clouds-main">
      <div className="my-clouds-heading"><div><p className="my-clouds-eyebrow">DEVELOPER CONSOLE</p><p>{cloudId ? cloudIntroduction(section) : 'Create and manage the Brand Clouds you own, or open clouds shared with your account. Select a cloud to work with its Products, Fleet Management, firmware, members, settings, and owner-only Billing.'}</p></div>{!cloudId && page && <button disabled={!canCreate || busy} onClick={() => { intent.current = null; setForm({ id: '', name: '', description: '' }); }}>Create cloud</button>}</div>
      {error && <div role="alert" className="my-clouds-error">{error} <button onClick={() => setReload((v) => v + 1)}>Refresh</button>{error.includes('Sign in') && <a href={loginURL}>Sign in</a>}</div>}
      {me?.kind === 'platform_admin' && <section className="my-clouds-panel"><h2>Platform admin cannot use the Brand Cloud console</h2><p>Switch to Brand Cloud view before opening My Clouds or a cloud-scoped feature.</p></section>}
      {form && <section className="my-clouds-panel"><h2>{form.id ? 'Edit cloud' : 'Create cloud'}</h2><form onSubmit={submit}><label>Name<input required maxLength={255} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={busy} /></label><label>Description<textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={busy} /></label><p>The cloud ID and tenant slug do not change when renamed.</p><div className="my-clouds-actions"><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save cloud'}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div></form></section>}
      {!cloudId && <><div className="my-clouds-tabs" role="group" aria-label="Cloud visibility">{[['all', 'All clouds'], ['owned', 'I own'], ['shared', 'Shared with me']].map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => { setView(id); setOffset(0); }}>{label}</button>)}</div>{page && <p className="my-clouds-quota">Owned: {page.owned_count} / {page.owned_limit} · Reserved for transfers: {page.reserved_count} · Matching clouds: {page.pagination.total}</p>}{loading ? <p role="status">Loading clouds…</p> : page && <>{page.brand_clouds.length === 0 ? <section className="my-clouds-panel"><h2>No clouds in this view</h2><p>Create a cloud or accept an owner’s invitation. Shared clouds do not use your ownership quota.</p></section> : <div className="my-clouds-grid">{page.brand_clouds.map((item) => <article className="my-clouds-panel" key={item.id}><div className="my-clouds-card-head"><h2><a href={cloudURL(item.id)}>{item.name}</a></h2><span className="my-clouds-role">{item.my_role}</span></div><p>{item.description || 'No description'}</p><dl><dt>Owner</dt><dd>{ownerAccountEmail(item, me)}</dd></dl>{lifecycleWarning(item.status) && <p className="my-clouds-lifecycle-warning" role="status">{lifecycleWarning(item.status)}</p>}<div className="my-clouds-actions"><a href={cloudURL(item.id)}>Open cloud →</a>{item.capabilities.includes('cloud.update') && <button onClick={() => { intent.current = null; setForm({ id: item.id, name: item.name, description: item.description }); }}>Edit</button>}</div></article>)}</div>}<nav className="my-clouds-pagination" aria-label="Cloud pages"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><span>Page {Math.floor(offset / 25) + 1}</span><button disabled={offset + 25 >= page.pagination.total} onClick={() => setOffset(offset + 25)}>Next</button></nav></>}</>}
      {cloudId && loading && <p role="status">Loading cloud…</p>}
      {cloud && section === 'members' && !productId && !operation && cloud.my_role === 'owner' && cloud.capabilities?.includes('team.manage') && <CloudSharing key={`sharing:${cloudId}`} cloudId={cloudId} onAccessLost={showRequestError} />}
      {cloud && section === 'members' && !productId && !operation && !(cloud.my_role === 'owner' && cloud.capabilities?.includes('team.manage')) && <section className="my-clouds-panel"><h2>Members &amp; Access</h2><p>Your current role can use only its authorized Product scope. Only this cloud’s owner can invite, change, or revoke collaborators.</p></section>}
      {cloud && section === 'settings' && !productId && !operation && cloud.my_role === 'owner' && <StartOwnerHandoff key={`handoff:${cloudId}`} cloudId={cloudId} />}
      {cloud && section === 'settings' && !productId && !operation && cloud.my_role === 'owner' && cloud.capabilities?.includes('billing_account.read') && <a href={`${cloudURL(cloudId)}/billing`}>Manage this cloud’s Billing</a>}
      {cloud && section === 'settings' && !operation && <section className="my-clouds-panel"><h2><SemanticIcon name="gear" />Cloud settings</h2><dl><dt><SemanticIcon name="cloud" />Cloud name</dt><dd>{cloud.name}</dd><dt><SemanticIcon name="file-lines" />Description</dt><dd>{cloud.description || 'No description'}</dd><dt><SemanticIcon name="fingerprint" />Cloud ID</dt><dd>{cloud.id}</dd><dt><SemanticIcon name="tag" />Tenant slug</dt><dd>{cloud.tenant_slug || 'Unavailable'}</dd><dt><SemanticIcon name="envelope" />Owner email</dt><dd>{ownerAccountEmail(cloud, me)}</dd><dt><SemanticIcon name="id-card" />Owner ID</dt><dd>{cloud.owner_user_id || 'Unavailable'}</dd><dt><SemanticIcon name="user-shield" />My role</dt><dd>{cloud.my_role}</dd></dl>{lifecycleWarning(cloud.status) && <p className="my-clouds-lifecycle-warning" role="status"><SemanticIcon name="triangle-exclamation" />{lifecycleWarning(cloud.status)}</p>}{canManage && <div className="my-clouds-actions"><button className="icon-text" disabled={busy} onClick={() => { intent.current = null; setForm({ id: cloud.id, name: cloud.name, description: cloud.description }); }}><SemanticIcon name="pen-to-square" />Edit cloud</button><button className="my-clouds-danger icon-text" disabled={busy} onClick={checkDeletion}><SemanticIcon name="trash-can" />Check deletion</button></div>}</section>}
      {cloud && section === 'products' && !operation && <CloudProducts key={`${cloudId}/${productId}`} cloudId={cloudId} productId={productId} onAccessLost={showRequestError} />}
      {preflight && <section className="my-clouds-panel"><h2>Delete this cloud?</h2><p>Only an empty, fully settled cloud with zero balance can be deleted. Audit and Billing history are retained. Ownership transfer has a different rule: balance must be nonnegative.</p><Blockers items={preflight.blockers} />{preflight.eligible ? <button className="my-clouds-danger" disabled={busy} onClick={deleteCloud}>{busy ? 'Submitting…' : 'Confirm cloud deletion'}</button> : <p>Deletion is blocked. Resolve the reasons above, then check again.</p>}</section>}
      {operation && <section className="my-clouds-panel" aria-live="polite"><h2>{operation.state === 'succeeded' ? 'Cloud deleted' : operation.state === 'canceled' ? 'Deletion canceled' : 'Deletion in progress'}</h2><p>{operation.phase} · {operation.id}</p><Blockers items={operation.blockers} />{operation.state !== 'succeeded' && <p>Do not treat a submitted request as completion. Recovery continues on the server.</p>}<a href={cloudRoot}>Return to My Clouds</a></section>}
      {cloud && productId && !operation && <ProductDevices key={`${cloudId}/${productId}/${deviceId}`} cloudId={cloudId} productId={productId} deviceId={deviceId} onAccessLost={showRequestError} />}
    </div>
  </CloudConsoleShell>;
}
function Blockers({ items = [] }) { return <ul>{items.map((item, index) => <li key={`${item.code}-${index}`}>{blockerLabels[item.code] || item.code}{item.count != null ? ` (${item.count})` : ''}{item.balance_minor != null ? ` · balance (minor units): ${item.balance_minor}` : ''}</li>)}</ul>; }
