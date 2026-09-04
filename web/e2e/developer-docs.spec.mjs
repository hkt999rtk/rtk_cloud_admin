import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-DOCS-001] Developer Docs appears below ChipSet & SDK and supports local reading and search @smoke', async ({ page, isMobile }) => {
  await login(page, 'developer');
  const requests = [];
  page.on('request', (request) => { if (request.url().includes('/api/fleet/')) requests.push(request.url()); });
  await page.goto('/console/developer-docs');
  await expect(page.getByRole('searchbox', { name: 'Search documentation' })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const links = page.locator('.sidebar-nav-group').filter({ has: page.getByRole('link', { name: 'ChipSet & SDK', exact: true }) }).locator('a');
  const names = await links.allTextContents();
  expect(names.map((name) => name.trim()).indexOf('Developer Docs')).toBe(names.map((name) => name.trim()).indexOf('ChipSet & SDK') + 1);
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Developer Docs', exact: true })).toHaveAttribute('aria-current', 'page');
  if (isMobile) await page.locator('.mobile-nav-close').click();
  await page.getByRole('searchbox').fill('version conflict');
  await expect(page.locator('.docs-results')).toContainText('Integration Recipes');
  await page.getByRole('searchbox').fill('no-such-topic-zzzz');
  await expect(page.locator('.docs-results')).toContainText('No matching documents');
  await page.getByRole('searchbox').fill('');
  await page.locator('.docs-results').getByRole('link', { name: 'Quickstart: Synchronize Device State', exact: true }).click();
  await expect(page.locator('.docs-article h2').first()).toHaveText('Quickstart: Synchronize Device State');
  const diagram = page.locator('.docs-body img').first();
  await expect(diagram).toBeVisible();
  expect(await diagram.evaluate((img) => img.complete && img.naturalWidth > 0)).toBeTruthy();
  const source = await page.request.get(await page.getByRole('link', { name: 'Mermaid source' }).first().getAttribute('href'));
  expect(source.ok()).toBeTruthy();
  expect(await source.text()).toContain('sequenceDiagram');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(requests).toEqual([]);
});

test('[UI-CA-DOCS-002] direct chapter links require the regular console sign-in @smoke', async ({ page }) => {
  await page.goto('/console/developer-docs/shadow-quickstart');
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe('/console/developer-docs/shadow-quickstart');
});
