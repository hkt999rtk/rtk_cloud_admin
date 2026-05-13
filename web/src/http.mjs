export async function postJSON(url, body) {
  return sendJSON('POST', url, body);
}

export async function putJSON(url, body) {
  return sendJSON('PUT', url, body);
}

async function sendJSON(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new Error(details || `${url} failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function startSSOLogin(email, returnUrl) {
  return postJSON('/api/auth/sso/start', {
    email,
    return_url: returnUrl,
  });
}

export function userFacingSSOError(error) {
  if (error?.status === 401) {
    return 'Session expired. Sign in again to continue.';
  }
  if (error?.status === 403) {
    return 'You do not have access to this console view.';
  }
  const message = error?.message || 'SSO sign-in could not be started.';
  if (message.includes('ACCOUNT_MANAGER_BASE_URL') || message.includes('not configured')) {
    return 'SSO is not configured for this environment.';
  }
  if (message.includes('invalid JSON')) {
    return 'SSO is temporarily unavailable. Please try again later.';
  }
  if (message.includes('SSO start did not return a redirect URL')) {
    return 'SSO could not start because the identity provider did not return a redirect URL.';
  }
  return message;
}
