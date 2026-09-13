export const PRO2_EXAMPLES_PATH = '/console/chipset-sdk/pro2/cloud-examples';
export const API = '/api/developer/pro2-examples';
const text = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = value => record(value) && Object.values(value).every(text);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const artifactValid = a => record(a) && identifier(a.id) && identifier(a.filename) &&
  ['source','firmware','checksum','documentation'].includes(a.kind) && typeof a.sha256 === 'string' && /^[a-f0-9]{64}$/.test(a.sha256) &&
  Number.isSafeInteger(a.size_bytes) && a.size_bytes > 0 && a.size_bytes <= 64*1024*1024;
function catalogValid(c) {
  if (!record(c) || c.schema !== 'rtk-pro2-examples/v1' || c.test_only !== true || !identifier(c.version) ||
      !identifier(c.terms_version) || !text(c.terms) || typeof c.source_commit !== 'string' || !/^[a-f0-9]{40}$/.test(c.source_commit) ||
      !strings(c.dependencies) || !Array.isArray(c.artifacts) || !c.artifacts.every(artifactValid) ||
      new Set(c.artifacts.map(a=>a.id)).size !== c.artifacts.length || !Array.isArray(c.examples) || c.examples.length !== 3) return false;
  const artifacts = new Map(c.artifacts.map(a=>[a.id,a]));
  return artifacts.get('source')?.kind === 'source' && new Set(c.examples.map(x=>x?.id)).size === 3 && c.examples.every(x=>
    record(x) && ['mqtt','webrtc_test_video','webrtc_camera'].includes(x.id) &&
    [x.title,x.description,x.board,x.sensor].every(text) && strings(x.validation) &&
    x.image_type === 'full-flash-ntz' && x.flash_offset === 0 &&
    artifacts.get(x.firmware_id)?.kind === 'firmware' && artifacts.get(x.checksum_id)?.kind === 'checksum');
}
export async function examplesCatalog(version = '', signal) {
  const unavailable = 'PRO2 examples are unavailable. Retry later.';
  const r = await fetch(`${API}/catalog?version=${encodeURIComponent(version)}`, {signal});
  if (!r.ok) throw new Error(unavailable);
  let c;
  try { c = await r.json(); } catch { throw new Error(unavailable); }
  if (!catalogValid(c) || (version && c.version !== version)) throw new Error(unavailable);
  return c;
}
export async function exampleDownload(catalog, artifact, signal) {
  const invalid = 'Download could not be prepared. Reload the release and accept its terms again.';
  const r = await fetch(`${API}/download`, {method:'POST', signal, headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({version:catalog.version, artifact, terms_version:catalog.terms_version, accepted:'true'})});
  if (!r.ok) throw new Error(invalid);
  // All download buttons, including source/checksum links, share this validation.
  let ticket, url;
  try { ticket = await r.json(); url = new URL(ticket.url); } catch { throw new Error(invalid); }
  const expected = catalog.artifacts.find(a=>a.id === artifact);
  if (url.protocol !== 'https:' || url.username || url.password || !artifactValid(ticket.artifact) || !expected ||
      ['id','kind','filename','size_bytes','sha256'].some(key=>ticket.artifact[key] !== expected[key])) throw new Error(invalid);
  return ticket;
}
// The URL comes only from the authenticated catalog download API, never location.search.
export async function fetchExampleFirmware(ticket, {signal, onProgress = () => {}} = {}) {
  const a = ticket.artifact;
  const url = new URL(ticket.url);
  if (url.protocol !== 'https:' || a.kind !== 'firmware' || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.size_bytes) || a.size_bytes <= 0 || a.size_bytes > 64*1024*1024) throw new Error('Invalid firmware download metadata.');
  const r = await fetch(url, {signal, credentials:'omit', referrerPolicy:'no-referrer'});
  if (!r.ok) throw new Error('Download failed or URL expired. Retry to obtain a new URL.');
  const reader = r.body.getReader();
  let size=0; const chunks=[];
  try {
    for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length;
      if(size>a.size_bytes) throw new Error('Firmware size mismatch.');
      chunks.push(value);onProgress(size,a.size_bytes);
    }
  } catch(error) { await reader.cancel(); throw error; }
  if(size!==a.size_bytes) throw new Error('Firmware download is incomplete.');
  const file = new File(chunks,a.filename,{type:'application/octet-stream'});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==a.sha256) throw new Error('Firmware SHA-256 mismatch. Burning is disabled.');
  signal?.throwIfAborted();
  return file;
}
