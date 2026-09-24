import { cloudAPI, managedCloudRequest } from './managed-clouds.mjs';
import { gatherICE, inboundVideoStats, audioDirectionStats } from './test-lab-webrtc.mjs';
import { shadowTopic, parseTestPayload, labIncomingTopic } from './test-lab.mjs';

function audioNegotiationRejected(error) {
  return [400, 415, 422, 488].includes(error?.status) ||
    ['InvalidAccessError', 'InvalidModificationError', 'OperationError'].includes(error?.name);
}

export class LabRuntime {
  constructor(context, onEvent, onMessage, onStats) {
    this.context = context; this.event = onEvent; this.message = onMessage; this.stats = onStats;
    this.base = `${cloudAPI(context.brand_cloud_id)}/test-lab/sessions`;
    this.controller = new AbortController(); this.subscriptions = new Set(); this.pending = new Map();
    this.closed = false;
  }
  async session() {
    if (this.closed) throw new Error('Session closed');
    if (!this.sessionPromise) this.sessionPromise = managedCloudRequest(this.base, {
      method: 'POST', body: { product_id: this.context.product_id, device_id: this.context.device_id, account_id: this.context.account_id },
    }).then(async value => {
      this.id = value.id;
      if (this.closed) { await this.closeRemote(); throw new Error('Session closed'); }
      this.sessionExpiry = Date.parse(value.expires_at);
      this.expiryTimer = setTimeout(() => this.dispose(), Math.max(0, this.sessionExpiry - Date.now()));
      this.event('session', 'created'); return value;
    });
    return this.sessionPromise;
  }
  async request(action, body = {}) {
    await this.session();
    if (this.closed) throw new Error('Session closed');
    return managedCloudRequest(`${this.base}/${this.id}/${action}`, { method: 'POST', body, signal: this.controller.signal });
  }
  async connect() {
    if (this.closed) throw new Error('Session closed');
    const credentials = await this.request('credentials');
    const { default: mqtt } = await import('mqtt');
    if (this.closed) throw new Error('Session closed');
    this.disconnect(false);
    const client = mqtt.connect(credentials.url, {
      username: credentials.username, password: credentials.password, clientId: credentials.client_id,
      clean: true, protocolVersion: 5, reconnectPeriod: 0, resubscribe: false,
      queueQoSZero: false, connectTimeout: 10000, keepalive: 10,
    });
    this.client = client;
    client.on('error', () => this.event('mqtt', 'connection_error'));
    client.on('close', () => { if (!this.closed && this.client === client) this.event('mqtt', 'disconnected'); });
    client.on('message', (topic, bytes) => {
      if (this.closed || this.client !== client) return;
      topic = labIncomingTopic(topic, this.context.brand_cloud_id, this.context.devid);
      if (!topic) { this.event('mqtt_receive', 'unexpected_topic'); return; }
      if (bytes.length > 8192) { this.event('mqtt_receive', 'payload_limit'); return; }
      const text = bytes.toString(); this.message(topic, text); this.event('mqtt_receive', 'received');
      let value; try { value = JSON.parse(text); } catch { return; }
      for (const [key, pending] of this.pending) {
        if (topic !== `${pending.topic}/accepted` && topic !== `${pending.topic}/rejected`) continue;
        if (pending.operation !== 'delete' && value.clientToken !== key) continue;
        clearTimeout(pending.timer); this.pending.delete(key);
        topic.endsWith('/rejected') ? pending.reject(new Error('Shadow request rejected')) : pending.resolve(value);
      }
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('MQTT connection timed out')), 11000);
      const finish = error => { clearTimeout(timeout); client.off('connect', connected); client.off('error', failed); this.controller.signal.removeEventListener('abort', aborted); if (error) { client.end(true); if (this.client === client) this.client = null; reject(error); } else resolve(); };
      const connected = () => finish(); const failed = () => finish(new Error('MQTT connection failed'));
      const aborted = () => finish(new DOMException('Aborted', 'AbortError'));
      client.once('connect', connected); client.once('error', failed); this.controller.signal.addEventListener('abort', aborted, { once: true });
    });
    for (const topic of this.subscriptions) await this.subscribe(topic);
    this.event('mqtt', 'connected');
    this.renewTimer = setTimeout(() => this.connect().catch(() => { this.disconnect(); this.event('mqtt', 'authorization_expired'); }), Math.max(1000, Date.parse(credentials.expires_at) - Date.now() - 8000));
  }
  async subscribe(topic) {
    if (!this.client?.connected) throw new Error('Connect MQTT first');
    await new Promise((resolve, reject) => this.client.subscribe(topic, { qos: 1 }, (error, grants) => error || grants?.some(g => g.qos >= 128) ? reject(new Error('Subscription denied')) : resolve()));
    this.subscriptions.add(topic); this.event('mqtt_subscribe', 'accepted');
  }
  async unsubscribe(topic) {
    if (!this.client?.connected) throw new Error('Connect MQTT first');
    await new Promise((resolve, reject) => this.client.unsubscribe(topic, error => error ? reject(new Error('Unsubscribe failed')) : resolve()));
    this.subscriptions.delete(topic); this.event('mqtt_unsubscribe', 'accepted');
  }
  async publish(topic, payload) {
    if (!this.client?.connected) throw new Error('Connect MQTT first');
    const text = JSON.stringify(payload);
    parseTestPayload(text);
    await new Promise((resolve, reject) => this.client.publish(topic, text, { qos: 1, retain: false }, (error, packet) => error || (packet?.reasonCode ?? 0) >= 128 ? reject(new Error('Publish rejected')) : resolve()));
    this.event('mqtt_publish', 'broker_accepted');
  }
  async shadow(transport, name, operation, payload) {
    if (transport === 'http') return this.request('shadow', { name, operation, ...(operation === 'update' ? { payload } : {}) });
    if (this.pending.size) throw new Error('Wait for the previous Shadow response');
    const topic = shadowTopic(this.context.devid, name, operation);
    for (const suffix of ['accepted', 'rejected']) await this.subscribe(`${topic}/${suffix}`);
    const update = shadowTopic(this.context.devid, name, 'update');
    for (const suffix of ['delta', 'documents']) await this.subscribe(`${update}/${suffix}`);
    const clientToken = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(clientToken); reject(new Error('Shadow response timed out')); }, 10000);
      this.pending.set(clientToken, { topic, operation, resolve, reject, timer });
      this.publish(topic, { ...(operation === 'update' ? payload : {}), clientToken }).catch(error => { clearTimeout(timer); this.pending.delete(clientToken); reject(error); });
    });
  }
  async startVideo(video, audio) {
    if (this.stream) throw new Error('Stop the existing stream first');
    await this.session();
    // A session may already have been used for MQTT or Shadow. Renew it before
    // playback so the 10-minute media window fits inside its authorization.
    if (this.sessionExpiry - Date.now() < 10 * 60 * 1000 + 45_000) {
      const mqttConnected = Boolean(this.client?.connected);
      this.disconnect(false);
      clearTimeout(this.expiryTimer);
      await this.closeRemote().catch(() => {});
      this.id = null; this.sessionPromise = null;
      await this.session();
      if (this.sessionExpiry - Date.now() < 10 * 60 * 1000 + 45_000)
        throw new Error('Test authorization is too short for playback');
      if (mqttConnected) await this.connect();
    }
    const stream = { video, audio, micTrack: null, audioEnabled: true, deadline: null };
    this.stream = stream;
    try {
      await this.openPeer(stream, true);
    } catch (error) {
      if (!audioNegotiationRejected(error)) { await this.stopVideo(); throw error; }
      // Older device firmware can reject an offer containing an audio m-line.
      await this.closePeer();
      stream.audioEnabled = false;
      this.event('device_audio', 'unavailable');
      this.event('microphone', 'unavailable');
      try { await this.openPeer(stream, false); }
      catch { await this.stopVideo(); throw error; }
    }
  }
  async openPeer(stream, withAudio) {
    const ice = await this.request('ice');
    if (!['relay', 'all'].includes(ice.ice_policy) || !Array.isArray(ice.ice_servers)) throw new Error('Invalid ICE policy');
    const peer = new RTCPeerConnection({ iceServers: ice.ice_servers, iceTransportPolicy: ice.ice_policy });
    this.peer = peer;
    const started = performance.now(); let firstFrame = false, audioReceived = false;
    peer.addTransceiver('video', { direction: 'recvonly' });
    if (withAudio) {
      this.audioTransceiver = peer.addTransceiver('audio', { direction: 'sendrecv' });
      if (stream.micTrack?.readyState === 'live') await this.audioTransceiver.sender.replaceTrack(stream.micTrack);
    }
    peer.ontrack = e => {
      if (this.peer !== peer || this.stream !== stream) return;
      const element = e.track.kind === 'audio' ? stream.audio : stream.video;
      if (!element) return;
      element.srcObject = new MediaStream([e.track]);
      element.play().then(() => {
        if (e.track.kind === 'audio') this.event('speaker', 'playing');
      }).catch(() => this.event(e.track.kind === 'audio' ? 'speaker' : 'webrtc', 'play_button_required'));
    };
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer || this.stream !== stream) return;
      this.event('webrtc', peer.connectionState);
      if (peer.connectionState === 'connected' && !stream.deadline) {
        stream.deadline = Date.now() + 10 * 60 * 1000;
        this.streamTimer = setTimeout(() => this.stopVideo().catch(() => {}), 10 * 60 * 1000);
      }
      if (peer.connectionState === 'failed') this.reconnect().catch(() => {});
    };
    try {
      await peer.setLocalDescription(await peer.createOffer());
      await gatherICE(peer, { signal: this.controller.signal });
      const opened = await this.request('offer', { offer: { type: 'offer', sdp: peer.localDescription.sdp } });
      this.remoteStreamOpened = true;
      const answer = await this.request('answer');
      if (this.closed || this.stream !== stream) throw new Error('Session closed');
      await peer.setRemoteDescription(answer.answer);
      if (withAudio && !this.audioTransceiver.currentDirection?.includes('recv')) {
        this.event('device_audio', 'unavailable');
      }
      if (withAudio) this.event('microphone',
        this.audioTransceiver.currentDirection?.includes('send')
          ? stream.micTrack?.readyState === 'live' ? 'enabled' : 'off'
          : 'unavailable');
      if (withAudio && !this.audioTransceiver.currentDirection?.includes('send') &&
          !this.audioTransceiver.currentDirection?.includes('recv'))
        stream.audioEnabled = false;
      const poll = async () => {
        if (this.closed || this.peer !== peer) return;
        try {
          const report = await peer.getStats();
          const stats = inboundVideoStats(report, this.previousStats); this.previousStats = stats;
          const audioStats = audioDirectionStats(report);
          if (audioStats.deviceAudioPackets > 0 && !audioReceived) {
            audioReceived = true; this.event('device_audio', 'receiving');
          }
          const transport = [...report.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId);
          const pair = report.get(transport?.selectedCandidatePairId);
          const candidate = report.get(pair?.localCandidateId);
          if (stats) { this.stats({ ...stats, ...audioStats, candidateType: candidate?.candidateType || 'unknown', firstFrameMs: firstFrame || (stats.decoded ? Math.round(performance.now() - started) : null) }); if (stats.decoded && !firstFrame) { firstFrame = Math.round(performance.now() - started); this.event('webrtc', 'first_frame_decoded'); } }
        } catch { this.event('webrtc_stats', 'unavailable'); }
        if (this.peer === peer) this.statsTimer = setTimeout(poll, 1000);
      };
      poll();
      const expiry = Date.parse(opened.expires_at);
      if (!Number.isFinite(expiry)) throw new Error('Missing stream expiry');
      this.reconnectTimer = setTimeout(() => this.reconnect().catch(() => {}), Math.max(1000, expiry - Date.now() - 8000));
    } catch (error) { await this.closePeer(); throw error; }
  }
  async enableMicrophone() {
    const stream = this.stream;
    if (!stream || !stream.audioEnabled || !this.audioTransceiver?.currentDirection?.includes('send')) throw new Error('Audio is unavailable');
    if (stream.micTrack?.readyState === 'live') return;
    let media;
    try { media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
    catch (error) { this.event('microphone', 'permission_denied'); throw error; }
    const track = media.getAudioTracks()[0];
    if (!track) throw new Error('No microphone track');
    try {
      if (this.stream !== stream || !this.audioTransceiver) throw new Error('Stream ended');
      await this.audioTransceiver.sender.replaceTrack(track);
      stream.micTrack = track;
      track.onended = () => { if (stream.micTrack === track) { stream.micTrack = null; this.event('microphone', 'stopped'); } };
      this.event('microphone', 'enabled');
    } catch (error) { track.stop(); throw error; }
  }
  async disableMicrophone() {
    const track = this.stream?.micTrack;
    if (!track) return;
    this.stream.micTrack = null;
    try { await this.audioTransceiver?.sender.replaceTrack(null); }
    finally { track.stop(); this.event('microphone', 'stopped'); }
  }
  async enableSpeaker() {
    if (!this.stream?.audio?.srcObject) throw new Error('Device audio is unavailable');
    await this.stream.audio.play(); this.event('speaker', 'playing');
  }
  async reconnect() {
    const stream = this.stream;
    if (!stream || this.reconnecting || this.closed) return;
    this.reconnecting = true;
    try {
      for (let attempt = 0; attempt < 3 && this.stream === stream; attempt++) {
        try {
          this.event('webrtc', 'reconnecting');
          await this.closePeer();
          await this.openPeer(stream, stream.audioEnabled);
          this.event('webrtc', 'reconnected');
          return;
        } catch (error) {
          if (audioNegotiationRejected(error) && stream.audioEnabled && this.stream === stream) {
            await this.closePeer();
            stream.audioEnabled = false;
            if (stream.micTrack) {
              stream.micTrack.stop(); stream.micTrack = null;
              this.event('microphone', 'stopped');
            }
            this.event('device_audio', 'unavailable');
            this.event('microphone', 'unavailable');
            try {
              await this.openPeer(stream, false);
              this.event('webrtc', 'reconnected');
              return;
            } catch { /* Retry video independently. */ }
          }
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      if (this.stream === stream) { this.event('webrtc', 'reconnect_failed'); await this.stopVideo(); }
    } finally { this.reconnecting = false; }
  }
  async closePeer() {
    clearTimeout(this.statsTimer); clearTimeout(this.reconnectTimer);
    const remoteStreamOpened = this.remoteStreamOpened; this.remoteStreamOpened = false;
    this.peer?.close(); this.peer = null; this.audioTransceiver = null; this.previousStats = null;
    if (this.stream?.video) this.stream.video.srcObject = null;
    if (this.stream?.audio) this.stream.audio.srcObject = null;
    if (this.stream?.audioEnabled) this.event('device_audio', 'waiting');
    this.event('speaker', 'off');
    if (remoteStreamOpened && this.id && !this.closed) await this.request('stop').catch(() => {});
  }
  async stopVideo() {
    const stream = this.stream;
    this.stream = null;
    clearTimeout(this.streamTimer);
    if (stream?.micTrack) { stream.micTrack.stop(); this.event('microphone', 'stopped'); }
    await this.closePeer();
    if (stream?.video) stream.video.srcObject = null;
    if (stream?.audio) stream.audio.srcObject = null;
    this.event('webrtc', 'stopped');
  }
  disconnect(clear = true) {
    clearTimeout(this.renewTimer); this.client?.end(true); this.client = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('MQTT disconnected')); } this.pending.clear();
    if (clear) this.subscriptions.clear();
  }
  async closeRemote() {
    if (!this.id) return;
    await fetch(`${this.base}/${this.id}/close`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' });
  }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.controller.abort(); this.disconnect();
    clearTimeout(this.expiryTimer); clearTimeout(this.statsTimer); clearTimeout(this.streamTimer); clearTimeout(this.reconnectTimer);
    this.stream?.micTrack?.stop(); this.stream = null;
    this.peer?.close(); this.peer = null;
    if (this.audioTransceiver) this.audioTransceiver = null;
    this.closeRemote().catch(() => {}); this.event('session', 'closed');
  }
}
