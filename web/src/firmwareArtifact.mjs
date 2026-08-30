export async function firmwareArtifactMetadata(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('A non-empty firmware binary is required.');
  }
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is not available in this browser.');

  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    file,
    name: file.name || 'firmware.bin',
    size: file.size,
    sha256,
    buildNumber: sha256,
    contentType: 'application/octet-stream',
  };
}

export function formatFirmwareSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, '')} ${unit}`;
}
