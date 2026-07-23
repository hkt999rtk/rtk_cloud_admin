import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const pages = [
  ['overview', '設備總覽'],
  ['devices', '設備'],
  ['sku-services', 'SKU 與服務'],
  ['firmware-ota', '韌體更新'],
  ['jobs', '批次工作'],
  ['reports', '報表'],
  ['access', '團隊與權限'],
  ['provisioning', '設備註冊'],
];

test('Brandname customer pages load through the real BFF @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  for (const [route, heading] of pages) {
    await page.goto(`/console/brand-e2e-01/${route}`);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});

test('devices remains server paginated instead of loading the whole fleet @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  const requests = [];
  page.on('request', (request) => { if (request.url().includes('/api/fleet/devices')) requests.push(request.url()); });
  await page.goto('/console/brand-e2e-01/devices');
  await expect(page.getByRole('heading', { name: '設備' })).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.some((url) => /limit=\d+/.test(url))).toBeTruthy();
  expect(requests.some((url) => /offset=/.test(url))).toBeFalsy();
});
