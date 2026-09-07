export const PRO2_EXAMPLES_PATH = '/console/chipset-sdk/pro2/cloud-examples';
export const API = '/api/developer/pro2-examples';
export async function examplesCatalog(version = '', signal) {
  const r = await fetch(`${API}/catalog?version=${encodeURIComponent(version)}`, {signal});
  if (!r.ok) throw new Error('PRO2 examples are unavailable. Retry later.');
  return r.json();
}
export async function exampleDownload(catalog, artifact, signal) {
  const r = await fetch(`${API}/download`, {method:'POST', signal, headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({version:catalog.version, artifact, terms_version:catalog.terms_version, accepted:'true'})});
  if (!r.ok) throw new Error('Download could not be prepared. Reload the release and accept its terms again.');
  return r.json();
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
