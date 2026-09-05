import test from 'node:test';
import assert from 'node:assert/strict';

import { BurnController, chooseChunk, fwdCommand, parseOffset } from './pro2-firmware-burner/burner.js';
import { sha256Hex } from './pro2-firmware-burner/firmware-meta.js';
import { SerialTransport } from './pro2-firmware-burner/serial.js';
import { normalizeTerminalInput, StreamingTerminalDecoder } from './pro2-firmware-burner/terminal-codec.js';
import { crc16, makePacket, X } from './pro2-firmware-burner/xmodem.js';

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
