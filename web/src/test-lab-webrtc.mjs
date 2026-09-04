// The app owns media; the service coordinates only non-trickle signaling.
export async function gatherICE(peer, { signal, timeout = 15000 } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (peer.iceGatheringState === 'complete') return;
  await new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', changed);
      signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const aborted = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('ICE gathering timed out')), timeout);
    peer.addEventListener('icegatheringstatechange', changed);
    signal?.addEventListener('abort', aborted, { once: true });
    changed();
  });
}

export function inboundVideoStats(report, previous) {
  const row = [...report.values()].find(item => item.type === 'inbound-rtp' && (item.kind || item.mediaType) === 'video');
  if (!row) return null;
  const elapsed = row.timestamp - (previous?.timestamp ?? row.timestamp);
  const bytes = row.bytesReceived - (previous?.bytesReceived ?? row.bytesReceived);
  return {
    timestamp: row.timestamp, bytesReceived: row.bytesReceived,
    framesDecoded: row.framesDecoded ?? 0, width: row.frameWidth ?? null,
    height: row.frameHeight ?? null, fps: row.framesPerSecond ?? null,
    packetsLost: row.packetsLost ?? null,
    bitrate: previous && elapsed > 0 && bytes >= 0 ? Math.round(bytes * 8000 / elapsed) : null,
    decoded: (row.framesDecoded ?? 0) > 0,
  };
}
