import { expect, test } from '@playwright/test';

import { login } from './fixtures/session.mjs';

test('[UI-CA-BILLING-001] billing overview exposes balance usage invoice and activity evidence @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');

  await expect(page.getByTestId('billing-page')).toBeVisible();
  await expect(page.getByTestId('managed-cloud-plan')).toContainText('Realtek Managed Cloud');
  await expect(page.getByTestId('managed-cloud-plan')).toContainText('使用多少、支付多少');
  await expect(page.getByTestId('managed-cloud-plan')).toContainText('Private Cloud');
  await expect(page.getByRole('heading', { name: '帳務總覽' }).first()).toBeVisible();
  await expect(page.getByText(/\$1,250/).first()).toBeVisible();
  await expect(page.getByText('VISA •••• 4242').first()).toBeVisible();
  await expect(page.getByText('本月費用明細（依服務類別）')).toBeVisible();
  await expect(page.getByText('INV-2026-000128').first()).toBeVisible();
  await expect(page.getByText('預估可用 33 天')).toBeVisible();
  await expect(page.locator('input[name="card_number"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-BILLING-002] simulator hosted setup and approved automatic top-up defaults are actionable @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');
  await page.getByRole('button', { name: '付款與自動加值' }).click();
  await expect(page).toHaveURL(/\/billing\/settings$/);

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
  await page.getByLabel(/我同意在餘額嚴格低於設定門檻時/).check();
  await page.getByRole('button', { name: '儲存並啟用' }).click();
  await expect(page.getByRole('status')).toContainText('帳務設定已更新');

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-BILLING-006] hosted NewebPay top-up posts only encrypted provider fields @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing/settings');

  await expect(page.getByRole('button', { name: '前往刷卡加值' })).toBeEnabled();
  await page.getByLabel('加值金額（TWD）').fill('500');
  const hostedRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === '/simulator-newebpay' && request.method() === 'POST');
  await page.getByRole('button', { name: '前往刷卡加值' }).click();
  const hostedRequest = await hostedRequestPromise;

  await expect(page.getByRole('heading', { name: 'NewebPay simulator' })).toBeVisible();
  await expect(page.getByText('TEST PAYMENT - no real charge is performed.')).toBeVisible();
  await expect(page.locator('input[name="card_number"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);
  const submitted = new URLSearchParams(hostedRequest.postData() || '');
  expect([...submitted.keys()].sort()).toEqual(['MerchantID', 'TradeInfo', 'TradeSha', 'Version']);
  expect([...submitted.keys()].join(' ').toLowerCase()).not.toMatch(/card|pan|cvv|cvc|expiry/);

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-BILLING-003] invoice list opens immutable settlement detail and PDF evidence @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');
  await page.getByRole('button', { name: '發票', exact: true }).click();
  await expect(page).toHaveURL(/\/billing\/invoices$/);
  await expect(page.getByTestId('billing-invoices-page')).toBeVisible();
  await page.getByRole('button', { name: 'INV-2026-000128' }).click();
  await expect(page).toHaveURL(/\/billing\/invoices\/invoice-2026-000128$/);
  await expect(page.getByTestId('billing-invoice-detail')).toContainText('本發票由預付餘額結算');
  await expect(page.getByRole('link', { name: '下載 PDF' })).toHaveAttribute('href', /\/api\/billing\/invoices\/.+\/pdf/);
  await testInfo.attach('final-viewport', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[UI-CA-BILLING-004] normalized billing activity opens customer-safe timeline @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');
  await page.getByRole('button', { name: '帳務活動' }).click();
  await expect(page).toHaveURL(/\/billing\/activity$/);
  await expect(page.getByTestId('billing-activity-page')).toBeVisible();
  await page.getByRole('button', { name: 'TOPUP-20260520' }).click();
  await expect(page).toHaveURL(/\/billing\/activity\/intent-success$/);
  await expect(page.getByTestId('billing-activity-detail')).toContainText('處理時間軸');
  await expect(page.getByTestId('billing-activity-detail')).not.toContainText('provider_transaction_reference');
  await testInfo.attach('final-viewport', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[UI-CA-BILLING-005] billing profile update preserves invoice snapshot semantics @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');
  await page.getByRole('button', { name: '帳單資料' }).click();
  await expect(page).toHaveURL(/\/billing\/profile$/);
  await expect(page.getByTestId('billing-profile-page')).toContainText('既有文件');
  await page.getByLabel('公司／法定名稱').fill('ACME Corp. Taiwan');
  await page.getByRole('button', { name: '儲存帳單資料' }).click();
  await expect(page.getByRole('status')).toContainText('既有發票快照不會被改寫');
  await testInfo.attach('final-viewport', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
