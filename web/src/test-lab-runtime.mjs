import { cloudAPI, managedCloudRequest } from './managed-clouds.mjs';
import { gatherICE, inboundVideoStats } from './test-lab-webrtc.mjs';
import { shadowTopic, parseTestPayload, labIncomingTopic } from './test-lab.mjs';

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
      this.expiryTimer = setTimeout(() => this.dispose(), Math.max(0, Date.parse(value.expires_at) - Date.now()));
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
  async startVideo(video) {
    if (this.peer) throw new Error('Stop the existing stream first');
    const ice = await this.request('ice');
    if (!['relay', 'all'].includes(ice.ice_policy) || !Array.isArray(ice.ice_servers)) throw new Error('Invalid ICE policy');
    const peer = new RTCPeerConnection({ iceServers: ice.ice_servers, iceTransportPolicy: ice.ice_policy });
    this.peer = peer;
    const started = performance.now(); let firstFrame = false;
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.ontrack = e => { video.srcObject = e.streams[0] || new MediaStream([e.track]); video.play().catch(() => this.event('webrtc', 'play_button_required')); };
    peer.onconnectionstatechange = () => this.event('webrtc', peer.connectionState);
    try {
      await peer.setLocalDescription(await peer.createOffer());
      await gatherICE(peer, { signal: this.controller.signal });
      await this.request('offer', { offer: { type: 'offer', sdp: peer.localDescription.sdp } });
      const answer = await this.request('answer');
      if (this.closed) throw new Error('Session closed');
      await peer.setRemoteDescription(answer.answer);
      const poll = async () => {
        if (this.closed || this.peer !== peer) return;
        try {
          const report = await peer.getStats();
          const stats = inboundVideoStats(report, this.previousStats); this.previousStats = stats;
          const transport = [...report.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId);
          const pair = report.get(transport?.selectedCandidatePairId);
          const candidate = report.get(pair?.localCandidateId);
          if (stats) { this.stats({ ...stats, candidateType: candidate?.candidateType || 'unknown', firstFrameMs: firstFrame || (stats.decoded ? Math.round(performance.now() - started) : null) }); if (stats.decoded && !firstFrame) { firstFrame = Math.round(performance.now() - started); this.event('webrtc', 'first_frame_decoded'); } }
        } catch { this.event('webrtc_stats', 'unavailable'); }
        if (this.peer === peer) this.statsTimer = setTimeout(poll, 1000);
      };
      poll();
      this.streamTimer = setTimeout(() => this.stopVideo().catch(() => {}), 85000);
    } catch (error) { await this.stopVideo().catch(() => {}); throw error; }
  }
  async stopVideo() {
    clearTimeout(this.statsTimer); clearTimeout(this.streamTimer);
    this.peer?.close(); this.peer = null; this.previousStats = null;
    if (this.id && !this.closed) await this.request('stop');
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
    clearTimeout(this.expiryTimer); clearTimeout(this.statsTimer); clearTimeout(this.streamTimer);
    this.peer?.close(); this.peer = null;
    this.closeRemote().catch(() => {}); this.event('session', 'closed');
  }
}
