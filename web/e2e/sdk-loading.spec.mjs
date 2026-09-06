import {test,expect} from '@playwright/test';
import {login} from './fixtures/session.mjs';
const chipset = {source_status:'available',chipsets:[{id:'realtek-amebapro2',chipset_key:'realtek-amebapro2',name:'Ameba PRO2',vendor:'Realtek',resources:[],sdk_releases:[]}]};

test('[UI-CA-SDK-LOAD-001] context replaces legacy calls and sections finish independently @chipset-sdk',async({page})=>{
  await login(page,'developer');
  let releaseSDK;
  const gate = new Promise(resolve=>releaseSDK=resolve);
  const requests=[];
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(new URL(r.url()).pathname)});
  await page.route('**/api/developer/chipsets',r=>r.fulfill({json:chipset}));
  await page.route('**/api/developer/sdk-releases/latest',async r=>{await gate;await r.continue()});
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading',{name:'Ameba PRO2',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Open firmware burner',exact:true})).toBeVisible();
  await expect(page.locator('.sdk-release-summary')).toHaveCount(0);
  expect(requests.filter(p=>p==='/api/developer/chipset-sdk/context')).toHaveLength(1);
  for(const old of ['/api/me','/api/developer/brand-clouds']) expect(requests).not.toContain(old);
  releaseSDK();
  await expect(page.locator('.sdk-release-summary')).toBeVisible();
});

test('[UI-CA-SDK-LOAD-002] slow chipset does not block SDK and retry stays local @chipset-sdk',async({page})=>{
  await login(page,'developer');
  let releaseChipset;
  const gate=new Promise(resolve=>releaseChipset=resolve);
  let attempts=0,contexts=0;
  page.on('request',r=>{if(r.url().includes('/chipset-sdk/context'))contexts++});
  await page.route('**/api/developer/chipsets',async r=>{
    attempts++;
    if(attempts===1){await gate;await r.fulfill({status:503,body:'unavailable'})}else await r.fulfill({json:chipset});
  });
  await page.goto('/console/chipset-sdk');
  await expect(page.locator('.sdk-release-summary')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Ameba PRO2',exact:true})).toHaveCount(0);
  releaseChipset();
  await page.getByRole('button',{name:'Retry ChipSet catalog'}).click();
  await expect(page.getByRole('heading',{name:'Ameba PRO2',exact:true})).toBeVisible();
  expect(contexts).toBe(1);
  expect(attempts).toBe(2);
});

test('[UI-CA-SDK-LOAD-003] denied context hides tools and never fetches catalogs @chipset-sdk',async({page})=>{
  await login(page,'developer');
  let catalogs=0;
  page.on('request',r=>{if(/\/(chipsets|sdk-releases\/latest)$/.test(new URL(r.url()).pathname))catalogs++});
  await page.route('**/api/developer/chipset-sdk/context*',r=>r.fulfill({status:403}));
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Open firmware burner',exact:true})).toHaveCount(0);
  expect(catalogs).toBe(0);
});

test('[UI-CA-SDK-LOAD-004] navigation and back preserve the document and fresh routing @chipset-sdk',async({page})=>{
  await login(page,'developer');
  await page.route('**/api/developer/chipsets',r=>r.fulfill({json:chipset}));
  await page.goto('/console/clouds');
  await expect(page.getByRole('link',{name:'ChipSet & SDK',exact:true})).toBeVisible();
  const marker=await page.evaluate(()=>window.__navigationMarker=crypto.randomUUID());
  await page.getByRole('link',{name:'ChipSet & SDK',exact:true}).click();
  await expect(page.locator('.sdk-release-summary')).toBeVisible();
  expect(await page.evaluate(()=>window.__navigationMarker)).toBe(marker);
  await page.goBack();
  await expect(page).toHaveURL(/\/console\/clouds$/);
  await expect(page.getByRole('link',{name:'ChipSet & SDK',exact:true})).toBeVisible();
  await page.goForward();
  await expect(page.locator('.sdk-release-summary')).toBeVisible();
  expect(await page.evaluate(()=>window.__navigationMarker)).toBe(marker);
  await expect(page.getByRole('link',{name:'Open firmware burner',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Open firmware burner',exact:true}).click();
  await expect(page.getByTestId('pro2-firmware-burner')).toBeVisible();
  expect(await page.evaluate(()=>window.__navigationMarker)).toBeUndefined();
});

test('[UI-CA-SDK-LOAD-005] context skeleton exposes no protected tool @chipset-sdk',async({page})=>{
  await login(page,'developer');
  let release;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/developer/chipsets',r=>r.fulfill({json:chipset}));
  await page.route('**/api/developer/chipset-sdk/context*',async r=>{await gate;await r.continue()});
  await page.goto('/console/chipset-sdk');
  await expect(page.getByText('Checking developer access…')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open firmware burner',exact:true})).toHaveCount(0);
  release();
  await expect(page.getByRole('link',{name:'Open firmware burner',exact:true})).toBeVisible();
});

test('[UI-CA-SDK-LOAD-006] late context cannot overwrite a new cloud @chipset-sdk',async({page})=>{
  await login(page,'developer');
  const original=await (await page.request.get('/api/developer/chipset-sdk/context')).json();
  const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
  let release,started;
  const gate=new Promise(resolve=>release=resolve), requested=new Promise(resolve=>started=resolve);
  await page.route('**/api/developer/chipsets',r=>r.fulfill({json:chipset}));
  await page.route('**/api/developer/chipset-sdk/context*',async r=>{
    const id=new URL(r.request().url()).searchParams.get('cloudId');
    if(id===a){started();await gate}
    const cloud={id,name:id===a?'Old cloud':'New cloud',my_role:'owner',capabilities:[]};
    await r.fulfill({json:{...original,me:{...original.me,active_org_id:id,memberships:[]},brand_cloud:cloud,brand_clouds:[cloud]}}).catch(()=>{});
  });
  await page.goto('/console/chipset-sdk?cloudId='+a);
  await requested;
  await page.evaluate(id=>{history.pushState({},'','/console/chipset-sdk?cloudId='+id);dispatchEvent(new PopStateEvent('popstate'))},b);
  await expect(page.getByRole('combobox',{name:'Brand Cloud'})).toHaveValue(b);
  release();
  await expect(page.locator('.sdk-release-summary')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Brand Cloud'})).toHaveValue(b);
  await expect(page.getByRole('option',{name:'Old cloud'})).toHaveCount(0);
});

test('[UI-CA-SDK-LOAD-007] unauthorized context returns to login with destination @chipset-sdk',async({page})=>{
  await page.route('**/api/developer/chipset-sdk/context*',r=>r.fulfill({status:401}));
  await page.route('**/api/me',r=>r.fulfill({json:{authenticated:false,kind:'demo'}}));
  await page.goto('/console/chipset-sdk');
  await expect(page).toHaveURL(/\/login\?next=%2Fconsole%2Fchipset-sdk/);
  await expect(page.locator('.cloud-sdk-card')).toHaveCount(0);
});

test('[UI-CA-SDK-LOAD-008] modified click opens a new tab @chipset-sdk',async({page,context})=>{
  await login(page,'developer');
  await page.goto('/console/clouds');
  const [popup]=await Promise.all([context.waitForEvent('page'),page.getByRole('link',{name:'ChipSet & SDK',exact:true}).click({modifiers:['ControlOrMeta']})]);
  await expect(popup).toHaveURL(/\/console\/chipset-sdk/);
  await expect(page).toHaveURL(/\/console\/clouds$/);
  await popup.close();
});

test('[UI-CA-SDK-LOAD-009] catalog outage preserves validated context and hides chip-specific tools @chipset-sdk',async({page})=>{
  await login(page,'developer');
  await page.route('**/api/developer/chipsets',r=>r.fulfill({status:503}));
  await page.route('**/api/developer/sdk-releases/latest',r=>r.fulfill({status:502}));
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading',{name:'Resources are temporarily unavailable'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Cloud Client SDKs are temporarily unavailable'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Open firmware burner',exact:true})).toHaveCount(0);
});
