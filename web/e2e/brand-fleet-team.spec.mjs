import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('developer team management uses developer namespace and is replay-safe @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/access');
  await expect(page.getByRole('heading', { name: '團隊與權限' }).first()).toBeVisible();
  const endpoint = '/api/developer/brand-clouds/brand-e2e-01/members/invitations';
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-member-invite-1' };
  const invite = await page.request.post(endpoint, { headers, data: { email: 'new-observer@example.com', role: 'Observer' } });
  expect([201, 202]).toContain(invite.status());
  const replay = await page.request.post(endpoint, { headers, data: { email: 'new-observer@example.com', role: 'Observer' } });
  expect([201, 202]).toContain(replay.status());
  const members = await page.request.get('/api/developer/brand-clouds/brand-e2e-01/members');
  expect(members.ok()).toBeTruthy();
  expect((await members.json()).members.some((member) => member.email === 'new-observer@example.com')).toBeTruthy();
  const transfer = await page.request.post('/api/developer/brand-clouds/brand-e2e-01/owner-transfer', { headers: { 'Idempotency-Key': 'e2e-transfer-1' }, data: { target_email: 'target@example.com' } });
  expect(transfer.status()).toBe(202);
  const transferBody = await transfer.json();
  const transferToken = 'owner-token-brand-e2e-01-target@example.com';
  const accepted = await page.request.post('/api/developer/brand-cloud-owner-transfers/accept', { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-transfer-accept-1' }, data: { token: transferToken } });
  expect(accepted.ok()).toBeTruthy();
  const replayAccept = await page.request.post('/api/developer/brand-cloud-owner-transfers/accept', { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-transfer-accept-2' }, data: { token: transferToken } });
  expect(replayAccept.status()).toBe(410);
  const canceled = await page.request.post(`/api/developer/brand-clouds/brand-e2e-01/owner-transfer/${transferBody.owner_transfer.id}/cancel`, { headers: { 'Idempotency-Key': 'e2e-transfer-cancel-1' } });
  expect([200, 409]).toContain(canceled.status());
});
