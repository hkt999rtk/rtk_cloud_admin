import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-CHIPSET-009] PRO2 firmware burner is a global local-device tool @chipset-sdk @smoke', async ({ page }) => {
  await page.addInitScript(() => {
    let readController;
    const port = {
      readable: null,
      writable: null,
      async open() {
        this.readable = new ReadableStream({ start(controller) { readController = controller; } });
        this.writable = new WritableStream({ write() {} });
      },
      async close() {
        try { readController?.close(); } catch {}
        this.readable = null;
        this.writable = null;
      },
      async setSignals() {},
    };
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { addEventListener() {}, removeEventListener() {}, requestPort: async () => port },
    });
  });
  await login(page, 'developer');
  await page.goto('/console/chipset-sdk');
  const tool = page.locator('.pro2-tool-card');
  await expect(page.getByRole('heading', { name: 'Device Tools', exact: true })).toBeVisible();
  await expect(tool.getByRole('heading', { name: 'Ameba PRO2 Firmware Burner', exact: true })).toBeVisible();
  await expect(tool.getByText('No firmware upload', { exact: true })).toBeVisible();
  const open = tool.getByRole('link', { name: 'Open firmware burner', exact: true });
  await expect(open).toHaveAttribute('href', '/console/chipset-sdk/pro2/firmware-burner');
  await open.click();
  await expect(page).toHaveURL('/console/chipset-sdk/pro2/firmware-burner');
  await expect(page.getByTestId('pro2-firmware-burner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ameba PRO2 Firmware Burner', exact: true })).toBeVisible();
  await expect(page.getByText('Firmware and UART data stay on this computer.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect UART', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'UART terminal', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to ChipSet & SDK', exact: true })).toHaveAttribute('href', '/console/chipset-sdk');
  await page.getByRole('button', { name: 'Connect UART', exact: true }).click();
  await expect(page.getByText('Connected and waiting for device output.', { exact: true })).toBeVisible();
  await expect(page.locator('#task-title')).toHaveText('UART connected');
  await page.getByRole('button', { name: 'Burn firmware', exact: true }).click();
  await page.locator('#firmware').setInputFiles({ name: 'flash_is.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('PRO2 firmware fixture') });
  await expect(page.locator('#firmware-checksum')).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByRole('button', { name: 'Device is in download mode — start burn', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('UART disconnected. Reconnect when needed.', { exact: true })).toBeVisible();
});

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
