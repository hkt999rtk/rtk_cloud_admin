import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-TEAM-001] developer team management uses developer namespace and is replay-safe @brand-fleet', async ({ page }, testInfo) => {
  const cloud = '99999999-9999-4999-8999-999999999999';
  const product = '33333333-3333-4333-8333-333333333333';
  const email = `new-observer-${testInfo.retry}@example.com`;
  await login(page, 'developer');
  await page.goto(`/console/clouds/${cloud}/members`);
  await expect(page.getByRole('heading', { name: 'Members and sharing' }).first()).toBeVisible();
  const endpoint = `/api/developer/brand-clouds/${cloud}/members/invitations`;
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-member-invite-${testInfo.retry}` };
  const invitationBody = { email, role: 'viewer', access_scope: { kind: 'selected_products', product_ids: [product] } };
  const invite = await page.request.post(endpoint, { headers, data: invitationBody });
  expect(invite.status()).toBe(202);
  const inviteBody = await invite.json();
  expect(inviteBody.invitation).toMatchObject({
    target_email: email,
    role: 'viewer',
    access_scope: { kind: 'selected_products', product_ids: [product] },
    status: 'pending',
  });
  const replay = await page.request.post(endpoint, { headers, data: invitationBody });
  expect(replay.status()).toBe(202);
  const replayBody = await replay.json();
  expect(replayBody.invitation.id).toBe(inviteBody.invitation.id);
  const invitations = await page.request.get(endpoint);
  expect(invitations.ok()).toBeTruthy();
  expect((await invitations.json()).invitations).toContainEqual(expect.objectContaining({
    id: inviteBody.invitation.id,
    target_email: email,
    role: 'viewer',
    access_scope: { kind: 'selected_products', product_ids: [product] },
    status: 'pending',
  }));
  const members = await page.request.get(`/api/developer/brand-clouds/${cloud}/members`);
  expect((await members.json()).members.some((member) => member.email === email)).toBeFalsy();
});
