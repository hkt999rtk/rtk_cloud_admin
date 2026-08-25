const bytes = (...parts) => new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)).map((_, index) => {
  let offset = index;
  for (const part of parts) { if (offset < part.length) return part[offset]; offset -= part.length; }
  return 0;
});
const length = (value) => value < 128 ? new Uint8Array([value]) : (() => { const out = []; for (; value; value >>>= 8) out.unshift(value & 255); return new Uint8Array([0x80 | out.length, ...out]); })();
const der = (tag, body) => bytes(new Uint8Array([tag]), length(body.length), body);
const oid = (value) => der(0x06, new Uint8Array(value));
const sequence = (...values) => der(0x30, bytes(...values));
const base64 = (data) => btoa(String.fromCharCode(...new Uint8Array(data)));
const pem = (type, data) => `-----BEGIN ${type}-----\n${base64(data).match(/.{1,64}/g).join('\n')}\n-----END ${type}-----\n`;

function ecdsaSignatureDER(raw) {
  const integer = (value) => { let body = new Uint8Array(value); while (body.length > 1 && body[0] === 0) body = body.slice(1); if (body[0] & 0x80) body = bytes(new Uint8Array([0]), body); return der(0x02, body); };
  return sequence(integer(raw.slice(0, raw.length / 2)), integer(raw.slice(raw.length / 2)));
}

export async function createP256CSR(commonName) {
  if (!commonName || commonName.length > 128) throw new Error('invalid certificate common name');
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const [spki, pkcs8] = await Promise.all([crypto.subtle.exportKey('spki', pair.publicKey), crypto.subtle.exportKey('pkcs8', pair.privateKey)]);
  const subject = sequence(der(0x31, sequence(oid([0x55, 0x04, 0x03]), der(0x0c, new TextEncoder().encode(commonName)))));
  const requestInfo = sequence(der(0x02, new Uint8Array([0])), subject, new Uint8Array(spki), der(0xa0, new Uint8Array()));
  const rawSignature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, requestInfo));
  const signature = rawSignature[0] === 0x30 ? rawSignature : ecdsaSignatureDER(rawSignature);
  const csr = sequence(requestInfo, sequence(oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])), der(0x03, bytes(new Uint8Array([0]), signature)));
  return { csrPEM: pem('CERTIFICATE REQUEST', csr), privateKeyPEM: pem('PRIVATE KEY', pkcs8) };
}

export function downloadExportableBundle(certificateOnlyBundle, privateKeyPEM) {
  const bundle = structuredClone(certificateOnlyBundle);
  bundle.profile = 'test_exportable';
  bundle.key.material = { type: 'embedded_pkcs8_pem', private_key_pem: privateKeyPEM };
  const fingerprint8 = bundle.certificate.fingerprint_sha256.slice(0, 8);
  const safeID = bundle.identity.id.replace(/[^A-Za-z0-9._-]/g, '_');
  const filename = `rtk-${bundle.environment}-${bundle.usage}-${safeID}-${fingerprint8}.certificate-bundle.json`;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/vnd.realtek.rtk-certificate-bundle+json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
