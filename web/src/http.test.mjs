import assert from 'node:assert/strict';
import test from 'node:test';
import { postJSON, putJSON, startSSOLogin, userFacingSSOError } from './http.mjs';

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

test('startSSOLogin posts email and return URL to SSO start endpoint', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/auth/sso/start');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.body, JSON.stringify({
      email: 'owner@example.com',
      return_url: 'https://admin.example.com/console',
    }));
    return {
      ok: true,
      status: 200,
      text: async () => '{"redirect_url":"https://idp.example.com/authorize","state":"state-1"}',
    };
  };

  assert.deepEqual(await startSSOLogin('owner@example.com', 'https://admin.example.com/console'), {
    redirect_url: 'https://idp.example.com/authorize',
    state: 'state-1',
  });

  globalThis.fetch = originalFetch;
});

test('putJSON sends JSON using PUT', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/admin/orgs/org-1/sso-provider');
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.body, JSON.stringify({ enabled: true }));
    return {
      ok: true,
      status: 200,
      text: async () => '{"provider":{"organization_id":"org-1","enabled":true}}',
    };
  };

  assert.deepEqual(await putJSON('/api/admin/orgs/org-1/sso-provider', { enabled: true }), {
    provider: { organization_id: 'org-1', enabled: true },
  });

  globalThis.fetch = originalFetch;
});

test('userFacingSSOError hides internal SSO configuration details', () => {
  assert.equal(
    userFacingSSOError(new Error('ACCOUNT_MANAGER_BASE_URL is not configured')),
    'SSO is not configured for this environment.',
  );
  assert.equal(
    userFacingSSOError(new Error('invalid JSON response from Account Manager')),
    'SSO is temporarily unavailable. Please try again later.',
  );
  assert.equal(
    userFacingSSOError(new Error('SSO provider is disabled for this organization')),
    'SSO provider is disabled for this organization',
  );
});
