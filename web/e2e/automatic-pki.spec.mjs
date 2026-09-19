import { test, expect } from './fixtures/scoped-products.mjs';

const cloudID = '11111111-1111-4111-8111-111111111111';

test('[UI-CA-PKI-001] Cloud and Product show independent automatically refreshed CA readiness @smoke', async ({ page, request, baseURL }) => {
  expect(new URL(baseURL).hostname).toBe('127.0.0.1');
  expect((await request.post('/__fixture__/reset')).ok()).toBeTruthy();
  let pkiStatus = 'pending';
  // The scoped Product fixture does not implement the combined Cloud-list BFF.
  // Supply its public response shape while exercising the real React polling.
  await page.route('**/api/developer/console/clouds-context?*', route => route.fulfill({ json: {
    me: { authenticated: true, kind: 'developer', user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    page: { brand_clouds: [{ id: cloudID, name: 'Automatic CA cloud', status: 'active', operational: true, my_role: 'owner', capabilities: ['cloud.update'], pki_status: pkiStatus }], pagination: { limit: 25, offset: 0, total: 1 }, owned_count: 1, owned_limit: 8, reserved_count: 0 },
  } }));
  await page.route('**/api/developer/brand-clouds**', async route => {
    const response = await route.fetch();
    if (route.request().method() !== 'GET' || !response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const data = await response.json();
    for (const value of [...(data.products || []), ...(data.brand_clouds || []), ...(data.brand_cloud ? [data.brand_cloud] : [])]) {
      value.pki_status = pkiStatus;
      value.pki_operation_id = '4884e93b-422c-4390-9660-f3837dce4adb';
    }
    await route.fulfill({ response, json: data });
  });
  await page.clock.install();
  await page.goto('/console/clouds');
  await expect(page.getByTestId('pki-status').first()).toHaveText('Creating certificate authority…');
  pkiStatus = 'ready';
  await page.clock.fastForward(6000);
  await expect(page.getByTestId('pki-status').first()).toHaveText('Certificate authority ready');

  pkiStatus = 'pending';
  await page.goto(`/console/clouds/${cloudID}/products`);
  const products = page.getByTestId('cloud-products');
  await expect(products.getByTestId('pki-status').first()).toHaveText('Creating certificate authority…');
  // Pending PKI does not disable ordinary Product metadata management.
  await expect(products.getByRole('button', { name: 'Edit Product', exact: true }).first()).toBeEnabled();
  pkiStatus = 'failed';
  await page.clock.fastForward(11000);
  await expect(products.getByTestId('pki-status').first()).toHaveText('Certificate authority needs attention');
  await expect(products.getByRole('button', { name: /CSR|private key|approve CA/i })).toHaveCount(0);
  pkiStatus = 'ready';
  await page.clock.fastForward(11000);
  await expect(products.getByTestId('pki-status').first()).toHaveText('Certificate authority ready');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
