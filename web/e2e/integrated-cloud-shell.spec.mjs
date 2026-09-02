import { expect, test } from '@playwright/test';

import { login } from './fixtures/session.mjs';

const cloudA = '11111111-1111-4111-8111-111111111111';
const cloudB = '22222222-2222-4222-8222-222222222222';

function cloud(id, index) {
  return {
    id,
    name: `Billing Cloud ${index}`,
    my_role: 'owner',
    owner_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    owner_email: 'billing.owner@example.com',
    ownership_version: 7,
    status: 'active',
    capabilities: [
      'fleet.read', 'product.read', 'firmware.release.read', 'ota.plan.read',
      'reports.read', 'team.read', 'billing_account.read',
    ],
  };
}

test('[UI-CA-MULTICLOUD-SHELL-001] integrated shell keeps every feature and request in its URL cloud @smoke', async ({ page, context }) => {
  await login(page, 'billing_owner');
  const activeOrgWrites = [];
  const scopedReads = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/me/active-org' && request.method() !== 'GET') activeOrgWrites.push(path);
    if (path.includes('/api/developer/brand-clouds/') && path.includes('/fleet/')) scopedReads.push(path);
  });
  await page.route('**/api/developer/brand-clouds?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      brand_clouds: [cloud(cloudA, 1), cloud(cloudB, 2)],
      pagination: { limit: 100, offset: 0, total: 2 },
      owned_count: 2,
      owned_limit: 8,
      reserved_count: 0,
    }),
  }));

  const featureLabels = ['Overview', 'Products', 'Fleet Management', 'Firmware & OTA', 'Analytics', 'Members & Access', 'Billing', 'Settings', 'Audit'];
  await page.goto('/console/clouds');
  await expect(page.locator('.topbar-title').getByRole('heading', { name: 'My Clouds', exact: true })).toBeVisible();
  await expect(page.locator('.my-clouds-heading').getByRole('heading', { name: 'My Clouds', exact: true })).toHaveCount(0);
  await expect(page.getByText('Create and manage the Brand Clouds you own, or open clouds shared with your account.', { exact: false })).toBeVisible();
  await expect(page.getByText('billing.owner@example.com', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.my-clouds-grid').getByText('Status', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My Clouds', exact: true })).toBeVisible();
  for (const label of featureLabels) {
    await expect(page.locator('.sidebar-disabled', { hasText: label })).toHaveAttribute('aria-disabled', 'true');
  }
  await page.getByLabel('Brand Cloud').selectOption(cloudA);
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloudA}$`));

  const mobileMenu = page.getByRole('button', { name: 'Open navigation' });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  for (const label of ['My Clouds', ...featureLabels]) {
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'My Clouds', exact: true }).click();
  await expect(page).toHaveURL(`/console/clouds?cloudId=${cloudA}`);
  await expect(page.getByRole('link', { name: 'Fleet Management', exact: true })).toHaveAttribute('href', `/console/clouds/${cloudA}/fleet`);
  await page.getByRole('link', { name: 'Fleet Management', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloudA}/fleet$`));
  await expect.poll(() => scopedReads.some((path) => path.startsWith(`/api/developer/brand-clouds/${cloudA}/fleet/`))).toBeTruthy();

  await page.getByLabel('Brand Cloud').selectOption(cloudB);
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloudB}/fleet$`));
  expect(activeOrgWrites).toEqual([]);

  const other = await context.newPage();
  const otherReads = [];
  other.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/api/developer/brand-clouds/') && path.includes('/fleet/')) otherReads.push(path);
  });
  await other.route('**/api/developer/brand-clouds?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ brand_clouds: [cloud(cloudA, 1), cloud(cloudB, 2)], pagination: { limit: 100, offset: 0, total: 2 }, owned_count: 2, owned_limit: 8, reserved_count: 0 }),
  }));
  await other.goto(`/console/clouds/${cloudA}/fleet`);
  await expect.poll(() => otherReads.some((path) => path.startsWith(`/api/developer/brand-clouds/${cloudA}/fleet/`))).toBeTruthy();
  expect(otherReads.some((path) => path.includes(cloudB))).toBeFalsy();
  expect(scopedReads.some((path) => path.includes(cloudA))).toBeTruthy();
  await other.close();
});

test('[UI-CA-MULTICLOUD-ANALYTICS-001] unavailable Overview and Stream Health values use compact N/A labels', async ({ page }) => {
  await login(page, 'billing_owner');
  await page.route(`**/api/developer/brand-clouds/${cloudA}/fleet/health-summary*`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      source_status: 'unavailable',
      unavailable_reason: 'No telemetry source configured.',
    }),
  }));
  await page.route(`**/api/developer/brand-clouds/${cloudA}/fleet/stream-stats*`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      source_status: 'unavailable',
      unavailable_reason: 'WebRTC session event source is not configured.',
    }),
  }));
  await page.goto(`/console/clouds/${cloudA}`);

  const overviewCards = page.locator('.overview-metrics .metric-card');
  await expect(overviewCards.getByText('N/A', { exact: true })).toHaveCount(3);
  await expect(overviewCards.getByText('Unavailable', { exact: true })).toHaveCount(0);

  await page.goto(`/console/clouds/${cloudA}/analytics`);

  const cards = page.locator('.stream-health-metrics .metric-card');
  await expect(cards).toHaveCount(4);
  await expect(cards.getByText('N/A', { exact: true })).toHaveCount(4);
  await expect(cards.getByText('Unavailable', { exact: true })).toHaveCount(0);
});

test('[UI-CA-MULTICLOUD-PRODUCTS-001] Products explains its SKU boundary without repeating the cloud heading', async ({ page }) => {
  await login(page, 'billing_owner');
  await page.route(new RegExp(`/api/developer/brand-clouds/${cloudA}/products\\?`), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ products: [], pagination: { limit: 25, offset: 0, total: 0 }, can_create: true }),
  }));
  await page.goto(`/console/clouds/${cloudA}/products`);

  await expect(page.locator('.topbar-title').getByRole('heading', { name: 'Billing Cloud 1', exact: true })).toBeVisible();
  await expect(page.locator('.my-clouds-heading').getByRole('heading', { name: 'Billing Cloud 1', exact: true })).toHaveCount(0);
  await expect(page.getByText('A Product usually represents one SKU', { exact: false })).toBeVisible();
  await expect(page.getByText('changes reach only the intended models', { exact: false })).toBeVisible();
  await expect(page.getByText('Each Product has a permanent Product key', { exact: false })).toBeVisible();
});
