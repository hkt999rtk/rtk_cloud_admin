import test from 'node:test';
import assert from 'node:assert/strict';

import { BurnController, chooseChunk, fwdCommand, parseOffset, toHex } from './pro2-firmware-burner/burner.js';
import { sha256Hex } from './pro2-firmware-burner/firmware-meta.js';
import { abortError, SerialTransport, sleep } from './pro2-firmware-burner/serial.js';
import { normalizeTerminalInput, StreamingTerminalDecoder } from './pro2-firmware-burner/terminal-codec.js';
import { crc16, makePacket, modeInfo, transmit, X } from './pro2-firmware-burner/xmodem.js';

const encoder = new TextEncoder();

async function withoutDelay(run) {
  const nativeSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = callback => {
    queueMicrotask(callback);
    return 0;
  };
  try { return await run(); }
  finally { globalThis.setTimeout = nativeSetTimeout; }
}

function scriptedXmodem(responses) {
  const writes = [];
  return {
    writes,
    async write(value) { writes.push(Uint8Array.from(value)); },
    async readByte() {
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

test('PRO2 firmware offsets, chunks, and forward commands retain uartfwburn behavior', () => {
  assert.equal(parseOffset('0x40000'), 0x40000);
  assert.equal(parseOffset('262144'), 262144);
  for (const invalid of ['', '-1', '0xzz', '1.5', '0x100000000']) assert.throws(() => parseOffset(invalid));
  assert.equal(chooseChunk(1, 4956160), 4956160);
  assert.equal(chooseChunk(4, 4956160), 4096);
  assert.equal(chooseChunk(16, 4956160), 16384);
  assert.equal(chooseChunk(32, 4956160), 32768);
  assert.equal(fwdCommand(1, false, 256, 0), 'fwd 0 0 0 \n');
  assert.equal(fwdCommand(4, true, 256, 0x1000), 'fwd 0 0 1000 \n');
});

test('PRO2 XMODEM retains CRC and 1K packet framing', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x31c3);
  const data = Uint8Array.from({ length: 256 }, (_, index) => index);
  const { packet, payloadSize, count } = makePacket(data, 0, 1, 1, true);
  assert.equal(payloadSize, 1024);
  assert.equal(count, 256);
  assert.equal(packet.length, 1029);
  assert.deepEqual(Array.from(packet.slice(0, 3)), [X.STX, 1, 0xfe]);
  assert.equal(packet[3 + 256], 0x1a);
  assert.equal((packet[1027] << 8) | packet[1028], crc16(packet.slice(3, 1027)));
});

test('PRO2 XMODEM mode and checksum packets cover supported bootloader variants', () => {
  assert.deepEqual(modeInfo(32), { start: 0xa1, payloadSize: 32768, modeK: 32 });
  assert.deepEqual(modeInfo(99), { start: X.STX, payloadSize: 1024, modeK: 1 });
  assert.deepEqual(modeInfo(16, false), { start: X.SOH, payloadSize: 128, modeK: 1 });
  const { packet, payloadSize, count } = makePacket(Uint8Array.of(1, 2, 3), 0, 257, 16, false);
  assert.equal(payloadSize, 128);
  assert.equal(count, 3);
  assert.deepEqual(Array.from(packet.slice(0, 3)), [X.SOH, 1, 0xfe]);
  assert.equal(packet[6], 0x1a);
  assert.equal(packet.at(-1), packet.slice(3, -1).reduce((sum, byte) => (sum + byte) & 0xff, 0));
});

test('PRO2 XMODEM transmits CRC and checksum sessions with progress', async () => {
  for (const start of [X.CRC, X.NAK]) {
    const transport = scriptedXmodem([start, X.ACK, X.ACK]);
    const progress = [];
    await transmit(transport, Uint8Array.of(1, 2, 3), { onProgress: (...value) => progress.push(value) });
    assert.deepEqual(progress, [[3, 3]]);
    assert.equal(transport.writes.length, 2);
    assert.deepEqual(Array.from(transport.writes.at(-1)), [X.EOT, 0, 0, 0]);
    assert.equal(transport.writes[0][0], start === X.CRC ? X.STX : X.SOH);
  }
});

test('PRO2 XMODEM retries noise and rejects receiver cancellation and timeouts', async () => {
  const noisy = scriptedXmodem([new Error('timeout'), 0, X.CRC, X.ACK, X.ACK]);
  await transmit(noisy, Uint8Array.of(1));
  const canceled = scriptedXmodem([X.CAN, X.CAN]);
  await assert.rejects(transmit(canceled, Uint8Array.of(1)), /Device canceled XMODEM/);
  assert.deepEqual(Array.from(canceled.writes.at(-1)), [X.ACK]);
  const timedOut = scriptedXmodem(Array.from({ length: 16 }, () => new Error('timeout')));
  await assert.rejects(transmit(timedOut, Uint8Array.of(1)), /Timed out waiting/);
  assert.deepEqual(Array.from(timedOut.writes.at(-1)), [X.CAN, X.CAN, X.CAN]);
});

test('PRO2 XMODEM cancels failed blocks and requires an acknowledged EOT', async () => {
  const failedBlock = scriptedXmodem([X.CRC, ...Array(25).fill(X.NAK)]);
  await assert.rejects(transmit(failedBlock, Uint8Array.of(1)), /block 1 failed/);
  assert.deepEqual(Array.from(failedBlock.writes.at(-1)), [X.CAN, X.CAN, X.CAN]);
  const canceledBlock = scriptedXmodem([X.CRC, X.CAN, X.CAN]);
  await assert.rejects(transmit(canceledBlock, Uint8Array.of(1)), /Device canceled XMODEM/);
  const failedEot = scriptedXmodem([X.CRC, X.ACK, ...Array(10).fill(X.NAK)]);
  await assert.rejects(transmit(failedEot, Uint8Array.of(1)), /EOT was not acknowledged/);
  const retriedEot = scriptedXmodem([X.CRC, X.ACK, new Error('timeout'), X.ACK]);
  await transmit(retriedEot, Uint8Array.of(1));
});

test('PRO2 terminal codec and UART ownership remain isolated', () => {
  assert.equal(normalizeTerminalInput('one\r\ntwo\rthree\nfour', 'crlf'), 'one\r\ntwo\r\nthree\r\nfour');
  const decoder = new StreamingTerminalDecoder();
  const bytes = new TextEncoder().encode('ready');
  assert.equal(decoder.decode(bytes.slice(0, 2)), 're');
  assert.equal(decoder.decode(bytes.slice(2)), 'ady');
  const transport = new SerialTransport();
  const terminalBytes = [];
  transport.subscribeTerminal((value) => terminalBytes.push(...value));
  transport.acquire('terminal');
  transport.routeIncoming(Uint8Array.of(1, 2));
  assert.deepEqual(terminalBytes, [1, 2]);
  assert.deepEqual(transport.buffer, []);
  transport.acquire('protocol');
  transport.routeIncoming(Uint8Array.of(3, 4));
  assert.deepEqual(transport.buffer, [3, 4]);
});

test('PRO2 serial transport validates ownership, writes, reads, and subscriptions', async () => {
  const transport = new SerialTransport();
  await assert.rejects(transport.write('offline'), /not connected/);
  assert.throws(() => transport.acquire('other'), /invalid UART owner/);
  transport.acquire('protocol');
  const written = [];
  transport.writer = { async write(value) { written.push(Array.from(value)); } };
  await assert.rejects(transport.write('x', 'terminal'), /owned by protocol/);
  await transport.write('ok', 'protocol');
  assert.deepEqual(written, [[111, 107]]);
  transport.routeIncoming(Uint8Array.of(7, 8, 9));
  assert.equal(await transport.readByte(10), 7);
  assert.deepEqual(Array.from(await transport.readExact(2, 10)), [8, 9]);
  transport.routeIncoming(Uint8Array.of(10, 11));
  assert.deepEqual(Array.from(await transport.readSome(10)), [10, 11]);
  transport.acquire('terminal');
  await assert.rejects(transport.readExact(1, 1), /not active/);
  await assert.rejects(transport.readSome(1), /not active/);
  const values = [];
  const unsubscribe = transport.subscribeTerminal(value => values.push(...value));
  transport.routeIncoming(Uint8Array.of(12));
  unsubscribe();
  transport.routeIncoming(Uint8Array.of(13));
  assert.deepEqual(values, [12]);
});

test('PRO2 serial transport reports abort, timeout, read error, and ownership changes', async () => {
  const transport = new SerialTransport();
  transport.acquire('protocol');
  await assert.rejects(transport.readExact(1, 0), /read timeout/);
  transport.readError = new Error('cable removed');
  await assert.rejects(transport.readExact(1, 10), /cable removed/);
  await assert.rejects(transport.readSome(10), /cable removed/);
  transport.readError = null;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transport.readExact(1, 10, controller.signal), error => error.name === 'AbortError');
  const waiting = transport.waitForData(1000);
  transport.routeIncoming(Uint8Array.of(1));
  await waiting;
  transport.flushInput();
  const aborting = new AbortController();
  const aborted = transport.waitForData(1000, aborting.signal);
  aborting.abort();
  await assert.rejects(aborted, error => error.name === 'AbortError');
  const changed = transport.readExact(1, 1000);
  transport.acquire('terminal');
  await assert.rejects(changed, error => error.name === 'AbortError');
});

test('PRO2 serial transport opens, pumps, reopens, signals, and closes a port', async () => {
  const logs = [];
  const writes = [];
  const reader = {
    reads: [{ value: Uint8Array.of(1, 2), done: false }, { done: true }],
    async read() { return this.reads.shift(); },
    async cancel() {},
    releaseLock() {},
  };
  const writer = { async write(value) { writes.push(Array.from(value)); }, releaseLock() {} };
  const port = {
    readable: null,
    writable: null,
    closes: 0,
    signals: [],
    async open(options) {
      this.options = options;
      this.readable = { getReader: () => reader };
      this.writable = { getWriter: () => writer };
    },
    async close() { this.closes++; this.readable = null; this.writable = null; },
    async setSignals(value) { this.signals.push(value); },
  };
  const transport = new SerialTransport({ onLog: value => logs.push(value) });
  await assert.rejects(transport.open(115200), /No serial port/);
  transport.port = port;
  transport.acquire('protocol');
  await transport.open(230400);
  await transport.readLoop;
  assert.equal(transport.baudRate, 230400);
  assert.deepEqual(transport.buffer, [1, 2]);
  await transport.write(Uint8Array.of(3), 'protocol');
  assert.deepEqual(writes, [[3]]);
  await assert.rejects(transport.open(115200), /already connected/);
  await transport.setSignals({ requestToSend: true });
  assert.deepEqual(port.signals, [{ requestToSend: true }]);
  reader.reads = [{ done: true }];
  await transport.reopen(115200);
  await transport.close();
  assert.equal(transport.port, null);
  assert.equal(transport.owner, 'idle');
  assert.ok(logs.includes('UART opened at 230400'));
  const noPort = new SerialTransport();
  await assert.rejects(noPort.setSignals({}), /not connected/);
});

test('PRO2 serial request handles unsupported browsers and failed opens', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');
  try {
    if (descriptor) delete navigator.serial;
    await assert.rejects(new SerialTransport().requestAndOpen(), /does not support Web Serial/);
    let closed = false;
    const port = { async open() { throw new Error('open failed'); }, async close() { closed = true; } };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { async requestPort() { return port; } } });
    const transport = new SerialTransport();
    await assert.rejects(transport.requestAndOpen(), /open failed/);
    assert.equal(closed, true);
    assert.equal(transport.port, null);
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'serial', descriptor);
    else delete navigator.serial;
  }
});

test('PRO2 serial pump and close tolerate stream cleanup errors', async () => {
  const transport = new SerialTransport();
  transport.reader = { async read() { throw new Error('read failed'); }, async cancel() { throw new Error('cancel failed'); }, releaseLock() { throw new Error('reader lock'); } };
  transport.writer = { releaseLock() { throw new Error('writer lock'); } };
  await transport.pumpReads();
  assert.match(transport.readError.message, /read failed/);
  transport.readLoop = Promise.reject(new Error('loop failed'));
  await transport.closeStreams();
  await transport.drainWrites();
});

test('PRO2 sleep and abort helpers settle predictably', async () => {
  await sleep(0);
  const controller = new AbortController();
  const pending = sleep(1000, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(abortError('stopped').message, 'stopped');
});

test('PRO2 local firmware checksum is lowercase SHA-256', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('canceling a PRO2 burn stops the workflow instead of reporting completion', async () => {
  const states = [];
  const transport = {
    baudRate: 115200,
    connected: true,
    acquire() {},
    flushInput() {},
    async write() {},
    readExact(_length, _timeout, signal) {
      if (signal.aborted) return Promise.reject(new DOMException('Operation canceled.', 'AbortError'));
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Operation canceled.', 'AbortError')), { once: true }));
    },
  };
  const controller = new BurnController(transport, { onState: state => states.push(state) });
  const pending = controller.burn(Uint8Array.of(1), {
    baudRate: 115200,
    offset: 0,
    erase: 'none',
    modeK: 1,
    enterDownload: false,
    verify: false,
    pro2: true,
    reset: false,
  });
  controller.cancel();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.deepEqual(states, ['connecting', 'cancelled']);
});

test('PRO2 burn controller validates state, connection, and firmware input', async () => {
  const events = [];
  const controller = new BurnController({ connected: false }, { onState: (...value) => events.push(value), onLog: value => events.push(value) });
  assert.throws(() => controller.setState('unknown', 'bad'), /invalid state/);
  controller.setState('ready', 'Ready');
  assert.equal(controller.state, 'ready');
  assert.deepEqual(events, [['ready', 'Ready'], 'ready: Ready']);
  await assert.rejects(controller.burn(Uint8Array.of(1), {}), /not connected/);
  controller.transport.connected = true;
  await assert.rejects(controller.burn(new Uint8Array(), {}), /empty/);
  controller.abortController = new AbortController();
  await assert.rejects(controller.burn(Uint8Array.of(1), {}), /already in progress/);
});

test('PRO2 burn handshake retries ping, switches baud, and validates ucfg', async () => {
  const logs = [];
  const writes = [];
  const responses = [new Error('timeout'), encoder.encode('ping'), encoder.encode('OK')];
  const transport = {
    baudRate: 230400,
    flushes: 0,
    async reopen(value) { this.baudRate = value; },
    flushInput() { this.flushes++; },
    async write(value) { writes.push(value); },
    async readExact() {
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return value;
    },
  };
  const controller = new BurnController(transport, { onLog: value => logs.push(value) });
  await withoutDelay(() => controller.handshake(460800, new AbortController().signal));
  assert.equal(transport.baudRate, 460800);
  assert.deepEqual(writes, ['ping\n', 'ping\n', 'ucfg 460800 0 0\n']);
  assert.ok(logs.includes('ping attempt 1 failed'));
  assert.ok(logs.includes('ucfg ok'));
  const failed = new BurnController({
    baudRate: 115200,
    flushInput() {},
    async write() {},
    async readExact(length) { return length === 4 ? encoder.encode('nope') : encoder.encode('NO'); },
  });
  await assert.rejects(failed.handshake(115200), /Ping failed/);
  const badConfig = new BurnController({
    baudRate: 115200,
    flushInput() {},
    async write() {},
    async readExact(length) { return length === 4 ? encoder.encode('ping') : encoder.encode('NO'); },
  });
  await assert.rejects(withoutDelay(() => badConfig.handshake(115200)), /ucfg failed/);
  const aborted = new BurnController({
    baudRate: 115200,
    flushInput() {},
    async write() {},
    async readExact() { throw abortError(); },
  });
  await assert.rejects(aborted.handshake(115200), error => error.name === 'AbortError');
});

test('PRO2 automatic download mode supports normal and mini sequences', async () => {
  const signals = [];
  const logs = [];
  const transport = {
    baudRate: 230400,
    port: { setSignals() {} },
    banners: [encoder.encode('noise'), encoder.encode('Download Image')],
    async reopen(value) { this.baudRate = value; },
    async setSignals(value) { signals.push(value); },
    flushInput() {},
    async readSome() { return this.banners.shift(); },
  };
  const controller = new BurnController(transport, { onLog: value => logs.push(value) });
  await withoutDelay(() => controller.enterDownloadMode());
  assert.equal(transport.baudRate, 115200);
  assert.ok(logs.includes('enter download mode: mini sequence'));
  assert.ok(logs.includes('download mode ok'));
  assert.ok(signals.length > 4);
  await assert.rejects(new BurnController({ port: null }).enterDownloadMode(), /cannot control/);
  const failing = new BurnController({
    baudRate: 115200,
    port: { setSignals() {} },
    async setSignals() { throw new Error('pins failed'); },
    flushInput() {},
  });
  await assert.rejects(withoutDelay(() => failing.enterDownloadMode()), /pins failed/);
});

test('PRO2 erase and hash verification emit commands and reject bad responses', async () => {
  const writes = [];
  const logs = [];
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.of(1, 2, 3)));
  const remote = new Uint8Array(64);
  remote.set(digest);
  const transport = {
    someResponses: [encoder.encode('chip erased'), encoder.encode('range erased')],
    exactResponses: [encoder.encode('hashs '), remote],
    async write(value) { writes.push(value); },
    async readSome() { return this.someResponses.shift(); },
    async readExact() { return this.exactResponses.shift(); },
  };
  const controller = new BurnController(transport, { onLog: value => logs.push(value) });
  await controller.erase('none', 0, 3);
  await controller.erase('chip', 0, 3);
  await controller.erase('range', 0x1000, 3);
  await withoutDelay(() => controller.verifyHash(Uint8Array.of(1, 2, 3), 0x1000, true));
  assert.deepEqual(writes.slice(0, 2), ['ceras 0 0\r\n', 'seras 1000 1003 0 0\r\n']);
  assert.match(writes[2], /^hashq 3 1000 0 /);
  assert.ok(logs.some(value => value.startsWith('SHA-256 match:')));
  const badHeader = new BurnController({ async write() {}, async readExact() { return encoder.encode('wrong!'); } });
  await assert.rejects(badHeader.verifyHash(Uint8Array.of(1), 0, false), /Unexpected hashq response/);
  const badRemote = new BurnController({
    values: [encoder.encode('hashs '), new Uint8Array(64)],
    async write() {},
    async readExact() { return this.values.shift(); },
  });
  await assert.rejects(withoutDelay(() => badRemote.verifyHash(Uint8Array.of(1), 0, false)), /verification failed/);
  assert.equal(toHex(Uint8Array.of(0, 15, 255)), '000fff');
});

test('PRO2 burn completes a transfer and records protocol failures', async () => {
  const states = [];
  const progress = [];
  const transport = {
    baudRate: 115200,
    connected: true,
    exact: [encoder.encode('ping'), encoder.encode('OK'), encoder.encode('OK')],
    bytes: [X.CRC, X.ACK, X.ACK],
    acquire(owner) { this.owner = owner; },
    flushInput() {},
    async write() {},
    async readExact() { return this.exact.shift(); },
    async readByte() { return this.bytes.shift(); },
  };
  const controller = new BurnController(transport, {
    onState: state => states.push(state),
    onProgress: (...value) => progress.push(value),
  });
  await withoutDelay(() => controller.burn(Uint8Array.of(1, 2), {
    baudRate: 115200, offset: 0x1000, erase: 'none', modeK: 1, enterDownload: false, verify: false, pro2: true,
  }));
  assert.deepEqual(states, ['connecting', 'transferring', 'completed']);
  assert.deepEqual(progress.at(-1), [2, 2, 'completed']);
  assert.equal(controller.abortController, null);
  const failing = new BurnController({
    baudRate: 115200,
    connected: true,
    acquire() {},
    flushInput() {},
    async write() {},
    async readExact(length) {
      if (length === 4) return encoder.encode('ping');
      throw new Error('serial failed');
    },
  }, { onState: state => states.push(state) });
  await assert.rejects(withoutDelay(() => failing.burn(Uint8Array.of(1), {
    baudRate: 115200, offset: 0, erase: 'none', modeK: 1, enterDownload: false, verify: false, pro2: true,
  })), /serial failed/);
  assert.equal(failing.state, 'failed');
  assert.equal(failing.abortController, null);
});
