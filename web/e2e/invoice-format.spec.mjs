import { expect, test } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '11111111-1111-4111-8111-111111111111';
const invoicesAPI = `**/api/developer/brand-clouds/${cloud}/billing/invoices?*`;
const invoicesURL = `/console/clouds/${cloud}/billing/invoices`;

async function checkLayout(page, testInfo) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const document = page.locator('.billing-invoice-document');
  expect(await document.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  const screenshot = testInfo.outputPath('invoice-layout.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('final-viewport', { path: screenshot, contentType: 'image/png' });
}

test('[UI-CA-INVOICE-001] empty invoice history shows a non-payable 5 percent sample @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  await page.route(invoicesAPI, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), invoices: [] } });
  });
  const writes = [];
  page.on('request', request => { if (request.url().includes('/billing/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.goto(invoicesURL);
  const preview = page.getByTestId('invoice-preview');
  await expect(page.getByRole('heading', { name: 'No invoices yet' })).toBeVisible();
  await expect(preview).toContainText('Sample / Not issued');
  await expect(preview).toContainText('Not a tax invoice or payment request');
  const totals = preview.locator('.invoice-document-totals');
  await expect(totals.locator('div').nth(0)).toContainText('1,000');
  await expect(totals.locator('div').nth(1)).toContainText('Taiwan tax (5%)');
  await expect(totals.locator('div').nth(1)).toContainText('50');
  await expect(totals.locator('div').nth(2)).toContainText('1,050');
  await expect(page.getByRole('link', { name: /Download.*PDF|Export statement/ })).toHaveCount(0);
  await expect(preview).not.toContainText('ACME Corp.');
  expect(writes).toEqual([]);
  await checkLayout(page, testInfo);
  await page.unroute(invoicesAPI);
  await page.getByRole('button', { name: 'Refresh Billing' }).click();
  await expect(page.getByRole('button', { name: 'INV-2026-000128' })).toBeVisible();
  await expect(preview).toHaveCount(0);
});

test('[UI-CA-INVOICE-002] issued invoice preserves recorded tax and scaled usage @billing @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  await page.route(invoicesAPI, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.invoices = [{ ...body.invoices[0], subtotal_minor: 1000, tax_minor: 0, total_minor: 1000, amount_settled_minor: 0, amount_due_minor: 1000, state: 'issued', document: null,
      lines: [{ id: 'scaled', service_code: 'storage', description: 'Scaled storage usage', quantity: 125, quantity_scale: 2, unit: 'GB-month', subtotal_minor: 1000, total_minor: 1000 }] }];
    await route.fulfill({ response, json: body });
  });
  await page.goto(invoicesURL);
  await page.getByRole('button', { name: 'INV-2026-000128' }).click();
  const invoice = page.getByTestId('invoice-document');
  await expect(invoice).toBeVisible();
  await expect(page.getByTestId('invoice-preview')).toHaveCount(0);
  await expect(invoice).toContainText('1.25');
  await expect(invoice).not.toContainText('5%');
  await expect(invoice).not.toContainText('This invoice is settled');
  await expect(invoice.locator('.invoice-document-totals > div').nth(1)).toContainText('$0');
  await expect(invoice.locator('.invoice-document-totals > div').last()).toContainText('1,000');
  await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveCount(0);
  await checkLayout(page, testInfo);
  await page.getByRole('button', { name: 'Back to invoices' }).click();
  await expect(page).toHaveURL(new RegExp(`${invoicesURL}$`));
});

test('[UI-CA-INVOICE-003] invoice API failure is not presented as an empty-history sample @billing @smoke', async ({ page }) => {
  await login(page, 'billing_owner');
  await page.route(invoicesAPI, route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto(invoicesURL);
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByTestId('invoice-preview')).toHaveCount(0);
});
