import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {examplesCatalog,exampleDownload,fetchExampleFirmware} from './pro2-examples.mjs';
const bytes=new TextEncoder().encode('firmware');
const sha=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const ticket={url:'https://objects.example/image',artifact:{id:'mqtt',kind:'firmware',filename:'test.bin',sha256:sha,size_bytes:bytes.length}};
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

const catalog={schema:'rtk-pro2-examples/v1',test_only:true,version:'v1',source_commit:'a'.repeat(40),terms_version:'eval-v1',terms:'Evaluation only.',dependencies:{sdk:'9.6e'},
 artifacts:[{...ticket.artifact,id:'source',kind:'source'},...['mqtt','webrtc_test_video','webrtc_camera'].flatMap(id=>[{...ticket.artifact,id},{...ticket.artifact,id:id+'-sha',kind:'checksum'}])],
 examples:['mqtt','webrtc_test_video','webrtc_camera'].map(id=>({id,title:id,description:'Evaluation example',board:'PRO2',sensor:'GC2053',image_type:'full-flash-ntz',flash_offset:0,firmware_id:id,checksum_id:id+'-sha',validation:{build:'PASS',hardware:'NOT_RUN'}}))};
test('catalog and download requests preserve version/terms and reject service failures',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async(url)=>{assert.match(String(url),/version=v1/);return Response.json(catalog)};
  assert.deepEqual(await examplesCatalog('v1'),catalog);
  for(const broken of [null,{}, {...catalog,dependencies:null},{...catalog,dependencies:{sdk:42}}, {...catalog,terms:'  '}, {...catalog,source_commit:42}, {...catalog,artifacts:[null]}, {...catalog,examples:[null,null,null]}, {...catalog,examples:catalog.examples.map(x=>({...x,validation:{build:42}}))}, {...catalog,artifacts:catalog.artifacts.slice(1)}, {...catalog,version:'v2'}, {...catalog,examples:catalog.examples.map(x=>({...x,flash_offset:4096}))}]) {
   globalThis.fetch=async()=>Response.json(broken);await assert.rejects(examplesCatalog('v1'),/unavailable/);
  }
  globalThis.fetch=async()=>new Response('not json');await assert.rejects(examplesCatalog(),/unavailable/);
  globalThis.fetch=async(url,options)=>{assert.equal(options.method,'POST');assert.equal(options.body.get('accepted'),'true');assert.equal(options.body.get('terms_version'),'eval-v1');assert.equal(options.body.get('artifact'),'mqtt');return Response.json(ticket)};
  assert.deepEqual(await exampleDownload(catalog,'mqtt'),ticket);
  for(const a of catalog.artifacts) {
   globalThis.fetch=async()=>Response.json({...ticket,artifact:a});assert.deepEqual((await exampleDownload(catalog,a.id)).artifact,a);
   for(const url of ['javascript:alert(1)','http://objects.example/file','https://user:pass@objects.example/file','invalid']) {
    globalThis.fetch=async()=>Response.json({url,artifact:a});await assert.rejects(exampleDownload(catalog,a.id),/terms/);
   }
  }
  for(const bad of [null, {...ticket,artifact:{...ticket.artifact,sha256:'b'.repeat(64)}}, {...ticket,artifact:{...ticket.artifact,size_bytes:0}}, {...ticket,artifact:{...ticket.artifact,filename:'../bad'}}]) {
   globalThis.fetch=async()=>Response.json(bad);await assert.rejects(exampleDownload(catalog,'mqtt'),/terms/);
  }
  globalThis.fetch=async()=>Response.json(ticket);await assert.rejects(exampleDownload(catalog,'missing'),/terms/);
  globalThis.fetch=async()=>new Response('',{status:503});
  await assert.rejects(examplesCatalog(),/unavailable/);await assert.rejects(exampleDownload(catalog,'mqtt'),/terms/);
 }finally{globalThis.fetch=original}
});
