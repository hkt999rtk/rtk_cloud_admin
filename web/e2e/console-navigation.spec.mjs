import {test,expect} from '@playwright/test';
import {login} from './fixtures/session.mjs';
const docs='/console/developer-docs';

test('[UI-CA-CONSOLE-NAV-001] Clouds, Docs, chapters and history retain the document',async({page})=>{
  await login(page,'developer');
  await page.goto('/console/clouds');
  await expect(page.locator('.my-clouds-quota')).toBeVisible();
  const marker=await page.evaluate(()=>window.__consoleMarker=crypto.randomUUID());
  const requests=[];
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname)});
  await page.locator('.sidebar').getByRole('link',{name:'Developer Docs',exact:true}).click();
  await expect(page.locator('.docs-results article')).toHaveCount(26);
  await expect(page).toHaveTitle('Developer Docs · RTK Cloud');
  expect(requests).toEqual(['/api/developer/console/context']);
  await page.locator('.docs-results').getByRole('link',{name:'Cloud Service Overview',exact:true}).click();
  await expect(page.locator('.docs-article header h2')).toHaveText('Cloud Service Overview');
  await page.goBack();
  await expect(page.locator('.docs-results article')).toHaveCount(26);
  await page.goBack();
  await expect(page.locator('.my-clouds-quota')).toBeVisible();
  await expect(page).toHaveTitle('My Clouds · RTK Cloud');
  await page.goForward();
  await expect(page.locator('.docs-results article')).toHaveCount(26);
  await page.locator('.sidebar').getByRole('link',{name:'My Clouds',exact:true}).click();
  await expect(page.locator('.my-clouds-quota')).toBeVisible();
  expect(await page.evaluate(()=>window.__consoleMarker)).toBe(marker);
});

test('[UI-CA-CONSOLE-NAV-002] slow sidebar context does not block Clouds or overwrite Docs',async({page})=>{
  await login(page,'developer');
  const id='33333333-3333-4333-8333-333333333333';
  let release,started;
  const gate=new Promise(resolve=>release=resolve), requested=new Promise(resolve=>started=resolve);
  await page.route('**/api/developer/brand-clouds/'+id,async r=>{started();await gate;await r.continue().catch(()=>{})});
  await page.goto('/console/clouds?cloudId='+id);
  await requested;
  await expect(page.locator('.my-clouds-quota')).toBeVisible();
  await expect(page.getByText('Loading clouds…',{exact:true})).toHaveCount(0);
  await page.locator('.sidebar').getByRole('link',{name:'Developer Docs',exact:true}).click();
  await expect(page.locator('.docs-results article')).toHaveCount(26);
  release();
  expect(new URL(page.url()).searchParams.get('cloudId')).toBe(id);
  await expect(page).toHaveTitle('Developer Docs · RTK Cloud');
  await expect(page.locator('.my-clouds-quota')).toHaveCount(0);
});

test('[UI-CA-CONSOLE-NAV-003] denied context never exposes documents',async({page})=>{
  await login(page,'developer');
  let catalogs=0;
  page.on('request',r=>{if(r.url().includes('/assets/developer-docs/index'))catalogs++});
  await page.route('**/api/developer/console/context*',r=>r.fulfill({status:403}));
  await page.goto(docs);
  await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();
  await expect(page.locator('.docs-results')).toHaveCount(0);
  expect(catalogs).toBe(0);
});

test('[UI-CA-CONSOLE-NAV-004] expired context redirects with the chapter destination',async({page})=>{
  await page.goto(docs+'/overview?q=mqtt');
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(docs+'/overview?q=mqtt');
});

test('[UI-CA-CONSOLE-NAV-005] optional Cloud list outage does not block documents',async({page})=>{
  await login(page,'developer');
  const context=await (await page.request.get('/api/developer/console/context')).json();
  await page.route('**/api/developer/console/context*',r=>r.fulfill({json:{...context,cloud_list_status:'unavailable',brand_clouds:[]}}));
  await page.goto(docs);
  await expect(page.getByText('Cloud list is temporarily unavailable.',{exact:false})).toBeVisible();
  await expect(page.locator('.docs-results article')).toHaveCount(26);
});

test('[UI-CA-CONSOLE-NAV-006] modified Docs click retains the original tab',async({page,context})=>{
  await login(page,'developer');
  await page.goto('/console/clouds');
  const [popup]=await Promise.all([context.waitForEvent('page'),page.locator('.sidebar').getByRole('link',{name:'Developer Docs',exact:true}).click({modifiers:['ControlOrMeta']})]);
  await expect(popup.locator('.docs-results article')).toHaveCount(26);
  await expect(page).toHaveURL(/\/console\/clouds$/);
  await popup.close();
});

test('[UI-CA-CONSOLE-NAV-007] combined Clouds initialization preserves filters without legacy account calls',async({page})=>{
  await login(page,'developer');
  const requests=[];
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname+new URL(r.url()).search)});
  await page.goto('/console/clouds');
  await expect(page.locator('.my-clouds-quota')).toBeVisible();
  await page.getByRole('button',{name:'Shared with me',exact:true}).click();
  await expect(page.getByRole('button',{name:'Shared with me',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('Loading clouds…',{exact:true})).toHaveCount(0);
  expect(requests).toEqual([
    '/api/developer/console/clouds-context?view=all&limit=25&offset=0',
    '/api/developer/console/clouds-context?view=shared&limit=25&offset=0',
  ]);
});
