import React, { useEffect, useRef, useState } from 'react';
import './pro2-firmware-burner.css';

export const PRO2_FIRMWARE_BURNER_PATH = '/console/chipset-sdk/pro2/firmware-burner';

function Icon({ name }) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" />;
}

export function Pro2FirmwareBurner() {
  const rootRef = useRef(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let disposed = false;
    let unmount = () => {};
    import('./pro2-firmware-burner/runtime.js')
      .then(({ mountPro2FirmwareBurner }) => {
        if (disposed || !rootRef.current) return;
        unmount = mountPro2FirmwareBurner(rootRef.current);
      })
      .catch(() => {
        if (!disposed) setLoadError('The local firmware tool could not be loaded. Refresh the page and try again.');
      });
    return () => {
      disposed = true;
      unmount();
    };
  }, []);

  return <section className="page-content pro2-firmware-page" data-testid="pro2-firmware-burner" ref={rootRef}>
    <a className="pro2-back-link" href="/console/chipset-sdk"><Icon name="arrow-left" />Back to ChipSet &amp; SDK</a>
    <div className="page-intro pro2-page-intro">
      <div>
        <p className="eyebrow">LOCAL DEVICE TOOL</p>
        <h2 className="heading-with-icon"><Icon name="microchip" />Ameba PRO2 Firmware Burner</h2>
        <p>Connect a PRO2 board over USB UART, burn a local firmware image, verify it, and continue in the live serial console—all without installing a desktop application.</p>
      </div>
      <span className="pro2-local-badge"><Icon name="laptop" />Runs locally</span>
    </div>

    <div id="compatibility" className="pro2-notice" role="status"><Icon name="circle-info" /><span id="compatibility-message">Checking Web Serial compatibility…</span></div>
    {loadError ? <div className="error" role="alert">{loadError}</div> : null}

    <section className="panel pro2-connection-panel" aria-label="UART connection">
      <div>
        <p className="eyebrow">USB UART</p>
        <span id="connection-label" className="pro2-connection-pill" role="status">● Not connected</span>
      </div>
      <div className="pro2-button-row">
        <button id="connect" type="button" className="primary-button icon-text"><Icon name="plug" />Connect UART</button>
        <button id="open-burn" type="button" className="ghost-button icon-text" disabled><Icon name="bolt" />Burn firmware</button>
        <button id="disconnect" type="button" className="ghost-button icon-text" disabled><Icon name="link-slash" />Disconnect</button>
      </div>
    </section>

    <section id="task-card" className="panel pro2-task-card" data-state="idle" aria-labelledby="task-title">
      <div className="pro2-task-heading">
        <div className="pro2-task-message"><span id="state-icon" className="pro2-state-icon" aria-hidden="true">○</span><div><strong id="task-title">Ready</strong><p id="message">Connect UART to use the console and burn firmware.</p></div></div>
        <button id="cancel" type="button" className="ghost-button pro2-danger-button icon-text" disabled><Icon name="xmark" />Cancel burn</button>
      </div>
      <ol className="pro2-task-steps" aria-label="Firmware burn progress">
        <li id="step-connect">Connect UART</li><li id="step-download">Download mode</li><li id="step-transfer">Transfer</li><li id="step-verify">Verify</li><li id="step-console">Console</li>
      </ol>
      <div className="pro2-progress-wrap"><progress id="progress" max="100" value="0" /><span id="progress-text">0%</span></div>
    </section>

    <section id="burn-panel" className="panel pro2-burn-panel" aria-labelledby="burn-title" hidden>
      <div className="pro2-panel-heading"><div><p className="eyebrow">FIRMWARE TASK</p><h2 id="burn-title">Burn firmware</h2></div><button id="close-burn" type="button" className="ghost-button">Close</button></div>
      <div className="pro2-burn-primary">
        <label className="pro2-file-field"><span>Firmware image</span><input id="firmware" type="file" accept=".bin,application/octet-stream" /><small id="file-info">Choose flash_is.bin</small></label>
        <label>Burn speed<select id="download-baud"><option value="1000000">1,000,000 baud</option><option value="2000000">2,000,000 baud</option><option value="3000000">3,000,000 baud</option><option value="4000000">4,000,000 baud</option></select></label>
        <label className="pro2-checkbox"><input id="open-terminal" type="checkbox" defaultChecked />Open the console after completion</label>
      </div>
      <div id="firmware-card" className="pro2-firmware-card" hidden><strong id="firmware-kind">Full flash image</strong><span id="firmware-target">Write at 0x0</span><span>Compatible with 1K frames</span><span id="firmware-note" /><div className="pro2-checksum"><span>SHA-256</span><code id="firmware-checksum">Waiting for file</code><button id="copy-checksum" type="button" className="link-button" disabled>Copy</button></div></div>
      <section id="manual-guide" className="pro2-download-guide" aria-labelledby="download-title">
        <div><p className="eyebrow">MANUAL DOWNLOAD MODE</p><h3 id="download-title">Put the device in download mode</h3></div>
        <ol><li>Hold <kbd>BOOT</kbd></li><li>Press <kbd>RESET</kbd> once</li><li>Release <kbd>BOOT</kbd></li></ol>
        <p>Then start the burn. The tool will immediately handshake with the bootloader.</p>
      </section>
      <div className="pro2-burn-actions"><button id="burn" type="button" className="primary-button" disabled>Device is in download mode — start burn</button></div>
      <details className="pro2-advanced">
        <summary><Icon name="sliders" />Advanced settings and diagnostics</summary>
        <div className="pro2-advanced-grid">
          <label>Flash offset<input id="offset" defaultValue="0x0" inputMode="text" spellCheck="false" /></label>
          <label>Erase mode<select id="erase" defaultValue="none"><option value="none">Do not erase</option><option value="chip">Erase entire flash</option><option value="sector">Erase firmware range</option></select></label>
        </div>
        <p id="erase-warning" className="pro2-warning" hidden><strong>Destructive operation:</strong> Chip erase removes the entire flash, including the current bootable image.</p>
        <div className="pro2-checks">
          <label><input id="enter-download" type="checkbox" />Use DTR/RTS to control reset/boot pins (not UART flow control)</label>
          <label><input id="verify" type="checkbox" defaultChecked />Run SHA-256 verification after burning</label>
          <label><input id="reset" type="checkbox" disabled />Reset through DTR/RTS after completion</label>
        </div>
      </details>
    </section>

    <section id="recovery-card" className="panel pro2-recovery-card" role="alert" hidden>
      <div><strong id="recovery-title">Action required</strong><p id="recovery-message" /></div>
      <div className="pro2-button-row"><button id="retry-burn" type="button" className="primary-button">Retry burn</button><button id="retry-low-baud" type="button" className="ghost-button">Use a lower speed</button><button id="return-console" type="button" className="ghost-button">Return to console</button><button id="reconnect" type="button" className="ghost-button">Reconnect UART</button></div>
    </section>

    <section className="panel pro2-terminal-panel" aria-labelledby="terminal-title">
      <div className="pro2-terminal-toolbar">
        <div><p className="eyebrow">LIVE SERIAL CONSOLE</p><h2 id="terminal-title"><Icon name="terminal" />UART terminal</h2></div>
        <label>Baud rate<select id="console-baud" defaultValue="115200"><option>115200</option><option>230400</option><option>460800</option><option>921600</option></select></label>
        <label>Line ending<select id="line-ending" defaultValue="crlf"><option value="crlf">CRLF</option><option value="cr">CR</option><option value="lf">LF</option></select></label>
        <div className="pro2-button-row pro2-terminal-actions">
          <button id="reset-device" type="button" className="ghost-button" disabled>DTR/RTS reset</button><button id="scroll-lock" type="button" className="ghost-button" aria-pressed="false" disabled>Scroll lock</button><button id="copy-terminal" type="button" className="ghost-button" disabled>Copy</button><button id="save-terminal" type="button" className="ghost-button" disabled>Save log</button><button id="clear-terminal" type="button" className="ghost-button" disabled>Clear</button>
        </div>
      </div>
      <div id="terminal" className="pro2-terminal" aria-label="UART terminal output" />
      <p className="pro2-terminal-hint"><Icon name="shield-halved" />Local echo is off. UART data and firmware never leave this browser.</p>
    </section>

    <details className="panel pro2-protocol-details"><summary><Icon name="stethoscope" />Transfer diagnostics</summary><div className="pro2-log-heading"><span>Firmware protocol events only; firmware and terminal data are excluded.</span><div className="pro2-button-row"><button id="copy-log" type="button" className="link-button">Copy diagnostics</button><button id="clear-log" type="button" className="link-button">Clear</button></div></div><pre id="protocol-log" aria-live="polite" /></details>
  </section>;
}
