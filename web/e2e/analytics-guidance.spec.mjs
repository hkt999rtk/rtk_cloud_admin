import { expect, test } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '11111111-1111-4111-8111-111111111111';
const streamURL = `**/api/developer/brand-clouds/${cloud}/fleet/stream-stats*`;

test('[UI-CA-ANALYTICS-GUIDE-001] Reports explains its purpose and selected report type @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  await page.goto(`/console/clouds/${cloud}/analytics`);
  await expect(page.getByText('Review device status and firmware coverage across your cloud.', { exact: true })).toBeVisible();
  const type = page.getByRole('combobox', { name: 'Report Type', exact: true });
  await expect(type).toHaveAccessibleDescription('Review online and offline device status to identify device groups that need follow-up.');
  await type.selectOption('firmware_coverage');
  await expect(type).toHaveAccessibleDescription('Review deployed firmware versions to identify devices not yet on your target version. Coverage does not measure the success rate of an OTA campaign.');
  await expect(page.locator('.report-type-hint')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('report-guidance.png'), fullPage: true });
  await type.selectOption('fleet_status');
  await expect(type).toHaveAccessibleDescription('Review online and offline device status to identify device groups that need follow-up.');
});

test('[UI-CA-ANALYTICS-GUIDE-002] Stream guidance explains metric scope and distinguishes missing data from success @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  let stats = { source_status: 'available', success_rate_pct: 75, avg_duration_seconds: 120, active_sessions: 2, never_streamed_count: 3, trend: [], by_mode: {}, worst_devices: [] };
  await page.route(streamURL, route => route.fulfill({ json: stats }));
  await page.goto(`/console/clouds/${cloud}/analytics`);
  const section = page.locator('.stream-health-page');
  await expect(section.getByText('Monitor stream connection reliability and identify devices that need investigation.', { exact: true })).toBeVisible();
  await expect(section.getByText('Average duration of successful sessions with a recorded end event.', { exact: true })).toBeVisible();
  await expect(section.getByText('Devices Without Successful Streams', { exact: true })).toBeVisible();
  await expect(section.getByText('Devices with no successful stream request recorded in the selected 7D window; not a lifetime count.', { exact: true })).toBeVisible();
  await expect(section.getByText('Session metrics reflect recorded stream events; they do not confirm that video was successfully decoded or displayed in the app.', { exact: true })).toBeVisible();
  await expect(section.getByText('Devices Never Streamed', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  if (testInfo.project.name === 'mobile') {
    const panels = await section.locator('.stream-health-layout > section').evaluateAll(elements => elements.map(el => ({ x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width })));
    expect(panels.length).toBeGreaterThanOrEqual(3);
    for (const panel of panels) {
      expect(panel.width).toBeGreaterThan(200);
      expect(panel.x).toBe(panels[0].x);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('stream-guidance.png'), fullPage: true });

  stats = { source_status: 'unavailable', source_message: 'Stream source is unavailable.' };
  await page.reload();
  await expect(section.locator('.metric-card').getByText('N/A', { exact: true })).toHaveCount(4);
  await expect(section.getByText('N/A means stream metrics are currently unavailable. It does not mean there were no failures or that all streams succeeded.', { exact: true })).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Stream source unavailable', exact: true })).toBeVisible();
  await section.screenshot({ path: testInfo.outputPath('stream-unavailable.png') });

  stats = { source_status: 'available', success_rate_pct: 0, active_sessions: 0, never_streamed_count: 3, trend: [], by_mode: {}, worst_devices: [] };
  await page.reload();
  await expect(section.getByText('No stream requests in selected window.', { exact: true }).first()).toBeVisible();
  await expect(section.getByText(/N\/A means stream metrics/)).toHaveCount(0);
});
