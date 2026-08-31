import { test, expect } from '@playwright/test';
const cloudA = '11111111-1111-4111-8111-111111111111';
const cloudB = '22222222-2222-4222-8222-222222222222';

test('[UI-CA-SHARING-102] Product sharing preserves pages and rejects stale scope @smoke', async ({page, context, request, baseURL}, testInfo) => {
  test.skip(process.env.SCOPED_PRODUCT_UI_FIXTURE !== '1', 'requires opt-in local Go BFF fixture');
  expect(new URL(baseURL).hostname).toBe('127.0.0.1');
  expect((await request.post('/__fixture__/reset')).ok()).toBeTruthy();
  const productReads = [];
  page.on('request', r => { if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/developer/brand-clouds/'+cloudA+'/products') productReads.push(r.url()); });
  await page.goto('/console/clouds/' + cloudA);
  await expect(page.getByTestId('cloud-products').getByRole('navigation')).toContainText('27 authorized Products');
  expect(productReads).toHaveLength(1);
  const sharing = page.getByRole('region', {name:'Cloud sharing'});
  await sharing.getByRole('button', {name:'Share cloud', exact:true}).click();
  await sharing.getByRole('textbox', {name:'Developer email'}).fill('page-reader@example.test');
  const choices = sharing.getByTestId('sharing-products');
  await expect(choices.getByRole('navigation')).toContainText('27 Products');
  // IDs are intentionally sorted differently from names by the backend fixture.
  const first = choices.getByRole('checkbox').first();
  const firstName = await first.evaluate(node => node.parentElement.textContent);
  await first.check();
  await choices.getByRole('button', {name:'Next Product choices', exact:true}).click();
  await expect(choices.getByRole('checkbox')).toHaveCount(2);
  const last = choices.getByRole('checkbox').last();
  const lastName = await last.evaluate(node => node.parentElement.textContent);
  await last.check();
  await expect(choices).toContainText('Selected Products: 2');
  await choices.getByRole('button', {name:'Previous Product choices', exact:true}).click();
  await expect(choices.getByRole('checkbox', {name:firstName, exact:true})).toBeChecked();
  await choices.getByRole('button', {name:'Next Product choices', exact:true}).click();
  await expect(choices.getByRole('checkbox', {name:lastName, exact:true})).toBeChecked();
  await choices.getByText('Review selected Product IDs', {exact:true}).click();
  const productIdForName = name => name === 'Camera 00' ? '33333333-3333-4333-8333-333333333333' : '33333333-3333-4333-8333-' + String(Number(name.slice(-2))).padStart(12,'0');
  await choices.getByRole('button', {name:'Remove '+productIdForName(firstName), exact:true}).click();
  await expect(choices).toContainText('Selected Products: 1');
  await choices.getByRole('button', {name:'Previous Product choices', exact:true}).click();
  await expect(choices.getByRole('checkbox', {name:firstName, exact:true})).not.toBeChecked();
  await choices.getByRole('checkbox', {name:firstName, exact:true}).check();
  await choices.getByRole('button', {name:'Next Product choices', exact:true}).click();
  await expect(choices.getByRole('checkbox', {name:lastName, exact:true})).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await testInfo.attach('sharing-product-pages', {body:await choices.screenshot(),contentType:'image/png'});

  // Failed or foreign-scope pages do not silently broaden a selection or clear it.
  expect((await request.post('/__fixture__/invalid-products')).ok()).toBeTruthy();
  await choices.getByRole('button', {name:'Previous Product choices', exact:true}).click();
  await expect(choices.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(choices.getByRole('checkbox')).toHaveCount(0);
  await expect(choices).toContainText('Selected Products: 2');
  expect((await request.post('/__fixture__/reset')).ok()).toBeTruthy();
  await choices.getByRole('button', {name:'Retry Product choices', exact:true}).click();
  await expect(choices.getByRole('checkbox', {name:firstName, exact:true})).toBeChecked();

  const sent = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/developer/brand-clouds/'+cloudA+'/members/invitations'));
  await sharing.getByRole('button', {name:'Send invitation', exact:true}).click();
  const body = (await sent).postDataJSON();
  expect(body.role).toBe('viewer');
  expect(body.access_scope.kind).toBe('selected_products');
  expect(new Set(body.access_scope.product_ids).size).toBe(2);
  expect(body.access_scope.product_ids).toEqual([productIdForName(firstName), productIdForName(lastName)].sort());
  await expect(sharing).toContainText('Request completed.');
  await expect(sharing.getByRole('heading', {name:'page-reader@example.test · pending', exact:true})).toBeVisible();

  const other = await context.newPage();
  await other.goto('/console/clouds/'+cloudB);
  await expect(other.getByRole('button', {name:'Share cloud', exact:true})).toHaveCount(0);
  await expect(other.getByTestId('cloud-products')).toContainText('Shared sensor');
  await sharing.getByRole('button', {name:'Share cloud', exact:true}).click();
  await expect(choices.getByRole('checkbox')).toHaveCount(25);
  await expect(choices).toContainText('Selected Products: 0');
  expect((await request.post('/__fixture__/revoke')).ok()).toBeTruthy();
  await expect(page.getByRole('alert')).toContainText('revoked', {timeout:15000});
  await expect(choices).toHaveCount(0);
  await expect(sharing).toHaveCount(0);
  await expect(other.getByTestId('cloud-products')).toContainText('Shared sensor');
  await other.close();
});
