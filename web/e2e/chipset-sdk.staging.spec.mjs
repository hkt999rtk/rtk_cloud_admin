import { expect, test } from '@playwright/test';

import { loginWithStagingSession } from './fixtures/session.mjs';

test('[UI-CA-CHIPSET-STG-001] AmebaPro2 resources are published in staging @staging @chipset-sdk', async ({ page }, testInfo) => {
  await loginWithStagingSession(page, 'customer');
  await page.goto('/console/chipset-sdk');

  await expect(page.getByTestId('chipset-resource-page')).toBeVisible();
  const card = page.locator('.chipset-card').filter({ hasText: 'AmebaPro2' });
  await expect(card.getByRole('heading', { name: 'AmebaPro2' })).toBeVisible();
  await expect(card.getByRole('heading', { name: '產品與支援' })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'SDK' })).toBeVisible();
  await expect(card).toContainText('8 product resources');
  await expect(card).toContainText('2 SDK releases');
  await expect(card).toContainText('Ameba Arduino Pro2 · 4.1.0');
  await expect(card).toContainText('Ameba FreeRTOS Pro2 SDK · main');
  await expect(card).toContainText('AMB82 MINI');

  const productLink = card.getByRole('link', { name: /AmebaPro2 product and boards/ });
  await expect(productLink).toHaveAttribute('target', '_blank');
  await expect(productLink).toHaveAttribute('rel', /noopener/);
  await expect(productLink).toContainText('Official');
  await expect(productLink).toContainText('en');

  const search = page.getByPlaceholder('搜尋 ChipSet、vendor、SDK 或 supported model');
  for (const keyword of ['forum', 'YouTube', 'datasheet', 'GitHub']) {
    await search.fill(keyword);
    await expect(card, `${keyword} should find AmebaPro2`).toBeVisible();
  }
  await search.fill('');

  await testInfo.attach('amebapro2-staging-resource-hub', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
