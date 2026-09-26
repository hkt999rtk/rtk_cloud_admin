import {test,expect} from './fixtures/scoped-products.mjs';

const cloud='11111111-1111-4111-8111-111111111111';
const product='33333333-3333-4333-8333-333333333333';
const jobID='job-0123456789abcdef01234567';

test('[UI-CA-PRODUCTS-102] six registered features and full Product apply preview on desktop and mobile @smoke',async({page,request,isMobile},testInfo)=>{
  expect((await request.post('/__fixture__/reset')).ok()).toBeTruthy();
  const base=`/api/developer/brand-clouds/${cloud}/products/${product}`;
  const catalog={catalog_revision:9,product_writes_enabled:true,options:[
    {code:'mqtt',display_name:'MQTT',description:'Device messaging',selectable:true,requires:[]},
    {code:'iot_shadow',display_name:'IoT Shadow',description:'Device state',selectable:false,unavailable_reason:'service_unavailable',requires:['mqtt']},
    {code:'video_streaming',display_name:'Video streaming',selectable:true,requires:['mqtt']},
    {code:'video_storage',display_name:'Video storage',selectable:true,requires:['mqtt']},
    {code:'device_logging',display_name:'Device logs',selectable:true,requires:['mqtt'],log_retention_days:[7,30,90]},
    {code:'ota',display_name:'OTA',selectable:false,unavailable_reason:'lease_expired',requires:['mqtt']},
  ]};
  await page.route(`**/api/developer/brand-clouds/${cloud}/service-options`,route=>route.fulfill({json:catalog}));
  let savedBody;
  await page.route(url=>url.pathname===base,async route=>{
    if(route.request().method()==='PATCH')savedBody=JSON.parse(route.request().postData()||'{}');
    const response=await route.fetch();
    if(route.request().method()!=='GET'||!response.ok())return route.fulfill({response});
    const data=await response.json();
    data.product.service_options=['mqtt','ota'];
    data.product.grant_revision=2;
    return route.fulfill({response,json:data});
  });
  let started=false;
  const job={id:jobID,type:'product_services_apply',state:'running',scope:{product_id:product,target_revision:3},total:2,completed:1,failed:0,allowed_actions:['pause','cancel']};
  await page.route(url=>url.pathname===base+'/service-apply-preview',route=>route.fulfill({json:{preview_token:'current-preview',target_revision:3,target_digest:'digest-3',total_devices:2,added_count:1,removed_count:0,added_options:['device_logging'],removed_options:[],blockers:[]}}));
  await page.route(url=>url.pathname.startsWith(base+'/service-apply-jobs'),route=>{
    const path=new URL(route.request().url()).pathname;
    if(path===base+'/service-apply-jobs'&&route.request().method()==='POST'){
      expect(JSON.parse(route.request().postData()||'{}').preview_token).toBe('current-preview');
      started=true;
      return route.fulfill({status:202,json:{job}});
    }
    if(path===base+'/service-apply-jobs')return route.fulfill({json:{jobs:started?[job]:[]}});
    if(path.endsWith('/items'))return route.fulfill({json:{items:[{item_key:'device-1',state:'completed'},{item_key:'device-2',state:'running'}],pagination:{limit:25,offset:0,total:2}}});
    if(path.endsWith('/'+jobID))return route.fulfill({json:{job}});
    return route.fulfill({status:404,json:{}});
  });
  await page.goto(`/console/clouds/${cloud}/products/${product}`);
  const panel=page.getByTestId('cloud-products');
  await expect(panel.getByRole('region',{name:'Registered features'})).toContainText('Registered features (6)');
  await expect(panel.getByRole('region',{name:'Registered features'})).toContainText('Service registration expired');
  await panel.getByRole('button',{name:'Edit Product',exact:true}).click();
  const form=page.getByTestId('product-form');
  await expect(form.getByRole('checkbox',{name:/^OTA/})).toBeChecked();
  await expect(form.getByRole('checkbox',{name:/^IoT Shadow/})).toBeDisabled();
  await form.getByRole('textbox',{name:'Product name',exact:true}).fill('Camera renamed');
  await form.getByRole('button',{name:'Save Product'}).click();
  expect(savedBody).toMatchObject({name:'Camera renamed'});
  expect(savedBody).not.toHaveProperty('service_options');
  await expect(panel.getByRole('heading',{name:'Apply Product services to existing devices'})).toBeVisible();
  await panel.getByRole('button',{name:'Preview all existing devices'}).click();
  await expect(panel.getByRole('group',{name:'Impact preview'})).toContainText('Target authorization version 3');
  await expect(panel.getByRole('group',{name:'Impact preview'})).toContainText('Device logs');
  await panel.getByRole('button',{name:'Apply to all existing devices'}).click();
  await expect(panel.getByRole('heading',{name:/Product apply job/})).toBeVisible();
  await expect(panel.locator('.product-service-apply-progress')).toContainText('1/2 applied');
  await expect(panel.getByRole('cell',{name:'device-2'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  if(isMobile)expect(await page.evaluate(()=>window.innerWidth)).toBeLessThan(600);
  await testInfo.attach('product-feature-apply',{body:await panel.screenshot(),contentType:'image/png'});
});
