import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { firmwareArtifactMetadata, formatFirmwareSize } from './firmwareArtifact.mjs';

test('calculates immutable firmware binary metadata', async () => {
  const body = new TextEncoder().encode('firmware-v1');
  const file = {
    name: 'camera.bin',
    size: body.byteLength,
    type: '',
    async arrayBuffer() { return body.buffer; },
  };

  const metadata = await firmwareArtifactMetadata(file);
  const expectedSHA = createHash('sha256').update(body).digest('hex');
  assert.equal(metadata.name, 'camera.bin');
  assert.equal(metadata.size, body.byteLength);
  assert.equal(metadata.sha256, expectedSHA);
  assert.equal(metadata.buildNumber, expectedSHA);
  assert.equal(metadata.contentType, 'application/octet-stream');
});

test('rejects an empty firmware binary', async () => {
  await assert.rejects(
    firmwareArtifactMetadata({ name: 'empty.bin', size: 0, async arrayBuffer() { return new ArrayBuffer(0); } }),
    /non-empty firmware binary/,
  );
});

test('formats firmware sizes for display', () => {
  assert.equal(formatFirmwareSize(12), '12 bytes');
  assert.equal(formatFirmwareSize(1536), '1.50 KB');
  assert.equal(formatFirmwareSize(5 * 1024 * 1024), '5 MB');
});
