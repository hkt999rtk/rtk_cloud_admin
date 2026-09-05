// Integrated from uartfwburn commit 81f808f; UI copy adapted for the Developer Console.
const encoder = new TextEncoder();

export class SerialTransport {
  constructor({ onLog = () => {} } = {}) {
    this.onLog = onLog;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.buffer = [];
    this.waiters = new Set();
    this.readLoop = null;
    this.readError = null;
    this.baudRate = 115200;
    this.owner = 'idle';
    this.terminalSubscribers = new Set();
    this.writeChain = Promise.resolve();
  }

  get connected() { return Boolean(this.port?.readable && this.port?.writable); }

  async requestAndOpen(baudRate = 115200) {
    if (!('serial' in navigator)) throw new Error('This browser does not support Web Serial.');
    this.port = await navigator.serial.requestPort();
    try {
      await this.open(baudRate);
    } catch (error) {
      try { await this.port?.close(); } catch {}
      this.port = null;
      throw error;
    }
  }

  async open(baudRate) {
    if (!this.port) throw new Error('No serial port has been selected.');
    if (this.connected) throw new Error('UART is already connected.');
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 16384 });
    this.baudRate = baudRate;
    this.buffer = [];
    this.readError = null;
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.readLoop = this.pumpReads();
    this.onLog(`UART opened at ${baudRate}`);
  }

  async pumpReads() {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value?.length) this.routeIncoming(value);
      }
    } catch (error) {
      if (this.reader) this.readError = error;
    } finally {
      for (const wake of this.waiters) wake();
      this.waiters.clear();
    }
  }

  write(data, expectedOwner) {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    const operation = this.writeChain.catch(() => {}).then(async () => {
      if (!this.writer) throw new Error('UART is not connected.');
      if (expectedOwner && this.owner !== expectedOwner) throw new Error(`UART is owned by ${this.owner}, not ${expectedOwner}`);
      await this.writer.write(bytes);
    });
    this.writeChain = operation;
    return operation;
  }

  flushInput() { this.buffer.length = 0; }

  routeIncoming(value) {
    if (this.owner === 'terminal') {
      for (const subscriber of this.terminalSubscribers) subscriber(value.slice());
    } else if (this.owner === 'protocol') {
      this.buffer.push(...value);
      for (const wake of this.waiters) wake();
      this.waiters.clear();
    }
  }

  acquire(owner) {
    if (!['idle', 'protocol', 'terminal'].includes(owner)) throw new Error(`invalid UART owner: ${owner}`);
    this.buffer.length = 0;
    this.owner = owner;
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    this.onLog(`UART owner: ${owner}`);
  }

  subscribeTerminal(callback) {
    this.terminalSubscribers.add(callback);
    return () => this.terminalSubscribers.delete(callback);
  }

  async drainWrites() { await this.writeChain.catch(() => {}); }

  async readExact(length, timeoutMs, signal) {
    if (this.owner !== 'protocol') throw new Error('UART protocol reader is not active');
    const out = new Uint8Array(length);
    let offset = 0;
    const deadline = Date.now() + timeoutMs;
    while (offset < length) {
      if (this.owner !== 'protocol') throw abortError('UART ownership changed');
      if (signal?.aborted) throw abortError();
      if (this.readError) throw new Error(`UART read failed: ${this.readError.message}`);
      while (this.buffer.length && offset < length) out[offset++] = this.buffer.shift();
      if (offset === length) break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`UART read timeout (${timeoutMs} ms)`);
      await this.waitForData(remaining, signal);
    }
    return out;
  }

  async readByte(timeoutMs, signal) { return (await this.readExact(1, timeoutMs, signal))[0]; }

  async readSome(timeoutMs, signal) {
    if (this.owner !== 'protocol') throw new Error('UART protocol reader is not active');
    if (!this.buffer.length) await this.waitForData(timeoutMs, signal);
    if (this.readError) throw new Error(`UART read failed: ${this.readError.message}`);
    if (!this.buffer.length) throw new Error(`UART read timeout (${timeoutMs} ms)`);
    return Uint8Array.from(this.buffer.splice(0));
  }

  waitForData(timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(wake);
        signal?.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const wake = () => finish();
      const aborted = () => finish(abortError());
      const timer = setTimeout(() => finish(), timeoutMs);
      this.waiters.add(wake);
      signal?.addEventListener('abort', aborted, { once: true });
      if (this.buffer.length || this.readError) wake();
    });
  }

  async reopen(baudRate) {
    await this.closeStreams();
    await this.port.close();
    await this.open(baudRate);
  }

  async setSignals(signals) {
    if (!this.port) throw new Error('UART is not connected.');
    await this.port.setSignals(signals);
  }

  async closeStreams() {
    const reader = this.reader;
    const writer = this.writer;
    this.reader = null;
    this.writer = null;
    try { await reader?.cancel(); } catch {}
    try { reader?.releaseLock(); } catch {}
    try { writer?.releaseLock(); } catch {}
    try { await this.readLoop; } catch {}
    this.readLoop = null;
  }

  async close() {
    this.acquire('idle');
    await this.drainWrites();
    await this.closeStreams();
    if (this.port?.readable || this.port?.writable) await this.port.close();
    this.port = null;
    this.buffer = [];
    this.readError = null;
    this.terminalSubscribers.clear();
    this.onLog('UART closed');
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

export function abortError(message = 'Operation canceled.') { return new DOMException(message, 'AbortError'); }
