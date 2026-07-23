import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { assertAsyncJobProgress, assertDownloadResult, waitForJob, waitForJobState } from './fixtures/brand-fleet.mjs';

async function createBatch(page, key, scope = { device_ids: ['dev-e2e-001', 'dev-e2e-003'], query: {}, excluded_device_ids: [] }) {
  const response = await page.request.post('/api/jobs', {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    data: { type: 'device_settings', name: `E2E ${key}`, scope },
  });
  expect(response.status()).toBe(202);
  return (await response.json()).job;
}

test.describe('Brandname job lifecycle', () => {
  test('[UI-CA-BATCH-001] partial failure keeps per-item results and creates a new retry attempt @brand-fleet @full', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'partial_failure', 'run with E2E_SCENARIO_MODE=partial_failure');
    await login(page, 'operations');
    await page.goto('/console/brand-e2e-01/jobs');
    const job = await createBatch(page, `e2e-partial-${Date.now()}`);
    await waitForJob(page, job.id, ['partial_failed']);
    const failed = await page.request.get(`/api/jobs/${job.id}/result`);
    expect(failed.ok()).toBeTruthy();
    const result = await failed.json();
    expect(result.items.some((item) => item.status === 'failed' && item.retryable)).toBeTruthy();
    const retry = await page.request.post(`/api/jobs/${job.id}/retry`, { headers: { 'Idempotency-Key': `e2e-retry-${job.id}` } });
    expect(retry.status()).toBe(202);
    const retryJob = (await retry.json()).job;
    expect(retryJob.id).not.toBe(job.id);
    expect(retryJob.scope.retry_of).toBe(job.id);
    expect(retryJob.scope.attempt).toBeGreaterThan(1);
  });

  test('[UI-CA-BATCH-002] pause, resume and cancel are valid state transitions @brand-fleet @full', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'slow', 'run with E2E_SCENARIO_MODE=slow');
    await login(page, 'operations');
    await page.goto('/console/brand-e2e-01/jobs');
    const job = await createBatch(page, `e2e-transition-${Date.now()}`);
    const pause = await page.request.post(`/api/jobs/${job.id}/pause`, { headers: { 'Idempotency-Key': `pause-${job.id}` } });
    expect([202, 409]).toContain(pause.status());
    if (pause.ok()) {
      await assertAsyncJobProgress(page, job.id, 'paused');
      const resume = await page.request.post(`/api/jobs/${job.id}/resume`, { headers: { 'Idempotency-Key': `resume-${job.id}` } });
      expect(resume.status()).toBe(202);
      await waitForJob(page, job.id);
    }
    const cancelJob = await createBatch(page, `e2e-cancel-${Date.now()}`);
    const cancel = await page.request.post(`/api/jobs/${cancelJob.id}/cancel`, { headers: { 'Idempotency-Key': `cancel-${cancelJob.id}` } });
    expect([202, 409]).toContain(cancel.status());
    if (cancel.ok()) await assertAsyncJobProgress(page, cancelJob.id, 'cancelled');
  });

  test('[UI-CA-BATCH-003] completed result supports JSON and CSV download @brand-fleet @full', async ({ page }) => {
    await login(page, 'operations');
    const job = await createBatch(page, `e2e-download-${Date.now()}`, { query: { region: ['na'] }, excluded_device_ids: [] });
    await waitForJob(page, job.id);
    await assertDownloadResult(await page.request.get(`/api/jobs/${job.id}/result`), 'application/json');
    await assertDownloadResult(await page.request.get(`/api/jobs/${job.id}/result?format=csv`), 'text/csv');
  });
});
