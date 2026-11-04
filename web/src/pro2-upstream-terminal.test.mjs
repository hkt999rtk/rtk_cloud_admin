import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerminalInput, StreamingTerminalDecoder } from './pro2-firmware-burner/terminal-codec.js';
import { SerialTransport } from './pro2-firmware-burner/serial.js';

test('normalizes Enter and pasted lines to selected ending', () => {
  const mixed = 'one\r\ntwo\rthree\nfour';
  assert.equal(normalizeTerminalInput('\r', 'crlf'), '\r\n');
  assert.equal(normalizeTerminalInput(mixed, 'crlf'), 'one\r\ntwo\r\nthree\r\nfour');
  assert.equal(normalizeTerminalInput(mixed, 'cr'), 'one\rtwo\rthree\rfour');
  assert.equal(normalizeTerminalInput(mixed, 'lf'), 'one\ntwo\nthree\nfour');
  assert.throws(() => normalizeTerminalInput('x', 'invalid'));
});

test('streaming decoder preserves UTF-8 split across serial chunks', () => {
  const decoder = new StreamingTerminalDecoder();
  const bytes = new TextEncoder().encode('啟動完成');
  assert.equal(decoder.decode(bytes.slice(0, 2)), '');
  assert.equal(decoder.decode(bytes.slice(2)), '啟動完成');
  assert.doesNotThrow(() => decoder.decode(Uint8Array.of(0xff)));
});

test('UART ownership routes bytes to exactly one consumer', () => {
  const transport = new SerialTransport();
  const terminalBytes = [];
  transport.subscribeTerminal(bytes => terminalBytes.push(...bytes));
  transport.acquire('terminal');
  transport.routeIncoming(Uint8Array.of(1, 2));
  assert.deepEqual(terminalBytes, [1, 2]);
  assert.deepEqual(transport.buffer, []);

  transport.acquire('protocol');
  transport.routeIncoming(Uint8Array.of(3, 4));
  assert.deepEqual(terminalBytes, [1, 2]);
  assert.deepEqual(transport.buffer, [3, 4]);

  transport.acquire('idle');
  transport.routeIncoming(Uint8Array.of(5));
  assert.deepEqual(transport.buffer, []);
});

test('UART writes are serialized and ownership checked', async () => {
  const transport = new SerialTransport();
  const order = [];
  transport.writer = { write: async bytes => { order.push(`start:${bytes[0]}`); await Promise.resolve(); order.push(`end:${bytes[0]}`); } };
  transport.acquire('terminal');
  await Promise.all([transport.write(Uint8Array.of(1), 'terminal'), transport.write(Uint8Array.of(2), 'terminal')]);
  assert.deepEqual(order, ['start:1', 'end:1', 'start:2', 'end:2']);
  await assert.rejects(() => transport.write(Uint8Array.of(3), 'protocol'), /owned by terminal/);
});

test('failed serial open clears selected port', async () => {
  const previousNavigator = globalThis.navigator;
  const failedPort = {
    closeCalled: false,
    async open() { throw new Error('open failed'); },
    async close() { this.closeCalled = true; }
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serial: { requestPort: async () => failedPort } }
  });
  const transport = new SerialTransport();
  await assert.rejects(() => transport.requestAndOpen(115200), /open failed/);
  assert.equal(failedPort.closeCalled, true);
  assert.equal(transport.port, null);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
});

test('line ending validator accepts only its own three modes', async () => {
  const { validateLineEnding } = await import('./pro2-firmware-burner/terminal-codec.js');
  for (const mode of ['crlf', 'cr', 'lf']) assert.equal(validateLineEnding(mode), mode);
  for (const mode of ['invalid', 'toString', '__proto__', '', null]) assert.throws(() => validateLineEnding(mode), /invalid line ending/);
});
