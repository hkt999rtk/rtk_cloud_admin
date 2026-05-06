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
