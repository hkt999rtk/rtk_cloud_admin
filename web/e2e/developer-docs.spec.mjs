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

test('[UI-CA-DOCS-003] every chapter and in-document link works @smoke', async ({ page, isMobile }, testInfo) => {
  test.setTimeout(180_000);
  await login(page, 'developer');
  const catalogResponse = await page.request.get('/assets/developer-docs/index.en.json');
  const { pages } = await catalogResponse.json();
  const checked = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const chapter of pages) {
    await page.goto('/console/developer-docs');
    // Exercise actual navigation, not only HTTP 200 from the generic SPA shell.
    if (isMobile) await page.getByLabel('Choose a chapter').selectOption(chapter.slug);
    else await page.getByRole('navigation', { name: 'Documentation chapters' }).getByRole('link', { name: chapter.title, exact: true }).click();
    await expect(page.locator('.docs-article header h2')).toHaveText(chapter.title);
    await expect(page.getByText('The requested data could not be loaded. Please try again.', { exact: true })).toHaveCount(0);
    checked.push({ source: 'chapter navigation', destination: chapter.url });
    const links = await page.locator('.docs-body a').evaluateAll((items) => items.map((item) => ({ href: item.getAttribute('href'), text: item.textContent })));
    for (let i = 0; i < links.length; i += 1) {
      const link = links[i];
      await page.goto(chapter.url);
      await expect(page.locator('.docs-article header h2')).toHaveText(chapter.title);
      const target = page.locator('.docs-body a').nth(i);
      if (link.href.startsWith('/assets/')) {
        if (link.href.endsWith('.mmd')) {
          await expect(target).toHaveAttribute('download', '');
          const downloadPromise = page.waitForEvent('download');
          await target.click();
          expect(await (await downloadPromise).failure()).toBeNull();
        } else {
          await target.click();
          expect(new URL(page.url()).pathname).toBe(link.href);
        }
        const content = await page.request.get(link.href);
        expect(await content.text()).toContain(link.href.endsWith('.svg') ? '<svg' : (link.href.includes('service-overview') ? 'flowchart' : 'sequenceDiagram'));
      } else {
        await target.click();
        const destination = pages.find((item) => item.url === link.href);
        if (destination) await expect(page.locator('.docs-article header h2')).toHaveText(destination.title);
        else {
          expect(link.href).toBe('/console/chipset-sdk');
          await expect(page.getByRole('heading', { name: 'ChipSet & SDK', exact: true }).first()).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Cloud Client SDKs', exact: true })).toBeVisible();
        }
        await expect(page.getByText('The requested data could not be loaded. Please try again.', { exact: true })).toHaveCount(0);
      }
      checked.push({ source: chapter.slug, destination: link.href });
    }
    await page.goto(chapter.url);
    await page.locator('.docs-toc summary').click();
    const toc = page.locator('.docs-toc a');
    const count = await toc.count();
    for (let i = 0; i < count; i += 1) {
      const href = await toc.nth(i).getAttribute('href');
      await toc.nth(i).click();
      await expect(page.locator(`[id="${href.slice(1)}"]`)).toBeVisible();
      checked.push({ source: chapter.slug, destination: href });
    }
    await page.goto('/console/developer-docs');
    await page.locator('.docs-results').getByRole('link', { name: chapter.title, exact: true }).click();
    await expect(page.locator('.docs-article header h2')).toHaveText(chapter.title);
    checked.push({ source: 'search results', destination: chapter.url });
  }
  expect(errors).toEqual([]);
  await testInfo.attach('all-documentation-links', { body: JSON.stringify(checked, null, 2), contentType: 'application/json' });
});
