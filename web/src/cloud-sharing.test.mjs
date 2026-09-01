import test from 'node:test';
import assert from 'node:assert/strict';
import { sharingBody, sharingPath, sharingScopeLabel, sharingError } from './cloud-sharing.mjs';
import { cloudWriteIntent, managedCloudRequest } from './managed-clouds.mjs';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
test('sharing defaults require explicit nonempty Product scope; whole cloud needs consent', () => {
  const form = { email: 'other@example.test', role: 'viewer', kind: 'selected_products', productIds: [] };
  assert.throws(() => sharingBody(form), /at least one/);
  assert.deepEqual(sharingBody({ ...form, productIds: [b, a] }).access_scope, { kind: 'selected_products', product_ids: [a, b] });
  assert.throws(() => sharingBody({ ...form, kind: 'all_products' }), /Confirm/);
  assert.deepEqual(sharingBody({ ...form, kind: 'all_products', confirmAll: true }).access_scope, { kind: 'all_products' });
  assert.throws(() => sharingBody({ ...form, role: 'owner' }), /transfer/);
});
test('reordered Product scope retries same intent; narrower scope gets a new key', () => {
  const form = { email: 'other@example.test', role: 'viewer', productIds: [b, a] };
  const path = sharingPath(a, 'members/invitations');
  const first = cloudWriteIntent(null, 'POST', path, sharingBody(form), () => 'first');
  assert.equal(cloudWriteIntent(first, 'POST', path, sharingBody({ ...form, productIds: [a, b] })), first);
  assert.equal(cloudWriteIntent(first, 'POST', path, sharingBody({ ...form, productIds: [a] }), () => 'narrower').key, 'narrower');
});
test('scope labels never label admin/member read-only and routes bind target cloud', () => {
  assert.match(sharingScopeLabel({ role: 'admin' }), /not read-only/);
  assert.match(sharingScopeLabel({ role: 'viewer', access_scope: { kind: 'all_products' } }), /future/);
  assert.equal(sharingPath(a, 'members', b), `/api/developer/brand-clouds/${a}/members/${b}`);
  assert.throws(() => sharingPath(a, 'members', b, 'cancel'));
  assert.throws(() => sharingPath(a, 'members/invitations', '../bad', 'cancel'));
  assert.match(sharingError({ status: 409 }), /NOT changed/);
});
test('204 membership removal does not try decoding nonexistent JSON', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 204, json() { throw new Error('no body'); } }));
  assert.equal(await managedCloudRequest(sharingPath(a, 'members', b), { method: 'DELETE', key: 'intent' }), null);
});
