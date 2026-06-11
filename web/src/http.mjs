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
  if (/callback|state|nonce|verification/i.test(message)) {
    return 'SSO callback could not be verified. Try signing in again.';
  }
  if (/gateway|temporarily unavailable|timeout|network|502|503|504/i.test(message)) {
    return 'SSO is temporarily unavailable. Please try again later.';
  }
  if (containsSensitiveDetails(message)) {
    return 'SSO sign-in could not be started. Please try again.';
  }
  return message;
}

export function userFacingSignupError(error) {
  const message = String(error?.message || error || '');
  if (/validation|email|password|captcha|terms|400|422/i.test(message)) {
    return 'Check the signup fields and try again.';
  }
  if (/gateway|account manager|temporarily unavailable|timeout|network|502|503|504/i.test(message)) {
    return 'Evaluation signup is temporarily unavailable. Please try again later.';
  }
  return 'Evaluation signup could not be completed. Please try again.';
}

export function userFacingVerificationError(error) {
  const message = String(error?.message || error || '');
  if (/expired/i.test(message)) {
    return 'Verification link expired. Request a new verification email.';
  }
  if (/already verified|already_verified/i.test(message)) {
    return 'Email is already verified. Sign in to continue.';
  }
  if (/invalid|malformed|token|400|404|422/i.test(message) && !containsSensitiveDetails(message)) {
    return 'Verification token is invalid. Check the link and try again.';
  }
  if (/gateway|account manager|temporarily unavailable|timeout|network|502|503|504/i.test(message)) {
    return 'Verification service is temporarily unavailable. Please try again later.';
  }
  return 'Verification could not be completed. Please try again.';
}

export function userFacingLoginActivationError(error) {
  const message = String(error?.message || error || '');
  if (/invalid|expired|token|400|404|422/i.test(message) && !containsSensitiveDetails(message)) {
    return 'Sign-in link is invalid or expired. Request a new sign-in email.';
  }
  if (/gateway|account manager|temporarily unavailable|timeout|network|502|503|504/i.test(message)) {
    return 'Sign-in is temporarily unavailable. Please try again later.';
  }
  return 'Sign-in could not be completed. Please request a new sign-in email.';
}

export function userFacingPasswordResetError(error) {
  const message = String(error?.message || error || '');
  if (/invalid|expired|token|400|404|422/i.test(message) && !containsSensitiveDetails(message)) {
    return 'Reset link is invalid or expired. Request a new reset email.';
  }
  if (/password|minLength|too short/i.test(message)) {
    return 'Password must be at least 8 characters.';
  }
  if (/gateway|account manager|temporarily unavailable|timeout|network|502|503|504/i.test(message)) {
    return 'Password reset is temporarily unavailable. Please try again later.';
  }
  return 'Password reset could not be completed. Please try again.';
}

function containsSensitiveDetails(message) {
  return /video_cloud_devid|operation_id|upstream_operation_id|raw_payload|\{.*\}/i.test(String(message || ''));
}
