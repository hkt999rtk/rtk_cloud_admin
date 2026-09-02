import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudAPI, cloudURL, cloudError, cloudWriteIntent, isCloudID, managedCloudRoute, cloudOperationFromSearch, managedCloudRequest } from './managed-clouds.mjs';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
test('managed routes bind valid cloud and Product identities, not a selected global cloud', () => {
  assert.equal(isCloudID(a), true);
  assert.equal(isCloudID('brand-e2e-created-3'), false);
  assert.deepEqual(managedCloudRoute('/console/clouds'), { cloudId: '' });
  assert.deepEqual(managedCloudRoute(`${cloudURL(a)}/products/${b}`), { cloudId: a, section: 'products', productId: b });
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
  const controller = new AbortController(); const captured = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    captured.push({ url, init });
    return captured.length === 1 ? { ok: true, status: 204 } : { ok: true, status: 200, json: async () => ({ saved: true }) };
  });
  assert.equal(await managedCloudRequest(cloudAPI(b), { method: 'DELETE', key: 'same-key', signal: controller.signal }), null);
  assert.equal(captured[0].url, cloudAPI(b));
  assert.deepEqual(captured[0].init.headers, { 'Idempotency-Key': 'same-key' });
  assert.equal(captured[0].init.body, undefined);
  assert.equal(captured[0].init.cache, 'no-store');
  assert.equal(captured[0].init.signal, controller.signal);
  assert.deepEqual(await managedCloudRequest(cloudAPI(a), { method: 'POST', body: { name: 'Lab' } }), { saved: true });
  assert.deepEqual(captured[1].init.headers, { 'Content-Type': 'application/json' });
  assert.equal(captured[1].init.body, JSON.stringify({ name: 'Lab' }));
});
test('remote diagnostics are never displayed as UI errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403, text: async () => 'secret diagnostic' }));
  await assert.rejects(managedCloudRequest(cloudAPI(a)), (error) => { assert.equal(error.status, 403); assert.doesNotMatch(cloudError(error), /secret/); return true; });
  assert.equal(cloudError({ status: 401 }), 'Your session expired. Sign in again.');
  assert.equal(cloudError({ status: 404 }), 'Cloud access is unavailable or has been revoked.');
  assert.match(cloudError({ status: 409 }), /Refresh/);
  assert.equal(cloudError({ status: 400 }), 'Check the cloud name and description.');
  assert.equal(cloudError({ status: 422 }), 'Check the cloud name and description.');
  assert.equal(cloudError(new Error('secret diagnostic')), 'Cloud management is temporarily unavailable. You can retry this request.');
});
