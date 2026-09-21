import assert from 'node:assert/strict';
import test from 'node:test';
import { brandWebhookPath, brandWebhookRequest } from './brand-webhook.mjs';

const cloudID = '11111111-1111-4111-8111-111111111111';

test('webhook paths stay within one canonical cloud and one event segment', () => {
  assert.equal(brandWebhookPath(cloudID), `/api/developer/brand-clouds/${cloudID}/webhook/subscription`);
  assert.equal(brandWebhookPath(cloudID, 'event:1'), `/api/developer/brand-clouds/${cloudID}/webhook/events/event%3A1/receipts`);
  assert.throws(() => brandWebhookPath('../other'));
  assert.throws(() => brandWebhookPath(cloudID, '../other'));
});

test('webhook writes carry the observed ownership version, never a browser tenant header', async () => {
  let seen;
  const fetcher = async (path, options) => {
    seen = { path, options };
    return new Response(JSON.stringify({ endpoint_url: 'https://hooks.example.test/events', enabled: true }), {
      status: 200, headers: { 'X-Cloud-Ownership-Version': '7' },
    });
  };
  const body = { endpoint_url: 'https://hooks.example.test/events', secret: 's'.repeat(32) };
  const result = await brandWebhookRequest(cloudID, { method: 'PUT', body, version: 7, fetcher });
  assert.equal(seen.path, brandWebhookPath(cloudID));
  assert.equal(seen.options.headers['X-Cloud-Ownership-Version'], '7');
  assert.equal(seen.options.headers['X-Brand-Cloud-ID'], undefined);
  assert.equal(seen.options.credentials, 'same-origin');
  assert.equal(seen.options.cache, 'no-store');
  assert.deepEqual(JSON.parse(seen.options.body), body);
  assert.equal(result.version, '7');
  await assert.rejects(brandWebhookRequest(cloudID, { method: 'DELETE', fetcher }), { status: 409 });
});

test('missing subscription remains a usable owner-scoped configuration state', async () => {
  const fetcher = async () => new Response('missing', { status: 404, headers: { 'X-Cloud-Ownership-Version': '9' } });
  assert.deepEqual(await brandWebhookRequest(cloudID, { fetcher }), { data: null, version: '9' });
  await assert.rejects(brandWebhookRequest(cloudID, { eventId: 'event-1', fetcher }), { status: 404 });
});
