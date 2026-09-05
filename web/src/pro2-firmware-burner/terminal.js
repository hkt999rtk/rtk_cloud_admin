// Integrated from uartfwburn commit 81f808f; UI copy adapted for the Developer Console.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { sleep } from './serial.js';
import { normalizeTerminalInput, StreamingTerminalDecoder } from './terminal-codec.js';

export class TerminalConsole {
  constructor(transport, element, { onLog = () => {}, onStatus = () => {} } = {}) {
    this.transport = transport;
    this.onLog = onLog;
    this.onStatus = onStatus;
    this.lineEnding = 'crlf';
    this.scrollLock = false;
    this.enabled = false;
    this.unsubscribe = null;
    this.decoder = new StreamingTerminalDecoder();
    this.terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      disableStdin: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.18,
      scrollback: 10000,
      theme: { background: '#070b0f', foreground: '#d9e2e9', cursor: '#67e8b5', selectionBackground: '#2d5b6c88' }
    });
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(element);
    this.inputDisposable = this.terminal.onData(data => this.handleInput(data));
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(element);
  }

  setLineEnding(mode) {
    if (!['crlf', 'cr', 'lf'].includes(mode)) throw new Error(`invalid line ending: ${mode}`);
    this.lineEnding = mode;
  }

  async handleInput(data) {
    if (!this.enabled || this.transport.owner !== 'terminal') return;
    try {
      await this.transport.write(normalizeTerminalInput(data, this.lineEnding), 'terminal');
    } catch (error) {
      this.onStatus('failed', `Console write failed: ${error.message}`);
    }
  }

  handleOutput(bytes) {
    const text = this.decoder.decode(bytes);
    if (!text) return;
    const buffer = this.terminal.buffer.active;
    const wasAtBottom = buffer.viewportY >= buffer.baseY;
    this.terminal.write(text, () => {
      if (!this.scrollLock && wasAtBottom) this.terminal.scrollToBottom();
    });
  }

  async enter({ baudRate = 115200, hardwareReset = false } = {}) {
    if (!this.transport.connected) throw new Error('UART is not connected.');
    await this.leave();
    if (this.transport.baudRate !== baudRate) await this.transport.reopen(baudRate);
    this.decoder.reset();
    this.unsubscribe = this.transport.subscribeTerminal(bytes => this.handleOutput(bytes));
    this.transport.acquire('terminal');
    this.enabled = true;
    this.terminal.options.disableStdin = false;
    this.fit();
    this.focus();
    this.onStatus('ready', `Console connected at baud rate ${baudRate}`);
    this.onLog(`terminal active at ${baudRate}, line ending ${this.lineEnding.toUpperCase()}`);
    if (hardwareReset) await this.hardwareReset();
  }

  async hardwareReset() {
    if (!this.transport.port?.setSignals) {
      this.onStatus('ready', 'Console ready. This adapter cannot reset the device automatically; reset it manually.');
      return false;
    }
    try {
      await this.transport.setSignals({ dataTerminalReady: true, requestToSend: true });
      await sleep(50);
      await this.transport.setSignals({ dataTerminalReady: true, requestToSend: false });
      await sleep(50);
      await this.transport.setSignals({ dataTerminalReady: true, requestToSend: true });
      this.onLog('hardware reset complete');
      return true;
    } catch (error) {
      this.onStatus('ready', `Console ready. Automatic reset failed; reset the device manually: ${error.message}`);
      return false;
    }
  }

  async leave() {
    this.enabled = false;
    this.terminal.options.disableStdin = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.transport.owner === 'terminal') this.transport.acquire('idle');
    await this.transport.drainWrites();
  }

  clear() { this.terminal.clear(); }
  toggleScrollLock() {
    this.scrollLock = !this.scrollLock;
    if (!this.scrollLock) this.terminal.scrollToBottom();
    return this.scrollLock;
  }
  getText() {
    const buffer = this.terminal.buffer.active;
    const lines = [];
    for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    return lines.join('\n');
  }
  focus() { if (this.enabled) this.terminal.focus(); }
  fit() { try { this.fitAddon.fit(); } catch {} }

  dispose() {
    this.unsubscribe?.();
    this.inputDisposable?.dispose();
    this.resizeObserver?.disconnect();
    this.terminal.dispose();
  }
}
