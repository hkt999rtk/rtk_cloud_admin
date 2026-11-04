// Integrated from uartfwburn 8608cad; Console UI messages adapted.
import { sleep } from './serial.js';
import { transmit } from './xmodem.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const VALID_STATES = new Set(['idle', 'connecting', 'ready', 'erasing', 'transferring', 'verifying', 'completed', 'cancelled', 'failed']);

function checkedRange(base, length) {
  if (!Number.isSafeInteger(base) || base < 0 || !Number.isSafeInteger(length) || length <= 0 || base + length > 0xffffffff) {
    throw new Error('Flash range exceeds 32-bit addresses or has an invalid length.');
  }
  return base + length;
}

function eraseRange(base, length) {
  const end = checkedRange(base, length);
  const start = base & 0x07ffffff;
  const maskedEnd = end & 0x07ffffff;
  if (maskedEnd <= start || Math.floor(base / 0x08000000) !== Math.floor(end / 0x08000000)) {
    throw new Error('Flash erase range crosses the address mask boundary.');
  }
  return { start, length: maskedEnd - start };
}

export function validateBurn(firmware, options) {
  if (!(firmware instanceof Uint8Array) || firmware.length === 0) throw new Error('The firmware file is empty.');
  checkedRange(options.offset, firmware.length);
  if (![115200, 1000000, 2000000, 3000000, 4000000].includes(options.baudRate)) throw new Error('Unsupported burn baud rate.');
  if (![1, 4, 8, 16, 32, 64].includes(options.modeK)) throw new Error('Unsupported XMODEM frame.');
  if (!['none', 'chip', 'sector'].includes(options.erase)) throw new Error('Unsupported erase mode.');
  if (options.erase === 'sector') eraseRange(options.offset, firmware.length);
  if (options.verify && options.pro2 && options.offset !== 0) throw new Error('PRO2 device verification at nonzero offset is unconfirmed; burn stopped.');
}

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

  async write(data, signal) {
    signal?.throwIfAborted();
    await this.transport.write(data, 'protocol', signal);
    signal?.throwIfAborted();
  }

  async handshake(baudRate, signal) {
    signal?.throwIfAborted();
    if (this.transport.baudRate !== 115200) await this.transport.reopen(115200);
    this.transport.flushInput();
    let pong = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.transport.flushInput();
      await this.write('ping\n', signal);
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
    await this.write(`ucfg ${baudRate} 0 0\n`, signal);
    await sleep(100, signal);
    if (baudRate !== this.transport.baudRate) await this.transport.reopen(baudRate);
    const ok = decoder.decode(await this.transport.readExact(2, 1000, signal));
    if (ok !== 'OK') throw new Error(`ucfg failed: ${JSON.stringify(ok)}`);
    this.onLog('ucfg ok');
  }

  async enterDownloadMode(signal) {
    signal?.throwIfAborted();
    if (!this.transport.port?.setSignals) throw new Error('This USB UART adapter cannot control the reset/boot pins. Enter download mode manually and turn off automatic download mode.');
    if (this.transport.baudRate !== 115200) await this.transport.reopen(115200);
    await this.transport.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(50, signal);
    this.transport.flushInput();
    for (const mini of [false, true]) {
      this.onLog(mini ? 'enter download mode: mini sequence' : 'enter download mode: normal sequence');
      try {
        await this.downloadModeSignals(mini, signal);
        const deadline = Date.now() + 2000;
        let response = '';
        while (response.length < 1024 && Date.now() < deadline) {
          signal?.throwIfAborted();
          const bytes = await this.transport.readSome(Math.max(1, deadline - Date.now()), signal);
          response += decoder.decode(bytes).slice(0, 1024 - response.length);
          response = response.split('\0', 1)[0];
          if (/Test Mode|Download Image/.test(response)) break;
          if (bytes.includes(0)) throw new Error('download mode banner mismatch');
        }
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
    signal?.throwIfAborted();
    if (mode === 'none') return;
    this.setState('erasing', mode === 'chip' ? 'Erasing the entire flash…' : 'Erasing the firmware range…');
    const range = mode === 'sector' ? eraseRange(base, length) : null;
    const command = mode === 'chip' ? 'ceras 0 0\n' : `seras ${range.start.toString(16)} ${range.length.toString(16)} 0 0\n`;
    await this.write(command, signal);
    const response = decoder.decode(await this.transport.readExact(2, 120000, signal));
    signal?.throwIfAborted();
    if (response !== 'OK') throw new Error(`Flash erase did not receive complete OK: ${JSON.stringify(response)}`);
    this.onLog(`erase response: ${JSON.stringify(response)}`);
  }

  async verifyHash(data, address, pro2, signal) {
    signal?.throwIfAborted();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const command = pro2 ? `hashq ${data.length} ${address.toString(16)} 0 \n` : `hashq ${data.length} 0 0 \n`;
    await this.write(command, signal);
    const header = decoder.decode(await this.transport.readExact(6, 5000, signal));
    if (header !== 'hashs ') throw new Error(`Unexpected hashq response: ${JSON.stringify(header)}`);
    await sleep(20, signal);
    const remote = await this.transport.readExact(64, 5000, signal);
    signal?.throwIfAborted();
    if (remote.length !== 64) throw new Error('Invalid hashq response length.');
    for (let i = 0; i < digest.length; i++) if (remote[i] !== digest[i]) throw new Error('SHA-256 verification failed.');
    this.onLog(`SHA-256 match: ${toHex(digest)}`);
  }

  async burn(firmware, options) {
    if (this.abortController) throw new Error('A firmware burn is already in progress.');
    if (!this.transport.connected) throw new Error('UART is not connected.');
    validateBurn(firmware, options);
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
        await this.write(fwdCommand(options.modeK, options.pro2, length, address), signal);
        await transmit(this.transport, chunk, {
          modeK: options.modeK,
          signal,
          onProgress: (done) => this.onProgress(pos + done, firmware.length, 'transferring')
        });
        const ok = decoder.decode(await this.transport.readExact(2, 1000, signal));
        signal.throwIfAborted();
        if (ok !== 'OK') throw new Error(`download final response: ${JSON.stringify(ok)}`);
        if (options.verify) {
          this.setState('verifying', `Verifying block  ${block + 1}…`);
          await this.verifyHash(chunk, address, options.pro2, signal);
          if (pos + length < firmware.length) this.setState('transferring', 'Transferring firmware…');
        }
        pos += length;
      }
      signal.throwIfAborted();
      this.onProgress(firmware.length, firmware.length, 'completed');
      this.setState('completed', 'Firmware burn completed.');
    } catch (error) {
      if (error.name === 'AbortError') this.setState('cancelled', 'Firmware burn canceled. Confirm Download Mode before retrying.');
      else this.setState('failed', error.message);
      throw error;
    } finally {
      try { await this.transport.drainWrites?.(); }
      catch (error) { this.onLog(`UART cleanup: ${error.message}`); }
      if (this.transport.owner === 'protocol') this.transport.acquire('idle');
      this.abortController = null;
    }
  }
}

export function toHex(bytes) { return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''); }
