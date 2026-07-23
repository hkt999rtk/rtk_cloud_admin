import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const syncedAt = '2026-07-19T06:26:00Z';
const providers = [
  { id: 'provider-amebapro2', name: 'Ameba IoT', manifest_url: 'https://provider.example.com/amebapro2.json', status: 'published', manifest_version: '1', manifest_sha256: '98f2d62a5f64a9266301972b173dcda9a8b59962a54be458dd93f13c52d8347d', etag: '"ameba-2026-07"', chipset_count: 1, sdk_release_count: 2, last_successful_refresh_at: syncedAt, stale: true, unavailable: false, validation_error: 'timeout on latest attempt' },
  { id: 'provider-realtek-main', name: 'Realtek Semiconductor', manifest_url: 'https://developer.realtek.com/manifest.json', status: 'published', manifest_version: '1', manifest_sha256: '2aa1f69cdd40dd9cd15d62f60f46ad09ef6a53df179705963ed62ff3187396da', last_modified: 'Sun, 19 Jul 2026 06:26:00 GMT', chipset_count: 3, sdk_release_count: 5, last_successful_refresh_at: syncedAt, stale: false, unavailable: false },
  { id: 'provider-partner-draft', name: 'Partner Lab', manifest_url: 'https://partner.example.com/manifest.json', status: 'draft', chipset_count: 0, sdk_release_count: 0, stale: false, unavailable: true },
];
const chipsets = [{
  id: 'chipset-amebapro2', provider_name: 'Ameba IoT', chipset_key: 'realtek-amebapro2', vendor: 'Realtek', name: 'AmebaPro2', family: 'AmebaPro2', stale: true, last_successful_refresh_at: syncedAt,
  description: '低功耗 AIoT multimedia ChipSet，提供 Arduino 與 FreeRTOS 開發資源。',
  sdk_releases: [
    { name: 'Ameba Arduino Pro2', version: '4.0.8', summary: 'Arduino development package', recommended: true, supported_models: ['AMB82-Mini', 'AmebaPro2 EVB'], endpoints: [
      { type: 'github', title: 'GitHub', url: 'https://github.com/Ameba-AIoT/ameba-arduino-pro2' },
      { type: 'information', title: '產品資訊', url: 'https://www.amebaiot.com/en/amebapro2/' },
      { type: 'sdk', title: 'SDK', url: 'https://github.com/Freertos-kvs-LTS/ambpro2_sdk' },
      { type: 'documentation', title: '文件', url: 'https://www.amebaiot.com/en/amebapro2/' },
      { type: 'example', title: '範例', url: 'https://github.com/Ameba-AIoT/ameba-arduino-pro2/tree/main/Arduino_package/hardware/libraries' },
      { type: 'support', title: '支援', url: 'https://www.amebaiot.com/en/contact-us/' },
    ] },
    { name: 'ambpro2 SDK', version: 'main', summary: 'FreeRTOS-based production SDK', recommended: false, supported_models: ['AmebaPro2 EVB'], endpoints: [{ type: 'sdk', title: 'SDK repository', url: 'https://github.com/Freertos-kvs-LTS/ambpro2_sdk' }] },
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
    if (url.pathname === '/api/admin/chipset-providers') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers, capabilities: ['platform.chipset_sdk.read', 'platform.chipset_sdk.edit', 'platform.chipset_sdk.publish'], source_status: 'available' }) });
    if (url.pathname === '/api/admin/chipset-providers/provider-amebapro2') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: providers[0], chipsets, source_status: 'available' }) });
    if (url.pathname === '/api/developer/chipsets') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chipsets, source_status: 'available' }) });
    if (shell.has(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shell.get(url.pathname)) });
    return route.continue();
  });
  await page.addInitScript(() => { Date.now = () => Date.parse('2026-07-19T06:30:00Z'); });
  await login(page, role);
}

test('[UI-CA-CHIPSET-005] Platform provider design matches approved mock @chipset-sdk @visual @smoke', async ({ page }, testInfo) => {
  testInfo.snapshotSuffix = '';
  await installShellRoutes(page, 'platform_admin');
  await page.goto('/admin/chipset-providers');
  await expect(page.getByTestId('chipset-provider-page')).toBeVisible();
  await expect(page).toHaveScreenshot('chipset-provider-list.png', { fullPage: testInfo.project.name === 'mobile' });
  if (testInfo.project.name === 'chromium') {
    await page.getByRole('row').filter({ hasText: 'Ameba IoT' }).getByRole('button', { name: '預覽' }).click();
    await expect(page.getByRole('dialog', { name: 'ChipSet provider drawer' })).toBeVisible();
    await expect(page).toHaveScreenshot('chipset-provider-validation-drawer.png');
  }
});

test('[UI-CA-CHIPSET-006] Developer resource design matches approved mock @chipset-sdk @visual @smoke', async ({ page }, testInfo) => {
  testInfo.snapshotSuffix = '';
  await installShellRoutes(page, 'developer');
  await page.goto('/console/chipset-sdk');
  await expect(page.getByTestId('chipset-resource-page')).toBeVisible();
  await expect(page).toHaveScreenshot('chipset-developer-resource-center.png', { fullPage: testInfo.project.name === 'mobile' });
});
