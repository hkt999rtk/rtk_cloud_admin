import { expect, test } from '@playwright/test';

import { loginWithStagingSession } from './fixtures/session.mjs';

test('[UI-CA-CHIPSET-STG-001] AmebaPro2 resources are published in staging @staging @chipset-sdk', async ({ page }, testInfo) => {
  await loginWithStagingSession(page, 'customer');
  await page.goto('/console/chipset-sdk');

  await expect(page.getByTestId('chipset-resource-page')).toBeVisible();
  const card = page.locator('.chipset-card').filter({ hasText: 'AmebaPRO2' });
  await expect(card.getByRole('heading', { name: 'AmebaPRO2' })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Products and Support' })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'SDK' })).toBeVisible();
  await expect(card).toContainText('RTL8735B');
  await expect(card).toContainText('2 SDK releases');
  await expect(card).toContainText('Ameba Arduino Pro2 · 4.1.0');
  await expect(card).toContainText('Ameba FreeRTOS Pro2 SDK · main');
  await expect(card).toContainText('AMB82 MINI');

  const productLink = card.getByRole('link', { name: /AmebaPro2 product and boards/ });
  await expect(productLink).toHaveAttribute('target', '_blank');
  await expect(productLink).toHaveAttribute('rel', /noopener/);
  await expect(productLink).toContainText('Official');
  await expect(productLink).toContainText('en');

  const search = page.getByRole('textbox', { name: 'Search ChipSets and SDKs' });
  for (const keyword of ['AMB82', 'RTL8735B', 'AmebaPRO2', 'forum', 'GitHub']) {
    await search.fill(keyword);
    await expect(card, `${keyword} should find AmebaPro2`).toBeVisible();
  }
  await search.fill('');

  await card.getByRole('link', { name: 'Explore board' }).click();
  await expect(page).toHaveURL(/\/console\/chipset-sdk\/[^/]+\/boards\/amb82-mini$/);
  await expect(page.getByRole('heading', { name: 'AMB82 MINI', exact: true })).toBeVisible();
  await expect(page.locator('.board-stage')).toHaveAttribute('data-viewer-status', 'ready', { timeout: 20000 });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'F37 camera & lens' }).click();
  await expect(page.locator('.board-part-description')).toContainText('capture images');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('link', { name: 'Open PRO2 Firmware Burner' })).toBeVisible();

  await testInfo.attach('amebapro2-staging-resource-hub', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
