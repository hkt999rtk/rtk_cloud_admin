// Integrated from uartfwburn commit 81f808f; UI copy adapted for the Developer Console.
import { sleep } from './serial.js';
import { transmit } from './xmodem.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const VALID_STATES = new Set(['idle', 'connecting', 'ready', 'erasing', 'transferring', 'verifying', 'completed', 'cancelled', 'failed']);

export function parseOffset(text) {
  const value = text.trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) throw new Error('Flash offset has an invalid format.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) throw new Error('Flash offset must be between 0x0 and 0xffffffff.');
  return number;
}

export function chooseChunk(modeK, length) {
  if (modeK === 1 || modeK === 0) return length;
  if (modeK === 32) return 32 * 1024;
  if (modeK === 16) return 16 * 1024;
  return 4 * 1024;
}

export function fwdCommand(modeK, pro2, length, address) {
  const hex = address.toString(16);
  if (pro2 || modeK === 1) return ['fwd', '0', '0', hex, ''].join(' ') + '\n';
  const command = modeK === 16 ? 'fwd16k' : 'fwd4k';
  return [command, '0', String(length), hex, ''].join(' ') + '\n';
}

export class BurnController {
  constructor(transport, { onState = () => {}, onProgress = () => {}, onLog = () => {} } = {}) {
    this.transport = transport;
    this.onState = onState;
    this.onProgress = onProgress;
    this.onLog = onLog;
    this.state = 'idle';
    this.abortController = null;
  }

  setState(state, message) {
    if (!VALID_STATES.has(state)) throw new Error(`invalid state: ${state}`);
    this.state = state;
    this.onState(state, message);
    this.onLog(`${state}: ${message}`);
  }

  cancel() { this.abortController?.abort(); }

  async handshake(baudRate, signal) {
    if (this.transport.baudRate !== 115200) await this.transport.reopen(115200);
    this.transport.flushInput();
    let pong = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.transport.flushInput();
      await this.transport.write('ping\n');
      try { pong = await this.transport.readExact(4, 1000, signal); } catch (error) {
        if (error.name === 'AbortError') throw error;
        this.onLog(`ping attempt ${attempt} failed`);
      }
      if (pong && decoder.decode(pong) === 'ping') break;
      pong = null;
    }
    if (!pong) throw new Error('Ping failed. Confirm that the device is in UART download mode.');
    this.onLog('ping ok');
    this.transport.flushInput();
    await this.transport.write(`ucfg ${baudRate} 0 0\n`);
    await sleep(100, signal);
    if (baudRate !== this.transport.baudRate) await this.transport.reopen(baudRate);
    const ok = decoder.decode(await this.transport.readExact(2, 1000, signal));
    if (ok !== 'OK') throw new Error(`ucfg failed: ${JSON.stringify(ok)}`);
    this.onLog('ucfg ok');
  }

  async enterDownloadMode(signal) {
    if (!this.transport.port?.setSignals) throw new Error('This USB UART adapter cannot control the reset/boot pins. Enter download mode manually and turn off automatic download mode.');
    if (this.transport.baudRate !== 115200) await this.transport.reopen(115200);
    await this.transport.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(50, signal);
    this.transport.flushInput();
    for (const mini of [false, true]) {
      this.onLog(mini ? 'enter download mode: mini sequence' : 'enter download mode: normal sequence');
      try {
        await this.downloadModeSignals(mini, signal);
        const response = decoder.decode(await this.transport.readSome(2000, signal));
        if (/Test Mode|Download Image/.test(response)) {
          await sleep(50, signal);
          this.transport.flushInput();
          await sleep(mini ? 50 : 100, signal);
          this.onLog('download mode ok');
          return;
        }
        this.onLog(`download mode banner mismatch: ${JSON.stringify(response)}`);
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        this.onLog(`${mini ? 'mini' : 'normal'} download mode failed: ${error.message}`);
      }
      this.transport.flushInput();
    }
    throw new Error('Automatic download mode failed. If only TX/RX/GND are connected, enter download mode manually and turn off automatic download mode.');
  }

  async downloadModeSignals(mini, signal) {
    if (mini) {
      await this.transport.setSignals({ dataTerminalReady: false, requestToSend: true });
      await sleep(50, signal);
      await this.transport.setSignals({ dataTerminalReady: true, requestToSend: false });
      await sleep(50, signal);
      return;
    }
    await this.transport.setSignals({ requestToSend: false });
    await sleep(50, signal);
    await this.transport.setSignals({ dataTerminalReady: true });
    await sleep(10, signal);
    await this.transport.setSignals({ requestToSend: false });
    await sleep(50, signal);
    this.transport.flushInput();
    await this.transport.setSignals({ dataTerminalReady: false });
    await sleep(10, signal);
    await this.transport.setSignals({ requestToSend: true });
    await sleep(50, signal);
    await this.transport.setSignals({ requestToSend: false });
    await sleep(10, signal);
    await this.transport.setSignals({ dataTerminalReady: true });
  }

  async erase(mode, base, length, signal) {
    if (mode === 'none') return;
    this.setState('erasing', mode === 'chip' ? 'Erasing the entire flash…' : 'Erasing the firmware range…');
    const command = mode === 'chip' ? 'ceras 0 0\r\n' : `seras ${base.toString(16)} ${(base + length).toString(16)} 0 0\r\n`;
    await this.transport.write(command);
    const response = decoder.decode(await this.transport.readSome(mode === 'chip' ? 120000 : 30000, signal));
    this.onLog(`erase response: ${JSON.stringify(response)}`);
  }

  async verifyHash(data, address, pro2, signal) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const command = pro2 ? `hashq ${data.length} ${address.toString(16)} 0 ` : `hashq ${data.length} 0 0 `;
    await this.transport.write(command);
    const header = decoder.decode(await this.transport.readExact(6, 5000, signal));
    if (header !== 'hashs ') throw new Error(`Unexpected hashq response: ${JSON.stringify(header)}`);
    await sleep(20000, signal);
    const remote = await this.transport.readExact(64, 5000, signal);
    for (let i = 0; i < digest.length; i++) if (remote[i] !== digest[i]) throw new Error('SHA-256 verification failed.');
    this.onLog(`SHA-256 match: ${toHex(digest)}`);
  }

  async burn(firmware, options) {
    if (this.abortController) throw new Error('A firmware burn is already in progress.');
    if (!this.transport.connected) throw new Error('UART is not connected.');
    if (!(firmware instanceof Uint8Array) || firmware.length === 0) throw new Error('The firmware file is empty.');
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try {
      this.transport.acquire('protocol');
      this.setState('connecting', 'Handshaking with the bootloader…');
      if (options.enterDownload) await this.enterDownloadMode(signal);
      await this.handshake(options.baudRate, signal);
      await this.erase(options.erase, options.offset, firmware.length, signal);
      this.setState('transferring', 'Transferring firmware…');
      const chunkSize = chooseChunk(options.modeK, firmware.length);
      for (let pos = 0, block = 0; pos < firmware.length; block++) {
        const length = Math.min(chunkSize, firmware.length - pos);
        const address = options.offset + pos;
        const chunk = firmware.subarray(pos, pos + length);
        this.onLog(`download ${block}: 0x${address.toString(16)}..0x${(address + length).toString(16)}`);
        await this.transport.write(fwdCommand(options.modeK, options.pro2, length, address));
        await transmit(this.transport, chunk, {
          modeK: options.modeK,
          signal,
          onProgress: (done) => this.onProgress(pos + done, firmware.length, 'transferring')
        });
        const ok = decoder.decode(await this.transport.readExact(2, 5000, signal));
        if (ok !== 'OK') throw new Error(`download final response: ${JSON.stringify(ok)}`);
        if (options.verify) {
          this.setState('verifying', `Verifying block  ${block + 1}…`);
          await this.verifyHash(chunk, address, options.pro2, signal);
          if (pos + length < firmware.length) this.setState('transferring', 'Transferring firmware…');
        }
        pos += length;
      }
      this.onProgress(firmware.length, firmware.length, 'completed');
      this.setState('completed', 'Firmware burn completed.');
    } catch (error) {
      if (error.name === 'AbortError') {
        this.setState('cancelled', 'Firmware burn canceled.');
        throw error;
      }
      else { this.setState('failed', error.message); throw error; }
    } finally {
      this.abortController = null;
    }
  }
}

export function toHex(bytes) { return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''); }
