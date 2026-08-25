import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createP256CSR } from './certificateBundle.mjs';

test('browser PKI helper creates P-256 PKCS#8 and sends only a CSR-shaped value', async () => {
  const generated = await createP256CSR('app-brand-cloud-user:user-001');
  assert.match(generated.csrPEM, /^-----BEGIN CERTIFICATE REQUEST-----\n/);
  assert.match(generated.privateKeyPEM, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.equal(generated.csrPEM.includes('PRIVATE KEY'), false);
  assert.equal(generated.privateKeyPEM.endsWith('\n'), true);
});
