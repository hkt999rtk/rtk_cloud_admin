import {test,expect} from './fixtures/scoped-products.mjs';

const cloud='11111111-1111-4111-8111-111111111111';
const product='33333333-3333-4333-8333-333333333333';

test('[UI-CA-FACTORY-001] Product creates and stops a formal factory run @smoke',async({page,request},testInfo)=>{
  expect((await request.post('/__fixture__/reset')).ok()).toBeTruthy();
  await page.goto(`/console/clouds/${cloud}/products/${product}`);
  const runs=page.getByRole('region',{name:'Factory production runs'});
  await expect(runs).toContainText('https://factory-enroll.video-cloud-dev.example.test/v1/factory/enroll');
  await expect(runs).toContainText('No production runs yet.');
  await runs.getByRole('textbox',{name:'Factory ID'}).fill('line-a');
  await runs.getByRole('textbox',{name:'Batch ID'}).fill('batch-a');
  await runs.getByRole('spinbutton',{name:'Maximum devices'}).fill('25');
  await runs.getByRole('spinbutton',{name:/Authorization duration/}).fill('24');
  await runs.getByRole('button',{name:'Create production run'}).click();
  const jwt=runs.getByRole('textbox',{name:'Production-run JWT'});
  await expect(jwt).toHaveValue('fixture-secret-shown-once');
  await expect(runs.getByRole('row',{name:/batch-a/})).toContainText('25');
  await page.locator('[data-locale-selector]').selectOption('zh-TW');
  await expect(page.locator('.factory-token textarea')).toHaveValue('fixture-secret-shown-once');
  await page.locator('[data-locale-selector]').selectOption('en');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await testInfo.attach('factory-production-run',{body:await runs.screenshot(),contentType:'image/png'});
  await page.reload();
  await expect(runs).toContainText('batch-a');
  await expect(runs.getByRole('textbox',{name:'Production-run JWT'})).toHaveCount(0);
  await runs.getByRole('button',{name:'Stop signing'}).click();
  await expect(runs.getByRole('row',{name:/batch-a/})).toContainText('Disabled');
  await expect(runs.getByRole('button',{name:'Stop signing'})).toHaveCount(0);
});
