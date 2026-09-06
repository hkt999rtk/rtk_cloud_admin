import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-SDK-PERF-001] SDK browser timing benchmark @sdk-performance', async ({ page }, testInfo) => {
  // Normal local CI runs the controlled-latency fixture benchmark. Only the
  // explicitly enabled live mode can use dev credentials or the dev origin.
  test.setTimeout(120000);
  const live = process.env.SDK_BENCHMARK_LIVE === 'true';
  const delay = live ? 0 : Number(process.env.SDK_BENCHMARK_DELAY_MS || 200);
  if (live) {
    expect(process.env.E2E_BASE_URL).toBe('https://admin.video-cloud-dev.realtekconnect.com');
    const response = await page.request.post('/api/auth/login', {data:{email:process.env.SDK_BENCHMARK_EMAIL,password:process.env.SDK_BENCHMARK_PASSWORD,next:'/console/chipset-sdk'}});
    expect(response.status(), 'authorized dev operator sign-in').toBe(200);
  } else await login(page, 'developer');
  const me = await (await page.request.get('/api/me')).json();
  const sdkURL = `/console/chipset-sdk${me.active_org_id ? `?cloudId=${me.active_org_id}` : ''}`;
  if (!live) await page.route('**/api/**', async route => {
    await new Promise(resolve => setTimeout(resolve, delay));
    if (new URL(route.request().url()).pathname === '/api/developer/chipsets') return route.fulfill({json:{source_status:'available',chipsets:[{id:'perf-chipset',name:'Performance chipset',vendor:'Realtek',resources:[],sdk_releases:[]}]}});
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__sdkBenchmarkDocument = crypto.randomUUID();
    const complete = () => {
      if (!document.querySelector('.sdk-release-summary') || !document.querySelector('.chipset-card')) return;
      if (!window.__sdkFirstDocumentComplete) window.__sdkFirstDocumentComplete = performance.now();
      const start = Number(sessionStorage.getItem('sdk-benchmark-start'));
      if (start && !window.__sdkBenchmarkDone) window.__sdkBenchmarkDone = performance.timeOrigin + performance.now() - start;
    };
    new MutationObserver(complete).observe(document, { subtree:true, childList:true });
    document.addEventListener('click', event => {
      if (event.target.closest('a')?.textContent.trim() === 'ChipSet & SDK') {
        sessionStorage.setItem('sdk-benchmark-start', String(performance.timeOrigin + performance.now()));
        window.__sdkBenchmarkDone = null;
      }
    }, true);
  });
  await page.goto(sdkURL);
  await expect(page.locator('.sdk-release-summary')).toBeVisible();
  await expect(page.locator('.chipset-card').first()).toBeVisible();
  const samples = { refresh:[], navigation:[], navigationReloads:0, delay_ms:delay, environment:live ? 'dev / operator customer-view session / warm connection' : 'local fixture / browser-injected API latency' };
  samples.first_browser_document_ms = await page.evaluate(() => window.__sdkFirstDocumentComplete);
  for (let i=0;i<Number(process.env.SDK_BENCHMARK_COUNT || 10);i++) {
    await page.evaluate(() => sessionStorage.setItem('sdk-benchmark-start', String(performance.timeOrigin + performance.now())));
    await page.reload();
    await page.waitForFunction(() => window.__sdkBenchmarkDone > 0);
    samples.refresh.push(await page.evaluate(() => window.__sdkBenchmarkDone));
    await page.goto('/console/clouds');
    await expect(page.getByRole('link',{name:'ChipSet & SDK',exact:true})).toBeVisible();
    const documentID = await page.evaluate(() => window.__sdkBenchmarkDocument);
    await page.getByRole('link',{name:'ChipSet & SDK',exact:true}).click();
    await page.waitForFunction(() => window.__sdkBenchmarkDone > 0);
    samples.navigation.push(await page.evaluate(() => window.__sdkBenchmarkDone));
    if (documentID !== await page.evaluate(() => window.__sdkBenchmarkDocument)) samples.navigationReloads++;
  }
  const median = values => values.length ? [...values].sort((a,b)=>a-b).slice(4,6).reduce((a,b)=>a+b)/2 : null;
  samples.medians = { refresh:median(samples.refresh), navigation:median(samples.navigation) };
  console.log('SDK_BENCHMARK', JSON.stringify(samples));
  await testInfo.attach(`sdk-${process.env.SDK_BENCHMARK || 'local'}.json`,{body:JSON.stringify(samples,null,2),contentType:'application/json'});
});
