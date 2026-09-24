import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { customerNavItems, platformNavItems } from '../src/routes.mjs';

test('[UI-CA-I18N-001] language switch keeps form state and survives reload @smoke', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('developer@example.com');
  await page.locator('[data-locale-selector]').selectOption('zh-TW');
  await expect(page.getByRole('heading', { name: '登入 Connect+', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('登入 Connect+');
  await expect(page.locator('input[type=email]')).toHaveValue('developer@example.com');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await page.reload();
  await expect(page.locator('[data-locale-selector]')).toHaveValue('zh-TW');
  await page.locator('[data-locale-selector]').selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('heading', { name: '登录 Connect+', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('登录 Connect+');
  await page.goto('/forgot-password');
  await expect(page).toHaveTitle('忘记密码 · RTK Cloud');
});

test('[UI-CA-I18N-002] documentation search, articles and anchors follow the chosen language @smoke', async ({ page, isMobile }) => {
  await login(page, 'developer');
  await page.goto('/console/developer-docs');
  for (const locale of ['en', 'zh-TW', 'zh-CN']) {
    if (isMobile) await page.getByRole('button', { name: /Open navigation|開啟導覽|打开导航/ }).click();
    await page.locator('[data-locale-selector]').selectOption(locale);
    if (isMobile) await page.locator('.mobile-nav-close').click();
    const response = await page.request.get(`/assets/developer-docs/index.${locale}.json`);
    expect(response.ok()).toBeTruthy();
    const index = await response.json();
    expect(index.pages).toHaveLength(27);
    await expect(page.locator('.docs-results article')).toHaveCount(27);
    await page.getByRole('searchbox').fill('MQTT');
    await expect(page.locator('.docs-results article').first()).toBeVisible();
    if (isMobile) await expect(page.locator('.docs-mobile-chapters')).toBeVisible();
    await page.getByRole('searchbox').fill('');
  }
  await page.goto('/console/developer-docs/api-examples#field-presence-and-units');
  await expect(page.locator('#field-presence-and-units')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: /Open navigation|開啟導覽|打开导航/ }).click();
  await page.locator('[data-locale-selector]').selectOption('zh-TW');
  if (isMobile) await page.locator('.mobile-nav-close').click();
  await expect(page.locator('#field-presence-and-units')).toBeVisible();
  await expect(page).toHaveURL(/#field-presence-and-units$/);
  await page.goto('/assets/developer-docs/assets/mqtt-exchange.zh-TW.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.getByText('RTK CLOUD · 時序圖')).toBeVisible();
});

test('[UI-CA-I18N-003] API adds localized system copy while retaining English', async ({ page }) => {
  await login(page, 'platform_admin');
  await page.goto('/admin/grafana');
  await page.locator('[data-locale-selector]').selectOption('zh-TW');
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/admin/grafana/status');
    return { ok: result.ok, language: result.headers.get('Content-Language'), body: await result.json(), cookie: document.cookie };
  });
  expect(response.ok).toBeTruthy();
  expect(response.language, response.cookie).toBe('zh-TW');
  const body = response.body;
  expect(body.source_message).toBe('Grafana is not configured.');
  expect(body.source_message_localized).toBeTruthy();
  expect(body.source_message_localized).not.toBe(body.source_message);
});

test('[UI-CA-I18N-004] every current customer and platform route renders in all locales @smoke', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  const cloudId = '33333333-3333-4333-8333-333333333333';
  const customerPaths = customerNavItems.map(item => item.path || `/console/clouds/${cloudId}${item.segment ? `/${item.segment}` : ''}`);
  const platformPaths = platformNavItems.map(item => item.path);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [role, paths] of [['customer', customerPaths], ['platform_admin', platformPaths]]) {
    await login(page, role);
    await page.goto(paths[0]);
    for (const [locale, htmlLang] of [['en', 'en'], ['zh-TW', 'zh-Hant'], ['zh-CN', 'zh-Hans']]) {
      if (isMobile) await page.getByRole('button', { name: /Open navigation|開啟導覽|打开导航/ }).click();
      await page.locator('[data-locale-selector]').selectOption(locale);
      if (isMobile) await page.locator('.mobile-nav-close').click();
      for (const path of paths) {
        await page.goto(path);
        await expect.soft(page.locator('html'), `${role} ${locale} ${path}`).toHaveAttribute('lang', htmlLang);
        await expect.soft(page.locator('[data-locale-selector]'), `${role} ${locale} ${path}`).toHaveValue(locale);
        await expect.soft(page.locator('#root'), `${role} ${locale} ${path}`).not.toBeEmpty();
        if (path === '/console/clouds') {
          const title = { en: 'My Clouds', 'zh-TW': '我的雲端', 'zh-CN': '我的云端' }[locale];
          await expect.soft(page).toHaveTitle(`${title} · RTK Cloud`);
        }
      }
    }
  }
  expect(errors).toEqual([]);
});

test('[UI-CA-I18N-005] public account pages and scoped subpages retain locale @smoke', async ({ page, isMobile }) => {
  const publicPaths = [
    '/login', '/login/check-email', '/login/activate', '/forgot-password', '/reset-password',
    '/signup', '/signup/check-email', '/signup/verification-expired', '/verify',
  ];
  const cloudId = '33333333-3333-4333-8333-333333333333';
  const scopedPaths = [
    `/console/clouds/${cloudId}/fleet/groups`,
    `/console/clouds/${cloudId}/fleet/jobs`,
    `/console/clouds/${cloudId}/analytics/reports`,
    `/console/clouds/${cloudId}/billing/pricing`,
    `/console/clouds/${cloudId}/products`,
  ];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [locale, htmlLang] of [['en', 'en'], ['zh-TW', 'zh-Hant'], ['zh-CN', 'zh-Hans']]) {
    await page.goto('/login');
    await page.locator('[data-locale-selector]').selectOption(locale);
    for (const path of publicPaths) {
      await page.goto(path);
      await expect.soft(page.locator('html'), `${locale} ${path}`).toHaveAttribute('lang', htmlLang);
      await expect.soft(page.locator('#root'), `${locale} ${path}`).not.toBeEmpty();
    }
    await login(page, 'customer');
    for (const path of scopedPaths) {
      await page.goto(path);
      await expect.soft(page.locator('html'), `${locale} ${path}`).toHaveAttribute('lang', htmlLang);
      await expect.soft(page.locator('#root'), `${locale} ${path}`).not.toBeEmpty();
    }
  }
  expect(errors).toEqual([]);
});
