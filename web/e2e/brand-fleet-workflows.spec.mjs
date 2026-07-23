import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { assertServerScope, waitForJob } from './fixtures/brand-fleet.mjs';

test.describe('Brandname async workflows', () => {
  test('[UI-CA-REPORT-003] report builder submits complete metadata from the browser @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/reports');
    await page.getByLabel('報表名稱').fill('Browser report');
    await page.getByLabel('報表類型').selectOption('firmware_coverage');
    await page.getByLabel('輸出格式').selectOption('csv');
    await page.getByLabel('Timezone').selectOption('UTC');
    await page.getByPlaceholder('區域').fill('na');
    const createResponse = page.waitForResponse((response) => response.url().includes('/api/reports') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '建立報表' }).click();
    expect((await createResponse).status()).toBe(202);
  });

  test('[UI-CA-PROV-004] provisioning CSV upload starts validation from the browser @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/provisioning');
    await page.getByPlaceholder('SKU ID').fill('sku-alpha');
    await page.getByPlaceholder('Production run（選填）').fill('run-browser');
    await page.getByLabel('設備清單 CSV').setInputFiles({ name: 'browser-devices.csv', mimeType: 'text/csv', buffer: Buffer.from('device_id\ndev-e2e-001\n') });
    await page.getByRole('button', { name: '開始驗證' }).click();
    await expect(page.getByText(/Immutable validation result|validation/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('[UI-CA-OTA-001] OTA scope preview is server calculated and immutable @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/firmware-ota');
    await expect(page.getByRole('heading', { name: '韌體更新' }).first()).toBeVisible();
    const preview = await page.request.post('/api/update-plans/scope-preview', {
      headers: { 'Content-Type': 'application/json' },
      data: { sku_id: 'sku-alpha', query: { region: ['na'], firmware: ['v3.8.0'] }, excluded_device_ids: ['dev-e2e-001'] },
    });
    const scopeBody = await assertServerScope(preview, ['scope_hash', 'target_count']);
    expect(scopeBody.scope.excluded_device_ids).toEqual(['dev-e2e-001']);
    expect(scopeBody.scope.query.region).toEqual(['na']);

    const plan = await page.request.post('/api/update-plans', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-ota-plan-1' },
      data: { sku_id: 'sku-alpha', release_id: 'release-e2e-1', name: 'E2E OTA plan', scope: scopeBody.scope },
    });
    expect([201, 202]).toContain(plan.status());
    const tampered = { ...scopeBody.scope, target_count: 999999 };
    const rejected = await page.request.post('/api/update-plans', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-ota-plan-tampered' },
      data: { sku_id: 'sku-alpha', release_id: 'release-e2e-1', name: 'tampered', scope: tampered },
    });
    expect(rejected.status()).toBe(409);
  });

  test('[UI-CA-REPORT-004] reports preserve scope metadata and expose async result download @brand-fleet', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/reports');
    await expect(page.getByRole('heading', { name: '報表' }).first()).toBeVisible();
    const response = await page.request.post('/api/reports', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-report-1' },
      data: { name: 'E2E fleet report', report_type: 'fleet_status', dimensions: ['sku', 'region'], timezone: 'Asia/Taipei', format: 'json', scope: { query: { region: ['na'] } } },
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

  test('[UI-CA-PROV-005] provisioning upload validates then creates execution job @brand-fleet', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/provisioning');
    await expect(page.getByRole('heading', { name: '設備註冊' }).first()).toBeVisible();
    const sourceResponse = await page.request.post('/api/provisioning/sources', {
      headers: { 'Idempotency-Key': 'e2e-source-1' },
      multipart: { sku_id: 'sku-alpha', production_run: 'run-e2e-1', file: { name: 'devices.csv', mimeType: 'text/csv', buffer: Buffer.from('device_id\ndev-e2e-001\ndev-e2e-003\n') } },
    });
    expect(sourceResponse.status()).toBe(201);
    const source = (await sourceResponse.json()).source;
    const validationResponse = await page.request.post('/api/provisioning/validate', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-validation-1' },
      data: { sku_id: 'sku-alpha', source_id: source.id },
    });
    expect(validationResponse.status()).toBe(202);
    const validation = (await validationResponse.json()).validation_job;
    await waitForJob(page, validation.id);
    const executionResponse = await page.request.post('/api/provisioning/jobs', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-execution-1' },
      data: { validation_job_id: validation.id },
    });
    expect(executionResponse.status()).toBe(202);
    const execution = (await executionResponse.json()).job;
    await waitForJob(page, execution.id);
    const result = await page.request.get(`/api/jobs/${encodeURIComponent(execution.id)}/result`);
    expect(result.ok()).toBeTruthy();
  });
});
