import { translate } from './i18n/index.mjs';
import React, { useEffect, useState, useRef } from 'react';
import { Dialog } from './ConsoleUI.jsx';
import { cloudAPI, managedCloudRequest } from './managed-clouds.mjs';
import { TestLabDownload } from './TestLabDownload.jsx';

function bindingLabel(device) {
  if (device.retirement_status === 'completed') return translate('Retired');
  if (device.retirement_status === 'failed') return translate('Retirement needs retry');
  if (device.retirement_status) return translate('Retirement in progress');
  if (device.bound) return translate('Bound to your test account');
  return device.bindable ? translate('Not bound') : translate('Bound to another account');
}

function provisionLabel(value) {
  if (value === 'activated') return translate('Activated');
  if (value === 'pending') return translate('Activation pending');
  if (value === 'failed') return translate('Activation failed');
  if (value === 'deactivated') return translate('Deactivated');
  return translate('Not provisioned');
}

function connectionLabel(value) {
  if (value === 'online') return translate('Online');
  if (value === 'offline') return translate('Offline');
  return translate('Unknown');
}

export function TestLabDevices({ cloudId, product, onScope }) {
  const [account, setAccount] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const downloadScope = useRef(0);
  useEffect(() => { setDownloads([]); const epoch = ++downloadScope.current; return () => { if (downloadScope.current === epoch) ++downloadScope.current; }; }, [cloudId]);
  useEffect(() => {
    if (!downloads.some(file => !file.saved)) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [downloads]);
  function retainDownload(file, epoch) {
    if (downloadScope.current === epoch) setDownloads(files => [...files, { ...file, id: crypto.randomUUID(), saved: false }]);
  }
  const [devices, setDevices] = useState([]), [selected, setSelected] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const pendingConfirmation = useRef(null);
  const confirmationTrigger = useRef(null);
  const ask = (key, values) => new Promise(resolve => { confirmationTrigger.current = document.activeElement; pendingConfirmation.current?.(false); pendingConfirmation.current = resolve; setConfirmation({ key, values }); });
  const answer = accepted => { const resolve = pendingConfirmation.current; pendingConfirmation.current = null; setConfirmation(null); resolve?.(accepted); };
  useEffect(() => () => { pendingConfirmation.current?.(false); }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const [provision, setProvision] = useState(null), [publicKey, setPublicKey] = useState('');
  const current = useRef({ cloudId, product }); current.current = { cloudId, product };
  const base = `${cloudAPI(cloudId)}/test-lab/manage`;
  const icon = name => <i className={`fa-solid fa-${name} test-lab-icon`} aria-hidden="true" />;
  useEffect(() => { setAccount(null); setDevices([]); setSelected(''); setProvision(null); }, [cloudId]);
  useEffect(() => { setSelected(''); setDevices([]); setProvision(null); setError(''); }, [cloudId, product, account?.id]);
  const selectedDevice = devices.find(d => d.id === selected && d.bound && !d.retirement_status);
  const selectedState = selectedDevice?.provision_status || '';
  useEffect(() => { onScope(account?.id || '', selected, selectedState, selectedDevice?.name || ''); }, [account?.id, selected, selectedState, selectedDevice?.name]);
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
        setDevices(rows); setSelected(value => rows.some(d => d.id === value && d.bound && !d.retirement_status) ? value : '');
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
      const response = await fetch('/api/developer/test-device-batches', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Accept': 'application/zip', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ brand_cloud_id: cloudId, device_item_profile_id: product, quantity: 1 }) });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/zip')) throw { status: response.status };
      const blob = await response.blob();
      const id = response.headers.get('X-RTK-Test-Device-ID');
      if (!/^[0-9a-f-]{36}$/i.test(id || '') || blob.size < 100) throw new Error('Invalid credential archive');
      retainDownload({ blob, name: `rtk-test-device-${id}.zip`, deviceId: id, label: 'Device credentials ready', kind: 'device' }, epoch);
    });
  }
  function action(d, name, extra = {}) { return managedCloudRequest(`${base}/devices/${d.id}/${name}`, { method: 'POST', body: { product_id: product, account_id: account.id, ...extra } }); }
  async function bind(d) {
    if (!d?.bindable || d.retirement_status || !await ask('Bind {{deviceName}} ({{deviceId}}) to {{email}}?', { deviceName: d.name, deviceId: d.id, email: account.email })) return;
    await perform(async () => { const grant = await action(d, 'grant'); await action(d, 'bind', { claim_token: grant.claim_token }); setSelected(d.id); });
  }
  async function unbind(d) {
    if (!await ask('Unbind {{deviceName}} ({{deviceId}}) from {{email}}? This account loses test access. Device identity, certificates and other accounts are preserved.', { deviceName: d.name, deviceId: d.id, email: account.email })) return;
    // Clear this page's active transports before changing authorization.
    if (selected === d.id) setSelected('');
    await perform(() => action(d, 'unbind'));
  }
  async function retire(d) {
    if (d.retirement_status === 'completed' || d.provision_status === 'pending') return;
    if (!await ask('Safely retire {{deviceName}} ({{deviceId}})? All test bindings and sessions will end, and its certificate can no longer connect. This cannot be undone.', { deviceName: d.name, deviceId: d.id })) return;
    if (selected === d.id) setSelected('');
    await perform(async () => {
      const result = await action(d, 'retire', { operation_id: d.retirement_operation_id || crypto.randomUUID() });
      if (result.status !== 'completed') setError('Device retirement is incomplete. Test access is blocked; retry the retirement action.');
    });
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
  return <section className="test-lab-device-manager" aria-label={translate("Test account and device bindings")}>
    {confirmation && <Dialog role="alertdialog" title={translate("Confirm test action")} returnFocus={confirmationTrigger.current} onClose={() => answer(false)}><p id="test-lab-confirmation-message">{translate(confirmation.key, confirmation.values)}</p><button autoFocus onClick={() => answer(false)}>{translate("Cancel action")}</button><button onClick={() => answer(true)}>{translate("Continue")}</button></Dialog>}
    <fieldset disabled={busy || !!confirmation} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <p>{icon('user-check')}{account ? translate("Testing as {{value0}} — using your Console login.", { value0: account.email }) : product ? translate("Loading your Console test access…") : translate("Select a Product to begin.")}</p>
    {error && <p role="alert" className="test-lab-warning">{translate(error)}</p>}
    <label className="test-lab-device-picker"><strong>{translate("Test device")}</strong><select value={selected} disabled={!account || busy} onChange={event => setSelected(event.target.value)}><option value="">{translate("Choose a device for the tests below")}</option>{devices.filter(d => d.bound && !d.retirement_status).map(d => <option key={d.id} value={d.id}>{d.name} — {connectionLabel(d.connection_status)}</option>)}</select></label>
    <p className="test-lab-device-picker-help">{translate("The MQTT, Device Shadow and WebRTC tests below use the selected device.")}</p>
    {downloads.map(file => <TestLabDownload key={file.id} file={file} onSaved={(saved = true) => setDownloads(files => files.map(item => item.id === file.id ? { ...item, saved } : item))} />)}
    <div className="test-lab-actions"><button disabled={busy || !product} onClick={createDevice}>{icon('plus')}{translate("Create test device")}</button></div>
    <h3>{icon('microchip')}{translate("Test devices")}</h3><p>{translate("Device private keys are available only when a test device is created. If the file is lost, safely retire that device and create a replacement.")}</p>
    {!account ? <p>{translate("Your test devices will appear automatically.")}</p> : !devices.length ? <p>{translate("No test devices in this Product. Create a test device to begin.")}</p> : <div className="table-wrap"><table><thead><tr><th>{translate("Device")}</th><th>{translate("Binding")}</th><th>{translate("Provision")}</th><th>{translate("Connection")}</th><th>{translate("Actions")}</th></tr></thead><tbody>{devices.map(d => <tr key={d.id}><td>{d.name}<small className="test-lab-device-id">{d.id}</small>{downloads.some(file => file.deviceId === d.id) && <button type="button" className="test-lab-download-jump" onClick={() => document.getElementById(`test-lab-download-${d.id}`)?.focus()}>{translate("Go to credential download")}</button>}</td><td>{bindingLabel(d)}</td><td>{provisionLabel(d.provision_status)}</td><td>{connectionLabel(d.connection_status)}</td><td>{!d.retirement_status && d.bindable && !d.bound && <button disabled={busy} onClick={() => bind(d)}>{translate("Bind")}</button>}{!d.retirement_status && d.bound && !['activated', 'pending'].includes(d.provision_status) && <button disabled={busy} onClick={() => { setProvision({ ...d, operation: crypto.randomUUID(), activity: crypto.randomUUID() }); setPublicKey(''); }}>{translate("Provision")}</button>}{!d.retirement_status && d.bound && <button disabled={busy || d.provision_status === 'pending'} onClick={() => unbind(d)}>{icon('link-slash')}{translate("Unbind")}</button>}{d.retirement_status !== 'completed' && <button className="destructive" disabled={busy || d.provision_status === 'pending'} onClick={() => retire(d)}>{d.retirement_status ? translate('Retry retirement') : translate('Safely retire')}</button>}</td></tr>)}</tbody></table></div>}
    {provision && <div className="test-lab-binding-form"><h4>{translate("Provision")} {provision.name}</h4><p>{translate("Cloud activation uses a separate clip-encryption key, not the device certificate key. Generate and save a test key, or paste your existing RSA public key. For retries, reuse the original key and activity ID. Private keys never leave this browser.")}</p><label>{translate("Activity ID")}<input value={provision.activity} onChange={e => setProvision({ ...provision, activity: e.target.value })} /></label><label>{translate("Clip public key")}<textarea rows={5} value={publicKey} onChange={e => setPublicKey(e.target.value)} /></label><button disabled={busy} onClick={generateProvisionKey}>{translate("Generate and download test key")}</button><button disabled={busy || !publicKey || !provision.activity} onClick={async () => { if (await ask('Start cloud provisioning for this bound test device?')) perform(async () => { await action(provision, 'provision', { operation_id: provision.operation, activity_id: provision.activity, clip_public_key: publicKey }); setProvision(null); }); }}>{translate("Start provision")}</button><button disabled={busy} onClick={() => setProvision(null)}>{translate("Cancel")}</button></div>}
    </fieldset>
  </section>;
}
