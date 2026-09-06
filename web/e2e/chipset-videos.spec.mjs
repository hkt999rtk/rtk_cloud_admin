import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { login } from './fixtures/session.mjs';

const manifest = JSON.parse(await readFile(new URL('../public/assets/chipset-packages/realtek-amebapro2.json', import.meta.url), 'utf8'));
const chipset = { ...manifest.chipsets[0], id: 'video-provider-chipset', provider_name: 'Realtek Ameba IoT', stale: false };
const catalogURL = '/console/chipset-sdk';
const boardURL = `${catalogURL}/${chipset.id}/boards/amb82-mini`;
const thumbnail = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#d6e7eb"/><path d="M210 135 L290 180 L210 225Z" fill="#527580"/></svg>';
async function setup(page, records = [chipset]) {
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: thumbnail }));
  await page.route('**/api/developer/chipsets', route => route.fulfill({ json: { chipsets: records, source_status: 'available' } }));
  await login(page, 'developer');
}
const library = page => page.getByRole('region', { name: 'Development videos' });

test('[UI-CA-VIDEOS-001] SDK overview discovers board videos and expands a keyboard-accessible preview @chipset-sdk @smoke', async ({ page }, testInfo) => {
  await setup(page);
  await page.goto(catalogURL);
  await page.getByRole('textbox', { name: 'Search ChipSets and SDKs' }).fill('YOLOv7');
  await expect(library(page).locator('.chipset-video-card')).toHaveCount(3);
  const expand = library(page).getByRole('button', { name: 'View all 12 videos' });
  await expand.focus(); await page.keyboard.press('Enter');
  await expect(library(page).getByRole('button', { name: 'Show featured videos' })).toHaveAttribute('aria-expanded', 'true');
  await expect(library(page).locator('.chipset-video-card')).toHaveCount(12);
  await library(page).getByRole('searchbox', { name: 'Search videos' }).fill('Docker');
  await expect(library(page).locator('.chipset-video-card')).toHaveCount(2);
  await expect(page.locator('iframe')).toHaveCount(0);
  const link = library(page).getByRole('link', { name: 'Watch AMB82 Mini - Offline AI Model Conversion using Docker' });
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=YyorZoIlb_E');
  await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', /noopener/);
  await page.context().route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>YouTube test destination</title>' }));
  const popupPromise = page.waitForEvent('popup'); await link.focus(); await page.keyboard.press('Enter');
  const popup = await popupPromise; await expect(popup).toHaveURL('https://www.youtube.com/watch?v=YyorZoIlb_E'); await popup.close();
  await testInfo.attach('video-preview-filters', { body: await library(page).screenshot(), contentType: 'image/png' });
  await library(page).getByRole('button', { name: 'Show featured videos' }).click();
  await expect(library(page).locator('.chipset-video-card')).toHaveCount(3);
});

test('[UI-CA-VIDEOS-002] board video filters combine topics SDKs languages and queries @chipset-sdk @smoke', async ({ page }, testInfo) => {
  await setup(page); await page.goto(boardURL);
  const section = library(page);
  await expect(section.locator('.chipset-video-card')).toHaveCount(12);
  await expect(page.locator('.board-documents .chipset-resource-link').filter({ hasText: 'Docker' })).toHaveCount(0);
  await section.getByRole('combobox', { name: 'Topic', exact: true }).selectOption('model_conversion');
  await section.getByRole('combobox', { name: 'SDK', exact: true }).selectOption('arduino');
  await section.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-TW');
  await expect(section.locator('.chipset-video-card')).toHaveCount(1);
  await expect(section.getByRole('link', { name: 'Watch AMB82 Mini - Docker 離線AI模型轉換工具包' })).toBeVisible();
  await section.getByRole('searchbox', { name: 'Search videos' }).fill('no match');
  await expect(section.getByText('No matching videos.', { exact: false })).toBeVisible();
  await section.getByRole('button', { name: 'Clear filters' }).click();
  await expect(section.locator('.chipset-video-card')).toHaveCount(12);
  await section.getByRole('combobox', { name: 'SDK', exact: true }).selectOption('unknown');
  await expect(section.locator('.chipset-video-card')).toHaveCount(2);
  await expect(section.locator('.chipset-video-card').getByText('Community', { exact: true })).toHaveCount(2);
  await expect(section.locator('.chipset-video-card').getByText('Project demo', { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await testInfo.attach('board-video-projects', { body: await section.screenshot(), contentType: 'image/png' });
  await page.reload(); await expect(section.locator('.chipset-video-card')).toHaveCount(12);
});

test('[UI-CA-VIDEOS-003] failed thumbnails and legacy metadata retain usable links without duplicate cards @chipset-sdk @smoke', async ({ page }, testInfo) => {
  const record = structuredClone(chipset);
  const first = record.boards[0].resources.find(resource => resource.type === 'video');
  record.resources.push({ ...first, url: 'https://youtu.be/_rLiih5RkXY?t=42' });
  record.boards[0].resources.push({ type: 'video', title: 'Legacy camera walkthrough', url: 'https://example.com/walkthrough' });
  await setup(page, [record]);
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto(boardURL);
  const section = library(page);
  await expect(section.locator('.chipset-video-card')).toHaveCount(13);
  await expect(section.getByRole('link', { name: 'Watch AMB82 Mini - Getting Started', exact: true })).toHaveCount(1);
  await section.getByRole('searchbox', { name: 'Search videos' }).fill('Getting Started');
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator('.chipset-video-placeholder')).toHaveCount(2);
  await expect(section.locator('.chipset-video-card img')).toHaveCount(0);
  await testInfo.attach('video-thumbnail-fallback', { body: await section.screenshot(), contentType: 'image/png' });
  await section.getByRole('searchbox', { name: 'Search videos' }).fill('Legacy');
  await expect(section.getByRole('link', { name: 'Watch Legacy camera walkthrough' })).toHaveAttribute('href', 'https://example.com/walkthrough');
  await expect(section.locator('.chipset-video-card').getByText('SDK not confirmed', { exact: true })).toBeVisible();
});

test('[UI-CA-VIDEOS-004] unpublished providers hide videos while stale snapshots retain them @chipset-sdk @smoke', async ({ page }) => {
  await setup(page, []); await page.goto(catalogURL);
  await expect(library(page)).toHaveCount(0);
  await page.goto(boardURL); await expect(page.getByRole('heading', { name: 'Board not available' })).toBeVisible();
  await expect(library(page)).toHaveCount(0);
  await page.unroute('**/api/developer/chipsets');
  await page.route('**/api/developer/chipsets', route => route.fulfill({ json: { chipsets: [{ ...chipset, stale: true }], source_status: 'available' } }));
  await page.reload(); await expect(page.getByText('Last saved snapshot', { exact: true })).toBeVisible();
  await expect(library(page).locator('.chipset-video-card')).toHaveCount(12);
  await page.unroute('**/api/developer/chipsets');
  await page.route('**/api/developer/chipsets', route => route.fulfill({ json: { chipsets: [chipset], source_status: 'unavailable' } }));
  await page.reload(); await expect(library(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Board resources are temporarily unavailable' })).toBeVisible();
});
