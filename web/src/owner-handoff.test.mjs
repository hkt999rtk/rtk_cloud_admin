import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffConfirmable, handoffCancelable, handoffComplete, handoffRoute, handoffURL, handoffAPI, snapshotKey, safeSnapshot } from './owner-handoff.mjs';
import { destinationForSession } from './auth-routing.mjs';
import { cloudWriteIntent } from './managed-clouds.mjs';
const cloud = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
function view(amount = 0) { return { id, brand_cloud_id: cloud, source_user_id: 'source', target_user_id: 'target', status: 'accepted', phase: 'awaiting_balance_confirmation', operation_phase: 'preparing', ownership_version: 1, blockers: [], has_settled_snapshot: true, source_confirmed: false, target_confirmed: false, balance_snapshot: { ownership_version: 1, billing_snapshot_version: 2, balance_minor: amount, currency: 'TWD' } }; }
test('zero and positive settled amounts are eligible, negatives and unsafe numbers never are', () => {
  for (const amount of [0, 1, 10000]) { assert.equal(handoffConfirmable(view(amount), 'source'), true); assert.equal(handoffConfirmable(view(amount), 'target'), true); }
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN]) assert.equal(handoffConfirmable(view(amount), 'source'), false);
  assert.equal(handoffConfirmable({ ...view(10), blockers: [{ code: 'usage_unsettled' }] }, 'source'), false);
  assert.equal(handoffConfirmable(view(), 'outsider'), false);
  assert.equal(handoffConfirmable({ ...view(), source_confirmed: true }, 'source'), false);
});
test('changing amount, currency or versions invalidates the exact confirmation key', () => {
  const original = view(100), key = snapshotKey(original);
  assert.notEqual(snapshotKey(view(0)), key);
  assert.notEqual(snapshotKey({ ...original, balance_snapshot: { ...original.balance_snapshot, billing_snapshot_version: 3 } }), key);
  assert.equal(safeSnapshot({ ...original.balance_snapshot, currency: 'USD' }), false);
  assert.equal(handoffConfirmable({ ...original, phase: 'blocked' }, 'source'), false);
  const first = cloudWriteIntent(null, 'POST', handoffAPI(cloud, id, 'confirm'), original.balance_snapshot, () => 'random-intent');
  assert.equal(cloudWriteIntent(first, first.method, first.path, original.balance_snapshot), first);
  assert.notEqual(cloudWriteIntent(first, first.method, first.path, view(0).balance_snapshot, () => 'new-intent').key, first.key);
});
test('accepted and finalizing are not complete, and postcommit cancellation is forbidden', () => {
  assert.equal(handoffComplete(view()), false);
  assert.equal(handoffComplete({ ...view(), phase: 'finalizing', operation_phase: 'finalizing' }), false);
  assert.equal(handoffCancelable(view(), 'source'), true);
  assert.equal(handoffCancelable(view(), 'target'), false);
  for (const phase of ['finalizing', 'succeeded', 'canceling']) assert.equal(handoffCancelable({ ...view(), operation_phase: phase }, 'source'), false);
  assert.equal(handoffComplete({ ...view(), phase: 'succeeded', operation_phase: 'succeeded', operation: { state: 'running' } }), false);
  assert.equal(handoffComplete({ ...view(), phase: 'succeeded', operation_phase: 'succeeded', operation: { state: 'succeeded' } }), true);
});
test('non-member participants can reach the operation shell, never arbitrary cloud content', () => {
  const me = { authenticated: true, kind: 'customer', memberships: [] }, next = handoffURL(cloud, id);
  assert.deepEqual(handoffRoute(next), { cloudId: cloud, transferId: id });
  assert.equal(destinationForSession(me, next), next);
  assert.equal(destinationForSession(me, `/console/clouds/${cloud}`), '/console/clouds');
  const accept = '/brand-cloud-owner-transfer/accept?token=fixture-token';
  assert.equal(destinationForSession(me, accept), accept);
  assert.throws(() => handoffAPI(cloud, id, '../commit'));
  assert.equal(handoffRoute(`/console/clouds/${cloud}/owner-transfer/invalid`), null);
});
