import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { login } from './fixtures/session.mjs';
const manifest = JSON.parse(await readFile(new URL('../public/assets/chipset-packages/realtek-amebapro2.json', import.meta.url), 'utf8'));
const chipset = { ...manifest.chipsets[0], id: 'board-provider-chipset', provider_name: 'Realtek Ameba IoT', stale: false };
const boardURL = '/console/chipset-sdk/board-provider-chipset/boards/amb82-mini';
async function setup(page, records = [chipset]) {
  await page.route('**/api/developer/chipsets', route => route.fulfill({ json: { chipsets: records, source_status: 'available' } }));
  await login(page, 'developer');
}
const ready = page => expect(page.locator('.board-stage')).toHaveAttribute('data-viewer-status', 'ready', { timeout: 20000 });

test('[UI-CA-BOARDS-001] board discovery, direct navigation and SDK relationships @boards @smoke', async ({ page }) => {
  const requests = [];page.on('request', req => { if (/\.glb|board-viewer-/.test(req.url())) requests.push(req.url()); });
  await setup(page);await page.goto('/console/chipset-sdk');
  for (const term of ['AMB82', 'RTL8735B', 'AmebaPRO2']) {await page.getByRole('textbox', { name: 'Search ChipSets and SDKs' }).fill(term);await expect(page.getByRole('link', { name: 'Explore board' })).toBeVisible();}
  expect(requests).toEqual([]);
  await page.getByRole('link', { name: 'Explore board' }).click();await expect(page).toHaveURL(boardURL);await ready(page);
  await expect(page.getByRole('heading', {name:'AMB82 MINI',exact:true})).toBeVisible();
  await expect(page.getByText('Ameba Arduino Pro2 · 4.1.0', {exact:true})).toBeVisible();
  await expect(page.getByText('Ameba FreeRTOS Pro2 SDK · main', {exact:true})).toBeVisible();
  await expect(page.getByRole('link', {name:'Open PRO2 Firmware Burner'})).toHaveAttribute('href','/console/chipset-sdk/pro2/firmware-burner');
  const external=page.getByRole('link',{name:'Buy at ICShop'});await expect(external).toHaveAttribute('target','_blank');await expect(external).toHaveAttribute('rel',/noopener/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.reload();await ready(page);await page.getByRole('link', {name:'← Chip & SDK',exact:true}).click();await expect(page).toHaveURL('/console/chipset-sdk');
});

// Compare views within a run, avoiding GPU-dependent golden images.
test('[UI-CA-BOARDS-002] 3D views, pointer rotation, zoom and keyboard selection @boards @smoke', async ({page},testInfo)=>{
  await setup(page);await page.goto(boardURL);await ready(page);
  if(testInfo.project.name === 'mobile'){const top=await page.locator('.board-stage-column').boundingBox();const parts=await page.locator('.board-parts').boundingBox();expect(parts.y).toBeGreaterThanOrEqual(top.y+top.height-1);}
  await page.screenshot({path:testInfo.outputPath('board-page.png'),fullPage:true});const canvas=page.locator('.board-stage canvas');
  await page.getByRole('button',{name:'Front',exact:true}).click();const front=await canvas.screenshot();
  await page.getByRole('button',{name:'Back',exact:true}).click();expect((await canvas.screenshot()).equals(front)).toBeFalsy();
  await page.getByRole('button',{name:'Reset view',exact:true}).click();const reset=await canvas.screenshot();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();expect((await canvas.screenshot()).equals(reset)).toBeFalsy();
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  await canvas.scrollIntoViewIfNeeded();const touchRect=await canvas.boundingBox();
  if(testInfo.project.name === 'mobile') {
    const session=await page.context().newCDPSession(page);const x=touchRect.x+touchRect.width/2,y=touchRect.y+touchRect.height/2;
    const before=await canvas.screenshot();
    for(const [type,gap] of [['touchStart',25],['touchMove',45],['touchMove',65]])await session.send('Input.dispatchTouchEvent',{type,touchPoints:[{x:x-gap,y},{x:x+gap,y}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});expect((await canvas.screenshot()).equals(before)).toBeFalsy();await session.detach();
  } else {
    await page.mouse.move(touchRect.x+touchRect.width/2,touchRect.y+touchRect.height/2);const before=await canvas.screenshot();await page.mouse.wheel(0,-180);expect((await canvas.screenshot()).equals(before)).toBeFalsy();
  }

  const lens=page.getByRole('button',{name:'F37 camera & lens'});await lens.focus();await page.keyboard.press('Enter');await expect(lens).toHaveAttribute('aria-pressed','true');await expect(page.locator('.board-part-description')).toContainText('capture images');
  await page.getByRole('button',{name:'Front',exact:true}).click();await canvas.scrollIntoViewIfNeeded();
  const rect=await canvas.boundingBox();await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.65,{steps:8});await page.mouse.up();expect((await canvas.screenshot()).equals(front)).toBeFalsy();
  await page.getByRole('button',{name:'Front',exact:true}).click();await canvas.scrollIntoViewIfNeeded();
  const bounds=await canvas.boundingBox();await page.mouse.click(bounds.x+bounds.width*.40,bounds.y+bounds.height*.69);await expect(page.locator('.board-part[aria-pressed="true"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await testInfo.attach('board-explorer',{body:await page.locator('.board-explorer').screenshot(),contentType:'image/png'});
});

test('[UI-CA-BOARDS-003] missing GLB retains content and supports retry @boards @smoke', async ({page})=>{
  await setup(page);let fail=true;await page.route('**/assets/boards/amb82-mini/v1/model.glb',route=>fail?route.fulfill({status:404,body:'missing'}):route.continue());
  await page.goto(boardURL);await expect(page.locator('.board-stage')).toHaveAttribute('data-viewer-status','error');await expect(page.locator('.board-poster')).toBeVisible();await expect(page.getByRole('heading',{name:'Board specifications'})).toBeVisible();
  await page.getByRole('button',{name:'Microphone',exact:false}).click();await expect(page.locator('.board-part-description')).toContainText('audio input');await expect(page.getByRole('button',{name:'Zoom in'})).toBeDisabled();
  fail=false;await page.getByRole('button',{name:'Retry 3D preview'}).click();await ready(page);await expect(page.locator('.board-stage canvas')).toHaveCount(1);
});

test('[UI-CA-BOARDS-004] unavailable WebGL leaves an accessible board guide @boards @smoke',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args);};});
  await setup(page);await page.goto(boardURL);await expect(page.locator('.board-stage')).toHaveAttribute('data-viewer-status','error');await expect(page.locator('.board-poster')).toBeVisible();await expect(page.getByRole('link',{name:'Buy at ICShop'})).toBeVisible();
  await page.getByRole('button',{name:'Reset button',exact:false}).click();await expect(page.locator('.board-part-description')).toContainText('Restarts the board');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('[UI-CA-BOARDS-005] unpublished board is unavailable and stale snapshots keep their guide @boards @smoke',async({page})=>{
  await setup(page,[]);await page.goto(boardURL);await expect(page.getByRole('heading',{name:'Board not available',exact:true})).toBeVisible();await expect(page.locator('canvas')).toHaveCount(0);
  await page.unroute('**/api/developer/chipsets');await page.route('**/api/developer/chipsets',route=>route.fulfill({json:{chipsets:[{...chipset,stale:true}],source_status:'available'}}));await page.reload();await ready(page);await expect(page.getByText('Last saved snapshot',{exact:true})).toBeVisible();
  await page.goto('/console/chipset-sdk/another-provider/boards/amb82-mini');await expect(page.getByRole('heading',{name:'Board not available',exact:true})).toBeVisible();
});

test('[UI-CA-BOARDS-006] idle rendering stops and retries release GPU resources @boards',async({page})=>{
  await page.addInitScript(()=>{window.boardDraws=0;window.boardContextLosses=0;for(const type of [WebGLRenderingContext,WebGL2RenderingContext]){const original=type.prototype.drawElements;type.prototype.drawElements=function(...args){window.boardDraws++;return original.apply(this,args);};const ext=type.prototype.getExtension;type.prototype.getExtension=function(name){const result=ext.call(this,name);if(name==='WEBGL_lose_context'&&result){const loss=result.loseContext.bind(result);result.loseContext=()=>{window.boardContextLosses++;loss();};}return result;};}});
  await setup(page);await page.goto(boardURL);await ready(page);await page.locator('.board-stage canvas').screenshot();
  // Observe several display frames: an idle viewer must not draw each frame.
  const counts=await page.evaluate(async()=>{const before=window.boardDraws;for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);return [before,window.boardDraws];});expect(counts[1]).toBe(counts[0]);
  await page.locator('.board-stage canvas').evaluate(canvas=>canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));await expect(page.locator('.board-stage')).toHaveAttribute('data-viewer-status','error');expect(await page.evaluate(()=>window.boardContextLosses)).toBeGreaterThan(0);
  for(let i=0;i<3;i++){await page.getByRole('button',{name:'Retry 3D preview'}).click();await ready(page);await expect(page.locator('.board-stage canvas')).toHaveCount(1);if(i<2)await page.locator('.board-stage canvas').evaluate(canvas=>canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));}
});
