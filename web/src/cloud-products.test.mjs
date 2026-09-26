import test from 'node:test';
import assert from 'node:assert/strict';
import {productAPI,productURL,productServiceApplyAPI,fetchProductServiceApplyPreview,fetchProductServiceApplyItems,fetchCloudProducts,fetchCloudServiceCatalog,productError,productInvitationDestination} from './cloud-products.mjs';
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
test('catalog fetch preserves scoped registered options and rejects malformed data',async(t)=>{
 let body={catalog_revision:7,product_writes_enabled:true,options:[{code:'mqtt',display_name:'MQTT',selectable:true},{code:'iot_shadow',display_name:'Shadow',selectable:true,requires:['mqtt']}]};let path;
 t.mock.method(globalThis,'fetch',async(target)=>{path=target;return {ok:true,json:async()=>body};});
 const catalog=await fetchCloudServiceCatalog(a);
 assert.equal(path,`/api/developer/brand-clouds/${a}/service-options`);
 assert.deepEqual(catalog.options[0].requires,[]);
 assert.equal(catalog.options[1].code,'iot_shadow');
 body={catalog_revision:0,options:[]};
 await assert.rejects(fetchCloudServiceCatalog(a),e=>e.status===502);
});
test('disabled Product write gate keeps the previous service choices',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({catalog_revision:1,product_writes_enabled:false,options:[{code:'device_logging',display_name:'Device logging',selectable:false,unavailable_reason:'service_unavailable'}]})}));
 const catalog=await fetchCloudServiceCatalog(a);
 assert.equal(catalog.product_writes_enabled,false);
 assert.deepEqual(catalog.options.map(option=>option.code),['device_logging']);
 assert.equal(catalog.options[0].unavailable_reason,'service_unavailable');
 assert.deepEqual(catalog.legacy_options.map(option=>option.code),['mqtt','video_streaming','video_storage']);
});
test('Product apply paths and preview stay bound to Product, version and full device count',async(t)=>{
 const job='job-0123456789abcdef01234567';
 assert.equal(productServiceApplyAPI(a,p,job),productAPI(a,p)+'/service-apply-jobs/'+job);
 assert.throws(()=>productServiceApplyAPI(a,p,'../jobs'));
 let response={preview_token:'proof',target_revision:4,total_devices:301,blockers:[],added_options:['ota'],removed_options:[]};
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>response}));
 assert.equal((await fetchProductServiceApplyPreview(a,p)).total_devices,301);
 response={...response,target_revision:0};
 await assert.rejects(fetchProductServiceApplyPreview(a,p),e=>e.status===502);
 response={items:[],pagination:{limit:25,offset:250,total:301}};
 assert.equal((await fetchProductServiceApplyItems(a,p,job,{offset:250})).pagination.total,301);
});
