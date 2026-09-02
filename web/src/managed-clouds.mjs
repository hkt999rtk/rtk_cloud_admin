export const cloudRoot = '/console/clouds';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isCloudID(id) { return typeof id === 'string' && uuid.test(id); }
export function managedCloudRoute(path) {
  if (path === cloudRoot || path === `${cloudRoot}/`) return { cloudId: '' };
  const match = path.match(/^\/console\/clouds\/([^/]+)(?:\/(products|members|settings)(?:\/([^/]+)(?:\/devices\/([^/]+))?)?)?\/?$/);
  if (!match || !uuid.test(match[1]) || (match[3] && !uuid.test(match[3])) || (match[4] && !uuid.test(match[4]))) return null;
  return { cloudId: match[1], section: match[2] || 'overview', productId: match[3] || '', ...(match[4] ? {deviceId:match[4]} : {}) };
}
export function cloudURL(id) { if (!uuid.test(id)) throw new Error('Invalid cloud ID'); return `${cloudRoot}/${id}`; }
export function cloudOperationFromSearch(search) { const id = new URLSearchParams(search).get('operation') || ''; return uuid.test(id) ? id : ''; }
export function cloudAPI(id = '') { if (id && !uuid.test(id)) throw new Error('Invalid cloud ID'); return `/api/developer/brand-clouds${id ? `/${id}` : ''}`; }
export function cloudError(error) {
  if (error?.status === 401) return 'Your session expired. Sign in again.';
  if ([403, 404].includes(error?.status)) return 'Cloud access is unavailable or has been revoked.';
  if (error?.status === 409) return 'The cloud changed or its quota, resources or Billing prevent this action. Refresh and review before retrying.';
  if ([400, 422].includes(error?.status)) return 'Check the cloud name and description.';
  return 'Cloud management is temporarily unavailable. You can retry this request.';
}
export const blockerLabels = {
  products_present: 'Products must be removed first.', devices_present: 'Devices must be removed first.',
  jobs_running: 'Background work is still running.', balance_positive: 'Credit must be resolved before deletion.',
  balance_negative: 'Outstanding debt must be settled.', usage_unsettled: 'Usage has not been fully settled.',
  balance_nonzero: 'The cloud balance must be zero before deletion.', debt_outstanding: 'Outstanding debt must be settled.',
  invoices_unsettled: 'Invoices have not been fully settled.', payment_pending: 'A payment is still processing.',
  refund_pending: 'A refund is still processing.', dispute_pending: 'A payment dispute remains open.',
  lifecycle_conflict: 'Another cloud lifecycle operation is running.', evidence_unavailable: 'A required service cannot confirm readiness.',
  confirmation_stale: 'The balance snapshot is stale. Both parties must review the current version.', quota_exceeded: 'The recipient’s ownership quota is exhausted.',
};
export async function managedCloudRequest(path, { method = 'GET', body, key, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers, signal, cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) { const error = new Error('Cloud request failed'); error.status = response.status; throw error; }
  return response.status === 204 ? null : response.json();
}

// A deliberate submission owns its key. Retrying identical content reuses it;
// changing the target or fields starts a new intent, never replays on another cloud.
export function cloudWriteIntent(previous, method, path, body, newKey = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify([method, path, body]);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: newKey(), method, path, body };
}
