import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudAPI, cloudURL, cloudError, cloudWriteIntent, managedCloudRoute, cloudOperationFromSearch, managedCloudRequest } from './managed-clouds.mjs';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
test('managed routes bind valid cloud and Product identities, not a selected global cloud', () => {
  assert.deepEqual(managedCloudRoute('/console/clouds'), { cloudId: '' });
  assert.deepEqual(managedCloudRoute(`${cloudURL(a)}/products/${b}`), { cloudId: a, productId: b });
  for (const path of ['/console/clouds/../billing', '/console/clouds/%2f', `${cloudURL(a)}/products/wrong`, '/console/overview']) assert.equal(managedCloudRoute(path), null);
  assert.throws(() => cloudAPI('../admin'));
  assert.equal(cloudOperationFromSearch(`?operation=${b}`), b);
  assert.equal(cloudOperationFromSearch('?operation=../../admin'), '');
});
test('retries keep the key but changing content or cloud never replays another intent', () => {
  let counter = 0; const generate = () => `key-${++counter}`;
  const first = cloudWriteIntent(null, 'PATCH', cloudAPI(a), { name: 'Lab' }, generate);
  assert.equal(cloudWriteIntent(first, 'PATCH', cloudAPI(a), { name: 'Lab' }, generate), first);
  assert.notEqual(cloudWriteIntent(first, 'PATCH', cloudAPI(b), { name: 'Lab' }, generate).key, first.key);
  assert.notEqual(cloudWriteIntent(first, 'PATCH', cloudAPI(a), { name: 'New' }, generate).key, first.key);
});
test('requests carry explicit scope and cancellation without trusted actor headers', async (t) => {
  const controller = new AbortController(); let captured;
  t.mock.method(globalThis, 'fetch', async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({}) }; });
  await managedCloudRequest(cloudAPI(b), { method: 'DELETE', key: 'same-key', signal: controller.signal });
  assert.equal(captured.url, cloudAPI(b));
  assert.deepEqual(captured.init.headers, { 'Idempotency-Key': 'same-key' });
  assert.equal(captured.init.body, undefined);
  assert.equal(captured.init.cache, 'no-store');
  assert.equal(captured.init.signal, controller.signal);
});
test('remote diagnostics are never displayed as UI errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403, text: async () => 'secret diagnostic' }));
  await assert.rejects(managedCloudRequest(cloudAPI(a)), (error) => { assert.equal(error.status, 403); assert.doesNotMatch(cloudError(error), /secret/); return true; });
});
