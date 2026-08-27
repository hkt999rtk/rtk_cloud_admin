import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const pages = [
  ['overview', '設備總覽'],
  ['devices', '設備'],
  ['sku-services', 'SKU 與服務'],
  ['firmware-ota', '韌體更新'],
  ['jobs', '批次工作'],
  ['reports', '報表'],
  ['access', '成員與權限'],
  ['settings', '設定'],
  ['provisioning', '設備註冊'],
];

test('[UI-CA-FLEETPAGE-001] Brandname customer pages load through the real BFF @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  for (const [route, heading] of pages) {
    await page.goto(`/console/brand-e2e-01/${route}`);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});

test('[UI-CA-FLEETPAGE-003] Brand Cloud overview access and settings share one navigation entry @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/overview');
  const brandCloudEntry = page.getByRole('button', { name: '品牌雲首頁' });
  await expect(brandCloudEntry).toHaveClass(/active/);
  await expect(page.getByText('設備營運', { exact: true })).toBeVisible();
  await expect(page.getByText('產品與更新', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '管理成員與權限' }).click();
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/access$/);
  await expect(page.getByRole('heading', { name: '成員與權限' })).toBeVisible();
  await expect(brandCloudEntry).toHaveClass(/active/);
  const settingsTab = page.getByRole('button', { name: '設定', exact: true });
  const settingsBox = await settingsTab.boundingBox();
  expect(settingsBox).not.toBeNull();
  await page.mouse.click(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/settings$/);
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/access$/);
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
