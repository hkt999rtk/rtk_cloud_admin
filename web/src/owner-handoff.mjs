import { cloudAPI, cloudURL } from './managed-clouds.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const handoffAcceptPath = '/brand-cloud-owner-transfer/accept';
export function handoffRoute(path) {
  if (path === handoffAcceptPath) return { accept: true };
  const m = path.match(/^\/console\/clouds\/([^/]+)\/owner-transfer\/([^/]+)\/?$/);
  return m && uuid.test(m[1]) && uuid.test(m[2]) ? { cloudId: m[1], transferId: m[2] } : null;
}
export function handoffURL(cloud, transfer) { if (!uuid.test(transfer)) throw new Error('Invalid transfer'); return `${cloudURL(cloud)}/owner-transfer/${transfer}`; }
export function handoffAPI(cloud, transfer = '', action = '') {
  if (transfer && !uuid.test(transfer)) throw new Error('Invalid transfer');
  if (action && (!transfer || !['preview', 'confirm', 'cancel'].includes(action))) throw new Error('Invalid action');
  return `${cloudAPI(cloud)}/owner-transfer${transfer ? `/${transfer}` : ''}${action ? `/${action}` : ''}`;
}
export function safeSnapshot(s) {
  return Boolean(s && Number.isSafeInteger(s.ownership_version) && s.ownership_version >= 1 && Number.isSafeInteger(s.billing_snapshot_version) && s.billing_snapshot_version >= 2 && Number.isSafeInteger(s.balance_minor) && s.balance_minor >= 0 && s.currency === 'TWD');
}
export function snapshotKey(v) { return safeSnapshot(v?.balance_snapshot) ? JSON.stringify([v.brand_cloud_id, v.id, v.balance_snapshot.ownership_version, v.balance_snapshot.billing_snapshot_version, v.balance_snapshot.balance_minor, v.balance_snapshot.currency]) : ''; }
export function handoffConfirmable(v, actor) {
  return Boolean(v?.phase === 'awaiting_balance_confirmation' && v.operation_phase === 'preparing' && v.has_settled_snapshot && safeSnapshot(v.balance_snapshot) && v.balance_snapshot.ownership_version === v.ownership_version && v.blockers?.length === 0 && (actor === v.source_user_id ? v.source_confirmed === false : actor === v.target_user_id && v.target_confirmed === false));
}
export function handoffCancelable(v, actor) { return Boolean(actor && v?.source_user_id === actor && ['pending', 'accepted'].includes(v.status) && !['canceling', 'canceled', 'finalizing', 'succeeded'].includes(v.operation_phase) && !['succeeded', 'finalizing', 'expired', 'canceled'].includes(v.phase)); }
export function handoffComplete(v) { return v?.phase === 'succeeded' && v.operation_phase === 'succeeded' && v.operation?.state === 'succeeded'; }
export function handoffTitle(v) {
  if (handoffComplete(v)) return 'Ownership handoff completed';
  if (v?.operation_phase === 'canceling') return 'Cancellation awaiting hold release';
  if (v?.phase === 'finalizing') return 'Owner changed; finalization in progress';
  if (v?.phase === 'canceled') return 'Handoff canceled; holds released';
  if (v?.phase === 'expired') return 'Ownership invitation expired';
  return 'Handoff in progress';
}
export function handoffError(err) {
  if (err?.status === 401) return 'Your session expired. Sign in again.';
  if ([403, 404].includes(err?.status)) return 'This account cannot access this handoff, or the invitation has expired.';
  if (err?.status === 409) return 'The handoff is blocked or its snapshot changed. Review status and request a fresh settled preview. Negative balance, unsettled usage, pending payments, quota or ownership changes can block transfer.';
  if ([400, 422].includes(err?.status)) return 'Check the invitee and exact nonnegative balance snapshot.';
  return 'Handoff status is unavailable. Do not assume ownership changed or retry with a different confirmation amount.';
}
