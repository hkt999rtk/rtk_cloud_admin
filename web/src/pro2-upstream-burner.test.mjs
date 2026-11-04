import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnController, chooseChunk, fwdCommand, parseOffset } from './pro2-firmware-burner/burner.js';
import { readFileSync } from 'node:fs';
import { protocolMock, options, encode, turn } from './pro2-firmware-burner/upstream-tests/helpers.js';

const contract = JSON.parse(readFileSync(new URL('./pro2-firmware-burner/upstream-tests/fixtures/original-exe-nor-contract.json', import.meta.url)));

for (const phase of ['handshake', 'erase', 'data', 'hash-delay', 'hash-digest']) {
  test(`user cancellation during ${phase} rejects without a completed state`, async () => {
    const states = []; let reads = 0;
    const data = Uint8Array.of(1, 2, 3);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const transport = protocolMock({
      async readByte() {
        if (reads++ === 0) return 67;
        if (phase === 'data') { controller.cancel(); throw new DOMException('cancel', 'AbortError'); }
        return 6;
      },
      async readExact(length) {
        if (length === 2) return encode('OK');
        if (length === 6) return encode('hashs ');
        if (phase === 'hash-digest') controller.cancel();
        const response = new Uint8Array(64); response.set(digest); return response;
      }
    });
    const controller = new BurnController(transport, { onState: state => states.push(state) });
    controller.handshake = async () => { if (phase === 'handshake') { controller.cancel(); throw new DOMException('cancel', 'AbortError'); } };
    controller.erase = async () => { if (phase === 'erase') { controller.cancel(); throw new DOMException('cancel', 'AbortError'); } };
    const realTimeout = globalThis.setTimeout;
    if (phase === 'hash-delay') globalThis.setTimeout = () => { queueMicrotask(() => controller.cancel()); return 0; };
    try { await assert.rejects(() => controller.burn(data, options({ verify: phase.startsWith('hash') })), { name: 'AbortError' }); }
    finally { globalThis.setTimeout = realTimeout; }
    assert.equal(controller.state, 'cancelled');
    assert.equal(states.includes('completed'), false);
    assert.equal(transport.owner, 'idle');
    assert.equal(transport.writes.filter(value => value instanceof Uint8Array && value.length === 3 && value[0] === 0x18).length, phase === 'data' ? 1 : 0);
  });
}

test('pending write retains the job/owner until settled and cancellation sends no next command', async () => {
  let release; let started;
  const writing = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const transport = protocolMock({ async write(value) { this.writes.push(value); started(); await pending; } });
  const controller = new BurnController(transport);
  const job = controller.burn(Uint8Array.of(1), options());
  const rejected = assert.rejects(job, { name: 'AbortError' });
  await writing; controller.cancel(); await turn();
  assert.equal(transport.owner, 'protocol');
  assert.ok(controller.abortController);
  await assert.rejects(() => controller.burn(Uint8Array.of(1), options()), /already in progress/);
  release(); await rejected;
  assert.deepEqual(transport.writes, ['ping\n']);
  assert.equal(transport.owner, 'idle');
});

test('cancellation after EOT ACK while awaiting command OK does not send XMODEM CAN', async () => {
  let reads = 0;
  const transport = protocolMock({
    async readByte() { return reads++ === 0 ? 67 : 6; },
    async readExact() { controller.cancel(); throw new DOMException('cancel', 'AbortError'); }
  });
  const controller = new BurnController(transport);
  controller.handshake = async () => {};
  await assert.rejects(() => controller.burn(Uint8Array.of(1), options()), { name: 'AbortError' });
  assert.equal(transport.writes.some(value => value instanceof Uint8Array && value[0] === 0x18), false);
});

test('ordinary failures keep their original error even if draining fails', async () => {
  const original = new Error('original wire failure');
  const transport = protocolMock({ async drainWrites() { throw new Error('cleanup failure'); } });
  const controller = new BurnController(transport);
  controller.handshake = async () => { throw original; };
  await assert.rejects(controller.burn(Uint8Array.of(1), options()), error => error === original);
  assert.equal(controller.state, 'failed');
  assert.equal(transport.owner, 'idle');
});

test('PRO2 hash uses the original LF, 20ms wait and binary digest contract', async () => {
  const entry = contract.cases.find(value => value.id === 'hash_pro2');
  const expected = entry.expected;
  const reads = []; const delays = [];
  const transport = protocolMock({
    async readExact(length, timeout) {
      reads.push([length, timeout]);
      if (length === 6) return encode(expected.header);
      const remote = new Uint8Array(64); remote.set(Buffer.from(expected.digestHex, 'hex')); return remote;
    }
  });
  transport.acquire('protocol');
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms) => { delays.push(ms); queueMicrotask(callback); return 0; };
  try { await new BurnController(transport).verifyHash(Uint8Array.from(entry.input.data), 0, true); }
  finally { globalThis.setTimeout = realTimeout; }
  assert.deepEqual(transport.writes, [expected.command]);
  assert.deepEqual(delays, [expected.delayMs]);
  assert.deepEqual(reads, [[6, 5000], [64, 5000]]);
});

test('hash rejects wrong header, truncated digest or mismatched binary digest', async () => {
  for (const failure of ['header', 'short', 'digest']) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.of(1, 2, 3)));
    const transport = protocolMock({ async readExact(length) {
      if (length === 6) return encode(failure === 'header' ? 'wrong!' : 'hashs ');
      return failure === 'short' ? digest : new Uint8Array(64);
    } });
    transport.acquire('protocol');
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = callback => { queueMicrotask(callback); return 0; };
    try { await assert.rejects(() => new BurnController(transport).verifyHash(Uint8Array.of(1, 2, 3), 0, true), /hash|SHA|長度/); }
    finally { globalThis.setTimeout = realTimeout; }
  }
});

test('XMODEM ACK is followed by independent command OK with original timeout', async () => {
  let byteReads = 0;
  const transport = protocolMock({
    async readByte() { return byteReads++ === 0 ? 67 : 6; }
  });
  await new BurnController(transport).burn(Uint8Array.of(1, 2, 3), options());
  assert.deepEqual(transport.reads.at(-1), { length: 2, timeout: 1000 });
});

for (const [mode, id] of [['sector', 'erase_sector'], ['chip', 'erase_chip']]) {
  test(`${mode} erase matches the original EXE command and requires exact OK`, async () => {
    const entry = contract.cases.find(value => value.id === id);
    const transport = protocolMock(); transport.acquire('protocol');
    await new BurnController(transport).erase(mode, 0x1000, 0x2000);
    assert.deepEqual(transport.writes, [entry.expected.command]);
    assert.deepEqual(transport.reads, [{ length: 2, timeout: entry.expected.timeoutMs }]);
  });
}

test('sector erase masks both endpoints for a valid native high-address alias', async () => {
  const transport = protocolMock(); transport.acquire('protocol');
  await new BurnController(transport).erase('sector', 0x08001000, 0x2000);
  assert.equal(transport.writes[0], 'seras 1000 2000 0 0\n');
});

test('erase rejects a device error or truncated OK instead of continuing', async () => {
  for (const reply of ['ER', 'O']) {
    const transport = protocolMock({ async readExact() { return encode(reply); }, async readSome() { return encode(reply); } });
    transport.acquire('protocol');
    await assert.rejects(() => new BurnController(transport).erase('sector', 0, 0x1000), /erase|清除|OK/);
  }
});

test('invalid burn ranges/options fail before any UART side effect', async () => {
  const invalid = [
    { offset: -1 }, { offset: NaN }, { offset: 1.5 }, { offset: 0xffffffff },
    { offset: 0x07fffffe, erase: 'sector' }, { baudRate: 0 }, { modeK: 3 }, { erase: 'unknown' },
    { offset: 0x1000, verify: true }
  ];
  for (const override of invalid) {
    const transport = protocolMock({ async write(value) { this.writes.push(value); throw new Error('unexpected UART side effect'); } });
    await assert.rejects(() => new BurnController(transport).burn(Uint8Array.of(1, 2, 3), options(override)));
    assert.equal(transport.writes.length, 0, JSON.stringify(override));
    assert.equal(transport.owner, 'idle');
  }
  const transport = protocolMock();
  await assert.rejects(() => new BurnController(transport).burn(new Uint8Array(), options()));
  assert.equal(transport.writes.length, 0);
});

test('parseOffset accepts decimal and hex', () => {
  assert.equal(parseOffset('0x40000'), 0x40000);
  assert.equal(parseOffset('262144'), 262144);
  for (const invalid of ['', '-1', '0xzz', '1.5', '0x100000000']) assert.throws(() => parseOffset(invalid));
});

test('chunk plan follows native implementation', () => {
  assert.equal(chooseChunk(1, 4956160), 4956160);
  assert.equal(chooseChunk(4, 4956160), 4096);
  assert.equal(chooseChunk(16, 4956160), 16384);
  assert.equal(chooseChunk(32, 4956160), 32768);
});

test('forward commands match native transcript', () => {
  assert.equal(fwdCommand(1, false, 256, 0), 'fwd 0 0 0 \n');
  assert.equal(fwdCommand(4, true, 256, 0x1000), 'fwd 0 0 1000 \n');
  assert.equal(fwdCommand(4, false, 4096, 0x2000), 'fwd4k 0 4096 2000 \n');
  assert.equal(fwdCommand(16, false, 16384, 0x3000), 'fwd16k 0 16384 3000 \n');
});

test('NOR burn does not send flash detect before fwd', async () => {
  const writes = [];
  const xmodemResponses = [67, 6, 6];
  const transport = {
    baudRate: 115200,
    connected: true,
    acquire() {},
    flushInput() {},
    async reopen(baudRate) { this.baudRate = baudRate; },
    async write(data) { writes.push(typeof data === 'string' ? data : Array.from(data)); },
    async readExact(length) {
      const last = writes.at(-1);
      if (last === 'ping\n') return new TextEncoder().encode('ping');
      if (last === 'ucfg 115200 0 0\n') return new TextEncoder().encode('OK');
      return new TextEncoder().encode('OK');
    },
    async readByte() { return xmodemResponses.shift() ?? 6; }
  };
  const controller = new BurnController(transport);
  await controller.burn(Uint8Array.of(1, 2, 3), {
    baudRate: 115200,
    offset: 0,
    erase: 'none',
    modeK: 1,
    verify: false,
    pro2: true
  });
  assert.deepEqual(writes.filter(item => typeof item === 'string'), [
    'ping\n',
    'ucfg 115200 0 0\n',
    'fwd 0 0 0 \n'
  ]);
});

test('enterDownloadMode follows native normal DTR/RTS sequence', async () => {
  const signals = [];
  const transport = {
    port: { setSignals: async signalsValue => signals.push(signalsValue) },
    baudRate: 1000000,
    reopens: [],
    async reopen(baudRate) { this.reopens.push(baudRate); this.baudRate = baudRate; },
    flushInput() {},
    async setSignals(signalsValue) { await this.port.setSignals(signalsValue); },
    async readSome() { return new TextEncoder().encode('Boot ROM\r\nDownload Image\r\n'); }
  };
  const controller = new BurnController(transport);
  await controller.enterDownloadMode();
  assert.deepEqual(transport.reopens, [115200]);
  assert.deepEqual(signals, [
    { dataTerminalReady: false, requestToSend: false },
    { requestToSend: false },
    { dataTerminalReady: true },
    { requestToSend: false },
    { dataTerminalReady: false },
    { requestToSend: true },
    { requestToSend: false },
    { dataTerminalReady: true }
  ]);
});

test('enterDownloadMode falls back to mini DTR/RTS sequence', async () => {
  const signals = [];
  let reads = 0;
  const transport = {
    port: { setSignals: async signalsValue => signals.push(signalsValue) },
    baudRate: 115200,
    async reopen(baudRate) { this.baudRate = baudRate; },
    flushInput() {},
    async setSignals(signalsValue) { await this.port.setSignals(signalsValue); },
    async readSome() {
      reads += 1;
      if (reads === 1) return new TextEncoder().encode('normal boot');
      if (reads === 2) throw new Error('UART read timeout');
      return new TextEncoder().encode('Test Mode');
    }
  };
  const controller = new BurnController(transport);
  await controller.enterDownloadMode();
  assert.deepEqual(signals.slice(-2), [
    { dataTerminalReady: false, requestToSend: true },
    { dataTerminalReady: true, requestToSend: false }
  ]);
});

test('download banner is assembled across UART chunks before trying mini', async () => {
  const logs = []; const replies = ['Boot ROM\r\nDown', 'load Image\r\n'];
  const transport = protocolMock({
    port: { setSignals() {} }, async setSignals() {},
    async readSome() { if (!replies.length) throw new Error('UART read timeout'); return encode(replies.shift()); }
  });
  const controller = new BurnController(transport, { onLog: line => logs.push(line) });
  await controller.enterDownloadMode();
  assert.equal(logs.some(line => line === 'enter download mode: mini sequence'), false);
});

test('a banner after embedded NUL cannot claim download-mode success', async () => {
  const transport = protocolMock({ port: { setSignals() {} }, async setSignals() {}, async readSome() { return encode('\0Download Image'); } });
  await assert.rejects(() => new BurnController(transport).enterDownloadMode(), /download mode/);
});
