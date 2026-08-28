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

test('[UI-CA-FLEETPAGE-001] Brandname customer pages load through the real BFF @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  for (const [route, heading] of pages) {
    await page.goto(`/console/brand-e2e-01/${route}`);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});

test('[UI-CA-FLEETPAGE-002] devices remains server paginated instead of loading the whole fleet @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  const requests = [];
  page.on('request', (request) => { if (request.url().includes('/api/fleet/devices')) requests.push(request.url()); });
  await page.goto('/console/brand-e2e-01/devices');
  await expect(page.getByRole('heading', { name: '設備' })).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.some((url) => /limit=\d+/.test(url))).toBeTruthy();
  expect(requests.some((url) => /offset=/.test(url))).toBeFalsy();
});

test('[UI-CA-FLEETPAGE-003] overview world map supports country hover zoom and pan @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/overview');
  const map = page.getByRole('img', { name: '可縮放及拖曳的世界設備分布地圖' });
  await expect(map).toBeVisible();
  await expect(map.locator('.world-countries path')).toHaveCount(177);
  await map.locator('.world-countries path').nth(10).hover();
  await expect(page.locator('.region-map-tooltip')).toBeVisible();
  await page.getByRole('button', { name: '放大地圖' }).click();
  await expect(page.getByText('140%', { exact: true })).toBeVisible();
  const beforePan = await map.getAttribute('viewBox');
  const bounds = await map.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height * .5);
  await page.mouse.up();
  await expect.poll(() => map.getAttribute('viewBox')).not.toBe(beforePan);
});
