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
    await expectPageTitle(page, 'Firmware OTA');
    const preview = await page.request.post('/api/update-plans/scope-preview', {
      headers: { 'Content-Type': 'application/json' },
      data: { product_id: 'product-alpha', query: { region: ['na'], firmware: ['v3.8.0'] }, excluded_device_ids: ['dev-e2e-001'] },
    });
    const scopeBody = await assertServerScope(preview, ['scope_hash', 'target_count']);
    expect(scopeBody.scope.excluded_device_ids).toEqual(['dev-e2e-001']);
    expect(scopeBody.scope.query.region).toEqual(['na']);

    const plan = await page.request.post('/api/update-plans', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-ota-plan-1' },
      data: { product_id: 'product-alpha', release_id: 'release-e2e-1', name: 'E2E OTA plan', scope: scopeBody.scope, rate_limit_per_minute: 100 },
    });
    expect([201, 202]).toContain(plan.status());
    const tampered = { ...scopeBody.scope, target_count: 999999 };
    const rejected = await page.request.post('/api/update-plans', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-ota-plan-tampered' },
      data: { product_id: 'product-alpha', release_id: 'release-e2e-1', name: 'tampered', scope: tampered, rate_limit_per_minute: 100 },
    });
    expect(rejected.status()).toBe(409);
  });

  test('[UI-CA-OTA-002] firmware page shows upgrade progress and device results @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    const requestedActions = [];
    await page.route('**/api/update-plans/*/*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      requestedActions.push(new URL(route.request().url()).pathname);
      return route.fulfill({ json: { update_plan: { state: 'accepted' } } });
    });
    await page.route('**/api/fleet/firmware-distribution?*', async (route) => {
      await route.fulfill({ json: {
        source_status: 'available',
        versions: [{ version: 'v1.2.4', count: 2, pct: 100, is_latest: true }],
        campaigns: [{
          campaign_id: 'upgrade-newest', target_version: 'v1.2.4', policy: 'normal', state: 'active',
          applied: 5, pending: 3, failed: 1, skipped: 1, total: 10,
          started_at: '2026-08-29T01:00:00Z', updated_at: '2026-08-29T01:05:00Z',
          rollouts: [
            { device_id: 'dev-ok', device_name: 'Camera OK', current_version: 'v1.2.4', target_version: 'v1.2.4', rollout_status: 'applied', last_updated: '2026-08-28T01:04:00Z' },
            { device_id: 'dev-failed', device_name: 'Camera Failed', current_version: 'v1.2.3', target_version: 'v1.2.4', rollout_status: 'failed', failure_reason: 'checksum mismatch', last_updated: '2026-08-28T01:05:00Z' },
          ],
        }, {
          campaign_id: 'upgrade-older', target_version: 'v1.2.3', policy: 'normal', state: 'paused',
          applied: 0, pending: 4, failed: 0, skipped: 0, total: 4,
          started_at: '2026-08-28T01:00:00Z', updated_at: '2026-08-28T01:05:00Z', rollouts: [],
        }],
      } });
    });
    await page.goto('/console/brand-e2e-01/firmware-ota?product_id=product-alpha');
    await expect(page.getByRole('heading', { name: 'OTA Dashboard' })).toBeVisible();
    const dashboardRows = page.locator('.ota-dashboard-row');
    await expect(dashboardRows).toHaveCount(2);
    await expect(dashboardRows.nth(0)).toContainText('upgrade-newest');
    await expect(dashboardRows.nth(1)).toContainText('upgrade-older');
    await expect(dashboardRows.nth(0)).toContainText('3 / 10');
    await expect(dashboardRows.nth(0).getByRole('progressbar', { name: 'Waiting devices for upgrade-newest' })).toHaveAttribute('aria-valuenow', '3');
    await expect(dashboardRows.nth(0).getByRole('progressbar', { name: 'Waiting devices for upgrade-newest' })).toHaveAttribute('aria-valuemax', '10');
    await expect(page.getByText('Updating', { exact: true }).first()).toBeVisible();
    await dashboardRows.nth(0).getByRole('button', { name: 'Stop OTA' }).click();
    await dashboardRows.nth(1).getByRole('button', { name: 'Start OTA' }).click();
    await expect.poll(() => requestedActions).toEqual(['/api/update-plans/upgrade-newest/pause', '/api/update-plans/upgrade-older/resume']);
    await expect(page.getByText('Camera Failed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Update failed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('checksum mismatch')).toBeVisible();
  });

  test('[UI-CA-OTA-003] firmware binary calculates release metadata before upload @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    const firmware = Buffer.from('firmware-v1');
    let releasePayload;
    const productsResponse = await page.request.get('/api/products');
    expect(productsResponse.ok()).toBeTruthy();
    const productsPayload = await productsResponse.json();
    await page.route('**/api/products/product-alpha/releases', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      releasePayload = route.request().postDataJSON();
      return route.fulfill({ json: { release: { release_id: 'release-browser-1' } } });
    });
    await page.route('**/api/products**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET' || url.pathname !== '/api/products') return route.fallback();
      return route.fulfill({
        json: {
          ...productsPayload,
          products: productsPayload.products.map((product) => product.id === 'product-alpha'
            ? { ...product, allowed_actions: [...new Set([...(product.allowed_actions || []), 'manage_updates'])] }
            : product),
        },
      });
    });
    await page.goto('/console/brand-e2e-01/firmware-ota?product_id=product-alpha');

    await expect(page.getByRole('button', { name: 'Firmware OTA' })).toBeVisible();
    await expect(page.getByPlaceholder('Build number')).toHaveCount(0);
    await expect(page.getByPlaceholder('File size (required if no file is selected)')).toHaveCount(0);
    await expect(page.getByText('Signature settings (advanced)')).toHaveCount(0);

    await page.getByPlaceholder('Version, e.g. 1.4.3').fill('1.4.3');
    await page.getByPlaceholder('Hardware versions (comma separated)').fill('rev-a');
    await page.getByLabel('Firmware binary').setInputFiles({ name: 'camera.bin', mimeType: 'application/octet-stream', buffer: firmware });
    const metadata = page.getByLabel('Firmware binary metadata');
    await expect(metadata).toContainText('camera.bin');
    await expect(metadata).toContainText(`${firmware.length} bytes`);
    await expect(metadata.getByText(/^[a-f0-9]{64}$/)).toBeVisible();

    await page.getByRole('button', { name: 'Create version' }).click();
    await expect.poll(() => releasePayload).toBeTruthy();
    expect(releasePayload).toMatchObject({
      version: '1.4.3',
      artifact_size: firmware.length,
      hardware_revisions: ['rev-a'],
      content_type: 'application/octet-stream',
      anti_rollback_counter: 0,
    });
    expect(releasePayload.artifact_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(releasePayload.build_number).toBe(releasePayload.artifact_sha256);
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
