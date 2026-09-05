import { expect, test } from '@playwright/test';

test('[UI-CA-AUTH-003] failed login renders its error once', async ({ page }) => {
  const loginRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname.startsWith('/api/auth/') && pathname.endsWith('/login')) {
      loginRequests.push(pathname);
    }
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByText('Email or password is incorrect.')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect(loginRequests).toEqual(['/api/auth/login']);
});
