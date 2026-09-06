import {test,expect} from '@playwright/test';

test('[UI-CA-CONSOLE-PERF-001] dev Clouds and Docs navigation timing',async({page},testInfo)=>{
  test.skip(!process.env.SDK_BENCHMARK_LIVE,'explicit dev benchmark only');
  test.setTimeout(180000);
  expect(process.env.E2E_BASE_URL).toBe('https://admin.video-cloud-dev.realtekconnect.com');
  const auth=await page.request.post('/api/auth/login',{data:{email:process.env.SDK_BENCHMARK_EMAIL,password:process.env.SDK_BENCHMARK_PASSWORD,next:'/console/clouds'}});
  expect(auth.status()).toBe(200);
  const me=await (await page.request.get('/api/me')).json();
  await page.addInitScript(()=>{
    window.__consoleDocument=crypto.randomUUID();
    document.addEventListener('click',event=>{
      const name=event.target.closest('a')?.textContent.trim();
      if(!['My Clouds','Developer Docs'].includes(name))return;
      sessionStorage.setItem('console-benchmark',JSON.stringify({name,start:performance.timeOrigin+performance.now()}));
      window.__consoleDone=null;
    },true);
    new MutationObserver(()=>{
      const sample=JSON.parse(sessionStorage.getItem('console-benchmark')||'null');
      if(!sample || window.__consoleDone)return;
      const ready=sample.name==='My Clouds'
        ? location.pathname==='/console/clouds' && document.querySelector('.my-clouds-quota') && !document.body.textContent.includes('Loading clouds…')
        : location.pathname==='/console/developer-docs' && document.querySelector('.docs-results article');
      if(ready)window.__consoleDone=performance.timeOrigin+performance.now()-sample.start;
    }).observe(document,{childList:true,subtree:true});
  });
  await page.goto('/console/clouds'+(me.active_org_id?'?cloudId='+me.active_org_id:''));
  await expect(page.locator('.my-clouds-quota')).toBeVisible();
  const samples={toDocs:[],toClouds:[],reloads:0,cloudScoped:Boolean(me.active_org_id)};
  const apiTimings=[];
  page.on('requestfinished',request=>{
    const path=new URL(request.url()).pathname;
    if(path.startsWith('/api/'))apiTimings.push({path,ms:request.timing().responseEnd});
  });
  for(let i=0;i<10;i++)for(const [name,key] of [['Developer Docs','toDocs'],['My Clouds','toClouds']]){
    const marker=await page.evaluate(()=>window.__consoleDocument);
    await page.locator('.sidebar').getByRole('link',{name,exact:true}).click();
    await page.waitForFunction(()=>window.__consoleDone>0);
    samples[key].push(await page.evaluate(()=>window.__consoleDone));
    if(marker!==await page.evaluate(()=>window.__consoleDocument))samples.reloads++;
  }
  const median=values=>[...values].sort((a,b)=>a-b).slice(4,6).reduce((a,b)=>a+b)/2;
  samples.medians={toDocs:median(samples.toDocs),toClouds:median(samples.toClouds)};
  samples.apiTimings=apiTimings;
  console.log('CONSOLE_BENCHMARK',JSON.stringify(samples));
  await testInfo.attach('console-'+process.env.SDK_BENCHMARK+'.json',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
});
