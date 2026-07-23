import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { waitForJob } from './fixtures/brand-fleet.mjs';

test('batch job uses server scope, idempotency and result lifecycle @brand-fleet', async ({ page }) => {
  await login(page, 'operations');
  await page.goto('/console/brand-e2e-01/jobs');
  await expect(page.getByRole('heading', { name: '批次工作' }).first()).toBeVisible();
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-batch-job-1' };
  const payload = { type: 'device_settings', name: 'E2E device settings', scope: { query: { region: ['na'] }, excluded_device_ids: [] } };
  const created = await page.request.post('/api/jobs', { headers, data: payload });
  expect(created.status()).toBe(202);
  const job = (await created.json()).job;
  expect(job.scope.scope_hash).toMatch(/^sha256:/);
  expect(job.scope.estimated_total).toBeGreaterThanOrEqual(0);
  const pause = await page.request.post(`/api/jobs/${encodeURIComponent(job.id)}/pause`, { headers: { 'Idempotency-Key': 'e2e-batch-job-pause-1' } });
  expect(pause.status()).toBe(202);
  const replay = await page.request.post('/api/jobs', { headers, data: payload });
  expect(replay.status()).toBe(202);
  expect((await replay.json()).idempotent_replay).toBeTruthy();
  await waitForJob(page, job.id);
  const result = await page.request.get(`/api/jobs/${encodeURIComponent(job.id)}/result`);
  expect(result.ok()).toBeTruthy();
});
