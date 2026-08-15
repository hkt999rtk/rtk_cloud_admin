import { expect, test } from '@playwright/test';

import { login } from './fixtures/session.mjs';

test('[UI-CA-BILLING-001] billing balance, provider gate, and automatic top-up safety are visible @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');

  await expect(page.getByTestId('billing-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: '帳務與自動加值' }).first()).toBeVisible();
  await expect(page.getByText(/\$1,250\.00/).first()).toBeVisible();
  await expect(page.getByText('VISA •••• 4242').first()).toBeVisible();
  await expect(page.getByTestId('billing-provider-gate')).toContainText('BLOCKED');
  await expect(page.getByTestId('billing-provider-gate')).toContainText('不會把卡號/CVV 傳入 RTK Cloud');
  await expect(page.getByRole('button', { name: '新增付款方式（資格驗證中）' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '立即加值（資格驗證中）' })).toBeDisabled();
  await expect(page.locator('input[name="card_number"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);
  await expect(page.getByText('成功', { exact: true })).toBeVisible();
  await expect(page.getByText('待對帳', { exact: true })).toBeVisible();

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
