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
