import { expect, test } from '@playwright/test';

test('[UI-CA-AUTH-VIEW-001] dual-role account changes views and Brand Cloud without logging in again', async ({ page }) => {
  const loginRequests = [];
  const activeOrgWrites = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname.startsWith('/api/auth/') && pathname.endsWith('/login')) {
      loginRequests.push(pathname);
    }
    if (pathname === '/api/me/active-org' && request.method() !== 'GET') activeOrgWrites.push(pathname);
  });
  await page.goto('/login?next=%2Fadmin%3Ftab%3Dhealth%23status');
  await page.getByLabel('Email').fill('identity.dual@example.com');
  await page.getByLabel('Password').fill('e2e-identity-dual-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?tab=health#status$/);
  await expect(page.getByRole('heading', { name: 'Platform Home', exact: true })).toBeVisible();
  const originalCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'rtk_admin_session');
  expect(originalCookie).toBeTruthy();

  await Promise.all([
    page.waitForURL(/\/console\/clouds$/),
    page.getByRole('button', { name: 'Brand Cloud view', exact: true }).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('button', { name: 'Platform view', exact: true })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/console\/clouds\/33333333-3333-4333-8333-333333333333$/),
    page.getByRole('heading', { name: 'E2E Alpha Cloud' }).getByRole('link').click(),
  ]);
  const selector = page.getByLabel('Brand Cloud', { exact: true });
  await Promise.all([
    page.waitForURL(/\/console\/clouds\/44444444-4444-4444-8444-444444444444$/),
    selector.selectOption('44444444-4444-4444-8444-444444444444'),
  ]);

  await Promise.all([
    page.waitForURL(/\/admin$/),
    page.getByRole('button', { name: 'Platform view', exact: true }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Platform Home', exact: true })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/console\/clouds$/),
    page.getByRole('button', { name: 'Brand Cloud view', exact: true }).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.topbar-title').getByRole('heading', { name: 'My Clouds', exact: true })).toBeVisible();

  const profile = await (await page.request.get('/api/me')).json();
  expect(profile.user_id).toBe('identity-dual-user');
  expect(profile.kind).toBe('customer');
  expect((await page.context().cookies()).find((cookie) => cookie.name === 'rtk_admin_session')?.value).toBe(originalCookie.value);
  expect(loginRequests).toEqual(['/api/auth/login']);
  expect(activeOrgWrites).toEqual([]);
});
