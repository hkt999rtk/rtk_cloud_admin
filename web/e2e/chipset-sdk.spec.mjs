import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

async function navigateAfterRoleSwitch(page, pathname) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(pathname);
      return;
    } catch (error) {
      if (!String(error).includes('net::ERR_ABORTED') || attempt === 2) throw error;
      // Updating the shared session cookie can make Chromium abort an in-flight
      // SPA navigation. Retry only that browser-level abort; HTTP and assertion
      // failures still fail immediately.
      await page.waitForTimeout(50);
    }
  }
}

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
  await expect(page.getByText('Loading providers…')).toBeVisible();
  releaseProviders();
  await expect(page.getByText('No Information Providers are available. Add a provider and complete validation preview before publishing.')).toBeVisible();
  await page.unroute('**/api/admin/chipset-providers');

  await page.getByRole('button', { name: 'Add Provider' }).click();
  await page.getByLabel('Provider display name').fill('Invalid Provider');
  await page.getByLabel('Manifest URL').fill('https://not-allowed.example/manifest.json');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText('The provider draft could not be saved. Please try again.')).toBeVisible();
});

test('[UI-CA-CHIPSET-002] read-only provider capability hides mutation controls @chipset-sdk', async ({ page }) => {
  await login(page, 'platform_reader');
  await page.route('**/api/admin/chipset-providers', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [{ id: 'provider-read', name: 'Read-only Provider', manifest_url: 'https://provider.example.com/manifest.json', status: 'published', chipset_count: 1, sdk_release_count: 1, stale: false, unavailable: false }], capabilities: ['platform.chipset_sdk.read'], source_status: 'available' }) });
  });
  await page.goto('/admin/chipset-providers');
  await expect(page.getByRole('heading', { level: 2, name: 'ChipSet & SDK Providers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  for (const name of ['Add Provider', 'Edit', 'Publish', 'Unpublish']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('row').filter({ hasText: 'Read-only Provider' }).getByRole('button', { name: 'Refresh' })).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Resources are temporarily unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cloud Client SDKs are temporarily unavailable' })).toBeVisible();
});

test('[UI-CA-CHIPSET-008] Portal failure does not hide Device and ChipSet resources @chipset-sdk', async ({ page }) => {
  await login(page, 'developer');
  await page.route('**/api/developer/sdk-releases/latest', (route) => route.fulfill({ status: 502, body: 'SDK catalog unavailable' }));
  await page.route('**/api/developer/chipsets', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ chipsets: [{ id: 'chipset-independent', provider_name: 'Ameba IoT', chipset_key: 'realtek-amebapro2', vendor: 'Realtek', name: 'AmebaPro2', description: 'Independent device catalog', resources: [], sdk_releases: [], stale: false }], source_status: 'available' }),
  }));
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { name: 'Cloud Client SDKs are temporarily unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' })).toBeVisible();
});

test('[UI-CA-CHIPSET-007] developer resources do not install a global refresh timer @chipset-sdk', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.__scheduledIntervals = [];
    window.setInterval = (callback, delay, ...args) => {
      window.__scheduledIntervals.push(delay);
      return nativeSetInterval(callback, delay, ...args);
    };
  });
  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { level: 1, name: 'ChipSet & SDK' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Cloud Client SDKs' })).toBeVisible();
  expect(await page.evaluate(() => window.__scheduledIntervals)).toEqual([]);
});

test('[UI-CA-CHIPSET-004] provider publish, refresh, stale fallback, and unpublish flow @chipset-sdk @smoke', async ({ page }, testInfo) => {
  const providerName = `Ameba IoT Qualification Candidate repeat-${testInfo.repeatEachIndex}-attempt-${testInfo.retry}`;
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
  // The fixture server outlives Playwright's retry worker. If an attempt is
  // interrupted after publish, remove that attempt's published state before
  // exercising the lifecycle again.
  const providersResponse = await page.request.get('/api/admin/chipset-providers');
  expect(providersResponse.ok()).toBeTruthy();
  const providers = (await providersResponse.json()).providers || [];
  for (const provider of providers.filter(({ status }) => status === 'published')) {
    const response = await page.request.post(`/api/admin/chipset-providers/${encodeURIComponent(provider.id)}/unpublish`, {
      headers: { 'Idempotency-Key': `e2e-retry-cleanup-${provider.id}-${testInfo.retry}` },
    });
    expect(response.ok()).toBeTruthy();
  }
  await navigateAfterRoleSwitch(page, '/admin/chipset-providers');
  await expect(page.getByRole('heading', { level: 2, name: 'ChipSet & SDK Providers' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Provider' }).click();
  await page.getByLabel('Provider display name').fill(providerName);
  await page.getByLabel('Manifest URL').fill('https://provider.example.com/amebapro2.json');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  const row = page.getByRole('row').filter({ hasText: providerName });
  await expect(row).toContainText('draft');
  await expect(row).toContainText('Unavailable');

  await row.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Validate Preview' }).click();
  await expect(page.getByText('Version 1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close Provider drawer' }).click();

  await row.getByRole('button', { name: 'Publish' }).click();
  await expect(row).toContainText('published');
  await expect(row).toContainText('1 ChipSets · 2 SDKs');

  await login(page, 'developer');
  await navigateAfterRoleSwitch(page, '/console/chipset-sdk');
  await expect(page.getByRole('heading', { level: 1, name: 'ChipSet & SDK' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Cloud Client SDKs' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Android Kotlin' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'iOS Swift' })).toBeVisible();
  await expect(page.getByText('WebRTC signaling', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('WebRTC answerer integration', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Local preview' })).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'AmebaPro2' }).first()).toBeVisible();
  const initialRelease = page.locator('.sdk-release').filter({ hasText: 'Ameba Arduino Pro2 · 1.0.0' }).first();
  await expect(initialRelease.getByText('Ameba Arduino Pro2 · 1.0.0')).toBeVisible();
  await expect(initialRelease.getByText('Recommended', { exact: true })).toBeVisible();
  await expect(initialRelease.getByText('AMB82 MINI')).toBeVisible();
  await expect(initialRelease.getByRole('link', { name: /Ameba Arduino Pro2 GitHub/ })).toHaveAttribute('target', '_blank');
  await expect(initialRelease.getByRole('link', { name: /Ameba Arduino Pro2 GitHub/ })).toHaveAttribute('rel', /noopener/);
  const productLink = page.getByRole('link', { name: /AmebaPro2 Product & Development Board/}).first();
  await expect(productLink).toHaveAttribute('target', '_blank');
  await expect(productLink).toContainText('Official');
  await expect(productLink).toContainText('en');
  const sdkDownloadLink = page.locator('a[href="https://github.com/Ameba-AIoT/ameba-rtos-pro2"]:visible').first();
  await expect(sdkDownloadLink).toHaveAccessibleName(/Ameba FreeRTOS Pro2 GitHub/);

  await login(page, 'platform_admin');
  await navigateAfterRoleSwitch(page, '/admin/chipset-providers');
  const refreshedRow = page.getByRole('row').filter({ hasText: providerName });
  await refreshedRow.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Provider refresh Completed.')).toBeVisible();

  await login(page, 'developer');
  await navigateAfterRoleSwitch(page, '/console/chipset-sdk');
  await expect(page.getByText('Ameba Arduino Pro2 · 2.0.0').first()).toBeVisible();

  await login(page, 'platform_admin');
  await navigateAfterRoleSwitch(page, '/admin/chipset-providers');
  const failingRow = page.getByRole('row').filter({ hasText: providerName });
  await failingRow.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('.notice')).toHaveText('The provider action could not be completed.');

  await login(page, 'developer');
  await navigateAfterRoleSwitch(page, '/console/chipset-sdk');
  await expect(page.getByText('Ameba Arduino Pro2 · 2.0.0').first()).toBeVisible();
  await expect(page.getByText('Some information may be out of date')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Developer Support Guide' })).toHaveCount(0);
  await expect(page.getByText('Stale')).toBeVisible();

  await login(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  const unpublishedRow = page.getByRole('row').filter({ hasText: providerName });
  await expect(unpublishedRow).toContainText('Stale');
  await unpublishedRow.getByRole('button', { name: 'Unpublish' }).click();
  await expect(unpublishedRow).toContainText('unpublished');

  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByRole('heading', { name: 'No published resources' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AmebaPro2' })).toHaveCount(0);
});
