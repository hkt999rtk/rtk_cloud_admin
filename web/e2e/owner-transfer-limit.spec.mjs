import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '33333333-3333-4333-8333-333333333333';

test('[UI-CA-OWNERLIMIT-001] platform admin edits one Cloud transfer limit', async ({ page }, testInfo) => {
  await login(page, 'platform_admin');
  await page.route('**/api/admin/brand-clouds/*/owner-transfer-limit', async route => {
    if (route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({ owner_transfer_limit: 0 });
      await route.fulfill({ json: { owner_transfer_limit: 0, owner_transfer_used: 0, owner_transfer_remaining: 0 } });
      return;
    }
    await route.fulfill({ json: { owner_transfer_limit: 3, owner_transfer_used: 0, owner_transfer_remaining: 3 } });
  });
  await page.goto('/admin/brand-clouds');
  await page.getByRole('button', { name: 'View' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ownership transfer limit' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Maximum transfers for this cloud' }).fill('0');
  await page.getByRole('button', { name: 'Save transfer limit' }).click();
  await expect(page.getByText('Used: 0 · Remaining: 0')).toBeVisible();
  await testInfo.attach('final-viewport', { body: await page.screenshot(), contentType: 'image/png' });
});

test('[UI-CA-OWNERLIMIT-002] Cloud owner sees exhausted transfer limit and cannot send an invitation', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.route(`**/api/developer/brand-clouds/${cloud}`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.brand_cloud.owner_transfer_limit = 0;
    body.brand_cloud.owner_transfer_used = 3;
    body.brand_cloud.owner_transfer_remaining = 0;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/console/clouds/${cloud}/settings`);
  await page.getByText('Transfer cloud ownership', { exact: true }).click();
  await expect(page.getByText('Ownership transfers remaining: 0')).toBeVisible();
  await expect(page.getByText('Ownership transfer limit reached. No transfers remain for this cloud.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send ownership invitation' })).toBeDisabled();
  await testInfo.attach('final-viewport', { body: await page.screenshot(), contentType: 'image/png' });
});
