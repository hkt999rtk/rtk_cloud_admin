import { expect, test } from '@playwright/test';

import { expectNoCJKText, login } from './fixtures/session.mjs';

test('[UI-CA-BILLING-001] billing overview exposes balance usage invoice and activity evidence @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');

  await expect(page.getByTestId('billing-page')).toBeVisible();
  await expectNoCJKText(page);
  await expect(page.getByTestId('managed-cloud-plan')).toContainText('Realtek Managed Cloud');
  await expect(page.getByTestId('managed-cloud-plan')).toContainText('Pay only for what you use');
  await expect(page.getByTestId('managed-cloud-plan')).toContainText('Private Cloud');
  await expect(page.getByRole('heading', { name: 'Billing overview' }).first()).toBeVisible();
  await expect(page.getByText(/\$1,250/).first()).toBeVisible();
  await expect(page.getByText('VISA •••• 4242').first()).toBeVisible();
  await expect(page.getByText('Estimated Cost by Service Category')).toBeVisible();
  await expect(page.getByText('INV-2026-000128').first()).toBeVisible();
  await expect(page.getByText('Estimated availability 33 days')).toBeVisible();
  await expect(page.locator('input[name="card_number"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-BILLING-002] simulator hosted setup and approved automatic top-up defaults are actionable @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');
  await page.getByRole('button', { name: 'Payments and Automatic Top-Up' }).click();
  await expect(page).toHaveURL(/\/billing\/settings$/);

  await page.getByLabel(/I agree that the payment service may store simulated payment-method identifiers/) .check ();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Add payment method' }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading', { name: 'Payment simulator' })).toBeVisible();
  await expect(popup.locator('input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);

  await expect(page.getByLabel('Low Balance Threshold (TWD)')).toHaveValue('300');
  await expect(page.getByLabel('Top-up amount (TWD)', { exact: true })).toHaveValue('300');
  await expect(page.getByLabel('Maximum Daily Value (TWD)')).toHaveValue('1000');
  await expect(page.getByLabel('Maximum daily charges')).toHaveValue('2');
  await page.getByLabel(/I agree that when the balance falls strictly below the configured threshold/).check();
  await page.getByRole('button', { name: 'Save and Enable' }).click();
  await expect(page.getByRole('status')).toContainText('Accounting settings have been updated');

  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-BILLING-006] hosted NewebPay top-up posts only encrypted provider fields @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing/settings');

  await expect(page.getByRole('button', { name: 'Continue to Card Top-Up' })).toBeEnabled();
  await page.getByLabel('Manual Top-Up Amount (TWD)').fill('500');
  const hostedRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === '/simulator-newebpay' && request.method() === 'POST');
  await page.getByRole('button', { name: 'Continue to Card Top-Up' }).click();
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
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await expect(page).toHaveURL(/\/billing\/invoices$/);
  await expect(page.getByTestId('billing-invoices-page')).toBeVisible();
  await page.getByRole('button', { name: 'INV-2026-000128' }).click();
  await expect(page).toHaveURL(/\/billing\/invoices\/invoice-2026-000128$/);
  await expect(page.getByTestId('billing-invoice-detail')).toContainText('This invoice is settled from a prepaid balance');
  await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', /\/api\/billing\/invoices\/.+\/pdf/);
  await testInfo.attach('final-viewport', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[UI-CA-BILLING-004] normalized billing activity opens customer-safe timeline @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');
  await page.getByRole('button', { name: 'Billing Activity' }).click();
  await expect(page).toHaveURL(/\/billing\/activity$/);
  await expect(page.getByTestId('billing-activity-page')).toBeVisible();
  await page.getByRole('button', { name: 'TOPUP-20260520' }).click();
  await expect(page).toHaveURL(/\/billing\/activity\/intent-success$/);
  await expect(page.getByTestId('billing-activity-detail')).toContainText('Processing timeline');
  await expect(page.getByTestId('billing-activity-detail')).not.toContainText('provider_transaction_reference');
  await testInfo.attach('final-viewport', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[UI-CA-BILLING-005] billing profile update preserves invoice snapshot semantics @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/billing');
  await page.getByRole('button', { name: 'Billing Profile' }).click();
  await expect(page).toHaveURL(/\/billing\/profile$/);
  await expect(page.getByTestId('billing-profile-page')).toContainText('existing invoice snapshots');
  await page.getByLabel('Company or legal name').fill('ACME Corp. Taiwan');
  await page.getByRole('button', { name: 'Save billing information' }).click();
  await expect(page.getByRole('status')).toContainText('existing invoice snapshots will not be overwritten');
  await testInfo.attach('final-viewport', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
