import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloudID = '33333333-3333-4333-8333-333333333333';
const base = `/api/developer/brand-clouds/${cloudID}/webhook`;

test('[UI-CA-WEBHOOK-001] owner can configure, inspect, and disable scoped webhook without exposing the secret @smoke', async ({ page, isMobile }) => {
  await login(page, 'developer');
  let subscription = null;
  let unavailable = false;
  const writes = [];
  await page.route(`**/api/developer/brand-clouds/${cloudID}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, brand_cloud: {
      ...data.brand_cloud,
      capabilities: [...new Set([...(data.brand_cloud?.capabilities || []), 'cloud.update'])],
    } } });
  });
  await page.route(`**${base}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const headers = { 'Content-Type': 'application/json', 'X-Cloud-Ownership-Version': '7' };
    if (path === `${base}/subscription`) {
      if (method === 'GET') {
        if (unavailable) return route.fulfill({ status: 503, headers, body: '{}' });
        await route.fulfill(subscription
          ? { status: 200, headers, body: JSON.stringify(subscription) }
          : { status: 404, headers, body: '{}' });
      } else if (method === 'PUT') {
        expect(request.headers()['x-cloud-ownership-version']).toBe('7');
        expect(request.headers()['x-brand-cloud-id']).toBeUndefined();
        expect(request.headers().authorization).toBeUndefined();
        writes.push(JSON.parse(request.postData()));
        subscription = { endpoint_url: writes.at(-1).endpoint_url, enabled: true };
        await route.fulfill({ status: 200, headers, body: JSON.stringify(subscription) });
      } else if (method === 'DELETE') {
        expect(request.headers()['x-cloud-ownership-version']).toBe('7');
        subscription.enabled = false;
        await route.fulfill({ status: 204, headers });
      }
    } else if (path === `${base}/events/event-1/receipts`) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ event_id: 'event-1', receipts: [{ event_id: 'event-1', device_id: 'device-1', attempt: 1, outcome: 'delivered', status_code: 204, observed_at: '2026-09-20T00:00:00Z' }] }) });
    } else {
      await route.fulfill({ status: 404, headers });
    }
  });

  await page.goto(`/console/clouds/${cloudID}/settings`);
  const panel = page.locator('.brand-webhook-settings');
  await expect(panel.getByRole('heading', { name: 'Brand event webhook' })).toBeVisible();
  await expect(panel.getByText('Not configured', { exact: true })).toBeVisible();
  await panel.getByLabel('HTTPS endpoint').fill('https://hooks.example.test/events');
  await panel.getByLabel(/New signing secret/).fill('s'.repeat(32));
  await panel.getByRole('button', { name: 'Enable webhook' }).click();
  await expect(panel.getByText('Enabled', { exact: true })).toBeVisible();
  await expect(panel.getByLabel(/New signing secret/)).toHaveValue('');
  await expect(panel).not.toContainText('s'.repeat(32));
  expect(writes).toEqual([{ endpoint_url: 'https://hooks.example.test/events', secret: 's'.repeat(32) }]);

  await panel.getByLabel('Event ID').fill('event-1');
  await panel.getByRole('button', { name: 'Check receipts' }).click();
  await expect(panel.getByRole('row', { name: /device-1 1 delivered 204/ })).toBeVisible();

  await panel.getByRole('button', { name: 'Disable delivery' }).click();
  await expect(panel.getByRole('button', { name: 'Confirm disable' })).toBeVisible();
  await panel.getByRole('button', { name: 'Confirm disable' }).click();
  await expect(panel.getByText('Disabled', { exact: true })).toBeVisible();
  unavailable = true;
  await page.reload();
  await expect(panel.getByRole('alert')).toContainText('Brand event delivery is not configured for this environment.');
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('[data-locale-selector]').selectOption('zh-TW');
  if (isMobile) await page.locator('.mobile-nav-close').click();
  await expect(panel.getByRole('alert')).toContainText('此環境尚未設定品牌事件傳送服務。');
});
