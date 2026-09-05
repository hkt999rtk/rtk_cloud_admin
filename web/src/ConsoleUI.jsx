import React, { useEffect, useId, useRef, useState } from 'react';

export function displayLabel(value) {
  if (!value) return 'Not reported';
  const labels = { mqtt: 'MQTT', video_storage: 'Video storage', video_streaming: 'Video streaming', ip_camera: 'IP camera' };
  return labels[value] || String(value).replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function StatusBadge({ value = 'unknown' }) {
  const tone = /^(active|online|succeeded|completed|healthy)$/.test(value) ? 'success' : /^(failed|critical|error)$/.test(value) ? 'danger' : /^(warning|pending|retrying|partial_failed)$/.test(value) ? 'warning' : 'neutral';
  return <span className={`ui-status ui-status-${tone}`}>{displayLabel(value)}</span>;
}

export function CopyValue({ value, label = 'identifier' }) {
  const [message, setMessage] = useState('');
  return <span className="ui-copy"><code>{value || 'Not reported'}</code>{value && <button type="button" aria-label={`Copy ${label}`} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setMessage('Copied'); }
    catch { setMessage('Select the value to copy it.'); }
  }}>Copy</button>}<span role="status">{message}</span></span>;
}

export function Dialog({ title, onClose, busy = false, role = 'dialog', returnFocus, children }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const previous = returnFocus || document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
        .filter(item => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length);
      const target = event.shiftKey && document.activeElement === items[0] ? items.at(-1)
        : !event.shiftKey && document.activeElement === items.at(-1) ? items[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    };
    dialog.addEventListener('keydown', trapFocus);
    return () => {
      dialog.removeEventListener('keydown', trapFocus);
      dialog.close();
      // Restore after React re-enables the triggering fieldset and removes the modal.
      queueMicrotask(() => { if (previous?.isConnected) previous.focus(); });
    };
  }, []);
  return <dialog ref={ref} role={role} className="ui-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>Close</button></header>
    {children}
  </dialog>;
}

export function CustomerAudit({ cloudId }) {
  const [state, setState] = useState({ loading: true, events: [], error: '' });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, events: [], error: '' });
    if (!cloudId) { setState({ loading: false, events: [], error: 'Select a cloud to view its device activity.' }); return () => controller.abort(); }
    fetch(`/api/developer/brand-clouds/${encodeURIComponent(cloudId)}/audit`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? 'Your role cannot view device activity for this cloud.' : 'Device activity could not be loaded. Try again.');
        const body = await response.json();
        if (!Array.isArray(body)) throw new Error('Device activity returned an unexpected response. Try again.');
        if (!controller.signal.aborted) setState({ loading: false, events: body, error: '' });
      }).catch((error) => { if (!controller.signal.aborted) setState({ loading: false, events: [], error: error.message }); });
    return () => controller.abort();
  }, [cloudId, reload]);
  return <section className="panel"><div className="ui-section-heading"><div><h2>Device activity</h2><p>Activity for devices you can access in this cloud. This history does not include all cloud, membership or billing changes.</p></div><button onClick={() => setReload((value) => value + 1)}>Refresh</button></div>
    {state.loading ? <p role="status">Loading device activity…</p> : state.error ? <p role="alert">{state.error}</p> : !state.events.length ? <div className="ui-empty"><h3>No device activity yet</h3><p>Recorded activity for your authorized devices will appear here.</p></div> : <div className="table-scroll-region"><table><thead><tr><th>Time</th><th>Action</th><th>Device</th><th>Result</th></tr></thead><tbody>{state.events.map((event, index) => <tr key={event.id || index}><td>{event.created_at || event.time || 'Not reported'}</td><td>{displayLabel(event.action)}</td><td>{event.target || event.target_id || '—'}</td><td>{displayLabel(event.result || event.status)}</td></tr>)}</tbody></table></div>}
  </section>;
}
