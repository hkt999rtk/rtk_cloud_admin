import test from 'node:test';
import assert from 'node:assert/strict';
import { LabRuntime } from './test-lab-runtime.mjs';
import { audioDirectionStats } from './test-lab-webrtc.mjs';

const context = {
  brand_cloud_id: '11111111-1111-4111-8111-111111111111',
  product_id: '22222222-2222-4222-8222-222222222222',
  device_id: '33333333-3333-4333-8333-333333333333',
  account_id: '44444444-4444-4444-8444-444444444444',
};

function installBrowser({ rejectAudioOffer = false, failICE = false, firstLeaseMs = 11 * 60_000 } = {}) {
  const previous = {
    fetch: globalThis.fetch,
    RTCPeerConnection: globalThis.RTCPeerConnection,
    MediaStream: globalThis.MediaStream,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  const peers = [], actions = [];
  let offers = 0, sessions = 0, micRequests = 0, denied = false;
  class Peer {
    constructor() {
      this.transceivers = []; this.iceGatheringState = 'complete';
      this.connectionState = 'new'; peers.push(this);
    }
    addTransceiver(kind, { direction }) {
      const transceiver = {
        kind, direction, currentDirection: direction,
        sender: { track: null, async replaceTrack(track) { this.track = track; } },
      };
      this.transceivers.push(transceiver); return transceiver;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription() {
      this.connectionState = 'connected'; this.onconnectionstatechange?.();
    }
    async getStats() { return new Map(); }
    close() { this.connectionState = 'closed'; }
  }
  globalThis.RTCPeerConnection = Peer;
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { mediaDevices: { async getUserMedia() {
      micRequests++;
      if (denied) throw new DOMException('denied', 'NotAllowedError');
      const track = { kind: 'audio', readyState: 'live',
        stop() { this.readyState = 'ended'; this.onended?.(); } };
      return { getAudioTracks: () => [track] };
    } } },
  });
  globalThis.fetch = async (path, options) => {
    const action = path.split('/').at(-1);
    actions.push(action);
    if (action === 'ice' && failICE) return new Response('{}', { status: 503 });
    if (action === 'offer' && rejectAudioOffer && offers++ === 0)
      return new Response('{}', { status: 400 });
    if (action === 'stop' || action === 'close') return new Response(null, { status: 204 });
    const body = action === 'sessions' ? { id: '99999999-9999-4999-8999-999999999999',
      expires_at: new Date(Date.now() + (sessions++ === 0 ? firstLeaseMs : 11 * 60_000)).toISOString() }
      : action === 'ice' ? { ice_policy: 'all', ice_servers: [] }
      : action === 'offer' ? { session_id: 'stream',
        expires_at: new Date(Date.now() + 30_000).toISOString() }
      : action === 'answer' ? { answer: { type: 'answer', sdp: 'v=0\r\n' } }
      : {};
    return new Response(JSON.stringify(body), { status: action === 'sessions' ? 201 : 200 });
  };
  return {
    peers, actions,
    get micRequests() { return micRequests; },
    set denied(value) { denied = value; },
    restore() {
      globalThis.fetch = previous.fetch;
      globalThis.RTCPeerConnection = previous.RTCPeerConnection;
      globalThis.MediaStream = previous.MediaStream;
      if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
      else delete globalThis.navigator;
    },
  };
}

test('microphone requires explicit action and survives credential reconnect', async () => {
  const browser = installBrowser();
  const events = [];
  const runtime = new LabRuntime(context, (...event) => events.push(event), () => {}, () => {});
  try {
    await runtime.startVideo({ srcObject: null }, { srcObject: null });
    assert.equal(browser.micRequests, 0);
    assert.deepEqual(browser.peers[0].transceivers.map(row => row.direction), ['recvonly', 'sendrecv']);
    assert.ok(runtime.stream.deadline - Date.now() > 590_000);
    browser.denied = true;
    await assert.rejects(runtime.enableMicrophone(), { name: 'NotAllowedError' });
    assert.ok(runtime.peer);
    assert.ok(events.some(([kind, state]) => kind === 'microphone' && state === 'permission_denied'));
    browser.denied = false;
    await runtime.enableMicrophone();
    const track = runtime.stream.micTrack;
    assert.equal(browser.peers[0].transceivers[1].sender.track, track);
    await runtime.reconnect();
    assert.equal(browser.peers[1].transceivers[1].sender.track, track);
    assert.ok(browser.actions.filter(action => action === 'ice').length >= 2);
    await runtime.disableMicrophone();
    assert.equal(track.readyState, 'ended');
    assert.equal(runtime.peer.connectionState, 'connected');
  } finally {
    await runtime.stopVideo(); runtime.dispose(); browser.restore();
  }
});

test('rejected AV offer retries once with video only', async () => {
  const browser = installBrowser({ rejectAudioOffer: true });
  const events = [];
  const runtime = new LabRuntime(context, (...event) => events.push(event), () => {}, () => {});
  try {
    await runtime.startVideo({ srcObject: null }, { srcObject: null });
    assert.equal(browser.peers.length, 2);
    assert.deepEqual(browser.peers[1].transceivers.map(row => row.kind), ['video']);
    assert.equal(runtime.stream.audioEnabled, false);
    assert.ok(events.some(([kind, state]) => kind === 'device_audio' && state === 'unavailable'));
    assert.ok(events.some(([kind, state]) => kind === 'microphone' && state === 'unavailable'));
    assert.equal(browser.micRequests, 0);
  } finally {
    await runtime.stopVideo(); runtime.dispose(); browser.restore();
  }
});

test('service outage does not retry the offer or send a stop for an unopened stream', async () => {
  const browser = installBrowser({ failICE: true });
  const runtime = new LabRuntime(context, () => {}, () => {}, () => {});
  try {
    await assert.rejects(runtime.startVideo({ srcObject: null }, { srcObject: null }), { status: 503 });
    assert.equal(browser.actions.filter(action => action === 'ice').length, 1);
    assert.equal(browser.actions.filter(action => action === 'stop').length, 0);
    assert.equal(runtime.stream, null);
  } finally { runtime.dispose(); browser.restore(); }
});

test('playback renews an old Test Lab lease before starting its ten-minute window', async () => {
  const browser = installBrowser({ firstLeaseMs: 60_000 });
  const runtime = new LabRuntime(context, () => {}, () => {}, () => {});
  try {
    await runtime.startVideo({ srcObject: null }, { srcObject: null });
    assert.equal(browser.actions.filter(action => action === 'sessions').length, 2);
    assert.equal(browser.actions.filter(action => action === 'close').length, 1);
    assert.ok(runtime.sessionExpiry - Date.now() > 10 * 60_000);
  } finally { await runtime.stopVideo(); runtime.dispose(); browser.restore(); }
});

test('audio RTP diagnostics keep send and receive directions distinct', () => {
  const report = new Map([
    ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 12, packetsLost: 2 }],
    ['out', { type: 'outbound-rtp', kind: 'audio', packetsSent: 8 }],
  ]);
  assert.deepEqual(audioDirectionStats(report), {
    deviceAudioPackets: 12, microphonePackets: 8, audioPacketsLost: 2,
  });
});
