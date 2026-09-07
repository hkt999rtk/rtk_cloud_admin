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

export function Dialog({ title, onClose, busy = false, role = 'dialog', returnFocus, variant = 'dialog', children }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const previous = returnFocus || document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    if (variant === 'drawer') document.body.style.overflow = 'hidden';
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
      if (variant === 'drawer') document.body.style.overflow = previousOverflow;
      // Restore after React re-enables the triggering fieldset and removes the modal.
      queueMicrotask(() => { if (previous?.isConnected) previous.focus(); });
    };
  }, []);
  return <dialog ref={ref} role={role} className={`ui-dialog${variant === 'drawer' ? ' ui-dialog-drawer' : ''}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>Close</button></header>
    {children}
  </dialog>;
}
