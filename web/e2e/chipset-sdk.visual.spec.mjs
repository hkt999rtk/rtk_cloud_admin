import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const syncedAt = '2026-07-19T06:26:00Z';
const chipsets = [{
  id: 'chipset-amebapro2', provider_name: 'Ameba IoT', chipset_key: 'realtek-amebapro2', vendor: 'Realtek', name: 'AmebaPro2', family: 'AmebaPro2', stale: true, last_successful_refresh_at: syncedAt,
  description: 'Low-power AIoT multimedia ChipSet, providing Arduino and FreeRTOS development resources.',
  resources: [
    { type: 'product', title: 'AmebaPro2 Product & Development Boards', url: 'https://www.amebaiot.com/en/amebapro2/', source: 'official', languages: ['en'], verified_at: '2026-08-28', summary: 'Official products, specifications and development board entrance.' },
    { type: 'datasheet', title: 'AMB82 Mini Datasheet', url: 'https://www.amebaiot.com/en/datasheet-download-amb82-mini/', source: 'official', languages: ['en'], verified_at: '2026-08-28' },
    { type: 'forum', title: 'Ameba Developer Forum', url: 'https://forum.amebaiot.com/', source: 'official', languages: ['en', 'zh-TW'], verified_at: '2026-08-28' },
    { type: 'video', title: 'AmebaPro2 Start Here', url: 'https://www.youtube.com/playlist?list=PLEQfNjOZQRyP1dyegDVYqgw53_AORspMK', source: 'official', languages: ['en'], verified_at: '2026-08-28' },
  ],
  sdk_releases: [
    { name: 'Ameba Arduino Pro2', version: '4.1.0', summary: 'Arduino development package', recommended: true, supported_models: ['AMB82 MINI'], endpoints: [
      { type: 'github', title: 'GitHub', url: 'https://github.com/Ameba-AIoT/ameba-arduino-pro2', source: 'official', languages: ['en'], verified_at: '2026-08-28' },
      { type: 'getting_started', title: 'Installation & Getting Started', url: 'https://ameba-doc-arduino-sdk.readthedocs-hosted.com/en/latest/ameba_pro2/amb82-mini/index.html', source: 'official', languages: ['en'], verified_at: '2026-08-28' },
    ] },
    { name: 'Ameba FreeRTOS Pro2', version: 'main', summary: 'FreeRTOS-based production SDK', recommended: false, supported_models: ['AMB82 MINI'], endpoints: [{ type: 'github', title: 'SDK repository', url: 'https://github.com/Ameba-AIoT/ameba-rtos-pro2', source: 'official', languages: ['en'], verified_at: '2026-08-28' }] },
  ],
}];

async function installShellRoutes(page, role) {
  const shell = new Map([
    ['/api/admin/summary', {}], ['/api/admin/customers', []], ['/api/admin/devices', []], ['/api/admin/operations', []],
    ['/api/admin/service-health', []], ['/api/admin/audit', []], ['/api/admin/platform-dashboard', {}],
    ['/api/summary', {}], ['/api/customers', []], ['/api/fleet/devices', { devices: [] }], ['/api/fleet/summary', {}],
    ['/api/fleet/health-summary', { source_status: 'available', devices: [] }], ['/api/fleet/stream-stats', { source_status: 'available', devices: [] }],
  ]);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/developer/chipsets') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chipsets, source_status: 'available' }) });
    if (shell.has(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shell.get(url.pathname)) });
    return route.continue();
  });
  await page.addInitScript(() => { Date.now = () => Date.parse('2026-07-19T06:30:00Z'); });
  await login(page, role);
}

test('[UI-CA-CHIPSET-006] Developer resource design matches approved mock @chipset-sdk @visual @smoke', async ({ page }, testInfo) => {
  testInfo.snapshotSuffix = '';
  await installShellRoutes(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByTestId('chipset-resource-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cloud Client SDKs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Device & ChipSet SDKs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Android Kotlin' })).toBeVisible();
  await expect(page.getByText('WebRTC answerer integration', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Developer Support Guide' })).toHaveCount(0);
  await expect(page.getByText('Some information may be out of date')).toHaveCount(0);
  await expect(page).toHaveScreenshot('chipset-developer-resource-center.png', { fullPage: testInfo.project.name === 'mobile' });
});
