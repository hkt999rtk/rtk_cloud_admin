import React, { useEffect, useState, useRef } from 'react';
import { Dialog } from './ConsoleUI.jsx';
import { cloudAPI, managedCloudRequest } from './managed-clouds.mjs';
import { TestLabDownload } from './TestLabDownload.jsx';

export function TestLabDevices({ cloudId, product, onScope }) {
  const [account, setAccount] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const downloadScope = useRef(0);
  useEffect(() => { setDownloads([]); const epoch = ++downloadScope.current; return () => { if (downloadScope.current === epoch) ++downloadScope.current; }; }, [cloudId, product]);
  useEffect(() => {
    if (!downloads.some(file => !file.saved)) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [downloads]);
  function retainDownload(file, epoch) {
    if (downloadScope.current === epoch) setDownloads(files => [...files, { ...file, id: crypto.randomUUID(), saved: false }]);
  }
  const [devices, setDevices] = useState([]), [selected, setSelected] = useState(''), [candidate, setCandidate] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const pendingConfirmation = useRef(null);
  const confirmationTrigger = useRef(null);
  const ask = message => new Promise(resolve => { confirmationTrigger.current = document.activeElement; pendingConfirmation.current?.(false); pendingConfirmation.current = resolve; setConfirmation(message); });
  const answer = accepted => { const resolve = pendingConfirmation.current; pendingConfirmation.current = null; setConfirmation(null); resolve?.(accepted); };
  useEffect(() => () => { pendingConfirmation.current?.(false); }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const [showBind, setShowBind] = useState(false), [provision, setProvision] = useState(null), [publicKey, setPublicKey] = useState('');
  const current = useRef({ cloudId, product }); current.current = { cloudId, product };
  const base = `${cloudAPI(cloudId)}/test-lab/manage`;
  const icon = name => <i className={`fa-solid fa-${name} test-lab-icon`} aria-hidden="true" />;
  useEffect(() => { setAccount(null); setDevices([]); setSelected(''); setProvision(null); }, [cloudId]);
  useEffect(() => { setSelected(''); setDevices([]); setCandidate(''); setShowBind(false); setProvision(null); setError(''); }, [cloudId, product, account?.id]);
  const selectedState = devices.find(d => d.id === selected)?.provision_status || '';
  useEffect(() => { onScope(account?.id || '', selected, selectedState); }, [account?.id, selected, selectedState]);
  useEffect(() => {
    if (!account || !product) return;
    const controller = new AbortController(); let running = false;
    async function refresh() {
      if (running) return; running = true;
      try {
        let rows = [], offset = 0, more;
        do {
          const result = await managedCloudRequest(`${base}/devices?${new URLSearchParams({ account_id: account.id, product_id: product, limit: '25', offset: String(offset) })}`, { signal: controller.signal });
          rows = rows.concat(result.devices); more = result.has_more; offset = result.next_offset;
        } while (more && !controller.signal.aborted);
        if (controller.signal.aborted) return;
        setDevices(rows); setSelected(value => rows.some(d => d.id === value && d.bound) ? value : '');
      } catch (e) { if (!controller.signal.aborted) { setDevices([]); setSelected(''); setError('Unable to verify Console access. Reload the page or sign in to Console again.'); } }
      finally { running = false; }
    }
    refresh(); const timer = setInterval(refresh, 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [base, product, account?.id, version]);
  async function perform(work) {
    if (busy) return; setBusy(true); setError(''); const origin = { ...current.current };
    try { await work(); if (origin.cloudId === current.current.cloudId && origin.product === current.current.product) setVersion(v => v + 1); }
    catch (e) { if (origin.cloudId === current.current.cloudId && origin.product === current.current.product) setError(`Request failed${e.status ? ` (HTTP ${e.status})` : ''}. Verify Console permissions, device binding and provisioning inputs, then retry.`); }
    finally { setBusy(false); }
  }
  // Reuse/renew a server-scoped testing identity from the Console login.
  useEffect(() => {
    if (!product) return;
    const controller = new AbortController(); let running = false;
    async function connectAccount() {
      if (running) return; running = true;
      try {
        const result = await managedCloudRequest(`${base}/accounts`, { method: 'POST', body: {}, signal: controller.signal });
        if (!controller.signal.aborted) setAccount(result);
      } catch {
        if (!controller.signal.aborted) { setAccount(null); setSelected(''); setError('Unable to use your Console account. Check access or sign in to Console again.'); }
      } finally { running = false; }
    }
    connectAccount(); const timer = setInterval(connectAccount, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [base, product]);
  async function createDevice() {
    if (!await ask('Create one test device and prepare its private key and certificate for download? Save the file using the download panel before leaving this page.')) return;
    const epoch = downloadScope.current;
    await perform(async () => {
      const response = await fetch('/api/developer/test-device-batches', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ brand_cloud_id: cloudId, device_item_profile_id: product, quantity: 1 }) });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('rtk-certificate-bundle+json')) throw { status: response.status };
      const blob = await response.blob();
      const bundle = JSON.parse(await blob.text());
      const id = bundle.identity?.id;
      if (!/^[0-9a-f-]{36}$/i.test(id || '') || !bundle.key?.material?.private_key_pem || !bundle.certificate?.chain_pem?.length) throw new Error('Invalid credential bundle');
      retainDownload({ blob, name: `rtk-test-device-${id}.json`, label: 'Device credentials ready', kind: 'device' }, epoch);
    });
  }
  function action(d, name, extra = {}) { return managedCloudRequest(`${base}/devices/${d.id}/${name}`, { method: 'POST', body: { product_id: product, account_id: account.id, ...extra } }); }
  async function bind() {
    const d = devices.find(d => d.id === candidate && d.bindable); if (!d || !await ask(`Bind ${d.name} (${d.id}) to ${account.email}?`)) return;
    await perform(async () => { const grant = await action(d, 'grant'); await action(d, 'bind', { claim_token: grant.claim_token }); setShowBind(false); setSelected(d.id); });
  }
  async function unbind(d) {
    if (!await ask(`Unbind ${d.name} (${d.id}) from ${account.email}? This account loses test access. Device identity, certificates and other accounts are preserved.`)) return;
    // Clear this page's active transports before changing authorization.
    if (selected === d.id) setSelected('');
    await perform(() => action(d, 'unbind'));
  }
  async function generateProvisionKey() {
    const epoch = downloadScope.current;
    await perform(async () => {
      const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
      const pem = (name, bytes) => `-----BEGIN ${name}-----\n${btoa(String.fromCharCode(...new Uint8Array(bytes))).match(/.{1,64}/g).join('\n')}\n-----END ${name}-----\n`;
      const pub = pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', keys.publicKey));
      const priv = pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', keys.privateKey));
      const blob = new Blob([JSON.stringify({ device_id: provision.id, activity_id: provision.activity, clip_public_key: pub, clip_private_key: priv }, null, 2)], { type: 'application/json' });
      retainDownload({ blob, name: `test-provision-${provision.id}-${provision.activity}.json`, label: 'Provision key ready', kind: 'provision' }, epoch);
      if (downloadScope.current === epoch) setPublicKey(pub);
    });
  }
  return <section className="test-lab-device-manager" aria-label="Test account and device bindings">
    {confirmation && <Dialog role="alertdialog" title="Confirm test action" returnFocus={confirmationTrigger.current} onClose={() => answer(false)}><p id="test-lab-confirmation-message">{confirmation}</p><button autoFocus onClick={() => answer(false)}>Cancel action</button><button onClick={() => answer(true)}>Continue</button></Dialog>}
    <fieldset disabled={busy || !!confirmation} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <p>{icon('user-check')}{account ? `Testing as ${account.email} — using your Console login.` : product ? 'Loading your Console test access…' : 'Select a Product to begin.'}</p>
    {error && <p role="alert" className="test-lab-warning">{error}</p>}
    {downloads.map(file => <TestLabDownload key={file.id} file={file} onSaved={(saved = true) => setDownloads(files => files.map(item => item.id === file.id ? { ...item, saved } : item))} />)}
    <div className="test-lab-actions"><button disabled={busy || !product} onClick={createDevice}>{icon('plus')}Create test device</button><button disabled={busy || !account || !product} onClick={() => setShowBind(v => !v)}>{icon('link')}Bind device</button></div>
    {showBind && <div className="test-lab-binding-form"><label>Unbound test device<select value={candidate} onChange={e => setCandidate(e.target.value)}><option value="">Select a test device</option>{devices.filter(d => d.bindable).map(d => <option key={d.id} value={d.id}>{d.name} — {d.id}</option>)}</select></label><p>Only server-verified test-issued devices are eligible. Binding uses a fresh, developer-approved test authorization, not a production claim override.</p><button disabled={busy || !candidate} onClick={bind}>Confirm bind</button></div>}
    <h3>{icon('microchip')}Bound devices</h3><p>Bound, provisioned and online are separate states. Load the downloaded device credentials into your test board or device client to connect it.</p>
    {!account ? <p>Your bound test devices will appear automatically.</p> : !devices.some(d => d.bound) ? <p>No bound test devices in this Product. Create or bind a test device to begin.</p> : <div className="table-wrap"><table><thead><tr><th>Device</th><th>Provision</th><th>Connection</th><th>Actions</th></tr></thead><tbody>{devices.filter(d => d.bound).map(d => <tr key={d.id}><td>{d.name}<small className="test-lab-device-id">{d.id}</small></td><td>{d.provision_status}</td><td>{d.connection_status === 'online' || d.connection_status === 'offline' ? d.connection_status : 'Unknown'}</td><td><button disabled={busy} aria-pressed={selected === d.id} onClick={() => setSelected(d.id)}>{selected === d.id ? 'Selected' : 'Select'}</button>{!['activated', 'pending'].includes(d.provision_status) && <button disabled={busy} onClick={() => { setProvision({ ...d, operation: crypto.randomUUID(), activity: crypto.randomUUID() }); setPublicKey(''); }}>Provision</button>}<button disabled={busy || d.provision_status === 'pending'} onClick={() => unbind(d)}>{icon('link-slash')}Unbind</button></td></tr>)}</tbody></table></div>}
    {provision && <div className="test-lab-binding-form"><h4>Provision {provision.name}</h4><p>Cloud activation uses a separate clip-encryption key, not the device certificate key. Generate and save a test key, or paste your existing RSA public key. For retries, reuse the original key and activity ID. Private keys never leave this browser.</p><label>Activity ID<input value={provision.activity} onChange={e => setProvision({ ...provision, activity: e.target.value })} /></label><label>Clip public key<textarea rows={5} value={publicKey} onChange={e => setPublicKey(e.target.value)} /></label><button disabled={busy} onClick={generateProvisionKey}>Generate and download test key</button><button disabled={busy || !publicKey || !provision.activity} onClick={async () => { if (await ask('Start cloud provisioning for this bound test device?')) perform(async () => { await action(provision, 'provision', { operation_id: provision.operation, activity_id: provision.activity, clip_public_key: publicKey }); setProvision(null); }); }}>Start provision</button><button disabled={busy} onClick={() => setProvision(null)}>Cancel</button></div>}
    </fieldset>
  </section>;
}
