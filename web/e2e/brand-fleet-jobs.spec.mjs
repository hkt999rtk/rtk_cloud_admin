import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { waitForJob } from './fixtures/brand-fleet.mjs';

test('[UI-CA-JOBS-001] batch job uses server scope, idempotency and result lifecycle @brand-fleet', async ({ page }, testInfo) => {
  await login(page, 'operations');
  const attemptKey = `e2e-batch-job-${Date.now()}-${testInfo.retry}`;
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': attemptKey };
  const payload = { type: 'device_settings', name: 'E2E device settings', scope: { query: { region: ['na'] }, excluded_device_ids: [] } };
  const created = await page.request.post('/api/jobs', { headers, data: payload });
  expect(created.status()).toBe(202);
  const job = (await created.json()).job;
  expect(job.scope.scope_hash).toMatch(/^sha256:/);
  expect(job.scope.estimated_total).toBeGreaterThanOrEqual(0);
  const pause = await page.request.post(`/api/jobs/${encodeURIComponent(job.id)}/pause`, { headers: { 'Idempotency-Key': `pause-${job.id}` } });
  expect(pause.status()).toBe(202);
  expect((await pause.json()).job.id).toBe(job.id);
  const replay = await page.request.post('/api/jobs', { headers, data: payload });
  expect(replay.status()).toBe(202);
  expect((await replay.json()).idempotent_replay).toBeTruthy();
  const current = await page.request.get(`/api/jobs/${encodeURIComponent(job.id)}`);
  expect(current.ok()).toBeTruthy();
  if ((await current.json()).job.state === 'paused') {
    const resume = await page.request.post(`/api/jobs/${encodeURIComponent(job.id)}/resume`, { headers: { 'Idempotency-Key': `resume-${job.id}` } });
    expect(resume.status()).toBe(202);
  }
  await waitForJob(page, job.id);
  const result = await page.request.get(`/api/jobs/${encodeURIComponent(job.id)}/result`);
  expect(result.ok()).toBeTruthy();
});
