import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDeveloperDocs, developerDocsURL } from './developer-docs.mjs';
import { destinationForSession } from './auth-routing.mjs';

test('documentation search matches body terms together, without a model', () => {
  const pages = [{ title: 'Shadow', description: 'State', keywords: ['delta'], text: 'Version conflict 409' }];
  assert.equal(searchDeveloperDocs(pages, '409 VERSION').length, 1);
  assert.equal(searchDeveloperDocs(pages, 'delta missing').length, 0);
  assert.equal(searchDeveloperDocs(pages, '  ').length, 1);
});

test('chapter navigation retains Cloud context, and sign-in returns to the requested chapter', () => {
  const url = developerDocsURL('shadow-quickstart', '?cloudId=11111111-1111-4111-8111-111111111111&q=delta');
  assert.equal(url, '/console/developer-docs/shadow-quickstart?cloudId=11111111-1111-4111-8111-111111111111');
  assert.equal(destinationForSession({ authenticated: true, kind: 'customer', memberships: [] }, url), url);
});

// Use the authored inventory so newly added chapters cannot silently become tenant routes.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { routeFromPath, canonicalCustomerPath, cloudIdFromPath } from './routes.mjs';
const inventory = parse(readFileSync(new URL('../content/developer-docs/index.en.yaml', import.meta.url), 'utf8'));
test('every published chapter, including overview, remains a global documentation route', () => {
  for (const { slug } of inventory.sections) {
    const path = `/console/developer-docs/${slug}`;
    assert.equal(routeFromPath(path), 'developer-docs', slug);
    assert.equal(routeFromPath(`${path}/`), 'developer-docs', slug);
    assert.equal(canonicalCustomerPath(path), path, slug);
    assert.equal(cloudIdFromPath(path), '', slug);
  }
});

test('exact title precedes cross references and code searches expose matching text', async () => {
  const { documentationSnippet } = await import('./developer-docs.mjs');
  const reference = { title: 'Overview', description: 'Introduction', keywords: [], text: 'Read MQTT Connection Guide. A version conflict returns 409.' };
  const guide = { title: 'MQTT Connection Guide', description: 'Connection settings', keywords: [], text: 'Configure MQTT.' };
  assert.equal(searchDeveloperDocs([reference, guide], 'MQTT Connection Guide')[0], guide);
  assert.match(documentationSnippet(reference, '409'), /version conflict returns 409/);
  assert.equal(documentationSnippet(reference, ' '), reference.description);
});
