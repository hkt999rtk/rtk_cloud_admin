import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('provider page exposes loading and validation states @chipset-sdk', async ({ page }) => {
  await login(page, 'platform_admin');
  await page.route('**/api/admin/chipset-providers', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [], capabilities: ['platform.chipset_sdk.read', 'platform.chipset_sdk.edit'], source_status: 'available' }) });
  });
  await page.goto('/admin/chipset-providers');
  await expect(page.getByText('正在載入 providers…')).toBeVisible();
  await expect(page.getByText('目前沒有 Information Provider。')).toBeVisible();
  await page.unroute('**/api/admin/chipset-providers');

  await page.getByPlaceholder('Provider 名稱').fill('Invalid Provider');
  await page.getByPlaceholder('https://provider.example.com/manifest.json').fill('https://not-allowed.example/manifest.json');
  await page.getByRole('button', { name: '新增 Provider' }).click();
  await expect(page.getByText('Provider host is not allowed')).toBeVisible();
});

test('read-only provider capability hides mutation controls @chipset-sdk', async ({ page }) => {
  await login(page, 'platform_reader');
  await page.goto('/admin/chipset-providers');
  await expect(page.getByRole('heading', { level: 2, name: 'ChipSet & SDK Providers' })).toBeVisible();
  await expect(page.getByPlaceholder('Provider 名稱')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /新增 Provider|編輯|發布|下架|刷新/ })).toHaveCount(0);
});

test('provider and developer pages expose upstream unavailable states @chipset-sdk @errors', async ({ page }) => {
  test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'requires unavailable fixture mode');
  const baseResponses = new Map([
    ['/api/admin/summary', {}], ['/api/admin/customers', []], ['/api/admin/devices', []], ['/api/admin/operations', []],
    ['/api/admin/service-health', []], ['/api/admin/audit', []], ['/api/admin/platform-dashboard', {}],
    ['/api/summary', {}], ['/api/customers', []],
  ]);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (baseResponses.has(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseResponses.get(url.pathname)) });
    if (url.pathname === '/api/fleet/devices') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ devices: [] }) });
    return route.continue();
  });
  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  await expect(page.getByRole('heading', { name: 'Provider catalog unavailable' })).toBeVisible();

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { name: '資源暫時無法取得' })).toBeVisible();
});

test('provider publish, refresh, stale fallback, and unpublish flow @chipset-sdk @smoke', async ({ page }) => {
  const shellResponses = new Map([
    ['/api/admin/summary', {}], ['/api/admin/customers', []], ['/api/admin/devices', []],
    ['/api/admin/operations', []], ['/api/admin/service-health', []], ['/api/admin/audit', []],
    ['/api/admin/platform-dashboard', {}], ['/api/summary', {}], ['/api/customers', []],
    ['/api/fleet/devices', { devices: [] }], ['/api/fleet/summary', {}],
    ['/api/fleet/health-summary', { source_status: 'available', devices: [] }],
    ['/api/fleet/stream-stats', { source_status: 'available', devices: [] }],
  ]);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (shellResponses.has(pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shellResponses.get(pathname)) });
    }
    return route.continue();
  });
  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  await expect(page.getByRole('heading', { level: 2, name: 'ChipSet & SDK Providers' })).toBeVisible();

  await page.getByPlaceholder('Provider 名稱').fill('Ameba IoT E2E');
  await page.getByPlaceholder('https://provider.example.com/manifest.json').fill('https://provider.example.com/amebapro2.json');
  await page.getByRole('button', { name: '新增 Provider' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Ameba IoT E2E' });
  await expect(row).toContainText('draft');
  await expect(row).toContainText('unavailable');

  await row.getByRole('button', { name: '發布' }).click();
  await expect(row).toContainText('published');
  await expect(row).toContainText('1 ChipSets · 2 SDKs');

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { level: 2, name: 'ChipSet & SDK' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' })).toBeVisible();
  await expect(page.getByText('Ameba Arduino Pro2 1.0.0')).toBeVisible();
  await expect(page.getByText('Recommended')).toBeVisible();
  await expect(page.getByText('AMB82-Mini')).toBeVisible();
  await expect(page.getByRole('link', { name: /Ameba Arduino Pro2 GitHub/ })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: /Get ambpro2 SDK/ })).toHaveAttribute('href', 'https://github.com/Freertos-kvs-LTS/ambpro2_sdk');

  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  const refreshedRow = page.getByRole('row').filter({ hasText: 'Ameba IoT E2E' });
  await refreshedRow.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByText('Provider refresh 已完成。')).toBeVisible();

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByText('Ameba Arduino Pro2 2.0.0')).toBeVisible();

  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  const failingRow = page.getByRole('row').filter({ hasText: 'Ameba IoT E2E' });
  await failingRow.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByText('Provider fetch failed')).toBeVisible();

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByText('Ameba Arduino Pro2 2.0.0')).toBeVisible();
  await expect(page.getByText('資訊可能過期')).toBeVisible();

  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  const unpublishedRow = page.getByRole('row').filter({ hasText: 'Ameba IoT E2E' });
  await expect(unpublishedRow).toContainText('stale');
  await unpublishedRow.getByRole('button', { name: '下架' }).click();
  await expect(unpublishedRow).toContainText('unpublished');

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { name: '目前沒有已發布資源' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' })).toHaveCount(0);
});
