import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-CHIPSET-003] developer resources expose safe upstream unavailable states @chipset-sdk @errors', async ({ page }) => {
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
