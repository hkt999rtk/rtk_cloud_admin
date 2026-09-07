import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {fetchExampleFirmware} from './pro2-examples.mjs';
const bytes=new TextEncoder().encode('firmware');
const sha=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const ticket={url:'https://objects.example/image',artifact:{kind:'firmware',filename:'test.bin',sha256:sha,size_bytes:bytes.length}};
test('remote firmware checks length/hash and supports failure and cancellation',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(bytes);let progress=0;
  const file=await fetchExampleFirmware(ticket,{onProgress:n=>progress=n});assert.equal(file.size,bytes.length);assert.equal(progress,bytes.length);
  await assert.rejects(fetchExampleFirmware({...ticket,artifact:{...ticket.artifact,sha256:'a'.repeat(64)}}),/SHA-256/);
  await assert.rejects(fetchExampleFirmware({...ticket,artifact:{...ticket.artifact,size_bytes:1}}),/size mismatch/);
  globalThis.fetch=async()=>new Response(bytes.slice(0,2));await assert.rejects(fetchExampleFirmware(ticket),/incomplete/);
  globalThis.fetch=async()=>new Response('',{status:403});await assert.rejects(fetchExampleFirmware(ticket),/expired/);
  globalThis.fetch=async()=>{throw new TypeError('Failed to fetch')};await assert.rejects(fetchExampleFirmware(ticket),/fetch/);
  globalThis.fetch=async()=>new Response(bytes);const c=new AbortController();c.abort();await assert.rejects(fetchExampleFirmware(ticket,{signal:c.signal}),{name:'AbortError'});
  await assert.rejects(fetchExampleFirmware({...ticket,url:'http://untrusted.example'}),/metadata/);
 }finally{globalThis.fetch=original}
});
