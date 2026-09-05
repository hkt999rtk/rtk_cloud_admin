import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '33333333-3333-4333-8333-333333333333';
const billingCloud = '11111111-1111-4111-8111-111111111111';
const pages = ['', '/products', '/fleet', '/fleet/provisioning', '/firmware-ota', '/analytics', '/members', '/settings', '/audit'];

for (const width of [1440, 1280, 768, 390]) {
  test(`[UI-CA-ENTERPRISE-LAYOUT-001] enterprise page coverage at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await login(page, 'developer');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const suffix of pages) {
      await page.goto(`/console/clouds/${cloud}${suffix}`);
      await expect(page.locator('.enterprise-console')).toBeVisible();
      await expect(page.locator('.topbar h1')).not.toBeEmpty();
      await expect(page.locator('.topbar .org-switcher')).toHaveValue(cloud);
      await expect(page.locator('main')).not.toContainText('Loading session');
      if (suffix === '/fleet/provisioning') await expect(page.getByRole('list', { name: 'Provisioning progress' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await testInfo.attach(`${width}-${suffix.slice(1) || 'overview'}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
    for (const route of ['/console/clouds', '/console/chipset-sdk', '/console/developer-docs']) {
      await page.goto(route);
      await expect(page.locator('.enterprise-console')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    }
    expect(errors).toEqual([]);
  });
}

test('[UI-CA-ENTERPRISE-BILLING-001] all billing views retain cloud context and readable active navigation @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  await page.goto(`/console/clouds/${billingCloud}/billing`);
  const tabs = page.getByRole('navigation', { name: 'Billing Pages' });
  for (const label of ['Billing Overview', 'Usage and Forecast', 'Invoices', 'Billing Activity', 'Payments and Automatic Top-Up', 'Billing Profile']) {
    await tabs.getByRole('button', { name: label, exact: true }).click();
    await expect(tabs.getByRole('button', { name: label, exact: true })).toHaveClass('active');
    await expect(page.locator('.topbar h1')).toHaveText('Billing');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Billing Cloud 1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await testInfo.attach(label, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
});

test('[UI-CA-ENTERPRISE-AUDIT-001] customer audit is scoped, handles states and excludes internal metadata @smoke', async ({ page }) => {
  await login(page, 'developer');
  let status = 200, body = [];
  const requests = [];
  page.on('request', request => { if (request.url().includes('/audit')) requests.push(new URL(request.url()).pathname); });
  await page.route(`**/api/developer/brand-clouds/${cloud}/audit`, route => route.fulfill({ status, json: body }));
  await page.goto(`/console/clouds/${cloud}/audit`);
  await expect(page.getByRole('heading', { name: 'No device activity yet' })).toBeVisible();
  body = [{ id: 1, action: 'DeviceUpdated', target: 'device-001', result: 'accepted', created_at: '2026-09-05T00:00:00Z', upstream_operation_id: 'internal-only-reference' }];
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'device-001', exact: true })).toBeVisible();
  await expect(page.getByText('internal-only-reference')).toHaveCount(0);
  status = 403;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your role cannot view');
  await expect(page.getByRole('cell', { name: 'device-001' })).toHaveCount(0);
  expect(requests.filter(path => path.startsWith('/api/'))).not.toContain('/api/audit');
});

test('[UI-CA-ENTERPRISE-DIALOG-001] create dialog traps focus, escapes, and restores focus @smoke', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/clouds');
  const trigger = page.getByRole('button', { name: 'Create cloud', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create cloud' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBeTruthy();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('[UI-CA-ENTERPRISE-DOCS-001] documentation copy success and denial are announced', async ({ page, context }) => {
  await login(page, 'developer');
  await page.goto('/console/developer-docs');
  const catalog = await (await page.request.get('/assets/developer-docs/index.en.json')).json();
  const chapter = catalog.pages.find(item => item.html.includes('<pre'));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/console/developer-docs/${chapter.slug}?cloudId=${cloud}`);
  const copy = page.getByRole('button', { name: 'Copy code example 1', exact: true });
  await copy.click();
  await expect(page.getByRole('status')).toContainText('Code example 1 copied.');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('permission denied'); }; });
  await copy.click();
  await expect(page.getByRole('status')).toContainText('Select the code and copy it manually.');
});
