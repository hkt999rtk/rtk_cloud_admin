import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16, makePacket, transmit, X } from './pro2-firmware-burner/xmodem.js';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('./pro2-firmware-burner/upstream-tests/fixtures/original-exe-nor-contract.json', import.meta.url)));

for (const id of ['xmodem_crc', 'xmodem_nak']) {
  test(`${id} bytes match independently derived original EXE fixture`, () => {
    const entry = contract.cases.find(value => value.id === id);
    const { packet } = makePacket(Uint8Array.from(entry.input.data), 0, 1, entry.input.modeK, entry.input.useCrc);
    assert.equal(packet.length, entry.expected.packetBytes);
    assert.equal(Buffer.from(packet).toString('hex'), entry.expected.packetHex);
  });
}

class MockTransport {
  constructor(reads = []) { this.reads = [...reads]; this.writes = []; }
  async readByte() {
    if (!this.reads.length) throw new Error('UART read timeout (1000 ms)');
    return this.reads.shift();
  }
  async write(bytes) { this.writes.push(Uint8Array.from(bytes)); }
}

test('CRC-16/XMODEM known vector', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x31c3);
});

test('1K packet matches native framing and padding', () => {
  const data = Uint8Array.from({ length: 256 }, (_, index) => index);
  const { packet, payloadSize, count } = makePacket(data, 0, 1, 1, true);
  assert.equal(payloadSize, 1024);
  assert.equal(count, 256);
  assert.equal(packet.length, 1029);
  assert.deepEqual(Array.from(packet.slice(0, 3)), [X.STX, 1, 0xfe]);
  assert.equal(packet[3 + 256], 0x1a);
  assert.equal((packet[1027] << 8) | packet[1028], crc16(packet.slice(3, 1027)));
});

test('32K packet uses the native fast-frame start code', () => {
  const { packet, payloadSize } = makePacket(Uint8Array.of(1, 2, 3), 0, 1, 32);
  assert.equal(packet[0], 0xa1);
  assert.equal(payloadSize, 32 * 1024);
  assert.equal(packet.length, 3 + 32 * 1024 + 2);
});

test('transmit writes packet and four-byte EOT', async () => {
  const transport = new MockTransport([X.CRC, X.ACK, X.ACK]);
  const progress = [];
  await transmit(transport, Uint8Array.of(1, 2, 3), { modeK: 1, onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(transport.writes.length, 2);
  assert.equal(transport.writes[0].length, 1029);
  assert.deepEqual(Array.from(transport.writes[1]), [X.EOT, 0, 0, 0]);
  assert.deepEqual(progress, [[3, 3]]);
});

test('initial timeout sends triple CAN', async () => {
  const transport = new MockTransport();
  await assert.rejects(() => transmit(transport, Uint8Array.of(1)), /Timed out waiting/);
  assert.deepEqual(Array.from(transport.writes.at(-1)), [X.CAN, X.CAN, X.CAN]);
});

test('double CAN is acknowledged', async () => {
  const transport = new MockTransport([X.CAN, X.CAN]);
  await assert.rejects(() => transmit(transport, Uint8Array.of(1)), /Device canceled/);
  assert.deepEqual(Array.from(transport.writes[0]), [X.ACK]);
});

test('NAK selects checksum without changing the NOR 1K payload', async () => {
  const transport = new MockTransport([X.NAK, X.ACK, X.ACK]);
  await transmit(transport, Uint8Array.of(1, 2, 3));
  assert.equal(transport.writes[0].length, 1028);
  assert.equal(transport.writes[0][0], X.STX);
});

test('last payload is zero padded with one SUB and sequence wraps 255 to zero', async () => {
  for (const length of [1, 1024, 1025]) {
    const offset = length > 1024 ? 1024 : 0;
    const { packet, count } = makePacket(new Uint8Array(length).fill(7), offset, 1);
    if (count < 1024) {
      assert.equal(packet[3 + count], 0x1a);
      assert.ok(packet.subarray(4 + count, 1027).every(byte => byte === 0));
    }
  }
  const transport = new MockTransport([X.CRC, ...new Array(258).fill(X.ACK)]);
  await transmit(transport, new Uint8Array(256 * 1024 + 1));
  assert.deepEqual(transport.writes.slice(254, 257).map(packet => [packet[1], packet[2]]), [[255, 0], [0, 255], [1, 254]]);
});

test('retry resends identical packet and respects native 16/25/10 limits', async () => {
  const retry = new MockTransport([X.CRC, X.NAK, X.ACK, X.ACK]);
  await transmit(retry, Uint8Array.of(1));
  assert.deepEqual(retry.writes[0], retry.writes[1]);
  let startReads = 0;
  const start = new MockTransport();
  start.readByte = async () => { startReads++; throw new Error('UART read timeout'); };
  await assert.rejects(() => transmit(start, Uint8Array.of(1)), /Timed out waiting/);
  assert.equal(startReads, 16);
  const packets = new MockTransport([X.CRC, ...new Array(25).fill(X.NAK)]);
  await assert.rejects(() => transmit(packets, Uint8Array.of(1)), /block .* failed/);
  assert.equal(packets.writes.filter(packet => packet.length === 1029).length, 25);
  assert.deepEqual(Array.from(packets.writes.at(-1)), [X.CAN, X.CAN, X.CAN]);
  const eot = new MockTransport([X.CRC, X.ACK, ...new Array(10).fill(X.NAK)]);
  await assert.rejects(() => transmit(eot, Uint8Array.of(1)), /EOT/);
  assert.equal(eot.writes.filter(packet => packet.length === 4 && packet[0] === X.EOT).length, 10);
});

test('user abort during transfer sends one triple CAN and preserves AbortError', async () => {
  const controller = new AbortController(); let reads = 0;
  const transport = new MockTransport();
  transport.readByte = async () => {
    if (reads++ === 0) return X.CRC;
    controller.abort(); throw controller.signal.reason;
  };
  await assert.rejects(() => transmit(transport, Uint8Array.of(1), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(transport.writes.filter(packet => packet.length === 3 && packet[0] === X.CAN).length, 1);
});

test('an already-cancelled or disconnected sender sends nothing', async () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = new MockTransport([X.CRC, X.ACK, X.ACK]);
  await assert.rejects(() => transmit(cancelled, Uint8Array.of(1), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(cancelled.writes.length, 0);
  const disconnected = new MockTransport(); disconnected.connected = false;
  disconnected.readByte = async () => { throw new Error('UART disconnected'); };
  await assert.rejects(() => transmit(disconnected, Uint8Array.of(1)), /disconnected/);
  assert.equal(disconnected.writes.length, 0);
});

test('failed cancellation notification never hides the original AbortError', async () => {
  const controller = new AbortController();
  const original = new DOMException('original cancellation', 'AbortError');
  const transport = new MockTransport();
  transport.readByte = async () => { controller.abort(original); throw original; };
  transport.write = async () => { throw new Error('USB unplugged'); };
  await assert.rejects(() => transmit(transport, Uint8Array.of(1), { signal: controller.signal }), error => error === original);
});

test('user abort awaiting EOT ACK still notifies the active XMODEM receiver', async () => {
  const controller = new AbortController(); let reads = 0;
  const transport = new MockTransport();
  transport.readByte = async () => {
    if (reads++ === 0) return X.CRC;
    if (reads === 2) return X.ACK;
    controller.abort(); throw controller.signal.reason;
  };
  await assert.rejects(() => transmit(transport, Uint8Array.of(1), { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(Array.from(transport.writes.at(-1)), [X.CAN, X.CAN, X.CAN]);
});
