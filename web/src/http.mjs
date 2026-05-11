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
  const message = error?.message || 'SSO sign-in could not be started.';
  if (message.includes('ACCOUNT_MANAGER_BASE_URL') || message.includes('not configured')) {
    return 'SSO is not configured for this environment.';
  }
  if (message.includes('invalid JSON')) {
    return 'SSO is temporarily unavailable. Please try again later.';
  }
  return message;
}
