import { expect } from '@playwright/test';

export async function assertCustomerSafeError(page, pattern) {
  await expect(page.getByText(pattern).first()).toBeVisible();
  await expect(page.getByText(/access_token|raw_payload|authorization|tenant_id/i)).toHaveCount(0);
}

export async function assertHTTPError(response, status, code) {
  expect(response.status()).toBe(status);
  const body = await response.json().catch(() => ({}));
  if (code) expect(body.code).toBe(code);
  expect(JSON.stringify(body)).not.toMatch(/access_token|raw_payload|authorization|tenant_id/i);
  return body;
}

export async function assertSourceState(page, state, text = '') {
  await expect(page.locator('body')).toContainText(new RegExp(state, 'i'));
  if (text) await expect(page.getByText(text, { exact: false })).toBeVisible();
}

export async function assertForbiddenRoute(page) {
  await expect(page.getByText(/capability|required|forbidden|權限/i).first()).toBeVisible();
}

export async function assertNoCrossCloudData(page, forbiddenText) {
  await expect(page.getByText(forbiddenText, { exact: true })).toHaveCount(0);
}

export async function assertNoClientControlledTotal(response, expectedTotal) {
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const job = body.job || body.report || body;
  expect(job.total).not.toBe(expectedTotal);
  expect(job.scope?.estimated_total ?? job.scope?.target_count ?? job.total).toBeDefined();
  return body;
}

export async function waitForJob(page, jobId, terminal = ['completed', 'partial_failed', 'failed', 'cancelled']) {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok()) return 'unavailable';
    return (await response.json()).job?.state || 'unknown';
  }, { timeout: 20_000, intervals: [250, 500, 1_000] }).toMatch(new RegExp(`^(?:${terminal.join('|')})$`));
}

export async function waitForJobState(page, jobId, states, timeout = 20_000) {
  const wanted = new Set(states);
  let observed = [];
  await expect.poll(async () => {
    const response = await page.request.get(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok()) return 'unavailable';
    const state = (await response.json()).job?.state || 'unknown';
    if (!observed.includes(state)) observed.push(state);
    return state;
  }, { timeout, intervals: [100, 250, 500] }).toMatch(new RegExp(`^(?:${[...wanted].join('|')})$`));
  return observed;
}

export async function assertAsyncJobProgress(page, jobId, expectedState) {
  const response = await page.request.get(`/api/jobs/${encodeURIComponent(jobId)}`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.job?.state).toBe(expectedState);
  expect(body.job?.completed).toBeGreaterThanOrEqual(0);
  expect(body.job?.failed).toBeGreaterThanOrEqual(0);
  expect(body.job?.skipped).toBeGreaterThanOrEqual(0);
  return body.job;
}

export async function assertDownloadResult(response, contentType) {
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toContain(contentType);
  const body = await response.body();
  expect(body.length).toBeGreaterThan(0);
  return body;
}

export async function assertServerScope(response, expectedKeys = ['scope_hash', 'target_count']) {
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  for (const key of expectedKeys) expect(body.scope?.[key] ?? body[key]).toBeTruthy();
  return body;
}
