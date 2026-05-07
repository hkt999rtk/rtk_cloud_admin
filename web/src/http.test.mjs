import assert from 'node:assert/strict';
import test from 'node:test';
import { postJSON } from './http.mjs';

test('postJSON throws on failed verification responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'invalid verification token',
  });

  await assert.rejects(
    () => postJSON('/api/auth/customer/verify-email', { token: 'bad-token' }),
    /invalid verification token/,
  );

  globalThis.fetch = originalFetch;
});

test('postJSON throws on failed quota raise responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => 'quota raise forbidden',
  });

  await assert.rejects(
    () => postJSON('/api/orgs/org-1/quota-raise-requests', {
      requested_quota: 25,
      use_case: 'growth',
      contact_info: { email: 'owner@example.com' },
    }),
    /quota raise forbidden/,
  );

  globalThis.fetch = originalFetch;
});

test('postJSON returns parsed JSON for successful responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/auth/customer/login');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.body, JSON.stringify({ email: 'owner@example.com' }));
    return {
      ok: true,
      status: 200,
      text: async () => '{"status":"ok","user":{"email":"owner@example.com"}}',
    };
  };

  const payload = await postJSON('/api/auth/customer/login', { email: 'owner@example.com' });
  assert.deepEqual(payload, {
    status: 'ok',
    user: { email: 'owner@example.com' },
  });

  globalThis.fetch = originalFetch;
});

test('postJSON returns null for successful empty responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 204,
    text: async () => '',
  });

  assert.equal(await postJSON('/api/auth/customer/resend-verification', { email: 'owner@example.com' }), null);

  globalThis.fetch = originalFetch;
});

test('postJSON propagates network failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('network unavailable');
  };

  await assert.rejects(
    () => postJSON('/api/auth/customer/login', { email: 'owner@example.com' }),
    /network unavailable/,
  );

  globalThis.fetch = originalFetch;
});
