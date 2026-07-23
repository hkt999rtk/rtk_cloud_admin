import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-REPORT-001] report failure is customer-safe when upstream is unavailable @brand-fleet @errors', async ({ page }) => {
  test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/reports');
  const response = await page.request.post('/api/reports', {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-report-failure-${Date.now()}` },
    data: { name: 'Unavailable report', report_type: 'fleet_status', dimensions: ['status'], timezone: 'UTC', format: 'json', scope: {} },
  });
  expect(response.status()).toBe(202);
  const report = (await response.json()).report;
  await expect.poll(async () => {
    const result = await page.request.get(`/api/reports/${report.id}`);
    if (!result.ok()) return 'unavailable';
    return (await result.json()).report?.state || 'unknown';
  }).toBe('failed');
  const failed = await page.request.get(`/api/reports/${report.id}`);
  expect(failed.ok()).toBeTruthy();
  expect(JSON.stringify(await failed.json())).not.toMatch(/access_token|raw_payload|authorization|tenant_id/i);
});

test('[UI-CA-REPORT-002] expired report result returns explicit expired state @brand-fleet @errors', async ({ page }) => {
  test.skip(process.env.E2E_RESULT_EXPIRED !== 'true', 'run with E2E_RESULT_EXPIRED=true');
  await login(page, 'developer');
  const response = await page.request.post('/api/reports', {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-report-expired-${Date.now()}` },
    data: { name: 'Expired report', report_type: 'fleet_status', dimensions: ['status'], timezone: 'UTC', format: 'json', scope: {} },
  });
  expect(response.status()).toBe(202);
  const report = (await response.json()).report;
  await expect.poll(async () => (await page.request.get(`/api/reports/${report.id}`)).status()).toBe(410);
  const result = await page.request.get(`/api/reports/${report.id}`);
  expect((await result.json()).code).toBe('RESULT_EXPIRED');
});
