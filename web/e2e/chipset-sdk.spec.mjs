import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-CHIPSET-001] provider page exposes loading and validation states @chipset-sdk', async ({ page }) => {
  await login(page, 'platform_admin');
  let releaseProviders;
  const providersReady = new Promise((resolve) => { releaseProviders = resolve; });
  await page.route('**/api/admin/chipset-providers', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await providersReady;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [], capabilities: ['platform.chipset_sdk.read', 'platform.chipset_sdk.edit'], source_status: 'available' }) });
  });
  await page.goto('/admin/chipset-providers');
  await expect(page.getByText('正在載入 providers…')).toBeVisible();
  releaseProviders();
  await expect(page.getByText('目前沒有 Information Provider。')).toBeVisible();
  await page.unroute('**/api/admin/chipset-providers');

  await page.getByRole('button', { name: '新增 Provider' }).click();
  await page.getByLabel('Provider display name').fill('Invalid Provider');
  await page.getByLabel('Manifest URL').fill('https://not-allowed.example/manifest.json');
  await page.getByRole('button', { name: '儲存 Draft' }).click();
  await expect(page.getByText('Provider host is not allowed')).toBeVisible();
});

test('[UI-CA-CHIPSET-002] read-only provider capability hides mutation controls @chipset-sdk', async ({ page }) => {
  await login(page, 'platform_reader');
  await page.route('**/api/admin/chipset-providers', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [{ id: 'provider-read', name: 'Read-only Provider', manifest_url: 'https://provider.example.com/manifest.json', status: 'published', chipset_count: 1, sdk_release_count: 1, stale: false, unavailable: false }], capabilities: ['platform.chipset_sdk.read'], source_status: 'available' }) });
  });
  await page.goto('/admin/chipset-providers');
  await expect(page.getByRole('heading', { level: 2, name: 'ChipSet & SDK Providers' })).toBeVisible();
  await expect(page.getByRole('button', { name: '預覽' })).toBeVisible();
  await expect(page.getByRole('button', { name: /新增 Provider|編輯|發布|下架|刷新/ })).toHaveCount(0);
});

test('[UI-CA-CHIPSET-003] provider and developer pages expose upstream unavailable states @chipset-sdk @errors', async ({ page }) => {
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

test('[UI-CA-CHIPSET-004] provider publish, refresh, stale fallback, and unpublish flow @chipset-sdk @smoke', async ({ page }) => {
  const providerName = 'Ameba IoT Qualification Candidate';
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

  await page.getByRole('button', { name: '新增 Provider' }).click();
  await page.getByLabel('Provider display name').fill(providerName);
  await page.getByLabel('Manifest URL').fill('https://provider.example.com/amebapro2.json');
  await page.getByRole('button', { name: '儲存 Draft' }).click();
  const row = page.getByRole('row').filter({ hasText: providerName });
  await expect(row).toContainText('draft');
  await expect(row).toContainText('Unavailable');

  await row.getByRole('button', { name: '預覽' }).click();
  await page.getByRole('button', { name: 'Validate Preview' }).click();
  await expect(page.getByText('Version 1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' })).toBeVisible();
  await page.getByRole('button', { name: '關閉 Provider drawer' }).click();

  await row.getByRole('button', { name: '發布' }).click();
  await expect(row).toContainText('published');
  await expect(row).toContainText('1 ChipSets · 2 SDKs');

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { level: 2, name: 'ChipSet & SDK' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' })).toBeVisible();
  await expect(page.getByText('Ameba Arduino Pro2 · 1.0.0')).toBeVisible();
  await expect(page.getByText('Recommended', { exact: true })).toBeVisible();
  await expect(page.getByText('AMB82-Mini')).toBeVisible();
  await expect(page.getByRole('link', { name: /Ameba Arduino Pro2 GitHub/ })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: /Get ambpro2 SDK/ })).toHaveAttribute('href', 'https://github.com/Freertos-kvs-LTS/ambpro2_sdk');

  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  const refreshedRow = page.getByRole('row').filter({ hasText: providerName });
  await refreshedRow.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByText('Provider refresh 已完成。')).toBeVisible();

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByText('Ameba Arduino Pro2 · 2.0.0')).toBeVisible();

  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  const failingRow = page.getByRole('row').filter({ hasText: providerName });
  await failingRow.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByText('Provider fetch failed')).toBeVisible();

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByText('Ameba Arduino Pro2 · 2.0.0')).toBeVisible();
  await expect(page.getByText('部分資訊可能不是最新版本')).toBeVisible();
  await expect(page.getByText('Stale')).toBeVisible();

  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  const unpublishedRow = page.getByRole('row').filter({ hasText: providerName });
  await expect(unpublishedRow).toContainText('Stale');
  await unpublishedRow.getByRole('button', { name: '下架' }).click();
  await expect(unpublishedRow).toContainText('unpublished');

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { name: '目前沒有已發布資源' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' })).toHaveCount(0);
});
