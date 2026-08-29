import { expect, test } from '@playwright/test';

import { loginWithStagingSession } from './fixtures/session.mjs';

const organizationID = process.env.E2E_BILLING_ORG_ID;
const otherOrganizationID = process.env.E2E_BILLING_OTHER_ORG_ID;
const invoiceID = process.env.E2E_BILLING_INVOICE_ID;

test.beforeEach(async ({ page }) => {
  expect(organizationID, 'E2E_BILLING_ORG_ID is required').toBeTruthy();
  await loginWithStagingSession(page, 'customer');
});

test('[UI-CA-BILLING-STG-001] real staging overview is tenant scoped and provider safe @staging @billing', async ({ page }, testInfo) => {
  const accountResponse = await page.request.get(`/api/billing/account?organization_id=${encodeURIComponent(otherOrganizationID || 'unowned-organization')}`);
  expect(accountResponse.ok()).toBeTruthy();
  const account = await accountResponse.json();
  expect(account.account?.organization_id).toBe(organizationID);
  expect(JSON.stringify(account)).not.toMatch(/provider_(?:customer|method|transaction)_reference|authorization|bearer|card_number|cvv/i);

  await page.goto(`/console/${encodeURIComponent(organizationID)}/billing`);
  await expect(page.getByTestId('billing-page')).toBeVisible();
  await expect(page.getByTestId('managed-cloud-plan')).toContainText('Realtek Managed Cloud');
  await expect(page.getByRole('heading', { name: 'Billing overview' }).first()).toBeVisible();
  await expect(page.locator('input[name="card_number"], input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toHaveCount(0);
  await testInfo.attach('staging-billing-overview', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[UI-CA-BILLING-STG-002] real staging invoice detail serves immutable PDF evidence @staging @billing', async ({ page }, testInfo) => {
  expect(invoiceID, 'E2E_BILLING_INVOICE_ID is required').toBeTruthy();
  const listResponse = await page.request.get('/api/billing/invoices?limit=100');
  expect(listResponse.ok()).toBeTruthy();
  const list = await listResponse.json();
  const invoice = (list.invoices || []).find((item) => item.id === invoiceID);
  expect(invoice, `invoice ${invoiceID} must belong to the qualification organization`).toBeTruthy();

  await page.goto(`/console/${encodeURIComponent(organizationID)}/billing/invoices`);
  await expect(page.getByTestId('billing-invoices-page')).toBeVisible();
  await page.getByRole('button', { name: invoice.invoice_number, exact: true }).click();
  await expect(page.getByTestId('billing-invoice-detail')).toBeVisible();
  await expect(page.getByTestId('billing-invoice-detail')).toContainText('This invoice is settled with a prepaid balance');

  const pdfResponse = await page.request.get(`/api/billing/invoices/${encodeURIComponent(invoiceID)}/pdf`);
  expect(pdfResponse.ok()).toBeTruthy();
  expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
  expect((await pdfResponse.body()).subarray(0, 4).toString()).toBe('%PDF');
  await testInfo.attach('staging-billing-invoice', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('[UI-CA-BILLING-STG-003] real staging activity and profile remain customer safe @staging @billing', async ({ page }, testInfo) => {
  const activityResponse = await page.request.get('/api/billing/activity?limit=100');
  expect(activityResponse.ok()).toBeTruthy();
  const activityPage = await activityResponse.json();
  expect(activityPage.activities?.length).toBeGreaterThan(0);
  expect(JSON.stringify(activityPage)).not.toMatch(/provider_(?:customer|method|transaction)_reference|authorization|bearer/i);

  await page.goto(`/console/${encodeURIComponent(organizationID)}/billing/activity`);
  await expect(page.getByTestId('billing-activity-page')).toBeVisible();
  await page.getByRole('button', { name: activityPage.activities[0].customer_reference, exact: true }).click();
  await expect(page.getByTestId('billing-activity-detail')).toContainText('Processing Timeline');
  await expect(page.getByTestId('billing-activity-detail')).not.toContainText('provider_transaction_reference');

  await page.goto(`/console/${encodeURIComponent(organizationID)}/billing/profile`);
  await expect(page.getByTestId('billing-profile-page')).toContainText('Existing Documents');
  await testInfo.attach('staging-billing-activity-profile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
