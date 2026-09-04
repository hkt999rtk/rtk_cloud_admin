import test from 'node:test';
import assert from 'node:assert/strict';
import { testLabURL, testLabContextURL, parseTestPayload, shadowTopic, validatePublishTopic, diagnosticReport, loadLabOptions, labIncomingTopic, labOperationError } from './test-lab.mjs';
import { gatherICE, inboundVideoStats } from './test-lab-webrtc.mjs';
import { managedCloudRoute } from './managed-clouds.mjs';
import { cloudConsolePath, routeFromPath, titleFor } from './routes.mjs';

const cloud = '11111111-1111-4111-8111-111111111111';
const product = '22222222-2222-4222-8222-222222222222';
const device = '33333333-3333-4333-8333-333333333333';

test('incoming MQTT topics normalize only the selected Cloud and device', () => {
  for (const topic of [`devices/${device}/up/messages`, `$vc/devices/${device}/shadow/get/accepted`, `$vc/devices/${device}/shadow/name/console-lab/update/delta`]) {
    assert.equal(labIncomingTopic(topic, cloud, device), topic);
    assert.equal(labIncomingTopic(`_bc/${cloud}/${topic}`, cloud, device), topic);
    assert.equal(labIncomingTopic(`_bc/${product}/${topic}`, cloud, device), null);
  }
  for (const topic of [`devices/${product}/up/messages`, `devices/${device}/down/commands`, `$vc/devices/${device}/shadow/update`, `$vc/devices/${device}/shadow/name/../update/accepted`]) assert.equal(labIncomingTopic(topic, cloud, device), null);
});

test('selectors load subsequent pages without navigation and deduplicate IDs', async () => {
  const offsets = [], snapshots = [];
  await loadLabOptions(async offset => {
    offsets.push(offset);
    return { devices: offset ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'a' }], pagination: { limit: 25, total: 27 } };
  }, 'devices', new AbortController().signal, items => snapshots.push(items));
  assert.deepEqual(offsets, [0, 25]);
  assert.deepEqual(snapshots.at(-1), [{ id: 'a' }, { id: 'b' }]);
});

test('selector scope changes discard late pages and stop further requests', async () => {
  const controller = new AbortController();
  let updates = 0, requests = 0;
  await loadLabOptions(async () => {
    requests++; controller.abort();
    return { products: [{ id: 'old-scope' }], pagination: { limit: 25, total: 50 } };
  }, 'products', controller.signal, () => updates++);
  assert.equal(requests, 1); assert.equal(updates, 0);
});

test('lab routes preserve explicit cloud, product and device scope', () => {
  assert.equal(cloudConsolePath(cloud, 'test-lab'), `/console/clouds/${cloud}/test-lab`);
  assert.equal(routeFromPath(testLabURL(cloud)), 'test-lab');
  assert.equal(titleFor('test-lab'), 'Cloud Test Lab');
  assert.equal(managedCloudRoute(testLabURL(cloud)).section, 'test-lab');
  assert.equal(managedCloudRoute(`${testLabURL(cloud)}/${device}`), null);
  assert.match(testLabURL(cloud, product, device), /product_id=.*&device_id=/);
  assert.match(testLabContextURL(cloud, product, device), /\/test-lab\/context\?/);
  assert.throws(() => testLabURL(cloud, '', device));
  assert.throws(() => testLabContextURL(cloud, product, '../foreign'));
});

test('local payload validation rejects oversized, scalar and malformed JSON', () => {
  assert.deepEqual(parseTestPayload('{"state":{"desired":{"power":true}}}'), { state: { desired: { power: true } } });
  for (const text of ['null', '[]', '1', '{', JSON.stringify({ data: '界'.repeat(3000) })]) assert.throws(() => parseTestPayload(text));
});

test('topics reject reserved namespaces, wildcards and shadow injection', () => {
  assert.equal(validatePublishTopic('devices/camera-1/down/commands'), 'devices/camera-1/down/commands');
  for (const topic of ['', '_bc/a/b', '$aws/things/a/shadow/get', '$vc/devices/a/shadow/get', 'a/+', 'a/#', 'a\0']) assert.throws(() => validatePublishTopic(topic));
  assert.equal(shadowTopic('camera-1', 'settings', 'get'), '$vc/devices/camera-1/shadow/name/settings/get');
  assert.throws(() => shadowTopic('camera-1', '../foreign', 'get'));
});

test('missing Shadow is an empty state without discarding device access', () => {
  assert.deepEqual(labOperationError('shadow_get', 404), {
    message: 'This Shadow does not exist yet. Use Update desired to create it.',
    outcome: 'not_found', shadowNotFound: true, releaseContext: false,
  });
  assert.equal(labOperationError('shadow_delete', 404).outcome, 'not_found');
  assert.equal(labOperationError('shadow_update', 404).releaseContext, true);
  assert.equal(labOperationError('shadow_get', 403).outcome, 'failed');
});

test('report allowlist excludes payload, SDP, credentials and raw errors', () => {
  const report = diagnosticReport({ environment: 'dev', access_token: 'secret', devid: 'private', aws_credentials: { secret: 'secret' } }, [{ time: 'now', operation: 'context', outcome: 'failed', status: 403, message: 'Bearer secret', payload: 'secret', sdp: 'secret' }]);
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(report.events[0].status, 403);
  assert.equal(diagnosticReport({}, Array.from({ length: 600 }, () => ({}))).events.length, 500);
});

test('ICE gathering waits for completion and releases event listeners', async () => {
  const peer = new EventTarget(); peer.iceGatheringState = 'gathering';
  const done = gatherICE(peer, { timeout: 100 });
  peer.iceGatheringState = 'complete'; peer.dispatchEvent(new Event('icegatheringstatechange'));
  await done;
  peer.iceGatheringState = 'gathering';
  const controller = new AbortController();
  const aborted = gatherICE(peer, { signal: controller.signal }); controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  await assert.rejects(gatherICE(peer, { timeout: 1 }), /timed out/);
});

test('video success requires decoded frames and bitrate requires two samples', () => {
  const report = new Map([['v', { type: 'inbound-rtp', kind: 'video', timestamp: 1000, bytesReceived: 100, framesDecoded: 0 }]]);
  const first = inboundVideoStats(report);
  assert.equal(first.decoded, false); assert.equal(first.bitrate, null);
  report.get('v').timestamp = 2000; report.get('v').bytesReceived = 1100; report.get('v').framesDecoded = 2;
  const second = inboundVideoStats(report, first);
  assert.equal(second.decoded, true); assert.equal(second.bitrate, 8000);
  assert.equal(inboundVideoStats(new Map()), null);
});
