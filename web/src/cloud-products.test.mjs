import test from 'node:test';
import assert from 'node:assert/strict';
import {productAPI,productURL,fetchCloudProducts,productError,productInvitationDestination} from './cloud-products.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',p='33333333-3333-4333-8333-333333333333';
test('accepted invitations use a validated explicit cloud and Product destination',()=>{
 assert.equal(productInvitationDestination({invitation:{brand_cloud_id:b,product_id:p}}),productURL(b,p));
 assert.equal(productInvitationDestination({invitation:{brand_cloud_id:a,product_id:'../billing'}}),`/console/clouds/${a}`);
 assert.equal(productInvitationDestination({invitation:{brand_cloud_id:'../../platform',product_id:p}}),'/console/clouds');
 assert.equal(productInvitationDestination(null),'/console/clouds');
});
test('Product paths bind both identities and reject path injection',()=>{
 assert.equal(productAPI(a,p),`/api/developer/brand-clouds/${a}/products/${p}`);
 assert.equal(productURL(b,p),`/console/clouds/${b}/products/${p}`);
 for(const id of ['../admin','%2f',a+'/devices','']) assert.throws(()=>productURL(a,id));
});
test('list preserves filtered totals, offset and cancellation in its explicit cloud',async(t)=>{
 const controller=new AbortController();let call;
 t.mock.method(globalThis,'fetch',async(path,options)=>{
  call={path,options};return {ok:true,json:async()=>({products:[{id:p,brand_cloud_id:b}],pagination:{limit:25,offset:25,total:26}})};
 });
 const result=await fetchCloudProducts(b,'',{offset:25,status:'disabled',signal:controller.signal});
 assert.equal(result.pagination.total,26);assert.equal(call.path,productAPI(b)+'?limit=25&offset=25&status=disabled');
 assert.equal(call.options.signal,controller.signal);assert.equal(call.options.cache,'no-store');
});
test('cross-cloud Product and unproven totals are withheld',async(t)=>{
 let body;
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>body}));
 body={product:{id:p,brand_cloud_id:b}};
 await assert.rejects(fetchCloudProducts(a,p),e=>e.status===502);
 body={products:[]};await assert.rejects(fetchCloudProducts(a,''),e=>e.status===502);
 body={products:[],pagination:{limit:25,offset:0,total:Number.MAX_SAFE_INTEGER+1}};
 await assert.rejects(fetchCloudProducts(a,''),e=>e.status===502);
});
test('permission failures never display upstream diagnostics',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>({ok:false,status:403,json:async()=>({secret:'private'})}));
 await assert.rejects(fetchCloudProducts(a,p),e=>{assert.match(productError(e),/revoked/);assert.doesNotMatch(productError(e),/private/);return true;});
});
