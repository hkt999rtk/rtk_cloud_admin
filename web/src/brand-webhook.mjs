import { cloudAPI, isCloudID } from './managed-clouds.mjs';

const eventIDPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function brandWebhookPath(cloudId, eventId = '') {
  if (!isCloudID(cloudId)) throw new Error('Invalid cloud ID');
  const base = `${cloudAPI(cloudId)}/webhook`;
  if (!eventId) return `${base}/subscription`;
  if (!eventIDPattern.test(eventId)) throw new Error('Invalid event ID');
  return `${base}/events/${encodeURIComponent(eventId)}/receipts`;
}

export async function brandWebhookRequest(cloudId, { method = 'GET', eventId = '', body, version, signal, fetcher = fetch } = {}) {
  if (eventId && method !== 'GET') throw new Error('Receipts are read-only');
  if (!eventId && !['GET', 'PUT', 'DELETE'].includes(method)) throw new Error('Unsupported webhook action');
  if (method !== 'GET' && (!version || !/^\d+$/.test(String(version)))) {
    const error = new Error('Refresh cloud ownership before changing the webhook.');
    error.status = 409;
    throw error;
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-Cloud-Ownership-Version'] = String(version);
  const response = await fetcher(brandWebhookPath(cloudId, eventId), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', signal,
  });
  const ownershipVersion = response.headers.get('X-Cloud-Ownership-Version') || String(version || '');
  if (method === 'GET' && !eventId && response.status === 404) {
    return { data: null, version: ownershipVersion };
  }
  if (!response.ok) {
    const error = new Error('Brand webhook request failed');
    error.status = response.status;
    throw error;
  }
  return { data: response.status === 204 ? null : await response.json(), version: ownershipVersion };
}
