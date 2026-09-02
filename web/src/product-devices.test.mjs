import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceAPI,deviceURL,fetchProductDevices,deviceError} from './product-devices.mjs';
import {managedCloudRoute} from './managed-clouds.mjs';
const c='11111111-1111-4111-8111-111111111111',p='33333333-3333-4333-8333-333333333333',d='77777777-7777-4777-8777-000000000000';
test('device URLs require all three explicit identities',()=>{
 assert.deepEqual(managedCloudRoute(deviceURL(c,p,d)),{cloudId:c,section:'products',productId:p,deviceId:d});
 for(const id of ['', '../other','%2f']){assert.throws(()=>deviceURL(c,p,id));assert.throws(()=>deviceAPI(c,id));}
 assert.equal(managedCloudRoute(`/console/clouds/${c}/products/${p}/devices/../other`),null);
});
test('device list forwards filtering and cancellation, retaining server total',async(t)=>{
 const ctl=new AbortController();let request;
 t.mock.method(globalThis,'fetch',async(path,init)=>{request={path,init};return{ok:true,json:async()=>({devices:[{id:d,brand_cloud_id:c,product_id:p}],pagination:{limit:25,offset:25,total:26}})};});
 const result=await fetchProductDevices(c,p,'',{q:'camera',offset:25,signal:ctl.signal});
 assert.equal(result.pagination.total,26);assert.equal(request.path,deviceAPI(c,p)+'?limit=25&offset=25&q=camera');assert.equal(request.init.signal,ctl.signal);assert.equal(request.init.cache,'no-store');
});
test('device responses reject wrong Product, duplicate IDs and missing totals',async(t)=>{
 let body;t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>body}));
 body={device:{id:d,brand_cloud_id:c,product_id:c}};await assert.rejects(fetchProductDevices(c,p,d),e=>e.status===502);
 const item={id:d,brand_cloud_id:c,product_id:p};body={devices:[item,item],pagination:{limit:25,offset:0,total:2}};await assert.rejects(fetchProductDevices(c,p),e=>e.status===502);
 body={devices:[]};await assert.rejects(fetchProductDevices(c,p),e=>e.status===502);
});
test('device errors omit service diagnostics',()=>{assert.match(deviceError({status:403,message:'credential'}),/revoked/);assert.doesNotMatch(deviceError({status:502,message:'secret'}),/secret/);});
