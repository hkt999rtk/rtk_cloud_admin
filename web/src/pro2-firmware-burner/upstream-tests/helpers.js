import { SerialTransport } from '../serial.js';

export const encode = text => new TextEncoder().encode(text);
export const decode = bytes => new TextDecoder().decode(bytes);
export const turn = () => new Promise(resolve => setImmediate(resolve));
export const options = overrides => ({ baudRate: 115200, offset: 0, erase: 'none', modeK: 1, verify: false, pro2: true, ...overrides });

export function protocolMock(overrides = {}) {
  return {
    connected: true, baudRate: 115200, owner: 'idle', writes: [], reads: [],
    acquire(owner) { this.owner = owner; }, flushInput() {}, async drainWrites() {},
    async reopen(baudRate) { this.baudRate = baudRate; },
    async write(value, owner) { this.writes.push(value); if (owner && owner !== this.owner) throw new Error('wrong owner'); },
    async readExact(length, timeout) {
      this.reads.push({ length, timeout });
      if (length === 4) return encode('ping');
      if (length === 2) return encode('OK');
      throw new Error('unexpected read');
    },
    async readSome() { return encode('OK'); },
    async readByte() { return 6; },
    ...overrides
  };
}

export async function streamTransport(onWrite = () => {}) {
  const transport = new SerialTransport();
  let input;
  const port = {
    async open() {
      this.readable = new ReadableStream({ start(controller) { input = controller; } });
      this.writable = new WritableStream({ write(bytes) { return onWrite(bytes, push); } });
    },
    async close() { this.readable = null; this.writable = null; },
    async setSignals() {}
  };
  const push = bytes => input.enqueue(typeof bytes === 'string' ? encode(bytes) : bytes);
  transport.port = port;
  await transport.open(115200);
  transport.acquire('protocol');
  return { transport, port, push, end: () => input.close() };
}
