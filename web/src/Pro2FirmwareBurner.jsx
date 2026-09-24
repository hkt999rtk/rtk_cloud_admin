import { translate } from './i18n/index.mjs';
import React, { useEffect, useRef, useState } from 'react';
import './pro2-firmware-burner.css';
import { Pro2RemoteFirmware } from './Pro2RemoteFirmware.jsx';

export const PRO2_FIRMWARE_BURNER_PATH = '/console/chipset-sdk/pro2/firmware-burner';

function Icon({ name, ...props }) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" {...props} />;
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
    <a className="pro2-back-link" href="/console/chipset-sdk"><Icon name="arrow-left" />{translate("Back to ChipSet & SDK")}</a>
    <div className="page-intro pro2-page-intro">
      <div>
        <p className="eyebrow"><Icon name="laptop" />{translate("LOCAL DEVICE TOOL · RUNS LOCALLY")}</p>
        <h2 className="heading-with-icon"><Icon name="microchip" />{translate("Ameba PRO2 Firmware Burner")}</h2>
        <p>{translate("Connect a PRO2 board over USB UART, burn a local firmware image, verify it, and continue in the live serial console—all without installing a desktop application.")}</p>
      </div>
    </div>

    <Pro2RemoteFirmware rootRef={rootRef} />
    <div id="compatibility" className="pro2-notice" role="status"><Icon id="compatibility-icon" name="circle-check" /><span id="compatibility-message">{translate("Checking Web Serial compatibility…")}</span></div>
    {loadError ? <div className="error" role="alert">{loadError}</div> : null}

    <section id="task-card" className="panel pro2-workflow-card" data-state="idle" aria-labelledby="task-title">
      <div className="pro2-workflow-top">
        <div className="pro2-task-message"><Icon id="state-icon" name="plug" className="pro2-state-icon fa-solid fa-plug" /><div><p className="eyebrow">{translate("DEVICE WORKFLOW")}</p><strong id="task-title">{translate("Connect your PRO2 board")}</strong><p id="message">{translate("Select its USB UART to start the console or burn firmware.")}</p><span id="connection-label" className="pro2-connection-pill" role="status">{translate("Not connected")}</span></div></div>
        <div className="pro2-button-row pro2-workflow-actions">
          <button id="connect" type="button" className="primary-button icon-text"><Icon name="plug" />{translate("Connect UART")}</button>
          <button id="open-burn" type="button" className="primary-button icon-text" hidden><Icon name="bolt" />{translate("Burn firmware")}</button>
          <button id="disconnect" type="button" className="ghost-button icon-text" hidden><Icon name="link-slash" />{translate("Disconnect")}</button>
          <button id="cancel" type="button" className="ghost-button pro2-danger-button icon-text" hidden><Icon name="xmark" />{translate("Cancel burn")}</button>
        </div>
      </div>
      <ol className="pro2-task-steps" aria-label={translate("Firmware burn progress")}>
        <li id="step-connect"><span>{translate("Connect UART")}</span></li><li id="step-download"><span>{translate("Download mode")}</span></li><li id="step-transfer"><span>{translate("Transfer")}</span></li><li id="step-verify"><span>{translate("Verify")}</span></li><li id="step-console"><span>{translate("Console")}</span></li>
      </ol>
      <div className="pro2-progress-wrap"><progress id="progress" max="100" value="0" /><span id="progress-text">0%</span></div>
    </section>

    <section id="burn-panel" className="panel pro2-burn-panel" aria-labelledby="burn-title" hidden>
      <div className="pro2-panel-heading"><div><p className="eyebrow">{translate("FIRMWARE TASK")}</p><h2 id="burn-title">{translate("Burn firmware")}</h2></div><button id="close-burn" type="button" className="ghost-button">{translate("Close")}</button></div>
      <div className="pro2-burn-primary">
        <label className="pro2-file-field"><span>{translate("Firmware image")}</span><input id="firmware" type="file" accept=".bin,application/octet-stream" /><small id="file-info">{translate("Choose a complete flash .bin")}</small></label>
        <label>{translate("Burn speed")}<select id="download-baud"><option value="1000000">{translate("1,000,000 baud")}</option><option value="2000000">{translate("2,000,000 baud")}</option><option value="3000000">{translate("3,000,000 baud")}</option><option value="4000000">{translate("4,000,000 baud")}</option></select></label>
        <label className="pro2-checkbox"><input id="open-terminal" type="checkbox" defaultChecked />{translate("Open the console after completion")}</label>
      </div>
      <div id="firmware-card" className="pro2-firmware-card" hidden><strong id="firmware-kind">{translate("Full flash image")}</strong><span id="firmware-target">{translate("Write at 0x0")}</span><span>{translate("Compatible with 1K frames")}</span><span id="firmware-note" /><div className="pro2-checksum"><span>{translate("SHA-256")}</span><code id="firmware-checksum">{translate('Waiting for file')}</code><button id="copy-checksum" type="button" className="link-button" disabled>{translate("Copy")}</button></div></div>
      <section id="manual-guide" className="pro2-download-guide" aria-labelledby="download-title">
        <div><p className="eyebrow">{translate("MANUAL DOWNLOAD MODE")}</p><h3 id="download-title">{translate("Put the device in download mode")}</h3></div>
        <ol><li>{translate("Hold")} <kbd>BOOT</kbd></li><li>{translate("Press")} <kbd>RESET</kbd> {translate("once")}</li><li>{translate("Release")} <kbd>BOOT</kbd></li></ol>
        <p>{translate("Then start the burn. The tool will immediately handshake with the bootloader.")}</p>
      </section>
      <div className="pro2-burn-actions"><button id="burn" type="button" className="primary-button" disabled>{translate("Device is in download mode — start burn")}</button></div>
      <details className="pro2-advanced">
        <summary><Icon name="sliders" />{translate("Advanced settings and diagnostics")}</summary>
        <div className="pro2-advanced-grid">
          <label>{translate("Flash offset")}<input id="offset" defaultValue="0x0" inputMode="text" spellCheck="false" /></label>
          <label>{translate("Erase mode")}<select id="erase" defaultValue="none"><option value="none">{translate("Do not erase")}</option><option value="chip">{translate("Erase entire flash")}</option><option value="sector">{translate("Erase firmware range")}</option></select></label>
        </div>
        <p id="erase-warning" className="pro2-warning" hidden><strong>{translate("Destructive operation:")}</strong> {translate("Chip erase removes the entire flash, including the current bootable image.")}</p>
        <div className="pro2-checks">
          <label><input id="enter-download" type="checkbox" />{translate("Use DTR/RTS to control reset/boot pins (not UART flow control)")}</label>
          <label><input id="verify" type="checkbox" defaultChecked />{translate("Run SHA-256 verification after burning")}</label>
          <label><input id="reset" type="checkbox" disabled />{translate("Reset through DTR/RTS after completion")}</label>
        </div>
      </details>
    </section>

    <section id="recovery-card" className="panel pro2-recovery-card" role="alert" hidden>
      <div><strong id="recovery-title">{translate("Action required")}</strong><p id="recovery-message" /></div>
      <div className="pro2-button-row"><button id="retry-burn" type="button" className="primary-button">{translate("Retry burn")}</button><button id="retry-low-baud" type="button" className="ghost-button">{translate("Use a lower speed")}</button><button id="return-console" type="button" className="ghost-button">{translate("Return to console")}</button><button id="reconnect" type="button" className="ghost-button">{translate("Reconnect UART")}</button></div>
    </section>

    <section className="panel pro2-terminal-panel" aria-labelledby="terminal-title">
      <div className="pro2-terminal-toolbar">
        <div className="pro2-terminal-title-row">
          <div><h2 id="terminal-title"><Icon name="terminal" />{translate("UART terminal")}</h2><span id="terminal-connection" className="pro2-terminal-connection">{translate("Offline")}</span></div>
          <div className="pro2-button-row pro2-terminal-log-actions"><button id="copy-terminal" type="button" className="ghost-button" disabled><Icon name="copy" />{translate("Copy")}</button><button id="save-terminal" type="button" className="ghost-button" disabled><Icon name="download" />{translate("Save log")}</button><button id="clear-terminal" type="button" className="ghost-button" disabled><Icon name="trash-can" />{translate("Clear")}</button></div>
        </div>
        <div className="pro2-terminal-controls">
          <div className="pro2-terminal-fields"><label>{translate("Baud rate")}<select id="console-baud" defaultValue="115200"><option>115200</option><option>230400</option><option>460800</option><option>921600</option></select></label><label>{translate("Line ending")}<select id="line-ending" defaultValue="crlf"><option value="crlf">{translate("CRLF")}</option><option value="cr">{translate("CR")}</option><option value="lf">{translate("LF")}</option></select></label></div>
          <div className="pro2-button-row pro2-terminal-device-actions"><button id="reset-device" type="button" className="ghost-button" disabled>{translate("DTR/RTS reset")}</button><button id="scroll-lock" type="button" className="ghost-button" aria-pressed="false" disabled>{translate("Scroll lock")}</button></div>
        </div>
      </div>
      <div className="pro2-terminal-shell"><div id="terminal" className="pro2-terminal" aria-label={translate("UART terminal output")} /><div className="pro2-terminal-empty"><Icon name="terminal" /><strong>{translate("Connect UART to start the console")}</strong><span>{translate("Device output will appear here.")}</span></div></div>
      <p className="pro2-terminal-hint"><Icon name="shield-halved" />{translate("Local echo is off. UART data and firmware never leave this browser.")}</p>
      <details className="pro2-protocol-details"><summary><Icon name="stethoscope" />{translate("Transfer diagnostics")}</summary><div className="pro2-log-heading"><span>{translate("Firmware protocol events only; firmware and terminal data are excluded.")}</span><div className="pro2-button-row"><button id="copy-log" type="button" className="link-button">{translate("Copy diagnostics")}</button><button id="clear-log" type="button" className="link-button">{translate("Clear")}</button></div></div><pre id="protocol-log" aria-live="polite" /></details>
    </section>
  </section>;
}
