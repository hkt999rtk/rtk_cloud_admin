import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { assertDownloadResult, waitForJob } from './fixtures/brand-fleet.mjs';

test.describe('Brandname provisioning failure paths', () => {
  test('[UI-CA-PROV-001] invalid device validation is immutable and cannot execute @brand-fleet @full', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/provisioning');
    const response = await page.request.post('/api/provisioning/validate', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-invalid-validation-${Date.now()}` },
      data: { sku_id: 'sku-alpha', production_run: 'run-invalid', device_ids: ['dev-does-not-exist'] },
    });
    expect(response.status()).toBe(202);
    const validation = (await response.json()).validation_job;
    await waitForJob(page, validation.id, ['failed']);
    const detail = await page.request.get(`/api/jobs/${validation.id}`);
    const job = (await detail.json()).job;
    expect(job.scope.scope_hash).toMatch(/^sha256:/);
    expect(job.scope.validation.valid).toBe(false);
    const execution = await page.request.post('/api/provisioning/jobs', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-invalid-execution-${Date.now()}` },
      data: { validation_job_id: validation.id },
    });
    expect(execution.status()).toBe(409);
  });

  test('[UI-CA-PROV-002] CSV upload replay does not create a duplicate source and conflicting replay is rejected @brand-fleet @full', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/provisioning');
    const headers = { 'Idempotency-Key': 'e2e-source-replay' };
    const multipart = { sku_id: 'sku-alpha', production_run: 'run-replay', file: { name: 'devices.csv', mimeType: 'text/csv', buffer: Buffer.from('device_id\ndev-e2e-001\n') } };
    const first = await page.request.post('/api/provisioning/sources', { headers, multipart });
    expect(first.status()).toBe(201);
    const replay = await page.request.post('/api/provisioning/sources', { headers, multipart });
    expect(replay.status()).toBe(201);
    expect((await replay.json()).idempotent_replay).toBeTruthy();
    const conflict = await page.request.post('/api/provisioning/sources', { headers, multipart: { ...multipart, sku_id: 'sku-other' } });
    expect(conflict.status()).toBe(409);
  });

  test('[UI-CA-PROV-003] observer cannot start provisioning from the browser or API @brand-fleet @full', async ({ page }) => {
    await login(page, 'observer');
    await page.goto('/console/brand-e2e-01/provisioning');
    await expect(page.getByText('沒有 provisioning 權限')).toBeVisible();
    const response = await page.request.post('/api/provisioning/sources', { headers: { 'Idempotency-Key': 'e2e-observer-source' }, multipart: { sku_id: 'sku-alpha', file: { name: 'devices.csv', mimeType: 'text/csv', buffer: Buffer.from('device_id\ndev-e2e-001\n') } } });
    expect(response.status()).toBe(403);
  });
});
