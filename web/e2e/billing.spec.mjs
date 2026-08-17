import { expect, test } from '@playwright/test';

import { login } from './fixtures/session.mjs';

test('[UI-CA-BILLING-001] billing balance, provider gate, and automatic top-up safety are visible @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');

  await expect(page.getByTestId('billing-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: '帳務與自動加值' }).first()).toBeVisible();
  await expect(page.getByText(/\$1,250/).first()).toBeVisible();
  await expect(page.getByText('VISA •••• 4242').first()).toBeVisible();
  await expect(page.getByTestId('billing-provider-gate')).toContainText('READY');
  await expect(page.getByTestId('billing-provider-gate')).toContainText('RTK Cloud 不接收卡號或 CVV');
  await expect(page.getByRole('button', { name: '新增付款方式' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '立即加值（後續開放）' })).toBeDisabled();
  await expect(page.locator('input[name="card_number"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);
  await expect(page.getByText('成功', { exact: true })).toBeVisible();
  await expect(page.getByText('待對帳', { exact: true })).toBeVisible();

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-BILLING-002] simulator hosted setup and approved automatic top-up defaults are actionable @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');

  await page.getByLabel(/我同意由付款服務保存模擬付款方式識別資訊/).check();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: '新增付款方式' }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading', { name: 'Payment simulator' })).toBeVisible();
  await expect(popup.locator('input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);

  await expect(page.getByLabel('低餘額門檻（TWD）')).toHaveValue('300');
  await expect(page.getByLabel('每次加值（TWD）')).toHaveValue('300');
  await expect(page.getByLabel('每日金額上限（TWD）')).toHaveValue('1000');
  await expect(page.getByLabel('每日扣款最高次數')).toHaveValue('2');
  await page.getByRole('button', { name: '儲存並啟用' }).click();
  await expect(page.getByRole('status')).toContainText('帳務設定已更新');

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
