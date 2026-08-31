import { cloudAPI } from './managed-clouds.mjs';

export function cloudBillingRoute(path) {
  const m = path.match(/^\/console\/clouds\/([0-9a-f-]{36})\/billing(?:\/(usage|invoices|activity|settings|profile)(?:\/([^/]+))?)?\/?$/);
  if (!m || (m[3] && !['invoices','activity'].includes(m[2]))) return null;
  try { cloudAPI(m[1]); } catch { return null; }
  return { cloudId: m[1] };
}
export function billingAPI(cloud, path) {
  if (!path.startsWith('/api/billing/') || path.includes('#') || path.includes('..')) throw new Error('Invalid Billing path');
  return `${cloudAPI(cloud)}/billing/${path.slice('/api/billing/'.length)}`;
}
export function billingScopeError(status) {
  if ([401,403,404].includes(status)) return 'Billing access is unavailable. Only the current owner of this cloud can view its account.';
  if (status === 409) return 'Ownership or Billing changed. Refresh before taking further action.';
  return 'Billing information is temporarily unavailable. No payment has been submitted.';
}
export async function fetchCloudBillingData(cloud, { signal, fetcher = fetch } = {}) {
  const endpoints = {account:'account',methods:'payment-methods?limit=20',intents:'payment-intents?limit=20',ledger:'ledger?limit=20',summary:'summary',usage:'usage',invoices:'invoices?limit=20',activity:'activity?limit=20',profile:'profile',policy:'auto-topup'};
  const entries = await Promise.all(Object.entries(endpoints).map(async ([name, path]) => {
    const response = await fetcher(billingAPI(cloud, `/api/billing/${path}`), {signal,cache:'no-store'});
    if (!response.ok) throw Object.assign(new Error(billingScopeError(response.status)), {status:response.status});
    return {name, value:await response.json(), version:response.headers.get('X-Cloud-Ownership-Version'), etag:response.headers.get('ETag')};
  }));
  const version = entries[0].version;
  if (!/^[1-9][0-9]*$/.test(version || '') || entries.some(e => e.version !== version)) throw Object.assign(new Error(billingScopeError(409)), {status:409});
  const result = Object.fromEntries(entries.map(e => [e.name,e.value]));
  if (result.account?.account?.organization_id !== cloud) throw Object.assign(new Error('Invalid Billing account scope'), {status:502});
  return {...result,ownershipVersion:version,policyEtag:entries.find(e=>e.name==='policy').etag || `"${result.policy?.auto_topup?.version || 0}"`,source_status:'available'};
}
