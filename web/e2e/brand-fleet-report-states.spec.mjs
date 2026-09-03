import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloudId = '33333333-3333-4333-8333-333333333333';
const reportsAPI = `/api/developer/brand-clouds/${cloudId}/reports`;

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  Object.entries(value).forEach(([key, item]) => {
    keys.add(key.toLowerCase());
    collectKeys(item, keys);
  });
  return keys;
}

test('[UI-CA-REPORT-001] report failure is customer-safe when upstream is unavailable @brand-fleet @errors', async ({ page }) => {
  test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
  await login(page, 'developer');
  await page.goto(`/console/clouds/${cloudId}/analytics`);
  const response = await page.request.post(reportsAPI, {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-report-failure-${Date.now()}` },
    data: { name: 'Unavailable report', report_type: 'fleet_status', dimensions: ['status'], timezone: 'UTC', format: 'json', scope: {} },
  });
  expect(response.status()).toBe(202);
  const report = (await response.json()).report;
  await expect.poll(async () => {
    const result = await page.request.get(`${reportsAPI}/${report.id}`);
    if (!result.ok()) return 'unavailable';
    return (await result.json()).report?.state || 'unknown';
  }).toBe('failed');
  const failed = await page.request.get(`${reportsAPI}/${report.id}`);
  expect(failed.ok()).toBeTruthy();
  const keys = collectKeys(await failed.json());
  for (const sensitiveKey of ['access_token', 'raw_payload', 'authorization', 'tenant_id']) {
    expect(keys.has(sensitiveKey)).toBeFalsy();
  }
});

test('[UI-CA-REPORT-002] expired report result returns explicit expired state @brand-fleet @errors', async ({ page }) => {
  test.skip(process.env.E2E_RESULT_EXPIRED !== 'true', 'run with E2E_RESULT_EXPIRED=true');
  await login(page, 'developer');
  const response = await page.request.post(reportsAPI, {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-report-expired-${Date.now()}` },
    data: { name: 'Expired report', report_type: 'fleet_status', dimensions: ['status'], timezone: 'UTC', format: 'json', scope: {} },
  });
  expect(response.status()).toBe(202);
  const report = (await response.json()).report;
  await expect.poll(async () => (await page.request.get(`${reportsAPI}/${report.id}`)).status()).toBe(410);
  const result = await page.request.get(`${reportsAPI}/${report.id}`);
  expect((await result.json()).code).toBe('RESULT_EXPIRED');
});
