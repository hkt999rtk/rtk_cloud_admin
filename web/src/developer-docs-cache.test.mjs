import test from 'node:test';
import assert from 'node:assert/strict';
import { developerDocsVersions } from './developer-docs-version.generated.mjs';

test('Developer Docs shares one download and refreshes after a day', async () => {
  const { loadDeveloperDocsCatalog, peekDeveloperDocsCatalog } = await import('./developer-docs-cache.mjs');
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ pages: [{ title: `revision ${requests.length}` }] }), { status: 200 });
  };

  const [first, shared] = await Promise.all([
    loadDeveloperDocsCatalog('en', fetcher, 1000),
    loadDeveloperDocsCatalog('en', fetcher, 1000),
  ]);
  assert.equal(requests.length, 1);
  assert.strictEqual(first, shared);
  assert.strictEqual(peekDeveloperDocsCatalog('en'), first);
  assert.strictEqual(await loadDeveloperDocsCatalog('en', fetcher, 1000 + 86_400_000 - 1), first);
  assert.equal(requests.length, 1);

  const chinese = await loadDeveloperDocsCatalog('zh-TW', fetcher, 1000);
  assert.equal(requests.length, 2);
  assert.strictEqual(peekDeveloperDocsCatalog('zh-TW'), chinese);
  assert.strictEqual(peekDeveloperDocsCatalog('en'), first);

  const refreshed = await loadDeveloperDocsCatalog('en', fetcher, 1000 + 86_400_000);
  assert.equal(requests.length, 3);
  assert.equal(refreshed.pages[0].title, 'revision 3');
  assert.equal(requests[0].url, `/assets/developer-docs/index.en.json?v=${developerDocsVersions.en}`);
  assert.equal(requests[1].url, `/assets/developer-docs/index.zh-TW.json?v=${developerDocsVersions['zh-TW']}`);
  assert.equal(requests[0].options, undefined);
});
