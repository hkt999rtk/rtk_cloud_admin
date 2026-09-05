// Integrated from uartfwburn commit 81f808f; UI copy adapted for the Developer Console.
export const X = Object.freeze({ SOH: 0x01, STX: 0x02, EOT: 0x04, ACK: 0x06, NAK: 0x15, CAN: 0x18, CRC: 0x43 });

export function crc16(data) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
export function modeInfo(modeK, useCrc = true) {
  if (!useCrc) return { start: X.SOH, payloadSize: 128, modeK: 1 };
  const modes = { 1: [X.STX, 1024], 4: [0xa3, 4096], 8: [0xa4, 8192], 16: [0xa0, 16384], 32: [0xa1, 32768], 64: [0xa2, 65536] };
  const [start, payloadSize] = modes[modeK] || modes[1];
  return { start, payloadSize, modeK: modes[modeK] ? modeK : 1 };
}

export function makePacket(data, offset, blockNumber, modeK = 1, useCrc = true) {
  const { start, payloadSize } = modeInfo(modeK, useCrc);
  const trailer = useCrc ? 2 : 1;
  const packet = new Uint8Array(3 + payloadSize + trailer);
  packet[0] = start;
  packet[1] = blockNumber & 0xff;
  packet[2] = (~blockNumber) & 0xff;
  const count = Math.min(payloadSize, data.length - offset);
  packet.set(data.subarray(offset, offset + count), 3);
  if (count < payloadSize) packet[3 + count] = 0x1a;
  if (useCrc) {
    const crc = crc16(packet.subarray(3, 3 + payloadSize));
    packet[3 + payloadSize] = crc >> 8;
    packet[4 + payloadSize] = crc & 0xff;
  } else {
    let sum = 0;
    for (let i = 3; i < 3 + payloadSize; i++) sum = (sum + packet[i]) & 0xff;
    packet[3 + payloadSize] = sum;
  }
  return { packet, payloadSize, count };
}

async function receiveStart(transport, signal) {
  for (let tries = 0; tries < 16; tries++) {
    let byte;
    try { byte = await transport.readByte(1000, signal); } catch (error) {
      if (error.name === 'AbortError') throw error;
      continue;
    }
    if (byte === X.CRC) return true;
    if (byte === X.NAK) return false;
    if (byte === X.CAN) {
      try {
        if (await transport.readByte(1000, signal) === X.CAN) {
          await transport.write(Uint8Array.of(X.ACK));
          throw new Error('Device canceled XMODEM.');
        }
      } catch (error) { if (!String(error.message).includes('timeout')) throw error; }
    }
  }
  await cancel(transport);
  throw new Error('Timed out waiting for the XMODEM receiver.');
}

async function cancel(transport) { await transport.write(Uint8Array.of(X.CAN, X.CAN, X.CAN)); }

export async function transmit(transport, data, { modeK = 1, signal, onProgress = () => {} } = {}) {
  const useCrc = await receiveStart(transport, signal);
  let offset = 0;
  let block = 1;
  while (offset < data.length) {
    const { packet, payloadSize, count } = makePacket(data, offset, block, modeK, useCrc);
    let acknowledged = false;
    for (let tries = 0; tries < 25 && !acknowledged; tries++) {
      await transport.write(packet);
      try {
        const response = await transport.readByte(1000, signal);
        if (response === X.ACK) acknowledged = true;
        else if (response === X.CAN && await transport.readByte(1000, signal) === X.CAN) {
          await transport.write(Uint8Array.of(X.ACK));
          throw new Error('Device canceled XMODEM.');
        }
      } catch (error) { if (error.name === 'AbortError' || String(error.message).includes('Device canceled')) throw error; }
    }
    if (!acknowledged) {
      await cancel(transport);
      throw new Error(`XMODEM block ${block} failed after retries`);
    }
    offset += count;
    block = (block + 1) & 0xff;
    onProgress(Math.min(offset, data.length), data.length);
    if (payloadSize <= 0) throw new Error('Invalid XMODEM payload size.');
  }
  for (let tries = 0; tries < 10; tries++) {
    await transport.write(Uint8Array.of(X.EOT, 0, 0, 0));
    try { if (await transport.readByte(1000, signal) === X.ACK) return; } catch (error) { if (error.name === 'AbortError') throw error; }
  }
  throw new Error('XMODEM EOT was not acknowledged.');
}
