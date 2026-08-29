import { test, expect } from '@playwright/test';
import { expectPageTitle, login } from './fixtures/session.mjs';
import { assertServerScope, waitForJob } from './fixtures/brand-fleet.mjs';

test.describe('Brandname async workflows', () => {
  test('[UI-CA-REPORT-003] report builder submits complete metadata from the browser @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/reports');
    await page.getByLabel('Report Name').fill('Browser report');
    await page.getByLabel('Report Type').selectOption('firmware_coverage');
    await page.getByLabel('Output Format').selectOption('csv');
    await page.getByLabel('Timezone').selectOption('UTC');
    await page.getByPlaceholder('Area').fill('na');
    const createResponse = page.waitForResponse((response) => response.url().includes('/api/reports') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create Report' }).click();
    expect((await createResponse).status()).toBe(202);
  });

  test('[UI-CA-OTA-001] OTA scope preview is server calculated and immutable @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/firmware-ota');
    await expectPageTitle(page, 'Firmware Update');
    const preview = await page.request.post('/api/update-plans/scope-preview', {
      headers: { 'Content-Type': 'application/json' },
      data: { product_id: 'product-alpha', query: { region: ['na'], firmware: ['v3.8.0'] }, excluded_device_ids: ['dev-e2e-001'] },
    });
    const scopeBody = await assertServerScope(preview, ['scope_hash', 'target_count']);
    expect(scopeBody.scope.excluded_device_ids).toEqual(['dev-e2e-001']);
    expect(scopeBody.scope.query.region).toEqual(['na']);

    const plan = await page.request.post('/api/update-plans', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-ota-plan-1' },
      data: { product_id: 'product-alpha', release_id: 'release-e2e-1', name: 'E2E OTA plan', scope: scopeBody.scope },
    });
    expect([201, 202]).toContain(plan.status());
    const tampered = { ...scopeBody.scope, target_count: 999999 };
    const rejected = await page.request.post('/api/update-plans', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-ota-plan-tampered' },
      data: { product_id: 'product-alpha', release_id: 'release-e2e-1', name: 'tampered', scope: tampered },
    });
    expect(rejected.status()).toBe(409);
  });

  test('[UI-CA-OTA-002] firmware page shows upgrade progress and device results @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    await page.route('**/api/fleet/firmware-distribution?*', async (route) => {
      await route.fulfill({ json: {
        source_status: 'available',
        versions: [{ version: 'v1.2.4', count: 2, pct: 100, is_latest: true }],
        campaigns: [{
          campaign_id: 'upgrade-e2e-1', target_version: 'v1.2.4', policy: 'normal', state: 'completed',
          applied: 1, pending: 0, failed: 1, skipped: 0, total: 2,
          started_at: '2026-08-28T01:00:00Z', updated_at: '2026-08-28T01:05:00Z',
          rollouts: [
            { device_id: 'dev-ok', device_name: 'Camera OK', current_version: 'v1.2.4', target_version: 'v1.2.4', rollout_status: 'applied', last_updated: '2026-08-28T01:04:00Z' },
            { device_id: 'dev-failed', device_name: 'Camera Failed', current_version: 'v1.2.3', target_version: 'v1.2.4', rollout_status: 'failed', failure_reason: 'checksum mismatch', last_updated: '2026-08-28T01:05:00Z' },
          ],
        }],
      } });
    });
    await page.goto('/console/brand-e2e-01/firmware-ota?product_id=product-alpha');
    await expect(page.getByRole('heading', { name: 'Firmware update status' })).toBeVisible();
    await expect(page.getByText('upgrade-e2e-1').first()).toBeVisible();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Camera Failed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Update failed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('checksum mismatch')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry failed device' })).toBeVisible();
  });

  test('[UI-CA-REPORT-004] reports preserve scope metadata and expose async result download @brand-fleet', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/reports');
    await expect(page.getByRole('heading', { name: 'Reports' }).first()).toBeVisible();
    await expect(page.getByLabel('Report Type').locator('option[value="batch_jobs"]')).toHaveCount(0);
    const response = await page.request.post('/api/reports', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-report-1' },
      data: { name: 'E2E fleet report', report_type: 'fleet_status', dimensions: ['product', 'region'], timezone: 'Asia/Taipei', format: 'json', scope: { query: { region: ['na'] } } },
    });
    expect(response.status()).toBe(202);
    const job = (await response.json()).report;
    await waitForJob(page, job.id);
    const result = await page.request.get(`/api/reports/${encodeURIComponent(job.id)}`);
    expect(result.ok()).toBeTruthy();
    const csv = await page.request.get(`/api/reports/${encodeURIComponent(job.id)}?format=csv`);
    expect(csv.ok()).toBeTruthy();
    expect(csv.headers()['content-type']).toContain('text/csv');
  });

  test('[UI-CA-REPORT-005] report idempotency replay and conflict preserve the original scope @brand-fleet @full', async ({ page }) => {
    await login(page, 'developer');
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-report-replay-${Date.now()}` };
    const data = { name: 'Replay report', report_type: 'firmware_coverage', dimensions: ['firmware', 'status'], timezone: 'UTC', format: 'json', scope: { query: { region: ['na'] } } };
    const first = await page.request.post('/api/reports', { headers, data });
    expect(first.status()).toBe(202);
    const replay = await page.request.post('/api/reports', { headers, data });
    expect(replay.status()).toBe(202);
    expect((await replay.json()).idempotent_replay).toBeTruthy();
    const conflict = await page.request.post('/api/reports', { headers, data: { ...data, scope: { query: { region: ['eu'] } } } });
    expect(conflict.status()).toBe(409);
  });

});
