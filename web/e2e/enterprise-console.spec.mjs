import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '33333333-3333-4333-8333-333333333333';
const billingCloud = '11111111-1111-4111-8111-111111111111';
const pages = ['', '/products', '/fleet', '/fleet/provisioning', '/firmware-ota', '/analytics', '/members', '/settings'];

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

test('[UI-CA-PROVISIONING-RET-001] retired CSV provisioning links return to fleet management @smoke', async ({ page }) => {
  await login(page, 'developer');
  const provisioningRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.includes('/provisioning/')) provisioningRequests.push(request.url());
  });
  for (const path of [`/console/clouds/${cloud}/fleet/provisioning`, `/console/${cloud}/provisioning`]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloud}/fleet$`));
    await expect(page.locator('.topbar h1')).toHaveText('Fleet Management');
    await expect(page.locator('main')).not.toContainText('Loading session');
    await expect(page.getByRole('link', { name: 'CSV Provisioning', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload source', exact: true })).toHaveCount(0);
  }
  expect(provisioningRequests).toEqual([]);
});

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
