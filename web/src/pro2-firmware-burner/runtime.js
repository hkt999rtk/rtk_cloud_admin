// Integrated from uartfwburn commit 81f808f; UI copy adapted for the Developer Console.
import { SerialTransport } from './serial.js';
import { BurnController, parseOffset } from './burner.js';
import { sha256Hex } from './firmware-meta.js';
import { TerminalConsole } from './terminal.js';

export function mountPro2FirmwareBurner(root) {
const $ = id => root.querySelector(`#${id}`);
const ids = [
  'compatibility', 'compatibility-message', 'firmware', 'file-info', 'firmware-card', 'firmware-kind', 'firmware-target', 'firmware-note', 'firmware-checksum', 'copy-checksum',
  'download-baud', 'console-baud', 'offset', 'erase', 'enter-download', 'verify', 'reset', 'open-terminal',
  'connect', 'open-burn', 'close-burn', 'disconnect', 'burn', 'cancel', 'task-card', 'state-icon', 'task-title',
  'message', 'progress', 'progress-text', 'protocol-log', 'clear-log', 'copy-log', 'clear-terminal', 'reset-device',
  'scroll-lock', 'copy-terminal', 'save-terminal', 'line-ending', 'terminal', 'connection-label', 'erase-warning',
  'burn-panel', 'manual-guide', 'recovery-card', 'recovery-title', 'recovery-message', 'retry-burn', 'retry-low-baud',
  'return-console', 'reconnect', 'step-connect', 'step-download', 'step-transfer', 'step-verify', 'step-console'
];
const ui = Object.fromEntries(ids.map(id => [id, $(id)]));
const steps = ['step-connect', 'step-download', 'step-transfer', 'step-verify', 'step-console'];
const downloadBaudLevels = ['1000000', '2000000', '3000000', '4000000'];
let connectInProgress = false;
let progressStartedAt = 0;
let firmwareChecksum = '';
let firmwareChecksumFile = null;
let firmwareChecksumPending = false;
let firmwareChecksumError = '';
let firmwareChecksumRequest = 0;

function log(message) {
  const now = new Date().toLocaleTimeString();
  ui['protocol-log'].textContent += `[${now}] ${message}\n`;
  ui['protocol-log'].scrollTop = ui['protocol-log'].scrollHeight;
}

const transport = new SerialTransport({ onLog: log });
const controller = new BurnController(transport, {
  onLog: log,
  onState: setStatus,
  onProgress(done, total) {
    const percent = total ? Math.floor(done * 100 / total) : 0;
    const elapsed = Math.max((Date.now() - progressStartedAt) / 1000, 0.001);
    const rate = done / elapsed;
    ui.progress.value = percent;
    ui['progress-text'].textContent = `${percent}% · ${formatBytes(done)} / ${formatBytes(total)} · ${formatBytes(rate)}/s`;
  }
});
const terminal = new TerminalConsole(transport, ui.terminal, { onLog: log, onStatus: setStatus });

function setStatus(state, message) {
  const presentation = statePresentation(state);
  ui['task-card'].dataset.state = state;
  ui['state-icon'].textContent = presentation.icon;
  ui['task-title'].textContent = presentation.title;
  ui.message.textContent = message;
  updateSteps(state);
  updateButtons();
}

function statePresentation(state) {
  const states = {
    idle: { icon: '○', title: 'Ready' },
    selecting: { icon: '◌', title: 'Select UART' },
    connecting: { icon: '◌', title: 'Checking download mode' },
    erasing: { icon: '◌', title: 'Erasing flash' },
    transferring: { icon: '◌', title: 'Transferring firmware' },
    verifying: { icon: '◌', title: 'Verifying firmware' },
    completed: { icon: '✓', title: 'Burn complete' },
    terminal: { icon: '✓', title: 'Console ready' },
    cancelled: { icon: '!', title: 'Burn canceled' },
    failed: { icon: '!', title: 'Action required' },
    ready: { icon: '●', title: 'UART connected' }
  };
  return states[state] ?? states.idle;
}

function updateSteps(state) {
  const active = {
    idle: -1, selecting: 0, ready: 0, terminal: 4, connecting: 1, erasing: 2, transferring: 2, verifying: 3, completed: 4, cancelled: -1, failed: -1
  }[state] ?? -1;
  steps.forEach((id, index) => {
    ui[id].classList.toggle('active', index === active);
    ui[id].classList.toggle('done', index < active || state === 'terminal' || state === 'completed');
  });
}

function isBusy() { return connectInProgress || Boolean(controller.abortController); }

function updateButtons() {
  const connected = transport.connected;
  const busy = isBusy();
  const hasFirmware = Boolean(ui.firmware.files.length) && firmwareChecksumFile === ui.firmware.files[0] && Boolean(firmwareChecksum);
  ui.connect.disabled = connected || busy || !('serial' in navigator);
  ui['open-burn'].disabled = !connected || busy;
  ui.disconnect.disabled = !connected || busy;
  ui.burn.disabled = !connected || !hasFirmware || busy;
  ui.cancel.disabled = !controller.abortController;
  ui['close-burn'].disabled = busy;
  ui['clear-terminal'].disabled = !connected;
  ui['copy-terminal'].disabled = !connected;
  ui['save-terminal'].disabled = !connected;
  ui['scroll-lock'].disabled = !connected;
  ui['copy-checksum'].disabled = !firmwareChecksum;
  ui['reset-device'].disabled = !connected || busy || !ui['enter-download'].checked;
  ui['reset-device'].title = ui['enter-download'].checked ? 'Reset the device through DTR/RTS.' : 'Enable DTR/RTS reset/boot control in Advanced settings first.';
  for (const input of [ui.firmware, ui['download-baud'], ui.offset, ui.erase, ui['enter-download'], ui.verify, ui['open-terminal']]) input.disabled = busy;
  ui.reset.disabled = busy || !ui['enter-download'].checked;
  ui['connection-label'].textContent = connected ? `● ${transport.baudRate} baud · ${ownerLabel(transport.owner)}` : '● Not connected';
  ui['connection-label'].classList.toggle('connected', connected && !busy);
  ui['connection-label'].classList.toggle('busy', connected && busy);
}

function ownerLabel(owner) {
  return { idle: 'Connected', protocol: 'Burn in progress', terminal: 'Console ready' }[owner] ?? owner;
}

function showBurnPanel(show = true) {
  ui['burn-panel'].hidden = !show;
  if (show) updateFirmwareCard();
}

function updateFirmwareCard() {
  const file = ui.firmware.files[0];
  ui['firmware-card'].hidden = !file;
  ui['file-info'].textContent = file ? `${file.name} · ${formatBytes(file.size)}` : 'Choose flash_is.bin';
  if (!file) return;
  ui['firmware-kind'].textContent = 'Full Flash image';
  ui['firmware-target'].textContent = 'Write at 0x0';
  ui['firmware-note'].textContent = file.name === 'flash_is.bin' ? 'Expected filename' : 'The filename is not flash_is.bin. Confirm that this is a complete flash image.';
  ui['firmware-checksum'].textContent = firmwareChecksumFile === file && firmwareChecksum
    ? firmwareChecksum
    : firmwareChecksumPending ? 'Calculating local SHA-256…' : firmwareChecksumError || 'Waiting for calculation';
}

async function calculateFirmwareChecksum() {
  const file = ui.firmware.files[0];
  const request = ++firmwareChecksumRequest;
  firmwareChecksum = '';
  firmwareChecksumFile = null;
  firmwareChecksumPending = Boolean(file);
  firmwareChecksumError = '';
  updateFirmwareCard();
  updateButtons();
  if (!file) return;
  try {
    const checksum = await sha256Hex(await file.arrayBuffer());
    if (request !== firmwareChecksumRequest || ui.firmware.files[0] !== file) return;
    firmwareChecksum = checksum;
    firmwareChecksumFile = file;
    firmwareChecksumPending = false;
  } catch (error) {
    if (request !== firmwareChecksumRequest) return;
    firmwareChecksumPending = false;
    firmwareChecksumError = `Calculation failed: ${error.message}`;
  }
  updateFirmwareCard();
  updateButtons();
}

function updateDownloadModeGuide() {
  const automatic = ui['enter-download'].checked;
  ui['manual-guide'].hidden = automatic;
  ui.burn.textContent = automatic ? 'Start burn (enter download mode automatically)' : 'Device is in download mode — start burn';
  if (!automatic) ui.reset.checked = false;
  updateButtons();
}

function clearRecovery() { ui['recovery-card'].hidden = true; }

function showRecovery(error) {
  const detail = actionError(error);
  let title = 'Burn did not complete';
  let message = `${detail}. Check the device state and try again.`;
  let showLowerBaud = false;
  let showReconnect = false;
  if (isPortBusy(error)) {
    title = 'UART is in use by another application';
    message = 'Close screen, minicom, or another terminal, then select Reconnect UART.';
    showReconnect = true;
  } else if (/USB UART was disconnected/i.test(error.message)) {
    title = 'USB UART was disconnected';
    message = 'Reconnect the USB UART, then select Reconnect UART.';
    showReconnect = true;
  } else if (/ping|download mode|UART read timeout/i.test(error.message)) {
    title = 'Download mode was not detected';
    message = 'Hold BOOT, press RESET once, release BOOT, then select Retry burn.';
  } else if (/XMODEM|receiver.*timed out/i.test(error.message)) {
    title = 'The bootloader did not start receiving firmware';
    message = 'Enter download mode again and retry. If it still fails, use a lower speed.';
    showLowerBaud = Boolean(lowerDownloadBaud());
  } else if (/SHA-256|verification failed/i.test(error.message)) {
    title = 'Firmware verification failed';
    message = 'Do not boot the device yet. Burn again at a lower speed.';
    showLowerBaud = Boolean(lowerDownloadBaud());
  }
  ui['recovery-title'].textContent = title;
  ui['recovery-message'].textContent = message;
  ui['retry-low-baud'].hidden = !showLowerBaud;
  ui.reconnect.hidden = !showReconnect;
  ui['recovery-card'].hidden = false;
}

function isPortBusy(error) {
  return /Failed to execute 'open'|port.*open|resource busy|already open/i.test(error.message);
}

function lowerDownloadBaud() {
  const currentIndex = downloadBaudLevels.indexOf(ui['download-baud'].value);
  return currentIndex > 0 ? downloadBaudLevels[currentIndex - 1] : null;
}

async function connect() {
  if (connectInProgress || transport.connected) return;
  connectInProgress = true;
  clearRecovery();
  try {
    setStatus('selecting', 'Select the USB UART in the browser dialog.');
    updateButtons();
    await transport.requestAndOpen(Number(ui['console-baud'].value));
    await terminal.enter({ baudRate: Number(ui['console-baud'].value) });
    setStatus('terminal', 'Connected and waiting for device output.');
  } catch (error) {
    setStatus('failed', actionError(error));
    showRecovery(error);
    try { await transport.close(); } catch {}
  } finally {
    connectInProgress = false;
  }
  updateButtons();
}

async function burn() {
  const file = ui.firmware.files[0];
  try {
    if (!file) throw new Error('Choose flash_is.bin first.');
    if (firmwareChecksumFile !== file || !firmwareChecksum) throw new Error('The firmware SHA-256 is still being calculated. Review the checksum before burning.');
    if (ui.erase.value === 'chip' && !window.confirm('Chip erase removes the entire flash, including the current bootable image. Continue?')) return;
    clearRecovery();
    progressStartedAt = Date.now();
    ui.progress.value = 0;
    ui['progress-text'].textContent = '0%';
    await terminal.leave();
    const firmware = new Uint8Array(await file.arrayBuffer());
    const options = {
      baudRate: Number(ui['download-baud'].value), offset: parseOffset(ui.offset.value), erase: ui.erase.value,
      modeK: 1, enterDownload: ui['enter-download'].checked, verify: ui.verify.checked, pro2: true, reset: ui.reset.checked
    };
    log(`local firmware loaded: ${file.name}, ${file.size} bytes (not uploaded)`);
    await controller.burn(firmware, options);
    if (ui['open-terminal'].checked) {
      setStatus('completed', 'Burn and verification completed. Reopening the console at 115200 baud…');
      await terminal.enter({ baudRate: Number(ui['console-baud'].value), hardwareReset: options.reset });
      setStatus('terminal', `Burn and verification completed. UART reopened at ${ui['console-baud'].value} baud. Terminal ready.`);
    } else {
      transport.acquire('idle');
      setStatus('completed', 'Burn and verification completed. The console was not opened automatically.');
    }
    showBurnPanel(false);
  } catch (error) {
    if (error.name === 'AbortError') {
      try {
        await terminal.enter({ baudRate: Number(ui['console-baud'].value) });
        setStatus('terminal', `Burn canceled. UART console reopened at ${ui['console-baud'].value} baud.`);
      } catch {
        setStatus('cancelled', 'Burn canceled. Reconnect UART if you want to continue.');
      }
      return;
    }
    log(`ERROR: ${error.message}`);
    setStatus('failed', actionError(error));
    showRecovery(error);
  } finally {
    updateButtons();
  }
}

async function returnToConsole() {
  try {
    clearRecovery();
    await terminal.enter({ baudRate: Number(ui['console-baud'].value) });
    setStatus('terminal', `Console ready at ${ui['console-baud'].value} baud.`);
  } catch (error) {
    setStatus('failed', actionError(error));
    showRecovery(error);
  }
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    ui.message.textContent = successMessage;
  } catch (error) {
    setStatus('failed', `Copy failed: ${error.message}`);
  }
}

function saveTerminalLog() {
  const blob = new Blob([terminal.getText()], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `ameba-pro2-console-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  link.click();
  URL.revokeObjectURL(link.href);
}

if ('serial' in navigator && window.isSecureContext) {
  ui['compatibility-message'].textContent = 'Web Serial is available. Firmware and console data stay on this computer.';
} else {
  ui['compatibility-message'].textContent = !window.isSecureContext ? 'Web Serial requires HTTPS (localhost may use HTTP).' : 'Use desktop Chrome or Edge.';
  ui.compatibility.classList.add('unsupported');
}

ui.firmware.addEventListener('change', calculateFirmwareChecksum);
ui.erase.addEventListener('change', () => { ui['erase-warning'].hidden = ui.erase.value !== 'chip'; });
ui['enter-download'].addEventListener('change', updateDownloadModeGuide);
ui['line-ending'].addEventListener('change', () => terminal.setLineEnding(ui['line-ending'].value));
ui['console-baud'].addEventListener('change', async () => {
  if (transport.connected && transport.owner === 'terminal') {
    try { await terminal.enter({ baudRate: Number(ui['console-baud'].value) }); } catch (error) { setStatus('failed', actionError(error)); showRecovery(error); }
  }
});
ui.connect.addEventListener('click', connect);
ui['open-burn'].addEventListener('click', () => showBurnPanel(true));
ui['close-burn'].addEventListener('click', () => showBurnPanel(false));
ui.disconnect.addEventListener('click', async () => {
  await terminal.leave();
  await transport.close();
  clearRecovery();
  setStatus('idle', 'UART disconnected. Reconnect when needed.');
});
ui.burn.addEventListener('click', burn);
ui.cancel.addEventListener('click', () => controller.cancel());
ui['retry-burn'].addEventListener('click', burn);
ui['retry-low-baud'].addEventListener('click', () => {
  const lowerBaud = lowerDownloadBaud();
  if (!lowerBaud) return;
  ui['download-baud'].value = lowerBaud;
  burn();
});
ui['return-console'].addEventListener('click', returnToConsole);
ui.reconnect.addEventListener('click', connect);
ui['clear-log'].addEventListener('click', () => { ui['protocol-log'].textContent = ''; });
ui['copy-log'].addEventListener('click', () => copyText(ui['protocol-log'].textContent, 'Diagnostics copied.'));
ui['copy-checksum'].addEventListener('click', () => copyText(firmwareChecksum, 'Firmware SHA-256 copied.'));
ui['clear-terminal'].addEventListener('click', () => terminal.clear());
ui['copy-terminal'].addEventListener('click', () => copyText(terminal.getText(), 'Console log copied.'));
ui['save-terminal'].addEventListener('click', saveTerminalLog);
ui['scroll-lock'].addEventListener('click', () => {
  const locked = terminal.toggleScrollLock();
  ui['scroll-lock'].setAttribute('aria-pressed', String(locked));
  ui['scroll-lock'].textContent = locked ? 'Scroll lock: on' : 'Scroll lock';
});
ui['reset-device'].addEventListener('click', async () => {
  try {
    if (transport.owner !== 'terminal') await terminal.enter({ baudRate: Number(ui['console-baud'].value) });
    await terminal.hardwareReset();
  } catch (error) { setStatus('failed', actionError(error)); showRecovery(error); }
});
const onSerialDisconnect = async event => {
  if (event.target === transport.port) {
    controller.cancel();
    await terminal.leave();
    try { await transport.close(); } catch {}
    const error = new Error('USB UART was disconnected');
    setStatus('failed', 'USB UART was disconnected. Reconnect it, then select Reconnect UART.');
    showRecovery(error);
  }
};
navigator.serial?.addEventListener('disconnect', onSerialDisconnect);

function actionError(error) {
  if (error.name === 'NotFoundError') return 'No UART was selected. Select Connect UART to try again.';
  return error.message;
}

function formatBytes(value) {
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(2)} MiB`;
}

updateDownloadModeGuide();
setStatus('idle', 'Connect UART to use the console and burn firmware.');
return () => {
  navigator.serial?.removeEventListener('disconnect', onSerialDisconnect);
  controller.cancel();
  terminal.dispose();
  transport.close().catch(() => {});
};
}
