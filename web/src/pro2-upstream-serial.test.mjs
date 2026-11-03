import test from 'node:test';
import assert from 'node:assert/strict';
import { streamTransport, turn, decode, encode, options } from './pro2-firmware-burner/upstream-tests/helpers.js';
import { BurnController } from './pro2-firmware-burner/burner.js';
import { SerialTransport, sleep } from './pro2-firmware-burner/serial.js';

test('already-aborted signals reject sleep, reads and queued writes before side effects', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => sleep(1, controller.signal), { name: 'AbortError' });
  const transport = new SerialTransport(); transport.acquire('protocol');
  transport.routeIncoming(encode('ready'));
  await assert.rejects(() => transport.readSome(20, controller.signal), { name: 'AbortError' });
  const writes = []; transport.writer = { async write(bytes) { writes.push(bytes); } };
  await assert.rejects(() => transport.write(encode('no'), 'protocol', controller.signal), { name: 'AbortError' });
  assert.equal(writes.length, 0);
});

test('sleep removes its abort listener on normal completion', async () => {
  const controller = new AbortController(); let removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  await sleep(1, controller.signal);
  assert.equal(removed, 1);
});

test('readSome detects ownership changes after waiting', async () => {
  const transport = new SerialTransport(); transport.acquire('protocol');
  const reading = assert.rejects(() => transport.readSome(100), { name: 'AbortError' });
  transport.acquire('idle'); await reading;
  assert.equal(transport.waiters.size, 0);
});

test('EOF fails pending reads immediately and marks the connection unusable', async () => {
  const { transport, end } = await streamTransport();
  try {
    const pending = assert.rejects(() => transport.readExact(2, 50), /closed|failed/);
    end(); await pending;
    assert.equal(transport.connected, false);
  } finally { await transport.close(); }
});

test('cancelled queued writes do not run after the previous write settles', async () => {
  const transport = new SerialTransport(); transport.acquire('protocol');
  const writes = []; let release;
  const pending = new Promise(resolve => { release = resolve; });
  transport.writer = { async write(bytes) { writes.push(bytes[0]); if (bytes[0] === 1) await pending; } };
  const first = transport.write(Uint8Array.of(1), 'protocol');
  const controller = new AbortController();
  const second = assert.rejects(() => transport.write(Uint8Array.of(2), 'protocol', controller.signal), { name: 'AbortError' });
  await turn(); controller.abort(); release(); await Promise.all([first, second]);
  assert.deepEqual(writes, [1]);
});

test('close retains protocol ownership while an in-flight write is pending', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { transport } = await streamTransport(() => pending);
  const writing = transport.write(Uint8Array.of(1), 'protocol');
  await turn(); const closing = transport.close(); await turn();
  const ownerDuringWrite = transport.owner;
  release(); await Promise.all([writing, closing]);
  assert.equal(ownerDuringWrite, 'protocol');
  assert.equal(transport.owner, 'idle');
});

test('readExact assembles fragmented replies and preserves the following bytes', async () => {
  const { transport, push } = await streamTransport();
  try {
    const reply = transport.readExact(2, 100);
    push('O'); await turn(); push('Ktail');
    assert.equal(decode(await reply), 'OK');
    assert.equal(decode(await transport.readExact(4, 100)), 'tail');
  } finally { await transport.close(); }
});

test('a partial OK expires under one read deadline and leaves no waiter', async () => {
  const { transport, push } = await streamTransport();
  try {
    push('O');
    await assert.rejects(() => transport.readExact(2, 20), /timeout/);
    assert.equal(transport.waiters.size, 0);
  } finally { await transport.close(); }
});

test('handshake accepts fragmented ping/OK using real Web Streams across a baud reopen', async () => {
  const writes = [];
  let reopened = false;
  const { transport, port, push } = await streamTransport(async (bytes, emit) => {
    const command = decode(bytes); writes.push(command);
    if (command === 'ping\n') { emit('pi'); await turn(); emit('ng'); }
  });
  const open = port.open.bind(port);
  port.open = async config => { await open(config); reopened = true; queueMicrotask(() => push('OK')); };
  try {
    await new BurnController(transport).handshake(1000000);
    assert.equal(reopened, true);
    assert.equal(transport.baudRate, 1000000);
    assert.deepEqual(writes, ['ping\n', 'ucfg 1000000 0 0\n']);
  } finally { await transport.close(); }
});

test('real stream NOR flow separates coalesced EOT ACK/OK and hash header/binary data', async () => {
  const data = Uint8Array.from({ length: 1025 }, (_, i) => i & 255);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const commands = [];
  const { transport } = await streamTransport((bytes, emit) => {
    const text = decode(bytes);
    if (text === 'ping\n') { commands.push(text); emit('ping'); }
    else if (text.startsWith('ucfg ')) { commands.push(text); emit('OK'); }
    else if (text.startsWith('fwd ')) { commands.push(text); emit(Uint8Array.of(67)); }
    else if (text.startsWith('hashq ')) {
      commands.push(text);
      const result = new Uint8Array(70); result.set(encode('hashs ')); result.set(digest, 6); emit(result);
    } else if (bytes.length === 4 && bytes[0] === 4) emit(Uint8Array.of(6, 79, 75));
    else if (bytes.length === 1029) emit(Uint8Array.of(6));
    else throw new Error('unexpected wire data');
  });
  try {
    const controller = new BurnController(transport);
    await controller.burn(data, options({ verify: true }));
    assert.equal(controller.state, 'completed');
    assert.deepEqual(commands, ['ping\n', 'ucfg 115200 0 0\n', 'fwd 0 0 0 \n', 'hashq 1025 0 0 \n']);
    assert.equal(transport.buffer.length, 0);
  } finally { await transport.close(); }
});

test('hardware reset uses confirmed Win32 control-line mapping with two 50ms waits', async () => {
  const transport = new SerialTransport();
  const signals = [];
  transport.port = { async setSignals(value) { signals.push({ value, at: Date.now() }); } };
  await transport.hardwareReset();
  assert.deepEqual(signals.map(e => e.value), [
    { dataTerminalReady: false, requestToSend: false },
    { dataTerminalReady: false, requestToSend: true },
    { dataTerminalReady: false, requestToSend: false }
  ]);
  assert.ok(signals[1].at - signals[0].at >= 45);
  assert.ok(signals[2].at - signals[1].at >= 45);
  transport.port.setSignals = async () => { throw new Error('signals unavailable'); };
  await assert.rejects(transport.hardwareReset(), /signals unavailable/);
});

for (const baudRate of [115200, 1000000]) for (const erase of ['none', 'chip', 'sector']) for (const length of [1024, 1025]) {
  test(`complete NOR transcript baud=${baudRate} erase=${erase} length=${length}`, async () => {
    const data = Uint8Array.from({ length }, (_, i) => i & 255);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const commands = []; const frames = [];
    const checksum = erase === 'sector';
    const verify = erase !== 'none';
    let pendingBaud = false;
    const { transport, port, push } = await streamTransport((bytes, emit) => {
      const text = decode(bytes);
      if (text === 'ping\n') { commands.push(text); emit('ping'); }
      else if (text.startsWith('ucfg ')) { commands.push(text); if (baudRate === 115200) emit('OK'); else pendingBaud = true; }
      else if (/^(ceras|seras) /.test(text)) { commands.push(text); emit('OK'); }
      else if (text.startsWith('fwd ')) { commands.push(text); emit(Uint8Array.of(checksum ? 21 : 67)); }
      else if (text.startsWith('hashq ')) {
        commands.push(text); const reply = new Uint8Array(70); reply.set(encode('hashs ')); reply.set(digest, 6); emit(reply);
      } else if (bytes.length === 4 && bytes[0] === 4) { frames.push([...bytes]); emit(Uint8Array.of(6, 79, 75)); }
      else { frames.push([...bytes]); emit(Uint8Array.of(6)); }
    });
    const open = port.open.bind(port);
    port.open = async config => { await open(config); if (pendingBaud) { pendingBaud = false; queueMicrotask(() => push('OK')); } };
    try {
      const controller = new BurnController(transport);
      await controller.burn(data, options({ baudRate, erase, verify }));
      assert.equal(controller.state, 'completed');
      const eraseCommand = erase === 'chip' ? ['ceras 0 0\n'] : erase === 'sector' ? [`seras 0 ${length === 1024 ? '400' : '401'} 0 0\n`] : [];
      assert.deepEqual(commands, ['ping\n', `ucfg ${baudRate} 0 0\n`, ...eraseCommand, 'fwd 0 0 0 \n', ...(verify ? [`hashq ${length} 0 0 \n`] : [])]);
      assert.equal(frames.length, length === 1024 ? 2 : 3);
      assert.deepEqual(frames.at(-1), [4, 0, 0, 0]);
      assert.equal(frames[0][0], 2); assert.equal(frames[0][1], 1); assert.equal(frames[0][2], 254);
      assert.equal(frames[0].length, checksum ? 1028 : 1029);
      assert.deepEqual(frames[0].slice(3, 1027), [...data.slice(0, 1024)]);
      if (length === 1025) assert.deepEqual(frames[1].slice(0, 7), [2, 2, 253, 0, 26, 0, 0]);
      assert.equal(transport.owner, 'idle'); assert.equal(transport.waiters.size, 0);
    } finally { await transport.close(); }
  });
}

for (const samePort of [true, false]) {
  test(`read failure reconnect releases old stream locks (${samePort ? 'same' : 'different'} port)`, async () => {
    const makePort = () => ({
      opened: false, closes: 0,
      async open() {
        if (this.opened) throw new Error('port already open');
        this.opened = true;
        this.readable = new ReadableStream({ start: controller => { this.input = controller; } });
        this.writable = new WritableStream();
      },
      async close() {
        if (this.readable?.locked || this.writable?.locked) throw new Error('stream is locked');
        this.opened = false; this.closes++; this.readable = null; this.writable = null;
      }
    });
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const oldPort = makePort(); const nextPort = samePort ? oldPort : makePort();
    let selection = oldPort;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort: async () => selection } } });
    const transport = new SerialTransport();
    let oldReader; let oldWriter;
    try {
      await transport.requestAndOpen();
      oldReader = transport.reader; oldWriter = transport.writer;
      const oldReadable = oldPort.readable; const oldWritable = oldPort.writable;
      oldPort.input.error(new Error('USB read failure')); await turn();
      assert.equal(transport.connected, false);
      selection = nextPort;
      await transport.requestAndOpen();
      assert.equal(oldPort.closes, 1);
      assert.equal(oldReadable.locked, false); assert.equal(oldWritable.locked, false);
      assert.equal(transport.connected, true);
      await transport.close(); assert.equal(nextPort.opened, false);
    } finally {
      await transport.close();
      try { await oldReader?.cancel(); } catch {}
      try { oldReader?.releaseLock(); } catch {}
      try { oldWriter?.releaseLock(); } catch {}
      if (oldPort.opened) await oldPort.close();
      if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator;
    }
  });
}
