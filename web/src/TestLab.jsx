import { translate } from './i18n/index.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { managedCloudRequest, isCloudID } from './managed-clouds.mjs';
import { fetchCloudProducts } from './cloud-products.mjs';
import { TestLabDevices } from './TestLabDevices.jsx';
import { Dialog } from './ConsoleUI.jsx';
import { testLabContextURL, parseTestPayload, diagnosticReport, labBlockedMessage, validatePublishTopic, shadowTopic, loadLabOptions, labOperationError } from './test-lab.mjs';
import './test-lab.css';
import { LabRuntime } from './test-lab-runtime.mjs';

// Labels remain accessible; icons supplement meaning without being read twice.
function LabIcon({ name }) {
  return <i className={`fa-solid fa-${name} test-lab-icon`} aria-hidden="true" />;
}
const protocolIcons = { mqtt: 'comments', shadow: 'layer-group', webrtc: 'video' };

export function TestLab({ cloudId }) {
  const query = new URLSearchParams(window.location.search);
  const [product, setProduct] = useState(isCloudID(query.get('product_id')) ? query.get('product_id') : '');
  const [device, setDevice] = useState(''), [account, setAccount] = useState(''), [provisionState,setProvisionState]=useState('');
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productNameError, setProductNameError] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [context, setContext] = useState(null), [error, setError] = useState('');
  const [tab, setTab] = useState('mqtt'), [events, setEvents] = useState([]);
  const [topic, setTopic] = useState(''), [payload, setPayload] = useState('{}');
  const [shadowName, setShadowName] = useState(''), [transport, setTransport] = useState('http');
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const runtime = useRef(null), video = useRef(null), audio = useRef(null);
  const [busy, setBusy] = useState(false), [connected, setConnected] = useState(false), [playing, setPlaying] = useState(false);
  const [microphone, setMicrophone] = useState(false), [micStatus, setMicStatus] = useState('off');
  const [deviceAudio, setDeviceAudio] = useState('waiting'), [speaker, setSpeaker] = useState('off');
  const [pendingAction, setPendingAction] = useState(null);
  const [messages, setMessages] = useState([]), [shadow, setShadow] = useState(null), [shadowNotFound, setShadowNotFound] = useState(false), [stats, setStats] = useState(null);
  const [subscription, setSubscription] = useState('');
  const record = (operation, outcome, status) => setEvents(rows => [...rows.slice(-499), { time: new Date().toISOString(), operation, outcome, status }]);

  useEffect(() => {
    setPendingAction(null);
    setConnected(false); setPlaying(false); setMicrophone(false); setMicStatus('off'); setDeviceAudio('waiting'); setSpeaker('off'); setMessages([]); setShadow(null); setShadowNotFound(false); setStats(null);
    if (!context?.runtime_ready) return undefined;
    let active = true;
    const lab = new LabRuntime(context,
      (operation, outcome, status) => { if (!active) return; record(operation, outcome, status); if (operation === 'mqtt') setConnected(outcome === 'connected'); if (operation === 'device_audio') setDeviceAudio(outcome); if (operation === 'speaker') setSpeaker(outcome); if (operation === 'microphone') { setMicrophone(outcome === 'enabled'); setMicStatus(outcome); } if (operation === 'webrtc' && outcome === 'stopped') { setPlaying(false); setMicrophone(false); setMicStatus('off'); setDeviceAudio('waiting'); setSpeaker('off'); } if (operation === 'session' && outcome === 'closed') { setConnected(false); setPlaying(false); setMicrophone(false); setMicStatus('off'); setSpeaker('off'); } },
      (topic, text) => { if (active) setMessages(rows => [...rows.slice(-99), { topic, text }]); },
      value => { if (active) setStats(value); });
    runtime.current = lab; setSubscription(`devices/${context.devid}/up/messages`);
    const dispose = () => lab.dispose(); window.addEventListener('pagehide', dispose);
    return () => { active = false; window.removeEventListener('pagehide', dispose); lab.dispose(); if (runtime.current === lab) runtime.current = null; };
  }, [context]);

  async function run(operation, work, confirmation = '') {
    if (busy || !runtime.current) return;
    if (confirmation) { setPendingAction({ operation, work, confirmation, lab: runtime.current }); return; }
    const lab = runtime.current; setBusy(true); setError('');
    try { await work(lab); if (runtime.current === lab) record(operation, 'completed'); }
    catch (e) { if (runtime.current === lab) { const failure = labOperationError(operation, e.status); setError(failure.shadowNotFound ? '' : failure.message); setShadowNotFound(failure.shadowNotFound); if (failure.shadowNotFound) setShadow(null); record(operation, failure.outcome, e.status); if (failure.releaseContext) { lab.dispose(); setContext(null); } } }
    finally { setBusy(false); }
  }
  function shadowAction(operation) {
    const capability = transport === 'mqtt' ? 'shadow_mqtt' : 'shadow_http';
    if (!context?.capabilities?.[capability]) return;
    run(`shadow_${operation}`, async lab => {
      const payloadValue = operation === 'update' ? parseTestPayload(payload) : undefined;
      if (operation === 'update' && (!payloadValue.state || Object.keys(payloadValue.state).some(key => key !== 'desired'))) throw new Error('Only desired state may be edited');
      const result = await lab.shadow(transport, shadowName, operation, payloadValue);
      if (runtime.current === lab) { setShadow(operation === 'delete' ? null : result); setShadowNotFound(operation === 'delete'); }
    }, operation === 'get' ? '' : `${operation === 'delete' ? 'Delete' : 'Update desired state for'} this real device Shadow in ${context.environment}?`);
  }

  useEffect(() => {
    const controller = new AbortController();
    setProducts([]); setProductsLoading(true);
    loadLabOptions(offset => fetchCloudProducts(cloudId, '', { offset, signal: controller.signal }), 'products', controller.signal, setProducts)
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load all authorized Products. Reload devices & access to retry.'); })
      .finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, [cloudId, reload]);

  // Resolve a deep-linked or off-page selection without using its UUID as the
  // human-facing option label. The ID remains the stable request/option value.
  useEffect(() => {
    const controller = new AbortController();
    setSelectedProduct(null); setProductNameError('');
    if (product) fetchCloudProducts(cloudId, product, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSelectedProduct(result.products[0]); })
      .catch(() => { if (!controller.signal.aborted) setProductNameError('Unable to load the selected Product name. Refresh your access.'); });
    return () => controller.abort();
  }, [cloudId, product, reload]);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setContext(null); setError(''); setLoading(Boolean(product && device));
    if (product && device && account) managedCloudRequest(testLabContextURL(cloudId, product, device,account), { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted || generation.current !== current) return;
        if (result.brand_cloud_id !== cloudId || result.product_id !== product || result.device_id !== device) throw new Error('Invalid context');
        setContext(result); setTopic(result.devid ? `devices/${result.devid}/down/commands` : ''); record('context', 'loaded');
      })
      .catch(e => { if (!controller.signal.aborted) { setError(e.status === 404 ? 'Test Lab is disabled, or the selected device is no longer available.' : 'Cannot validate test access. No live connection has been made.'); record('context', 'failed', e.status); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cloudId, product, device, account,provisionState,reload]);

  function selectProtocol(id) {
    if (busy) return;
    if (tab === 'webrtc' && id !== tab) {
      runtime.current?.stopVideo().catch(() => {});
      setPlaying(false); setMicrophone(false); setMicStatus('off'); setDeviceAudio('waiting'); setSpeaker('off'); setStats(null);
    }
    setTab(id);
  }
  function protocolKey(event) {
    const protocols = ['mqtt', 'shadow', 'webrtc'];
    const current = protocols.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
      : event.key === 'ArrowRight' ? (current + 1) % 3
      : event.key === 'ArrowLeft' ? (current + 2) % 3 : -1;
    if (next < 0 || busy) return;
    event.preventDefault();
    selectProtocol(protocols[next]);
    event.currentTarget.parentElement.querySelector('#tab-' + protocols[next])?.focus();
  }

  function validate() {
    try {
      parseTestPayload(payload);
      if (tab === 'mqtt') validatePublishTopic(topic);
      if (tab === 'shadow') shadowTopic(context?.devid || '', shadowName, 'update');
      setError(''); record('local_validation', 'passed');
    } catch (e) { setError(e.message); record('local_validation', 'failed'); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(diagnosticReport(context, events), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cloud-test-lab-report.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="my-clouds-panel test-lab" data-testid="test-lab">
    <h2><LabIcon name="flask" />{translate("Device test workspace")}</h2><details className="test-lab-intro"><summary>{translate("About the test workflows")}</summary><p>{translate("Test and debug your device directly in the Developer Console — without first building an App, MQTT client or WebRTC Viewer. Select a Product and device to send and receive MQTT messages, read or update Device Shadow state, and test live video and two-way audio over WebRTC. Use these tools to check device behavior and troubleshoot cloud integration before writing your own application. Available tests depend on your permissions and the services enabled for the selected device.")}</p></details>
    <div className="test-lab-selectors">
      <div><label><span><LabIcon name="boxes-stacked" />{translate("Product")}</span><select value={product} aria-describedby={product ? 'test-lab-product-id' : undefined} onChange={e => { setProduct(e.target.value); setDevice(''); setContext(null); setEvents([]); }}><option value="">{translate("Select Product")}</option>{product && !products.some(p => p.id === product) && <option value={product}>{selectedProduct?.id === product ? selectedProduct.name || translate("Unnamed Product") : translate("Loading selected Product…")}</option>}{products.map(p => <option key={p.id} value={p.id}>{p.name || translate("Unnamed Product")}</option>)}</select></label>{product && <p id="test-lab-product-id" className="test-lab-product-id"><LabIcon name="fingerprint" />{translate("Product ID:")} <code>{product}</code></p>}</div>
    </div>
    {productsLoading && <p role="status">{translate("Loading Products…")}</p>}
    {productNameError && <p role="alert" className="test-lab-warning"><LabIcon name="triangle-exclamation" />{translate(productNameError)}</p>}
    <TestLabDevices key={`${cloudId}:${product}`} cloudId={cloudId} product={product} onScope={(a,d,state)=>{setAccount(a);setDevice(d);setProvisionState(state);}} />
    <div className="test-lab-actions"><button disabled={busy} aria-describedby="test-lab-reload-help" onClick={() => { if ((connected || playing) && !window.confirm('Reloading ends the current test connection. Continue?')) return; setReload(v => v + 1); }}><LabIcon name="arrows-rotate" />{translate("Reload devices & access")}</button><small id="test-lab-reload-help">{translate("Reload lists and permissions. Ends the current test connection.")}</small></div>
    {loading && <p role="status"><LabIcon name="hourglass-half" />{translate("Checking device scope…")}</p>}
    {error && <p role="alert" className="test-lab-warning"><LabIcon name="triangle-exclamation" />{translate(error)}</p>}
    {context && <><p className="test-lab-context"><LabIcon name="cloud" />{translate("Environment:")} <strong>{context.environment}</strong> {translate("· Device:")} {context.device_status || translate("unknown")} · <LabIcon name={connected ? 'plug' : 'plug-circle-xmark'} />{translate("MQTT:")} {connected ? 'Connected' : 'Disconnected'}</p>{!context.runtime_ready ? <p role="status" className="test-lab-warning"><LabIcon name="triangle-exclamation" />{labBlockedMessage(context.blocked_reason)}</p> : <p><LabIcon name="circle-info" />{translate("Test authorization lasts 11 minutes. MQTT credentials renew through a fresh connection; messages during renewal may be missed. WebRTC playback runs for up to 10 minutes and may briefly reconnect as media sessions renew. Operations affect your real device.")}</p>}</>}
    <div role="tablist" aria-label={translate("Test protocol")}>{['mqtt', 'shadow', 'webrtc'].map(id => <button key={id} id={`tab-${id}`} role="tab" tabIndex={tab === id ? 0 : -1} disabled={busy} aria-selected={tab === id} aria-controls={`panel-${id}`} onKeyDown={protocolKey} onClick={() => selectProtocol(id)}><LabIcon name={protocolIcons[id]} />{id === 'webrtc' ? translate("WebRTC") : id === 'mqtt' ? translate("MQTT") : translate("Shadow")}</button>)}</div>
    <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'mqtt' && <><h3><LabIcon name="comments" />{translate("MQTT messages")}</h3><p>{translate("Broker acceptance and device response are reported separately. Test ACLs allow this device’s commands and reports only.")}</p><label><span><LabIcon name="arrow-up-from-bracket" />{translate("Publish topic")}</span><input value={topic} maxLength={256} onChange={e => setTopic(e.target.value)} /></label><label><span><LabIcon name="inbox" />{translate("Subscription topic")}</span><input value={subscription} maxLength={256} onChange={e => setSubscription(e.target.value)} /></label><button disabled={busy || connected || !context?.runtime_ready || !context?.capabilities?.mqtt} onClick={() => run('mqtt_connect', lab => lab.connect())}><LabIcon name="plug" />{translate("Connect")}</button><button disabled={!connected || busy} onClick={() => { runtime.current?.disconnect(); setConnected(false); }}><LabIcon name="plug-circle-xmark" />{translate("Disconnect")}</button><button disabled={!connected || busy} onClick={() => run('mqtt_subscribe', lab => lab.subscribe(subscription))}><LabIcon name="bell" />{translate("Subscribe")}</button><button disabled={!connected || busy} onClick={() => run('mqtt_unsubscribe', lab => lab.unsubscribe(subscription))}><LabIcon name="bell-slash" />{translate("Unsubscribe")}</button><button disabled={!connected || busy} onClick={() => run('mqtt_publish', lab => lab.publish(validatePublishTopic(topic), parseTestPayload(payload)), `Publish a command to this real device in ${context.environment}?`)}><LabIcon name="paper-plane" />{translate("Publish")}</button><p><LabIcon name="inbox" />{translate("Recent messages (memory only, not exported)")}</p><pre>{messages.map(m => `${m.topic}\n${m.text}`).join('\n\n')}</pre></>}
      {tab === 'shadow' && <><h3><LabIcon name="layer-group" />{translate("Device Shadow")}</h3><label><span><LabIcon name="tag" />{translate("Shadow name (empty = unnamed)")}</span><input value={shadowName} maxLength={64} onChange={e => { setShadowName(e.target.value); setShadow(null); setShadowNotFound(false); }} /></label><label><span><LabIcon name="route" />{translate("Transport")}</span><select value={transport} onChange={e => { setTransport(e.target.value); setShadow(null); setShadowNotFound(false); }}><option value="http">{translate("HTTP / SigV4")}</option><option value="mqtt">{translate("MQTT")}</option></select></label><p>{translate("Shadow requires the Product's IoT Shadow service option. MQTT Shadow also requires MQTT; legacy HTTP-only Shadow Products can still use HTTP. Reported state comes from your real device. Connect in the MQTT tab before using MQTT Shadow.")}</p>{['get', 'update', 'delete'].map(operation => <button key={operation} disabled={busy || !context?.runtime_ready || !context?.capabilities?.[transport === 'mqtt' ? 'shadow_mqtt' : 'shadow_http'] || (transport === 'mqtt' && !connected)} onClick={() => shadowAction(operation)}><LabIcon name={{ get: 'magnifying-glass', update: 'pen-to-square', delete: 'trash-can' }[operation]} />{operation === 'get' ? translate("Read") : operation === 'update' ? translate("Update desired") : translate("Delete shadow")}</button>)}{shadowNotFound && <p role="status" className="test-lab-info"><LabIcon name="circle-info" />{translate("This Shadow does not exist yet. Use Update desired to create it.")}</p>}<p>{translate("Version:")} {shadow?.version ?? translate("Not read")}</p><button disabled={!shadow} onClick={() => setPayload(JSON.stringify({ state: { desired: shadow.state?.desired || {} }, version: shadow.version }, null, 2))}><LabIcon name="file-import" />{translate("Load desired and version into editor")}</button><div className="test-lab-shadow">{['desired', 'reported', 'delta'].map(name => <section key={name}><h4><LabIcon name={{ desired: 'sliders', reported: 'microchip', delta: 'code-compare' }[name]} />{name}</h4><pre>{shadow ? JSON.stringify(shadow.state?.[name] ?? null, null, 2) : translate("No live state received")}</pre></section>)}</div></>}
      {tab !== 'webrtc' && <><label><span><LabIcon name="code" />{translate("JSON payload")}</span><textarea value={payload} onChange={e => setPayload(e.target.value)} rows={8} spellCheck={false} /></label><div className="test-lab-validation"><button onClick={validate} aria-describedby="test-lab-validation-help"><LabIcon name="list-check" />{translate("Validate locally — no request sent")}</button><p id="test-lab-validation-help">{translate("Checks that your payload is a valid JSON object within 8 KiB and that")} {tab === 'mqtt' ? translate("the publish topic format is valid") : translate("the Shadow name format is valid")}{translate(". Runs only in your browser — no messages are published and no Shadow data is changed. Passing does not confirm device connectivity or whether the device accepts the payload. Results appear in the evidence timeline; errors appear above.")}</p></div></>}
      {tab === 'webrtc' && <div className="test-lab-viewer">
        <h3><LabIcon name="video" />{translate("WebRTC Viewer")}</h3>
        <video ref={video} controls playsInline muted aria-label={translate("Device live video")} />
        <audio ref={audio} controls aria-label={translate("Device live audio")} />
        <div className="test-lab-viewer-toolbar">
          <p className="test-lab-playback-status"><LabIcon name={stats?.decoded ? 'circle-check' : 'circle-info'} />{stats?.decoded ? translate("Video frames decoded.") : translate("No decoded media received. Signaling success alone is not a playback pass.")}</p>
          <div className="test-lab-actions">
            <button disabled={busy || playing || !context?.runtime_ready || !context?.capabilities?.webrtc} onClick={() => run('webrtc_start', async lab => { await lab.startVideo(video.current, audio.current); if (runtime.current === lab) setPlaying(true); }, translate("Start real-device video and audio streaming in {{environment}}? Streaming consumes service usage.", { environment: context.environment }))}><LabIcon name="play" />{translate("Start playback")}</button>
            <button disabled={busy || !playing} onClick={() => run('webrtc_stop', async lab => { await lab.stopVideo(); setPlaying(false); setStats(null); if (video.current) video.current.srcObject = null; })}><LabIcon name="stop" />{translate("Stop playback")}</button>
            <button disabled={busy || !playing || microphone || micStatus === 'unavailable'} onClick={() => run('microphone_enable', async lab => { await lab.enableMicrophone(); setMicrophone(true); })}><LabIcon name="microphone" />{translate("Enable microphone")}</button>
            <button disabled={busy || !microphone} onClick={() => run('microphone_disable', async lab => { await lab.disableMicrophone(); setMicrophone(false); })}><LabIcon name="microphone-slash" />{translate("Mute microphone")}</button>
            <button disabled={!playing || speaker !== 'play_button_required'} onClick={() => run('speaker_enable', lab => lab.enableSpeaker())}><LabIcon name="volume-high" />{translate("Play device audio")}</button>
          </div>
        </div>
        <p role="status">{translate("Device audio:")} {deviceAudio === 'receiving' ? translate("receiving") : deviceAudio === 'unavailable' ? translate("unavailable (video can continue)") : translate("waiting")} · {translate("Speaker:")} {speaker === 'playing' ? translate("playing") : speaker === 'play_button_required' ? translate("press Play device audio") : translate("off")} · {translate("Microphone:")} {microphone ? translate("sending") : micStatus === 'permission_denied' ? translate("permission denied") : micStatus === 'unavailable' ? translate("unavailable (video can continue)") : translate("off")}</p>
        <dl className="test-lab-video-metrics" aria-label={translate("WebRTC diagnostics")}>
          <div className="test-lab-video-metric">
            <dt><LabIcon name="stopwatch" />{translate("First decoded frame")}</dt>
            <dd>{stats?.firstFrameMs != null ? <>{stats.firstFrameMs}<span className="test-lab-metric-unit"> {translate("ms")}</span></> : <span className="test-lab-metric-empty">{translate("Not received")}</span>}</dd>
          </div>
          <div className="test-lab-video-metric">
            <dt><LabIcon name="route" />{translate("ICE / TURN path")}</dt>
            <dd>{stats?.candidateType || <span className="test-lab-metric-empty">{translate("Not connected")}</span>}</dd>
          </div>
          <div className="test-lab-video-metric">
            <dt><LabIcon name="chart-line" />{translate("Video quality")}</dt>
            <dd>{stats ? <>{stats.width ?? '—'} × {stats.height ?? '—'}<span className="test-lab-metric-detail">{stats.fps ?? '—'} {translate("FPS ·")} {stats.bitrate == null ? '—' : (stats.bitrate / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} {translate("kbps")}</span></> : <span className="test-lab-metric-empty">{translate("Not available")}</span>}</dd>
          </div>
          <div className="test-lab-video-metric">
            <dt><LabIcon name="triangle-exclamation" />{translate("Packets lost")}</dt>
            <dd>{stats?.packetsLost != null ? stats.packetsLost : <span className="test-lab-metric-empty">{translate("Not available")}</span>}</dd>
          </div>
          <div className="test-lab-video-metric">
            <dt><LabIcon name="volume-high" />{translate("Device audio packets")}</dt>
            <dd>{stats?.deviceAudioPackets ?? <span className="test-lab-metric-empty">{translate("Not available")}</span>}</dd>
          </div>
          <div className="test-lab-video-metric">
            <dt><LabIcon name="microphone" />{translate("Microphone packets")}</dt>
            <dd>{stats?.microphonePackets ?? <span className="test-lab-metric-empty">{translate("Not available")}</span>}</dd>
          </div>
        </dl>
      </div>}
    </div>
    <h3><LabIcon name="clock-rotate-left" />{translate("Evidence timeline")}</h3><p><LabIcon name="shield-halved" />{translate("Reports exclude payloads, credentials, endpoints and SDP.")}</p><div className="test-lab-actions"><button onClick={download}><LabIcon name="download" />{translate("Download diagnostic report")}</button><button onClick={() => setEvents([])}><LabIcon name="eraser" />{translate("Clear timeline")}</button>
    </div>
    <ol className="test-lab-events">{events.map((event, index) => <li key={index}><time>{event.time}</time> {event.operation}: {event.outcome}</li>)}</ol>
    {pendingAction && <Dialog role="alertdialog" title={translate("Confirm live test action")} onClose={() => setPendingAction(null)}><p>{pendingAction.confirmation}</p><p>{translate("Device:")} <code>{context?.devid}</code></p><button onClick={() => { const action = pendingAction; setPendingAction(null); if (runtime.current === action.lab) run(action.operation, action.work); }}>{translate("Continue")}</button><button onClick={() => setPendingAction(null)}>{translate("Cancel action")}</button></Dialog>}
  </section>;
}
