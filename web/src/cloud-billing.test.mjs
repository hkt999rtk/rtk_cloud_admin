import test from 'node:test';
import assert from 'node:assert/strict';
import {billingAPI,cloudBillingRoute,fetchCloudBillingData} from './cloud-billing.mjs';
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
function fetcher(cloud,options={}) {return async(path,init)=>{
  assert.ok(path.startsWith(`/api/developer/brand-clouds/${cloud}/billing/`));assert.equal(init.cache,'no-store');
  const account=path.endsWith('/account');
  return new Response(JSON.stringify(account?{account:{organization_id:options.wrongCloud?b:cloud}}:{}),{status:options.status||200,headers:{'X-Cloud-Ownership-Version':options.mixed && account?'8':'7','ETag':'"3"'}});
};}
test('Billing routes and downloads are cloud-scoped, never active-session scoped',()=>{
  assert.deepEqual(cloudBillingRoute(`/console/clouds/${a}/billing/invoices/id`),{cloudId:a});
  assert.equal(cloudBillingRoute(`/console/clouds/${a}/billing/settings/bad`),null);
  assert.equal(cloudBillingRoute('/console/billing'),null);
  assert.equal(billingAPI(a,'/api/billing/statements'),`/api/developer/brand-clouds/${a}/billing/statements`);
  assert.throws(()=>billingAPI('other','/api/billing/account'));
  assert.throws(()=>billingAPI(a,'https://other.example'));
});
test('two clouds load independently and inconsistent ownership readbacks fail closed',async()=>{
  const [one,two]=await Promise.all([fetchCloudBillingData(a,{fetcher:fetcher(a)}),fetchCloudBillingData(b,{fetcher:fetcher(b)})]);
  assert.equal(one.account.account.organization_id,a);assert.equal(two.account.account.organization_id,b);assert.equal(one.ownershipVersion,'7');
  await assert.rejects(fetchCloudBillingData(a,{fetcher:fetcher(a,{mixed:true})}),{status:409});
  await assert.rejects(fetchCloudBillingData(a,{fetcher:fetcher(a,{wrongCloud:true})}),{status:502});
  await assert.rejects(fetchCloudBillingData(a,{fetcher:fetcher(a,{status:403})}),{status:403});
});
